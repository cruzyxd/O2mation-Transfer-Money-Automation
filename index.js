import { Telegraf, Markup } from "telegraf";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import cron from "node-cron";
import db from "./utils/db.js";
import sheetsSync from "./utils/sheetsSync.js";
import { checkAndSendReminders } from "./utils/reminders.js";

// Initialize Database
db.init();

if (!process.env.BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is missing in .env");
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY is missing in .env");
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Role and Routing Configuration ---
// These are the authorized IDs. For now, we use the same ID for testing.
const AUTHORIZED_IDS = {
  MANAGER_A: process.env.MANAGER_A_ID,
  MANAGER_B: process.env.MANAGER_B_ID,
  ACCOUNTANT: process.env.ACCOUNTANT_ID,
};

// Routing: Define who messages are sent to.
// Switch these to actual role IDs (e.g., AUTHORIZED_IDS.MANAGER_B) when moving to production.
const ROUTING = {
  APPROVAL_MANAGER: AUTHORIZED_IDS.MANAGER_A, // Currently sending back to self
  PAYMENT_ACCOUNTANT: AUTHORIZED_IDS.ACCOUNTANT, // Currently sending back to self
};

const NAMES = {
  MANAGER_A: "Ahsan Arshad",
  MANAGER_B: "Abid Ali",
  ACCOUNTANT: "Abdullah Habeeb",
};

const MANAGER_NAMES = {
  [AUTHORIZED_IDS.MANAGER_A]: NAMES.MANAGER_A,
  [AUTHORIZED_IDS.MANAGER_B]: NAMES.MANAGER_B,
  [AUTHORIZED_IDS.ACCOUNTANT]: NAMES.ACCOUNTANT,
};

// --- Middleware: Access Control (Silent Ignore) ---
bot.use(async (ctx, next) => {
  const userId = ctx.chat?.id.toString() || ctx.from?.id.toString();
  console.log(`[DEBUG] Incoming Message from User ID: ${userId}`); // DEBUG LOG
  const isAuthorized = Object.values(AUTHORIZED_IDS).includes(userId);

  if (!isAuthorized) {
    console.log(`[DEBUG] Access Denied for User ID: ${userId}`); // DEBUG LOG
    // Silent ignore unauthorized users
    return;
  }

  // User is authorized, proceed to the next handler
  return next();
});

// In-memory store for conversation context (for demonstration)
const userContexts = {};

const VALIDATION_SYSTEM_PROMPT = `
You are a transaction validation assistant. Your goal is to extract three specific pieces of information from the user's input:
1. Amount (how much is being paid). ALWAYS normalize this to Saudi Riyals (SR). If the user provides a different currency, convert or label it as SR. If no currency is mentioned, assume it is SR.
2. Recipient (who is being paid)
3. Purpose (the reason for payment, where the money is going, or what is being bought)

Analyze the user's input.
Output strictly valid JSON in the following format. Do not add markdown formatting like \`\`\`json.

If ALL 3 pieces of information are present and clear:
{
  "complete": true,
  "data": {
    "amount": "extracted amount",
    "recipient": "extracted recipient",
    "item": "extracted purpose/description"
  }
}

If ANY information is missing or unclear:
{
  "complete": false,
  "message": "A polite, natural language request asking specifically for the missing information."
}
`;

bot.start((ctx) => {
  userContexts[ctx.chat.id] = []; // Reset context
  const name = MANAGER_NAMES[ctx.chat.id] || "Manager";
  ctx.reply(
    `Welcome ${name}! Describe a payment request (Amount, Recipient, Purpose) and I will process it.`,
  );
});

bot.on("text", async (ctx) => {
  const userId = ctx.chat.id;
  const userMessage = ctx.message.text;
  const replyToMessageId = ctx.message.reply_to_message?.message_id;

  // Check if this is a reply to a "Give Reason" prompt (DB lookup)
  const pendingAction = replyToMessageId
    ? db.getPendingAction(replyToMessageId.toString())
    : null;

  if (pendingAction) {
    const {
      request_id: requestId,
      type,
      edit_message_id: messageIdToEdit,
      original_text: originalText,
    } = pendingAction;
    const request = db.getRequest(requestId);

    if (!request) {
      await ctx.reply("Request expired or not found.");
      db.deletePendingAction(replyToMessageId.toString());
      return;
    }

    // Ensure it hasn't been processed by someone else
    if (
      type === "AWAITING_DECLINE_REASON" &&
      request.manager_status !== "PENDING"
    ) {
      await ctx.reply("This request has already been processed.");
      db.deletePendingAction(replyToMessageId.toString());
      return;
    }
    if (
      type === "AWAITING_ISSUE_REASON" &&
      request.accountant_status !== "PENDING"
    ) {
      await ctx.reply("This request has already been processed.");
      db.deletePendingAction(replyToMessageId.toString());
      return;
    }

    const {
      requester_id: manager1Id,
      manager_id: manager2Id,
      amount,
      recipient,
    } = request;
    const reason = userMessage;
    const safeText = escapeHTML(originalText);

    if (type === "AWAITING_DECLINE_REASON") {
      // 1. Update Database
      db.updateManager(requestId, "DECLINED", reason, userId.toString());

      // Determine manager name robustly
      const managerName =
        userId.toString() === AUTHORIZED_IDS.MANAGER_A
          ? NAMES.MANAGER_A
          : NAMES.MANAGER_B;

      // 2. Sync to Google Sheets
      sheetsSync
        .updateCells(requestId, {
          manager_status: "DECLINED",
          manager_reason: reason,
          manager_id: userId.toString(),
        })
        .catch((err) =>
          console.error("Sheets Sync Error (Update Manager):", err),
        );

      // 3. Update Manager 2's original request message to show Declined status
      const newText =
        safeText +
        `\n\n❌ <b>DECLINED</b>\nReason: <i>${escapeHTML(reason)}</i>`;

      try {
        await bot.telegram.editMessageText(
          userId,
          messageIdToEdit,
          undefined,
          newText,
          { parse_mode: "HTML" },
        );
      } catch (e) {
        console.error("Error updating Manager 2 message:", e);
      }

      // 3. Notify Manager 1
      const notificationToManager1 = `❌ Your request for <b>${amount}</b> to <b>${recipient}</b> has been <b>DECLINED</b> by ${managerName}.\n\n<b>Reason:</b> ${escapeHTML(reason)}`;
      await bot.telegram.sendMessage(manager1Id, notificationToManager1, {
        parse_mode: "HTML",
      });

      await ctx.reply("Reason sent. Request declined.", {
        reply_markup: { remove_keyboard: true },
      });
    } else if (type === "AWAITING_ISSUE_REASON") {
      // 1. Update Database
      db.updateAccountant(requestId, "ISSUE", reason, userId.toString());

      const accountantName = NAMES.ACCOUNTANT;

      // 2. Sync to Google Sheets
      sheetsSync
        .updateCells(requestId, {
          accountant_status: "ISSUE",
          accountant_reason: reason,
          accountant_id: userId.toString(),
        })
        .catch((err) =>
          console.error("Sheets Sync Error (Update Accountant):", err),
        );

      // 3. Update Accountant's message
      const newText =
        safeText +
        `\n\n⚠️ <b>ISSUE REPORTED</b>\nReason: <i>${escapeHTML(reason)}</i>`;

      try {
        await bot.telegram.editMessageText(
          userId,
          messageIdToEdit,
          undefined,
          newText,
          { parse_mode: "HTML" },
        );
      } catch (e) {
        console.error("Error updating Accountant message:", e);
      }

      // 3. Notify BOTH Managers
      const notification = `⚠️ ${accountantName} reported an issue for the request: <b>${amount}</b> to <b>${recipient}</b>.\n\n<b>Reason:</b> ${escapeHTML(reason)}`;
      await bot.telegram.sendMessage(manager1Id, notification, {
        parse_mode: "HTML",
      });
      if (manager2Id) {
        await bot.telegram.sendMessage(manager2Id, notification, {
          parse_mode: "HTML",
        });
      }

      await ctx.reply("Issue reported to both managers.", {
        reply_markup: { remove_keyboard: true },
      });
    }

    // Clear state & Cleanup prompt message from DB
    db.deletePendingAction(replyToMessageId.toString());
    db.deletePendingRequestEdit(requestId); // Clean up the edit info as well
    try {
      // Delete the prompt message to clean up chat
      await ctx.deleteMessage(replyToMessageId);
    } catch (e) {
      console.error("Failed to delete prompt message", e);
    }

    return; // Stop processing, don't go to AI
  }

  // Initialize context if not exists
  if (!userContexts[userId]) userContexts[userId] = [];

  // Add user message to history
  userContexts[userId].push({ role: "user", content: userMessage });

  ctx.sendChatAction("typing");

  try {
    // We send the history to the AI so it remembers previous details provided
    const chatHistory = userContexts[userId]
      .map((msg) => msg.content)
      .join("\n");

    console.log(`[AI] Thinking for User ID: ${userId}...`);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      config: { responseMimeType: "application/json" },
      contents: [
        { role: "user", parts: [{ text: VALIDATION_SYSTEM_PROMPT }] },
        {
          role: "user",
          parts: [{ text: `Current Conversation Context:\n${chatHistory}` }],
        },
      ],
    });

    const resultText = response.text;
    console.log(`[AI] Response received for User ID: ${userId}: ${resultText}`);
    let result;
    try {
      result = JSON.parse(resultText);
    } catch (e) {
      console.error("Failed to parse JSON:", resultText);
      await ctx.reply("Error processing your request. Please try again.");
      return;
    }

    if (result.complete) {
      // Create a unique request ID
      const requestId = Date.now().toString();

      const requestData = {
        id: requestId,
        timestamp: new Date().toISOString(),
        requester_id: userId.toString(),
        recipient: result.data.recipient,
        amount: result.data.amount,
        item: result.data.item,
      };

      // Store in Database
      db.createRequest(requestData);

      // Sync to Google Sheets (Fire-and-forget)
      sheetsSync
        .appendRow(requestData)
        .catch((err) => console.error("Sheets Sync Error (Append):", err));

      // Clear context after success
      userContexts[userId] = [];

      const requesterName = MANAGER_NAMES[userId] || "Unknown Manager";

      // Format message for Manager 2
      const manager2Message = `
🔔 <b>New Payment Request from ${requesterName}</b>

👤 <b>Recipient:</b> ${result.data.recipient}
💰 <b>Amount:</b> ${result.data.amount}
📝 <b>Purpose:</b> ${result.data.item}

Please review this request.
      `;

      // Routing: Send to the designated Approval Manager
      let targetManagerId;
      if (userId.toString() === AUTHORIZED_IDS.MANAGER_A) {
        targetManagerId = AUTHORIZED_IDS.MANAGER_B;
      } else {
        targetManagerId = AUTHORIZED_IDS.MANAGER_A;
      }

      const approvalManagerName = MANAGER_NAMES[targetManagerId] || "Manager";
      await ctx.reply(
        `🔄 <i>Routing request to ${approvalManagerName} for approval...</i>`,
        { parse_mode: "HTML" },
      );

      await bot.telegram.sendMessage(targetManagerId, manager2Message, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          Markup.button.callback("✅ Accept", `accept_${requestId}`),
          Markup.button.callback("❌ Decline", `decline_${requestId}`),
        ]),
      });
    } else {
      // Ask for missing info
      userContexts[userId].push({ role: "model", content: result.message });
      await ctx.reply(result.message);
    }
  } catch (error) {
    console.error("Error generating response:", error);
    await ctx.reply(
      "Sorry, I encountered an error while processing your request.",
    );
  }
});

// Helper to escape HTML characters
const escapeHTML = (str) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Action handlers for the buttons
bot.action(/^(accept|decline)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const requestId = ctx.match[2];
  const request = db.getRequest(requestId);

  if (!request) {
    return ctx.answerCbQuery("Request not found.");
  }

  if (request.manager_status !== "PENDING") {
    return ctx.answerCbQuery("This request has already been processed.");
  }

  const { requester_id: manager1Id, recipient, amount, item } = request;

  if (action === "decline") {
    // 1. Acknowledge callback
    await ctx.answerCbQuery("Please provide a reason.");

    // 2. Persist original message info in DB
    db.savePendingRequestEdit(
      requestId,
      ctx.callbackQuery.message.message_id.toString(),
      ctx.callbackQuery.message.text,
    );

    // --- CLEANUP: Delete any existing "Give Reason" prompts for this request ---
    const existingActions = db.getPendingActionsByRequestId(requestId);
    for (const action of existingActions) {
      try {
        await bot.telegram.deleteMessage(
          action.user_id,
          parseInt(action.message_id),
        );
        db.deletePendingAction(action.message_id);
      } catch (e) {
        db.deletePendingAction(action.message_id);
      }
    }

    // 3. Send ForceReply message immediately
    const promptMessage = await ctx.reply(
      `Please type the reason for declining:`,
      Markup.forceReply(),
    );

    // 4. Store the prompt in DB to track the reply
    db.savePendingAction({
      message_id: promptMessage.message_id.toString(),
      request_id: requestId,
      type: "AWAITING_DECLINE_REASON",
      edit_message_id: ctx.callbackQuery.message.message_id.toString(),
      original_text: ctx.callbackQuery.message.text,
      user_id: ctx.from.id.toString(),
    });

    // 5. Auto-delete after 1 minute if no reply
    setTimeout(() => {
      bot.telegram
        .deleteMessage(ctx.chat.id, promptMessage.message_id)
        .then(() => db.deletePendingAction(promptMessage.message_id.toString()))
        .catch(() =>
          db.deletePendingAction(promptMessage.message_id.toString()),
        );
    }, 60000);

    return;
  }

  // Handle ACCEPT case (Immediate approval)
  await ctx.answerCbQuery("Request Accepted");

  // Determine which manager is approving
  const managerName =
    ctx.from.id.toString() === AUTHORIZED_IDS.MANAGER_A
      ? NAMES.MANAGER_A
      : NAMES.MANAGER_B;

  // 1. Update Database
  db.updateManager(requestId, "APPROVED", null, ctx.from.id.toString());

  // 2. Sync to Google Sheets
  sheetsSync
    .updateCells(requestId, {
      manager_status: "APPROVED",
      manager_id: ctx.from.id.toString(),
    })
    .catch((err) => console.error("Sheets Sync Error (Approve):", err));

  // 1. Update Manager 2's message
  const originalText = ctx.callbackQuery.message.text;
  const safeText = escapeHTML(originalText);
  const status = "✅ <b>APPROVED</b>";
  const newText = safeText + `\n\n${status}`;

  try {
    await ctx.editMessageText(newText, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.editMessageText(originalText + `\n\nAPPROVED`);
  }

  // 2. Notify Manager 1
  const notificationToManager1 = `✅ Your request for <b>${amount}</b> to <b>${recipient}</b> has been <b>APPROVED</b> by ${managerName}.`;
  await bot.telegram.sendMessage(manager1Id, notificationToManager1, {
    parse_mode: "HTML",
  });

  // 3. Notify Accountant
  const paymentAccountantName = NAMES.ACCOUNTANT;
  const accountantMessage = `
💼 <b>Payment Instruction for ${paymentAccountantName}</b>

The following request has been approved and is ready for payment:

💰 <b>Amount:</b> ${amount}
👤 <b>Recipient:</b> ${recipient}
📝 <b>Purpose:</b> ${item}

Please confirm the payment or report an issue.
  `;

  // Routing: Send to the designated Accountant
  await ctx.reply(`🔄 <i>Routing to ${paymentAccountantName}...</i>`, {
    parse_mode: "HTML",
  });
  await bot.telegram.sendMessage(
    ROUTING.PAYMENT_ACCOUNTANT,
    accountantMessage,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Transfer Done", `confirm_acc_${requestId}`),
          Markup.button.callback("⚠️ Issue", `issue_acc_${requestId}`),
        ],
      ]),
    },
  );

  // NOTE: We do NOT delete pendingRequests[requestId] here anymore because the accountant needs it.
});

// Action handlers for Accountant buttons
bot.action(/^(confirm_acc|issue_acc)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const requestId = ctx.match[2];
  const request = db.getRequest(requestId);

  if (!request) {
    return ctx.answerCbQuery("Request not found.");
  }

  if (request.accountant_status !== "PENDING") {
    return ctx.answerCbQuery("This request has already been processed.");
  }

  const {
    requester_id: manager1Id,
    manager_id: manager2Id,
    amount,
    recipient,
  } = request;

  if (action === "issue_acc") {
    // 1. Acknowledge callback
    await ctx.answerCbQuery("Please report the issue.");

    // 2. Persist original message info in DB
    db.savePendingRequestEdit(
      requestId,
      ctx.callbackQuery.message.message_id.toString(),
      ctx.callbackQuery.message.text,
    );

    // --- CLEANUP: Delete any existing prompts for this request ---
    const existingActions = db.getPendingActionsByRequestId(requestId);
    for (const action of existingActions) {
      try {
        await bot.telegram.deleteMessage(
          action.user_id,
          parseInt(action.message_id),
        );
        db.deletePendingAction(action.message_id);
      } catch (e) {
        db.deletePendingAction(action.message_id);
      }
    }

    // 3. Send ForceReply message immediately
    const promptMessage = await ctx.reply(
      `Please report the issue for the request:`,
      Markup.forceReply(),
    );

    // 4. Store the prompt in DB to track the reply
    db.savePendingAction({
      message_id: promptMessage.message_id.toString(),
      request_id: requestId,
      type: "AWAITING_ISSUE_REASON",
      edit_message_id: ctx.callbackQuery.message.message_id.toString(),
      original_text: ctx.callbackQuery.message.text,
      user_id: ctx.from.id.toString(),
    });

    // 5. Auto-delete after 1 minute if no reply
    setTimeout(() => {
      bot.telegram
        .deleteMessage(ctx.chat.id, promptMessage.message_id)
        .then(() => db.deletePendingAction(promptMessage.message_id.toString()))
        .catch(() =>
          db.deletePendingAction(promptMessage.message_id.toString()),
        );
    }, 60000);

    return;
  }

  // Handle CONFIRM case
  await ctx.answerCbQuery("Transfer Completed");

  const accountantName = NAMES.ACCOUNTANT;

  // 1. Update Database
  db.updateAccountant(requestId, "CONFIRMED", null, ctx.from.id.toString());

  // 2. Sync to Google Sheets
  sheetsSync
    .updateCells(requestId, {
      accountant_status: "CONFIRMED",
      accountant_id: ctx.from.id.toString(),
    })
    .catch((err) => console.error("Sheets Sync Error (Confirm):", err));

  // 1. Update Accountant's message
  const originalText = ctx.callbackQuery.message.text;
  const safeText = escapeHTML(originalText);
  const status = "✅ <b>TRANSFER COMPLETED</b>";
  const newText = safeText + `\n\n${status}`;

  try {
    await ctx.editMessageText(newText, { parse_mode: "HTML" });
  } catch (e) {
    await ctx.editMessageText(originalText + `\n\nTRANSFER COMPLETED`);
  }

  // 2. Notify BOTH Managers
  const notification = `✅ Payment of <b>${amount}</b> to <b>${recipient}</b> has been <b>Transferred</b> by ${accountantName}.`;
  await bot.telegram.sendMessage(manager1Id, notification, {
    parse_mode: "HTML",
  });
  if (manager2Id) {
    await bot.telegram.sendMessage(manager2Id, notification, {
      parse_mode: "HTML",
    });
  }
});

// --- Scheduled Reminders (Daily at 9:00 AM) ---
cron.schedule("0 9 * * *", async () => {
  console.log("[CRON] Running daily reminder check...");
  await checkAndSendReminders(bot, AUTHORIZED_IDS);
});

// --- Manual Reminder Command (For Testing/Admin) ---
bot.command("remind_pending", async (ctx) => {
  const userId = ctx.from.id.toString();
  // Simple check: Only authorized managers/accountant can trigger reminders
  if (Object.values(AUTHORIZED_IDS).includes(userId)) {
    await ctx.reply("🔍 Checking for pending requests that need reminders...");
    await checkAndSendReminders(bot, AUTHORIZED_IDS);
    await ctx.reply("✅ Reminder check completed.");
  }
});

bot.launch();

console.log("Bot is running...");

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

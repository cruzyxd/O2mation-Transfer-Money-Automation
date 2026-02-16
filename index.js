import { Telegraf, Markup } from 'telegraf';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

if (!process.env.BOT_TOKEN) {
  console.error('Error: BOT_TOKEN is missing in .env');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY is missing in .env');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-memory store for conversation context (for demonstration)
const userContexts = {};
// Store pending requests to track them across different actors
const pendingRequests = {};
// Store user action states (e.g. waiting for decline reason)
const actionState = {};

const VALIDATION_SYSTEM_PROMPT = `
You are a transaction validation assistant. Your goal is to extract three specific pieces of information from the user's input:
1. Amount (how much is being paid)
2. Recipient (who is it being paid for)
3. Item/Service (what is being bought)

Analyze the user's input.
Output strictly valid JSON in the following format. Do not add markdown formatting like \`\`\`json.

If ALL 3 pieces of information are present and clear:
{
  "complete": true,
  "data": {
    "amount": "extracted amount",
    "recipient": "extracted recipient",
    "item": "extracted item"
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
  actionState[ctx.chat.id] = null; // Clear action state
  ctx.reply('Welcome Manager! Describe a payment request (Amount, Who, What) and I will process it.');
});

bot.on('text', async (ctx) => {
  const userId = ctx.chat.id;
  const userMessage = ctx.message.text;

  // Check if we are waiting for a reason from this user
  if (actionState[userId]) {
    const { requestId, messageIdToEdit, originalText, type } = actionState[userId];
    const request = pendingRequests[requestId];

    if (!request) {
      await ctx.reply("Request expired or not found.");
      delete actionState[userId];
      return;
    }

    const { manager1Id, manager2Id, data } = request;
    const reason = userMessage;
    const safeText = escapeHTML(originalText);

    if (type === 'AWAITING_DECLINE_REASON') {
      // 1. Update Manager 2's original request message to show Declined status
      const newText = safeText + `\n\n❌ <b>DECLINED</b>\nReason: <i>${escapeHTML(reason)}</i>`;
      
      try {
        await bot.telegram.editMessageText(userId, messageIdToEdit, undefined, newText, { parse_mode: 'HTML' });
      } catch (e) {
        console.error("Error updating Manager 2 message:", e);
      }

      // 2. Notify Manager 1
      const notificationToManager1 = `❌ Your request for <b>${data.amount}</b> to <b>${data.recipient}</b> has been <b>DECLINED</b> by Manager 2.\n\n<b>Reason:</b> ${escapeHTML(reason)}`;
      await bot.telegram.sendMessage(manager1Id, notificationToManager1, { parse_mode: 'HTML' });
      
      await ctx.reply("Reason sent. Request declined.");
      delete pendingRequests[requestId];
    } 
    else if (type === 'AWAITING_ISSUE_REASON') {
      // 1. Update Accountant's message
      const newText = safeText + `\n\n⚠️ <b>ISSUE REPORTED</b>\nReason: <i>${escapeHTML(reason)}</i>`;
      
      try {
        await bot.telegram.editMessageText(userId, messageIdToEdit, undefined, newText, { parse_mode: 'HTML' });
      } catch (e) {
        console.error("Error updating Accountant message:", e);
      }

      // 2. Notify BOTH Managers
      const notification = `⚠️ Accountant reported an issue for the request: <b>${data.amount}</b> to <b>${data.recipient}</b>.\n\n<b>Reason:</b> ${escapeHTML(reason)}`;
      await bot.telegram.sendMessage(manager1Id, notification, { parse_mode: 'HTML' });
      if (manager2Id) {
        await bot.telegram.sendMessage(manager2Id, notification, { parse_mode: 'HTML' });
      }
      
      await ctx.reply("Issue reported to both managers.");
      delete pendingRequests[requestId];
    }

    // Clear state
    delete actionState[userId];
    return; // Stop processing, don't go to AI
  }

  // Initialize context if not exists
  if (!userContexts[userId]) userContexts[userId] = [];

  // Add user message to history
  userContexts[userId].push({ role: 'user', content: userMessage });

  ctx.sendChatAction('typing');

  try {
    // We send the history to the AI so it remembers previous details provided
    const chatHistory = userContexts[userId].map(msg => msg.content).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: { responseMimeType: 'application/json' },
      contents: [
        { role: 'user', parts: [{ text: VALIDATION_SYSTEM_PROMPT }] },
        { role: 'user', parts: [{ text: `Current Conversation Context:\n${chatHistory}` }] }
      ],
    });

    const resultText = response.text;
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
      pendingRequests[requestId] = {
        manager1Id: userId,
        data: result.data
      };

      // Clear context after success
      userContexts[userId] = [];

      // Format message for Manager 2
      const manager2Message = `
🔔 <b>New Payment Request</b>

👤 <b>Who:</b> ${result.data.recipient}
💰 <b>Amount:</b> ${result.data.amount}
🛒 <b>Item:</b> ${result.data.item}

Please review this request.
      `;

      // In a real app, you would send this to the second manager's Chat ID.
      // For this demo, we send it back to you.
      await ctx.reply("🔄 <i>Routing request to Manager 2 for approval...</i>", { parse_mode: 'HTML' });
      
      await ctx.reply(manager2Message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Accept', `accept_${requestId}`),
          Markup.button.callback('❌ Decline', `decline_${requestId}`)
        ])
      });

    } else {
      // Ask for missing info
      userContexts[userId].push({ role: 'model', content: result.message });
      await ctx.reply(result.message);
    }

  } catch (error) {
    console.error('Error generating response:', error);
    await ctx.reply('Sorry, I encountered an error while processing your request.');
  }
});

// Helper to escape HTML characters
const escapeHTML = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Action handlers for the buttons
bot.action(/^(accept|decline)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const requestId = ctx.match[2];
  const request = pendingRequests[requestId];

  if (!request) {
    return ctx.answerCbQuery('Request not found or already processed.');
  }

  const { manager1Id, data } = request;

  if (action === 'decline') {
    // 1. Acknowledge callback
    await ctx.answerCbQuery('Please provide a reason.');
    
    // 2. Set user state to waiting for reason
    actionState[ctx.from.id] = {
      type: 'AWAITING_DECLINE_REASON',
      requestId: requestId,
      messageIdToEdit: ctx.callbackQuery.message.message_id,
      originalText: ctx.callbackQuery.message.text
    };

    // 3. Send ForceReply message to focus user's input
    await ctx.reply(`Declining request for ${data.recipient}. Please provide a reason:`, Markup.forceReply());
    return;
  }

  // Handle ACCEPT case (Immediate approval)
  const isApproved = true;

  await ctx.answerCbQuery('Request Accepted');
  
  // 1. Store Manager 2's ID in the request object for later notification by accountant
  request.manager2Id = ctx.from.id;

  // 1. Update Manager 2's message
  const originalText = ctx.callbackQuery.message.text;
  const safeText = escapeHTML(originalText);
  const status = '✅ <b>APPROVED</b>';
  const newText = safeText + `\n\n${status}`;
  
  try {
    await ctx.editMessageText(newText, { parse_mode: 'HTML' });
  } catch (e) {
    await ctx.editMessageText(originalText + `\n\nAPPROVED`);
  }

  // 2. Notify Manager 1
  const notificationToManager1 = `✅ Your request for <b>${data.amount}</b> to <b>${data.recipient}</b> has been <b>APPROVED</b> by Manager 2.`;
  await bot.telegram.sendMessage(manager1Id, notificationToManager1, { parse_mode: 'HTML' });

  // 3. Notify Accountant
  const accountantMessage = `
💼 <b>Payment Instruction for Accountant</b>

The following request has been approved and is ready for payment:

💰 <b>Amount:</b> ${data.amount}
👤 <b>Recipient:</b> ${data.recipient}
🛒 <b>Item:</b> ${data.item}

Please confirm the payment or report an issue.
  `;
    
  // In a real app, send to accountant's ID. Here we send to the same chat for demo.
  await bot.telegram.sendMessage(ctx.chat.id, "🔄 <i>Routing to Accountant...</i>", { parse_mode: 'HTML' });
  await bot.telegram.sendMessage(ctx.chat.id, accountantMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Confirm', `confirm_acc_${requestId}`),
        Markup.button.callback('⚠️ Issue', `issue_acc_${requestId}`)
      ]
    ])
  });

  // NOTE: We do NOT delete pendingRequests[requestId] here anymore because the accountant needs it.
});

// Action handlers for Accountant buttons
bot.action(/^(confirm_acc|issue_acc)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const requestId = ctx.match[2];
  const request = pendingRequests[requestId];

  if (!request) {
    return ctx.answerCbQuery('Request not found or already processed.');
  }

  const { manager1Id, manager2Id, data } = request;

  if (action === 'issue_acc') {
    await ctx.answerCbQuery('Please report the issue.');
    
    actionState[ctx.from.id] = {
      type: 'AWAITING_ISSUE_REASON',
      requestId: requestId,
      messageIdToEdit: ctx.callbackQuery.message.message_id,
      originalText: ctx.callbackQuery.message.text
    };

    await ctx.reply(`Reporting issue for ${data.recipient} (${data.amount}). Please provide details/reason:`, Markup.forceReply());
    return;
  }

  // Handle CONFIRM case
  await ctx.answerCbQuery('Payment Confirmed');
  
  // 1. Update Accountant's message
  const originalText = ctx.callbackQuery.message.text;
  const safeText = escapeHTML(originalText);
  const status = '✅ <b>CONFIRMED BY ACCOUNTANT</b>';
  const newText = safeText + `\n\n${status}`;
  
  try {
    await ctx.editMessageText(newText, { parse_mode: 'HTML' });
  } catch (e) {
    await ctx.editMessageText(originalText + `\n\nCONFIRMED`);
  }

  // 2. Notify BOTH Managers
  const notification = `✅ Payment of <b>${data.amount}</b> to <b>${data.recipient}</b> has been <b>CONFIRMED</b> by the Accountant.`;
  await bot.telegram.sendMessage(manager1Id, notification, { parse_mode: 'HTML' });
  await bot.telegram.sendMessage(manager2Id, notification, { parse_mode: 'HTML' });

  // Clean up
  delete pendingRequests[requestId];
});

bot.launch();

console.log('Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

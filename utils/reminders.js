import db from './db.js';

export const checkAndSendReminders = async (bot, authorizedIds) => {
  const pendingRequests = db.getPendingForReminders();
  
  if (pendingRequests.length === 0) {
    console.log('[REMINDERS] No pending requests found for reminder.');
    return;
  }

  console.log(`[REMINDERS] Found ${pendingRequests.length} requests for reminder.`);

  for (const req of pendingRequests) {
    let targetUserId;
    let roleName;

    if (req.manager_status === 'PENDING') {
      // Cross-approval logic:
      // If requester was Manager A, remind Manager B.
      // Otherwise, remind Manager A.
      if (req.requester_id === authorizedIds.MANAGER_A) {
        targetUserId = authorizedIds.MANAGER_B;
      } else {
        targetUserId = authorizedIds.MANAGER_A;
      }
      roleName = 'Manager';
    } else if (req.accountant_status === 'PENDING') {
      targetUserId = authorizedIds.ACCOUNTANT;
      roleName = 'Accountant';
    }

    if (targetUserId) {
      const message = `
⏰ <b>PENDING REQUEST REMINDER</b>

This request has been waiting for more than 24 hours:

💰 <b>Amount:</b> ${req.amount}
👤 <b>Recipient:</b> ${req.recipient}
🛒 <b>Item:</b> ${req.item}
📅 <b>Requested:</b> ${new Date(req.timestamp).toLocaleString()}

Please take action on this request.
      `;

      try {
        await bot.telegram.sendMessage(targetUserId, message, { parse_mode: 'HTML' });
        db.updateReminderTimestamp(req.id);
        console.log(`[REMINDERS] Reminder sent for request ${req.id} to ${roleName} (${targetUserId})`);
      } catch (error) {
        console.error(`[REMINDERS] Error sending reminder for request ${req.id}:`, error);
      }
    }
  }
};

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'database.sqlite');

const db = new Database(dbPath);

export const init = () => {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      requester_id TEXT,
      recipient TEXT,
      amount TEXT,
      item TEXT,
      manager_status TEXT DEFAULT 'PENDING',
      manager_id TEXT,
      manager_reason TEXT,
      accountant_status TEXT DEFAULT 'PENDING',
      accountant_id TEXT,
      accountant_reason TEXT,
      updated_at TEXT,
      last_reminder_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_actions (
      message_id TEXT PRIMARY KEY,
      request_id TEXT,
      type TEXT,
      edit_message_id TEXT,
      original_text TEXT,
      user_id TEXT,
      created_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_request_edits (
      request_id TEXT PRIMARY KEY,
      message_id TEXT,
      text TEXT
    )
  `).run();

  try {
    db.prepare('ALTER TABLE requests ADD COLUMN updated_at TEXT').run();
  } catch (error) {
    // Ignore error if column already exists
  }

  try {
    db.prepare('ALTER TABLE requests ADD COLUMN last_reminder_at TEXT').run();
  } catch (error) {
    // Ignore error if column already exists
  }

  // Migration: Add created_at column if it doesn't exist
  try {
    db.prepare('ALTER TABLE pending_actions ADD COLUMN created_at TEXT').run();
  } catch (error) {
    // Ignore error if column already exists
  }
};

export const createRequest = (req) => {
  const stmt = db.prepare(`
    INSERT INTO requests (id, timestamp, requester_id, recipient, amount, item)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(req.id, req.timestamp, req.requester_id, req.recipient, req.amount, req.item);
};

export const savePendingAction = (action) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pending_actions (message_id, request_id, type, edit_message_id, original_text, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    action.message_id, 
    action.request_id, 
    action.type, 
    action.edit_message_id, 
    action.original_text, 
    action.user_id,
    new Date().toISOString()
  );
};

export const getPendingAction = (messageId) => {
  const stmt = db.prepare('SELECT * FROM pending_actions WHERE message_id = ?');
  return stmt.get(messageId);
};

export const getPendingActionsByRequestId = (requestId) => {
  const stmt = db.prepare('SELECT * FROM pending_actions WHERE request_id = ?');
  return stmt.all(requestId);
};

export const deletePendingAction = (messageId) => {
  const stmt = db.prepare('DELETE FROM pending_actions WHERE message_id = ?');
  return stmt.run(messageId);
};

export const savePendingRequestEdit = (requestId, messageId, text) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO pending_request_edits (request_id, message_id, text)
    VALUES (?, ?, ?)
  `);
  return stmt.run(requestId, messageId, text);
};

export const getPendingRequestEdit = (requestId) => {
  const stmt = db.prepare('SELECT * FROM pending_request_edits WHERE request_id = ?');
  return stmt.get(requestId);
};

export const deletePendingRequestEdit = (requestId) => {
  const stmt = db.prepare('DELETE FROM pending_request_edits WHERE request_id = ?');
  return stmt.run(requestId);
};

export const updateManager = (id, status, reason, managerId) => {
  const stmt = db.prepare(`
    UPDATE requests 
    SET manager_status = ?, manager_reason = ?, manager_id = ?, updated_at = ?
    WHERE id = ?
  `);
  return stmt.run(status, reason, managerId, new Date().toISOString(), id);
};

export const updateAccountant = (id, status, reason, accId) => {
  const stmt = db.prepare(`
    UPDATE requests 
    SET accountant_status = ?, accountant_reason = ?, accountant_id = ?, updated_at = ?
    WHERE id = ?
  `);
  return stmt.run(status, reason, accId, new Date().toISOString(), id);
};

export const getRequest = (id) => {
  const stmt = db.prepare('SELECT * FROM requests WHERE id = ?');
  return stmt.get(id);
};

export const getPendingForReminders = () => {
  // Logic: 
  // 1. Manager PENDING for > 24h AND (never reminded OR last reminder > 24h)
  // 2. Accountant PENDING (Manager APPROVED) for > 24h AND (never reminded OR last reminder > 24h)
  const stmt = db.prepare(`
    SELECT * FROM requests 
    WHERE 
      (
        (manager_status = 'PENDING' AND (strftime('%s','now') - strftime('%s', timestamp) > 86400))
        OR 
        (manager_status = 'APPROVED' AND accountant_status = 'PENDING' AND (strftime('%s','now') - strftime('%s', updated_at) > 86400))
      )
      AND (last_reminder_at IS NULL OR (strftime('%s','now') - strftime('%s', last_reminder_at) > 86400))
  `);
  return stmt.all();
};

export const updateReminderTimestamp = (id) => {
  const stmt = db.prepare('UPDATE requests SET last_reminder_at = ? WHERE id = ?');
  return stmt.run(new Date().toISOString(), id);
};

export default {
  init,
  createRequest,
  updateManager,
  updateAccountant,
  getRequest,
  savePendingAction,
  getPendingAction,
  deletePendingAction,
  getPendingActionsByRequestId,
  savePendingRequestEdit,
  getPendingRequestEdit,
  deletePendingRequestEdit,
  getPendingForReminders,
  updateReminderTimestamp
};

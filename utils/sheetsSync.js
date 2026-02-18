import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the sheets.js script in the root .gemini directory
const SHEET_SCRIPT = path.join(__dirname, '..', '..', '.gemini', 'SKILLS', 'google-sheets', 'scripts', 'sheets.js');

/**
 * Executes the sheets.js CLI script with the given command and arguments using spawn.
 * This is safer for argument escaping than exec.
 */
async function callSheets(command, ...args) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') {
    console.warn('⚠️ sheetsSync: SPREADSHEET_ID is missing or placeholder. Skipping sync.');
    return null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn('node', [SHEET_SCRIPT, command, spreadsheetId, ...args]);
    
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ sheetsSync failed (${command}) with code ${code}:`, stderr);
        return resolve(null);
      }
      
      try {
        if (stdout.trim()) {
          resolve(JSON.parse(stdout));
        } else {
          resolve(true);
        }
      } catch (error) {
        // If it's not JSON, return the raw stdout if it's not empty, or true
        resolve(stdout.trim() || true);
      }
    });

    child.on('error', (err) => {
      console.error(`❌ sheetsSync spawn error (${command}):`, err.message);
      resolve(null);
    });
  });
}

/**
 * Appends a new request row to the Google Sheet.
 * @param {Object} req - The request object from the DB
 */
export async function appendRow(req) {
  try {
    const row = [
      req.id,
      req.timestamp,
      req.requester_id,
      req.recipient,
      req.amount,
      req.item,
      req.manager_status || 'PENDING',
      req.manager_id || '',
      req.manager_reason || '',
      req.accountant_status || 'PENDING',
      req.accountant_id || '',
      req.accountant_reason || ''
    ];

    return await callSheets('append', 'Sheet1!A:L', JSON.stringify([row]));
  } catch (error) {
    console.error('❌ sheetsSync: appendRow failed:', error.message);
    return null;
  }
}

/**
 * Finds the row index for a given request ID by reading Column A.
 * @param {string} id - The request ID to find
 * @returns {number|null} - The 1-based row index or null if not found
 */
export async function findRowIndex(id) {
  try {
    const data = await callSheets('read', 'Sheet1!A:A');
    if (!data || !Array.isArray(data)) return null;

    // Find the row index by comparing as strings
    const index = data.findIndex(row => row && String(row[0]) === String(id));
    
    return index !== -1 ? index + 1 : null;
  } catch (error) {
    console.error('❌ sheetsSync: findRowIndex failed:', error.message);
    return null;
  }
}

/**
 * Updates specific columns for a given request ID.
 * @param {string} id - Request ID
 * @param {Object} dataMap - Map of column names to values
 */
export async function updateCells(id, dataMap) {
  try {
    const rowIndex = await findRowIndex(id);
    if (!rowIndex) {
      console.warn(`⚠️ sheetsSync: Could not find row for ID ${id}`);
      return null;
    }

    const COL_MAP = {
      manager_status: 'G',
      manager_id: 'H',
      manager_reason: 'I',
      accountant_status: 'J',
      accountant_id: 'K',
      accountant_reason: 'L'
    };

    const updates = [];
    for (const [key, value] of Object.entries(dataMap)) {
      const col = COL_MAP[key];
      if (col) {
        const range = `Sheet1!${col}${rowIndex}`;
        updates.push(callSheets('write', range, JSON.stringify([[value]])));
      }
    }

    return await Promise.all(updates);
  } catch (error) {
    console.error('❌ sheetsSync: updateCells failed:', error.message);
    return null;
  }
}

export default {
  appendRow,
  updateCells,
  findRowIndex
};

import 'dotenv/config';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Correct relative path from scripts/ to .gemini/SKILLS/...
const SHEET_SCRIPT = path.join(__dirname, '..', '..', '.gemini', 'SKILLS', 'google-sheets', 'scripts', 'sheets.js');

const HEADERS = [
  'id', 
  'timestamp', 
  'requester_id', 
  'recipient', 
  'amount', 
  'item', 
  'manager_status', 
  'manager_id', 
  'manager_reason', 
  'accountant_status', 
  'accountant_id', 
  'accountant_reason'
];

async function callSheets(command, ...args) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
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
        return reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : true);
      } catch (e) {
        resolve(stdout.trim());
      }
    });
  });
}

async function main() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const forceClear = process.argv.includes('--clear');

  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') {
    console.error('❌ Error: SPREADSHEET_ID is missing or set to placeholder in .env');
    process.exit(1);
  }

  console.log(`🔍 Initializing Spreadsheet ID: ${spreadsheetId}...`);

  try {
    if (forceClear) {
      console.log('🧹 Force clearing Sheet1...');
      await callSheets('clear', 'Sheet1!A1:Z100');
    }

    // Read the first row to check if headers exist
    const existingData = await callSheets('read', 'Sheet1!A1:L1');

    if (!forceClear && existingData && Array.isArray(existingData) && existingData.length > 0 && existingData[0].length > 0 && existingData[0][0] === 'id') {
      console.log('✅ Headers already exist.');
      console.log('Current headers:', existingData[0]);
    } else {
      if (!forceClear) {
        console.log('⚠️ Headers missing or invalid. Re-initializing...');
        await callSheets('clear', 'Sheet1!A1:Z100');
      }
      
      console.log('📝 Writing headers...');
      await callSheets('write', 'Sheet1!A1:L1', JSON.stringify([HEADERS]));
      
      console.log('✨ Formatting headers...');
      const formatOptions = {
        backgroundColor: { red: 200, green: 200, blue: 200 },
        textFormat: { bold: true },
        horizontalAlignment: 'CENTER'
      };
      await callSheets('format', 'Sheet1!A1:L1', JSON.stringify(formatOptions));
      await callSheets('freeze', 'Sheet1', '1', '0');
      
      console.log('✅ Sheet initialized successfully with headers.');
    }

  } catch (error) {
    console.error('❌ Error initializing sheet:', error.message);
    process.exit(1);
  }
}

main();

main();

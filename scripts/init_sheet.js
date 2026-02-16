import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

const SHEET_SCRIPT = path.join('.gemini', 'skills', 'google-sheets', 'scripts', 'sheets.js');
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

async function main() {
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') {
    console.error('❌ Error: SPREADSHEET_ID is missing or set to placeholder in .env');
    process.exit(1);
  }

  console.log(`Checking headers for Spreadsheet ID: ${spreadsheetId}...`);

  try {
    // Read the first row to check if headers exist
    // Using double quotes for the command arguments to handle paths with spaces if necessary
    // But here paths are relative and simple.
    const { stdout } = await execAsync(`node "${SHEET_SCRIPT}" read "${spreadsheetId}" "Sheet1!A1:L1"`);
    
    let existingData;
    try {
      existingData = JSON.parse(stdout);
    } catch (e) {
      console.error('Error parsing response from sheets script:', stdout);
      process.exit(1);
    }

    if (existingData && existingData.length > 0 && existingData[0].length > 0) {
      console.log('✅ Headers already exist.');
      console.log('Current headers:', existingData[0]);
    } else {
      console.log('⚠️ Headers missing. Writing headers...');
      
      const headersJson = JSON.stringify([HEADERS]);
      // Escape quotes for the shell command
      // On Windows (cmd), we might need different escaping, but exec usually handles basic args.
      // However, passing JSON string as arg can be tricky.
      // Let's try to pass it carefully. 
      // We wrap the JSON in single quotes for the shell.
      
      // On Windows, single quotes might not work as expected in all shells, but node should handle it if passed correctly.
      // Actually, for cross-platform compatibility, it's safer to use double quotes around the argument and escape internal double quotes.
      const escapedJson = headersJson.replace(/"/g, '"');
      
      const writeCmd = `node "${SHEET_SCRIPT}" write "${spreadsheetId}" "Sheet1!A1:L1" "${escapedJson}"`;
      
      const { stdout: writeOut } = await execAsync(writeCmd);
      console.log('✅ Headers written successfully.');
      console.log(writeOut);
    }

  } catch (error) {
    console.error('❌ Error initializing sheet:', error.message);
    if (error.stderr) console.error('Stderr:', error.stderr);
    process.exit(1);
  }
}

main();

import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the sheets.js script in the root .gemini directory
const SHEET_SCRIPT = path.join(__dirname, '..', '..', '.gemini', 'SKILLS', 'google-sheets', 'scripts', 'sheets.js');

async function testConnection() {
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!spreadsheetId || spreadsheetId === 'YOUR_SPREADSHEET_ID_HERE') {
    console.error('❌ Error: SPREADSHEET_ID is missing or set to placeholder in .env');
    process.exit(1);
  }

  console.log(`🔍 Testing connection for Spreadsheet ID: ${spreadsheetId}...`);

  try {
    // Attempt to get spreadsheet info
    const { stdout, stderr } = await execAsync(`node "${SHEET_SCRIPT}" info "${spreadsheetId}"`);
    
    if (stderr && !stdout) {
      console.error('❌ Connection test failed with stderr:', stderr);
    } else {
      const info = JSON.parse(stdout);
      console.log('✅ Connection successful!');
      console.log('Spreadsheet Title:', info.properties.title);
      console.log('Sheets found:', info.sheets.map(s => s.properties.title).join(', '));
    }

  } catch (error) {
    console.error('❌ Connection test failed!');
    console.error('Error message:', error.message);
    if (error.stderr) {
      console.error('Stderr details:', error.stderr);
    }
    process.exit(1);
  }
}

testConnection();

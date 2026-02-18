import 'dotenv/config';

// --- Role and Routing Configuration ---
const AUTHORIZED_IDS = {
  MANAGER_A: process.env.MANAGER_A_ID,
  MANAGER_B: process.env.MANAGER_B_ID,
  ACCOUNTANT: process.env.ACCOUNTANT_ID
};

console.log('--- Configuration Check ---');
console.log('AUTHORIZED_IDS:', AUTHORIZED_IDS);

// Mock Middleware Logic
async function mockMiddleware(ctx, next) {
  const userId = ctx.chat?.id.toString() || ctx.from?.id.toString();
  console.log(`
Testing User ID: ${userId}`);
  
  const isAuthorized = Object.values(AUTHORIZED_IDS).includes(userId);
  console.log(`Is Authorized: ${isAuthorized}`);

  if (!isAuthorized) {
    console.log('Result: Silent Ignore (Middleware returned without calling next)');
    return;
  }
  
  console.log('Result: Success (next() called)');
  return next();
}

// Test Cases
async function runTests() {
  // Test 1: Your ID (Should Pass)
  const myContext = {
    chat: { id: 1607541246 },
    from: { id: 1607541246 }
  };
  
  await mockMiddleware(myContext, () => console.log('>>> NEXT FUNCTION EXECUTED <<<'));

  // Test 2: Random ID (Should Fail)
  const randomContext = {
    chat: { id: 99999999 },
    from: { id: 99999999 }
  };
  
  await mockMiddleware(randomContext, () => console.log('>>> NEXT FUNCTION EXECUTED <<<'));
}

runTests();

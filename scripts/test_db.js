import db from '../utils/db.js';

try {
  console.log('Initializing database...');
  db.init();
  console.log('Database initialized.');

  const testRequest = {
    id: 'test-' + Date.now(),
    timestamp: new Date().toISOString(),
    requester_id: '12345',
    recipient: 'John Doe',
    amount: '100 USD',
    item: 'Test Item'
  };

  console.log('Inserting test request:', testRequest.id);
  db.createRequest(testRequest);

  console.log('Fetching test request...');
  const fetched = db.getRequest(testRequest.id);

  if (fetched && fetched.id === testRequest.id) {
    console.log('Success: Request retrieved correctly.');
    console.log('Data:', fetched);
  } else {
    console.error('Failure: Could not retrieve request or data mismatch.');
    process.exit(1);
  }

  console.log('Testing updateManager...');
  db.updateManager(testRequest.id, 'APPROVED', 'Looks good', 'manager-99');
  const updated = db.getRequest(testRequest.id);
  
  if (updated.manager_status === 'APPROVED' && updated.manager_id === 'manager-99') {
    console.log('Success: Manager update verified.');
  } else {
    console.error('Failure: Manager update failed.');
    process.exit(1);
  }

} catch (error) {
  console.error('Database test failed:', error);
  process.exit(1);
}

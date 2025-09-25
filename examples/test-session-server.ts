/**
 * Test the Session Server functionality
 */

import { SessionClient } from '../src/testing/websocket-api';
import { ConnectomeTestingMCP } from '../src/testing/mcp-server';

async function testBasicFunctionality() {
  console.log('🧪 Testing Session Server Basic Functionality\n');
  
  const client = new SessionClient();
  
  try {
    // Create a test session
    console.log('1. Creating session...');
    const { sessionId } = await client.createSession({
      id: 'test-basic',
      cwd: process.cwd()
    });
    console.log(`✅ Created session: ${sessionId}`);
    
    // Execute some commands
    console.log('\n2. Running commands...');
    const result1 = await client.exec(sessionId, 'echo "Hello from persistent session"');
    console.log(`Output: ${result1.output.trim()}`);
    
    // Test persistence
    await client.exec(sessionId, 'export TEST_VAR="I persist!"');
    const result2 = await client.exec(sessionId, 'echo $TEST_VAR');
    console.log(`Persistent var: ${result2.output.trim()}`);
    
    // Search logs
    console.log('\n3. Searching logs...');
    const matches = await client.searchLogs(sessionId, 'persist', 2);
    console.log(`Found ${matches.length} matches`);
    matches.forEach((m: any) => {
      console.log(`  Line ${m.lineNumber}: ${m.line}`);
    });
    
    // List sessions
    console.log('\n4. Active sessions:');
    const sessions = await client.listSessions();
    sessions.forEach((s: any) => {
      console.log(`  - ${s.id} (PID: ${s.pid})`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.close();
  }
}

async function testMCPInterface() {
  console.log('\n\n🤖 Testing MCP Interface\n');
  
  const mcp = new ConnectomeTestingMCP();
  
  try {
    // Start a service with monitoring
    console.log('1. Starting HTTP server...');
    const result = await mcp.startService({
      name: 'test-http',
      command: 'python3 -m http.server 8888',
      readyPatterns: ['Serving HTTP', 'port 8888'],
      errorPatterns: ['Error', 'Address already in use']
    });
    
    console.log(`Status: ${result.status}`);
    console.log('Startup logs:');
    result.logs.forEach((log: string) => console.log(`  ${log}`));
    
    // Run test scenario
    console.log('\n2. Running test scenario...');
    const testResult = await mcp.runTest({
      name: 'env-test',
      setup: [
        'export NODE_ENV=test',
        'export API_KEY=secret123'
      ],
      test: 'echo "NODE_ENV=$NODE_ENV API_KEY=$API_KEY"'
    });
    
    console.log(`Test ${testResult.success ? 'PASSED' : 'FAILED'}`);
    console.log('Output:');
    console.log(testResult.output);
    
    // List all sessions
    console.log('\n3. All sessions:');
    const sessions = await mcp.listSessions();
    sessions.forEach((s: any) => {
      console.log(`  - ${s.name || s.id} (alive: ${s.isAlive})`);
    });
    
    // Clean up
    console.log('\n4. Cleaning up...');
    await mcp.killSession({ session: 'test-http' });
    console.log('✅ Service stopped');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════╗
║         Session Server Test Suite             ║
╚═══════════════════════════════════════════════╝

Make sure the session server is running:
npm run session-server
`);
  
  // Give server a moment to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await testBasicFunctionality();
  await testMCPInterface();
  
  console.log('\n✅ All tests complete!');
  process.exit(0);
}

main().catch(console.error);

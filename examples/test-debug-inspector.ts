/**
 * Test Debug Inspector Integration
 * Demonstrates the debug server with the new attribution system
 */

import { 
  Space,
  VEILStateManager,
  AgentElement,
  BasicAgent,
  MockLLMProvider,
  DebugServer
} from '../src';
import { ConsoleInputReceptor, ConsoleOutputEffector } from '../src/components/console-receptors';
import { ContextTransform } from '../src/hud/context-transform';
import { AgentEffector } from '../src/agent/agent-effector';

async function main() {
  console.log('=== Debug Inspector Test ===\n');
  
  // Create fresh VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Start debug server
  const debugServer = new DebugServer(space, {
    enabled: true,
    port: 8890,
    host: '127.0.0.1',
    maxFrames: 100 // Keep it small for testing
  });
  debugServer.start();
  
  console.log('🔍 Debug UI available at http://localhost:8890');
  console.log('Connect with inspector tools to port 8890\n');
  
  // Set up simple mock agent
  const provider = new MockLLMProvider();
  provider.addResponse('hello', 'Hello! I can see you through the debug inspector.');
  provider.addResponse('test', 'Testing the new attribution system!');
  provider.addResponse('agent', 'I am an AgentElement with proper source attribution.');
  
  const agent = new BasicAgent({
    config: {
      name: 'DebugTestAgent',
      systemPrompt: 'You are a test agent for the debug inspector.'
    },
    provider: provider,
    veilStateManager: veilState
  });
  
  // Set up pipeline
  space.addReceptor(new ConsoleInputReceptor());
  space.addTransform(new ContextTransform(veilState));
  
  // Create agent element with proper identification
  const agentElement = new AgentElement('DebugTestAgent', 'debug-test-agent');
  space.addChild(agentElement);
  
  space.addEffector(new AgentEffector(agentElement, agent));
  space.addEffector(new ConsoleOutputEffector((content) => {
    console.log(`[Agent]: ${content}`);
  }));
  
  console.log('Pipeline ready! Sending test messages...\n');
  
  // Send some test messages
  const testMessages = ['hello', 'test attribution', 'check agent element'];
  
  for (const msg of testMessages) {
    console.log(`[User]: ${msg}`);
    
    // Emit console input event
    space.emit({
      topic: 'console:input',
      source: { elementId: 'console', elementPath: ['console'] },
      timestamp: Date.now(),
      payload: { input: msg }
    });
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n✅ Test messages sent. Use inspector tools to examine:');
  console.log('- Frame attribution (user vs agent)');
  console.log('- Event sources with proper element types');
  console.log('- AgentElement identification in events');
  console.log('\nKeeping server running for inspection...');
  
  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    debugServer.stop();
    process.exit(0);
  });
}

main().catch(console.error);


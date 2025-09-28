/**
 * Correct test demonstrating rendered context capture using VEILComponent
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { AgentComponent } from '../agent/agent-component';
import { BasicAgent } from '../agent/basic-agent';
import { Element } from '../spaces/element';
import { MockLLMProvider } from '../llm/mock-llm-provider';
import { VEILComponent } from '../components/base-components';

// Component that generates a test message using proper VEIL operations
class TestMessageComponent extends VEILComponent {
  async onFirstFrame() {
    console.log('📝 Adding test message using VEILComponent methods...');
    
    // Add a test message facet
    this.addFacet({
      type: 'event',
      id: 'test-message-1',
      displayName: 'User Message',
      content: 'Hello agent! What time is it?',
      attributes: {
        sender: 'test-user',
        timestamp: new Date().toISOString()
      }
    });
    
    // Activate the agent
    this.addFacet({
      id: 'agent-activation-test-1',
      type: 'agent-activation',
      content: 'User sent a message',
      attributes: {
        source: 'test',
        priority: 'high',
        reason: 'User sent a message'
      }
    });
    
    console.log('✅ Message and activation added to current frame');
  }
}

async function testRenderedContext() {
  console.log('🔍 Testing rendered context capture for debug UI...\n');
  
  // Create the system
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Enable debug server
  space.enableDebugServer({ port: 4000 });
  console.log('✅ Debug server enabled at http://localhost:4000\n');
  
  // Create mock LLM provider
  const llmProvider = new MockLLMProvider();
  llmProvider.addResponse(
    'hello',
    'Hello! The current time is ' + new Date().toLocaleTimeString() + '. How can I help you today?'
  );
  
  // Create agent
  const agent = new BasicAgent({
    name: 'test-agent',
    systemPrompt: `You are a helpful test agent. Always include the current time in your responses.`,
    tools: []
  }, llmProvider, veilState);
  
  // Create agent element with component
  const agentElement = new Element('agent');
  agentElement.addComponent(new AgentComponent(agent));
  space.addChild(agentElement);
  
  // Create test message element
  const testElement = new Element('test-messenger');
  testElement.addComponent(new TestMessageComponent());
  // Important: Subscribe to frame:start so component receives it
  testElement.subscribe('frame:start');
  space.addChild(testElement);
  
  console.log('🚀 Starting the system...\n');
  
  // Start by queuing any event to trigger frame processing
  space.queueEvent({
    topic: 'start',
    source: { elementId: 'test', elementPath: [] },
    payload: {},
    timestamp: Date.now()
  });
  
  // Wait for frames to process
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n✅ Test complete!');
  console.log('📊 Open http://localhost:4000 in your browser to see:');
  console.log('   - Frame #1: The start event and element mounts');
  console.log('   - Frame #2: Contains the user message facet and agent activation');
  console.log('   - In Frame #2, look for "Rendered Context" section');
  console.log('   - Frame #3: The agent\'s response (outgoing frame)\n');
  
  console.log('The rendered context shows:');
  console.log('   - The messages array with user/assistant format');
  console.log('   - Token counts and metadata');
  console.log('   - Exactly what was sent to the LLM\n');
  
  console.log('Keep this running to explore the debug UI');
  console.log('Press Ctrl+C to exit...\n');
  
  // Keep running
  await new Promise(() => {});
}

// Run the test
testRenderedContext().catch(console.error);

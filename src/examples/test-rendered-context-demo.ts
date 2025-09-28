/**
 * Demo showing both incoming and outgoing rendered context capture
 */

import { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import { AgentComponent } from '../agent/agent-component';
import { BasicAgent } from '../agent/basic-agent';
import { Element } from '../spaces/element';
import { MockLLMProvider } from '../llm/mock-llm-provider';
import { VEILComponent } from '../components/base-components';

// Component that generates test messages
class TestChatComponent extends VEILComponent {
  private messageCount = 0;
  
  async onFirstFrame() {
    // Send first message
    this.sendMessage("Hello! What's 2+2?");
  }
  
  private sendMessage(content: string) {
    this.messageCount++;
    
    console.log(`📝 User: ${content}`);
    
    // Add message facet
    this.addFacet({
      type: 'event',
      id: `user-message-${this.messageCount}`,
      displayName: 'User',
      content,
      attributes: {
        sender: 'test-user',
        timestamp: new Date().toISOString()
      }
    });
    
    // Activate agent
    this.addFacet({
      id: 'agent-activation-demo-1',
      type: 'agent-activation',
      content: 'User sent a message',
      attributes: {
        source: 'user',
        priority: 'high',
        reason: 'User sent a message'
      }
    });
  }
}

async function demoRenderedContext() {
  console.log('🔍 Demonstrating Rendered Context Capture\n');
  console.log('This demo shows:');
  console.log('1. Incoming frames: What was sent TO the LLM');
  console.log('2. Outgoing frames: What came back FROM the LLM\n');
  
  // Create system
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Enable debug server
  space.enableDebugServer({ port: 4000 });
  console.log('✅ Debug server: http://localhost:4000\n');
  
  // Create mock LLM with various responses
  const llmProvider = new MockLLMProvider();
  llmProvider.addResponse(
    '2+2',
    '2+2 equals 4! Is there anything else you\'d like to calculate?'
  );
  llmProvider.addResponse(
    'hello',
    'Hello there! I\'m your helpful assistant. How can I help you today?'
  );
  
  // Create agent
  const agent = new BasicAgent({
    name: 'math-assistant',
    systemPrompt: `You are a helpful math assistant. Answer questions clearly and concisely.`,
    tools: []
  }, llmProvider, veilState);
  
  // Set up agent element
  const agentElement = new Element('agent');
  agentElement.addComponent(new AgentComponent(agent));
  space.addChild(agentElement);
  
  // Set up chat element
  const chatElement = new Element('chat');
  chatElement.addComponent(new TestChatComponent());
  chatElement.subscribe('frame:start');
  space.addChild(chatElement);
  
  console.log('🚀 Starting conversation...\n');
  
  // Start processing
  space.queueEvent({
    topic: 'start',
    source: { elementId: 'demo', elementPath: [] },
    payload: {},
    timestamp: Date.now()
  });
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n✅ Demo complete!\n');
  console.log('📊 Open http://localhost:4000 to explore:');
  console.log('\n   Incoming Frame (what was sent TO the LLM):');
  console.log('   - Look for "Rendered Context" section');
  console.log('   - Contains: messages array with user/assistant format');
  console.log('   - Shows: system prompt + user message');
  console.log('\n   Outgoing Frame (what came back FROM the LLM):');
  console.log('   - Look for "Rendered Context" section');
  console.log('   - Contains: raw LLM completion');
  console.log('   - Shows: content, token count, provider, timestamp\n');
  
  console.log('This gives complete visibility into the LLM interaction!');
  console.log('Press Ctrl+C to exit...\n');
  
  // Keep running
  await new Promise(() => {});
}

// Run demo
demoRenderedContext().catch(console.error);

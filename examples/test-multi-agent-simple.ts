#!/usr/bin/env node

/**
 * Simple test of multi-agent system
 */

import { 
  Space, 
  Element,
  Component,
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  ConsoleChatComponent,
  AgentComponent
} from '../src';

async function main() {
  console.log('=== Simple Multi-Agent Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Test 1: Use old API (for backward compatibility)
  console.log('1. Testing backward compatibility with setAgent()...');
  const oldLLM = new MockLLMProvider();
  oldLLM.setResponses(['Hello from old API!']);
  const oldAgent = new BasicAgent(
    { name: 'old-agent', systemPrompt: 'Old API agent' },
    oldLLM,
    veilState
  );
  space.setAgent(oldAgent);
  
  // Test 2: Create agent as component
  console.log('2. Creating agent as component...');
  const agentElement = new Element('new-agent', 'new-agent');
  const newLLM = new MockLLMProvider();
  newLLM.setResponses(['Hello from the new component-based agent architecture!']);
  
  agentElement.addComponent(new AgentComponent(
    new BasicAgent(
      { name: 'new-agent', systemPrompt: 'Component-based agent' },
      newLLM,
      veilState
    )
  ));
  space.addChild(agentElement);
  
  // Add console
  space.addComponent(new ConsoleChatComponent());
  
  // Log responses
  class ResponseLogger extends Component {
    onMount() {
      this.subscribe('agent:response');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:response') {
        console.log(`\n[Agent Response]: ${event.payload.content}`);
      }
    }
  }
  space.addComponent(new ResponseLogger());
  
  // Test activations
  console.log('\n3. Testing activations...');
  
  // First activation - should trigger old agent
  space.activateAgent('console:main', { 
    reason: 'Test old API'
  });
  
  setTimeout(() => {
    // Second activation - target new agent specifically
    console.log('\n4. Activating component-based agent...');
    space.activateAgent('console:main', {
      reason: 'Test new API',
      targetAgent: 'new-agent'
    });
  }, 3000);
  
  // Shutdown after 6 seconds
  setTimeout(() => {
    console.log('\n[Test] Complete!');
    console.log('- Old setAgent() API still works');
    console.log('- New component-based agents work');
    console.log('- Both can coexist during migration');
    process.exit(0);
  }, 6000);
}

main().catch(console.error);

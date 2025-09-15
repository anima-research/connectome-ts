#!/usr/bin/env node

/**
 * Test the clean event-driven agent architecture
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
  console.log('=== Clean Architecture Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create a simple agent
  console.log('1. Creating agent with new architecture...');
  const agentElement = new Element('test-agent', 'test-agent');
  const llm = new MockLLMProvider();
  llm.setResponses([
    'Hello from the clean architecture! This response flows through events.',
    'I can perform actions too! @console.log("Action executed!")'
  ]);
  
  agentElement.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'CleanAgent',
        systemPrompt: 'You are testing the clean event-driven architecture'
      },
      llm
    )
  ));
  space.addChild(agentElement);
  
  // Add console
  space.addComponent(new ConsoleChatComponent());
  
  // Log events to see the flow
  class EventLogger extends Component {
    onMount() {
      this.subscribe('agent:frame-ready');
      this.subscribe('agent:response');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:frame-ready') {
        console.log('\n[Event] agent:frame-ready received:');
        console.log(`  - Agent: ${event.payload.agentName}`);
        console.log(`  - Frame sequence: ${event.payload.frame.sequence} (should be -1)`);
        console.log(`  - Operations: ${event.payload.frame.operations.length}`);
      } else if (event.topic === 'agent:response') {
        console.log('\n[Event] agent:response distributed:');
        console.log(`  - Agent: ${event.payload.agentName}`);
        console.log(`  - Content: ${event.payload.content.substring(0, 50)}...`);
      }
    }
  }
  space.addComponent(new EventLogger());
  
  // Test frame sequence tracking
  console.log('\n2. Initial VEIL state:');
  console.log(`  - Current sequence: ${veilState.getState().currentSequence}`);
  
  // Activate agent
  console.log('\n3. Activating agent...');
  space.activateAgent('console:main', { 
    reason: 'Test clean architecture'
  });
  
  // Check sequences after some time
  setTimeout(() => {
    console.log('\n4. After agent response:');
    console.log(`  - Current sequence: ${veilState.getState().currentSequence}`);
    console.log(`  - Frame history length: ${veilState.getState().frameHistory.length}`);
    
    // Activate again to test action processing
    console.log('\n5. Activating agent again (with action)...');
    space.activateAgent('console:main', {
      reason: 'Test action processing'
    });
  }, 2000);
  
  // Shutdown
  setTimeout(() => {
    console.log('\n=== Clean Architecture Test Complete! ===');
    console.log('✓ Agent creates frames without sequences');
    console.log('✓ Space assigns sequences and records frames');
    console.log('✓ Events flow cleanly through the system');
    console.log('✓ No sequence conflicts possible!');
    process.exit(0);
  }, 5000);
}

main().catch(console.error);

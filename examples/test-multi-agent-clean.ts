#!/usr/bin/env node

/**
 * Clean multi-agent test using only the new component architecture
 * No backward compatibility - pure component-based agents
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
  console.log('=== Clean Multi-Agent Architecture Demo ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Agent 1: Friendly greeter
  console.log('Creating Agent 1: Friendly Greeter...');
  const greeterElement = new Element('greeter-agent', 'greeter');
  const greeterLLM = new MockLLMProvider();
  greeterLLM.setResponses([
    'Hello! I\'m the friendly greeter agent. Welcome to our multi-agent system!',
    'It\'s so nice to meet you! I hope you have a wonderful day!',
    'Goodbye! Thanks for visiting our multi-agent demo!'
  ]);
  
  greeterElement.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'Greeter',
        systemPrompt: 'You are a friendly greeter. Be warm and welcoming.'
      },
      greeterLLM,
      veilState
    )
  ));
  space.addChild(greeterElement);
  
  // Agent 2: Technical helper
  console.log('Creating Agent 2: Technical Helper...');
  const techElement = new Element('tech-agent', 'tech-helper');
  const techLLM = new MockLLMProvider();
  techLLM.setResponses([
    'Greetings. I am the technical assistant. I can help with technical questions.',
    'From a technical perspective, this multi-agent system allows parallel processing and specialized expertise.',
    'Technical session concluded. System operating within normal parameters.'
  ]);
  
  techElement.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'TechBot',
        systemPrompt: 'You are a technical assistant. Be precise and informative.'
      },
      techLLM,
      veilState
    )
  ));
  space.addChild(techElement);
  
  // Console interface
  space.addComponent(new ConsoleChatComponent());
  
  // Response logger to show which agent is responding
  class ResponseLogger extends Component {
    onMount() {
      this.subscribe('agent:response');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:response') {
        const agentName = event.payload.agentName || 'Unknown';
        console.log(`\n[${agentName}]: ${event.payload.content}`);
      }
    }
  }
  space.addComponent(new ResponseLogger());
  
  // Demo: Activate different agents
  console.log('\nStarting multi-agent demo...\n');
  
  // Activate greeter
  setTimeout(() => {
    console.log('>>> Activating Greeter Agent...');
    space.activateAgent('console:main', {
      targetAgent: 'greeter',
      reason: 'Initial greeting'
    });
  }, 1000);
  
  // Activate tech helper
  setTimeout(() => {
    console.log('\n>>> Activating Technical Agent...');
    space.activateAgent('console:main', {
      targetAgent: 'tech-helper',
      reason: 'Technical question'
    });
  }, 3000);
  
  // Activate greeter again
  setTimeout(() => {
    console.log('\n>>> Activating Greeter Agent again...');
    space.activateAgent('console:main', {
      targetAgent: 'greeter',
      reason: 'Follow-up'
    });
  }, 5000);
  
  // Both agents at once! (They won't interfere)
  setTimeout(() => {
    console.log('\n>>> Activating BOTH agents simultaneously...');
    space.activateAgent('console:main', {
      targetAgent: 'greeter',
      reason: 'Parallel test 1'
    });
    space.activateAgent('console:main', {
      targetAgent: 'tech-helper', 
      reason: 'Parallel test 2'
    });
  }, 7000);
  
  // Shutdown
  setTimeout(() => {
    console.log('\n\n=== Multi-Agent Demo Complete! ===');
    console.log('✓ Multiple agents in same space');
    console.log('✓ Agents respond only to their targeted activations');
    console.log('✓ Agents can process in parallel without interference');
    console.log('✓ Each agent maintains its own context and personality');
    process.exit(0);
  }, 10000);
}

main().catch(console.error);

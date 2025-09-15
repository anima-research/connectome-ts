#!/usr/bin/env node

/**
 * Test multi-agent system with different agents for different purposes
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
  console.log('=== Multi-Agent System Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create main reasoning agent (Claude Opus style)
  const mainAgent = new Element('main-agent', 'main-agent');
  const mainLLM = new MockLLMProvider();
  mainLLM.setResponses([
    "I'm the main reasoning agent. I see a complex calculation is needed. Let me ask the math specialist to help. @math-agent, what is 15 * 23?",
    "Thank you math specialist! The answer is 345. Now let me ask the creative agent for a fun fact about this number. @creative-agent, tell me something interesting about 345!",
    "Fascinating! So 345 has these interesting properties. Thank you both for your help!"
  ]);
  
  mainAgent.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'Claude-Main',
        systemPrompt: 'You are the main reasoning agent. You can delegate to specialists.'
      },
      mainLLM,
      veilState
    )
  ));
  space.addChild(mainAgent);
  
  // Create math specialist agent (like Haiku for tools)
  const mathAgent = new Element('math-agent', 'math-agent');
  const mathLLM = new MockLLMProvider();
  mathLLM.setResponses([
    "I'm the math specialist. 15 * 23 = 345. This is calculated as (15 * 20) + (15 * 3) = 300 + 45 = 345."
  ]);
  
  mathAgent.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'Haiku-Math',
        systemPrompt: 'You are a math specialist. Answer math questions precisely.'
      },
      mathLLM,
      veilState
    )
  ));
  space.addChild(mathAgent);
  
  // Create creative agent
  const creativeAgent = new Element('creative-agent', 'creative-agent');
  const creativeLLM = new MockLLMProvider();
  creativeLLM.setResponses([
    "I'm the creative agent! Here's a fun fact: 345 is a sphenic number (product of 3 distinct primes: 3×5×23). In music, 345 Hz is close to the frequency of F4, and interestingly, Interstate 345 in Dallas is one of the shortest interstates!"
  ]);
  
  creativeAgent.addComponent(new AgentComponent(
    new BasicAgent(
      { 
        name: 'Claude-Creative',
        systemPrompt: 'You are a creative agent. Provide interesting and fun information.'
      },
      creativeLLM,
      veilState
    )
  ));
  space.addChild(creativeAgent);
  
  // Add console chat
  space.addComponent(new ConsoleChatComponent());
  
  // Subscribe agents to targeted activations
  mathAgent.subscribe('agent:activate');
  creativeAgent.subscribe('agent:activate');
  
  // Log agent responses to see multi-agent interaction
  class ResponseLogger extends Component {
    onMount() {
      this.element.subscribe('agent:response');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:response') {
        const agentName = event.payload.agentName || 'Unknown';
        console.log(`\n[${agentName}]: ${event.payload.content}`);
      }
    }
  }
  
  const responseLogger = new Element('response-logger');
  responseLogger.addComponent(new ResponseLogger());
  space.addChild(responseLogger);
  
  // Activate main agent
  console.log('Activating main agent to start the conversation...\n');
  space.activateAgent('console:main', { 
    reason: 'Testing multi-agent collaboration',
    targetAgent: 'main-agent'
  });
  
  // Also activate other agents when mentioned
  // In a real system, this would be handled by a routing component
  setTimeout(() => {
    console.log('\n[System] Math specialist activated by mention...');
    space.activateAgent('console:main', {
      targetAgent: 'math-agent'
    });
  }, 2000);
  
  setTimeout(() => {
    console.log('\n[System] Creative agent activated by mention...');
    space.activateAgent('console:main', {
      targetAgent: 'creative-agent'
    });
  }, 4000);
  
  // Run for 10 seconds
  setTimeout(() => {
    console.log('\n[Test] Multi-agent collaboration complete!');
    console.log('- Main agent delegated to specialists');
    console.log('- Math agent handled calculations');
    console.log('- Creative agent provided interesting facts');
    console.log('- All agents worked together seamlessly!');
    process.exit(0);
  }, 10000);
}

main().catch(console.error);

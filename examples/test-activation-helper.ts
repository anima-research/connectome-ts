#!/usr/bin/env node

/**
 * Test the new space.activateAgent() helper
 */

import { 
  Space, 
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  ConsoleChatComponent
} from '../src';

async function main() {
  console.log('=== Agent Activation Helper Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  const llmProvider = new MockLLMProvider();
  llmProvider.setResponses([
    "Hello! I see this clean new API is working beautifully."
  ]);
  
  const agent = new BasicAgent(
    { 
      name: 'test-agent',
      systemPrompt: 'You are testing the new activation API'
    },
    llmProvider,
    veilState
  );
  
  // Connect agent to space
  const agentElement = new Element('agent');
  const agentComponent = new AgentComponent(agent);
  agentElement.addComponent(agentComponent);
  space.addChild(agentElement);
  
  // Add console chat
  space.addComponent(new ConsoleChatComponent());
  
  // OLD WAY (40+ lines of boilerplate):
  /*
  class ActivationHandler extends Component {
    onMount() {
      this.subscribe('agent:activate');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:activate') {
        const frame = (this.element as Space).getCurrentFrame();
        if (frame) {
          frame.operations.push({
            type: 'agentActivation',
            source: 'demo:console',
            reason: 'demo'
          });
          frame.activeStream = {
            streamId: 'console:main',
            streamType: 'console',
            metadata: { channel: 'console' }
          };
        }
      }
    }
  }
  space.addComponent(new ActivationHandler());
  
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  */
  
  // NEW WAY (1 line!):
  space.activateAgent('console:main', { 
    reason: 'Testing new activation API',
    priority: 'normal'
  });
  
  // Run for 5 seconds
  setTimeout(() => {
    console.log('\n[Test] Complete! Much cleaner!');
    process.exit(0);
  }, 5000);
}

main().catch(console.error);

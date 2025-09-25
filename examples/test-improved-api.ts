#!/usr/bin/env node

/**
 * Demonstrates the improved Connectome API
 */

import { 
  Space, 
  Element,
  Component,
  VEILStateManager,
  BasicAgent,
  MockLLMProvider,
  ConsoleChatComponent
} from '../src';

// Simple element with action handling
class CounterElement extends Element {
  private count = 0;
  
  async handleAction(action: string, params?: any): Promise<any> {
    switch (action) {
      case 'increment':
        this.count++;
        this.emit({ topic: 'counter.changed', payload: { count: this.count } });
        return { count: this.count };
      
      case 'reset':
        this.count = 0;
        this.emit({ topic: 'counter.changed', payload: { count: this.count } });
        return { count: this.count };
      
      default:
        return { error: `Unknown action: ${action}` };
    }
  }
}

// Component using convenience methods
class CounterDisplay extends Component {
  onMount() {
    // Simple subscription
    this.subscribe('counter.changed');
  }
  
  async handleEvent(event: any) {
    if (event.topic === 'counter.changed') {
      console.log(`[Display] Counter is now: ${event.payload.count}`);
      
      // Simple emit
      this.emit({
        topic: 'display.updated',
        payload: { displayValue: `Count: ${event.payload.count}` }
      });
    }
  }
}

async function main() {
  console.log('=== Improved API Demo ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  const llmProvider = new MockLLMProvider();
  llmProvider.setResponses([
    "I'll increment the counter.\n\n@counter.increment()",
    "Let me increment it again.\n\n@counter.increment()",
    "Now I'll reset it.\n\n@counter.reset()"
  ]);
  
  const agent = new BasicAgent(
    { systemPrompt: 'You can use @counter.increment() and @counter.reset() actions.' },
    llmProvider,
    veilState
  );
  
  // Simple setup - auto-wires everything!
  space.setAgent(agent);
  
  // Simple tool registration
  agent.registerTool('counter.increment');
  agent.registerTool('counter.reset');
  
  // Create elements
  const counter = new CounterElement('counter', 'counter');
  space.addChild(counter);
  
  // Add display component
  counter.addComponent(new CounterDisplay());
  
  // Add console chat
  space.addComponent(new ConsoleChatComponent());
  
  // Add activation handler
  class ActivationHandler extends Component {
    onMount() {
      this.subscribe('agent:activate');
    }
    
    async handleEvent(event: any) {
      if (event.topic === 'agent:activate') {
        const frame = (this.element as Space).getCurrentFrame();
        if (frame) {
          frame.operations.push({
            type: 'addFacet',
            facet: {
              id: `agent-activation-${Date.now()}`,
              type: 'agentActivation',
              content: 'Demo activation',
              attributes: {
                source: 'demo:console',
                reason: 'demo',
                priority: 'normal'
              }
            }
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
  
  // Simple activation
  space.emit({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  // Run for 10 seconds
  setTimeout(() => {
    console.log('\n[Demo] Complete!');
    process.exit(0);
  }, 10000);
}

main().catch(console.error);

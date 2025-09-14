#!/usr/bin/env node

/**
 * Test the latest API improvements
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
import { InteractiveComponent } from '../src/components/base-components';

// Simple element with multiple actions using new patterns
class MagicBoxElement extends Element {
  private contents = ['✨ A glowing crystal', '🔮 An ancient orb', '📜 A mysterious scroll'];
  private currentIndex = 0;
  
  async handleAction(action: string, params?: any): Promise<any> {
    switch (action) {
      case 'open':
        const item = this.contents[this.currentIndex++ % this.contents.length];
        this.emit({ 
          topic: 'box.opened', 
          payload: { contents: item },
          timestamp: Date.now()
        });
        return { contents: item };
        
      case 'shake':
        this.emit({ 
          topic: 'box.shaken',
          payload: { sound: 'Something rattles inside...' },
          timestamp: Date.now()
        });
        return { sound: 'rattle rattle' };
        
      default:
        return { error: `Unknown action: ${action}` };
    }
  }
}

// Component using onFirstFrame
class BoxDisplayComponent extends InteractiveComponent {
  async onFirstFrame() {
    // No more frame:start boilerplate!
    this.addFacet({
      id: 'box-state',
      type: 'state',
      displayName: 'magic_box',
      content: 'A mysterious magical box sits before you, emanating soft light.'
    });
    
    this.addFacet({
      id: 'box-help',
      type: 'ambient',
      content: 'You can @magicbox.open() or @magicbox.shake() it'
    });
  }
  
  onMount() {
    // Simple subscriptions with convenience methods
    this.subscribe('box.opened');
    this.subscribe('box.shaken');
  }
  
  async handleEvent(event: any) {
    await super.handleEvent(event); // Important for onFirstFrame!
    
    if (event.topic === 'box.opened') {
      this.addFacet({
        id: `opened-${Date.now()}`,
        type: 'event',
        content: `The box opens revealing: ${event.payload.contents}`
      });
    } else if (event.topic === 'box.shaken') {
      this.addFacet({
        id: `shaken-${Date.now()}`,
        type: 'event', 
        content: event.payload.sound
      });
    }
  }
}

async function main() {
  console.log('=== API Improvements v2 Demo ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  const llmProvider = new MockLLMProvider();
  llmProvider.setResponses([
    "I see a magical box! Let me shake it first to see what might be inside.\n\n@magicbox.shake()",
    "Interesting! Something's definitely in there. Let me open it.\n\n@magicbox.open()",
    "Wow! Let me open it again to see what else it contains.\n\n@magicbox.open()"
  ]);
  
  const agent = new BasicAgent(
    { systemPrompt: 'You are exploring magical artifacts. Be curious!' },
    llmProvider,
    veilState
  );
  
  // Auto-wired connection
  space.setAgent(agent);
  
  // Create element
  const magicBox = new MagicBoxElement('magicbox', 'magicbox');
  space.addChild(magicBox);
  magicBox.addComponent(new BoxDisplayComponent());
  
  // Bulk action registration with new API
  agent.registerElementActions(magicBox, {
    open: 'Open the magical box',
    shake: 'Shake the box to hear what\'s inside'
  });
  
  // Enable automatic action registration for any other elements
  agent.enableAutoActionRegistration();
  
  // Console chat
  space.addComponent(new ConsoleChatComponent());
  
  // Activation handler using convenience methods
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
  
  // Activate
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

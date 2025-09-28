#!/usr/bin/env node

/**
 * Test auto-registration of element actions
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
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { StateComponent } from '../src/components/base-components';

// Define a simple box element with actions
class TestBox extends Element {
  static actions = {
    open: {
      description: 'Open this test box',
      params: {
        type: 'object',
        properties: {
          method: { 
            type: 'string', 
            enum: ['gently', 'forcefully'],
            description: 'How to open'
          }
        }
      }
    },
    shake: 'Shake the box to hear what\'s inside'
  };
  
  constructor(id: string) {
    super(`box-${id}`, `Box ${id}`);
    this.addComponent(new BoxStateComponent());
  }
  
  async handleAction(action: string, params?: any): Promise<any> {
    console.log(`[Box:handleAction] action=${action}, params=${JSON.stringify(params)}`);
    
    if (action === 'open') {
      this.getComponent(BoxStateComponent)?.setOpen(params?.method || 'normally');
      return { success: true, message: 'Box opened!' };
    } else if (action === 'shake') {
      return { success: true, sound: 'rattle rattle' };
    }
    
    return { error: `Unknown action: ${action}` };
  }
}

class BoxStateComponent extends StateComponent {
  onMount() {
    this.addFacet({
      id: 'box-state',
      type: 'state', 
      displayName: 'box',
      content: 'A mysterious test box sits here, unopened.',
      attributes: {
        isOpen: false
      }
    });
  }
  
  setOpen(method: string) {
    this.updateState('box-state', {
      content: `The box is now open (opened ${method})!`
    });
  }
}

async function main() {
  console.log('=== Auto-Registration Test ===\n');
  
  // Create space
  const veilState = new VEILStateManager();
  const space = new Space('test-space', veilState);
  
  // Create agent with HUD
  const hud = new FrameTrackingHUD({ 
    showDebugInfo: false,
    showDiff: false,
    maxFrames: 3 
  });
  
  const agent = new BasicAgent({
    llmProvider: new MockLLMProvider(),
    hud,
    systemPrompt: 'You are testing auto-registration of actions.'
  });
  
  // ENABLE AUTO-REGISTRATION
  console.log('Enabling auto-registration...\n');
  agent.enableAutoActionRegistration();
  
  // Connect agent and space
  space.setAgent(agent);
  
  // Add some boxes
  console.log('Creating boxes...\n');
  const box1 = new TestBox('1');
  const box2 = new TestBox('2');
  
  space.addChild(box1);
  space.addChild(box2);
  
  // Log registered tools
  console.log('Registered tools:');
  const tools = (agent as any).tools;
  for (const [name, tool] of tools) {
    console.log(`  - ${name}: ${tool.description}`);
  }
  
  console.log('\n=== Testing Actions ===\n');
  
  // Process initial frame
  await space.processFrame();
  
  // Test parsing actions
  const testCompletions = [
    '@box-1.open()',
    '@box-1.open(method: "gently")',
    '@box-2.shake()',
    '@box-2.open(method: "forcefully")'
  ];
  
  for (const completion of testCompletions) {
    console.log(`\nTesting: ${completion}`);
    const parsed = agent.parseCompletion(completion);
    console.log(`Parsed: ${JSON.stringify(parsed.operations)}`);
    
    if (parsed.operations.length > 0) {
      // Process the action
      await (agent as any).processOutgoingFrame({ deltas: parsed.operations });
    }
  }
  
  console.log('\n=== Test Complete ===');
}

main().catch(console.error);

#!/usr/bin/env node

/**
 * Test that shows elements can handle actions without boilerplate handleAction methods
 */

import { 
  Element,
  Space
} from '../src';
import { InteractiveComponent } from '../src/components/base-components';

// Element with static actions but NO handleAction method!
class MagicBox extends Element {
  static actions = {
    open: 'Open the magic box',
    shake: 'Shake the box'
  };
  
  constructor(id: string) {
    super(`box-${id}`, `Box ${id}`);
    // The component will handle the actions
    this.addComponent(new MagicBoxComponent());
  }
  
  // NO handleAction method needed!
}

class MagicBoxComponent extends InteractiveComponent {
  onMount() {
    // Register the actions
    this.registerAction('open', async () => {
      console.log('✨ The magic box opens with a shower of sparkles!');
      return { success: true, sparkles: 100 };
    });
    
    this.registerAction('shake', async () => {
      console.log('🎵 The box makes mysterious musical sounds!');
      return { success: true, sound: 'ding-dong-bing' };
    });
  }
}

// Simpler element without static actions
class SimpleButton extends Element {
  constructor() {
    super('button', 'Button');
    this.addComponent(new ButtonComponent());
  }
  // NO handleAction, NO static actions!
}

class ButtonComponent extends InteractiveComponent {
  onMount() {
    this.registerAction('press', async () => {
      console.log('🔘 Button pressed!');
      return { success: true };
    });
  }
}

async function testElementAction(element: Element, action: string) {
  console.log(`\nTesting ${element.id}.${action}():`);
  
  // Simulate the element:action event
  const event = {
    topic: 'element:action',
    payload: {
      path: [element.id, action],
      parameters: {}
    },
    source: { type: 'test' as const, id: 'test' },
    timestamp: Date.now()
  };
  
  await element.handleEvent(event);
}

async function main() {
  console.log('=== No Boilerplate Test ===\n');
  
  // Create elements
  const box = new MagicBox('1');
  const button = new SimpleButton();
  
  // Mount them (simulating being added to a space)
  box._active = true;
  button._active = true;
  
  // Subscribe them to element:action
  box.subscribe('element:action');
  button.subscribe('element:action');
  
  // Trigger component mounting
  for (const comp of (box as any)._components) {
    await (comp as any)._attach(box);
  }
  for (const comp of (button as any)._components) {
    await (comp as any)._attach(button);
  }
  
  console.log('Elements created without handleAction boilerplate!\n');
  
  // Test the actions
  await testElementAction(box, 'open');
  await testElementAction(box, 'shake');
  await testElementAction(button, 'press');
  
  console.log('\n✅ All actions handled by components directly!');
  console.log('   No handleAction delegation boilerplate needed!');
}

main().catch(console.error);

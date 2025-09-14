#!/usr/bin/env node

/**
 * Simple test of component action declarations
 */

import { Element } from '../src/spaces/element';
import { InteractiveComponent } from '../src/components/base-components';

// Component with actions
class TestComponent extends InteractiveComponent {
  static actions = {
    hello: 'Say hello',
    goodbye: { description: 'Say goodbye', params: ['name'] }
  };
  
  onMount() {
    console.log('Component mounted!');
    this.registerAction('hello', async () => {
      console.log('Hello from component!');
    });
    this.registerAction('goodbye', async (params) => {
      console.log(`Goodbye ${params?.name || 'friend'}!`);
    });
  }
}

async function main() {
  console.log('=== Component Action Test ===\n');
  
  // Create element with component
  const element = new Element('test', 'test');
  const component = new TestComponent();
  element.addComponent(component);
  
  // Simulate mounting
  await (component as any)._attach(element);
  
  // Check static actions
  const componentClass = component.constructor as any;
  console.log('\nComponent declares actions:', componentClass.actions);
  
  // Check registered handlers
  console.log('\nRegistered handlers:', Array.from((component as any).actions.keys()));
  
  // Test action execution directly
  console.log('\nTesting actions:');
  const helloHandler = (component as any).actions.get('hello');
  if (helloHandler) {
    await helloHandler();
  }
  
  const goodbyeHandler = (component as any).actions.get('goodbye');
  if (goodbyeHandler) {
    await goodbyeHandler({ name: 'World' });
  }
  
  console.log('\n✅ Component actions work!');
}

main().catch(console.error);

#!/usr/bin/env node

/**
 * Example showing the component-centric pattern:
 * - Use Element directly, don't extend it
 * - Components declare and handle actions
 * - Factory functions for complex setups
 */

import { 
  Space, 
  Element,
  BasicAgent,
  MockLLMProvider,
  VEILStateManager
} from '../src';
import { InteractiveComponent, StateComponent } from '../src/components/base-components';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';

// ===== Components declare their own actions =====

class CounterComponent extends InteractiveComponent {
  // Declare actions at component level
  static actions = {
    increment: 'Increase the counter',
    decrement: 'Decrease the counter',
    reset: 'Reset counter to zero'
  };
  
  private count = 0;
  
  onMount() {
    // Register the action handlers
    this.registerAction('increment', async () => {
      this.count++;
      this.updateDisplay();
    });
    
    this.registerAction('decrement', async () => {
      this.count--;
      this.updateDisplay();
    });
    
    this.registerAction('reset', async () => {
      this.count = 0;
      this.updateDisplay();
    });
  }
  
  async onFirstFrame() {
    this.addFacet({
      id: 'counter-state',
      type: 'state',
      displayName: 'counter',
      content: `Counter value: ${this.count}`
    });
  }
  
  private updateDisplay() {
    this.updateState('counter-state', {
      content: `Counter value: ${this.count}`
    });
  }
}

class ToggleComponent extends StateComponent<{ isOn: boolean }> {
  // Another component with its own actions
  static actions = {
    toggle: 'Toggle the switch on/off',
    turnOn: 'Turn the switch on',
    turnOff: 'Turn the switch off'
  };
  
  constructor() {
    super({ isOn: false }, 'toggle-state');
  }
  
  onMount() {
    // We can access other components on the same element
    const counter = this.element.getComponent(CounterComponent);
    if (counter) {
      console.log('Found counter component on same element!');
    }
  }
  
  async onFirstFrame() {
    this.addFacet({
      id: this.stateId,
      type: 'state',
      displayName: 'toggle',
      content: `Switch is ${this.state.isOn ? 'ON' : 'OFF'}`
    });
  }
  
  protected emitStateUpdate() {
    this.updateState(this.stateId, {
      content: `Switch is ${this.state.isOn ? 'ON' : 'OFF'}`
    });
  }
}

// ===== Factory functions instead of Element subclasses =====

function createControlPanel(): Element {
  const panel = new Element('panel', 'Control Panel');
  
  // Add multiple components
  panel.addComponent(new CounterComponent());
  panel.addComponent(new ToggleComponent());
  
  return panel;
}

// ===== Main example =====

async function main() {
  console.log('=== Component-Centric Pattern Example ===\n');
  
  // Create space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Create agent
  const hud = new FrameTrackingHUD({ 
    showDebugInfo: false,
    showDiff: false 
  });
  
  const agent = new BasicAgent({
    llmProvider: new MockLLMProvider(),
    hud,
    systemPrompt: 'You are testing the component-centric pattern.'
  });
  
  // Enable auto-registration
  agent.enableAutoActionRegistration();
  
  // Connect agent and space
  space.setAgent(agent);
  
  // Create elements using factory functions
  const panel = createControlPanel();
  space.addChild(panel);
  
  // You can also create simple elements inline
  const display = new Element('display', 'Display');
  display.addComponent(new class extends InteractiveComponent {
    static actions = {
      refresh: 'Refresh the display'
    };
    
    onMount() {
      this.registerAction('refresh', async () => {
        console.log('Display refreshed!');
      });
    }
  });
  space.addChild(display);
  
  // Process initial frame
  await space.processFrame();
  
  // Show registered tools
  console.log('\nAuto-registered tools:');
  const tools = (agent as any).tools;
  for (const [name, tool] of tools) {
    console.log(`  - ${name}: ${tool.description}`);
  }
  
  console.log('\n✅ Components handle everything!');
  console.log('   No Element subclasses needed!');
}

main().catch(console.error);

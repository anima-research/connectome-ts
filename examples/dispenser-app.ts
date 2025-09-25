/**
 * Box Dispenser Application for Connectome
 * 
 * A complete application using the Host architecture that creates
 * an interactive box dispenser with persistence and debug capabilities.
 */

import { ConnectomeApplication } from '../src/host/types';
import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { ComponentRegistry } from '../src/persistence/component-registry';
import '../src/core-components'; // Import core component registrations
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentComponent } from '../src/agent/agent-component';
import { Element } from '../src/spaces/element';
import { 
  BoxDispenserComponent, 
  DispenseButtonComponent 
} from '../src/components/box-dispenser';
import { ControlPanelComponent } from '../src/components/control-panel';
import { ContentGeneratorComponent } from '../src/components/content-generator';
import { ConsoleChatComponent } from '../src/elements/console-chat';
import { NotesElement } from '../src/elements/notes';

export interface DispenserAppConfig {
  agentName: string;
  systemPrompt: string;
  llmProviderId: string;
  enableConsole?: boolean;
  autoDispenseOnStart?: boolean;
  initialSettings?: {
    size?: 'small' | 'medium' | 'large';
    color?: 'red' | 'blue' | 'green' | 'rainbow';
  };
}

export class DispenserApplication implements ConnectomeApplication {
  constructor(private config: DispenserAppConfig) {}
  
  async createSpace(): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState);
    
    // Register llmProvider reference that will be injected by Host
    space.registerReference('llmProvider', this.config.llmProviderId);
    
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Box Dispenser application...');
    
    // Create space notes element (available to all agents)
    const notesElem = new NotesElement('notes');
    space.addChild(notesElem);
    console.log('📝 Space notes available');
    
    // Create agent element
    const agentElem = new Element('dispenser-agent');
    
    // Create agent component (agent will be created after references are resolved)
    const agentComponent = new AgentComponent();
    
    // Store config for agent creation
    const agentConfig = {
      name: this.config.agentName,
      systemPrompt: this.config.systemPrompt,
      autoActionRegistration: true,  // Enable auto-registration of component actions
      defaultMaxTokens: 500
    };
    
    // Save config for restoration
    (agentComponent as any).agentConfig = agentConfig;
    
    agentElem.addComponent(agentComponent);
    
    // Add agent element to space
    space.addChild(agentElem);
    
    // Create dispenser element with components
    // Note: We need to use a reference for the LLM provider in ContentGeneratorComponent
    const dispenserElem = new Element('dispenser', 'dispenser');
    
    // Add all dispenser components
    dispenserElem.addComponent(new ControlPanelComponent());
    dispenserElem.addComponent(new ContentGeneratorComponent());  // Will use @reference('llm.content')
    dispenserElem.addComponent(new BoxDispenserComponent());
    dispenserElem.addComponent(new DispenseButtonComponent());
    
    // Add dispenser to space
    space.addChild(dispenserElem);
    
    // Apply initial settings if provided
    if (this.config.initialSettings) {
      const controlPanel = dispenserElem.getComponent(ControlPanelComponent);
      if (controlPanel && this.config.initialSettings.size) {
        (controlPanel as any).size = this.config.initialSettings.size;
      }
      if (controlPanel && this.config.initialSettings.color) {
        (controlPanel as any).color = this.config.initialSettings.color;
      }
    }
    
    // Add console chat component if enabled
    if (this.config.enableConsole) {
      const consoleElem = new Element('console-chat');
      const consoleChatComponent = new ConsoleChatComponent();
      consoleElem.addComponent(consoleChatComponent);
      
      // Subscribe to relevant events
      consoleElem.subscribe('console:*');
      consoleElem.subscribe('agent:response');
      
      space.addChild(consoleElem);
      console.log('💬 Console chat interface enabled');
    }
    
    // Subscribe to agent response events
    space.subscribe('agent:frame-ready');
    space.subscribe('button:pressed');
    space.subscribe('control:*');
    
    console.log('✅ Box Dispenser application initialized');
    console.log('   Available actions:');
    console.log('   - @dispenser.dispense() - Press the button to dispense a new box');
    console.log('   - @dispenser.setSize("small"|"medium"|"large") - Change box size');
    console.log('   - @dispenser.setColor("red"|"blue"|"green"|"rainbow") - Change box color');
    console.log('   - @box-N.open() - Open a specific box');
    console.log('   - @box-N.close() - Close a specific box');
    console.log('   - @box-N.shake() - Shake a specific box\n');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    // Core components including SpaceNotesComponent are already registered
    // via the '../src/core-components' import
    // Box components are dynamically created, not restored
    // They don't need to be registered
    
    return ComponentRegistry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Box Dispenser application started!');
    
    // Auto-dispense a box on start if configured
    if (this.config.autoDispenseOnStart) {
      console.log('📦 Auto-dispensing first box...');
      
      // Emit a button press event to trigger dispensing
      setTimeout(async () => {
        space.emit({
          topic: 'button:pressed',
          source: { elementId: 'dispenser', elementType: 'Element', elementPath: [] },
          payload: {},
          timestamp: Date.now()
        });
      }, 100);
    }
    
    // Display welcome message
    if (this.config.enableConsole) {
      console.log('\n🎮 Welcome to the Box Dispenser!');
      console.log('Type messages to interact with the agent, or use actions directly.');
      console.log('Type "help" to see available commands.\n');
    }
  }
  
  async onRestore(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('♻️ Box Dispenser application restored from snapshot');
    
    // Count existing boxes
    const boxes = space.children.filter(child => child.name.startsWith('box-'));
    console.log(`📦 Restored with ${boxes.length} existing box(es)`);
    
    if (this.config.enableConsole) {
      console.log('\n🎮 Welcome back to the Box Dispenser!');
      console.log('Your previous session has been restored.\n');
    }
  }
}

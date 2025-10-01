#!/usr/bin/env tsx
/**
 * Box Dispenser - Pure RETM Architecture
 * 
 * Demonstrates:
 * - Dynamic element creation via VEIL (boxes created on demand)
 * - Component-state management (no @persistent)
 * - Action handling in pure RETM
 * - Effectors creating elements through events
 * - Full Host integration
 * 
 * Architecture:
 * - DispenseButtonReceptor: button:press event → button-press facet
 * - DispenseEffector: Watches button-press, creates box via element:create
 * - BoxOpenReceptor: box:open event → activation facet
 * - All state in VEIL component-state facets
 */

import { config } from 'dotenv';
config();

import {
  ConnectomeHost,
  Space,
  VEILStateManager,
  Element,
  ConsoleAfferent,
  ConsoleMessageReceptor,
  ConsoleSpeechEffector,
  AgentEffector,
  BasicAgent,
  ContextTransform,
  ContinuationTransform,
  MockLLMProvider,
  ComponentRegistry,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  createConsoleElement
} from '../src';
import { BaseReceptor, BaseEffector } from '../src/components/base-martem';
import { SpaceEvent, Facet, ReadonlyVEILState, FacetDelta, EffectorResult } from '../src/spaces/receptor-effector-types';
import { ConnectomeApplication } from '../src/host/types';
import { AfferentContext } from '../src/spaces/receptor-effector-types';

// ============================================
// RECEPTORS
// ============================================

/**
 * Converts button press events to facets
 */
class DispenseButtonReceptor extends BaseReceptor {
  topics = ['button:press'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    console.log('[DispenseButton] Button pressed!');
    
    return [{
      id: `button-press-${Date.now()}`,
      type: 'event',
      content: '*CLICK* The button depresses with a satisfying mechanical sound.',
      eventType: 'button-press'
    }];
  }
}

/**
 * Converts box open events to facets + activation
 */
class BoxOpenReceptor extends BaseReceptor {
  topics = ['box:open'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const { boxId, method } = event.payload as any;
    
    const facets: Facet[] = [];
    
    // Create open event facet
    facets.push({
      id: `box-${boxId}-opened-${Date.now()}`,
      type: 'event',
      content: `💥 The box opens ${method}!`,
      eventType: 'box-opened',
      attributes: { boxId, method }
    });
    
    // Create activation for agent to react
    facets.push({
      id: `activation-box-open-${Date.now()}`,
      type: 'agent-activation',
      content: `Box opened ${method}`,
      state: {
        source: 'box',
        reason: `box_opened_${method}`,
        priority: 'high',
        boxId
      },
      ephemeral: true
    });
    
    return facets;
  }
}

/**
 * Parses console commands for dispenser actions
 */
class DispenserCommandReceptor extends BaseReceptor {
  topics = ['console:message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[] {
    const payload = event.payload as any;
    const content = payload.content?.toLowerCase() || '';
    
    // Don't override the default console message handling, just add command interpretation
    // Only process if it matches our commands
    if (content.includes('press') && content.includes('button')) {
      console.log('[DispenserCommand] Detected button press command');
      return [{
        id: `command-press-${Date.now()}`,
        type: 'event',
        content: 'User wants to press the button',
        eventType: 'command-button-press'
      }];
    }
    
    const openMatch = content.match(/open\s+box[-\s]*(\d+)/i);
    if (openMatch) {
      const boxNum = openMatch[1];
      console.log(`[DispenserCommand] Detected open box-${boxNum} command`);
      return [{
        id: `command-open-${Date.now()}`,
        type: 'event',
        content: `User wants to open box-${boxNum}`,
        eventType: 'command-box-open',
        attributes: { boxId: boxNum }
      }];
    }
    
    return [];
  }
}

/**
 * Executes dispenser commands
 */
class DispenserCommandEffector extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).eventType;
      
      if (eventType === 'command-button-press') {
        // Emit button press event
        events.push({
          topic: 'button:press',
          source: { elementId: 'dispenser', elementPath: [] },
          timestamp: Date.now(),
          payload: {}
        });
      }
      
      if (eventType === 'command-box-open') {
        const boxId = (change.facet as any).attributes?.boxId;
        if (boxId) {
          // Emit box open event
          events.push({
            topic: 'box:open',
            source: { elementId: `box-${boxId}`, elementPath: [] },
            timestamp: Date.now(),
            payload: { boxId, method: 'carefully' }
          });
        }
      }
    }
    
    return { events };
  }
}

// ============================================
// EFFECTORS
// ============================================

/**
 * Dispenses boxes when button is pressed
 */
class DispenseEffector extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).eventType;
      if (eventType !== 'button-press') continue;
      
      // Get dispenser state
      const dispenserState = this.getComponentState<{ boxCount: number; size: string; color: string }>();
      const boxCount = (dispenserState.boxCount || 0) + 1;
      const size = dispenserState.size || 'medium';
      const color = dispenserState.color || 'blue';
      
      console.log(`[DispenseEffector] Dispensing box #${boxCount} (${size}, ${color})`);
      
      // Update dispenser state
      this.updateComponentState({ boxCount, lastDispensed: Date.now() });
      
      // Create box element via VEIL with continuation tag
      events.push({
        topic: 'element:create',
        source: { elementId: this.element.id, elementPath: [] },
        timestamp: Date.now(),
        payload: {
          parentId: 'root',  // Add to space root
          name: `box-${boxCount}`,
          elementType: 'Box',
          components: [{
            type: 'BoxComponent',
            componentClass: 'effector',
            config: {
              boxId: boxCount,
              size,
              color,
              contents: `Mystery item #${boxCount}`,
              isOpen: false
            }
          }],
          // Add continuation to trigger agent activation after box creation
          continuations: [{
            facetType: 'agent-activation',
            facetSpec: {
              id: `activation-dispense-box-${boxCount}`,
              content: `New ${size} ${color} box #${boxCount} dispensed`,
              state: {
                source: 'dispenser',
                reason: 'box_dispensed',
                priority: 'normal',
                boxId: boxCount,
                boxElementId: '{{result.elementId}}'  // Filled by ContinuationTransform
              }
            },
            condition: 'success'
          }]
        }
      });
      
      // Agent activation will happen via continuation after box is created
      // No need to activate directly here
    }
    
    return { events };
  }
}

/**
 * Handles box component behavior
 * This is actually more like a traditional component since boxes are interactive elements
 */
class BoxComponent extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  // Declare actions for registration
  static actions = {
    open: {
      description: 'Open this box',
      parameters: {
        method: { type: 'string', enum: ['gently', 'forcefully', 'carefully'], required: false }
      }
    }
  };
  
  async onMount(): Promise<void> {
    // Register action handler
    (this as any).actions = new Map();
    (this as any).actions.set('open', this.open.bind(this));
    
    // Initialize box state (RETM components initialize in onMount via events, not onFirstFrame)
    const config = this.getComponentState<{
      boxId: number;
      size: string;
      color: string;
      contents: string;
      isOpen: boolean;
    }>();
    
    console.log(`[Box ${config.boxId}] Initialized: ${config.size} ${config.color} box`);
    
    // Create initial box state facet (using helper!)
    this.emitFacet({
      id: `${this.element.id}-state`,
      type: 'state',
      content: `A ${config.size} ${config.color} box sits here, closed and mysterious.`,
      entityType: 'element',
      entityId: this.element.id,
      state: config
    });
    
    // Add action hint (using helper!)
    this.emitFacet({
      id: `${this.element.id}-hint`,
      type: 'ambient',
      content: `You can open this box with @${this.element.id}.open()`
    });
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    // Boxes process open events to update their own state
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).eventType;
      const boxId = (change.facet as any).attributes?.boxId;
      const myBoxId = this.getComponentState().boxId;
      
      if (eventType === 'box-opened' && boxId == myBoxId) {
        // Update our state to mark as open
        const config = this.getComponentState();
        this.updateComponentState({ isOpen: true });
        
        // Update state facet to reflect open state
        const openEffect = this.getOpeningEffect(config.color);
        events.push({
          topic: 'veil:operation',
          source: this.element.getRef(),
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'changeFacet',
              id: `${this.element.id}-state`,
              changes: {
                content: `The ${config.size} ${config.color} box is open, revealing ${config.contents}!`,
                state: { attributes: { ...config, isOpen: true } }
              }
            }
          }
        });
        
        // Add event for the opening effect
        events.push({
          topic: 'veil:operation',
          source: this.element.getRef(),
          timestamp: Date.now(),
          payload: {
            operation: {
              type: 'addFacet',
              facet: {
                id: `${this.element.id}-open-effect-${Date.now()}`,
                type: 'event',
                content: `The box opens with a ${openEffect}!`
              }
            }
          }
        });
      }
    }
    
    return { events };
  }
  
  private getOpeningEffect(color: string): string {
    switch (color) {
      case 'red': return 'burst of flame';
      case 'blue': return 'splash of water';
      case 'green': return 'shower of leaves';
      case 'rainbow': return 'cascade of rainbow sparkles';
      default: return 'puff of smoke';
    }
  }
  
  // Action handler
  async open(params?: { method?: string }): Promise<void> {
    const method = params?.method || 'normally';
    const config = this.getComponentState();
    
    if (config.isOpen) {
      this.addEvent('The box is already open!', 'box-already-open');
      return;
    }
    
    // Emit box open event
    this.emit({
      topic: 'box:open',
      payload: {
        boxId: config.boxId,
        method,
        contents: config.contents
      }
    });
  }
}

// ============================================
// APPLICATION
// ============================================

class DispenserApplication implements ConnectomeApplication {
  async createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry);
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Box Dispenser (RETM)...\n');
    
    // Register components
    ComponentRegistry.register('ConsoleAfferent', ConsoleAfferent);
    ComponentRegistry.register('DispenseEffector', DispenseEffector);
    ComponentRegistry.register('BoxComponent', BoxComponent);
    
    // Add infrastructure
    space.addReceptor(new ElementRequestReceptor());
    space.addTransform(new ContinuationTransform());
    space.addMaintainer(new ElementTreeMaintainer(space));
    
    // Add console
    space.addReceptor(new ConsoleMessageReceptor());
    
    // Create console via VEIL
    space.emit({
      topic: 'element:create',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {
        parentId: space.id,
        name: 'console',
        components: [{
          type: 'ConsoleAfferent',
          config: { streamId: 'console:main', prompt: '> ' }
        }]
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Initialize console
    const consoleElem = space.children.find(c => c.name === 'console');
    if (consoleElem) {
      const consoleAfferent = consoleElem.components[0] as ConsoleAfferent;
      const context: AfferentContext<any> = {
        config: { streamId: 'console:main', prompt: '> ' },
        afferentId: 'console-main',
        emit: (event) => space.emit(event),
        emitError: (error) => console.error('[Console Error]:', error)
      };
      
      await consoleAfferent.initialize(context);
      await consoleAfferent.start();
      
      space.addEffector(new ConsoleSpeechEffector(consoleAfferent));
    }
    
    // Add dispenser receptors and effectors
    space.addReceptor(new DispenseButtonReceptor());
    space.addReceptor(new BoxOpenReceptor());
    space.addReceptor(new DispenserCommandReceptor());
    space.addEffector(new DispenserCommandEffector());
    
    // Create dispenser element directly (for now - VEIL creation needs frame processing)
    const dispenserElem = new Element('dispenser');
    space.addChild(dispenserElem);
    
    const dispenseEffector = new DispenseEffector();
    await dispenserElem.addComponentAsync(dispenseEffector);
    
    // Initialize component-state manually (normally done by ElementTreeMaintainer)
    // This is temporary until we figure out VEIL-based creation during initialization
    const componentId = `${dispenserElem.id}:DispenseEffector:0`;
    space.emit({
      topic: 'veil:operation',
      source: dispenserElem.getRef(),
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet: {
            id: `component-state:${componentId}`,
            type: 'component-state',
            componentType: 'DispenseEffector',
            componentClass: 'effector',
            componentId,
            elementId: dispenserElem.id,
            state: {
              boxCount: 0,
              size: 'medium',
              color: 'blue'
            }
          }
        }
      }
    });
    
    // Register as effector
    space.addEffector(dispenseEffector);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Create agent
    const agentElem = new Element('agent');
    space.addChild(agentElem);
    
    const llmProvider = (space as any).getReference?.('provider:llm.primary') || 
                        (space as any).getReference?.('llmProvider');
    
    const agent = new BasicAgent({
      config: {
        name: 'DispenserAgent',
        systemPrompt: `You are a whimsical AI assistant observing a magical box dispenser.
React with curiosity and wonder to boxes being created and opened.
Be playful and creative in your responses.`
      },
      provider: llmProvider,
      veilStateManager: veilState
    });
    
    space.addEffector(new AgentEffector(agentElem, agent));
    space.addTransform(new ContextTransform(veilState));
    
    console.log('✅ Box Dispenser initialized\n');
    console.log('Commands:');
    console.log('  - Type "press button" to dispense a box');
    console.log('  - Type "open box-N" to open a specific box');
    console.log('  - Type "/quit" to exit\n');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    return ComponentRegistry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Box Dispenser started!\n');
    
    // Dispense first box automatically
    console.log('🎁 Dispensing initial box...\n');
    space.emit({
      topic: 'button:press',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {}
    });
  }
}

async function main() {
  console.log('🎁 Box Dispenser - Pure RETM Architecture');
  console.log('=========================================\n');
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses([
    "Ooh! A new box appears! I wonder what's inside?",
    "How exciting! The mystery box awaits...",
    "*Eyes widen* What treasures might this box hold?",
    "Another box! The anticipation is delightful!",
    "Wow! The contents are revealed! Fascinating!",
    "What a delightful surprise that was!",
    "I'm absolutely captivated by these mysterious boxes!"
  ]);
  
  const app = new DispenserApplication();
  
  const host = new ConnectomeHost({
    providers: {
      'llm.primary': mockProvider
    },
    persistence: {
      enabled: false  // Disable for demo
    },
    debug: {
      enabled: false
    },
    reset: true
  });
  
  const shutdown = async () => {
    console.log('\n\n👋 Shutting down...');
    await host.stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  try {
    await host.start(app);
  } catch (error) {
    console.error('❌ Failed to start:', error);
    process.exit(1);
  }
}

main();

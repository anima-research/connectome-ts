#!/usr/bin/env tsx
/**
 * Box Dispenser with Frame Snapshot Testing
 * 
 * Tests frame snapshot capture with the dispenser example.
 * Enables debug server so we can inspect snapshots via Debug API.
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
  FrameSnapshotTransform,
  MockLLMProvider,
  ComponentRegistry,
  ElementRequestReceptor,
  ElementTreeMaintainer,
} from '../src';
import { BaseReceptor, BaseEffector, BaseTransform } from '../src/components/base-martem';
import { SpaceEvent, ReadonlyVEILState, FacetDelta, EffectorResult } from '../src/spaces/receptor-effector-types';
import { VEILDelta } from '../src/veil/types';
import { ConnectomeApplication } from '../src/host/types';
import { AfferentContext } from '../src/spaces/receptor-effector-types';

// Import the same components from dispenser-retm
class DispenseButtonReceptor extends BaseReceptor {
  topics = ['button:press'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    console.log('[DispenseButton] Button pressed!');
    
    return [{
      type: 'addFacet',
      facet: {
        id: `button-press-${Date.now()}`,
        type: 'event',
        content: '*CLICK* The button depresses with a satisfying mechanical sound.',
        state: {
          source: 'button',
          eventType: 'button-press'
        }
      }
    }];
  }
}

class BoxOpenReceptor extends BaseReceptor {
  topics = ['box:open'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const { boxId, method } = event.payload as any;
    
    const deltas: VEILDelta[] = [];
    
    deltas.push({
      type: 'addFacet',
      facet: {
        id: `box-${boxId}-opened-${Date.now()}`,
        type: 'event',
        content: `💥 The box opens ${method}!`,
        state: {
          source: 'box',
          eventType: 'box-opened'
        },
        attributes: { boxId, method }
      }
    });
    
    deltas.push({
      type: 'addFacet',
      facet: {
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
      }
    });
    
    return deltas;
  }
}

class DispenserCommandReceptor extends BaseReceptor {
  topics = ['console:message'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const payload = event.payload as any;
    const content = payload.content?.toLowerCase() || '';
    
    if (content.includes('press') && content.includes('button')) {
      return [{
        type: 'addFacet',
        facet: {
          id: `command-press-${Date.now()}`,
          type: 'event',
          content: 'User wants to press the button',
          state: {
            source: 'console',
            eventType: 'command-button-press'
          }
        }
      }];
    }
    
    const openMatch = content.match(/open\s+box[-\s]*(\d+)/i);
    if (openMatch) {
      const boxNum = openMatch[1];
      return [{
        type: 'addFacet',
        facet: {
          id: `command-open-${Date.now()}`,
          type: 'event',
          content: `User wants to open box-${boxNum}`,
          state: {
            source: 'console',
            eventType: 'command-box-open'
          },
          attributes: { boxId: boxNum }
        }
      }];
    }
    
    return [];
  }
}

class DispenserCommandEffector extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).state?.eventType;
      
      if (eventType === 'command-button-press') {
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

class BoxStateTransform extends BaseTransform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    for (const [id, facet] of state.facets) {
      if (facet.type === 'state-change' && (facet as any).targetFacetIds) {
        const stateChange = facet as any;
        
        for (const targetId of stateChange.targetFacetIds) {
          const targetFacet = state.facets.get(targetId);
          if (!targetFacet) continue;
          
          const changes: any = {};
          
          if (stateChange.state?.changes?.content?.new) {
            changes.content = stateChange.state.changes.content.new;
          }
          
          if (stateChange.state?.changes?.isOpen?.new !== undefined) {
            changes.state = {
              ...(targetFacet as any).state,
              isOpen: stateChange.state.changes.isOpen.new
            };
          }
          
          if (Object.keys(changes).length > 0) {
            deltas.push({
              type: 'rewriteFacet',
              id: targetId,
              changes
            });
          }
        }
        
        deltas.push({
          type: 'removeFacet',
          id
        });
      }
    }
    
    return deltas;
  }
}

class DispenseEffector extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).state?.eventType;
      if (eventType !== 'button-press') continue;
      
      const dispenserState = this.getComponentState<{ boxCount: number; size: string; color: string }>();
      const boxCount = (dispenserState.boxCount || 0) + 1;
      const size = dispenserState.size || 'medium';
      const color = dispenserState.color || 'blue';
      
      console.log(`[DispenseEffector] Dispensing box #${boxCount} (${size}, ${color})`);
      
      this.updateComponentState({ boxCount, lastDispensed: Date.now() });
      
      events.push({
        topic: 'element:create',
        source: { elementId: this.element.id, elementPath: [] },
        timestamp: Date.now(),
        payload: {
          parentId: 'root',
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
                boxElementId: '{{result.elementId}}'
              }
            },
            condition: 'success'
          }]
        }
      });
    }
    
    return { events };
  }
}

class BoxComponent extends BaseEffector {
  facetFilters = [{ type: 'event' }];
  
  static actions = {
    open: {
      description: 'Open this box',
      parameters: {
        method: { type: 'string', enum: ['gently', 'forcefully', 'carefully'], required: false }
      }
    }
  };
  
  async onMount(): Promise<void> {
    (this as any).actions = new Map();
    (this as any).actions.set('open', this.open.bind(this));
    
    const config = this.getComponentState<{
      boxId: number;
      size: string;
      color: string;
      contents: string;
      isOpen: boolean;
    }>();
    
    this.emitFacet({
      id: `${this.element.id}-state`,
      type: 'state',
      content: `A ${config.size} ${config.color} box sits here, closed and mysterious.`,
      entityType: 'element',
      entityId: this.element.id,
      state: config
    });
    
    this.emitFacet({
      id: `${this.element.id}-hint`,
      type: 'ambient',
      content: `You can open this box with @${this.element.id}.open()`
    });
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      const eventType = (change.facet as any).state?.eventType;
      const boxId = (change.facet as any).attributes?.boxId;
      const myBoxId = this.getComponentState().boxId;
      
      if (eventType === 'box-opened' && boxId == myBoxId) {
        const config = this.getComponentState();
        this.updateComponentState({ isOpen: true });
        
        const openEffect = this.getOpeningEffect(config.color);
        this.emitFacet({
          id: `${this.element.id}-state-change-${Date.now()}`,
          type: 'state-change',
          targetFacetIds: [`${this.element.id}-state`],
          state: {
            changes: {
              isOpen: { old: false, new: true },
              content: { 
                old: `A ${config.size} ${config.color} box sits here, closed and mysterious.`,
                new: `The ${config.size} ${config.color} box is open, revealing ${config.contents}!`
              }
            }
          },
          ephemeral: true
        });
        
        this.emitEventFacet(`The box opens with a ${openEffect}!`);
      }
    }
    
    return { events: [] };
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
  
  async open(params?: { method?: string }): Promise<void> {
    const method = params?.method || 'normally';
    const config = this.getComponentState();
    
    if (config.isOpen) {
      this.addEvent('The box is already open!', 'box-already-open');
      return;
    }
    
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
// APPLICATION WITH SNAPSHOT TESTING
// ============================================

class DispenserSnapshotTestApp implements ConnectomeApplication {
  async createSpace(hostRegistry?: Map<string, any>): Promise<{ space: Space; veilState: VEILStateManager }> {
    const veilState = new VEILStateManager();
    const space = new Space(veilState, hostRegistry);
    return { space, veilState };
  }
  
  async initialize(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🎮 Initializing Box Dispenser with Snapshot Testing...\n');
    
    // Register components
    ComponentRegistry.register('ConsoleAfferent', ConsoleAfferent);
    ComponentRegistry.register('DispenseEffector', DispenseEffector);
    ComponentRegistry.register('BoxComponent', BoxComponent);
    
    // Add infrastructure
    space.addReceptor(new ElementRequestReceptor());
    space.addTransform(new ContinuationTransform());
    space.addTransform(new BoxStateTransform());
    
    // *** ADD FRAME SNAPSHOT TRANSFORM ***
    const snapshotTransform = new FrameSnapshotTransform({
      enabled: true,
      verbose: true  // Log each snapshot capture
    });
    space.addTransform(snapshotTransform);
    console.log('📸 Frame snapshot capture enabled (priority 200)\n');
    
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
    
    // Add dispenser
    space.addReceptor(new DispenseButtonReceptor());
    space.addReceptor(new BoxOpenReceptor());
    space.addReceptor(new DispenserCommandReceptor());
    space.addEffector(new DispenserCommandEffector());
    
    // Create dispenser element
    const dispenserElem = new Element('dispenser');
    space.addChild(dispenserElem);
    
    const dispenseEffector = new DispenseEffector();
    await dispenserElem.addComponentAsync(dispenseEffector);
    
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
              color: 'rainbow'
            }
          }
        }
      }
    });
    
    space.addEffector(dispenseEffector);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Create agent
    const agentElem = new Element('agent');
    space.addChild(agentElem);
    
    const llmProvider = (space as any).getReference?.('provider:llm.primary') || 
                        (space as any).getReference?.('llmProvider');
    
    const agent = new BasicAgent({
      config: {
        name: 'SnapshotTestAgent',
        systemPrompt: `You are observing a box dispenser. React briefly to boxes being created and opened.`
      },
      provider: llmProvider,
      veilStateManager: veilState
    });
    
    space.addEffector(new AgentEffector(agentElem, agent));
    space.addTransform(new ContextTransform(veilState));
    
    console.log('✅ Dispenser initialized with snapshot capture\n');
    console.log('Commands:');
    console.log('  - Type "press button" to dispense a box');
    console.log('  - Type "open box-N" to open a box');
    console.log('  - Type "/snapshots" to inspect snapshots');
    console.log('  - Type "/quit" to exit\n');
  }
  
  getComponentRegistry(): typeof ComponentRegistry {
    return ComponentRegistry;
  }
  
  async onStart(space: Space, veilState: VEILStateManager): Promise<void> {
    console.log('🚀 Dispenser with snapshot testing started!\n');
    console.log('Debug server enabled on port 3100');
    console.log('Connect inspector: npx tsx examples/inspect-snapshots.ts\n');
    
    // Dispense first box
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
  console.log('📸 Frame Snapshot Testing with Box Dispenser');
  console.log('=============================================\n');
  
  const mockProvider = new MockLLMProvider();
  mockProvider.setResponses([
    "Ooh! A rainbow box appears!",
    "How exciting! Let's see what's inside!",
    "Wow! The contents are revealed!",
    "Another box! Delightful!",
  ]);
  
  const app = new DispenserSnapshotTestApp();
  
  const host = new ConnectomeHost({
    providers: {
      'llm.primary': mockProvider
    },
    persistence: {
      enabled: false
    },
    debug: {
      enabled: true,  // Enable debug server
      port: 3100
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

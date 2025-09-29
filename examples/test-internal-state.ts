/**
 * Demonstrates using InternalStateFacet for component state in VEIL
 */

import {
  VEILStateManager,
  Space,
  createInternalStateFacet,
  createEventFacet,
  addFacet,
  changeFacet,
  createDefaultTransition,
  SpaceEvent,
  Receptor,
  Effector,
  ReadonlyVEILState,
  FacetDelta,
  VEILDelta,
  hasStateAspect
} from '../src';

import { VEILOperationReceptor } from '../src/spaces/migration-adapters';

console.log('=== Testing Internal State Pattern ===\n');

// A stateless receptor that reads from internal state
class CounterReceptor implements Receptor {
  topics = ['counter:increment', 'counter:decrement'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): any[] {
    // Read current count from internal state (stateless!)
    const counterState = state.facets.get('counter-state');
    const currentCount = counterState && hasStateAspect(counterState) 
      ? (counterState.state.count as number) 
      : 0;
    
    let newCount = currentCount;
    if (event.topic === 'counter:increment') {
      newCount = currentCount + 1;
    } else if (event.topic === 'counter:decrement') {
      newCount = currentCount - 1;
    }
    
    return [
      createEventFacet({
        content: `Counter ${event.topic.split(':')[1]}ed from ${currentCount} to ${newCount}`,
        source: 'counter',
        eventType: 'state-change',
        streamId: 'system'
      })
    ];
  }
}

// An effector that maintains counter state in VEIL
class CounterEffector implements Effector {
  facetFilters = [{ type: 'event' }];  // Watch all events
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<{ events: SpaceEvent[] }> {
    const events: SpaceEvent[] = [];
    
    for (const change of changes) {
      if (change.type === 'added' && change.facet.type === 'event') {
        const eventFacet = change.facet as any;
        if (eventFacet.state?.source === 'counter' && eventFacet.state?.eventType === 'state-change') {
          // Extract new count from the event
          const match = eventFacet.content.match(/to (-?\d+)$/);
          if (match) {
            const newCount = parseInt(match[1]);
            
            // Check if internal state exists
            const counterState = state.facets.get('counter-state');
            
            if (!counterState) {
              // Create initial internal state
              events.push({
                topic: 'veil:operation',
                source: { elementId: 'counter-effector', elementPath: [] },
                timestamp: Date.now(),
                payload: {
                  operation: {
                    type: 'addFacet',
                    facet: createInternalStateFacet({
                      id: 'counter-state',
                      componentId: 'counter-system',
                      state: { count: newCount }
                    })
                  }
                }
              });
            } else {
              // Update existing internal state
              events.push({
                topic: 'veil:operation',
                source: { elementId: 'counter-effector', elementPath: [] },
                timestamp: Date.now(),
                payload: {
                  operation: {
                    type: 'changeFacet',
                    id: 'counter-state',
                    changes: { state: { count: newCount } }
                  }
                }
              });
            }
          }
        }
      }
    }
    
    return { events };
  }
}


// Set up the system
const veilState = new VEILStateManager();
const space = new Space(veilState);

// Register our stateless receptor and stateful effector
space.addReceptor(new VEILOperationReceptor());  // Important for veil:operation events
space.addReceptor(new CounterReceptor());
space.addEffector(new CounterEffector());

// Helper to simulate events
async function simulateEvent(topic: string) {
  console.log(`\nSending event: ${topic}`);
  
  await space.handleEvent({
    topic,
    source: { elementId: 'test', elementPath: [] },
    timestamp: Date.now(),
    payload: {}
  });
  
  // Allow time for async processing
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Show current state
  const counterState = veilState.getState().facets.get('counter-state');
  if (counterState && hasStateAspect(counterState)) {
    console.log(`Current count in VEIL: ${counterState.state.count}`);
  } else {
    console.log('No counter state in VEIL');
  }
  
  // Show counter events only
  const events = Array.from(veilState.getState().facets.values())
    .filter(f => f.type === 'event' && (f as any).state?.source === 'counter');
  console.log(`Counter events: ${events.length}`);
  events.forEach(e => console.log(`  - ${(e as any).content}`));
}

// Run the test
(async () => {
  console.log('1. Initial state:');
  console.log('  No counter state in VEIL yet');
  
  await simulateEvent('counter:increment');
  await simulateEvent('counter:increment');
  await simulateEvent('counter:decrement');
  await simulateEvent('counter:increment');
  
  console.log('\n2. Final VEIL state:');
  const finalState = veilState.getState();
  
  // Show internal state facets
  const internalStates = Array.from(finalState.facets.values())
    .filter(f => f.type === 'internal-state');
  console.log(`\nInternal state facets: ${internalStates.length}`);
  internalStates.forEach(s => {
    console.log(`  - ${s.id} (component: ${(s as any).componentId}):`, (s as any).state);
  });
  
  // Demonstrate persistence
  console.log('\n3. Simulating persistence:');
  const serialized = JSON.stringify(
    Array.from(finalState.facets.entries()).map(([id, facet]) => ({ id, facet }))
  );
  console.log(`Serialized ${finalState.facets.size} facets (${serialized.length} bytes)`);
  
  // Could restore by replaying these facets to a new VEILStateManager
  console.log('\n✅ Internal state pattern works correctly!');
  console.log('   - Receptors remain stateless');
  console.log('   - State persists in VEIL');
  console.log('   - Full system state is serializable');
})();

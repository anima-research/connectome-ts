/**
 * Simple test to debug the three-phase processing
 */

import { 
  Space,
  VEILStateManager,
  Receptor,
  Transform,
  Effector,
  ReadonlyVEILState,
  SpaceEvent,
  Facet,
  FacetDelta,
  EffectorResult
} from '../src';

// Simple receptor that creates a facet
class DebugReceptor implements Receptor {
  topics = ['test:input'];
  
  transform(event: SpaceEvent): Facet[] {
    console.log('[DebugReceptor] Transforming event:', event.topic);
    const payload = event.payload as { value: string };
    return [{
      id: `test-facet-${Date.now()}`,
      type: 'test-facet',
      content: payload.value,
      temporal: 'persistent'
    }];
  }
}

// Simple transform that looks for test facets
class DebugTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    console.log('[DebugTransform] Processing state with', state.facets.size, 'facets');
    
    const testFacets = Array.from(state.facets.values()).filter(f => f.type === 'test-facet');
    console.log('[DebugTransform] Found', testFacets.length, 'test facets');
    
    return testFacets.map(f => ({
      id: `derived-${f.id}`,
      type: 'derived-facet',
      content: `Derived from: ${f.content}`,
      temporal: 'ephemeral',
      attributes: {
        sourceId: f.id
      }
    }));
  }
}

// Simple effector that logs changes
class DebugEffector implements Effector {
  facetFilters = [{ type: ['test-facet', 'derived-facet'] }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    console.log('[DebugEffector] Processing', changes.length, 'changes');
    for (const change of changes) {
      console.log(`  - ${change.type} ${change.facet.type}: ${change.facet.content}`);
    }
    return { events: [] };
  }
}

async function main() {
  console.log('=== Three-Phase Debug Test ===\n');
  
  // Create VEIL state and Space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register pipeline
  space.addReceptor(new DebugReceptor());
  space.addTransform(new DebugTransform());
  space.addEffector(new DebugEffector());
  
  console.log('Pipeline registered\n');
  
  // Emit test event
  console.log('Emitting test event...\n');
  space.emit({
    topic: 'test:input',
    source: { elementId: 'test', elementPath: [] },
    timestamp: Date.now(),
    payload: { value: 'Hello World' }
  });
  
  // Give it time to process
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n=== Test complete ===');
  process.exit(0);
}

main().catch(console.error);

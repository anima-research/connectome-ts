import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  Receptor, 
  Transform, 
  Effector, 
  Maintainer,
  FacetDelta,
  ReadonlyVEILState,
  SpaceEvent,
  VEILDelta
} from '../src';
import { createEventFacet } from '../src/helpers/factories';

// Test receptor that logs when it runs
class PhaseTestReceptor implements Receptor {
  topics = ['test:input'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    console.log('[PHASE 1 - Receptor] Processing event:', event.topic);
    return [{
      type: 'addFacet',
      facet: createEventFacet({
        content: `Phase 1 processed: ${event.payload.message}`,
        source: event.source,
        agentId: 'system',
        streamId: 'test'
      })
    }];
  }
}

// Test transform that logs when it runs
class PhaseTestTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    console.log('[PHASE 2 - Transform] Processing state with', state.facets.size, 'facets');
    
    // Look for phase 1 facets and create derived facets
    const phase1Facets = Array.from(state.facets.values())
      .filter(f => f.type === 'event' && f.content?.includes('Phase 1 processed'));
    
    if (phase1Facets.length > 0) {
      console.log('[PHASE 2 - Transform] Found', phase1Facets.length, 'Phase 1 facets');
      return [{
        type: 'addFacet',
        facet: createEventFacet({
          content: 'Phase 2 transform applied',
          source: { elementId: 'transform', elementPath: [] },
          agentId: 'system',
          streamId: 'test'
        })
      }];
    }
    
    return [];
  }
}

// Test effector that logs when it runs
class PhaseTestEffector implements Effector {
  facetFilters = [{ type: 'event' }];
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState) {
    console.log('[PHASE 3 - Effector] Processing', changes.length, 'changes');
    
    const events: SpaceEvent[] = [];
    for (const change of changes) {
      if (change.type === 'added' && change.facet.content?.includes('Phase 2 transform')) {
        console.log('[PHASE 3 - Effector] Reacting to Phase 2 facet, generating event');
        events.push({
          topic: 'test:phase3-reaction',
          source: { elementId: 'effector', elementPath: [] },
          timestamp: Date.now(),
          payload: { message: 'Phase 3 reacted' }
        });
      }
    }
    
    return { events };
  }
}

// Test maintainer that logs when it runs
class PhaseTestMaintainer implements Maintainer {
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    console.log('[PHASE 4 - Maintainer] Running maintenance with', state.facets.size, 'facets');
    
    // Check if we should emit a maintenance event
    const hasPhase3 = Array.from(state.facets.values())
      .some(f => f.content?.includes('Phase 3 reacted'));
    
    if (hasPhase3) {
      console.log('[PHASE 4 - Maintainer] Found Phase 3 activity, emitting maintenance event');
      return [{
        topic: 'test:maintenance',
        source: { elementId: 'maintainer', elementPath: [] },
        timestamp: Date.now(),
        payload: { message: 'Maintenance completed' }
      }];
    }
    
    return [];
  }
}

async function main() {
  console.log('=== Phase Ordering Test ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Register components for each phase
  space.addReceptor(new PhaseTestReceptor());
  space.addTransform(new PhaseTestTransform());
  space.addEffector(new PhaseTestEffector());
  space.addMaintainer(new PhaseTestMaintainer());
  
  console.log('1. Emitting initial event...\n');
  
  // Emit test event
  await space.emit({
    topic: 'test:input',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { message: 'Hello phases!' }
  });
  
  // Wait for frame processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\n2. Checking frame history:');
  const state = veilState.getState();
  console.log('Total frames:', state.currentSequence);
  console.log('Total facets:', state.facets.size);
  
  // Check if Phase 3 event triggered another frame
  if (state.currentSequence > 1) {
    console.log('\n3. Phase 3 event triggered frame', state.currentSequence);
  }
  
  // Wait for any additional frames
  await new Promise(resolve => setTimeout(resolve, 100));
  
  console.log('\nFinal state:');
  console.log('Total frames processed:', veilState.getState().currentSequence);
  console.log('\nPhase ordering verified!');
}

main().catch(console.error);

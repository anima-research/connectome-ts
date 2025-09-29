import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import {
  Receptor,
  Transform,
  ReadonlyVEILState,
  SpaceEvent,
  VEILDelta
} from '../src';
import { createEventFacet } from '../src/helpers/factories';
import { v4 as uuidv4 } from 'uuid';

// Receptor that creates both ephemeral and persistent facets
class MixedFacetReceptor implements Receptor {
  topics = ['test:create-mixed'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const { ephemeral, persistent } = event.payload;
    const deltas: VEILDelta[] = [];
    
    if (ephemeral) {
      // Create ephemeral facet
      deltas.push({
        type: 'addFacet',
        facet: {
          id: `ephemeral-${uuidv4()}`,
          type: 'test-ephemeral',
          ephemeral: true,
          content: 'This facet should disappear',
          timestamp: Date.now()
        }
      });
    }
    
    if (persistent) {
      // Create persistent facet
      deltas.push({
        type: 'addFacet',
        facet: createEventFacet({
          content: 'This facet should persist',
          source: event.source,
          agentId: 'system',
          streamId: 'test'
        })
      });
    }
    
    return deltas;
  }
}

// Transform that looks for ephemeral facets
class EphemeralDetectorTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    const ephemeralFacets = Array.from(state.facets.values())
      .filter(f => f.ephemeral === true);
    
    if (ephemeralFacets.length > 0) {
      console.log(`[EphemeralDetector] Found ${ephemeralFacets.length} ephemeral facets in current frame`);
      
      // Create a record of what we saw
      return [{
        type: 'addFacet',
        facet: createEventFacet({
          content: `Detected ${ephemeralFacets.length} ephemeral facets: ${ephemeralFacets.map(f => f.id).join(', ')}`,
          source: { elementId: 'ephemeral-detector', elementPath: [] },
          agentId: 'system',
          streamId: 'test'
        })
      }];
    }
    
    return [];
  }
}

// Transform that tries to reference ephemeral facets from previous frames
class EphemeralReferenceTransform implements Transform {
  private seenEphemeralIds = new Set<string>();
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Look for ephemeral facets
    const currentEphemeral = Array.from(state.facets.values())
      .filter(f => f.ephemeral === true);
    
    // Check if any previously seen ephemeral facets still exist
    const stillExisting = Array.from(this.seenEphemeralIds)
      .filter(id => state.hasFacet(id));
    
    if (stillExisting.length > 0) {
      console.log(`WARNING: Found ${stillExisting.length} ephemeral facets from previous frames!`);
      console.log('IDs:', stillExisting);
    }
    
    // Update our tracking
    currentEphemeral.forEach(f => this.seenEphemeralIds.add(f.id));
    
    return [];
  }
}

async function testEphemeralLifecycle() {
  console.log('=== Testing Ephemeral Facet Lifecycle ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  space.addReceptor(new MixedFacetReceptor());
  space.addTransform(new EphemeralDetectorTransform());
  space.addTransform(new EphemeralReferenceTransform());
  
  // Frame 1: Create both types
  console.log('Frame 1: Creating ephemeral and persistent facets');
  await space.emit({
    topic: 'test:create-mixed',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { ephemeral: true, persistent: true }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  let state = veilState.getState();
  const frame1Ephemeral = Array.from(state.facets.values())
    .filter(f => f.ephemeral === true);
  const frame1Persistent = Array.from(state.facets.values())
    .filter(f => f.type === 'event' && f.content?.includes('should persist'));
  
  console.log(`After Frame 1: ${frame1Ephemeral.length} ephemeral, ${frame1Persistent.length} persistent`);
  
  // Frame 2: Create more facets
  console.log('\nFrame 2: Creating only persistent facets');
  await space.emit({
    topic: 'test:create-mixed',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { ephemeral: false, persistent: true }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  state = veilState.getState();
  const frame2Ephemeral = Array.from(state.facets.values())
    .filter(f => f.ephemeral === true);
  const frame2Persistent = Array.from(state.facets.values())
    .filter(f => f.type === 'event' && f.content?.includes('should persist'));
  
  console.log(`After Frame 2: ${frame2Ephemeral.length} ephemeral, ${frame2Persistent.length} persistent`);
  console.log('Ephemeral facets from Frame 1 should be gone');
  
  // Frame 3: Create more ephemeral
  console.log('\nFrame 3: Creating more ephemeral facets');
  await space.emit({
    topic: 'test:create-mixed',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { ephemeral: true, persistent: false }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  state = veilState.getState();
  const frame3Ephemeral = Array.from(state.facets.values())
    .filter(f => f.ephemeral === true);
  
  console.log(`After Frame 3: ${frame3Ephemeral.length} ephemeral facets`);
}

async function testEphemeralInPersistence() {
  console.log('\n\n=== Testing Ephemeral Facets in Persistence ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  space.addReceptor(new MixedFacetReceptor());
  
  // Create ephemeral facets
  await space.emit({
    topic: 'test:create-mixed',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: { ephemeral: true, persistent: true }
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Simulate persistence by serializing state
  const state = veilState.getState();
  const serialized = JSON.stringify({
    facets: Array.from(state.facets.entries()),
    currentSequence: state.currentSequence
  });
  
  console.log('State serialized to JSON');
  
  // Count facets in serialized form
  const parsed = JSON.parse(serialized);
  const ephemeralInSerialized = parsed.facets
    .filter(([_, f]: [string, any]) => f.ephemeral === true);
  const persistentInSerialized = parsed.facets
    .filter(([_, f]: [string, any]) => f.ephemeral !== true);
  
  console.log(`Serialized state contains:`);
  console.log(`- ${ephemeralInSerialized.length} ephemeral facets (should be included)`);
  console.log(`- ${persistentInSerialized.length} persistent facets`);
  
  // Create new state from serialized
  const newVeilState = new VEILStateManager();
  const newSpace = new Space(newVeilState);
  
  // Note: In real persistence, ephemeral facets should be filtered out
  console.log('\nIn real persistence, ephemeral facets should be filtered during save');
}

async function testEphemeralCleanupDisabled() {
  console.log('\n\n=== Verifying Ephemeral Cleanup is Disabled ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  space.addReceptor(new MixedFacetReceptor());
  
  // Create many frames with ephemeral facets
  console.log('Creating 10 frames with ephemeral facets...');
  for (let i = 0; i < 10; i++) {
    await space.emit({
      topic: 'test:create-mixed',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { ephemeral: true, persistent: false }
    });
  }
  
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const state = veilState.getState();
  const allEphemeral = Array.from(state.facets.values())
    .filter(f => f.ephemeral === true);
  
  console.log(`\nTotal ephemeral facets in state: ${allEphemeral.length}`);
  console.log('(Should be from the last frame only, others naturally ignored)');
  
  // Verify frame history doesn't grow indefinitely
  console.log(`Frame history length: ${state.frameHistory.length}`);
}

async function main() {
  await testEphemeralLifecycle();
  await testEphemeralInPersistence();
  await testEphemeralCleanupDisabled();
  
  console.log('\n\nEphemeral facet tests complete!');
}

main().catch(console.error);

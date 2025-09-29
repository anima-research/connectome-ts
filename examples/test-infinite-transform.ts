import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  Transform, 
  ReadonlyVEILState,
  VEILDelta,
  hasContentAspect
} from '../src';
import { createEventFacet } from '../src/helpers/factories';

// Evil transform that always generates new facets
class InfiniteTransform implements Transform {
  private counter = 0;
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    this.counter++;
    console.log(`[InfiniteTransform] Iteration ${this.counter}`);
    
    // Always generate a new facet, triggering another iteration
    return [{
      type: 'addFacet',
        facet: createEventFacet({
          content: `Infinite loop iteration ${this.counter}`,
          source: 'infinite-transform',
          eventType: 'infinite',
          streamId: 'test'
        })
    }];
  }
}

// Transform that creates facets based on existing facets
class CascadingTransform implements Transform {
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Count how many cascade facets exist
    const cascadeFacets = Array.from(state.facets.values())
      .filter(f => hasContentAspect(f) && f.content.includes('Cascade level'));
    
    // If we have less than 200 cascade facets, create more
    if (cascadeFacets.length < 200) {
      const level = cascadeFacets.length + 1;
      return [{
        type: 'addFacet',
        facet: createEventFacet({
          content: `Cascade level ${level}`,
          source: 'cascade-transform',
          eventType: 'cascade',
          streamId: 'test'
        })
      }];
    }
    
    return [];
  }
}

async function testInfiniteLoop() {
  console.log('=== Testing Infinite Transform Loop ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add the infinite transform
  space.addTransform(new InfiniteTransform());
  
  console.log('1. Triggering frame with infinite transform...\n');
  
  try {
    // This should throw an error after 100 iterations
    await space.emit({
      topic: 'test:trigger',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { message: 'Start infinite loop' }
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('\nERROR: Should have thrown an error!');
  } catch (error) {
    console.log('\nSUCCESS: Caught expected error:');
    console.log(error instanceof Error ? error.message : String(error));
  }
}

async function testCascadingTransform() {
  console.log('\n\n=== Testing Cascading Transform ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add the cascading transform
  space.addTransform(new CascadingTransform());
  
  console.log('1. Triggering frame with cascading transform...\n');
  
  try {
    // This should also hit the limit
    await space.emit({
      topic: 'test:cascade',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { message: 'Start cascade' }
    });
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('\nERROR: Should have thrown an error!');
  } catch (error) {
    console.log('\nSUCCESS: Caught expected error:');
    console.log(error instanceof Error ? error.message : String(error));
    
    // Check how many facets were created before hitting the limit
    const state = veilState.getState();
    const cascadeFacets = Array.from(state.facets.values())
      .filter(f => hasContentAspect(f) && f.content.includes('Cascade level'));
    console.log(`\nCreated ${cascadeFacets.length} cascade facets before hitting limit`);
  }
}

async function main() {
  await testInfiniteLoop();
  await testCascadingTransform();
  
  console.log('\n\nPhase 2 loop limit tests complete!');
}

main().catch(console.error);

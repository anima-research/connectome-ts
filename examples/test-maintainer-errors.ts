import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  Maintainer,
  ReadonlyVEILState,
  SpaceEvent
} from '../src';

// Maintainer that throws errors
class ErrorThrowingMaintainer implements Maintainer {
  private callCount = 0;
  
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    this.callCount++;
    console.log(`[ErrorMaintainer] Call #${this.callCount}`);
    
    if (this.callCount % 3 === 0) {
      throw new Error(`Maintainer error on call ${this.callCount}`);
    }
    
    return [];
  }
}

// Maintainer that generates too many events
class EventStormMaintainer implements Maintainer {
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    const eventCount = 100;
    console.log(`[EventStormMaintainer] Generating ${eventCount} events`);
    
    const events: SpaceEvent[] = [];
    for (let i = 0; i < eventCount; i++) {
      events.push({
        topic: 'test:storm-event',
        source: { elementId: 'storm-maintainer', elementPath: [] },
        timestamp: Date.now(),
        payload: { id: i, message: `Storm event ${i}` }
      });
    }
    
    return events;
  }
}

// Maintainer that takes too long
class SlowMaintainer implements Maintainer {
  async maintain(state: ReadonlyVEILState): Promise<SpaceEvent[]> {
    console.log('[SlowMaintainer] Starting slow operation...');
    
    // Simulate expensive computation
    const start = Date.now();
    let sum = 0;
    for (let i = 0; i < 100000000; i++) {
      sum += Math.sqrt(i);
    }
    
    const elapsed = Date.now() - start;
    console.log(`[SlowMaintainer] Completed in ${elapsed}ms`);
    
    return [{
      topic: 'test:slow-complete',
      source: { elementId: 'slow-maintainer', elementPath: [] },
      timestamp: Date.now(),
      payload: { computeTime: elapsed, result: sum }
    }];
  }
}

// Maintainer that tries to modify state (should fail)
class StateMutatingMaintainer implements Maintainer {
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    console.log('[StateMutatingMaintainer] Attempting to mutate state...');
    
    try {
      // This should fail - state is readonly
      (state as any).facets.set('illegal', { 
        type: 'illegal',
        content: 'This should not work' 
      });
      console.log('ERROR: State mutation succeeded!');
    } catch (error) {
      console.log('SUCCESS: State mutation prevented:', error.message);
    }
    
    return [];
  }
}

// Maintainer that generates events based on previous events (potential loop)
class RecursiveMaintainer implements Maintainer {
  maintain(state: ReadonlyVEILState): SpaceEvent[] {
    // Count recursive events
    const recursiveEvents = Array.from(state.facets.values())
      .filter(f => f.type === 'event' && f.content?.includes('Recursive event'));
    
    console.log(`[RecursiveMaintainer] Found ${recursiveEvents.length} recursive events`);
    
    // Generate more if under threshold
    if (recursiveEvents.length < 5) {
      return [{
        topic: 'test:recursive',
        source: { elementId: 'recursive-maintainer', elementPath: [] },
        timestamp: Date.now(),
        payload: { 
          level: recursiveEvents.length + 1,
          message: `Recursive event level ${recursiveEvents.length + 1}`
        }
      }];
    }
    
    return [];
  }
}

async function testMaintainerErrors(space: Space) {
  console.log('=== Testing Error Handling ===\n');
  
  space.addMaintainer(new ErrorThrowingMaintainer());
  
  // Generate several frames to trigger errors
  for (let i = 0; i < 5; i++) {
    console.log(`\nFrame ${i + 1}:`);
    await space.emit({
      topic: 'test:trigger',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { frame: i }
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const state = space.getVEILState().getState();
  console.log(`\nSystem still running. Total frames: ${state.currentSequence}`);
}

async function testEventStorm(space: Space) {
  console.log('\n\n=== Testing Event Storm ===\n');
  
  const veilState = new VEILStateManager();
  const stormSpace = new Space(veilState);
  stormSpace.addMaintainer(new EventStormMaintainer());
  
  const startTime = Date.now();
  await stormSpace.emit({
    topic: 'test:start-storm',
    source: stormSpace.getRef(),
    timestamp: Date.now(),
    payload: { message: 'Start the storm!' }
  });
  
  // Wait for storm to process
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const elapsed = Date.now() - startTime;
  const finalState = veilState.getState();
  
  console.log(`\nStorm results:`);
  console.log(`- Processing time: ${elapsed}ms`);
  console.log(`- Total frames generated: ${finalState.currentSequence}`);
  console.log(`- Events queued properly: ${finalState.currentSequence > 10 ? 'YES' : 'NO'}`);
}

async function testSlowMaintainer() {
  console.log('\n\n=== Testing Slow Maintainer ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  space.addMaintainer(new SlowMaintainer());
  
  console.log('Note: This will take a few seconds...');
  const startTime = Date.now();
  
  await space.emit({
    topic: 'test:slow',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {}
  });
  
  // Check if system remains responsive
  const checkInterval = setInterval(() => {
    console.log('System check: Still responsive');
  }, 500);
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  clearInterval(checkInterval);
  
  console.log(`Total time: ${Date.now() - startTime}ms`);
}

async function testStateMutation() {
  console.log('\n\n=== Testing State Mutation Prevention ===\n');
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  space.addMaintainer(new StateMutatingMaintainer());
  
  await space.emit({
    topic: 'test:mutate',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {}
  });
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Verify state integrity
  const state = veilState.getState();
  const illegalFacet = Array.from(state.facets.values())
    .find(f => f.type === 'illegal');
  
  console.log(`\nState integrity maintained: ${!illegalFacet ? 'YES' : 'NO'}`);
}

async function main() {
  console.log('=== Maintainer Error & Edge Case Tests ===\n');
  
  // Test 1: Error handling
  const space1 = new Space(new VEILStateManager());
  await testMaintainerErrors(space1);
  
  // Test 2: Event storms
  await testEventStorm(space1);
  
  // Test 3: Slow maintainer
  await testSlowMaintainer();
  
  // Test 4: State mutation prevention
  await testStateMutation();
  
  console.log('\n\nAll maintainer tests complete!');
}

main().catch(console.error);

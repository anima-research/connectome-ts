import { Space } from '../src/spaces/space';
import { VEILStateManager } from '../src/veil/veil-state';
import { 
  PersistenceMaintainer,
  TransitionMaintainer,
  ConsoleInputReceptor
} from '../src';
import { createEventFacet, createStateFacet } from '../src/helpers/factories';
import * as fs from 'fs/promises';
import * as path from 'path';

async function cleanupTestDirs() {
  const dirs = ['./test-persistence-stress', './test-transitions-stress'];
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  }
}

async function generateManyFrames(space: Space, count: number) {
  console.log(`Generating ${count} frames...`);
  const startTime = Date.now();
  
  for (let i = 0; i < count; i++) {
    // Emit different types of events to create variety
    if (i % 10 === 0) {
      // Every 10th frame, create a state facet
      await space.emit({
        topic: 'veil:operation',
        source: space.getRef(),
        timestamp: Date.now(),
        payload: {
          operations: [{
            type: 'addFacet',
            facet: createStateFacet({
              entityType: 'component',
              entityId: 'stress-test',
              content: `Stress test state at frame ${i}`,
              attributes: {
                frameCount: i,
                timestamp: Date.now(),
                data: Array(100).fill('x').join('') // Some bulk data
              }
            })
          }]
        }
      });
    } else {
      // Regular event
      await space.emit({
        topic: 'test:stress',
        source: space.getRef(),
        timestamp: Date.now(),
        payload: { 
          frame: i,
          message: `Frame ${i} of ${count}`
        }
      });
    }
    
    // Progress indicator
    if (i % 100 === 0 && i > 0) {
      const elapsed = Date.now() - startTime;
      const rate = i / (elapsed / 1000);
      console.log(`Progress: ${i}/${count} frames (${rate.toFixed(1)} frames/sec)`);
    }
    
    // Small delay every 50 frames to let the system breathe
    if (i % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`\nGenerated ${count} frames in ${totalTime}ms (${(count / (totalTime / 1000)).toFixed(1)} frames/sec)`);
}

async function verifyPersistence(baseDir: string) {
  console.log(`\nVerifying persistence in ${baseDir}...`);
  
  // Check snapshots
  const snapshotDir = path.join(baseDir, 'snapshots');
  try {
    const snapshots = await fs.readdir(snapshotDir);
    console.log(`Found ${snapshots.length} snapshot files`);
    
    // Verify snapshot integrity
    for (const file of snapshots.slice(0, 3)) { // Check first 3
      const content = await fs.readFile(path.join(snapshotDir, file), 'utf8');
      const snapshot = JSON.parse(content);
      console.log(`- ${file}: sequence ${snapshot.sequence}, ${snapshot.veilState.facets.length} facets`);
    }
  } catch (e) {
    console.log('No snapshots directory found');
  }
  
  // Check deltas
  const deltaDir = path.join(baseDir, 'deltas');
  try {
    const deltas = await fs.readdir(deltaDir);
    console.log(`Found ${deltas.length} delta files`);
    
    // Check file sizes
    let totalSize = 0;
    for (const file of deltas) {
      const stats = await fs.stat(path.join(deltaDir, file));
      totalSize += stats.size;
    }
    console.log(`Total delta size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.log('No deltas directory found');
  }
}

async function testConcurrentWrites(space: Space) {
  console.log('\n=== Testing Concurrent Writes ===');
  
  // Generate many events simultaneously
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(space.emit({
      topic: 'test:concurrent',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: { id: i }
    }));
  }
  
  await Promise.all(promises);
  console.log('Emitted 50 concurrent events');
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function main() {
  console.log('=== Persistence Stress Test ===\n');
  
  await cleanupTestDirs();
  
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  
  // Add receptor for test events
  space.addReceptor(new ConsoleInputReceptor());
  
  // Add persistence with aggressive settings
  const persistenceMaintainer = new PersistenceMaintainer(veilState, {
    storagePath: './test-persistence-stress',
    snapshotInterval: 50, // Snapshot every 50 frames
    maxDeltasPerFile: 100 // Small files to test file management
  });
  space.addMaintainer(persistenceMaintainer);
  
  const transitionMaintainer = new TransitionMaintainer(veilState, {
    storagePath: './test-transitions-stress',
    snapshotInterval: 25 // Even more aggressive
  });
  space.addMaintainer(transitionMaintainer);
  
  // Test 1: Generate many frames
  await generateManyFrames(space, 1000);
  
  // Test 2: Concurrent writes
  await testConcurrentWrites(space);
  
  // Wait for all persistence to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Verify results
  await verifyPersistence('./test-persistence-stress');
  
  // Check final state
  const finalState = veilState.getState();
  console.log('\n=== Final State ===');
  console.log(`Total frames: ${finalState.currentSequence}`);
  console.log(`Total facets: ${finalState.facets.size}`);
  console.log(`Frame history length: ${finalState.frameHistory.length}`);
  
  // Memory check
  const memUsage = process.memoryUsage();
  console.log('\n=== Memory Usage ===');
  console.log(`Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('\nStress test complete!');
}

main().catch(console.error);

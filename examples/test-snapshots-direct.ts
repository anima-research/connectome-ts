#!/usr/bin/env tsx
/**
 * Direct Frame Snapshot Test
 * 
 * Tests snapshot capture without debug server dependency.
 * Directly inspects frame objects after processing.
 */

import {
  Space,
  VEILStateManager,
  FrameSnapshotTransform,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  ConsoleMessageReceptor,
  Element,
  createEventFacet
} from '../src';
import { BaseReceptor } from '../src/components/base-martem';
import { SpaceEvent, ReadonlyVEILState } from '../src/spaces/receptor-effector-types';
import { VEILDelta } from '../src/veil/types';

async function main() {
  console.log('📸 Direct Frame Snapshot Test');
  console.log('==============================\n');

  // Create space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);

  // Add snapshot transform
  const snapshotTransform = new FrameSnapshotTransform({
    enabled: true,
    verbose: true
  });
  space.addTransform(snapshotTransform);

  // Add basic infrastructure
  space.addReceptor(new ElementRequestReceptor());
  space.addMaintainer(new ElementTreeMaintainer(space));
  space.addReceptor(new ConsoleMessageReceptor());

  console.log('✅ Space configured with snapshot transform\n');

  // Test 1: Simple event
  console.log('--- Test 1: Simple Event ---\n');
  space.emit({
    topic: 'console:message',
    source: space.getRef(),
    timestamp: Date.now(),
    payload: {
      streamId: 'console:test',
      content: 'Hello from the user!',
      metadata: {}
    }
  });

  // Let frames process
  await new Promise(resolve => setTimeout(resolve, 100));

  const state1 = veilState.getState();
  console.log(`Total frames after event 1: ${state1.frameHistory.length}`);
  
  if (state1.frameHistory.length === 0) {
    console.log('  ⚠️  No frames created yet!\n');
    process.exit(1);
  }
  
  const frame1 = state1.frameHistory[state1.frameHistory.length - 1];

  console.log(`Frame ${frame1.sequence}:`);
  console.log(`  Deltas: ${frame1.deltas.length}`);
  console.log(`  Events: ${frame1.events?.length || 0}`);
  if (frame1.renderedSnapshot) {
    console.log(`  ✅ Has snapshot`);
    console.log(`  Chunks: ${frame1.renderedSnapshot.chunks.length}`);
    console.log(`  Total tokens: ${frame1.renderedSnapshot.totalTokens}`);
    console.log(`  Content length: ${frame1.renderedSnapshot.totalContent.length} chars`);
    
    if (frame1.renderedSnapshot.chunks.length > 0) {
      console.log(`\n  Chunk details:`);
      for (let i = 0; i < frame1.renderedSnapshot.chunks.length; i++) {
        const chunk = frame1.renderedSnapshot.chunks[i];
        console.log(`    [${i}] Type: ${chunk.chunkType || 'untyped'}, ` +
                    `Tokens: ${chunk.tokens}, ` +
                    `Facets: ${chunk.facetIds?.length || 0}`);
        const preview = chunk.content.substring(0, 60).replace(/\n/g, '\\n');
        console.log(`        "${preview}${chunk.content.length > 60 ? '...' : ''}"`);
      }
    }
    
    console.log(`\n  Full content:`);
    console.log(`    ${frame1.renderedSnapshot.totalContent.substring(0, 200)}`);
  } else {
    console.log(`  ❌ No snapshot`);
  }

  // Test 2: Agent response simulation
  console.log('\n\n--- Test 2: Agent Response ---\n');
  space.emit({
    topic: 'agent:speech',
    source: { elementId: 'agent-1', elementPath: [], elementType: 'AgentElement' },
    timestamp: Date.now(),
    payload: {
      operation: {
        type: 'addFacet',
        facet: {
          id: 'speech-test-1',
          type: 'speech',
          content: 'I see you said hello! How interesting.',
          agentId: 'agent-1'
        }
      }
    }
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const state2 = veilState.getState();
  
  // Check frame 1 again (should have snapshot now after frame 2 processed)
  const frame1Final = state2.frameHistory[0];
  console.log(`\nFrame 1 (after frame 2 processed):`);
  console.log(`  Deltas: ${frame1Final.deltas.length}`);
  if (frame1Final.renderedSnapshot) {
    console.log(`  ✅ HAS SNAPSHOT NOW!`);
    console.log(`  Chunks: ${frame1Final.renderedSnapshot.chunks.length}`);
    console.log(`  Total tokens: ${frame1Final.renderedSnapshot.totalTokens}`);
    
    if (frame1Final.renderedSnapshot.chunks.length > 0) {
      console.log(`\n  Chunk details:`);
      for (let i = 0; i < frame1Final.renderedSnapshot.chunks.length; i++) {
        const chunk = frame1Final.renderedSnapshot.chunks[i];
        console.log(`    [${i}] Type: "${chunk.chunkType || 'untyped'}", ` +
                    `Tokens: ${chunk.tokens}, ` +
                    `Facets: ${chunk.facetIds?.join(',') || 'none'}`);
        const preview = chunk.content.substring(0, 70).replace(/\n/g, '\\n');
        console.log(`        Content: "${preview}${chunk.content.length > 70 ? '...' : ''}"`);
      }
      
      console.log(`\n  Full rendered content:`);
      console.log(`    ${frame1Final.renderedSnapshot.totalContent}`);
    }
  } else {
    console.log(`  ❌ Still no snapshot`);
  }
  
  const frame2 = state2.frameHistory[state2.frameHistory.length - 1];

  console.log(`\n\nFrame ${frame2.sequence}:`);
  if (frame2.renderedSnapshot) {
    console.log(`  ✅ Has snapshot`);
    console.log(`  Chunks: ${frame2.renderedSnapshot.chunks.length}`);
    console.log(`  Total tokens: ${frame2.renderedSnapshot.totalTokens}`);
    
    if (frame2.renderedSnapshot.chunks.length > 0) {
      console.log(`\n  Chunk details:`);
      for (let i = 0; i < frame2.renderedSnapshot.chunks.length; i++) {
        const chunk = frame2.renderedSnapshot.chunks[i];
        console.log(`    [${i}] Type: ${chunk.chunkType || 'untyped'}, ` +
                    `Tokens: ${chunk.tokens}, ` +
                    `Facets: ${chunk.facetIds?.length || 0}`);
        if (chunk.chunkType === 'turn-marker') {
          console.log(`        [TURN MARKER] "${chunk.content.replace(/\n/g, '\\n')}"`);
        } else {
          const preview = chunk.content.substring(0, 60).replace(/\n/g, '\\n');
          console.log(`        "${preview}${chunk.content.length > 60 ? '...' : ''}"`);
        }
      }
    }
    
    console.log(`\n  Full content:`);
    const lines = frame2.renderedSnapshot.totalContent.split('\n');
    lines.slice(0, 10).forEach(line => console.log(`    ${line}`));
    if (lines.length > 10) console.log(`    ... (${lines.length - 10} more lines)`);
  } else {
    console.log(`  ❌ No snapshot`);
  }

  // Summary
  console.log('\n\n--- Summary ---\n');
  const allFrames = veilState.getState().frameHistory;
  const framesWithSnapshots = allFrames.filter(f => f.renderedSnapshot);
  const totalChunks = framesWithSnapshots.reduce(
    (sum, f) => sum + (f.renderedSnapshot?.chunks.length || 0),
    0
  );
  const totalTokens = framesWithSnapshots.reduce(
    (sum, f) => sum + (f.renderedSnapshot?.totalTokens || 0),
    0
  );

  console.log(`Total frames: ${allFrames.length}`);
  console.log(`Frames with snapshots: ${framesWithSnapshots.length}`);
  console.log(`Total chunks: ${totalChunks}`);
  console.log(`Total tokens: ${totalTokens}`);

  console.log('\n✅ Snapshot capture working!\n');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

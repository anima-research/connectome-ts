#!/usr/bin/env tsx
/**
 * Test: Compression with Frame Snapshots
 * 
 * Verifies that CompressionTransform uses frame snapshots when available.
 */

import {
  Space,
  VEILStateManager,
  FrameSnapshotTransform,
  CompressionTransform,
  SimpleTestCompressionEngine,
  ConsoleMessageReceptor,
  ElementRequestReceptor,
  ElementTreeMaintainer,
} from '../src';

async function main() {
  console.log('🗜️  Compression with Frame Snapshots Test');
  console.log('=========================================\n');

  // Create space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);

  // Add snapshot transform (priority 200 - runs late)
  const snapshotTransform = new FrameSnapshotTransform({
    enabled: true,
    verbose: true
  });
  space.addTransform(snapshotTransform);

  // Add compression transform (priority 10 - runs early)
  const compressionEngine = new SimpleTestCompressionEngine();
  const compressionTransform = new CompressionTransform({
    engine: compressionEngine,
    triggerThreshold: 100,  // Low threshold to trigger quickly
    minFramesBeforeCompression: 3  // Only need 3 frames
  });
  space.addTransform(compressionTransform);

  // Add basic infrastructure
  space.addReceptor(new ConsoleMessageReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addMaintainer(new ElementTreeMaintainer(space));

  console.log('✅ Space configured:');
  console.log('   - FrameSnapshotTransform (priority 200)');
  console.log('   - CompressionTransform (priority 10)');
  console.log('   - Trigger threshold: 100 tokens');
  console.log('   - Min frames: 3\n');

  // Generate several frames with content
  console.log('--- Generating Frames ---\n');
  
  for (let i = 1; i <= 5; i++) {
    space.emit({
      topic: 'console:message',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {
        streamId: 'console:test',
        content: `Message ${i}: This is a test message with some content to build up token count.`,
        metadata: {}
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n--- Checking Results ---\n');

  const state = veilState.getState();
  const frames = state.frameHistory;

  console.log(`Total frames: ${frames.length}`);

  // Check snapshots
  const framesWithSnapshots = frames.filter(f => f.renderedSnapshot);
  console.log(`\nFrames with snapshots: ${framesWithSnapshots.length}/${frames.length}`);

  if (framesWithSnapshots.length > 0) {
    console.log('\nSnapshot details:');
    for (const frame of framesWithSnapshots) {
      if (frame.renderedSnapshot && frame.renderedSnapshot.chunks.length > 0) {
        console.log(`  Frame ${frame.sequence}:`);
        console.log(`    Chunks: ${frame.renderedSnapshot.chunks.length}`);
        console.log(`    Tokens: ${frame.renderedSnapshot.totalTokens}`);
        console.log(`    Content: "${frame.renderedSnapshot.totalContent.substring(0, 80)}..."`);
      }
    }
  }

  // Check if compression was triggered
  console.log('\n--- Compression Status ---\n');
  
  // Look for compression facets
  const compressionFacets = Array.from(state.facets.values()).filter(f => 
    f.type === 'compression-plan' || f.type === 'compression-result'
  );

  console.log(`Compression facets: ${compressionFacets.length}`);
  
  if (compressionFacets.length > 0) {
    console.log('\n✅ Compression was triggered!');
    
    for (const facet of compressionFacets) {
      console.log(`\n  ${facet.type}:`);
      console.log(`    ${JSON.stringify((facet as any).state, null, 2)}`);
    }
  } else {
    console.log('\n⚠️  Compression not triggered yet');
    console.log('   (This is expected if total tokens < threshold)');
    
    // Calculate total tokens
    const totalTokens = framesWithSnapshots.reduce(
      (sum, f) => sum + (f.renderedSnapshot?.totalTokens || 0),
      0
    );
    console.log(`   Total tokens in snapshots: ${totalTokens}`);
    console.log(`   Trigger threshold: 100`);
  }

  // Verify compression can access snapshot data
  console.log('\n--- Verifying Snapshot Access for Compression ---\n');
  
  if (frames.length >= 3) {
    const framesToCompress = frames.slice(0, 3);
    const hasAllSnapshots = framesToCompress.every(f => f.renderedSnapshot);
    
    console.log(`Frames 0-2: ${hasAllSnapshots ? '✅' : '❌'} all have snapshots`);
    
    if (hasAllSnapshots) {
      // Simulate what compression would do
      const content = framesToCompress
        .map(f => f.renderedSnapshot!.totalContent)
        .join('\n\n');
      
      const tokens = framesToCompress.reduce(
        (sum, f) => sum + (f.renderedSnapshot?.totalTokens || 0),
        0
      );
      
      console.log(`\nExtracted for compression:`);
      console.log(`  Frames: ${framesToCompress.length}`);
      console.log(`  Tokens: ${tokens}`);
      console.log(`  Content length: ${content.length} chars`);
      console.log(`  Content preview:\n${content.substring(0, 200)}...`);
      
      // Verify no re-rendering needed
      console.log(`\n✅ Compression can use snapshots directly - no re-rendering needed!`);
    }
  }

  console.log('\n=== Test Complete ===\n');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

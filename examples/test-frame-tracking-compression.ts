/**
 * Test FrameTrackingHUD with compression
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { SimpleTestCompressionEngine } from '../src/compression/simple-test-engine';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testWithCompression() {
  console.log('=== Testing FrameTrackingHUD with Compression ===\n');
  
  // Set up VEIL state
  const veilState = new VEILStateManager();
  const frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[] = [];
  
  // Apply all frames
  console.log('Setting up VEIL state...');
  for (const frame of starshipScenarioFrames) {
    if ('deltas' in frame) {
      const incomingOps = ['addFacet', 'changeState', 'addStream', 'updateStream', 'deleteStream', 'addScope', 'deleteScope', 'agent-activation'];
      const hasIncomingOps = frame.deltas.some((op: any) => 
        incomingOps.includes(op.type) || 'facet' in op
      );
      
      if (hasIncomingOps) {
        veilState.applyIncomingFrame(frame as any);
        frameHistory.push(frame as IncomingVEILFrame);
      } else {
        veilState.recordOutgoingFrame(frame as any);
        frameHistory.push(frame as OutgoingVEILFrame);
      }
    }
  }
  
  const currentFacets = veilState.getActiveFacets();
  console.log(`Frames: ${frameHistory.length}, Facets: ${currentFacets.size}\n`);
  
  // Test 1: Render without compression to get frame data
  console.log('--- Step 1: Initial Render (No Compression) ---');
  
  const hud = new FrameTrackingHUD();
  const { frameRenderings } = hud.renderWithFrameTracking(
    frameHistory,
    currentFacets
  );
  
  console.log(`Rendered ${frameRenderings.length} frames`);
  let totalTokens = 0;
  frameRenderings.forEach(fr => {
    totalTokens += fr.tokens;
    console.log(`  Frame ${fr.frameSequence}: ${fr.tokens} tokens`);
  });
  console.log(`Total tokens: ${totalTokens}\n`);
  
  // Test 2: Identify compressible ranges
  console.log('--- Step 2: Identify Compressible Ranges ---');
  
  const compression = new SimpleTestCompressionEngine();
  const ranges = compression.identifyCompressibleRanges(frameHistory, frameRenderings);
  
  console.log(`Found ${ranges.length} compressible ranges:`);
  for (const range of ranges) {
    console.log(`  Frames ${range.fromFrame}-${range.toFrame}: ${range.totalTokens} tokens (${range.reason})`);
  }
  console.log();
  
  // Test 3: Compress ranges
  console.log('--- Step 3: Compress Ranges ---');
  
  for (const range of ranges) {
    const result = await compression.compressRange(
      range,
      frameHistory,
      frameRenderings,
      currentFacets
    );
    console.log(`Compressed frames ${result.replacesFrames.from}-${result.replacesFrames.to}`);
  }
  console.log();
  
  // Test 4: Render with compression
  console.log('--- Step 4: Render with Compression ---');
  
  const compressedResult = hud.render(
    frameHistory,
    currentFacets,
    compression,
    { systemPrompt: 'You are the helm officer on a starship bridge.' }
  );
  
  const originalResult = hud.render(frameHistory, currentFacets);
  const originalContent = originalResult.messages.find(m => m.role === 'assistant')?.content || '';
  const compressedContent = compressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  console.log(`Original length: ${originalContent.length} chars`);
  console.log(`Compressed length: ${compressedContent.length} chars`);
  console.log(`Reduction: ${Math.round((1 - compressedContent.length / originalContent.length) * 100)}%\n`);
  
  // Show compressed content
  console.log('Compressed content preview:');
  const lines = compressedContent.split('\n');
  console.log(lines.slice(0, 15).join('\n'));
  console.log('...');
  console.log(lines.slice(-10).join('\n'));
  
  // Verify compression markers
  console.log('\n--- Compression Verification ---');
  const compressionMarkers = compressedContent.match(/\[Frames \d+-\d+:.*?\]/g) || [];
  console.log(`Found ${compressionMarkers.length} compression markers:`);
  compressionMarkers.forEach(marker => console.log(`  ${marker}`));
}

testWithCompression().catch(console.error);

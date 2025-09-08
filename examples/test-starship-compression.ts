/**
 * Test compression with the starship scenario
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { AttentionAwareCompressionEngine } from '../src/compression/attention-aware-engine';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testStarshipCompression() {
  console.log('=== Testing Starship Scenario Compression ===\n');
  
  // Set up VEIL state
  const veilState = new VEILStateManager();
  const frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[] = [];
  
  // Apply all frames
  for (const frame of starshipScenarioFrames) {
    if ('operations' in frame) {
      const incomingOps = ['addFacet', 'changeState', 'addStream', 'updateStream', 'deleteStream', 'addScope', 'deleteScope', 'agentActivation'];
      const hasIncomingOps = frame.operations.some((op: any) => 
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
  
  // Set up compression with mock responses
  const mockLLM = new MockLLMProvider();
  // For non-numbered content, it will use the default line counter
  
  const compression = new AttentionAwareCompressionEngine(mockLLM, {
    chunkThreshold: 300,
    maxChunkSize: 600
  });
  
  const hud = new FrameTrackingHUD();
  
  // Get frame renderings and identify ranges
  const { frameRenderings } = hud.renderWithFrameTracking(frameHistory, currentFacets);
  const ranges = compression.identifyCompressibleRanges(frameHistory, frameRenderings);
  
  console.log(`Found ${ranges.length} compressible ranges:`);
  for (const range of ranges) {
    console.log(`  Frames ${range.fromFrame}-${range.toFrame}: ${range.totalTokens} tokens`);
  }
  
  // Compress ranges
  console.log('\nCompressing ranges...');
  for (const range of ranges) {
    await compression.compressRange(range, frameHistory, frameRenderings, currentFacets);
  }
  
  // Render without compression first
  const uncompressedResult = hud.render(frameHistory, currentFacets);
  const uncompressedContent = uncompressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  // Render with compression
  const compressedResult = hud.render(frameHistory, currentFacets, compression);
  const compressedContent = compressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  console.log(`\nOriginal length: ${uncompressedContent.length} chars`);
  console.log(`Compressed length: ${compressedContent.length} chars`);
  console.log(`Reduction: ${Math.round((1 - compressedContent.length / uncompressedContent.length) * 100)}%`);
  
  // Show compressed output
  console.log('\n--- Compressed Output ---');
  console.log(compressedContent);
  
  // Count compression markers
  const markers = compressedContent.match(/\[Compressed:.*?\]/g) || [];
  console.log(`\nCompression markers: ${markers.length}`);
  markers.forEach(m => console.log(`  ${m}`));
}

testStarshipCompression().catch(console.error);

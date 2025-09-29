/**
 * Test compression with numbered events
 * Demonstrates attention-aware compression with mock LLM
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { AttentionAwareCompressionEngine } from '../src/compression/attention-aware-engine';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { LLMProviderFactory } from '../src/llm/llm-interface';
import { Frame } from '../src/veil/types';

// Register mock provider
LLMProviderFactory.register('mock', () => new MockLLMProvider());

async function testNumberedCompression() {
  console.log('=== Testing Numbered Event Compression ===\n');
  
  // Create VEIL state and frames
  const veilState = new VEILStateManager();
  const frames: (Frame | Frame)[] = [];
  
  // Generate 50 numbered event frames
  console.log('Generating 50 event frames...');
  for (let i = 1; i <= 50; i++) {
    const frame: Frame = {
      sequence: i,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'addFacet',
          facet: {
            id: `event-${i}`,
            type: 'event',
            displayName: `Event ${i}`,
            content: `Event ${i}: Something interesting happened with details about item ${i}`,
            scope: []
          }
        }
      ]
    };
    
    veilState.applyFrame(frame);
    frames.push(frame);
  }
  
  // Add some agent turns for variety
  for (let i = 51; i <= 55; i++) {
    const frame: Frame = {
      sequence: i,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'speak',
          content: `Acknowledging events ${(i-51)*10 + 1} through ${(i-51)*10 + 10}`
        }
      ]
    };
    
    veilState.applyFrame(frame);
    frames.push(frame);
  }
  
  console.log(`Created ${frames.length} frames\n`);
  
  // Set up compression with mock LLM
  const mockLLM = new MockLLMProvider();
  const compression = new AttentionAwareCompressionEngine(mockLLM, {
    chunkThreshold: 200,  // Compress every ~200 tokens
    maxChunkSize: 500
  });
  
  // Set up HUD
  const hud = new FrameTrackingHUD();
  const currentFacets = veilState.getActiveFacets();
  
  // First render without compression to identify ranges
  console.log('--- Step 1: Identify Compressible Ranges ---');
  const { frameRenderings } = hud.renderWithFrameTracking(frames, currentFacets);
  
  const ranges = compression.identifyCompressibleRanges(frames, frameRenderings);
  console.log(`Found ${ranges.length} compressible ranges:`);
  for (const range of ranges) {
    console.log(`  Frames ${range.fromFrame}-${range.toFrame}: ${range.totalTokens} tokens`);
  }
  
  // Compress each range
  console.log('\n--- Step 2: Compress Ranges ---');
  for (const range of ranges) {
    const result = await compression.compressRange(
      range,
      frames,
      frameRenderings,
      currentFacets
    );
    console.log(`Compressed frames ${result.replacesFrames.from}-${result.replacesFrames.to}`);
  }
  
  // Render with compression
  console.log('\n--- Step 3: Render with Compression ---');
  const compressedResult = hud.render(frames, currentFacets, compression);
  const content = compressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  // Show the compressed output
  console.log('\nCompressed output preview:');
  const lines = content.split('\n').filter(l => l.trim());
  
  // Show first 10 lines
  console.log('First 10 lines:');
  lines.slice(0, 10).forEach((line, i) => {
    console.log(`  ${i + 1}: ${line}`);
  });
  
  // Find and show compression markers
  console.log('\nCompression markers:');
  const compressionMarkers = content.match(/\[Compressed:.*?\]/g) || [];
  compressionMarkers.forEach(marker => {
    console.log(`  ${marker}`);
  });
  
  // Show token reduction
  const originalTokens = frameRenderings.reduce((sum, fr) => sum + fr.tokens, 0);
  const compressedTokens = hud.estimateTokens(content);
  const reduction = Math.round((1 - compressedTokens / originalTokens) * 100);
  
  console.log(`\nToken reduction: ${originalTokens} → ${compressedTokens} (${reduction}% reduction)`);
}

// Run the test
testNumberedCompression().catch(console.error);

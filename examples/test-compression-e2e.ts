#!/usr/bin/env tsx
/**
 * End-to-End Compression Test
 * 
 * Verifies the complete flow:
 * 1. Frame snapshots capture content
 * 2. Compression engine receives snapshot content
 * 3. HUD uses compressed replacements when rendering
 */

import {
  Space,
  VEILStateManager,
  FrameSnapshotTransform,
  CompressionTransform,
  ContextTransform,
  MockLLMProvider,
  ConsoleMessageReceptor,
  ElementRequestReceptor,
  ElementTreeMaintainer,
  FrameTrackingHUD
} from '../src';
import { CompressionEngine, CompressibleRange, CompressionResult, RenderedFrame, StateDelta } from '../src/compression/types-v2';
import { Facet, Frame } from '../src/veil/types';

// Instrumented compression engine that logs what it receives
class InstrumentedCompressionEngine implements CompressionEngine {
  private compressions = new Map<number, string>();
  public receivedContent: string[] = [];
  
  identifyCompressibleRanges(
    frames: Frame[],
    renderedFrames: RenderedFrame[]
  ): CompressibleRange[] {
    // Compress after 3+ frames with 50+ tokens
    const totalTokens = renderedFrames.reduce((sum, f) => sum + f.tokens, 0);
    
    if (renderedFrames.length >= 3 && totalTokens >= 50) {
      console.log(`\n[Engine] Identified compressible range:`);
      console.log(`  Frames: ${renderedFrames[0].frameSequence} to ${renderedFrames[renderedFrames.length - 1].frameSequence}`);
      console.log(`  Total tokens: ${totalTokens}`);
      
      return [{
        fromFrame: renderedFrames[0].frameSequence,
        toFrame: renderedFrames[renderedFrames.length - 1].frameSequence,
        totalTokens,
        reason: 'Token threshold met'
      }];
    }
    
    return [];
  }
  
  async compressRange(
    range: CompressibleRange,
    frames: Frame[],
    renderedFrames: RenderedFrame[],
    currentFacets: Map<string, Facet>
  ): Promise<CompressionResult> {
    console.log(`\n[Engine] compress Range called:`);
    console.log(`  Range: ${range.fromFrame} to ${range.toFrame}`);
    
    // Extract content from rendered frames
    const content = renderedFrames
      .filter(rf => rf.frameSequence >= range.fromFrame && rf.frameSequence <= range.toFrame)
      .map(rf => rf.content)
      .join('\n\n');
    
    // LOG WHAT WE RECEIVED
    console.log(`\n[Engine] Content received for compression:`);
    console.log(`  Length: ${content.length} chars`);
    console.log(`  Tokens: ${renderedFrames.filter(rf => rf.frameSequence >= range.fromFrame && rf.frameSequence <= range.toFrame).reduce((sum, rf) => sum + rf.tokens, 0)}`);
    console.log(`  Preview (first 300 chars):`);
    console.log(`  ${content.substring(0, 300).split('\n').map(l => '  | ' + l).join('\n')}`);
    
    this.receivedContent.push(content);
    
    // Create a simple summary
    const summary = `[Compressed: Frames ${range.fromFrame}-${range.toFrame}, ${range.totalTokens} tokens]`;
    
    // Store
    for (let seq = range.fromFrame; seq <= range.toFrame; seq++) {
      this.compressions.set(seq, summary);
    }
    
    console.log(`\n[Engine] Created summary: "${summary}"`);
    
    return {
      replacesFrames: { from: range.fromFrame, to: range.toFrame },
      stateDelta: undefined,
      engineData: { summary }
    };
  }
  
  shouldReplaceFrame(frameSequence: number): boolean {
    return this.compressions.has(frameSequence);
  }
  
  getReplacement(frameSequence: number): string | null {
    const replacement = this.compressions.get(frameSequence);
    if (!replacement) return null;
    
    // Only return for first frame in range
    const prevReplacement = this.compressions.get(frameSequence - 1);
    if (prevReplacement === replacement) {
      return '';  // Skip other frames
    }
    
    return replacement;
  }
  
  getStateDelta(frameSequence: number): StateDelta | null {
    return null;
  }
  
  clearCache(): void {
    this.compressions.clear();
  }
}

async function main() {
  console.log('🗜️  End-to-End Compression Test');
  console.log('================================\n');

  // Create space
  const veilState = new VEILStateManager();
  const space = new Space(veilState);

  // Create instrumented engine
  const engine = new InstrumentedCompressionEngine();

  // Add transforms IN ORDER
  const snapshotTransform = new FrameSnapshotTransform({
    enabled: true,
    verbose: true
  });
  space.addTransform(snapshotTransform);
  
  const compressionTransform = new CompressionTransform({
    engine,
    triggerThreshold: 50,
    minFramesBeforeCompression: 3
  });
  space.addTransform(compressionTransform);
  
  const hud = new FrameTrackingHUD();
  const contextTransform = new ContextTransform(veilState, engine);
  space.addTransform(contextTransform);

  // Add basic infrastructure
  space.addReceptor(new ConsoleMessageReceptor());
  space.addReceptor(new ElementRequestReceptor());
  space.addMaintainer(new ElementTreeMaintainer(space));

  console.log('✅ Space configured with instrumented compression\n');
  console.log('Transform order:');
  console.log('  200: FrameSnapshotTransform');
  console.log('  250: CompressionTransform');
  console.log('  100: ContextTransform\n');

  // Generate frames
  console.log('--- Generating 5 Frames ---\n');
  
  for (let i = 1; i <= 5; i++) {
    space.emit({
      topic: 'console:message',
      source: space.getRef(),
      timestamp: Date.now(),
      payload: {
        streamId: 'console:test',
        content: `Message ${i}: Testing compression with frame snapshots.`,
        metadata: {}
      }
    });
    
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('\n--- Verification ---\n');

  const state = veilState.getState();

  // Check what compression engine received
  console.log(`Engine received ${engine.receivedContent.length} compression request(s)\n`);
  
  if (engine.receivedContent.length > 0) {
    console.log('✅ Compression was triggered!');
    console.log(`\nContent sent to LLM:`);
    console.log(`Length: ${engine.receivedContent[0].length} chars`);
    console.log(`Full content:\n${'='.repeat(60)}`);
    console.log(engine.receivedContent[0]);
    console.log('='.repeat(60));
    
    // Verify it came from snapshots
    const firstFrame = state.frameHistory[0];
    if (firstFrame.renderedSnapshot) {
      const fromSnapshot = firstFrame.renderedSnapshot.totalContent;
      if (engine.receivedContent[0].includes(fromSnapshot.substring(0, 50))) {
        console.log(`\n✅ Compression received content FROM SNAPSHOTS`);
      } else {
        console.log(`\n⚠️  Content mismatch - might not be from snapshots`);
      }
    }
  } else {
    console.log('⚠️  Compression not triggered');
  }

  // Now check HUD rendering with compression
  console.log(`\n--- HUD Rendering with Compression ---\n`);
  
  const renderedContext = hud.render(
    state.frameHistory,
    new Map(state.facets),
    engine  // Pass engine so HUD can use replacements
  );

  console.log(`Messages in rendered context: ${renderedContext.messages.length}`);
  
  // Check if any messages contain compressed content
  let foundCompressed = false;
  for (let i = 0; i < renderedContext.messages.length; i++) {
    const msg = renderedContext.messages[i];
    if (msg.content.includes('[Compressed:')) {
      foundCompressed = true;
      console.log(`\n✅ Found compressed content in message ${i}:`);
      console.log(`   "${msg.content}"`);
    }
  }
  
  if (!foundCompressed) {
    console.log(`\n⚠️  No compressed content found in messages`);
    console.log(`   Showing all messages:`);
    renderedContext.messages.forEach((msg, i) => {
      console.log(`   [${i}] ${msg.role}: "${msg.content.substring(0, 80)}..."`);
    });
  }

  // Show final stats
  console.log(`\n--- Final Stats ---\n`);
  console.log(`Total frames: ${state.frameHistory.length}`);
  console.log(`Frames with snapshots: ${state.frameHistory.filter(f => f.renderedSnapshot).length}`);
  console.log(`Compression requests: ${engine.receivedContent.length}`);
  console.log(`Messages in context: ${renderedContext.messages.length}`);
  console.log(`Total tokens: ${renderedContext.metadata.totalTokens}`);

  console.log('\n=== Test Complete ===\n');
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

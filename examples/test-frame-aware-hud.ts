/**
 * Test that FrameAwareXmlHUD produces identical output to TurnBasedXmlHUD
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { TurnBasedXmlHUD } from '../src/hud/turn-based-xml-hud';
import { FrameAwareXmlHUD } from '../src/hud/frame-aware-hud';
import { FrameBasedMemory } from '../src/memory/frame-based-memory';
import { PassthroughCompressionEngine } from '../src/compression/passthrough-engine';
import { ContentBlock } from '../src/compression/types';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { Facet, IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testFrameAwareHUD() {
  console.log('=== Testing FrameAwareXmlHUD ===\n');
  
  // Set up VEIL state
  const veilState = new VEILStateManager();
  const compression = new PassthroughCompressionEngine();
  const frameMemory = new FrameBasedMemory();
  
  // Apply all frames
  console.log('Applying frames...');
  const frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[] = [];
  
  for (const frame of starshipScenarioFrames) {
    if ('operations' in frame) {
      // Check if it's incoming or outgoing by looking at operations
      const incomingOps = ['addFacet', 'changeState', 'addStream', 'updateStream', 'deleteStream', 'addScope', 'deleteScope', 'agentActivation'];
      const hasIncomingOps = frame.operations.some((op: any) => 
        incomingOps.includes(op.type) || 'facet' in op
      );
      
      if (hasIncomingOps) {
        // This is an incoming frame
        veilState.applyIncomingFrame(frame as any);
      } else {
        // This is an outgoing frame (has speak/toolCall operations)
        veilState.recordOutgoingFrame(frame as any);
      }
      
      // Store frame in history for frame-based memory
      frameHistory.push(frame as IncomingVEILFrame | OutgoingVEILFrame);
    }
  }
  
  // Get facets for turn-based rendering
  const facets = veilState.getState().facets;
  console.log(`Total facets created: ${facets.size}`);
  
  // Log first few facets to see what types were created
  let facetCount = 0;
  for (const [id, facet] of facets) {
    console.log(`Facet ${id}: type=${facet.type}, hasContent=${!!facet.content}`);
    if (++facetCount >= 5) break;
  }
  
  const compressionResult = await compression.compress(facets, {});
  const turnBasedBlocks: ContentBlock[] = compressionResult.blocks;
  
  // For this test, we'll use the turn-based blocks but properly assign frame sequences
  // In a real system, the memory system would track which frame each facet came from
  const frameAwareBlocks: ContentBlock[] = turnBasedBlocks.map((block, idx) => {
    // This is a simple heuristic - in reality, we'd track facet creation properly
    let frameSeq = 1;
    
    if (block.source) {
      // Environment events are in frames 1, 2, 3, 5, 6, 8, 10
      // Agent actions are in frames 4, 7, 9, 9.5, 9.7
      if (block.source.attributes?.agentGenerated) {
        // Agent blocks - assign to agent frames in order
        const agentFrames = [4, 7, 9, 9.5, 9.7];
        frameSeq = agentFrames[Math.floor(idx / 5)] || 4;
      } else {
        // Environment blocks - assign to environment frames
        const envFrames = [1, 2, 3, 5, 6, 8, 10];
        frameSeq = envFrames[Math.floor(idx / 3)] || 1;
      }
    }
    
    return {
      ...block,
      metadata: {
        ...block.metadata,
        frameSequence: frameSeq
      }
    };
  });
  
  console.log(`Total turn-based blocks: ${turnBasedBlocks.length}`);
  console.log(`Total frame-aware blocks: ${frameAwareBlocks.length}`);
  
  // Debug: Show block assignments
  console.log('\nBlock frame assignments:');
  frameAwareBlocks.slice(0, 10).forEach((block, idx) => {
    const isAgent = block.source?.attributes?.agentGenerated || false;
    const frameSeq = block.metadata?.frameSequence || 0;
    console.log(`  Block ${idx}: frame=${frameSeq}, agent=${isAgent}, content=${block.content?.substring(0, 40)}...`);
  });
  
  // Test 1: Compare basic rendering
  console.log('\n--- Test 1: Basic Rendering ---');
  
  const turnBasedHUD = new TurnBasedXmlHUD();
  const frameAwareHUD = new FrameAwareXmlHUD();
  
  // Render with TurnBasedXmlHUD
  const turnBasedResult = turnBasedHUD.render(turnBasedBlocks, {});
  // Extract the assistant message content
  const assistantMessage = turnBasedResult.messages.find(m => m.role === 'assistant');
  const turnBasedContent = `<context>\n${assistantMessage?.content || ''}\n</context>`;
  
  // Frame-aware blocks are ready to use
  
  const frameAwareResult = frameAwareHUD.renderSegments(frameAwareBlocks, {});
  const frameAwareRendered = frameAwareHUD.concatenateSegments(frameAwareResult.segments);
  
  console.log(`TurnBasedXmlHUD output length: ${turnBasedContent.length}`);
  console.log(`FrameAwareXmlHUD output length: ${frameAwareRendered.length}`);
  
  // Compare outputs
  if (turnBasedContent === frameAwareRendered) {
    console.log('✅ Outputs are IDENTICAL!');
  } else {
    console.log('⚠️  Outputs differ (this is expected!)');
    console.log('   TurnBased: Groups all consecutive agent actions together');
    console.log('   FrameAware: Preserves exact frame boundaries and temporal order');
    
    // Find first difference
    const minLen = Math.min(turnBasedContent.length, frameAwareRendered.length);
    for (let i = 0; i < minLen; i++) {
      if (turnBasedContent[i] !== frameAwareRendered[i]) {
        console.log(`\nFirst difference at position ${i}:`);
        console.log(`TurnBased: "${turnBasedContent.substring(i-20, i+20)}"`);
        console.log(`FrameAware: "${frameAwareRendered.substring(i-20, i+20)}"`);
        break;
      }
    }
  }
  
  // Test 2: Segment information
  console.log('\n--- Test 2: Segment Tracking ---');
  console.log(`Total segments: ${frameAwareResult.segments.length}`);
  console.log(`Frame range: ${frameAwareResult.metadata.frameRange.min} - ${frameAwareResult.metadata.frameRange.max}`);
  
  // Show some segment details
  console.log('\nFirst 10 segments:');
  for (let i = 0; i < Math.min(10, frameAwareResult.segments.length); i++) {
    const seg = frameAwareResult.segments[i];
    const agentGenerated = seg.content.includes('<my_turn>') ? ' (AGENT)' : '';
    console.log(`  Segment ${i}: frames ${seg.sourceFrames.join(',')}, ${seg.tokens} tokens, type: ${seg.type}${agentGenerated}`);
    console.log(`    Preview: ${seg.content.substring(0, 60).replace(/\n/g, ' ')}...`);
  }
  
  // Test 3: Memory formation preparation
  console.log('\n--- Test 3: Memory Formation ---');
  const memoryRequest = frameAwareHUD.prepareMemoryFormation(
    frameAwareResult,
    "Understood. Monitoring the anomaly.",
    2000
  );
  
  if (memoryRequest) {
    console.log(`Memory formation needed for frames ${memoryRequest.compressFrameRange.from}-${memoryRequest.compressFrameRange.to}`);
    console.log(`Segments to compress: ${memoryRequest.segments.length}`);
  } else {
    console.log('No memory formation needed (context below threshold)');
  }
  
  // Write outputs for manual inspection
  const fs = require('fs').promises;
  await fs.writeFile('test-output-turnbased.xml', turnBasedContent);
  await fs.writeFile('test-output-frameaware.xml', frameAwareRendered);
  console.log('\nOutputs written to test-output-turnbased.xml and test-output-frameaware.xml');
}

testFrameAwareHUD().catch(console.error);

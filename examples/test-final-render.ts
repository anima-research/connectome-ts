/**
 * Test the final rendered context from the starship scenario
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FloatingAmbientEngine } from '../src/compression/floating-ambient-engine';
import { TurnBasedXmlHUD } from '../src/hud/turn-based-xml-hud';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testFinalRender() {
  console.log('=== Testing Final Rendered Context ===\n');

  // Initialize components
  const veilState = new VEILStateManager();
  const compression = new FloatingAmbientEngine(3);
  const hud = new TurnBasedXmlHUD();

  // Process all frames to build up state
  console.log('Processing frames...');
  for (const frame of starshipScenarioFrames) {
    if (frame.sequence === 10) continue; // Skip tool definitions
    
    const isOutgoing = frame.operations.some(op => 
      op.type === 'speak' || 
      op.type === 'toolCall' || 
      op.type === 'innerThoughts' || 
      op.type === 'cycleRequest'
    );
    
    if (!isOutgoing) {
      const incomingFrame = frame as IncomingVEILFrame;
      veilState.applyIncomingFrame(incomingFrame);
      console.log(`  Frame ${frame.sequence}: Applied ${frame.operations.length} operations`);
    } else {
      const outgoingFrame = frame as OutgoingVEILFrame;
      veilState.recordOutgoingFrame(outgoingFrame);
      console.log(`  Frame ${frame.sequence}: Recorded agent response with ${frame.operations.length} operations`);
    }
  }

  // Get final state
  const finalState = veilState.getState();
  console.log('\nFinal state summary:');
  console.log(`  Total facets: ${finalState.facets.size}`);
  console.log(`  Active streams: ${Array.from(finalState.streams.keys()).join(', ')}`);
  console.log(`  Current focus: ${finalState.currentFocus || 'none'}`);

  // Compress and render
  const compressed = await compression.compress(finalState.facets, {
    maxBlocks: 100
  });
  
  const rendered = hud.render(compressed.blocks, {
    systemPrompt: 'You are the captain of a deep space exploration vessel in a CLI simulation.\nMaintain immersion and respond naturally to your crew and situations.',
    userPrompt: '<cmd>status --full</cmd>',
    prefillFormat: true
  }, finalState.currentFocus);

  // Display the complete rendered context
  console.log('\n' + '='.repeat(80));
  console.log('FINAL RENDERED CONTEXT');
  console.log('='.repeat(80) + '\n');
  
  console.log('<system>');
  console.log(rendered.system);
  console.log('</system>\n');
  
  console.log('<user>');
  console.log(rendered.messages[0].content);
  console.log('</user>\n');
  
  console.log('<assistant>');
  console.log(rendered.messages[1].content);
  
  if (rendered.prefill) {
    console.log('\n' + rendered.prefill);
  }
  console.log('</assistant>');
  
  console.log('\n' + '='.repeat(80));
  console.log(`Token estimate: ${rendered.metadata?.tokenCount || 'N/A'}`);
  console.log(`Blocks rendered: ${compressed.blocks.length}`);
  console.log('='.repeat(80));
}

// Run the test
testFinalRender().catch(console.error);

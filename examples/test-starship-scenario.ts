/**
 * Test the starship scenario through the full VEIL pipeline
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { PassthroughCompressionEngine } from '../src/compression/passthrough-engine';
import { SaliencyAwareHUD } from '../src/hud/saliency-aware-hud';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testStarshipScenario() {
  console.log('=== Testing Starship Scenario ===\n');

  // Initialize components
  const veilState = new VEILStateManager();
  const compression = new PassthroughCompressionEngine();
  const hud = new SaliencyAwareHUD();

  // Process each frame
  for (const frame of starshipScenarioFrames) {
    console.log(`\n--- Processing Frame ${frame.sequence} ---`);
    
    // Skip tool definition frame for now
    if (frame.sequence === 10) {
      console.log('(Skipping tool definitions frame)');
      continue;
    }

    // Detect frame type - outgoing frames have specific operation types
    const isOutgoing = frame.operations.some(op => 
      op.type === 'speak' || 
      op.type === 'toolCall' || 
      op.type === 'innerThoughts' || 
      op.type === 'cycleRequest'
    );
    
    if (!isOutgoing) {
      // Incoming frame
      const incomingFrame = frame as IncomingVEILFrame;
      console.log(`Incoming frame - Focus: ${incomingFrame.focus || 'none'}`);
      
      veilState.applyIncomingFrame(incomingFrame);

      // Show current streams
      const streams = veilState.getStreams();
      if (streams.size > 0) {
        console.log('Active streams:', Array.from(streams.keys()).join(', '));
      }

      // Check for agent activation
      const hasActivation = incomingFrame.operations.some(op => op.type === 'agentActivation');
      if (hasActivation) {
        console.log('\n🤖 AGENT ACTIVATION TRIGGERED');
        
        // Get current state and render
        const currentState = veilState.getState();
        const compressed = await compression.compress(currentState.facets, {
          maxBlocks: 50
        });
        const rendered = hud.render(compressed.blocks, {
          systemPrompt: 'You are the captain of a deep space exploration vessel in a CLI simulation.',
          userPrompt: '<cmd>status --full</cmd>',
          prefillFormat: true
        }, incomingFrame.focus);
        
        console.log('\n--- Rendered Context ---');
        console.log('System:', rendered.system);
        console.log('\nMessages:');
        rendered.messages.forEach(msg => {
          console.log(`${msg.role.toUpperCase()}:\n${msg.content}\n`);
        });
        if (rendered.prefill) {
          console.log('Prefill:', rendered.prefill);
        }
        console.log(`\nToken estimate: ${rendered.metadata?.tokenCount || 'N/A'}`);
        console.log(`Blocks included: ${compressed.blocks.length}`);
      }
    } else {
      // Outgoing frame
      const outgoingFrame = frame as OutgoingVEILFrame;
      console.log('Outgoing frame from agent');
      
      // Show speak operations
      const speakOps = outgoingFrame.operations.filter(op => op.type === 'speak');
      if (speakOps.length > 0) {
        console.log('\nAgent speaks:');
        speakOps.forEach(op => {
          if (op.type === 'speak') {
            const target = op.target || veilState.getState().currentFocus || 'default';
            console.log(`  [${target}] "${op.content}"`);
          }
        });
      }

      // Show tool calls
      const toolCalls = outgoingFrame.operations.filter(op => op.type === 'toolCall');
      if (toolCalls.length > 0) {
        console.log('\nAgent tool calls:');
        toolCalls.forEach(op => {
          if (op.type === 'toolCall') {
            console.log(`  - ${op.toolName}(${JSON.stringify(op.parameters)})`);
          }
        });
      }

      // Show inner thoughts
      const thoughts = outgoingFrame.operations.filter(op => op.type === 'innerThoughts');
      if (thoughts.length > 0) {
        console.log('\nAgent thinks:');
        thoughts.forEach(op => {
          if (op.type === 'innerThoughts') {
            console.log(`  💭 "${op.content}"`);
          }
        });
      }
    }
  }

  console.log('\n\n=== Final State Summary ===');
  const finalState = veilState.getState();
  console.log(`Total facets: ${finalState.facets.size}`);
  console.log(`Active scopes: ${Array.from(finalState.scopes).join(', ')}`);
  console.log(`Active streams: ${Array.from(finalState.streams.keys()).join(', ')}`);
  console.log(`Current focus: ${finalState.currentFocus || 'none'}`);

  // Show facet breakdown by type
  const facetsByType = new Map<string, number>();
  finalState.facets.forEach(facet => {
    const count = facetsByType.get(facet.type) || 0;
    facetsByType.set(facet.type, count + 1);
  });
  
  console.log('\nFacets by type:');
  facetsByType.forEach((count, type) => {
    console.log(`  ${type}: ${count}`);
  });
}

// Run the test
testStarshipScenario().catch(console.error);

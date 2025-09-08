/**
 * Test showing how saliency-aware rendering works
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { PassthroughCompressionEngine } from '../src/compression/passthrough-engine';
import { SaliencyAwareHUD } from '../src/hud/saliency-aware-hud';
import { saliencyExample } from './saliency-example';

async function testSaliencyRendering() {
  console.log("=== Testing Saliency-Aware Rendering ===\n");

  // Initialize components
  const veilState = new VEILStateManager();
  const compression = new PassthroughCompressionEngine();
  const hud = new SaliencyAwareHUD();

  // Apply all frames from the example
  for (const frame of saliencyExample) {
    if ('operations' in frame) {
      veilState.applyIncomingFrame(frame);
    } else {
      veilState.recordOutgoingFrame(frame);
    }
  }

  // Test rendering at different points with different focus

  console.log("1. Rendering while focused on discord:general (after file share)");
  await renderAtPoint(veilState, compression, hud, "discord:general", 3);

  console.log("\n2. Rendering while focused on discord:dev");
  await renderAtPoint(veilState, compression, hud, "discord:dev", 9);

  console.log("\n3. Rendering after returning to discord:general (file expired)");
  await renderAtPoint(veilState, compression, hud, "discord:general", 10);
}

async function renderAtPoint(
  veilState: VEILStateManager,
  compression: PassthroughCompressionEngine,
  hud: SaliencyAwareHUD,
  focus: string,
  upToFrame: number
) {
  // Get state at specific point
  const state = veilState.getState();
  const streams = veilState.getStreams();
  
  // Filter facets up to the specified frame
  const activeFacets = new Map();
  for (const [id, facet] of veilState.getActiveFacets()) {
    // Simple check - in real impl would track which frame added each facet
    activeFacets.set(id, facet);
  }

  // Compress
  const compressed = await compression.compress(activeFacets, {});
  
  console.log(`Active facets: ${activeFacets.size}`);
  console.log(`Compressed blocks: ${compressed.blocks.length}`);

  // Render with saliency
  const rendered = hud.render(
    compressed.blocks,
    {
      maxContextTokens: 1000,  // Limited context to show selection
      focusBoost: 2.0,
      transientDecayRate: 0.5
    },
    focus,
    streams
  );

  // Show what was included
  console.log(`Focus: ${focus}`);
  console.log(`Rendered blocks in context:`);
  
  const content = rendered.messages[1].content;  // Assistant message
  const lines = content.split('\n').slice(0, 20);  // First 20 lines
  console.log(lines.map(l => '  ' + l).join('\n'));
  
  if (content.length > lines.join('\n').length) {
    console.log('  ...(truncated)');
  }
}

// Run the test
testSaliencyRendering().catch(console.error);

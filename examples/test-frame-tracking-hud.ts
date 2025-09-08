/**
 * Test the new FrameTrackingHUD with the spaceship scenario
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { TurnBasedXmlHUD } from '../src/hud/turn-based-xml-hud';
import { ChronologicalCompressionEngine } from '../src/compression/chronological-engine';
import { starshipScenarioFrames } from './starship-scenario-veil';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testFrameTrackingHUD() {
  console.log('=== Testing FrameTrackingHUD ===\n');
  
  // Set up VEIL state
  const veilState = new VEILStateManager();
  const frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[] = [];
  
  // Apply all frames
  console.log('Applying frames...');
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
        frameHistory.push(frame as IncomingVEILFrame);
      } else {
        // This is an outgoing frame (has speak/toolCall operations)
        veilState.recordOutgoingFrame(frame as any);
        frameHistory.push(frame as OutgoingVEILFrame);
      }
    }
  }
  
  const currentFacets = veilState.getActiveFacets();
  console.log(`Total frames: ${frameHistory.length}`);
  console.log(`Total facets: ${currentFacets.size}`);
  
  // Test 1: Basic rendering without compression
  console.log('\n--- Test 1: Basic Rendering (No Compression) ---');
  
  const frameTrackingHUD = new FrameTrackingHUD();
  const result = frameTrackingHUD.render(
    frameHistory,
    currentFacets,
    undefined, // No compression
    {
      systemPrompt: 'You are the helm officer on a starship bridge.'
    }
  );
  
  console.log(`Messages: ${result.messages.length}`);
  console.log(`Total tokens: ${result.metadata.totalTokens}`);
  
  // Show the rendered content
  const assistantMessage = result.messages.find(m => m.role === 'assistant');
  console.log('\nRendered content preview:');
  const lines = assistantMessage?.content.split('\n') || [];
  console.log(lines.slice(0, 30).join('\n'));
  console.log('...');
  console.log(lines.slice(-20).join('\n'));
  
  // Test 2: Compare with TurnBasedXmlHUD
  console.log('\n--- Test 2: Compare with TurnBasedXmlHUD ---');
  
  // Get blocks for TurnBasedXmlHUD (it still uses the old interface)
  const compression = new ChronologicalCompressionEngine();
  const { blocks } = await compression.compress(currentFacets, {});
  
  const turnBasedHUD = new TurnBasedXmlHUD();
  const turnBasedResult = turnBasedHUD.render(blocks, {});
  
  const turnBasedContent = turnBasedResult.messages.find(m => m.role === 'assistant')?.content || '';
  const frameTrackingContent = assistantMessage?.content || '';
  
  console.log(`TurnBasedXmlHUD length: ${turnBasedContent.length}`);
  console.log(`FrameTrackingHUD length: ${frameTrackingContent.length}`);
  
  // Check for key elements
  const elements = [
    'sensor_alert',
    'transmission_detected',
    'scan_results',
    'my_turn',
    'Investigating the anomaly',
    'mission_update',
    'ship_status',
    'crew_activity'
  ];
  
  console.log('\nChecking for key elements:');
  for (const element of elements) {
    const inTurnBased = turnBasedContent.includes(element);
    const inFrameTracking = frameTrackingContent.includes(element);
    const match = inTurnBased === inFrameTracking ? '✓' : '✗';
    console.log(`${match} ${element}: TurnBased=${inTurnBased}, FrameTracking=${inFrameTracking}`);
  }
  
  // Test 3: With frame tracking details
  console.log('\n--- Test 3: Frame Tracking Details ---');
  
  const { frameRenderings } = frameTrackingHUD.renderWithFrameTracking(
    frameHistory,
    currentFacets
  );
  
  console.log(`\nFrame renderings: ${frameRenderings.length}`);
  frameRenderings.slice(0, 5).forEach(fr => {
    console.log(`Frame ${fr.frameSequence}: ${fr.tokens} tokens, ${fr.facetIds.length} facets`);
    console.log(`  Preview: ${fr.content.substring(0, 60)}...`);
  });
  
  // Test 4: Check frame separation
  console.log('\n--- Test 4: Frame Separation ---');
  
  // Check that agent frames are wrapped in my_turn
  const agentFrames = frameHistory.filter(f => 
    f.operations.some(op => op.type === 'speak' || op.type === 'toolCall')
  );
  console.log(`\nAgent frames: ${agentFrames.length}`);
  
  // Count my_turn blocks
  const myTurnCount = (frameTrackingContent.match(/<my_turn>/g) || []).length;
  console.log(`<my_turn> blocks: ${myTurnCount}`);
  console.log(`Expected ~${agentFrames.length} agent turns`);
}

// Run the test
testFrameTrackingHUD().catch(console.error);

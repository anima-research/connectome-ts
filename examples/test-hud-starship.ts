/**
 * Test the Frame Tracking HUD with the starship scenario
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { starshipScenarioFrames } from './starship-scenario-veil';

function testStarshipHUD() {
  console.log('=== Testing Frame Tracking HUD with Starship Scenario ===\n');
  
  // Initialize
  const veilState = new VEILStateManager();
  const hud = new FrameTrackingHUD();
  
  // Apply only the first 9 frames (before the fractional one)
  const framesToTest = starshipScenarioFrames.slice(0, 9);
  
  for (const frame of framesToTest) {
    console.log(`\n--- Frame ${frame.sequence} ---`);
    
    if ('activeStream' in frame) {
      // Incoming frame
      veilState.applyIncomingFrame(frame as any);
      console.log('Type: Incoming');
      console.log(`Stream: ${frame.activeStream?.streamId || 'none'}`);
    } else {
      // Outgoing frame  
      veilState.recordOutgoingFrame(frame as any);
      console.log('Type: Outgoing (Agent)');
    }
  }
  
  // Render the final context
  const frameHistory = veilState.getState().frameHistory;
  const result = hud.renderWithFrameTracking(
    frameHistory,
    veilState.getActiveFacets(),
    undefined, // no compression for this test
    {
      maxTokens: 2000,
      systemPrompt: 'You are the AI assistant aboard the ISS Endeavor.',
      formatConfig: {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      }
    }
  );
  
  console.log('\n=== Final Rendered Context ===');
  console.log('\nRendered messages:');
  result.context.messages.forEach((msg: any, i: number) => {
    console.log(`[${i}] ${msg.role}:`);
    // Show first 200 chars
    const preview = msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '');
    console.log(`    ${preview.replace(/\n/g, '\n    ')}`);
  });
  
  // Show ambient facets and state separately
  const activeFacets = veilState.getActiveFacets();
  const ambientCount = Array.from(activeFacets.values()).filter(f => f.type === 'ambient').length;
  const stateCount = Array.from(activeFacets.values()).filter(f => f.type === 'state').length;
  const eventCount = Array.from(activeFacets.values()).filter(f => f.type === 'event').length;
  
  console.log(`\nActive facets: ${ambientCount} ambient, ${stateCount} states, ${eventCount} events`);
  
  // Check if events are persisting incorrectly
  if (eventCount > 0) {
    console.warn('⚠️  Event facets are persisting in state - they should only appear in their frame!');
    console.log('Event facets:');
    Array.from(activeFacets.values())
      .filter(f => f.type === 'event')
      .forEach(f => console.log(`  - ${f.id}: ${f.content?.slice(0, 50)}...`));
  }
  
  console.log('\n=== Test Complete ===');
}

// Run the test
testStarshipHUD();

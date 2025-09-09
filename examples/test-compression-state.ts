/**
 * Test compression with state preservation
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { SimpleTestCompressionEngine } from '../src/compression/simple-test-engine';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

async function testCompressionWithState() {
  console.log('=== Test Compression with State Preservation ===\n');
  
  // Create components
  const veilState = new VEILStateManager();
  const hud = new FrameTrackingHUD();
  const compression = new SimpleTestCompressionEngine();
  
  // Create test frames with state changes
  const frames: (IncomingVEILFrame | OutgoingVEILFrame)[] = [
    // Frame 1: Initial state
    {
      sequence: 1,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'addFacet',
          facet: {
            id: 'game-state',
            type: 'state',
            displayName: 'game_status',
            content: 'Game starting...',
            attributes: {
              score: 0,
              level: 1,
              lives: 3
            }
          }
        },
        {
          type: 'addFacet',
          facet: {
            id: 'user-msg-1',
            type: 'event',
            displayName: 'message',
            content: 'Start the game!',
            attributes: {}
          }
        }
      ]
    },
    
    // Frame 2: Agent response
    {
      sequence: 2,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'speak',
          content: 'Welcome to the game! Starting level 1...'
        }
      ]
    },
    
    // Frames 3-7: Game progress (will be compressed)
    {
      sequence: 3,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'changeState',
          facetId: 'game-state',
          updates: {
            content: 'Player collected a coin',
            attributes: { score: 10 }
          }
        }
      ]
    },
    {
      sequence: 4,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'changeState',
          facetId: 'game-state',
          updates: {
            content: 'Player defeated enemy',
            attributes: { score: 30 }
          }
        }
      ]
    },
    {
      sequence: 5,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'changeState',
          facetId: 'game-state',
          updates: {
            content: 'Player completed level',
            attributes: { score: 100, level: 2 }
          }
        }
      ]
    },
    {
      sequence: 6,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'speak',
          content: 'Great job! Moving to level 2...'
        }
      ]
    },
    {
      sequence: 7,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'changeState',
          facetId: 'game-state',
          updates: {
            content: 'Player took damage',
            attributes: { lives: 2 }
          }
        }
      ]
    },
    
    // Frame 8: Current state
    {
      sequence: 8,
      timestamp: new Date().toISOString(),
      operations: [
        {
          type: 'addFacet',
          facet: {
            id: 'user-msg-2',
            type: 'event',
            displayName: 'message',
            content: 'What is my current status?',
            attributes: {}
          }
        }
      ]
    }
  ];
  
  // Process frames through VEIL state
  for (const frame of frames) {
    if ('activeStream' in frame || frame.operations.some((op: any) => op.type === 'addFacet' || op.type === 'changeState')) {
      veilState.applyIncomingFrame(frame as IncomingVEILFrame);
    } else {
      veilState.recordOutgoingFrame(frame as OutgoingVEILFrame);
    }
  }
  
  // Get current facets
  const currentFacets = veilState.getActiveFacets();
  
  // First, render without compression
  console.log('=== Without Compression ===');
  const uncompressed = hud.render(frames, currentFacets);
  console.log('Messages:', uncompressed.messages.length);
  uncompressed.messages.forEach((msg, i) => {
    console.log(`\n[${i}] ${msg.role}:`);
    console.log(msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : ''));
  });
  
  // Identify compressible ranges
  const renderedFrames = (uncompressed.metadata as any).renderedFrames;
  const ranges = compression.identifyCompressibleRanges(frames, renderedFrames);
  console.log('\n\nCompressible ranges:', ranges);
  
  // Compress a range that includes state changes
  if (ranges.length > 0) {
    const result = await compression.compressRange(ranges[0], frames, renderedFrames, currentFacets);
    console.log('\nCompression result:');
    console.log('- Summary:', (result.engineData as any).summary);
    console.log('- State delta:', result.stateDelta);
    
    if (result.stateDelta) {
      console.log('\nState changes in compressed range:');
      for (const [id, changes] of result.stateDelta.changes) {
        console.log(`  ${id}:`, changes);
      }
    }
    
    // Now render with compression
    console.log('\n\n=== With Compression ===');
    const compressed = hud.render(frames, currentFacets, compression);
    console.log('Messages:', compressed.messages.length);
    compressed.messages.forEach((msg, i) => {
      console.log(`\n[${i}] ${msg.role}:`);
      console.log(msg.content);
    });
    
    // Verify state is still correct
    console.log('\n\n=== State Verification ===');
    const gameState = currentFacets.get('game-state');
    if (gameState && gameState.type === 'state') {
      console.log('Final game state:');
      console.log('- Content:', gameState.content);
      console.log('- Score:', gameState.attributes?.score);
      console.log('- Level:', gameState.attributes?.level);
      console.log('- Lives:', gameState.attributes?.lives);
    }
  }
}

// Run the test
testCompressionWithState().catch(console.error);

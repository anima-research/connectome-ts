/**
 * Simple test to demonstrate compression with state preservation
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { SimpleTestCompressionEngine } from '../src/compression/simple-test-engine';
import { Frame } from '../src/veil/types';

// Create a modified compression engine with lower thresholds
class TestCompressionEngine extends SimpleTestCompressionEngine {
  identifyCompressibleRanges(frames: any[], renderedFrames: any[]): any[] {
    // Compress frames 2-4 as a test
    return [{
      fromFrame: 2,
      toFrame: 4,
      totalTokens: 300,
      reason: 'Test compression'
    }];
  }
}

async function testCompressionWithState() {
  console.log('=== Simple Compression with State Test ===\n');
  
  // Create components
  const veilState = new VEILStateManager();
  const hud = new FrameTrackingHUD();
  const compression = new TestCompressionEngine();
  
  // Create test frames
  const frames: (Frame | Frame)[] = [
    // Frame 1: Initial state
    {
      sequence: 1,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'addFacet',
          facet: {
            id: 'counter',
            type: 'state',
            displayName: 'counter',
            content: 'Count: 0',
            attributes: { value: 0 }
          }
        }
      ]
    } as Frame,
    
    // Frame 2: Change state (will be compressed)
    {
      sequence: 2,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'changeFacet',
          id: 'counter',
          changes: {
            content: 'Count: 5',
            attributes: { value: 5 }
          }
        }
      ]
    } as Frame,
    
    // Frame 3: Change state again (will be compressed)
    {
      sequence: 3,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'changeFacet',
          id: 'counter',
          changes: {
            content: 'Count: 10',
            attributes: { value: 10 }
          }
        }
      ]
    } as Frame,
    
    // Frame 4: Final state in compressed range
    {
      sequence: 4,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'changeFacet',
          id: 'counter',
          changes: {
            content: 'Count: 15',
            attributes: { value: 15, special: true }
          }
        }
      ]
    } as Frame,
    
    // Frame 5: After compression
    {
      sequence: 5,
      timestamp: new Date().toISOString(),
      deltas: [
        {
          type: 'addFacet',
          facet: {
            id: 'msg',
            type: 'event',
            displayName: 'message',
            content: 'What is the count?',
            attributes: {}
          }
        }
      ]
    } as Frame
  ];
  
  // Process frames
  for (const frame of frames) {
    veilState.applyFrame(frame as Frame);
  }
  
  const currentFacets = veilState.getActiveFacets();
  
  // Render without compression
  console.log('=== Without Compression ===');
  const uncompressed = hud.render(frames, currentFacets);
  console.log('Total messages:', uncompressed.messages.length);
  uncompressed.messages.forEach((msg, i) => {
    console.log(`\n[${i}] ${msg.role}:`);
    console.log(msg.content);
  });
  
  // Get rendered frames for compression
  const renderedFrames = (uncompressed.metadata as any).renderedFrames;
  
  // Compress the range
  const range = compression.identifyCompressibleRanges(frames, renderedFrames)[0];
  console.log('\n\n=== Compressing frames', range.fromFrame, '-', range.toFrame, '===');
  
  const result = await compression.compressRange(range, frames, renderedFrames, currentFacets);
  console.log('\nCompression summary:', (result.engineData as any).summary);
  
  if (result.stateDelta) {
    console.log('\nState Delta:');
    console.log('- Changes:', result.stateDelta.changes.size, 'facets');
    for (const [id, changes] of result.stateDelta.changes) {
      console.log(`  ${id}:`, changes);
    }
    console.log('- Added:', result.stateDelta.added);
    console.log('- Deleted:', result.stateDelta.deleted);
  }
  
  // Render with compression
  console.log('\n\n=== With Compression ===');
  const compressed = hud.render(frames, currentFacets, compression);
  console.log('Total messages:', compressed.messages.length);
  compressed.messages.forEach((msg, i) => {
    console.log(`\n[${i}] ${msg.role}:`);
    console.log(msg.content);
  });
  
  // Verify final state
  console.log('\n\n=== Final State Verification ===');
  const counter = currentFacets.get('counter');
  if (counter && counter.type === 'state') {
    console.log('Counter state:');
    console.log('- Content:', counter.content);
    console.log('- Value:', counter.attributes?.value);
    console.log('- Special:', counter.attributes?.special);
  }
}

// Run test
testCompressionWithState().catch(console.error);

/**
 * Test compression with multiple states changing in compressed frames
 */

import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { AttentionAwareCompressionEngine } from '../src/compression/attention-aware-engine';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { IncomingVEILFrame } from '../src/veil/types';

async function testCompressionMultipleStates() {
  console.log('=== Testing Compression with Multiple State Changes ===\n');
  
  const veilState = new VEILStateManager();
  const frames: IncomingVEILFrame[] = [];
  
  // Frame 1: Add multiple initial states
  frames.push({
    sequence: 1,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'shields',
          type: 'state',
          displayName: 'Shield Status',
          content: 'Shields at 100%',
          scope: []
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'weapons',
          type: 'state',
          displayName: 'Weapons',
          content: 'Weapons offline',
          scope: []
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'engines',
          type: 'state',
          displayName: 'Engine Status',
          content: 'Engines at full power',
          scope: []
        }
      }
    ]
  });
  
  // Frame 2: Event
  frames.push({
    sequence: 2,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'event-1',
          type: 'event',
          content: 'Enemy vessel detected',
          scope: []
        }
      }
    ]
  });
  
  // Frame 3: Change shields (will be compressed)
  frames.push({
    sequence: 3,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'changeFacet',
        id: 'shields',
        changes: { content: 'Shields at 75% - taking damage' }
      }
    ]
  });
  
  // Frame 4: Change weapons (will be compressed)
  frames.push({
    sequence: 4,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'changeFacet',
        id: 'weapons',
        changes: { content: 'Weapons armed and targeting' }
      }
    ]
  });
  
  // Frame 5: Change engines and shields again (will be compressed)
  frames.push({
    sequence: 5,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'changeFacet',
        id: 'engines',
        changes: { content: 'Engines damaged - 50% power' }
      },
      {
        type: 'changeFacet',
        id: 'shields',
        changes: { content: 'Shields critical - 25%' }
      }
    ]
  });
  
  // Frame 6: Event after compression
  frames.push({
    sequence: 6,
    timestamp: new Date().toISOString(),
    deltas: [
      {
        type: 'addFacet',
        facet: {
          id: 'event-2',
          type: 'event',
          content: 'Evasive maneuvers initiated',
          scope: []
        }
      }
    ]
  });
  
  // Apply all frames
  for (const frame of frames) {
    veilState.applyIncomingFrame(frame);
  }
  
  const currentFacets = veilState.getActiveFacets();
  const hud = new FrameTrackingHUD();
  
  // Render without compression
  console.log('--- Without Compression ---');
  const uncompressedResult = hud.render(frames, currentFacets);
  const uncompressedContent = uncompressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  console.log('State changes in timeline:');
  const lines = uncompressedContent.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('Shield') || line.includes('Weapon') || line.includes('Engine')) {
      console.log(`  ${line.trim()}`);
    }
  });
  
  // Set up compression
  const mockLLM = new MockLLMProvider();
  mockLLM.addResponse('[Compressed: Battle sequence - enemy detected, shields taking damage, weapons armed, engines damaged]');
  
  const compression = new AttentionAwareCompressionEngine(mockLLM, {
    chunkThreshold: 100,
    maxChunkSize: 300
  });
  
  const { frameRenderings } = hud.renderWithFrameTracking(frames, currentFacets);
  const ranges = compression.identifyCompressibleRanges(frames, frameRenderings);
  
  for (const range of ranges) {
    await compression.compressRange(range, frames, frameRenderings, currentFacets);
  }
  
  // Render with compression
  console.log('\n--- With Compression ---');
  const compressedResult = hud.render(frames, currentFacets, compression);
  const compressedContent = compressedResult.messages.find(m => m.role === 'assistant')?.content || '';
  
  console.log('Full compressed output:');
  compressedContent.split('\n').forEach((line, i) => {
    if (line.trim()) console.log(`${i + 1}: ${line}`);
  });
  
  // Check state preservation
  console.log('\n--- State Preservation Analysis ---');
  
  const states = ['Shields critical - 25%', 'Weapons armed and targeting', 'Engines damaged - 50% power'];
  states.forEach(state => {
    const found = compressedContent.includes(state);
    console.log(`${found ? '✓' : '✗'} Final state preserved: "${state}"`);
  });
  
  // Check chronological history
  console.log('\n--- Chronological History ---');
  const chronologicalStates = ['Shields at 75%', 'Weapons armed', 'Engines damaged'];
  let foundAny = false;
  chronologicalStates.forEach(state => {
    const found = compressedContent.includes(state);
    if (found) foundAny = true;
    console.log(`${found ? '✓' : '✗'} Intermediate state visible: "${state}"`);
  });
  
  if (!foundAny) {
    console.log('\n⚠️  Note: Intermediate state changes are compressed away.');
    console.log('Only final state values are preserved at the end.');
    console.log('This is correct behavior - compression summarizes the changes.');
  }
}

testCompressionMultipleStates().catch(console.error);

/**
 * Example: Frame Snapshot Capture
 * 
 * Demonstrates the frame snapshot types and how snapshots work.
 * Shows chunked content with facet attribution.
 */

import { 
  Frame,
  FrameRenderedSnapshot,
  RenderedChunk,
  createRenderedChunk,
  concatenateChunks,
  sumChunkTokens,
  getReferencedFacets,
  filterChunksByType
} from '../src';

console.log('=== Frame Snapshot Types Example ===\n');

// Example 1: Agent frame with turn markers
console.log('--- Example 1: Agent Frame ---');

const agentSnapshot: FrameRenderedSnapshot = {
  chunks: [
    createRenderedChunk('<my_turn>\n\n', 2, { chunkType: 'turn-marker' }),
    createRenderedChunk(
      'I analyzed the data and found three key patterns.',
      12,
      { facetIds: ['speech-123'], chunkType: 'speech' }
    ),
    createRenderedChunk('\n\n</my_turn>', 2, { chunkType: 'turn-marker' })
  ],
  totalTokens: 16,
  totalContent: '<my_turn>\n\nI analyzed the data...\n\n</my_turn>',
  capturedAt: Date.now()
};

console.log(`Total chunks: ${agentSnapshot.chunks.length}`);
console.log(`Total tokens: ${agentSnapshot.totalTokens}`);
console.log(`Content length: ${agentSnapshot.totalContent.length} chars\n`);

// Analyze chunks
console.log('Chunks:');
agentSnapshot.chunks.forEach((chunk, i) => {
  console.log(`  [${i}] Type: ${chunk.chunkType || 'none'}, ` +
              `Facets: ${chunk.facetIds?.join(',') || 'none'}, ` +
              `Tokens: ${chunk.tokens}`);
});

// Example 2: Environment frame with events and states
console.log('\n--- Example 2: Environment Frame ---');

const envSnapshot: FrameRenderedSnapshot = {
  chunks: [
    createRenderedChunk(
      '<event>User said: What\'s the count?</event>',
      10,
      { facetIds: ['event-456'], chunkType: 'event' }
    ),
    createRenderedChunk(
      '<state id="counter">Count: 42 (+5)</state>',
      12,
      { facetIds: ['state-counter'], chunkType: 'state' }
    )
  ],
  totalTokens: 22,
  totalContent: '<event>...</event><state>...</state>',
  capturedAt: Date.now()
};

console.log(`Total chunks: ${envSnapshot.chunks.length}`);
console.log(`Total tokens: ${envSnapshot.totalTokens}\n`);

// Example 3: Using helper functions
console.log('--- Example 3: Helper Functions ---\n');

const allChunks = [...agentSnapshot.chunks, ...envSnapshot.chunks];

console.log(`All chunks concatenated:\n"${concatenateChunks(allChunks).substring(0, 80)}..."\n`);
console.log(`Total tokens (sum): ${sumChunkTokens(allChunks)}`);
console.log(`Referenced facets: ${getReferencedFacets(allChunks).join(', ')}\n`);

// Filter by type
const turnMarkers = filterChunksByType(allChunks, 'turn-marker');
const contentChunks = filterChunksByType(allChunks, 'speech');

console.log(`Turn markers: ${turnMarkers.length}`);
console.log(`Speech chunks: ${contentChunks.length}`);

// Example 4: Simulating compression usage
console.log('\n--- Example 4: Compression Usage ---\n');

// Simulate frames with snapshots
const mockFrames: Frame[] = [
  {
    sequence: 1,
    timestamp: new Date().toISOString(),
    events: [],
    deltas: [],
    transition: { type: 'continuation', timestamp: new Date().toISOString() },
    renderedSnapshot: envSnapshot
  },
  {
    sequence: 2,
    timestamp: new Date().toISOString(),
    events: [],
    deltas: [],
    transition: { type: 'continuation', timestamp: new Date().toISOString() },
    renderedSnapshot: agentSnapshot
  }
];

// Extract content for compression
const framesToCompress = mockFrames.filter(f => 
  f.sequence >= 1 && f.sequence <= 2
);

const compressibleContent = framesToCompress
  .map(f => f.renderedSnapshot?.totalContent || '')
  .join('\n\n');

const totalTokens = framesToCompress.reduce(
  (sum, f) => sum + (f.renderedSnapshot?.totalTokens || 0),
  0
);

console.log(`Frames to compress: ${framesToCompress.length}`);
console.log(`Total tokens: ${totalTokens}`);
console.log(`Content length: ${compressibleContent.length} chars`);
console.log(`\nContent:\n${compressibleContent.substring(0, 150)}...\n`);

// Example 5: Facet attribution analysis
console.log('--- Example 5: Facet Attribution ---\n');

const facetCounts = new Map<string, number>();
for (const frame of mockFrames) {
  if (frame.renderedSnapshot) {
    for (const chunk of frame.renderedSnapshot.chunks) {
      if (chunk.facetIds) {
        for (const facetId of chunk.facetIds) {
          facetCounts.set(facetId, (facetCounts.get(facetId) || 0) + 1);
        }
      }
    }
  }
}

console.log('Facets referenced across frames:');
for (const [facetId, count] of facetCounts) {
  console.log(`  ${facetId}: ${count} chunk(s)`);
}

console.log('\n=== Done ===');

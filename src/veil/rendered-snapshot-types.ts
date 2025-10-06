/**
 * Types for rendered frame snapshots
 * 
 * Captures how frames render at creation time, stored as chunks with
 * optional facet attribution. This preserves the original subjective
 * experience for compression and allows fine-grained tracking of what
 * contributed to rendered output.
 */

/**
 * A chunk of rendered content from a frame
 * 
 * Chunks represent atomic pieces of rendered output. They may correspond
 * to individual facets, groups of facets, or unattributed content.
 */
export interface RenderedChunk {
  /**
   * The rendered text content of this chunk
   */
  content: string;
  
  /**
   * Token count for this chunk (estimated)
   */
  tokens: number;
  
  /**
   * Optional: which VEIL facets contributed to this chunk
   * 
   * This is often present but not required. Some rendered content
   * (like turn markers, formatting) may not correspond to specific facets.
   * 
   * Multiple facets can contribute to a single chunk (e.g., state changes),
   * or a single facet can span multiple chunks (e.g., long content split up).
   */
  facetIds?: string[];
  
  /**
   * Optional: semantic type of this chunk
   * 
   * Helps understand what this chunk represents without needing to
   * inspect the facets. Useful for compression, filtering, or analysis.
   * 
   * This is completely open-ended (like facet types) - any string is valid.
   * Examples: 'event', 'state', 'ambient', 'compressed', 'turn-marker', etc.
   */
  chunkType?: string;
  
  /**
   * Optional: arbitrary metadata about this chunk
   * 
   * Can store HUD-specific information, rendering context, etc.
   * Examples:
   * - streamId: which stream this came from
   * - agentId: which agent produced this
   * - turnMarker: true (indicates this is turn markup)
   */
  metadata?: Record<string, any>;
}

/**
 * Snapshot of how a frame rendered at creation time
 * 
 * Stored on the Frame object to preserve the original subjective experience.
 * Allows compression to operate on historical renderings even if later
 * transforms modify earlier frames.
 */
export interface FrameRenderedSnapshot {
  /**
   * Chunks of rendered content, in order
   * 
   * These chunks represent the frame's contribution to rendered context.
   * Concatenating chunk contents gives the full frame rendering.
   */
  chunks: RenderedChunk[];
  
  /**
   * Total tokens across all chunks
   * 
   * Sum of tokens from all chunks, for quick access without iteration.
   */
  totalTokens: number;
  
  /**
   * Total concatenated content
   * 
   * Pre-computed concatenation of all chunk contents for performance.
   * Equivalent to: chunks.map(c => c.content).join('')
   */
  totalContent: string;
  
  /**
   * When this snapshot was captured
   * 
   * Timestamp of snapshot creation (not necessarily frame creation).
   * Useful for debugging timing issues or validating snapshot freshness.
   */
  capturedAt?: number;
}

/**
 * Options for capturing frame snapshots
 */
export interface SnapshotCaptureOptions {
  /**
   * Whether to track facet attribution in chunks
   * 
   * If true, HUD will attempt to associate rendered content with source facets.
   * If false, chunks will have content but no facetIds.
   * 
   * Default: true
   */
  trackFacets?: boolean;
  
  /**
   * Whether to track chunk types
   * 
   * If true, HUD will set chunkType on chunks.
   * If false, chunks will have content but no semantic type.
   * 
   * Default: true
   */
  trackChunkTypes?: boolean;
  
  /**
   * Whether to include metadata in chunks
   * 
   * If true, HUD can add custom metadata to chunks.
   * If false, no metadata is stored.
   * 
   * Default: false (metadata optional)
   */
  includeMetadata?: boolean;
  
  /**
   * Maximum chunk size in characters
   * 
   * If specified, HUD will split large facet renderings into smaller chunks.
   * If undefined, no chunking limit (one chunk per logical unit).
   * 
   * Default: undefined (no splitting)
   */
  maxChunkSize?: number;
}

/**
 * Result of building a snapshot from HUD rendering
 */
export interface SnapshotBuildResult {
  /**
   * The constructed snapshot
   */
  snapshot: FrameRenderedSnapshot;
  
  /**
   * Statistics about the snapshot capture
   */
  stats: {
    chunkCount: number;
    attributedChunks: number;  // How many chunks have facetIds
    unattributedChunks: number;  // How many chunks lack facetIds
    largestChunkTokens: number;
    smallestChunkTokens: number;
  };
  
  /**
   * Warnings or issues during capture
   */
  warnings?: string[];
}

/**
 * Helper: Build a simple chunk
 */
export function createRenderedChunk(
  content: string,
  tokens: number,
  options?: {
    facetIds?: string[];
    chunkType?: string;
    metadata?: Record<string, any>;
  }
): RenderedChunk {
  return {
    content,
    tokens,
    ...options
  };
}

/**
 * Helper: Concatenate chunks into full content
 */
export function concatenateChunks(chunks: RenderedChunk[]): string {
  return chunks.map(c => c.content).join('');
}

/**
 * Helper: Sum tokens across chunks
 */
export function sumChunkTokens(chunks: RenderedChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.tokens, 0);
}

/**
 * Helper: Get all facet IDs referenced in chunks
 */
export function getReferencedFacets(chunks: RenderedChunk[]): string[] {
  const facetIds = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.facetIds) {
      for (const id of chunk.facetIds) {
        facetIds.add(id);
      }
    }
  }
  return Array.from(facetIds);
}

/**
 * Helper: Filter chunks by type
 */
export function filterChunksByType(
  chunks: RenderedChunk[],
  type: string
): RenderedChunk[] {
  return chunks.filter(c => c.chunkType === type);
}

/**
 * Helper: Get chunks that reference a specific facet
 */
export function getChunksForFacet(
  chunks: RenderedChunk[],
  facetId: string
): RenderedChunk[] {
  return chunks.filter(c => c.facetIds?.includes(facetId));
}

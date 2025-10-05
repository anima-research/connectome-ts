/**
 * Frame Snapshot Types
 * 
 * Captures the rendered state of a frame at creation time, preserving
 * the original subjective experience for compression and replay.
 */

/**
 * A chunk of rendered content, optionally attributed to facets
 * 
 * Chunks are the atomic units of rendered content. They can represent:
 * - Content from a single facet (most common)
 * - Content from multiple related facets (e.g., state + transition)
 * - Unattributed content (system messages, formatting, etc.)
 */
export interface RenderedChunk {
  /** The actual rendered text content */
  content: string;
  
  /** Estimated token count for this chunk */
  tokens: number;
  
  /** 
   * Optional: Which facet(s) this chunk represents
   * Empty array or undefined = unattributed content (formatting, system messages, etc.)
   */
  facetIds?: string[];
  
  /** 
   * Optional: Semantic type hint for this chunk
   * Examples: 'event', 'state', 'ambient', 'speech', 'action', 'system', 'formatting'
   */
  type?: string;
  
  /**
   * Optional: Role attribution (for LLM context)
   * Helps determine which chunks should group into which messages
   */
  role?: 'user' | 'assistant' | 'system';
}

/**
 * Complete rendered snapshot of a frame at creation time
 * 
 * Preserves the original subjective experience of how this frame
 * rendered when it was created, before any later transforms modified history.
 */
export interface FrameRenderedSnapshot {
  /**
   * Individual chunks of rendered content
   * Ordered as they appeared in the rendered output
   */
  chunks: RenderedChunk[];
  
  /**
   * Total concatenated content (convenience)
   * Equal to: chunks.map(c => c.content).join('')
   */
  totalContent: string;
  
  /**
   * Total token count (convenience)
   * Equal to: sum of all chunk tokens
   */
  totalTokens: number;
  
  /**
   * Timestamp when this snapshot was captured
   */
  capturedAt: number;
  
  /**
   * Whether this frame produced any visible content
   * False for frames with only infrastructure changes
   */
  hasContent: boolean;
}

/**
 * Builder for constructing frame snapshots during rendering
 */
export class FrameSnapshotBuilder {
  private chunks: RenderedChunk[] = [];
  private totalTokens = 0;
  
  /**
   * Add a chunk of rendered content
   */
  addChunk(chunk: RenderedChunk): void {
    this.chunks.push(chunk);
    this.totalTokens += chunk.tokens;
  }
  
  /**
   * Add content with automatic token estimation
   */
  addContent(
    content: string,
    options?: {
      facetIds?: string[];
      type?: string;
      role?: 'user' | 'assistant' | 'system';
    }
  ): void {
    if (!content) return;
    
    this.addChunk({
      content,
      tokens: estimateTokens(content),
      facetIds: options?.facetIds,
      type: options?.type,
      role: options?.role
    });
  }
  
  /**
   * Build the final snapshot
   */
  build(): FrameRenderedSnapshot {
    const totalContent = this.chunks.map(c => c.content).join('');
    
    return {
      chunks: this.chunks,
      totalContent,
      totalTokens: this.totalTokens,
      capturedAt: Date.now(),
      hasContent: totalContent.trim().length > 0
    };
  }
  
  /**
   * Check if any content has been added
   */
  isEmpty(): boolean {
    return this.chunks.length === 0;
  }
}

/**
 * Simple token estimation (4 chars ≈ 1 token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract chunks for a specific frame range from multiple snapshots
 */
export function extractSnapshotRange(
  frameSnapshots: Array<{ sequence: number; snapshot: FrameRenderedSnapshot }>,
  fromFrame: number,
  toFrame: number
): {
  chunks: RenderedChunk[];
  totalContent: string;
  totalTokens: number;
} {
  const relevantSnapshots = frameSnapshots.filter(
    fs => fs.sequence >= fromFrame && fs.sequence <= toFrame
  );
  
  const chunks = relevantSnapshots.flatMap(fs => fs.snapshot.chunks);
  const totalContent = chunks.map(c => c.content).join('');
  const totalTokens = chunks.reduce((sum, c) => c.tokens, 0);
  
  return { chunks, totalContent, totalTokens };
}

/**
 * Get all facet IDs referenced in a snapshot
 */
export function getSnapshotFacets(snapshot: FrameRenderedSnapshot): Set<string> {
  const facetIds = new Set<string>();
  
  for (const chunk of snapshot.chunks) {
    if (chunk.facetIds) {
      for (const id of chunk.facetIds) {
        facetIds.add(id);
      }
    }
  }
  
  return facetIds;
}

/**
 * Find chunks that reference a specific facet
 */
export function findChunksByFacet(
  snapshot: FrameRenderedSnapshot,
  facetId: string
): RenderedChunk[] {
  return snapshot.chunks.filter(
    chunk => chunk.facetIds?.includes(facetId)
  );
}

/**
 * Group chunks by role for message construction
 */
export function groupChunksByRole(
  chunks: RenderedChunk[]
): Map<'user' | 'assistant' | 'system', RenderedChunk[]> {
  const groups = new Map<'user' | 'assistant' | 'system', RenderedChunk[]>();
  
  for (const chunk of chunks) {
    if (chunk.role) {
      const group = groups.get(chunk.role) || [];
      group.push(chunk);
      groups.set(chunk.role, group);
    }
  }
  
  return groups;
}

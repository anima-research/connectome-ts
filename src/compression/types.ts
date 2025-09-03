import { Facet } from '../veil/types';

/**
 * A block of content that can be rendered by the HUD
 */
export interface ContentBlock {
  id: string;
  type: 'facet' | 'summary' | 'narrative' | 'metadata';
  content: string;
  source?: Facet;  // Original facet if applicable
  priority?: number;  // Higher priority blocks render first
  metadata?: Record<string, any>;
}

/**
 * Request from HUD for compressed content
 */
export interface CompressionRequest {
  maxBlocks?: number;
  targetTokens?: number;
  includeTypes?: Array<'event' | 'state' | 'ambient'>;
  scope?: string[];
}

/**
 * Response from compression engine
 */
export interface CompressionResult {
  blocks: ContentBlock[];
  totalTokens: number;
  compressionRatio?: number;
  metadata?: {
    droppedFacets?: number;
    summarizedRanges?: Array<{from: number; to: number}>;
  };
}

/**
 * Interface for compression engines
 */
export interface CompressionEngine {
  /**
   * Process facets and return compressed blocks for rendering
   */
  compress(
    facets: Map<string, Facet>, 
    request: CompressionRequest
  ): Promise<CompressionResult>;

  /**
   * Prepare compression in advance (optional optimization)
   */
  prepareCompression?(facets: Map<string, Facet>): Promise<void>;

  /**
   * Clear any cached compression data
   */
  clearCache?(): void;
}

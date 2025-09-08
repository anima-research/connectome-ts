/**
 * Clean compression interface that works with VEIL primitives
 * No implementation-specific concepts like "narratives" or "summaries"
 */

import { Facet, IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';

// Union type for frames
type VEILFrame = IncomingVEILFrame | OutgoingVEILFrame;

/**
 * How a frame renders to text
 */
export interface RenderedFrame {
  frameSequence: number;
  content: string;
  tokens: number;
  facetIds: string[];  // Which facets were rendered from this frame
}

/**
 * A range of frames that could be compressed
 */
export interface CompressibleRange {
  fromFrame: number;
  toFrame: number;
  totalTokens: number;
  reason: string;  // Why this range is compressible
}

/**
 * Result of compressing a range
 */
export interface CompressionResult {
  replacesFrames: {
    from: number;
    to: number;
  };
  // Implementation-specific data - opaque to HUD
  engineData: unknown;
}

/**
 * Core compression engine interface
 */
export interface CompressionEngine {
  /**
   * Identify ranges of frames that could be compressed
   */
  identifyCompressibleRanges(
    frames: VEILFrame[],
    renderedFrames: RenderedFrame[]
  ): CompressibleRange[];
  
  /**
   * Compress a specific range of frames
   */
  compressRange(
    range: CompressibleRange,
    frames: VEILFrame[],
    renderedFrames: RenderedFrame[],
    currentFacets: Map<string, Facet>
  ): Promise<CompressionResult>;
  
  /**
   * Check if a frame should be replaced during rendering
   */
  shouldReplaceFrame(frameSequence: number): boolean;
  
  /**
   * Get the replacement content for a frame
   * Returns null if frame should render normally
   */
  getReplacement(frameSequence: number): string | null;
  
  /**
   * Optional: prepare compression in advance
   */
  prepareCompression?(
    frames: VEILFrame[],
    renderedFrames: RenderedFrame[]
  ): Promise<void>;
  
  /**
   * Optional: clear any cached data
   */
  clearCache?(): void;
}

/**
 * Configuration for compression
 */
export interface CompressionConfig {
  // Token budget management
  maxTokens?: number;
  chunkThreshold?: number;
  
  // Strategy-specific config
  engineConfig?: Record<string, any>;
}

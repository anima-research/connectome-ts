/**
 * Clean HUD interfaces that work with VEIL primitives
 * No ContentBlock abstraction
 */

import { Facet, Frame, OutgoingVEILOperation } from '../veil/types';
import { CompressionEngine, RenderedFrame } from '../compression/types-v2';

// Union type for frames
/**
 * Result of rendering VEIL state
 */
export interface RenderedContext {
  // Standard LLM message format
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    // Track which frames contributed to this message
    sourceFrames?: {
      from: number;
      to: number;
    };
  }>;
  
  // Metadata about rendering
  metadata: {
    totalTokens: number;
    renderedFrames: RenderedFrame[];
    droppedFrames?: number[];
    // Quick lookup for frame->message mapping
    frameToMessageIndex?: Map<number, number>;
  };
}

/**
 * Configuration for HUD rendering
 */
export interface HUDConfig {
  maxTokens?: number;  // Token budget for context window (e.g., 4000-8000) - currently only warns if exceeded
  includeTypes?: Array<'event' | 'state' | 'ambient'>;
  systemPrompt?: string;
  enableCaching?: boolean;
  cacheStrategy?: 'frame-boundary' | 'token-threshold' | 'none';
  metadata?: {
    pendingActivations?: {
      count: number;
      sources: string[];
    };
  };
  formatConfig?: {
    assistant?: {
      prefix?: string;
      suffix?: string;
    };
  };
}

/**
 * Clean HUD interface working directly with VEIL data
 */
export interface HUD {
  /**
   * Render VEIL state to LLM context
   * @param frames - The VEIL frame history
   * @param currentFacets - Current state of all facets
   * @param compression - Optional compression engine
   * @param config - Rendering configuration
   */
  render(
    frames: Frame[],
    currentFacets: Map<string, Facet>,
    compression?: CompressionEngine,
    config?: HUDConfig
  ): RenderedContext;
  
  /**
   * Parse LLM completion into VEIL operations
   */
  parseCompletion(completion: string): {
    operations: OutgoingVEILOperation[];
    hasMoreToSay: boolean;
  };
  
  /**
   * Get the format this HUD uses (xml, json, etc)
   */
  getFormat(): string;
}

/**
 * Extended interface for HUDs that support frame-aware compression
 */
export interface CompressibleHUD extends HUD {
  /**
   * Render with explicit frame tracking for compression
   * Returns both the context and frame-by-frame rendering
   */
  renderWithFrameTracking(
    frames: Frame[],
    currentFacets: Map<string, Facet>,
    compression?: CompressionEngine,
    config?: HUDConfig
  ): {
    context: RenderedContext;
    frameRenderings: RenderedFrame[];
  };
  
  /**
   * Check if compression is needed based on current state
   */
  needsCompression(
    frames: Frame[],
    config: HUDConfig
  ): boolean;
}

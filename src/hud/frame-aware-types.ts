import { ContentBlock } from '../compression/types';
import { Facet } from '../veil/types';

/**
 * A segment of rendered content that tracks its source
 */
export interface RenderSegment {
  content: string;
  sourceFrames: number[];     // VEIL frame sequences this represents
  blockIds: string[];         // Content block IDs included
  tokens?: number;            // Estimated token count
  type?: 'event' | 'state' | 'ambient' | 'memory' | 'meta';
}

/**
 * Request for frame-aware rendering
 */
export interface FrameAwareRenderRequest {
  maxTokens?: number;
  tokenBudget?: {
    events?: number;
    states?: number;
    ambient?: number;
    memories?: number;
  };
  focus?: string;
  includeSystemPrompt?: boolean;
}

/**
 * Result of frame-aware rendering
 */
export interface FrameAwareRenderResult {
  segments: RenderSegment[];
  totalTokens: number;
  metadata: {
    segmentCount: number;
    frameRange: { min: number; max: number };
    droppedSegments?: RenderSegment[];  // If token limit exceeded
  };
}

/**
 * Memory formation request sent after agent turn
 */
export interface MemoryFormationRequest {
  // The segments that were rendered
  segments: RenderSegment[];
  
  // The final concatenated context sent to LLM
  renderedContext: string;
  
  // The agent's response
  agentResponse: string;
  
  // Frame range to compress
  compressFrameRange: {
    from: number;
    to: number;
  };
  
  // Metadata
  metadata: {
    turnSequence: number;
    timestamp: string;
    focus?: string;
    totalTokens: number;
  };
}

/**
 * Result of memory formation
 */
export interface MemoryFormationResult {
  // The compressed memory block
  memory: ContentBlock;
  
  // Which frames this memory replaces
  replacesFrames: number[];
  
  // Token savings
  compressionRatio: number;
  tokensUsed: number;
}

/**
 * Interface for frame-aware HUD implementations
 */
export interface FrameAwareHUD {
  /**
   * Render blocks into segments that preserve frame tracking
   */
  renderSegments(
    blocks: ContentBlock[],
    request: FrameAwareRenderRequest
  ): FrameAwareRenderResult;
  
  /**
   * Concatenate segments into final context for LLM
   * This is separate to allow memory formation instructions to be inserted
   */
  concatenateSegments(
    segments: RenderSegment[],
    systemPrompt?: string,
    memoryFormationMarker?: { afterSegmentIndex: number }
  ): string;
  
  /**
   * Build memory formation request after agent turn
   */
  prepareMemoryFormation(
    renderResult: FrameAwareRenderResult,
    agentResponse: string,
    chunkThresholdTokens: number
  ): MemoryFormationRequest | null;
}

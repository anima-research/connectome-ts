import { MemoryBlock } from '../memory/types';
import { Facet } from '../veil/types';
import { OutgoingVEILOperation } from '../veil/types';

/**
 * HUD (Heads-Up Display) Types v2
 * 
 * The HUD is responsible for:
 * - Token budget management  
 * - Saliency-based content selection/pruning
 * - Assembling the final LLM context
 * - Rendering in the appropriate format (XML, JSON, etc.)
 */

/**
 * Configuration for HUD rendering
 */
export interface HUDConfig {
  systemPrompt?: string;
  userPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  prefillFormat?: boolean;
  tokenEstimator?: (content: string) => number;
  saliencyThreshold?: number; // Minimum saliency score to include
}

/**
 * Context provided to the HUD for rendering
 */
export interface HUDContext {
  currentFacets: Map<string, Facet>;
  memoryBlocks: MemoryBlock[];
  focus?: string;
}

/**
 * The final rendered context ready for LLM
 */
export interface RenderedContext {
  system: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  prefill?: string;
  metadata?: {
    tokenCount?: number;
    blocksRendered?: number;
    blocksSkipped?: number;
    pruningReasons?: string[];
    focus?: string;
  };
}

/**
 * Result of parsing an LLM completion
 */
export interface ParsedCompletion {
  content: string;
  operations: OutgoingVEILOperation[];
  hasMoreToSay?: boolean;
}

/**
 * Interface for HUD implementations
 */
export interface HUD {
  /**
   * Render context into final LLM messages
   * Handles token budget and saliency-based selection
   */
  render(
    context: HUDContext,
    config: HUDConfig
  ): RenderedContext;

  /**
   * Parse LLM completion to extract operations
   */
  parseCompletion(completion: string): ParsedCompletion;

  /**
   * Get the format identifier for this HUD
   */
  getFormat(): string;
}

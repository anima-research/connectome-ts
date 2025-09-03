import { ContentBlock } from '../compression/types';
import { OutgoingVEILOperation } from '../veil/types';

/**
 * Configuration for HUD rendering
 */
export interface HUDConfig {
  systemPrompt?: string;
  userPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  prefillFormat?: boolean;  // Use prefill format for assistant message
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
  prefill?: string;  // Optional prefill for assistant
  metadata?: {
    tokenCount?: number;
    blockCount?: number;
    focus?: string;
  };
}

/**
 * Tool call extracted from completion
 */
export interface ExtractedToolCall {
  name: string;
  parameters: Record<string, any>;
}

/**
 * Result of parsing an LLM completion
 */
export interface ParsedCompletion {
  content: string;  // The raw completion
  operations: OutgoingVEILOperation[];
  hasMoreToSay?: boolean;  // If the agent wants another turn
}

/**
 * Interface for HUD implementations
 */
export interface HUD {
  /**
   * Render content blocks into final LLM context
   */
  render(
    blocks: ContentBlock[],
    config: HUDConfig,
    focus?: string
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

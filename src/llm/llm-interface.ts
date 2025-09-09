/**
 * Abstract LLM interface for compression and other agent operations
 * Allows mocking for testing and swapping implementations
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'cache';
  content: string;
  metadata?: {
    cacheControl?: {
      type: 'ephemeral' | 'persistent';
      ttl?: number;
    };
    attachments?: Array<{
      type: 'image' | 'document';
      data: string; // base64 or URL
      mimeType?: string;
    }>;
    [key: string]: any;
  };
}

export interface LLMResponse {
  content: string;
  tokensUsed?: number;
  modelId?: string;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  modelId?: string;
  stopSequences?: string[];
  formatConfig?: {
    // Role-specific formatting for providers that need it
    assistant?: {
      prefix?: string;      // e.g., "<my_turn>\n"
      suffix?: string;      // e.g., "\n</my_turn>"
    };
    // Provider should add suffix as stop sequence if not already present
  };
}

/**
 * Core LLM interface
 * 
 * Providers should handle both message-based and prefill modes internally.
 * For prefill mode, providers convert the message sequence into appropriate format.
 * 
 * Cache markers (messages with role='cache') indicate boundaries for prompt caching.
 * Providers that don't support caching should ignore these messages.
 */
export interface LLMProvider {
  /**
   * Generate a response from the LLM
   * 
   * @param messages - Sequence of messages including potential cache markers
   * @param options - Generation options
   * @returns The LLM response
   */
  generate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse>;
  
  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number;
  
  /**
   * Get provider name for logging
   */
  getProviderName(): string;
  
  /**
   * Get provider capabilities
   */
  getCapabilities(): {
    supportsPrefill: boolean;
    supportsCaching: boolean;
    maxContextLength?: number;
  };
}

/**
 * Factory for creating LLM providers
 */
export class LLMProviderFactory {
  private static providers = new Map<string, () => LLMProvider>();
  
  static register(name: string, factory: () => LLMProvider) {
    this.providers.set(name, factory);
  }
  
  static create(name: string): LLMProvider {
    const factory = this.providers.get(name);
    if (!factory) {
      throw new Error(`Unknown LLM provider: ${name}`);
    }
    return factory();
  }
}

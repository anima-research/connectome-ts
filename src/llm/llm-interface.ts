/**
 * Abstract LLM interface for compression and other agent operations
 * Allows mocking for testing and swapping implementations
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
}

/**
 * Core LLM interface
 */
export interface LLMProvider {
  /**
   * Generate a response from the LLM
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

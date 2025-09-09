/**
 * Anthropic LLM Provider
 * 
 * Implements the LLMProvider interface for Anthropic's Claude models.
 * Supports both message-based and prefill modes.
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  LLMProvider, 
  LLMMessage, 
  LLMOptions, 
  LLMResponse 
} from './llm-interface';

export interface AnthropicProviderConfig {
  apiKey: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;
  private defaultMaxTokens: number;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey
    });
    this.defaultModel = config.defaultModel || 'claude-3-5-sonnet-20241022';
    this.defaultMaxTokens = config.defaultMaxTokens || 1000;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    // Filter out cache markers - they don't go to the API
    const apiMessages = messages.filter(m => m.role !== 'cache');
    
    // Build stop sequences, including format-based ones
    const stopSequences = [...(options?.stopSequences || [])];
    if (options?.formatConfig?.assistant?.suffix) {
      const suffix = options.formatConfig.assistant.suffix.trim();
      if (suffix && !stopSequences.includes(suffix)) {
        stopSequences.push(suffix);
      }
    }

    // Determine if we should use prefill mode
    const lastMessage = apiMessages[apiMessages.length - 1];
    const usesPrefill = lastMessage?.role === 'assistant' && lastMessage.content.length > 0;
    
    // Convert to Anthropic format
    const systemMessage = apiMessages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = apiMessages.filter(m => m.role !== 'system');
    
    // Build Anthropic messages
    const anthropicMessages: Anthropic.MessageParam[] = conversationMessages.map((msg, idx) => {
      // Handle cache control metadata
      const cacheControl = msg.metadata?.cacheControl;
      let content: Anthropic.MessageParam['content'];
      
      // For assistant messages, trim trailing whitespace (Anthropic requirement)
      const messageContent = msg.role === 'assistant' ? msg.content.trimEnd() : msg.content;
      
      if (cacheControl && this.getCapabilities().supportsCaching) {
        // For messages with cache control, wrap in appropriate format
        content = [{
          type: 'text',
          text: messageContent,
          cache_control: {
            type: cacheControl.type as 'ephemeral'
          }
        }];
      } else {
        content = messageContent;
      }
      
      return {
        role: msg.role as 'user' | 'assistant',
        content
      };
    });

    try {
      const response = await this.client.messages.create({
        model: options?.modelId || this.defaultModel,
        max_tokens: options?.maxTokens || this.defaultMaxTokens,
        temperature: options?.temperature ?? 1.0,
        stop_sequences: stopSequences.length > 0 ? stopSequences : undefined,
        system: systemMessage || undefined,
        messages: anthropicMessages
      });

      // Extract text content
      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as Anthropic.TextBlock).text)
        .join('');

      return {
        content,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        modelId: response.model
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Anthropic API error: ${error.message}`);
      }
      throw error;
    }
  }

  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for Claude
    // In production, you'd use a proper tokenizer
    return Math.ceil(text.length / 4);
  }

  getProviderName(): string {
    return 'anthropic';
  }

  getCapabilities(): {
    supportsPrefill: boolean;
    supportsCaching: boolean;
    maxContextLength?: number;
  } {
    return {
      supportsPrefill: true,
      supportsCaching: true,
      maxContextLength: 200000 // Claude 3 context window
    };
  }
}

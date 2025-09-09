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
import { getGlobalTracer, TraceCategory } from '../tracing';

export interface AnthropicProviderConfig {
  apiKey: string;
  defaultModel?: string;
  defaultMaxTokens?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;
  private defaultMaxTokens: number;
  private maxRetries: number;
  private retryDelay: number;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey
    });
    this.defaultModel = config.defaultModel || 'claude-3-5-sonnet-20241022';
    this.defaultMaxTokens = config.defaultMaxTokens || 1000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000; // 1 second
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

    // Prepare request for tracing
    const request = {
      model: options?.modelId || this.defaultModel,
      max_tokens: options?.maxTokens || this.defaultMaxTokens,
      temperature: options?.temperature ?? 1.0,
      stop_sequences: stopSequences.length > 0 ? stopSequences : undefined,
      system: systemMessage || undefined,
      messages: anthropicMessages
    };
    
    // Trace the request
    const tracer = getGlobalTracer();
    tracer?.record({
      id: `llm-request-${Date.now()}`,
      timestamp: Date.now(),
      level: 'info',
      category: TraceCategory.LLM_REQUEST,
      component: 'AnthropicProvider',
      operation: 'generate',
      data: {
        model: request.model,
        maxTokens: request.max_tokens,
        temperature: request.temperature,
        stopSequences: request.stop_sequences,
        systemPromptLength: systemMessage.length,
        messageCount: anthropicMessages.length,
        usesPrefill,
        // Full messages for debugging
        messages: messages.map(m => ({
          role: m.role,
          contentLength: m.content.length,
          contentPreview: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
          metadata: m.metadata
        }))
      }
    });

    // Retry logic
    let lastError: any;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create(request);

        // Extract text content
        const content = response.content
          .filter(block => block.type === 'text')
          .map(block => (block as Anthropic.TextBlock).text)
          .join('');
        
        // Trace the response
        tracer?.record({
          id: `llm-response-${Date.now()}`,
          timestamp: Date.now(),
          level: 'info',
          category: TraceCategory.LLM_RESPONSE,
          component: 'AnthropicProvider',
          operation: 'generate',
          data: {
            model: response.model,
            contentLength: content.length,
            contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            stopReason: response.stop_reason,
            stopSequence: response.stop_sequence,
            attempt: attempt > 0 ? attempt : undefined
          }
        });

        return {
          content,
          tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
          modelId: response.model
        };
      } catch (error) {
        lastError = error;
        
        // Determine if we should retry
        const shouldRetry = attempt < this.maxRetries && this.isRetryableError(error);
        
        // Trace the error
        tracer?.record({
          id: `llm-error-${Date.now()}`,
          timestamp: Date.now(),
          level: shouldRetry ? 'warn' : 'error',
          category: TraceCategory.LLM_ERROR,
          component: 'AnthropicProvider',
          operation: 'generate',
          data: {
            error: error instanceof Error ? error.message : String(error),
            errorType: error instanceof Anthropic.APIError ? 'APIError' : 'UnknownError',
            model: request.model,
            messageCount: anthropicMessages.length,
            attempt,
            willRetry: shouldRetry
          }
        });
        
        if (shouldRetry) {
          // Exponential backoff: 1s, 2s, 4s...
          const delay = this.retryDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Not retryable or max retries reached
        break;
      }
    }
    
    // Throw the last error
    if (lastError instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error: ${lastError.message}`);
    }
    throw lastError;
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
  
  private isRetryableError(error: any): boolean {
    if (error instanceof Anthropic.APIError) {
      // Retry on connection errors, rate limits, and server errors
      const retryableStatuses = [429, 500, 502, 503, 504];
      if (error.status && retryableStatuses.includes(error.status)) {
        return true;
      }
      
      // Retry on connection-related errors
      const message = error.message.toLowerCase();
      if (message.includes('connection') || 
          message.includes('timeout') || 
          message.includes('econnreset') ||
          message.includes('socket')) {
        return true;
      }
    }
    
    return false;
  }
}

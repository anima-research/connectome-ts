/**
 * Mock LLM provider for testing
 * Can be configured with deterministic responses
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './llm-interface';
import { getGlobalTracer, TraceCategory } from '../tracing';

export class MockLLMProvider implements LLMProvider {
  private responses: string[] = [];
  private responseIndex = 0;
  private compressionPattern = /Please compress the following content.*?<content_to_compress>(.*?)<\/content_to_compress>/s;
  private customResponses: Map<string, string> = new Map();
  
  constructor(responses?: string[]) {
    if (responses) {
      this.responses = responses;
    }
  }
  
  /**
   * Set a specific response sequence
   */
  setResponses(responses: string[]) {
    this.responses = responses;
    this.responseIndex = 0;
  }
  
  /**
   * Add a response - either sequential or pattern-based
   */
  addResponse(patternOrResponse: string, response?: string): void {
    if (response !== undefined) {
      // Pattern-based response
      this.customResponses.set(patternOrResponse, response);
    } else {
      // Sequential response
      this.responses.push(patternOrResponse);
    }
  }
  
  async generate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    // Filter out cache markers for processing
    const processableMessages = messages.filter(m => m.role !== 'cache');
    
    // Log full context for debugging
    if (process.env.DEBUG_LLM_CONTEXT === 'true') {
      console.log('\n[MockLLMProvider] Full message context:');
      messages.forEach((msg, i) => {
        console.log(`\n--- Message ${i + 1} (${msg.role}) ---`);
        console.log(msg.content.substring(0, 500) + (msg.content.length > 500 ? '...' : ''));
      });
      console.log('\n--- End of context ---\n');
    }
    
    // Trace the request
    const tracer = getGlobalTracer();
    tracer?.record({
      id: `mock-llm-request-${Date.now()}`,
      timestamp: Date.now(),
      level: 'debug',
      category: TraceCategory.LLM_REQUEST,
      component: 'MockLLMProvider',
      operation: 'generate',
      data: {
        messageCount: processableMessages.length,
        lastMessageRole: processableMessages[processableMessages.length - 1]?.role,
        lastMessagePreview: processableMessages[processableMessages.length - 1]?.content.substring(0, 100)
      }
    });
    
    // Check if this is a compression request
    const lastMessage = processableMessages[processableMessages.length - 1];
    if (lastMessage && this.compressionPattern.test(lastMessage.content)) {
      // Extract the content to compress
      const match = lastMessage.content.match(this.compressionPattern);
      if (match) {
        const contentToCompress = match[1].trim();
        
        // For numbered message test: count the events
        const eventMatches = contentToCompress.match(/<event_\d+>Event \d+:/g);
        if (eventMatches) {
          const count = eventMatches.length;
          // Extract all event numbers
          const eventNumbers = contentToCompress.match(/<event_(\d+)>/g)
            ?.map(m => parseInt(m.match(/\d+/)?.[0] || '0'))
            .sort((a, b) => a - b);
          
          if (eventNumbers && eventNumbers.length > 0) {
            const firstEvent = eventNumbers[0];
            const lastEvent = eventNumbers[eventNumbers.length - 1];
            
            return this.traceAndReturn({
              content: `[Compressed: Events ${firstEvent}-${lastEvent} (${count} total events)]`,
              tokensUsed: 20
            });
          }
        }
        
        // Default compression
        const lines = contentToCompress.split('\n').filter(l => l.trim());
        return this.traceAndReturn({
          content: `[Compressed: ${lines.length} lines of content]`,
          tokensUsed: 15
        });
      }
    }
    
    // Check for custom pattern-based responses
    // Look for patterns in all messages, not just the last one
    const allContent = processableMessages.map(m => m.content).join(' ').toLowerCase();
    
    for (const [pattern, response] of this.customResponses) {
      if (allContent.includes(pattern.toLowerCase())) {
        return this.traceAndReturn({
          content: response,
          tokensUsed: this.estimateTokens(response)
        });
      }
    }
    
    // Return next response in sequence or default
    if (this.responseIndex < this.responses.length) {
      const response = this.responses[this.responseIndex++];
      return this.traceAndReturn({
        content: response,
        tokensUsed: this.estimateTokens(response)
      });
    }
    
    // Default response
    return this.traceAndReturn({
      content: "Mock response",
      tokensUsed: 3
    });
  }
  
  private traceAndReturn(response: LLMResponse): LLMResponse {
    const tracer = getGlobalTracer();
    tracer?.record({
      id: `mock-llm-response-${Date.now()}`,
      timestamp: Date.now(),
      level: 'debug',
      category: TraceCategory.LLM_RESPONSE,
      component: 'MockLLMProvider',
      operation: 'generate',
      data: {
        contentLength: response.content.length,
        contentPreview: response.content,
        tokensUsed: response.tokensUsed
      }
    });
    return response;
  }
  
  estimateTokens(text: string): number {
    // Simple estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
  
  getProviderName(): string {
    return 'mock';
  }
  
  getCapabilities() {
    return {
      supportsPrefill: true,
      supportsCaching: false, // Mock doesn't actually cache
      maxContextLength: 100000
    };
  }
  
  /**
   * Reset the response index
   */
  reset() {
    this.responseIndex = 0;
  }
}

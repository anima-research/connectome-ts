/**
 * Mock LLM provider for testing
 * Can be configured with deterministic responses
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './llm-interface';

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
            
            return {
              content: `[Compressed: Events ${firstEvent}-${lastEvent} (${count} total events)]`,
              tokensUsed: 20
            };
          }
        }
        
        // Default compression
        const lines = contentToCompress.split('\n').filter(l => l.trim());
        return {
          content: `[Compressed: ${lines.length} lines of content]`,
          tokensUsed: 15
        };
      }
    }
    
    // Check for custom pattern-based responses
    if (lastMessage) {
      for (const [pattern, response] of this.customResponses) {
        if (lastMessage.content.includes(pattern)) {
          return {
            content: response,
            tokensUsed: this.estimateTokens(response)
          };
        }
      }
    }
    
    // Return next response in sequence or default
    if (this.responseIndex < this.responses.length) {
      const response = this.responses[this.responseIndex++];
      return {
        content: response,
        tokensUsed: this.estimateTokens(response)
      };
    }
    
    // Default response
    return {
      content: "Mock response",
      tokensUsed: 3
    };
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

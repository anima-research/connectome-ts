/**
 * Mock LLM provider for testing
 * Can be configured with deterministic responses
 */

import { LLMProvider, LLMMessage, LLMResponse, LLMOptions } from './llm-interface';

export class MockLLMProvider implements LLMProvider {
  private responses: string[] = [];
  private responseIndex = 0;
  private compressionPattern = /Please compress the following content.*?<content_to_compress>(.*?)<\/content_to_compress>/s;
  
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
   * Add a single response
   */
  addResponse(response: string) {
    this.responses.push(response);
  }
  
  async generate(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    // Check if this is a compression request
    const lastMessage = messages[messages.length - 1];
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
  
  /**
   * Reset the response index
   */
  reset() {
    this.responseIndex = 0;
  }
}

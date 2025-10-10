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
    // Look for patterns in the last user message
    const lastUserMsg = processableMessages.filter(m => m.role === 'user').pop();
    
    if (lastUserMsg) {
      const userContent = lastUserMsg.content.toLowerCase();
      
      for (const [pattern, response] of this.customResponses) {
        if (userContent.includes(pattern.toLowerCase())) {
          return this.traceAndReturn({
            content: response,
            tokensUsed: this.estimateTokens(response)
          });
        }
      }
    }
    
    // Smart mock: Check if asked about first message or memory
    if (lastUserMsg && 
        (lastUserMsg.content.toLowerCase().includes('first message') ||
         lastUserMsg.content.toLowerCase().includes('first thing') ||
         lastUserMsg.content.toLowerCase().includes('remember'))) {
      
      // Find Discord messages in the full context
      const fullContext = processableMessages.map(m => m.content).join('\n');
      
      // Discord messages appear as <discord-message>[Discord] author: content</discord-message>
      // or sometimes just as [Discord] author: content
      const patterns = [
        /<discord-message>\[Discord\] ([^:]+): (.+?)<\/discord-message>/g,
        /\[Discord\] ([^:]+): (.+?)(?=\n|\[|<|$)/g
      ];
      
      const discordMessages: Array<{author: string, content: string, inHistory: boolean}> = [];
      const seenMessages = new Set<string>();
      
      // Parse the context to find frame boundaries and restorations
      // Look for patterns that indicate this is a restored session
      const restorationPattern = /Welcome back!|I remember our conversation from before/;
      const isRestoredSession = restorationPattern.test(fullContext);
      
      // Check if message is from channel-history
      const historyPattern = /<channel-history>[\s\S]*?<\/channel-history-children>/s;
      const historyMatch = historyPattern.exec(fullContext);
      const historyContent = historyMatch ? historyMatch[0] : '';
      
      // If we're in a restored session and see channel-history, those messages are from VEIL
      const historyIsFromVEIL = isRestoredSession && historyContent.length > 0;
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(fullContext)) !== null) {
          const key = `${match[1]}:${match[2]}`;
          if (!seenMessages.has(key)) {
            seenMessages.add(key);
            const fullMatch = match[0];
            const inHistorySection = historyContent.includes(fullMatch);
            // Message is "new from Discord" only if it's in a history section that's NOT from VEIL
            const inHistory = inHistorySection && !historyIsFromVEIL;
            discordMessages.push({
              author: match[1].trim(),
              content: match[2].trim(),
              inHistory
            });
          }
        }
      }
      
      // Count messages from history vs already in VEIL
      const historyMessages = discordMessages.filter(m => m.inHistory);
      const veilMessages = discordMessages.filter(m => !m.inHistory);
      
      console.log(`[MockLLM] Found ${discordMessages.length} Discord messages in context`);
      console.log(`[MockLLM]   - Restored session: ${isRestoredSession}`);
      console.log(`[MockLLM]   - History section found: ${historyContent.length > 0}`);
      console.log(`[MockLLM]   - History is from VEIL: ${historyIsFromVEIL}`);
      console.log(`[MockLLM]   - ${historyMessages.length} from Discord history (new)` );
      console.log(`[MockLLM]   - ${veilMessages.length} already in VEIL frames`);
      
      if (discordMessages.length > 0) {
        // Filter to user messages only (not bot messages)
        const userMessages = discordMessages.filter(msg => 
          !msg.author.includes('Connectome') && 
          !msg.content.includes('role-playing')
        );
        
        const userHistoryMessages = userMessages.filter(m => m.inHistory);
        const userVeilMessages = userMessages.filter(m => !m.inHistory);
        
        console.log(`[MockLLM] Found ${userMessages.length} user messages:`);
        console.log(`[MockLLM]   - ${userHistoryMessages.length} from Discord history`);
        console.log(`[MockLLM]   - ${userVeilMessages.length} already in VEIL`);
        console.log(`[MockLLM] First few messages:`, userMessages.slice(0, 5).map(m => `${m.author}: ${m.content.substring(0, 50)}...`));
        
        if (userMessages.length > 0) {
          const firstMsg = userMessages[0];
          const historyInfo = firstMsg.inHistory ? " (from Discord history)" : " (already in VEIL)";
          return this.traceAndReturn({
            content: `Looking at our conversation history, the first message I received from you was: "${firstMsg.content}"${historyInfo} - I can see all ${userMessages.length} messages we've exchanged (${userHistoryMessages.length} from Discord history, ${userVeilMessages.length} already in VEIL), demonstrating that I have full memory of our past interactions even after restarting!`,
            tokensUsed: 100
          });
        }
      }
    }
    
    // Return next response in sequence or default
    if (this.responseIndex < this.responses.length) {
      const response = this.responses[this.responseIndex++] + ` ${Math.floor(1000 + Math.random() * 9000)}`;
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

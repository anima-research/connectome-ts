/**
 * Test cache markers in the LLM API
 */

import { LLMMessage } from '../src/llm/llm-interface';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';

async function testCacheMarkers() {
  console.log('=== Testing Cache Markers ===\n');
  
  const provider = new MockLLMProvider();
  
  // Example message sequence with cache markers
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant.',
      metadata: {
        cacheControl: {
          type: 'persistent',
          ttl: 3600
        }
      }
    },
    {
      role: 'cache',
      content: '--- System instructions cached above ---'
    },
    {
      role: 'user',
      content: 'Tell me about cache optimization.'
    },
    {
      role: 'assistant',
      content: 'Cache optimization is important for performance...'
    },
    {
      role: 'cache',
      content: '--- Conversation history cached above ---'
    },
    {
      role: 'user',
      content: 'How does it work in practice?'
    }
  ];
  
  // Show capabilities
  const capabilities = provider.getCapabilities();
  console.log('Provider capabilities:', capabilities);
  
  // Generate response
  const response = await provider.generate(messages, {
    maxTokens: 100,
    temperature: 0.7
  });
  
  console.log('\nResponse:', response.content);
  console.log('Tokens used:', response.tokensUsed);
  
  // Show how messages would be processed
  console.log('\n--- Message Processing ---');
  console.log(`Total messages: ${messages.length}`);
  console.log(`Cache markers: ${messages.filter(m => m.role === 'cache').length}`);
  console.log(`Processable messages: ${messages.filter(m => m.role !== 'cache').length}`);
  
  // Demonstrate how HUD output would be used for prefill
  console.log('\n--- Prefill Mode Example ---');
  
  // In practice, the HUD renders the full context with proper formatting
  const hudRenderedContent = `<message>Hello agent!</message>

<!-- CACHE BOUNDARY: History cached -->

<message>What's 2+2?</message>

<my_turn>
The answer is 4.`;
  
  // Provider would receive this as:
  const prefillMessages: LLMMessage[] = [
    { role: 'system', content: 'You are in a CLI simulation...' },
    { role: 'user', content: '<cmd>cat log.txt</cmd>' },
    { role: 'assistant', content: hudRenderedContent }
  ];
  
  console.log('HUD-rendered content length:', hudRenderedContent.length, 'chars');
  console.log('Would continue from: "The answer is 4."');
}

testCacheMarkers().catch(console.error);

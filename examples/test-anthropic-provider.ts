/**
 * Test Anthropic LLM Provider
 * 
 * Demonstrates using the Anthropic provider with various modes and configurations.
 * Note: Requires ANTHROPIC_API_KEY environment variable to run real tests.
 */

import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { LLMMessage } from '../src/llm/llm-interface';

async function testAnthropicProvider() {
  console.log('=== Testing Anthropic Provider ===\n');
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('⚠️  ANTHROPIC_API_KEY not set. Showing example usage only.\n');
    showExampleUsage();
    return;
  }

  const provider = new AnthropicProvider({
    apiKey,
    defaultModel: 'claude-3-opus-20240229'
  });

  console.log('Provider:', provider.getProviderName());
  console.log('Capabilities:', provider.getCapabilities());
  
  // Test 1: Simple message mode
  console.log('\n1. Simple Message Mode:');
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are a helpful assistant. Be concise.' },
      { role: 'user', content: 'What is 2+2?' }
    ];
    
    const response = await provider.generate(messages, {
      maxTokens: 50,
      temperature: 0
    });
    
    console.log('Response:', response.content);
    console.log('Tokens used:', response.tokensUsed);
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 2: With format configuration
  console.log('\n2. With Format Configuration:');
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are a helpful assistant. Use the XML format provided.' },
      { role: 'user', content: 'Hello!' }
    ];
    
    const response = await provider.generate(messages, {
      maxTokens: 100,
      formatConfig: {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      }
    });
    
    console.log('Response:', response.content);
    // Note: Response should stop at </my_turn>
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 3: Prefill mode
  console.log('\n3. Prefill Mode:');
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Continue the assistant response.' },
      { role: 'user', content: 'List three colors.' },
      { 
        role: 'assistant', 
        content: '<my_turn>\nHere are three colors:\n1. Red\n2. '  // Prefill
      }
    ];
    
    const response = await provider.generate(messages, {
      maxTokens: 100,
      formatConfig: {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      }
    });
    
    console.log('Continuation:', response.content);
  } catch (error) {
    console.error('Error:', error);
  }

  // Test 4: With cache markers (ignored by provider)
  console.log('\n4. With Cache Markers:');
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'cache', content: '--- Cache boundary ---' },  // Filtered out
      { role: 'user', content: 'What is the capital of France?' }
    ];
    
    const response = await provider.generate(messages, {
      maxTokens: 50
    });
    
    console.log('Response:', response.content);
  } catch (error) {
    console.error('Error:', error);
  }
}

function showExampleUsage() {
  console.log('Example usage:\n');
  console.log(`import { AnthropicProvider } from './anthropic-provider';

const provider = new AnthropicProvider({
  apiKey: 'your-api-key',
  defaultModel: 'claude-3-opus-20240229'
});

// Message mode
const response = await provider.generate([
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: 'Hello!' }
], {
  maxTokens: 100,
  temperature: 0.7,
  formatConfig: {
    assistant: {
      prefix: '<my_turn>\\n',
      suffix: '\\n</my_turn>'
    }
  }
});

// Prefill mode (assistant message with content)
const continuation = await provider.generate([
  { role: 'user', content: 'Write a haiku.' },
  { role: 'assistant', content: 'Here is a haiku:\\n\\nCherry blossoms fall\\n' }
], {
  maxTokens: 50
});`);
}

// Run the test
testAnthropicProvider().catch(console.error);

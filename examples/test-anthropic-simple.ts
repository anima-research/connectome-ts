/**
 * Simple test of Anthropic provider
 * 
 * Direct test without the complexity of the full agent system
 */

import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { LLMProvider, LLMMessage } from '../src/llm/llm-interface';

// Create provider based on environment
function createProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (apiKey) {
    console.log('✅ Using Anthropic provider with API key');
    return new AnthropicProvider({
      apiKey,
      defaultModel: 'claude-3-5-sonnet-20241022'
    });
  } else {
    console.log('⚠️  No ANTHROPIC_API_KEY found, using mock provider');
    return new MockLLMProvider();
  }
}

async function testAnthropicSimple() {
  console.log('=== Simple Anthropic Provider Test ===\n');
  
  const provider = createProvider();
  
  // Show capabilities
  console.log('Provider:', provider.getProviderName());
  const capabilities = provider.getCapabilities();
  console.log('Capabilities:');
  console.log(`  - Supports prefill: ${capabilities.supportsPrefill}`);
  console.log(`  - Supports caching: ${capabilities.supportsCaching}`);
  console.log(`  - Max context: ${capabilities.maxContextLength || 'N/A'} tokens`);
  
  // Test 1: Basic message
  console.log('\n1. Basic Message Test:');
  console.log('   Sending: "What is 2+2?"');
  
  const messages1: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful math tutor. Be concise.' },
    { role: 'user', content: 'What is 2+2?' }
  ];
  
  try {
    const response1 = await provider.generate(messages1, {
      maxTokens: 50,
      temperature: 0
    });
    console.log('   Response:', response1.content);
    if (response1.tokensUsed) {
      console.log('   Tokens used:', response1.tokensUsed);
    }
  } catch (error) {
    console.error('   Error:', error);
  }
  
  // Test 2: XML format with stop sequences
  console.log('\n2. XML Format Test:');
  console.log('   Testing format configuration and stop sequences');
  
  const messages2: LLMMessage[] = [
    { role: 'system', content: 'You are an assistant. Use XML tags as directed.' },
    { role: 'user', content: 'Say hello in a friendly way.' }
  ];
  
  try {
    const response2 = await provider.generate(messages2, {
      maxTokens: 100,
      temperature: 0.7,
      formatConfig: {
        assistant: {
          prefix: '<my_turn>\n',
          suffix: '\n</my_turn>'
        }
      },
      stopSequences: ['</my_turn>']
    });
      console.log('   Response:', response2.content);
      console.log('   Note: Provider adds </my_turn> as stop sequence, preventing over-generation');
      console.log('   (The HUD would wrap this in <my_turn> tags when rendering)');
  } catch (error) {
    console.error('   Error:', error);
  }
  
  // Test 3: Prefill mode (if supported)
  if (capabilities.supportsPrefill) {
    console.log('\n3. Prefill Mode Test:');
    console.log('   Starting with: "Here are three colors:\\n1. Red\\n2. Blue\\n3."');
    console.log('   Note: Anthropic requires no trailing whitespace in assistant messages');
    
    const messages3: LLMMessage[] = [
      { role: 'system', content: 'Continue the list.' },
      { role: 'user', content: 'List three primary colors.' },
      { 
        role: 'assistant', 
        content: 'Here are three colors:\n1. Red\n2. Blue\n3.'  // Prefill (no trailing space)
      }
    ];
    
    try {
      const response3 = await provider.generate(messages3, {
        maxTokens: 50,
        temperature: 0
      });
      console.log('   Continuation:', response3.content);
      console.log('   (Should continue from "3." in prefill mode)');
    } catch (error) {
      console.error('   Error:', error);
    }
  } else {
    console.log('\n3. Prefill Mode Test: Skipped (not supported)');
  }
  
  // Test 4: Token estimation
  console.log('\n4. Token Estimation Test:');
  const testText = 'This is a test sentence to estimate token count. It contains multiple words and should give us a rough idea of tokenization.';
  const estimatedTokens = provider.estimateTokens(testText);
  console.log(`   Text length: ${testText.length} characters`);
  console.log(`   Estimated tokens: ${estimatedTokens}`);
  console.log(`   Ratio: ~${(testText.length / estimatedTokens).toFixed(1)} chars/token`);
  
  console.log('\n=== Test Complete ===');
  
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nTo test with real Anthropic API:');
    console.log('  export ANTHROPIC_API_KEY="your-api-key"');
    console.log('  npm run test:anthropic-simple');
  }
}

// Run the test
testAnthropicSimple().catch(console.error);

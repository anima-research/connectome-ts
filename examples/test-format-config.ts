/**
 * Test format configuration and stop sequences
 */

import { LLMMessage, LLMOptions } from '../src/llm/llm-interface';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';

class FormatAwareMockProvider extends MockLLMProvider {
  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<any> {
    console.log('\n--- Provider Received ---');
    console.log('Format config:', options?.formatConfig);
    console.log('Stop sequences:', options?.stopSequences);
    
    // Check if format config aligns with stop sequences
    const assistantSuffix = options?.formatConfig?.assistant?.suffix;
    if (assistantSuffix && !options?.stopSequences?.includes(assistantSuffix.trim())) {
      console.warn('⚠️  Warning: Assistant suffix not in stop sequences!');
    }
    
    // In a real provider, this would be used to:
    // 1. Add suffix to stop sequences if not present
    // 2. Extract prefill content properly
    // 3. Format messages for the specific API
    
    return super.generate(messages, options);
  }
}

async function testFormatConfig() {
  console.log('=== Testing Format Configuration ===');
  
  const provider = new FormatAwareMockProvider();
  
  // Example 1: XML HUD format
  console.log('\n1. XML HUD Format:');
  
  const xmlMessages: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
    { 
      role: 'assistant', 
      content: '<my_turn>\nHi there! How can I help you today?' 
    }
  ];
  
  await provider.generate(xmlMessages, {
    maxTokens: 100,
    stopSequences: ['</my_turn>'],
    formatConfig: {
      assistant: {
        prefix: '<my_turn>\n',
        suffix: '\n</my_turn>'
      }
    }
  });
  
  // Example 2: Missing stop sequence
  console.log('\n2. Missing Stop Sequence (Bad Config):');
  
  await provider.generate(xmlMessages, {
    maxTokens: 100,
    stopSequences: ['</turn>'], // Wrong!
    formatConfig: {
      assistant: {
        prefix: '<my_turn>\n',
        suffix: '\n</my_turn>'
      }
    }
  });
  
  // Example 3: JSON format
  console.log('\n3. JSON Format:');
  
  const jsonMessages: LLMMessage[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' },
    { 
      role: 'assistant', 
      content: '{"role": "assistant", "content": "Hi there!"' 
    }
  ];
  
  await provider.generate(jsonMessages, {
    maxTokens: 100,
    stopSequences: ['"}'],
    formatConfig: {
      assistant: {
        prefix: '{"role": "assistant", "content": "',
        suffix: '"}'
      }
    }
  });
  
  console.log('\n--- Key Points ---');
  console.log('1. Format config tells provider about the HUD\'s formatting');
  console.log('2. Provider uses this to set appropriate stop sequences');
  console.log('3. For prefill mode, provider knows where assistant content starts/ends');
  console.log('4. Different HUDs can use different formats (XML, JSON, plain text)');
}

testFormatConfig().catch(console.error);

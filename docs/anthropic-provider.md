# Anthropic LLM Provider

The Anthropic provider implements the `LLMProvider` interface for Claude models.

## Features

- **Message and Prefill Modes**: Automatically handles both standard message-based API calls and prefill mode
- **Format Configuration**: Supports custom formatting with automatic stop sequence management
- **Cache Control**: Supports Anthropic's cache control features (when available)
- **Token Estimation**: Provides rough token count estimation

## Usage

### Basic Setup

```typescript
import { AnthropicProvider } from './llm/anthropic-provider';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: 'claude-3-5-sonnet-20241022',  // optional
  defaultMaxTokens: 1000                          // optional
});
```

### Simple Message Generation

```typescript
const response = await provider.generate([
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'What is the capital of France?' }
], {
  maxTokens: 100,
  temperature: 0.7
});

console.log(response.content);  // "The capital of France is Paris."
```

### With Format Configuration

The provider automatically adds format-based stop sequences:

```typescript
const response = await provider.generate(messages, {
  maxTokens: 200,
  formatConfig: {
    assistant: {
      prefix: '<my_turn>\n',
      suffix: '\n</my_turn>'
    }
  }
  // Provider will automatically add '</my_turn>' to stop sequences
});
```

### Prefill Mode

For continuing partial responses:

```typescript
const response = await provider.generate([
  { role: 'user', content: 'List three colors.' },
  { 
    role: 'assistant', 
    content: 'Here are three colors:\n1. Red\n2. '  // Partial response
  }
], {
  maxTokens: 50
});
// Response will continue from "2. "
```

### Cache Control (Beta)

When using models that support caching:

```typescript
const messages: LLMMessage[] = [
  { 
    role: 'system', 
    content: 'Long system prompt...',
    metadata: {
      cacheControl: {
        type: 'ephemeral'
      }
    }
  },
  { role: 'user', content: 'Question?' }
];
```

## Integration with Agent System

The provider integrates seamlessly with the agent system:

```typescript
const agent = new BasicAgent(
  {
    systemPrompt: 'You are a helpful assistant.',
    defaultMaxTokens: 1000
  },
  new AnthropicProvider({ apiKey: 'your-key' }),
  veilStateManager
);
```

## Error Handling

The provider wraps Anthropic API errors with descriptive messages:

```typescript
try {
  const response = await provider.generate(messages);
} catch (error) {
  // Error will include details like rate limits, invalid API key, etc.
  console.error('LLM Error:', error.message);
}
```

## Available Models

- `claude-3-5-sonnet-20241022` (default, recommended)
- `claude-3-5-haiku-20241022`
- `claude-3-opus-20240229` (deprecated, EOL Jan 2026)
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`
- `claude-2.1`
- `claude-2.0`

## Environment Setup

Set your API key:

```bash
export ANTHROPIC_API_KEY="your-api-key"
```

Or pass it directly:

```typescript
const provider = new AnthropicProvider({
  apiKey: 'your-api-key'
});
```

## Testing

Use the mock provider for testing without API calls:

```typescript
const provider = process.env.ANTHROPIC_API_KEY 
  ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
  : new MockLLMProvider();
```

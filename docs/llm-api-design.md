# LLM API Design

## Overview

The LLM API is designed to be flexible enough to support different LLM providers while keeping the interface simple. Key principles:

1. **Message-based interface** - All communication uses a sequence of messages
2. **Provider handles complexity** - Conversion to prefill, API-specific formats, etc.
3. **Cache markers for optimization** - Special messages indicate cache boundaries
4. **Metadata for rich content** - Support for images, documents, cache control

## Message Types

### Standard Roles
- `system` - System instructions
- `user` - User/environment inputs  
- `assistant` - Agent responses

### Special Roles
- `cache` - Cache boundary markers (not sent to LLM)

## Cache Markers

Cache markers are messages with role='cache' that indicate boundaries for prompt caching optimization. These are particularly useful for:

1. **Persistent system prompts** - Mark after system instructions
2. **Conversation history** - Mark after historical context  
3. **Compressed content** - Mark after compressed frames

Example:
```typescript
[
  { role: 'system', content: 'You are an AI assistant...' },
  { role: 'cache', content: 'System prompt cached above' },
  { role: 'user', content: 'Hello!' },
  { role: 'assistant', content: 'Hi there!' },
  { role: 'cache', content: 'History cached above' },
  { role: 'user', content: 'New question...' }
]
```

## Prefill Mode

Some LLM providers (like Anthropic) support "prefill mode" where you provide a partial assistant response and the model continues from there. This treats the instruct model more like a base model.

The conversion from messages to prefill format is handled internally by each provider.

For prefill mode, responsibilities are split:

### HUD Responsibilities:
- Renders the context in its specific format (e.g., XML with `<my_turn>` tags)
- Formats user messages (no wrapping)
- Formats assistant messages with appropriate tags
- Inserts cache boundaries

### Provider Responsibilities:
- Receives format configuration (prefix/suffix for roles)
- Adds appropriate stop sequences (e.g., `</my_turn>`)
- For prefill mode: extracts assistant content as prefill
- For message mode: converts to API format

### Example Configuration:
```typescript
{
  formatConfig: {
    assistant: {
      prefix: '<my_turn>\n',
      suffix: '\n</my_turn>'
    }
  },
  stopSequences: ['</my_turn>']  // Provider adds this based on format
}
```

The provider needs to know the formatting rules to:
1. Set correct stop sequences
2. Properly handle prefill extraction
3. Understand where assistant responses begin/end

This shared understanding ensures the model stops at the right place and the output can be properly parsed.

## Provider Capabilities

Providers expose their capabilities through the `getCapabilities()` method:

```typescript
{
  supportsPrefill: boolean;    // Can use prefill mode
  supportsCaching: boolean;    // Supports prompt caching
  maxContextLength?: number;   // Max tokens supported
}
```

## Implementation Notes

1. **Cache boundaries** should align with natural content divisions
2. **Prefill conversion** is provider-specific and internal
3. **Metadata** allows future extensions without API changes
4. **Agent controls caching** since it understands the content structure
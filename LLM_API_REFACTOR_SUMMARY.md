# LLM API Refactoring Summary

## What Changed

### 1. Simplified API
- Removed separate prefill/message request types
- Single `generate()` method takes messages and returns response
- Providers handle conversion internally

### 2. Cache Marker Support
- Added `'cache'` as a message role
- Cache markers indicate boundaries for prompt caching
- Providers that don't support caching simply filter them out

### 3. Rich Metadata
- Messages can now include metadata:
  - `cacheControl` - Persistence and TTL settings
  - `attachments` - Images and documents
  - Extensible for future needs

### 4. Provider Capabilities
- New `getCapabilities()` method exposes:
  - `supportsPrefill` - Whether provider can use prefill mode
  - `supportsCaching` - Whether provider supports prompt caching
  - `maxContextLength` - Token limits

## Benefits

1. **Cleaner Agent Code** - Agent doesn't need to know about prefill vs message modes
2. **Cache Optimization** - Agent/HUD can insert cache markers for better performance
3. **Future-Proof** - Metadata allows extensions without API changes
4. **Provider Flexibility** - Each provider implements its own optimization strategies

## Example Usage

```typescript
const messages: LLMMessage[] = [
  { 
    role: 'system', 
    content: 'You are helpful',
    metadata: { cacheControl: { type: 'persistent' } }
  },
  { role: 'cache', content: 'System cached above' },
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi! How can I help?' }
];

const response = await provider.generate(messages, { maxTokens: 1000 });
```

## Next Steps

When implementing real LLM providers:
1. OpenAI provider - Convert to messages API format
2. Anthropic provider - Convert to prefill format with cache headers
3. HUD integration - Insert cache markers at frame boundaries
4. Agent optimization - Track cache consistency for better performance

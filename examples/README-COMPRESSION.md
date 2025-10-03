# Compression Examples

This directory contains examples demonstrating compression with the RETM architecture.

## Running the Examples

### Full Compression Demo
```bash
npm run example:compression
```

This comprehensive demo shows:
- Setting up compression transforms with priority
- Creating agents without compression parameters
- Generating messages to trigger compression
- Observing compression facets in VEIL state
- Complete architecture flow explanation

### Output

The demo provides detailed output showing:

```
📦 Setting up infrastructure
🗜️  Creating compression engine
🔄 Registering transforms with priority ordering
🤖 Creating agent (no compression parameter!)
💬 Generating test conversation
📊 Checking compression status
🎯 Activating agent
📄 Checking rendered context
🏗️  Architecture flow summary
```

## Example Structure

### 1. Infrastructure Setup
```typescript
const veilState = new VEILStateManager();
const space = new Space(veilState);
const compressionEngine = new SimpleTestCompressionEngine();
```

### 2. Transform Registration (Priority Ordering)
```typescript
// Priority ensures correct execution order
const compressionTransform = new CompressionTransform({
  engine: compressionEngine,
  triggerThreshold: 300,
  minFramesBeforeCompression: 5
});
// compressionTransform.priority = 10 (set in class)

space.addTransform(compressionTransform);

const contextTransform = new ContextTransform(
  veilState,
  compressionEngine,
  { maxTokens: 1000 }
);
// contextTransform.priority = 100 (set in class)

space.addTransform(contextTransform);

// Execution order: compression → context (guaranteed by priority)
```

### 3. Agent Creation (No Compression!)
```typescript
// Agent doesn't need compression parameter
const agent = new BasicAgent(
  {
    name: 'DemoAgent',
    systemPrompt: 'You are a helpful assistant.',
    contextTokenBudget: 1000
  },
  llmProvider,
  veilState
);

// Connect agent via effector
const agentEffector = new AgentEffector(agentElement, agent);
space.addEffector(agentEffector);
```

### 4. Frame Processing Flow
```
User sends message
  ↓
Phase 1: Receptors convert to facets
  ↓
Phase 2: Transforms run (in priority order)
  ├─ CompressionTransform (priority=10)
  │  └─ Identifies compressible ranges
  │  └─ Compresses old frames
  │  └─ Creates compression-result facets
  └─ ContextTransform (priority=100)
     └─ Renders context for activations
     └─ Uses compressed frames from engine cache
     └─ Creates rendered-context facets
  ↓
Phase 3: Effectors process facet changes
  └─ AgentEffector
     └─ Sees activation + rendered-context pair
     └─ Runs agent with context
     └─ Emits agent response facets
```

## Compression Facets

### compression-plan
Shows compression tasks in progress:
```typescript
{
  type: 'compression-plan',
  state: {
    engine: 'simple-test',
    ranges: [
      {
        from: 1,
        to: 5,
        totalTokens: 450,
        status: 'in-progress',
        reason: 'Exceeded token threshold'
      }
    ]
  },
  ephemeral: true
}
```

### compression-result
Shows completed compressions:
```typescript
{
  type: 'compression-result',
  state: {
    engine: 'simple-test',
    range: { from: 1, to: 5, totalTokens: 450 },
    summary: '[Compressed 5 frames...]',
    stateDelta: { /* state changes */ }
  },
  ephemeral: true
}
```

### rendered-context
Shows context prepared for agents:
```typescript
{
  type: 'rendered-context',
  state: {
    activationId: 'activation-123',
    tokenCount: 850,
    context: { /* Full RenderedContext object */ }
  },
  ephemeral: true
}
```

## Customization

### Use Different Compression Engine
```typescript
// Instead of SimpleTestCompressionEngine:
import { AttentionAwareCompressionEngine } from 'connectome-ts';

const engine = new AttentionAwareCompressionEngine();
// Requires LLM provider for compression
```

### Adjust Compression Thresholds
```typescript
const compressionTransform = new CompressionTransform({
  engine: compressionEngine,
  triggerThreshold: 1000,       // Higher = compress less often
  minFramesBeforeCompression: 20, // Higher = wait longer before compressing
  maxConcurrent: 2              // More = faster but more LLM calls
});
```

### Add Custom Transforms
```typescript
// Your custom transform
class MyTransform extends BaseTransform {
  priority = 50;  // Runs between compression and context
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    // Your transform logic
    return [];
  }
}

space.addTransform(new MyTransform());
```

## Learning Path

1. **Run the demo** - See the full flow in action
2. **Read the output** - Understand what happens at each phase
3. **Check VEIL state** - Inspect compression facets
4. **Modify thresholds** - See how compression behavior changes
5. **Add logging** - Track transform execution
6. **Build your own** - Create custom compression strategies

## Troubleshooting

### Compression Not Triggering?
- Check `triggerThreshold` - might be too high
- Check `minFramesBeforeCompression` - need enough frames
- Check frame token counts - might not exceed threshold

### Context Not Using Compression?
- Verify transforms registered in correct order
- Check engine cache is populated (compression ran first)
- Verify same engine instance passed to both transforms

### Agent Not Responding?
- Check agent activation facet created
- Check rendered-context facet exists
- Verify AgentEffector registered
- Check LLM provider is working

## Additional Resources

- [Compression RETM Guide](../docs/compression-retm-guide.md)
- [Transform Ordering](../docs/transform-ordering.md)
- [RETM Architecture](../docs/retm-architecture.md)


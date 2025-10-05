# Compression in RETM Architecture

This guide shows how to use the compression system with the new RETM (Receptor/Effector/Transform/Maintainer) architecture.

## Overview

Compression in Connectome is now handled by **Transforms** that run during Phase 2 of frame processing. This decouples compression from agents and makes it a shared infrastructure concern.

### The Flow

```
Frame Processing:
Phase 1: Events → VEIL (Receptors)
Phase 2: VEIL → VEIL (Transforms)
  ├── CompressionTransform: Compresses old frames, updates engine cache
  └── ContextTransform: Renders context for agents (using compressed frames)
Phase 3: VEIL Changes → Side Effects (Effectors)
  └── AgentEffector: Runs agent with pre-rendered context
```

## Setup

### 1. Create Compression Engine

```typescript
import { 
  AttentionAwareCompressionEngine,
  SimpleTestCompressionEngine 
} from 'connectome-ts';

// Use attention-aware engine (recommended)
const compressionEngine = new AttentionAwareCompressionEngine();

// Or use simple test engine
// const compressionEngine = new SimpleTestCompressionEngine();
```

### 2. Register Transforms with Space

```typescript
import { 
  CompressionTransform,
  ContextTransform,
  Space,
  VEILStateManager
} from 'connectome-ts';

const veilState = new VEILStateManager();
const space = new Space(veilState);

// Add CompressionTransform (priority=10, runs first in Phase 2)
const compressionTransform = new CompressionTransform({
  engine: compressionEngine,
  engineName: 'attention-aware',
  triggerThreshold: 500,        // Start compression when total tokens > 500
  minFramesBeforeCompression: 10, // Wait for at least 10 frames
  maxPendingRanges: 5,           // Max compression tasks at once
  maxConcurrent: 1,              // Max concurrent LLM requests
  retryLimit: 2                  // Retry failed compressions
});

space.addTransform(compressionTransform);

// Add ContextTransform (priority=100, runs after compression)
const contextTransform = new ContextTransform(
  veilState,
  compressionEngine,  // Same engine instance!
  {
    maxTokens: 4000,   // Default context window
    // Other HUD config options
  }
);

space.addTransform(contextTransform);

// Note: Transforms with priority run before those without
// CompressionTransform (10) → ContextTransform (100) → unprioritized transforms
```

### 3. Create Agent (No Compression Needed!)

```typescript
import { BasicAgent, AgentEffector } from 'connectome-ts';

// Agent doesn't need to know about compression
const agent = new BasicAgent(
  {
    name: 'Assistant',
    systemPrompt: 'You are a helpful AI assistant.',
    contextTokenBudget: 4000
  },
  llmProvider,
  veilState
);

// Use AgentEffector to connect agent to RETM architecture
const agentEffector = new AgentEffector(agentElement, agent);
space.addEffector(agentEffector);
```

## How It Works

### CompressionTransform

1. **Monitors** frame history for compressible ranges
2. **Identifies** ranges that exceed token threshold
3. **Compresses** ranges asynchronously using the engine
4. **Creates** compression-plan and compression-result facets
5. **Populates** engine cache with replacements

### ContextTransform

1. **Watches** for agent-activation facets
2. **Renders** context using FrameTrackingHUD
3. **Uses** compression engine cache for frame replacements
4. **Creates** rendered-context facets with full context

### AgentEffector

1. **Watches** for agent-activation + rendered-context facet pairs
2. **Runs** agent with pre-rendered context
3. **Emits** agent response facets back to VEIL

## Configuration Options

### CompressionTransform Options

```typescript
interface CompressionTransformOptions {
  engine: CompressionEngine;           // The compression engine to use
  engineName?: string;                 // Name for logging/facets
  hud?: FrameTrackingHUD;             // Custom HUD instance
  compressionConfig?: CompressionConfig; // Engine-specific config
  triggerThreshold?: number;           // Token threshold (default: 500)
  minFramesBeforeCompression?: number; // Min frames to wait (default: 10)
  maxPendingRanges?: number;          // Max queued tasks (default: 5)
  maxConcurrent?: number;             // Max parallel requests (default: 1)
  retryLimit?: number;                // Retry attempts (default: 2)
  retryDelayMs?: number;              // Retry delay (default: 200ms)
}
```

### Compression Engines

**AttentionAwareCompressionEngine**
- Uses LLM to identify important content
- Preserves high-attention frames
- Best for production use

**SimpleTestCompressionEngine**
- Simple token-based compression
- No LLM calls for compression
- Good for testing

## Complete Example

```typescript
import {
  Space,
  VEILStateManager,
  BasicAgent,
  AgentEffector,
  CompressionTransform,
  ContextTransform,
  AttentionAwareCompressionEngine,
  Element
} from 'connectome-ts';

// Setup
const veilState = new VEILStateManager();
const space = new Space(veilState);

// Compression engine (shared instance)
const compressionEngine = new AttentionAwareCompressionEngine();

// Phase 2 Transforms
space.addTransform(new CompressionTransform({
  engine: compressionEngine,
  triggerThreshold: 500
}));

space.addTransform(new ContextTransform(
  veilState,
  compressionEngine,
  { maxTokens: 4000 }
));

// Agent (Phase 3)
const agentElement = new Element('agent-1', 'agent');
space.mountElement(agentElement);

const agent = new BasicAgent(
  {
    name: 'Assistant',
    systemPrompt: 'You are a helpful assistant.',
    contextTokenBudget: 4000
  },
  llmProvider,
  veilState
);

const agentEffector = new AgentEffector(agentElement, agent);
space.addEffector(agentEffector);

// Now when agent-activation facets are created,
// the system will automatically:
// 1. Compress old frames (CompressionTransform)
// 2. Render context with compression (ContextTransform)
// 3. Run agent with rendered context (AgentEffector)
```

## Migration from Old Architecture

### Before (Direct Compression)

```typescript
// Old way - agent manages compression
const agent = new BasicAgent(
  config,
  provider,
  veilState,
  compressionEngine  // ❌ No longer supported
);
```

### After (RETM Transforms)

```typescript
// New way - transforms handle compression
space.addTransform(new CompressionTransform({ engine: compressionEngine }));
space.addTransform(new ContextTransform(veilState, compressionEngine));

const agent = new BasicAgent(config, provider, veilState);
// Agent doesn't need compression - it's handled by transforms!
```

## Monitoring Compression

Compression creates facets that you can observe:

### Compression Plan Facet
```typescript
{
  type: 'compression-plan',
  state: {
    engine: 'attention-aware',
    ranges: [
      {
        from: 10,
        to: 50,
        totalTokens: 1200,
        status: 'in-progress',
        // ...
      }
    ]
  },
  ephemeral: true
}
```

### Compression Result Facet
```typescript
{
  type: 'compression-result',
  state: {
    range: { from: 10, to: 50, totalTokens: 1200 },
    summary: 'User discussed weather and asked about forecast...',
    stateDelta: { /* state changes */ },
    engine: 'attention-aware'
  },
  ephemeral: true
}
```

## Benefits of RETM Compression

1. **Separation of Concerns**: Agents don't manage compression
2. **Reusability**: One compression engine serves all agents
3. **Consistency**: All agents get same compression behavior
4. **Observability**: Compression facets show what's happening
5. **Testability**: Can test compression independently of agents

## Running the Example

A complete working example is available:

```bash
npm run example:compression
```

This demo shows:
- Setting up compression transforms with priority
- Creating agents without compression parameters
- Generating messages to trigger compression
- Observing compression facets in VEIL state
- Complete architecture flow explanation

See `examples/compression-retm-demo.ts` for the full code.

## Next Steps

- **Run the example** - `npm run example:compression`
- Read about [Frame Processing Phases](./frame-processing.md)
- Learn about [Transform Ordering](./transform-ordering.md)
- Explore [Compression Engines](./compression-engines.md)


# Lightweight Connectome

An experimental TypeScript implementation of Connectome without the Loom DAG, focusing on instant state management with VEIL (Virtual Environment Interface Language) for LLM context generation.

## Key Differences from Main Connectome

- **No Loom DAG** - State is instant only, no timeline branching
- **Event-driven architecture** - All changes propagate through a unified event system
- **TypeScript implementation** - For better type safety and modern async handling
- **Simplified state model** - No historical state tracking or rollback

## Core Concepts

### VEIL (Virtual Environment Interface Language)
A markup language for LLM perceptual context consisting of:
- **Facets**: The atomic units of context (events, states, ambient info, tools)
- **Frames**: Deltas that modify the VEIL state
- **Operations**: Add facets, change states, manage scopes, trigger agent activation, speak naturally

### Focus and Communication
- **Focus**: The active communication channel set by incoming events
- **Speak**: Agent's natural dialogue operations that flow to the focused channel
- **Multi-channel**: Support for Discord, Minecraft, Twitter, terminals, etc.

### Architecture Layers

1. **Elements & Spaces**
   - Elements arranged in a tree structure
   - Root Space contains all elements
   - Event propagation through the tree

2. **VEIL Layer**
   - Facet management
   - Frame processing
   - State maintenance

3. **Memory System** (formerly Compression Engine)
   - Narrative summarization of event sequences
   - Fact and pattern extraction
   - Memory storage and retrieval
   - Asynchronous processing

4. **HUD (Heads-Up Display)**
   - Token budget management
   - Saliency-based content selection
   - Final context assembly
   - Multiple rendering strategies (XML, JSON)
   - Tool call extraction

## Project Structure

```
lightweight-connectome/
├── src/
│   ├── veil/
│   │   ├── types.ts              # Core VEIL type definitions
│   │   └── veil-state.ts         # VEIL state management
│   ├── compression/
│   │   ├── types.ts              # Compression interfaces
│   │   └── passthrough-engine.ts # Minimal compression implementation
│   ├── hud/
│   │   ├── types.ts              # HUD interfaces
│   │   └── xml-hud.ts            # XML rendering implementation
│   ├── agent-loop/
│   │   ├── types.ts              # Agent loop interfaces
│   │   └── agent-loop.ts         # Main orchestration logic
│   └── index.ts                  # Public API exports
├── examples/
│   ├── starship-scenario-veil.ts      # Complete VEIL frames example
│   ├── starship-scenario-rendered.xml # Rendered output example
│   ├── minimal-example.ts             # Simple example with focus/speak
│   ├── saliency-example.ts            # Saliency hints in action
│   ├── saliency-scoring-example.ts    # How saliency affects scoring
│   ├── graph-saliency-example.ts      # Graph-based saliency with links
│   ├── transient-lifecycle.ts         # Transient decay examples
│   ├── stream-awareness-example.ts    # Stream operations example
│   ├── minimal-example.ts             # Simple example with focus/speak
│   ├── test-saliency-rendering.ts     # Test saliency-aware rendering
│   └── reconciliation-summary.md      # Mapping between VEIL and output
├── docs/
│   ├── requirements.md                # Full requirements specification
│   ├── architecture.md                # Implementation architecture
│   ├── veil-to-rendering-mapping.md   # Detailed rendering rules
│   ├── focus-and-speak-design.md      # Communication design patterns
│   ├── saliency-design.md             # Context management design
│   ├── saliency-implementation.md     # Saliency implementation details
│   ├── saliency-hints-usage.md        # How to use saliency hints
│   ├── saliency-evolution.md          # Evolution to graph-based system
│   └── stream-operations.md           # Stream lifecycle management
├── package.json                       # Node.js package configuration
├── tsconfig.json                      # TypeScript configuration
└── README.md
```

## Quick Start

```bash
npm install
npm run build
npm run example  # Run basic usage example
```

## Usage

```typescript
import {
  VEILStateManager,
  FrameTrackingHUD,
  BasicAgent,
  AnthropicProvider,
  MockLLMProvider,
  Space
} from 'lightweight-connectome';

// Initialize components
const veilState = new VEILStateManager();

// Choose LLM provider
const llmProvider = process.env.ANTHROPIC_API_KEY
  ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
  : new MockLLMProvider();

// Create agent
const agent = new BasicAgent({
  systemPrompt: 'You are a helpful assistant.',
  defaultMaxTokens: 1000
}, llmProvider, veilState);

// Create space and attach agent
const space = new Space(veilState);
space.setAgent(agent);

// Process incoming frames
await space.emit({ topic: 'frame:start', ... });
```

### LLM Providers

The framework includes multiple LLM providers:

- **AnthropicProvider**: For Claude models (requires API key)
- **MockLLMProvider**: For testing without API calls
- Custom providers can implement the `LLMProvider` interface

## Current Status

✅ **Phase 1 Complete**: Core VEIL + HUD implementation
- VEIL state management with focus/speak
- Stream tracking and multi-channel support
- Graph-based saliency with temporal proximity
- Float-based transient decay (no magic timestamps)
- Passthrough compression engine  
- XML HUD with completion parsing
- SaliencyAwareHUD with link-aware scoring
- Basic agent loop orchestration

## Observability

The system includes comprehensive observability with file-based trace persistence:

```bash
# Interactive console chat with tracing
npm run test:console

# View real-time traces
tail -f traces/trace-*.jsonl | jq .

# Search for LLM interactions  
grep "llm\." traces/trace-*.jsonl | jq .

# Analyze agent behavior
jq 'select(.component == "BasicAgent")' traces/trace-*.jsonl
```

Features:
- **Full LLM request/response capture** - All interactions logged
- **File-based persistence** - Traces saved to `./traces` directory  
- **Automatic rotation** - Manages disk space automatically
- **Multiple export formats** - JSON, CSV, Markdown

See [docs/observability.md](docs/observability.md) for detailed documentation.

## Next Steps

### Phase 2: Elements & Spaces
1. Create Element base class and lifecycle
2. Implement Space as container Element
3. Convert HUD/AgentLoop to Elements
4. Add event propagation system

### Phase 3: Discord Integration
1. Create Discord adapter
2. Map Discord events to VEIL frames
3. Route speak operations back to Discord
4. Handle multi-channel scenarios

### Phase 4: Additional Elements
1. Internal scratchpad
2. Shell terminal
3. File system browser
4. Social graph tracker

### Phase 5: Advanced Features
1. Compression strategies (summarization)
2. JSON HUD format
3. Tool registration system
4. Scheduled events/timers

## Design Principles

- **Event-driven**: All state changes through events
- **Frame-based**: Atomic updates with clear boundaries
- **Pluggable**: HUDs and Compression Engines are interchangeable
- **Type-safe**: Leverage TypeScript for compile-time checks
- **Async-first**: Built for concurrent processing

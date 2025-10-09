# Connectome TypeScript

A TypeScript implementation of Connectome - an architectural framework for digital minds. This is the active TypeScript rewrite of the original Python Connectome, focusing on instant state management with VEIL while maintaining the core concepts of Elements, Components, and Spaces.

## Core Philosophy

Connectome is not just an agent framework - it's an architecture for digital minds with:
- **Perceptual Subjectivity**: Different minds perceive the same Space differently through VEIL
- **Event-Driven Architecture**: All state changes flow through events with clear causality
- **Component Composition**: Elements are containers, functionality comes from Components
- **Protocol Agnostic**: Core framework stays clean through the AXON protocol

## AXON Protocol

The AXON protocol enables Connectome to dynamically load components from external HTTP services, keeping the core framework protocol-agnostic:

- **Dynamic Loading**: Components loaded at runtime from URLs (e.g., `axon://localhost:8080/discord`)
- **Hot Reloading**: WebSocket support for development-time updates
- **Protocol Separation**: Discord, Minecraft, terminals etc. developed independently
- **MARTEM Support**: AXON modules can export any MARTEM component type
- **Parameter Passing**: URL parameters passed to components (e.g., `axon://game.server/spacegame?token=xyz`)

This allows adapters to be developed and served independently, maintaining clean separation of concerns.

## MARTEM Architecture

The framework uses a six-phase processing model for deterministic event handling:

1. **Afferents** (Async): Bridge external systems to Connectome events
2. **Modulators** (Phase 0): Preprocess events (filter, aggregate, buffer)
3. **Receptors** (Phase 1): Transform events into VEIL deltas
4. **Transforms** (Phase 2): Process VEIL state iteratively like a "chemical reaction"
5. **Effectors** (Phase 3): React to state changes, emit events or perform actions
6. **Maintainers** (Phase 4): System maintenance, persistence, infrastructure

All components share a unified lifecycle interface with `mount`, `unmount`, and optional `destroy` methods.

## Key Concepts

### VEIL (Virtual Embodiment Interface Language)

VEIL is the single source of truth for Connectome - a markup language for LLM perceptual context:

- **Facets**: Atomic units built from aspects (ContentAspect, StateAspect, EphemeralAspect, etc.)
- **Frames**: Boundaries for atomic state changes with event attribution
- **Deltas**: Only three operations - addFacet, changeFacet, removeFacet

Common facet types:
- **Event**: Strict temporality, occurs at one moment
- **State**: Mutable world/UI state with inline renderers
- **Ambient**: Floating context that stays in attention zone
- **Speech/Thought/Action**: Agent-generated content
- **Meta facets**: Infrastructure like stream-change, agent-activation

All system behaviors are expressed through facets - no special operations needed.

### Elements & Components
- **Elements**: Form a tree structure defining spatial organization
- **Components**: Provide all functionality, attached to Elements
- **Spaces**: Root Elements that orchestrate event processing
- **Auto-discovery**: Components are found in the element tree automatically

### Stream References

Communication uses structured stream references instead of hardcoded channels:
- Events set the active stream for their interaction
- Agent speak operations flow to the active stream
- Explicit targets enable cross-channel communication
- Stream metadata enables flexible routing

### Event System

Topic-based subscription system with structured element references:
- Events propagate through the element tree
- First-class events: frame start, timers, element lifecycle
- Adapter events defined by their elements (discord.message, etc.)
- Event batching for external sources

### Continuation System

Tag-based system for maintaining intent across asynchronous operations:
- Operations can specify continuations with tags
- Completed operations emit continuation facets
- Transforms process continuations to trigger follow-up actions

## Repository Setup

⚠️ **Important**: The Connectome ecosystem temporarily uses npm file links between repositories . All repos must be cloned into the same parent directory with their default names. This is a temporary limitation that will be resolved when packages are published to npm.

```bash
# Required directory structure:
parent-directory/
├── connectome-ts/              # This repository
├── connectome-axon-interfaces/ # Shared interfaces
├── axon-server/               # AXON HTTP server
├── discord-axon/              # Discord adapter
└── [other AXON modules]/      # Additional adapters
```

Clone all repositories:
```bash
git clone https://github.com/yourusername/connectome-ts.git
git clone https://github.com/yourusername/connectome-axon-interfaces.git
git clone https://github.com/yourusername/axon-server.git
git clone https://github.com/yourusername/discord-axon.git
```

Build dependencies in order:
```bash
# 1. Build shared interfaces first
cd connectome-axon-interfaces && npm install && npm run build && cd ..

# 2. Build core framework
cd connectome-ts && npm install && npm run build && cd ..

# 3. Build AXON modules as needed
cd axon-server && npm install && npm run build && cd ..
cd discord-axon && npm install && npm run build && cd ..
```

## Quick Start

```bash
# From connectome-ts directory
npm install
npm run build

# Run examples
npm run example                    # Basic usage
npm run example:discord-v2        # Discord integration 
npm run example:dispenser         # Persistence demo
npm run example:martem-complete   # Full MARTEM showcase
npm run example:continuations     # Continuation system
```

## Usage

### Basic Setup

```typescript
import {
  VEILStateManager,
  Space,
  Element,
  BaseReceptor,
  BaseEffector,
  createEventFacet
} from 'connectome-ts';

// Initialize VEIL state
const veilState = new VEILStateManager();
const space = new Space(veilState);

// Create element structure
const ui = new Element('ui-root');
space.addChild(ui);

// Add components (auto-discovered, no dual registration!)
ui.addComponent(new MyReceptor());
ui.addComponent(new MyEffector());

// Emit events
space.emit({
  topic: 'user:action',
  source: ui.getRef(),
  payload: { action: 'click' }
});
```

### Creating Components

```typescript
// Receptor: Convert events to VEIL changes
class ClickReceptor extends BaseReceptor {
  topics = ['ui:click'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    return [{
      type: 'addFacet',
      facet: createEventFacet({
        id: `click-${Date.now()}`,
        content: 'Button clicked',
        source: event.source
      })
    }];
  }
}

// Effector: React to VEIL changes
class NotificationEffector extends BaseEffector {
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    for (const change of changes) {
      if (change.type === 'added' && change.facet.type === 'event') {
        console.log('Event occurred:', change.facet.content);
      }
    }
    return { events: [] };
  }
}

// Transform: Derive new state
class EventCountTransform extends BaseTransform {
  priority = 50; // Optional execution order
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const eventCount = Array.from(state.facets.values())
      .filter(f => f.type === 'event').length;
      
    return [{
      type: 'addFacet',
      facet: {
        id: 'event-count',
        type: 'state',
        content: `Total events: ${eventCount}`,
        state: { count: eventCount }
      }
    }];
  }
}
```

### Loading AXON Components

```typescript
// Load Discord adapter via AXON
const discordElement = new Element('discord');
await discordElement.loadAxon('axon://localhost:8080/discord', {
  token: DISCORD_TOKEN
});
space.addChild(discordElement);

// Components are auto-discovered after loading!
```

### Afferents for External Integration

```typescript
class WebSocketAfferent extends BaseAfferent<WebSocketConfig> {
  private ws?: WebSocket;
  
  async onInitialize(context: AfferentContext<WebSocketConfig>) {
    const { config } = context;
    
    this.ws = new WebSocket(config.url);
    this.ws.on('message', (data) => {
      this.context.emitEvent({
        topic: 'ws:message',
        source: this.context.elementRef,
        payload: JSON.parse(data)
      });
    });
  }
  
  async onStart() {
    // Connect websocket
  }
  
  async onStop() {
    this.ws?.close();
  }
}
```

## Auto-Discovery

Components are automatically discovered in the element tree - no dual registration needed!

```typescript
// Old way (error-prone)
const effector = new MyEffector();
element.addComponent(effector);
space.addEffector(effector); // Easy to forget!

// New way (simple!)
element.addComponent(new MyEffector()); // That's it!
```

## Agent System

Agents interact through VEIL using natural operations:

```typescript
import { BasicAgent, AnthropicProvider, AgentEffector } from 'connectome-ts';

// Create agent with LLM provider
const agent = new BasicAgent({
  systemPrompt: 'You are a helpful assistant',
  provider: new AnthropicProvider({ apiKey: API_KEY })
});

// Agent operations create facets:
// speak() → speech facets
// act() → action facets (@element.action syntax)
// think() → thought facets

// Add agent effector to enable processing
const agentElement = new Element('agent');
agentElement.addComponent(new AgentEffector(agent));
space.addChild(agentElement);
```

### Action Syntax

Agents use `@element.action` syntax for invoking tools:
- Simple: `@box.open`
- With parameters: `@box.open("gently")` or `@box.open(speed="slow", careful=true)`
- Hierarchical paths: `@chat.general.say("Hello")`

## Testing & Development

```bash
# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Interactive console with tracing
npm run test:console

# Start debug server
npm run debug-server
```

## Observability

Comprehensive tracing with file-based persistence:

```bash
# View real-time traces
tail -f traces/trace-*.jsonl | jq .

# Search for LLM interactions  
grep "llm\." traces/trace-*.jsonl | jq .

# Analyze agent behavior
jq 'select(.component == "BasicAgent")' traces/trace-*.jsonl
```

## Architecture Benefits

1. **Clear Separation of Concerns**: Each MARTEM type has a specific responsibility
2. **Deterministic Processing**: Phases execute in order with clear boundaries
3. **Flexible Composition**: Mix and match components as needed
4. **Auto-Discovery**: Components work immediately when added to elements
5. **Type Safety**: Full TypeScript support with comprehensive types
6. **Protocol Agnostic**: Core stays clean through AXON dynamic loading

## Current Status

✅ **Core Complete**
- VEIL state management with aspect-based facets
- MARTEM component architecture with unified lifecycle
- Element tree with auto-discovery
- Event system with topic-based routing
- Continuation system for async coordination
- Symbol-based type detection
- Stream references for flexible communication
- Three fundamental VEIL operations
- Frame-based processing with event attribution

✅ **Integrations**
- Discord AXON (fully functional)
- Console I/O components
- File system operations
- Agent system with LLM providers
- AXON protocol with hot reloading
- Debug server and inspector

🚧 **In Progress**
- Component state management improvements
- Additional AXON modules (Minecraft, terminals, etc.)
- Performance optimizations
- Enhanced persistence strategies

## Documentation

- [Architecture Overview](docs/architecture.md)
- [MARTEM Components](MARTEM_ARCHITECTURE.md) 
- [Continuation System](CONTINUATION_SYSTEM.md)
- [Requirements Spec](docs/connectome-ts-reqs.md)
- [VEIL Delta Timing](docs/VEIL_DELTA_TIMING.md)
- [Observability Guide](docs/observability.md)

## Contributing

This project is developed by [Anima Labs](https://github.com/janus/anima). See the [contribution guidelines](CONTRIBUTING.md) for details.

## License

[MIT License](LICENSE)
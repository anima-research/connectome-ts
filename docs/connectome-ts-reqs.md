# Connectome TypeScript Architecture

Lightweight Connectome is an experimental TypeScript implementation of Connectome without the Loom DAG, focusing on instant state management with VEIL (Virtual Environment Interface Language) for LLM context generation.

## Key Differences from Main Connectome

- **No Loom DAG** - State is instant only, no timeline branching
- **Event-driven architecture** - All changes propagate through a unified event system
- **TypeScript implementation** - For better type safety and modern async handling
- **Simplified state model** - No historical state tracking or rollback

## Core Architecture

### Elements and Spaces

Spaces are Elements. Elements are arranged in a tree in a root Space (think Unity). All events, both from adapters and internally generated, propagate through an event system to all elements that subscribe to them. Frame processing is marked by frame start events when an event in the space queue begins processing.

### Communication Routing

Communication routing is handled through a "stream reference" mechanism rather than hardcoded channels. When events arrive from external sources (Discord, Minecraft, etc.), they set the active stream for that interaction. The agent's speak operations then naturally flow to the active stream, though they can override with explicit targets when needed for cross-channel communication.

### Processing Architecture

Compression Engine processing happens during the maintenance phase, HUD begins to render after the compression engine has finished its first pass. Compression Engine has its own internal asynchronicity (compression happens ahead of when its needed for context building in the HUD), so the first pass likely will only enqueue tasks and block only if needed data is not yet available.

The system integrates with Discord adapter as the main test target, with additional elements like internal scratchpad, social graph, shell terminal, and file terminal.

## VEIL (Virtual Environment Interface Language)

VEIL is essentially a markup language for the perceptual context of an LLM. Only a part of it gets rendered in the request that is sent to the API provider. VEIL is produced by the Elements when they are handling space events through the event system.

### VEIL Structure

VEIL is composed of VEIL frames, each frame is a delta applied to the previous frame. Frames carry both their deltas and the SpaceEvents that triggered them, enabling proper turn attribution in multi-agent contexts. The `events` field in frames is crucial for turn attribution - it contains the SpaceEvents that triggered the frame, allowing the HUD to determine message roles (user/assistant/system). Elements process events through the four-phase RETM cycle, with all changes consolidated into a single frame.

VEIL state is composed of facets. The order of facets in the VEIL document determines temporality.

### Aspect System

Facets are composed using aspects - interfaces that define capabilities rather than rigid types. This allows extensibility while maintaining semantic clarity:

**Core Aspects:**
- ContentAspect: Has renderable content (text/images)
- StateAspect: Contains mutable state
- EphemeralAspect: Exists only for current frame
- AgentGeneratedAspect: Created by an agent
- StreamAspect: Associated with a communication stream
- ScopedAspect: Bound to scopes

**Common Facet Types** (built from aspects):

Content Facets (have ContentAspect):
- Event: Strict temporality - occurs at one moment
- State: Mutable world/UI state visible to agents. Supports inline renderers:
  - attributeRenderers: For granular attribute display
  - transitionRenderers: For narrative state changes
- Ambient: Floating context that stays in attention zone
- Speech/Thought/Action: Agent-generated content
- Ephemeral: Temporary content that doesn't persist

Meta Facets (infrastructure, typically not rendered):
- stream-change, scope-change: System state changes
- agent-activation: Triggers agent processing
- rendered-context: HUD-generated context (ephemeral)
- action-definition: Tool definitions (not directly rendered)

The aspect system allows components to define custom facets while maintaining consistent behavior. The HUD uses aspects (particularly ContentAspect) to determine what to render.

### Facet Structure

Events, states and ambient contain content. The content can be a combination of text and images. They also include an id (normally does not get rendered to the agent), displayName (can be blank), and an arbitrary set of key-value pairs. Facets don't normally include a timestamp.

VEIL deltas are timestamped, but the time should not be used for most operations. Sequence numbers are the primary method of determining ranges of deltas.

A facet can contain other facets. Temporality of the container indirectly overrides the temporality of contents (if the container is hidden the temporality of contents is irrelevant). If container is a state, then it will get shown if any of the states it contains changes.

Facets can be assigned scopes. If all scope is destroyed, the associated facets are no longer active (but are rendered in context history up to moment of the scope deletion if saliency constraints allow).

### VEIL Operations

An incoming VEIL frame includes an "active stream" reference that specifies the active communication context with metadata. This stream reference determines where agent responses are directed by default.

VEIL deltas represent exotemporal changes to the perceptual state. There are only three fundamental delta types:

1. **addFacet**: Introduces a new facet to the VEIL state
2. **changeFacet**: Modifies an existing facet (deep merges changes, preserves functions like renderers)
3. **removeFacet**: Removes a facet from active state (preserves history)

All system behaviors are expressed through facets. Scopes, streams, and agents are managed through dedicated meta-facets rather than special operations. This unified model simplifies the architecture while maintaining full expressiveness.

### VEIL as Single Source of Truth

VEIL is the primary persistence mechanism for Connectome. All component state, agent memory, and system configuration lives in VEIL as facets. This principle ensures:
- Complete system state can be persisted by saving VEIL frames
- System state can be restored by replaying frames
- Time travel and debugging through frame history
- Clear audit trail of all state changes

Components requiring persistent state use InternalStateFacet (no ContentAspect, not rendered to agents). This maintains the purity of Receptors (stateless transformers) while allowing stateful behavior through VEIL. Effectors can maintain runtime state but should sync important state to VEIL for persistence.

Ephemeral facets are automatically cleaned up after all four phases complete, not actively removed during processing. This ensures they're available throughout the entire frame processing cycle.

### Saliency Hints

Facets can include saliency hints to help the HUD make intelligent context management decisions:
- Temporal hints: transient (float 0.0-1.0+ for decay rate)
- Semantic hints: streams[], crossStream
- Importance hints: pinned, reference
- Graph relationships: linkedTo[], linkedFrom[]

### Agent Operations

An outgoing VEIL delta uses the same three delta types. Agent behavior is expressed through specific facet types:

1. **Speech facets**: Natural language dialogue from the agent (routed to the active stream by default, can override with explicit target)
2. **Action facets**: Structured tool invocations from act operations
3. **Thought facets**: Agent's internal reasoning process from think operations
4. **AgentActivation facets**: Requests for agent processing, can include source and target agent IDs

Important: Agent actions are declarations in outgoing frames. Their consequences (state changes, events) appear in subsequent incoming frames, maintaining clear causality and enabling the agent to observe the results of its actions.

The agent uses VEILStateManager convenience methods that internally create facets via addFacet operations:
- `speak()` method creates `speech` facets
- `act()` method creates `action` facets (or @element.action syntax)
- `think()` method creates `thought` facets

This allows HUDs to render them with appropriate semantic meaning while maintaining a unified operation model.

### Multi-Agent Support

The system supports multiple agents operating in the same space through:
- Agent registration via meta-facets (agent-add, agent-remove, agent-update)
- Agent attribution in facets (agentId and agentName fields)
- Targeted agent activation using agentActivation facets with sourceAgentId/targetAgentId
- Automatic attribution of agent-generated facets (speech, thought, action)

This enables complex multi-agent interactions with clear attribution and targeting.

### Action Syntax

Agents use @element.action syntax for invoking tools:
- Simple: @box.open
- With parameters: @box.open("gently") or @box.open(speed="slow", careful=true)
- Hierarchical paths: @chat.general.say("Hello")
- Block parameters: @email.send { to: alice@example.com, subject: Test }

Tools are registered with explicit paths (no wildcards) to avoid collisions. The action parser handles inline named parameters with type inference (strings, numbers, booleans). Note: Block format has limitations with nested braces and should be used for simple key-value pairs.

## MARTEM Architecture

The MARTEM (Modulator/Afferent/Receptor/Transform/Effector/Maintainer) architecture provides a deterministic processing cycle for events:

### Phase 0 - Event Preprocessing (Modulators)
- Pure functions that preprocess events before they enter the system
- Can filter, aggregate, buffer, or rewrite the event queue
- No access to VEIL state
- Examples: Rate limiting, event deduplication, batching

### Phase 1 - Events → Facets (Receptors)
- Pure functions that transform SpaceEvents into Facets
- No side effects or external dependencies
- Multiple receptors can process the same event
- Stateless by design - any state must be read from VEIL

### Phase 2 - Facets → Facets (Transforms)
- Pure functions that process VEIL state to produce new facets
- Examples: HUD context generation, state transition detection
- Loops until no new facets are generated (enables cascading)
- Maximum of 100 iterations to prevent infinite loops
- Can read any facet in VEIL, including InternalStateFacets
- Operates as a "chemical reaction space" - deltas applied directly to working state

### Phase 3 - Facets → Events/Actions (Effectors)
- Stateful components that observe facet changes
- Can emit new events, perform external actions
- Examples: Agent activation, console output, Discord messaging
- Can directly update their own component-state facets (proposed)

### Phase 4 - Maintenance → Events (Maintainers)
- Perform system maintenance operations
- Examples: Element tree management, persistence, transition tracking
- Can emit new events for the next frame
- Can directly update their own component-state facets (proposed)

### Async - External System Integration (Afferents)
- Run asynchronously outside the frame boundary
- Bridge external systems to Connectome events
- Managed by effectors, have their own command queue
- Examples: Discord WebSocket, console input, file watchers
- Can update their own component-state via async bridge (proposed)

All MARTEM components implement a unified Component interface with mount/unmount/destroy lifecycle methods. This architecture provides clear data flow, testability through pure functions in Phases 0-2, and controlled side effects in Phases 3-4 and Afferents.

## System Architecture

### Reference Injection

The ConnectomeHost maintains a unified reference registry that is shared with spaces. Components can:
- Use @reference decorators to declare dependencies 
- Access references via requireReference() and getReference() helper methods
- References are properly resolved for subclasses through prototype chain walking
- AXON-loaded components receive reference injection after dynamic loading

This unified approach eliminates synchronization issues and simplifies component development.

### AXON Protocol

The AXON protocol enables Connectome to dynamically load components from external HTTP services, keeping the core framework protocol-agnostic. Key features:

1. **Dynamic Component Loading**: Components are loaded at runtime from URLs (e.g., `axon://localhost:8080/discord`)
2. **Manifest-Based**: Services provide a JSON manifest specifying the main module and metadata
3. **Hot Reloading**: Optional WebSocket connection for development-time module updates
4. **Parameter Passing**: URL parameters are passed to loaded components (e.g., `axon://game.server/spacegame?token=xyz`)
5. **Action Registration**: Loaded components can register actions that agents can invoke via `@element.action` syntax
6. **Module Versioning**: Cache-busting ensures fresh modules after changes
7. **MARTEM Support**: AXON modules can export Modulators, Afferents, Receptors, Effectors, Transforms, and Maintainers directly
8. **V2 Environment**: Extended environment provides all MARTEM interfaces, base classes (BaseAfferent, etc.), and helpers
9. **Mixed Modules**: AXON modules can export both traditional Components and MARTEM components simultaneously

The AxonElement acts as a loader that:
- Fetches the manifest from the HTTP endpoint
- Downloads and evaluates the component module
- Instantiates the component and adds it to the element tree
- Handles hot reload notifications for development
- Manages cleanup on unmount

This architecture allows protocol-specific adapters (Discord, Minecraft, etc.) to be developed and served independently from the core Connectome framework, maintaining clean separation of concerns.

### Event System

First-class events include frame start, time events, element lifecycle (mount/unmount), and scheduled events. Adapter-specific events (Discord, filesystem, etc.) are defined by their respective elements. Events use structured element references instead of strings for source identification.

### Agent Interface

The Space has an optional AgentInterface that processes completed frames. The agent decides whether to activate based on activation operations and their metadata. Empty frames (no VEIL operations, no activations) are discarded to maintain efficiency. The agent interface receives callbacks after all components have processed frame events.

### Element Tree Persistence

- Element tree structure is persisted in VEIL via ElementTreeFacet
- Components are registered in ComponentRegistry
- Element creation/deletion is declarative via events
- ElementRequestReceptor processes element:create/delete events
- ElementTreeMaintainer handles actual instantiation

### Stream References

Communication contexts use structured stream references with metadata instead of string identifiers. Stream references include type information and relevant metadata (channel, user, etc.). This enables flexible routing without hardcoding channel names.

## Compression System

The compression engine is responsible for performing self-narrated narrative blocks and extraction of other data. The actual mechanism of compression is pluggable, but the external API is well defined.

### Key Architectural Decisions

1. Compression works on VEIL frame ranges (e.g., "compress frames 10-50"), not individual facets. Frames are the stable unit that bridges VEIL operations and rendered output.

2. Frame-based compression solves the addressing fragility problem:
   - Facets can be deleted or modified after compression, breaking facet-based references
   - The rendered context changes between frames as state evolves
   - Frame sequence numbers are immutable and provide stable references

3. The compression engine needs access to both:
   - VEIL-level data: frame operations, facet metadata (saliency hints, types, relationships)
   - Rendered context: how those frames actually rendered (for attention-preserving compression)

4. This dual-access architecture enables different compression strategies:
   - Simple strategies can use just the rendered text
   - Saliency-aware strategies can use facet metadata
   - Sophisticated strategies can use both for attention-preserving compression

### State Preservation

When compressing frame ranges that contain state changes, the compression must preserve the net effect of all state mutations. The compressed frame should include a state delta showing the union of all changes from the beginning to end of the range. For example, if a facet's attributes change multiple times within the range, only the final values need to be preserved. This ensures the HUD can correctly track state evolution even when frames are compressed.

### Attention-Aware Compression

- Content to be compressed is wrapped in `<content_to_compress>` tags in the rendered context
- Compression instructions can be inserted at the right position (before the frames being compressed)
- This ensures the model sees content in context before compressing it, preserving attention hooks

## HUD System

The HUD is responsible for assembling the actual final LLM context. It is called by the AgentLoop. HUDs are pluggable, multiple implementations can be supported. The basic HUD renders the hierarchy of VEIL nodes as pseudo-XML blocks and extracts tool calls from the raw completion string. Other implementations can theoretically use JSON and supply tool call instructions using tools LLM API.

To support frame-based compression, the HUD must maintain frame boundaries during rendering - tracking which rendered segments came from which VEIL frames. This enables the compression engine to understand the relationship between frames and their rendered representation.

The HUD does not store current state. Instead, it rebuilds state from the beginning for each render by replaying all frame operations. This ensures historical accuracy - each frame shows the state as it existed at that moment, not the final state.

### Key HUD Behaviors

1. Events render only in their frames when they occur
2. States render when initially added (showing initial values) and when changed (chronologically)
3. Ambient facets use "floating" behavior - appearing at a preferred depth from current moment (e.g., 5 messages back) to stay in attention zone
4. Frames are the natural units of conversation - no artificial turn-based grouping
5. Facets with displayName use it as XML tags; those without displayName render as plain content
6. Agent operations are wrapped in `<my_turn>` tags for prefill compatibility
7. State is rebuilt incrementally by replaying operations from the beginning to ensure historical accuracy
8. HUD maintains both before and after states when rendering frames, enabling transition-aware rendering
9. State transitions can be rendered narratively using transitionRenderers instead of just showing value changes

### State Transition Rendering

- State facets include inline renderers as part of their definition
- attributeRenderers: Display functions for individual attributes (e.g., "(3 items)")
- transitionRenderers: Narrative functions for state changes (e.g., "Box #3 materializes!")
- Renderers are preserved through facet operations (changeFacet maintains functions)
- StateTransitionTransform (Phase 2) automatically generates event facets from state changes
- This ensures historical consistency - old frames render with their original logic
- Renderers can be provided as functions (converted to strings for persistence) or strings

The Compression Engine produces narrative blocks that replace frame ranges in the final LLM context. The HUD provides the Compression Engine with:
- The VEIL frames to potentially compress (with their operations)
- How those frames rendered as segments (maintaining frame boundaries)
- The current VEIL state (all active facets)

The Compression Engine returns frame-range replacements (e.g., "frames 10-50 become this narrative"). The HUD then applies these replacements when rendering, skipping the original frame effects and inserting narratives instead. This frame-based approach provides stable references even when facets are later modified or deleted.

HUD is built with awareness of a particular implementation of a Compression Engine, but a Compression Engine can be used with different HUDs. HUD can also use different implementations of Compression Engines, provided that they keep to a common API.

## Additional Features

Some tools can create internally scheduled events in the AgentLoop. For example, an agent can set a timer to wake up in a given interval. Similarly, an agent can choose to sleep and to postpone handling of events for a given amount of time.

Most external events are batchable, although not all. In this case they cause updates of Elements, but the AgentLoop does not call the LLM until the end of a batch.

## Implementation Architecture

- LLMProvider interface abstracts different LLM backends (Anthropic, OpenAI, etc.)
- Providers handle both message-based and prefill modes internally
- Includes retry logic with exponential backoff for transient errors
- Tracing system captures all internal operations for debugging
- File-based trace storage with rotation and export capabilities

## Current Implementation Status

### Completed

- Aspect-based facet system with extensible types (Facet as interface)
- Three fundamental delta types: addFacet, changeFacet, removeFacet
- Four-phase processing (RETM): Receptors → Transforms → Effectors → Maintainers
- VEILStateManager with deep merge support for changeFacet
- Runtime facet validation with configurable strictness
- Inline state renderers (preserved through operations)
- StateTransitionTransform for automatic event generation
- Multi-agent support through facet attribution
- Unified host registry system for references
- FrameTrackingHUD with aspect-based rendering
- ConsoleInputReceptor and ConsoleOutputEffector
- ContextTransform replacing HUD context generation
- AgentEffector replacing AgentComponent
- @element.action syntax with hierarchical paths
- Action parser with type inference
- BasicAgent with facet-based operations
- LLMProvider interface with AnthropicProvider
- Retry logic with exponential backoff
- Prefill mode support
- Token budget management
- Compression engine API with state preservation
- SimpleTestCompressionEngine and AttentionAwareCompressionEngine
- Tracing system with file-based storage
- Event priority queue and propagation
- AXON Protocol for dynamic component loading
- Discord adapter via AXON
- Scheduled events and timers
- Agent sleep/wake functionality
- Full compression with LLM summarization
- MCP session server
- Debug UI with frame tracking
- Component helper methods (requireReference, getReference)
- Maintainers for system-level operations
- Element tree persistence via VEIL
- ComponentRegistry for declarative element management
- AXON RETM support
- Removal of frame:end events
- Phase 2 looping with iteration limit
- MARTEM architecture with Phase 0 Modulators
- BaseAfferent implementation with command queue
- Unified Component interface for all MARTEM types
- BaseModulator, BaseReceptor, BaseTransform, BaseEffector, BaseMaintainer
- Component lifecycle methods (mount/unmount/destroy)
- Afferent support in AXON V2 environment
- Discord Afferent implementation
- Fixed frame.events for proper turn attribution
- Element.active property for mount state
- ComponentRequestFacet for facet-driven component creation

### Still Pending

- Component State Management (proposed):
  - ComponentStateFacet implementation
  - Direct VEIL writes for effectors/maintainers
  - Afferent state bridge for async updates
  - Migration from @persistent decorator
- Additional adapters (filesystem, shell terminal, etc.)
- Discovery mechanism for @element.? syntax
- Enhanced block parameter parsing (proper grammar/parser)
- Lazy loading for frames to avoid memory issues
- Reorganize persistence for long contexts
- Typing notifications for Discord
- Support for deletion and editing of Discord messages
- Resource facets
- Content markup language to reference facets
- Custom LLM provider settings communication
- LLM provider prompt caching support
- Meta-facets for scope/stream/agent changes

### Recently Removed/Deprecated

- Legacy operations beyond add/change/remove facet
- Separate operations for streams/scopes/agents (now meta-facets)
- EphemeralCleanupTransform (ephemeral facets naturally fade)
- AgentComponent (replaced by AgentEffector)
- Direct VEIL manipulation in components (use Receptors/Effectors)
- Fixed facet types (now extensible via Facet interface)
- frame:end events (functionality moved to Maintainers)
- Legacy Component support
- Direct element tree manipulation (now declarative via VEIL)

### Conceptual Insights

- Phase 2 operates as a "chemical reaction space" where facet changes combine atomically without predefined order
- changeFacet operations are necessary for "rewriting history" (forgetting, reframing) but should be used carefully
- Transforms should generally create new derived facets rather than modifying existing ones
- Component state vs perception: VEIL represents both perceptual state and internal machinery
- Afferents require special handling due to their async nature outside the frame boundary
I want to consider making a lightweight experimental version of Connectome as an alternative to the current implementation. 

The key difference would be that it would not contain a loom dag at all. The space state would be instant only. VEIL would still be produced by elements in the space, and VEIL would be rendered by the HUD, compressed by the Compression Engine, etc, but the logic to produce it would be much simpler.

I am looking for a pretty much an independent implementation, I don't think we can reuse much code. I think we should try it in Typescript rather than Python.

Spaces are Elements. Elements are arranged in a tree in a root Space (think Unity).

What I want to do better is to avoid the hardcoding that was made in the current implementation: all events, both from adapters and internally generated should propagate through an event system to all elements that subscribe to them. We should still frame start/frame end events that occur when an event in the space queue starts being processed and after it finishes processing.

Communication routing is handled through a "stream reference" mechanism rather than hardcoded channels. When events arrive from external sources (Discord, Minecraft, etc.), they set the active stream for that interaction. The agent's speak operations then naturally flow to the active stream, though they can override with explicit targets when needed for cross-channel communication.

Compression Engine processing happens after the end of frame, HUD begins to render after the compression engine has finished its first pass. Compression Engine should have its own internal asynchronicity (compression happens ahead of when its needed for context building in the HUD), so the first pass likely will only enqueue tasks and block only if needed data is not yet available.

We should aim for integration with Discord adapter as the main target against against which to test, then we can add more elements, like an internal scratchpad, a social graph, a shell terminal, file terminal, etc.

Few word on VEIL:

VEIL is essentially a markup language for the perceptual context of an LLM. Only a part of it gets rendered in the request that is sent to the API provider. VEIL is produced by the Elements when they are handling space events through the event system. 

VEIL is composed of VEIL frames, each frame is a delta applied to the previous frame. Frames can be incoming or outgoing. Elements can change the current VEIL frame at will up until the frame end. The execution order of Elements is not guaranted, so when dependendies arise Elements should call other elements as needed instead of relying on events, although normally elements are decoupled and not sensitive to order.

VEIL state is composed of facets. The order of facets in the VEIL document determines temporality.

There are the following types of facets:

Events: Have strict temporality - occur at one specific moment
States: Have defined temporality at creation but remain valid until changed/invalidated. Support optional attributeRenderers for granular updates and transitionRenderers for narrative state changes.
Ambient: Has loose temporality - valid from creation until scope is destroyed. Ambient facets "float" in the context, preferring to be rendered at a fixed depth from the current moment (e.g., 3-5 messages back) to stay in the attention zone while respecting temporal constraints. Examples include mission objectives, tool instructions, or contextual reminders.
Tool definitions: Tool definitions don't get rendered. Instructions for using tools are displayed using other facet types. Tool definitions allow the HUD to process completions and extract commands. Modern tool definitions support:
  - Element routing via elementPath/elementId
  - Generic event emission instead of callbacks
  - Hierarchical namespaces (e.g., chat.general.say)
  - Parameter schemas with type information
Speech: Natural language output from agent speak operations
Thought: Internal reasoning from agent innerThoughts operations
Action: Structured actions from agent toolCall operations

Events, states and ambient contain content. The content can be a combination of text and images. They also include an id (normally does not get rendered to the agent), displayName (can be blank), and an arbitrary set of key-value pairs. Facets don't normally include a timestamp.

VEIL deltas are timestamped, but the time should not be used for most operations. Sequence numbers should be the primary method of determining ranges of deltas.

A facet can contain other facets. Temporality of the container indirectly overrides the temporality of contents (if the container is hidden the temporality of contents is irrelevant). If container is a state, then it will get shown if any of the states it contains changes.

Facets can be assigned scopes. If all scope is destroyed, the associated facets are no longer active (but are rendered in context history up to moment of the scope deletion if saliency constraints allow).

An incoming VEIL frame includes an "active stream" reference that specifies the active communication context with metadata. This stream reference determines where agent responses are directed by default.

An incoming VEIL delta can contain any number of the following operations:

1. Adding a facet
2. Changing a state  
3. Adding or deleting scopes
4. Adding, updating, or deleting streams (communication contexts)
5. Agent activation: signals that agent attention may be needed, includes source element reference and arbitrary metadata
6. Removing a facet: suppresses rendering of a facet (and its children) without destroying history. Two modes:
   - 'hide': For attention management - facet still exists, state changes still apply, but no rendering (including transitions)
   - 'delete': For error correction - facet is effectively gone, state changes are silently ignored

Facets can include saliency hints to help the HUD make intelligent context management decisions:
- Temporal hints: transient (float 0.0-1.0+ for decay rate)
- Semantic hints: streams[], crossStream
- Importance hints: pinned, reference
- Graph relationships: linkedTo[], linkedFrom[]

An outgoing VEIL delta can contain any number of the following operations (or it can be empty):

1. Speak: Natural language dialogue from the agent (routed to the active stream by default, can override with explicit target)
2. Command (tool call): Structured tool invocations (also referred to as "action" throughout the codebase)
3. Cycle request: a request to agent loop to schedule another LLM call immediately
4. Inner thoughts: Agent's internal reasoning process

Important: Agent actions are declarations in outgoing frames. Their consequences (state changes, events) appear in subsequent incoming frames, maintaining clear causality and enabling the agent to observe the results of its actions.

Agent operations create specific facet types:
- `speech` facets from speak operations
- `action` facets from toolCall operations (or @element.action syntax)
- `thought` facets from innerThoughts operations
This allows HUDs to render them with appropriate semantic meaning.

Action Syntax:
Agents use @element.action syntax for invoking tools:
- Simple: @box.open
- With parameters: @box.open("gently") or @box.open(speed="slow", careful=true)
- Hierarchical paths: @chat.general.say("Hello")
- Block parameters: @email.send { to: alice@example.com, subject: Test }
Tools are registered with explicit paths (no wildcards) to avoid collisions.
The action parser handles inline named parameters with type inference (strings, numbers, booleans).
Note: Block format has limitations with nested braces and should be used for simple key-value pairs.

Space/Element System Requirements:

Elements are the basic building blocks arranged in a tree hierarchy, with Space as the root element. Elements can have Components that add behavior. Events flow through the element tree using a topic-based subscription system (e.g., "discord.message", "timer.expired"). Elements produce VEIL operations in response to events.

Event System Requirements:

First-class events include frame lifecycle (start/end), time events, element lifecycle (mount/unmount), and scheduled events. Adapter-specific events (Discord, filesystem, etc.) are defined by their respective elements. Events use structured element references instead of strings for source identification.

Agent Interface Requirements:

The Space has an optional AgentInterface that processes completed frames. The agent decides whether to activate based on activation operations and their metadata. Empty frames (no VEIL operations, no activations) are discarded to maintain efficiency. The agent interface receives callbacks after all components have processed frame events.

Stream References:

Communication contexts use structured stream references with metadata instead of string identifiers. Stream references include type information and relevant metadata (channel, user, etc.). This enables flexible routing without hardcoding channel names.

Lets start by defining VEIL and HUD, skipping for now spaces, elements, discord, and all that, building from the inside out. The compression engine should be sketched but the actual compression is too early to implement, we are mostly interested in the API between the compression engine and the HUD.

The compression engine is responsible for performing self-narrated narrative blocks and other extraction of other data. The actual mechanism of compression should be pluggable, but the external API should be well defined.

Key architectural decisions:
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

The HUD is responsible for assembling the actual final LLM context. It is called by the AgentLoop. HUDs are pluggable, multiple implementations can be supported. For example, the basic HUD that we will start with will render the hierarchy of VEIL nodes as pseudo-XML blocks and the will extract tool calls from the raw completion string. Another can theoretically use JSON and supply tool call instructions using tools LLM API.

To support frame-based compression, the HUD must maintain frame boundaries during rendering - tracking which rendered segments came from which VEIL frames. This enables the compression engine to understand the relationship between frames and their rendered representation.

The HUD does not store current state. Instead, it rebuilds state from the beginning for each render by replaying all frame operations. This ensures historical accuracy - each frame shows the state as it existed at that moment, not the final state.

Implementation Architecture:
- LLMProvider interface abstracts different LLM backends (Anthropic, OpenAI, etc.)
- Providers handle both message-based and prefill modes internally
- Includes retry logic with exponential backoff for transient errors
- Tracing system captures all internal operations for debugging
- File-based trace storage with rotation and export capabilities

Key HUD behaviors:
1. Events render only in their frames when they occur
2. States render when initially added (showing initial values) and when changed (chronologically)
3. Ambient facets use "floating" behavior - appearing at a preferred depth from current moment (e.g., 5 messages back) to stay in attention zone
4. Frames are the natural units of conversation - no artificial turn-based grouping
5. Facets with displayName use it as XML tags; those without displayName render as plain content
6. Agent operations are wrapped in `<my_turn>` tags for prefill compatibility
7. State is rebuilt incrementally by replaying operations from the beginning to ensure historical accuracy
8. HUD maintains both before and after states when rendering frames, enabling transition-aware rendering
9. State transitions can be rendered narratively using transitionRenderers instead of just showing value changes

Rendered context for xml-style hud would look kind of like:

<chat_info>
   30 users
   7 users online
</chat_info>
<msg source="general" sender="quarnaris">But I agree that, from my observations, if you have a long one-on-one conversation about a particular topic, the model would tend to want to explore the reverse side of it (edited)</msg>
<time_marker>3 min ago</time_marker>
<msg source="general" sender="antra_tessera">hey</msg>
<my_turn>
@chat.general.say("I find that interesting too - models do seem to naturally explore contrasting perspectives")
</my_turn>
<!-- Agent action declared -->
<msg source="general" sender="connectome">I find that interesting too - models do seem to naturally explore contrasting perspectives</msg>
<!-- Action consequence: message appeared in chat -->
<msg source="general" sender="alice">Yeah, it's like they want to be balanced</msg>
<my_turn>
@chat.general.say("Exactly! It might be a form of intellectual curiosity")
</my_turn>


The Compression Engine produces narrative blocks that replace frame ranges in the final LLM context. The HUD provides the Compression Engine with:
- The VEIL frames to potentially compress (with their operations)
- How those frames rendered as segments (maintaining frame boundaries)
- The current VEIL state (all active facets)

The Compression Engine returns frame-range replacements (e.g., "frames 10-50 become this narrative"). The HUD then applies these replacements when rendering, skipping the original frame effects and inserting narratives instead. This frame-based approach provides stable references even when facets are later modified or deleted.

State preservation in compression:
- When compressing frame ranges that contain state changes, the compression must preserve the net effect of all state mutations
- The compressed frame should include a state delta showing the union of all changes from the beginning to end of the range
- For example, if a facet's attributes change multiple times within the range, only the final values need to be preserved
- This ensures the HUD can correctly track state evolution even when frames are compressed

State transition rendering:
- State facets can define attributeRenderers for individual attribute updates (e.g., showing "(3 items)" when count changes)
- State facets can define transitionRenderers that provide narrative descriptions during state changes
- Transition renderers receive both old and new values, allowing contextual narratives (e.g., "Box #3 materializes!")
- When both are defined, transition renderers take priority during state changes
- This reduces redundancy between state updates and event emissions while maintaining engaging context
- The HUD tracks both before and after states for each frame to enable accurate transition detection

Attention-aware compression:
- Content to be compressed is wrapped in `<content_to_compress>` tags
- Compression instructions can be inserted at the right position (before the frames being compressed)
- This ensures the model sees content in context before compressing it, preserving attention hooks

HUD is built with awareness of a particular implementation of a Compression Engine, but a Compression Engine can be used with different HUDs.

HUD can also use different implementations of Compression Engines, provided that they keep to a common API.

Some tools can create internally scheduled events in the AgentLoop. For example, an agent can set a timer to wake up in a given interval. Similarly, an agent can choose to sleep and to postpone handling of events for a given amount of time.

Most external events are batchable, although not all. In this case they cause updates of Elements, but the AgentLoop does not call the LLM until the end of a batch.

As the first step, lets mockup a larger example of rendered context, one that contains multiple turns and shows examples of various VEIL features. We can use prefill format. For simplicity, lets assume that our mockup does not include images. The prefill format (with no images) works as follows: all content is sent as a sequence of user and assistant messages. The HUD renders frames as they naturally occur, with the last assistant message having the `<my_turn>` prefix for prefill. System prompts are handled by the agent, not the HUD.

Note, that the rendered context is not VEIL. In the rendered context it is impossible to tell the type of facets that led to its production, so it makes sense to specify that information in comments.

Current Implementation Status:

Completed:
- VEIL data model with all facet types (event, state, ambient, tool, speech, thought, action)
- VEILStateManager for managing facets and frame history
- FrameTrackingHUD with frame-based rendering (no turn grouping, historical state accuracy)
- State preservation through incremental replay of operations
- @element.action syntax with hierarchical paths and named parameters
- Action parser with type inference for inline parameters
- BasicAgent with modern tool registration (ToolDefinition objects)
- Generic event emission for tool actions (no hardcoded callbacks)
- LLMProvider interface with AnthropicProvider implementation
- Retry logic with exponential backoff and error logging
- Prefill mode support with proper formatting
- Token budget management (context vs generation limits)
- Compression engine API with state delta preservation
- SimpleTestCompressionEngine and AttentionAwareCompressionEngine
- Tracing system with synchronous file-based storage
- Console chat adapter as test harness
- Interactive element test scenarios
- Agent activation queue with source-based deduplication
- Basic Space/Element/Component structure with event handling
- Event priority queue with immediate/high/normal/low priorities
- Three-phase event propagation (capture, at-target, bubble)
- Event control utilities (stopPropagation, stopImmediatePropagation, preventDefault)
- State transition rendering with attributeRenderers and transitionRenderers
- HUD before/after state tracking for transition detection

Still Pending:
- Stream reference tracking for communication routing
- Discord adapter integration  
- Complete Space/Element/Component architecture with mount/unmount lifecycle
- Scheduled events and timers
- Full agent sleep/wake functionality with pending activation processing
- Full compression implementation with LLM-based summarization
- Additional adapters (filesystem, shell terminal, etc.)
- Discovery mechanism for @element.? syntax
- Enhanced block parameter parsing (proper grammar/parser)
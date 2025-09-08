// VEIL exports
export * from './veil/types';
export { VEILStateManager } from './veil/veil-state';

// Memory System exports - temporarily removed during cleanup

// Compression exports
export * from './compression/types-v2';
export { AttentionAwareCompressionEngine } from './compression/attention-aware-engine';
export { SimpleTestCompressionEngine } from './compression/simple-test-engine';

// HUD exports
export * from './hud/types-v2';
export { FrameTrackingHUD } from './hud/frame-tracking-hud';

// LLM exports
export * from './llm/llm-interface';
export { MockLLMProvider } from './llm/mock-llm-provider';

// Space/Element exports
export { 
  ElementRef,
  SpaceEvent,
  FrameStartEvent,
  FrameEndEvent,
  TimeEvent,
  ElementMountEvent,
  ElementUnmountEvent,
  AgentResponseEvent,
  ComponentLifecycle,
  EventHandler,
  TopicSubscription,
  AgentInterface
} from './spaces/types';
export { Space } from './spaces/space';
export { Element } from './spaces/element';
export { Component } from './spaces/component';

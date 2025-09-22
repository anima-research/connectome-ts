// Register core components
import './core-components';

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
export { AnthropicProvider } from './llm/anthropic-provider';
export { DebugLLMProvider } from './llm/debug-llm-provider';
export { debugLLMBridge } from './llm/debug-llm-bridge';
export type { DebugLLMRequest } from './llm/debug-llm-bridge';

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
  TopicSubscription
} from './spaces/types';
export { Space } from './spaces/space';
export { Element } from './spaces/element';
export { Component } from './spaces/component';

// Agent exports
export * from './agent/types';
export { BasicAgent } from './agent/basic-agent';
export { AgentComponent } from './agent/agent-component';

// Element exports
export { ConsoleChatComponent } from './elements/console-chat';
export { AxonElement } from './elements/axon-element';

// Tracing exports
export * from './tracing';

// Persistence exports
export * from './persistence';

// Component Registry
export { ComponentRegistry } from './persistence/component-registry';

// Debug exports
export { DebugServer } from './debug';
export type { DebugServerConfig } from './debug';

// Host exports
export { ConnectomeHost, type HostConfig } from './host';
export type { ConnectomeApplication } from './host/types';
export { reference, external, type RestorableComponent } from './host/decorators';

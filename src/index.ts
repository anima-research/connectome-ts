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
export { ContextTransform } from './hud/context-transform';
export { 
  extractFrameRange, 
  hasFramesInRange, 
  getRenderedFrameSequences, 
  findFrameGaps 
} from './hud/frame-extraction';
export type { ExtractedFrameRange } from './hud/frame-extraction';

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
export { Component as SpaceComponent } from './spaces/component';
export { SpaceAutoDiscovery } from './spaces/space-auto-discovery';

// Component base type export
export * from './types/component';

// MARTEM exports (Modulator/Afferent/Receptor/Transform/Effector/Maintainer)
export * from './spaces/receptor-effector-types';

// Base MARTEM implementations
export * from './components/base-martem';
export { BaseAfferent } from './components/base-afferent';

// Migration adapters
export {
  VEILOperationReceptor,
  ComponentToReceptorAdapter,
  ComponentToEffectorAdapter
} from './spaces/migration-adapters';

// Export RETM type detection utilities
export {
  RETM_TYPE,
  RETM_TYPES,
  isModulator,
  isReceptor,
  isTransform,
  isEffector,
  isMaintainer,
  isRETMComponent,
  getRETMInterfaces
} from './utils/retm-type-guards';

// Export priority grouping utility
export { groupByPriority } from './utils/priorities';

// Note: EphemeralCleanupTransform removed - ephemeral facets naturally fade away

// Transform exports
export { StateTransitionTransform } from './transforms/state-transition-transform';
export { ContinuationTransform } from './transforms/continuation-transform';
export { FrameSnapshotTransform } from './transforms/frame-snapshot-transform';
export { CompressionTransform } from './transforms/compression-transform';

// Element tree system exports
export { 
  registerComponent,
  ElementRequestReceptor,
  ElementTreeTransform,
  ElementTreeMaintainer
} from './spaces/element-tree-receptors';

// Validation exports
export * from './validation/facet-validation';

// Agent exports
export * from './agent/types';
export { BasicAgent } from './agent/basic-agent';
export { AgentComponent } from './agent/agent-component';
export { AgentEffector } from './agent/agent-effector';
export { AgentElement } from './agent/agent-element';
export { createBasicAgent, type CreateAgentOptions } from './agent/agent-factory';

// Element exports
export { ConsoleChatComponent } from './elements/console-chat'; // Legacy - use console-chat-retm instead
export { 
  ConsoleAfferent, 
  ConsoleMessageReceptor, 
  ConsoleSpeechEffector,
  createConsoleElement 
} from './elements/console-chat-retm';

// Component exports
export { AxonLoaderComponent } from './components/axon-loader';
export { SpaceNotesComponent } from './components/space-notes';
export { VEILComponent, InteractiveComponent } from './components/base-components';
export { ConsoleInputReceptor, ConsoleOutputEffector } from './components/console-receptors';

// AXON exports
export { createAxonEnvironment } from './axon/environment';
export { createAxonEnvironmentV2 } from './axon/environment-v2';
export { 
  IAxonManifest,
  IAxonComponentConstructor,
  IComponent,
  IVEILComponent,
  IInteractiveComponent,
  IAxonEnvironment
} from './axon/interfaces';
export * from './axon/interfaces-v2';

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

// Helper/Factory exports
export {
  // ID generation
  friendlyId,
  // Event and reference factories
  createSpaceEvent,
  createElementRef,
  createAgentActivation,
  // Facet creation factories (with validation)
  createSpeechFacet,
  createThoughtFacet,
  createActionFacet,
  createEventFacet,
  createStateFacet,
  createAmbientFacet,
  createStreamRewriteFacet,
  updateStateFacets,  // Convenience for nested state updates
  // VEIL operation factories
  addFacet,
  removeFacet,
  rewriteFacet,
  wrapFacetsAsDeltas,  // Helper for receptor migration
  changeState,  // @deprecated - alias for rewriteFacet
  updateState,  // @deprecated - alias for rewriteFacet
  changeFacet   // @deprecated - alias for rewriteFacet
} from './helpers/factories';

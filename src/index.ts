// VEIL exports
export * from './veil/types';
export { VEILStateManager } from './veil/veil-state';

// Memory System exports
export * from './memory/types';
export { PassthroughMemory } from './memory/passthrough-memory';
export { NarrativeMemory } from './memory/narrative-memory';

// Compression exports (legacy - to be migrated)
export * from './compression/types';
export { PassthroughCompressionEngine } from './compression/passthrough-engine';
export { ChronologicalCompressionEngine } from './compression/chronological-engine';
export { FloatingAmbientEngine } from './compression/floating-ambient-engine';

// HUD exports
export * from './hud/types';
export { XmlHUD } from './hud/xml-hud';
export { TurnBasedXmlHUD } from './hud/turn-based-xml-hud';
export { SaliencyAwareHUD } from './hud/saliency-aware-hud';

// Agent Loop exports
export * from './agent-loop/types';
export { AgentLoop } from './agent-loop/agent-loop';

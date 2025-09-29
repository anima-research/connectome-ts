// VEIL (Virtual Environment Interface Language) Type Definitions

// FacetType is now just a string - no restrictions!
export type FacetType = string;

export interface SaliencyHints {
  // Temporal hints
  transient?: number;  // Decay rate: 0.0 (permanent) to 1.0 (very transient)
  
  // Semantic hints  
  streams?: string[];  // Which streams this is relevant to
  crossStream?: boolean;  // Relevant across all streams
  
  // Importance hints (relative, not absolute)
  pinned?: boolean;  // User or system marked as important
  reference?: boolean;  // This is reference material (like docs)
  
  // Graph relationships
  linkedTo?: string[];  // This facet is linked to these facets
  linkedFrom?: string[];  // These facets link to this one (system-managed)
}

// Import all facet types and aspects from the new file
export * from './facet-types';

// Legacy fields that aren't part of the clean aspect model
interface LegacyFacetFields {
  displayName?: string;
  attributes?: Record<string, any>;
  scope?: string[];
  children?: any[];
  saliency?: SaliencyHints;
}

// Temporarily augment facets with legacy fields during migration
import { BaseFacet as CleanBaseFacet } from './facet-types';
declare module './facet-types' {
  interface BaseFacet extends LegacyFacetFields {}
}

// Legacy type aliases - to be removed
export type ToolFacet = CleanBaseFacet & { type: 'action-definition' };
export type DefineActionFacet = CleanBaseFacet & { type: 'action-definition' };

// Import Facet type separately to avoid circular dependency
import type { Facet } from './facet-types';

// Import VEILDelta from facet-types
import { VEILDelta } from './facet-types';

// VEILOperation is now an alias for VEILDelta
export type VEILOperation = VEILDelta;

// Stream information
export interface StreamInfo {
  id: string;  // e.g., "discord:general"
  name?: string;  // Human-readable name/description
  metadata?: Record<string, any>;  // Any additional context if needed
}

// Stream reference with type information
export interface StreamRef {
  streamId: string;
  streamType: string;  // "discord", "terminal", "minecraft", etc.
  metadata?: Record<string, any>;  // Adapter-specific metadata
}

// Agent information
export interface AgentInfo {
  id: string;  // Unique agent identifier
  name: string;  // Human-readable name
  type?: string;  // e.g., "assistant", "action-definition", "system"
  capabilities?: string[];  // What the agent can do
  metadata?: Record<string, any>;  // Additional agent-specific data
  createdAt: string;  // When the agent joined
  lastActiveAt?: string;  // Last activity timestamp
}

// Import SpaceEvent for frame events
import type { SpaceEvent } from '../spaces/types';

// VEIL Frames - NOW UNIFIED!
export interface Frame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef;
  events: SpaceEvent[];    // Events processed in this frame
  deltas: VEILDelta[];     // Exotemporal changes
  transition: FrameTransition;
}


// Legacy frame interface for migration
export interface LegacyFrame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef;
  deltas: VEILOperation[];
  transition: FrameTransition;
}

export interface FrameTransition {
  sequence: number;
  timestamp: string;
  elementOps: any[];
  componentOps: any[];
  componentChanges: any[];
  veilOps: VEILOperation[];  // Updated to use deltas
  extensions?: Record<string, any>;
}

export function createDefaultTransition(sequence: number, timestamp: string): FrameTransition {
  return {
    sequence,
    timestamp,
    elementOps: [],
    componentOps: [],
    componentChanges: [],
    veilOps: [],
    extensions: {}
  };
}

// Frame types are now unified - no more incoming/outgoing distinction
// Turn attribution is determined by frame.events, not frame type

export type OutgoingVEILOperation = VEILOperation;

// VEIL State
export interface VEILState {
  facets: Map<string, Facet>;
  scopes: Set<string>;
  streams: Map<string, StreamInfo>;  // Active streams
  agents: Map<string, AgentInfo>;  // Active agents
  currentStream?: StreamRef;  // Currently active stream
  currentAgent?: string;  // Currently processing agent
  frameHistory: Frame[];
  currentSequence: number;
  removals: Map<string, 'hide' | 'delete'>;  // Tracks removed facets
}

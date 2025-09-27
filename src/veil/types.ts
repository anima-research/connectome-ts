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

// NEW FACET SYSTEM WITH ASPECTS!
export interface Facet {
  id: string;
  type: string; // Free-form type for organization
  
  // Core Aspects (pick what you need)
  content?: string;                    // Text content
  state?: Record<string, any>;         // State data
  temporal?: 'ephemeral' | 'persistent' | 'session'; // Lifetime
  visibility?: 'agent' | 'system' | 'debug';   // Who can see it
  renderable?: boolean;                // Should it be shown to agents?
  
  // Legacy fields (for compatibility during migration)
  displayName?: string;
  attributes?: Record<string, any>;
  scope?: string[];
  children?: Facet[];
  saliency?: SaliencyHints;
}

// Legacy - to be removed
export interface BaseFacet extends Facet {}

// LEGACY INTERFACES - Commented out during migration
// export interface EventFacet extends BaseFacet {
//   type: 'event';
// }

// export interface StateFacet extends BaseFacet {
//   type: 'state';
//   attributeRenderers?: Record<string, (value: any, oldValue?: any) => string | null>;
//   transitionRenderers?: Record<string, (value: any, oldValue?: any) => string | null>;
// }

// Type aliases for migration
export type EventFacet = Facet & { type: 'event' };
export type StateFacet = Facet & { type: 'state' };

export type AmbientFacet = Facet & { type: 'ambient' };

export type ToolFacet = Facet & { type: 'tool' };

export type SpeechFacet = Facet & { type: 'speech' };

export type ThoughtFacet = Facet & { type: 'thought' };

export type ActionFacet = Facet & { type: 'action' };

export type DefineActionFacet = Facet & { type: 'defineAction' };

export type AgentActivationFacet = Facet & { type: 'agentActivation' };

// Facet is now the base interface defined above
// All specific facet types are just type aliases with type constraints

// VEIL Operations
export interface AddFacetOperation {
  type: 'addFacet';
  facet: Facet;
}

export interface ChangeStateOperation {
  type: 'changeState';
  facetId: string;
  updates: {
    content?: string;
    attributes?: Record<string, any>;
  };
  updateMode?: 'full' | 'attributesOnly';  // Default is 'full' for backward compatibility
}

export interface AddScopeOperation {
  type: 'addScope';
  scope: string;
}

export interface DeleteScopeOperation {
  type: 'deleteScope';
  scope: string;
}

// Note: AgentActivationOperation has been replaced with AgentActivationFacet

export interface AddStreamOperation {
  type: 'addStream';
  stream: StreamInfo;
}

export interface UpdateStreamOperation {
  type: 'updateStream';
  streamId: string;
  updates: Partial<Omit<StreamInfo, 'id'>>;
}

export interface DeleteStreamOperation {
  type: 'deleteStream';
  streamId: string;
}

export interface RemoveFacetOperation {
  type: 'removeFacet';
  facetId: string;
  mode: 'hide' | 'delete';
}

export interface ChangeFacetOperation {
  type: 'changeFacet';
  facetId: string;
  updates: {
    content?: string;
    attributes?: Record<string, any>;
  };
}

export interface AddAgentOperation {
  type: 'addAgent';
  agent: AgentInfo;
}

export interface RemoveAgentOperation {
  type: 'removeAgent';
  agentId: string;
  reason?: string;  // Why the agent was removed
}

export interface UpdateAgentOperation {
  type: 'updateAgent';
  agentId: string;
  updates: Partial<Omit<AgentInfo, 'id'>>;
}

export type VEILOperation = 
  | AddFacetOperation 
  | ChangeStateOperation 
  | AddScopeOperation 
  | DeleteScopeOperation 
  | AddStreamOperation
  | UpdateStreamOperation
  | DeleteStreamOperation
  | RemoveFacetOperation
  | ChangeFacetOperation
  | AddAgentOperation
  | RemoveAgentOperation
  | UpdateAgentOperation;

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
  type?: string;  // e.g., "assistant", "tool", "system"
  capabilities?: string[];  // What the agent can do
  metadata?: Record<string, any>;  // Additional agent-specific data
  createdAt: string;  // When the agent joined
  lastActiveAt?: string;  // Last activity timestamp
}

// VEIL Frames - NOW UNIFIED!
export interface Frame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef;
  operations: VEILOperation[];
  transition: FrameTransition; // Always present!
}

export interface FrameTransition {
  sequence: number;
  timestamp: string;
  elementOps: any[];
  componentOps: any[];
  componentChanges: any[];
  veilOps: VEILOperation[];
  extensions?: Record<string, any>;
}

// Legacy aliases - DELETE THESE ONCE MIGRATION COMPLETE
export type IncomingVEILFrame = Frame;
export type OutgoingVEILFrame = Frame;
export type OutgoingVEILOperation = VEILOperation;

// VEIL State
export interface VEILState {
  facets: Map<string, Facet>;
  scopes: Set<string>;
  streams: Map<string, StreamInfo>;  // Active streams
  agents: Map<string, AgentInfo>;  // Active agents
  currentStream?: StreamRef;  // Currently active stream
  currentAgent?: string;  // Currently processing agent
  frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[];
  currentSequence: number;
  removals: Map<string, 'hide' | 'delete'>;  // Tracks removed facets
}

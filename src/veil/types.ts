// VEIL (Virtual Environment Interface Language) Type Definitions

export type FacetType = 'event' | 'state' | 'ambient' | 'tool' | 'speech' | 'thought' | 'action' | 'defineAction' | 'agentActivation';

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

export interface BaseFacet {
  id: string;
  type: FacetType;
  displayName?: string;
  content?: string;
  attributes?: Record<string, any>;
  scope?: string[];
  children?: Facet[];
  saliency?: SaliencyHints;
}

export interface EventFacet extends BaseFacet {
  type: 'event';
}

export interface StateFacet extends BaseFacet {
  type: 'state';
  // Optional functions to render individual attribute changes
  attributeRenderers?: Record<string, (value: any, oldValue?: any) => string | null>;
  // Optional functions to render state transitions as narrative events
  transitionRenderers?: Record<string, (value: any, oldValue?: any) => string | null>;
}

export interface AmbientFacet extends BaseFacet {
  type: 'ambient';
  scope: string[]; // Required for ambient
}

export interface ToolFacet extends BaseFacet {
  type: 'tool';
  definition: {
    name: string;
    parameters: string[];
    callback: string;
  };
}

export interface SpeechFacet extends BaseFacet {
  type: 'speech';
  content: string;  // Required for speech
  attributes?: {
    target?: string;  // Which stream/channel this was said to
    agentGenerated: boolean;
    agentId?: string;  // Which agent created this
    agentName?: string;  // For display purposes
    conversationId?: string;  // For threading
    inReplyTo?: string;  // For conversation flow
  };
}

export interface ThoughtFacet extends BaseFacet {
  type: 'thought';
  content: string;  // Required for thoughts
  scope?: string[];  // Usually includes 'agent-internal'
  attributes?: {
    agentGenerated: boolean;
    agentId?: string;  // Which agent created this
    agentName?: string;  // For display purposes
    private?: boolean;
  };
}

export interface ActionFacet extends BaseFacet {
  type: 'action';
  displayName: string;  // The tool name
  content?: string;  // JSON stringified parameters
  attributes: {
    agentGenerated: boolean;
    agentId?: string;  // Which agent created this
    agentName?: string;  // For display purposes
    toolName: string;
    parameters: Record<string, any>;
  };
}

export interface DefineActionFacet extends BaseFacet {
  type: 'defineAction';
  displayName: string;  // The tool name
  content?: string;  // Description of the action
  attributes: {
    agentGenerated: boolean;
    toolName: string;
    parameters: Record<string, any>;
  };
}

export interface AgentActivationFacet extends BaseFacet {
  type: 'agentActivation';
  content?: string;  // Reason for activation
  attributes: {
    source: string;      // Who requested activation
    sourceAgentId?: string;  // ID of agent that triggered activation
    sourceAgentName?: string; // Name of agent that triggered activation
    priority: 'low' | 'normal' | 'high';
    reason: string;      // Why activation was requested
    targetAgent?: string; // Optional specific agent name (legacy)
    targetAgentId?: string; // Optional specific agent ID (preferred)
    config?: {
      temperature?: number;
      maxTokens?: number;
      [key: string]: any;
    };
  };
}

export type Facet = EventFacet | StateFacet | AmbientFacet | ToolFacet | SpeechFacet | ThoughtFacet | ActionFacet | DefineActionFacet | AgentActivationFacet;

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

// VEIL Frames
export interface IncomingVEILFrame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef; // Active stream reference with metadata
  operations: VEILOperation[];
  transition?: FrameTransition; // Mutable transition object for persistence
}

// Import at usage site to avoid circular dependencies
export interface FrameTransition {
  sequence: number;
  timestamp: string;
  elementOps: any[];
  componentOps: any[];
  componentChanges: any[];
  veilOps: VEILOperation[];
  extensions?: Record<string, any>;
}

// Agent-specific operations (these create facets internally)
export interface SpeakOperation {
  type: 'speak';
  content: string;
  target?: string; // Optional explicit target, overrides focus
  targets?: string[]; // Optional multiple targets for broadcasting
}

export interface ThinkOperation {
  type: 'think';
  content: string;
}

export interface ActOperation {
  type: 'act';
  toolName: string;
  parameters: Record<string, any>;
  target?: string; // Optional target element
}

export type OutgoingVEILOperation = 
  | SpeakOperation
  | ThinkOperation
  | ActOperation;

export interface OutgoingVEILFrame {
  sequence: number;
  timestamp: string;
  uuid?: string;
  activeStream?: StreamRef;
  operations: OutgoingVEILOperation[];
}

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

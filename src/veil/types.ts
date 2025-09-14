// VEIL (Virtual Environment Interface Language) Type Definitions

export type FacetType = 'event' | 'state' | 'ambient' | 'tool' | 'speech' | 'thought' | 'action';

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
  };
}

export interface ThoughtFacet extends BaseFacet {
  type: 'thought';
  content: string;  // Required for thoughts
  scope?: string[];  // Usually includes 'agent-internal'
  attributes?: {
    agentGenerated: boolean;
    private?: boolean;
  };
}

export interface ActionFacet extends BaseFacet {
  type: 'action';
  displayName: string;  // The tool name
  content?: string;  // JSON stringified parameters
  attributes: {
    agentGenerated: boolean;
    toolName: string;
    parameters: Record<string, any>;
  };
}

export type Facet = EventFacet | StateFacet | AmbientFacet | ToolFacet | SpeechFacet | ThoughtFacet | ActionFacet;

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

export interface AgentActivationOperation {
  type: 'agentActivation';
  priority?: 'low' | 'normal' | 'high';  // How urgently agent attention is needed
  source?: string;  // Which element/adapter requested activation
  reason?: string;  // Why activation was requested
  config?: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
  };
}

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

export type VEILOperation = 
  | AddFacetOperation 
  | ChangeStateOperation 
  | AddScopeOperation 
  | DeleteScopeOperation 
  | AgentActivationOperation
  | AddStreamOperation
  | UpdateStreamOperation
  | DeleteStreamOperation;

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

// VEIL Frames
export interface IncomingVEILFrame {
  sequence: number;
  timestamp: string;
  activeStream?: StreamRef; // Active stream reference with metadata
  operations: VEILOperation[];
}

export interface ToolCallOperation {
  type: 'toolCall';
  toolName: string;
  parameters: Record<string, any>;
}

export interface CycleRequestOperation {
  type: 'cycleRequest';
  reason?: string;
  delayMs?: number;
}

export interface InnerThoughtsOperation {
  type: 'innerThoughts';
  content: string;
}

export interface SpeakOperation {
  type: 'speak';
  content: string;
  target?: string; // Optional explicit target, overrides focus
  targets?: string[]; // Optional multiple targets for broadcasting
}

export interface ActionOperation {
  type: 'action';
  path: string[];        // Full path (e.g., ['chat', 'general', 'say'])
  parameters?: Record<string, any>;  // Named parameters
  rawSyntax?: string;    // Original @element.method syntax for reference
}

export type OutgoingVEILOperation = 
  | ToolCallOperation 
  | ActionOperation
  | CycleRequestOperation 
  | InnerThoughtsOperation
  | SpeakOperation;

export interface OutgoingVEILFrame {
  sequence: number;
  timestamp: string;
  operations: OutgoingVEILOperation[];
}

// VEIL State
export interface VEILState {
  facets: Map<string, Facet>;
  scopes: Set<string>;
  streams: Map<string, StreamInfo>;  // Active streams
  currentStream?: StreamRef;  // Currently active stream
  frameHistory: (IncomingVEILFrame | OutgoingVEILFrame)[];
  currentSequence: number;
}

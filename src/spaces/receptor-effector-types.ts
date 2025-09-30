// MARTEM Types - Modulator/Afferent/Receptor/Transform/Effector/Maintainer architecture

import { 
  Facet, 
  Frame,
  StreamRef,
  AgentInfo,
  hasEphemeralAspect,
  VEILDelta
} from '../veil/types';
import { createEventFacet } from '../helpers/factories';
import { SpaceEvent } from './types';
import { Component } from '../types/component';

/**
 * Modulator: Phase 0 - Preprocesses events before they reach receptors
 * Can filter, aggregate, batch, deduplicate, or transform the event queue
 */
export interface Modulator extends Component {
  /** Process events before they reach receptors */
  process(events: SpaceEvent[]): SpaceEvent[];
  
  /** Optional reset method for stateful modulators */
  reset?(): void;
}

/**
 * Afferent: Async external system listener
 * Bridges external systems (Discord, WebSockets, etc.) to Connectome events
 * Managed by effectors, runs asynchronously
 */
export interface Afferent<TConfig = any, TCommand = any> extends Component {
  /** Initialize with configuration and context */
  initialize(context: AfferentContext<TConfig>): Promise<void>;
  
  /** Start listening/processing */
  start(): Promise<void>;
  
  /** Stop listening/processing */
  stop(graceful?: boolean): Promise<void>;
  
  /** Handle commands from effectors */
  enqueueCommand(command: TCommand): void;
  
  /** Get current status */
  getStatus(): AfferentStatus;
  
  /** Get metrics */
  getMetrics?(): AfferentMetrics;
}

/**
 * Context provided to afferents for event emission and configuration
 */
export interface AfferentContext<TConfig> {
  /** Emit events to the main loop */
  emit: (event: SpaceEvent) => void;
  
  /** Emit error events */
  emitError: (error: AfferentError) => void;
  
  /** Configuration from VEIL facet */
  config: Readonly<TConfig>;
  
  /** Afferent ID */
  afferentId: string;
}

/**
 * Afferent status information
 */
export interface AfferentStatus {
  state: 'initializing' | 'running' | 'stopping' | 'stopped' | 'error';
  lastActivity: number;
  errorCount: number;
  lastError?: string;
}

/**
 * Afferent metrics
 */
export interface AfferentMetrics {
  eventsEmitted: number;
  commandsProcessed: number;
  uptime: number;
  memoryUsage?: number;
}

/**
 * Afferent error structure
 */
export interface AfferentError {
  afferentId: string;
  afferentType: string;
  errorType: 'connection' | 'timeout' | 'processing' | 'fatal' | 'config';
  message: string;
  stack?: string;
  recoverable: boolean;
  details?: Record<string, any>;
}

/**
 * Receptor: Phase 1 - Converts events into facets
 * MUST be stateless - same input always produces same output
 */
export interface Receptor extends Component {
  /** Which event topics this receptor handles */
  topics: string[];
  
  /** Transform an event into facets */
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[];
}

/**
 * Transform: Phase 2 - Transforms VEIL state
 * Used for derived state, cleanup, indexes, etc.
 * Can add, change, or remove facets - just like Receptors
 */
export interface Transform extends Component {
  /** Optional filters to limit which facets trigger this transform */
  facetFilters?: FacetFilter[];
  
  /** Process current state to produce VEIL operations */
  process(state: ReadonlyVEILState): VEILDelta[];
}

/**
 * Effector: Phase 3 - Reacts to facet changes
 * Can emit events, perform side effects, or manage external connections
 */
export interface Effector extends Component {
  /** Which facet types/patterns this effector watches */
  facetFilters?: FacetFilter[];
  
  /** React to facet changes */
  process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult>;
}

/**
 * Result of effector processing
 */
export interface EffectorResult {
  events?: SpaceEvent[];
  externalActions?: ExternalAction[];
}

/**
 * External action performed by effector
 */
export interface ExternalAction {
  type: string;
  description: string;
  // Action-specific data
  [key: string]: any;
}

/**
 * Filter for which facets an effector is interested in
 */
export interface FacetFilter {
  type?: string | string[];
  aspectMatch?: Partial<{
    temporal: 'ephemeral' | 'persistent' | 'session';
    visibility: 'agent' | 'system' | 'debug';
    renderable: boolean;
  }>;
  attributeMatch?: Record<string, any>;
}

/**
 * Delta describing a facet change
 */
export interface FacetDelta {
  type: 'added' | 'changed' | 'removed';
  facet: Facet;
  oldFacet?: Facet; // For 'changed' type
}

/**
 * Read-only view of VEIL state
 */
export interface ReadonlyVEILState {
  facets: ReadonlyMap<string, Facet>;
  scopes: ReadonlySet<string>;
  streams: ReadonlyMap<string, any>;
  agents: ReadonlyMap<string, AgentInfo>;
  currentStream?: StreamRef;
  currentAgent?: string;
  frameHistory: ReadonlyArray<Frame>;
  currentSequence: number;
  removals: ReadonlyMap<string, 'hide' | 'delete'>;
  
  // Helper methods
  getFacetsByType(type: string): Facet[];
  getFacetsByAspect(aspect: keyof Facet, value: any): Facet[];
  hasFacet(id: string): boolean;
}

// Ephemeral facets are not actively cleaned up - they naturally fade away
// by not being persisted and being ignored by systems that don't need them

/**
 * Result of maintainer processing
 */
export interface MaintainerResult {
  events?: SpaceEvent[];
  deltas?: VEILDelta[];
}

/**
 * Maintainer: Phase 4 - Handles maintenance operations
 * Runs after all other phases
 * Can modify VEIL for infrastructure concerns (element tree, component lifecycle, etc.)
 * Can emit events for next frame
 */
export interface Maintainer extends Component {
  /** 
   * Perform maintenance operations
   * @returns events for next frame and deltas to apply immediately
   */
  process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<MaintainerResult>;
}

// Re-export SpaceEvent for convenience
export { SpaceEvent };

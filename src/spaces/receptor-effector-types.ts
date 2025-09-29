// Receptor/Effector Types for the new architecture

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

/**
 * Pure function that transforms events into facets
 * MUST be stateless - same input always produces same output
 */
export interface Receptor {
  /** Which event topics this receptor handles */
  topics: string[];
  
  /** Transform an event into facets */
  transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[];
}

/**
 * Pure function that transforms VEIL state
 * Used for derived state, cleanup, indexes, etc.
 * Can add, change, or remove facets - just like Receptors
 */
export interface Transform {
  /** Process current state to produce VEIL operations */
  process(state: ReadonlyVEILState): VEILDelta[];
}

/**
 * Stateful component that reacts to facet changes
 * Can emit events, perform side effects, or manage external connections
 */
export interface Effector {
  /** Which facet types/patterns this effector watches */
  facetFilters: FacetFilter[];
  
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
 * Maintainer for Phase 4 - handles maintenance operations
 * Runs after all other phases, can emit events for next frame
 * Cannot modify VEIL directly, only emit events
 */
export interface Maintainer {
  /** Perform maintenance operations, return events for next frame */
  maintain(state: ReadonlyVEILState): SpaceEvent[];
}

// Re-export SpaceEvent for convenience
export { SpaceEvent };

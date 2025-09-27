// Receptor/Effector Types for the new architecture

import { Facet, VEILOperation } from '../veil/types';
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
 * Pure function that transforms VEIL state into new facets
 * Used for derived state, cleanup, indexes, etc.
 */
export interface Transform {
  /** Process current state to produce new facets */
  process(state: ReadonlyVEILState): Facet[];
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
  
  // Helper methods
  getFacetsByType(type: string): Facet[];
  getFacetsByAspect(aspect: keyof Facet, value: any): Facet[];
  hasFacet(id: string): boolean;
}

// Built-in Transform that runs first in Phase 2
export class EphemeralCleanupTransform implements Transform {
  process(state: ReadonlyVEILState): Facet[] {
    // Create system operation facets to remove ephemeral facets
    return Array.from(state.facets.values())
      .filter(f => f.temporal === 'ephemeral')
      .map(f => ({
        id: `cleanup-${f.id}-${Date.now()}`,
        type: 'system-operation',
        temporal: 'ephemeral' as const,
        content: `Remove ephemeral facet ${f.id}`,
        attributes: {
          operation: 'removeFacet',
          targetId: f.id
        }
      }));
  }
}

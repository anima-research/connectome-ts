/**
 * Adapters to help migrate existing components to Receptor/Effector model
 * TEMPORARY - Remove once migration is complete
 */

import { BaseReceptor, BaseEffector } from '../components/base-martem';
import { Component } from './component';
import { SpaceEvent } from './types';
import { Facet, VEILDelta } from '../veil/types';
import { createEventFacet } from '../helpers/factories';
import { 
  Receptor, 
  Effector, 
  ReadonlyVEILState, 
  FacetDelta, 
  EffectorResult,
  FacetFilter 
} from './receptor-effector-types';

/**
 * Adapter to use existing Components as Receptors
 */
export class ComponentToReceptorAdapter extends BaseReceptor {
  topics: string[];
  
  constructor(
    private component: Component,
    topics: string | string[]
  ) {
    super();
    this.topics = Array.isArray(topics) ? topics : [topics];
  }
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    // Capture operations by creating a fake frame
    const capturedOps: any[] = [];
    
    // Temporarily mock the component's element methods
    const originalElement = this.component.element;
    const mockElement = {
      ...originalElement,
      findSpace: () => ({
        getCurrentFrame: () => ({ deltas: capturedOps }),
        isProcessingFrame: true,
        addOperation: (op: any) => capturedOps.push(op)
      })
    };
    
    // Replace element temporarily
    (this.component as any).element = mockElement;
    
    try {
      // Let component handle the event
      this.component.handleEvent(event);
      
      // Return captured deltas directly
      return capturedOps;
        
    } finally {
      // Restore original element
      (this.component as any).element = originalElement;
    }
  }
}

/**
 * Adapter to use existing Components as Effectors
 */
export class ComponentToEffectorAdapter extends BaseEffector {
  facetFilters: FacetFilter[] = [];
  
  constructor(
    private component: Component,
    filters?: FacetFilter[]
  ) {
    super();
    if (filters) {
      this.facetFilters = filters;
    }
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    
    // Create synthetic events from facet changes
    for (const change of changes) {
      const syntheticEvent: SpaceEvent = {
        topic: `facet:${change.type}:${change.facet.type}`,
        source: { elementId: 'system', elementPath: [] },
        timestamp: Date.now(),
        payload: {
          facet: change.facet,
          oldFacet: change.oldFacet,
          changeType: change.type
        }
      };
      
      // Capture any events the component might emit
      const originalEmit = this.component.element.emit;
      (this.component.element as any).emit = (event: SpaceEvent) => {
        events.push(event);
      };
      
      try {
        // Let component process the synthetic event
        this.component.handleEvent(syntheticEvent);
      } finally {
        // Restore original emit
        (this.component.element as any).emit = originalEmit;
      }
    }
    
    return { events };
  }
}

/**
 * Helper to quickly migrate a component
 */
export function migrateComponent(
  component: Component,
  config: {
    receptorTopics?: string[];
    effectorFilters?: FacetFilter[];
  }
): { receptor?: Receptor; effector?: Effector } {
  const result: { receptor?: Receptor; effector?: Effector } = {};
  
  if (config.receptorTopics && config.receptorTopics.length > 0) {
    result.receptor = new ComponentToReceptorAdapter(component, config.receptorTopics);
  }
  
  if (config.effectorFilters) {
    result.effector = new ComponentToEffectorAdapter(component, config.effectorFilters);
  }
  
  return result;
}

/**
 * Built-in Receptor for VEIL operations (compatibility)
 * Processes veil:operation events and returns the delta directly
 */
export class VEILOperationReceptor extends BaseReceptor {
  topics = ['veil:operation'];
  
  transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
    const payload = event.payload as { operation: VEILDelta };
    const { operation } = payload;
    
    // Return the delta directly (supports all delta types now!)
    return [operation];
  }
}

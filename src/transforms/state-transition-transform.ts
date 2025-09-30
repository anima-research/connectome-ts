/**
 * StateTransitionTransform - Automatically generates event facets for state changes
 * 
 * This transform runs in Phase 2 and detects state changes, using renderers
 * attached to state facets to create human-readable event descriptions.
 */

import { BaseTransform } from '../components/base-martem';
import { Transform, ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { Facet, hasStateAspect, StateFacet, VEILDelta } from '../veil/types';
import { createEventFacet } from '../helpers/factories';

export class StateTransitionTransform extends BaseTransform {
  private previousStates = new Map<string, any>();
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Check all state facets for changes
    for (const [id, facet] of state.facets) {
      if (facet.type !== 'state' || !hasStateAspect(facet)) continue;
      
      const stateFacet = facet as StateFacet;
      const currentState = stateFacet.state;
      const previousState = this.previousStates.get(id);
      
      // Clone current state for next frame
      this.previousStates.set(id, JSON.parse(JSON.stringify(currentState)));
      
      // Skip if no previous state (first time seeing this facet)
      if (!previousState) continue;
      
      // Find what changed
      const changes = this.detectChanges(previousState, currentState);
      if (changes.length === 0) continue;
      
      // Skip if no renderers defined
      if (!stateFacet.transitionRenderers && !stateFacet.attributeRenderers) continue;
      
      // Generate transition events
      for (const change of changes) {
        const narrative = this.renderTransition(
          change.key,
          change.oldValue,
          change.newValue,
          stateFacet
        );
        
        if (narrative) {
          deltas.push({
            type: 'addFacet',
            facet: createEventFacet({
              content: narrative,
              source: 'state-transition',
              eventType: 'state-change',
              metadata: {
                entityType: stateFacet.entityType,
                entityId: stateFacet.entityId,
                changes: {
                  [change.key]: {
                    from: change.oldValue,
                    to: change.newValue
                  }
                }
              },
              streamId: 'system'
            })
          });
        }
      }
    }
    
    return deltas;
  }
  
  private detectChanges(oldState: any, newState: any): Array<{key: string, oldValue: any, newValue: any}> {
    const changes: Array<{key: string, oldValue: any, newValue: any}> = [];
    
    // Check all keys in new state
    for (const key in newState) {
      if (oldState[key] !== newState[key]) {
        changes.push({ key, oldValue: oldState[key], newValue: newState[key] });
      }
    }
    
    // Check for deleted keys
    for (const key in oldState) {
      if (!(key in newState)) {
        changes.push({ key, oldValue: oldState[key], newValue: undefined });
      }
    }
    
    return changes;
  }
  
  private renderTransition(
    key: string,
    oldValue: any,
    newValue: any,
    facet: StateFacet
  ): string | null {
    // Try transition renderer first
    if (facet.transitionRenderers?.[key]) {
      try {
        // Safely evaluate the renderer code
        const renderFunc = new Function('newValue', 'oldValue', facet.transitionRenderers[key]);
        const rendered = renderFunc(newValue, oldValue);
        if (rendered) return rendered;
      } catch (error) {
        console.error(`Error in transition renderer for ${facet.entityId}.${key}:`, error);
      }
    }
    
    // Fall back to attribute renderer with change indication
    if (facet.attributeRenderers?.[key]) {
      try {
        const renderFunc = new Function('value', facet.attributeRenderers[key]);
        const rendered = renderFunc(newValue);
        if (rendered) {
          return `${facet.content || facet.entityId} ${rendered}`;
        }
      } catch (error) {
        console.error(`Error in attribute renderer for ${facet.entityId}.${key}:`, error);
      }
    }
    
    // No custom renderer - could generate a generic message
    // return `${facet.entityId}: ${key} changed from ${oldValue} to ${newValue}`;
    return null;
  }
}

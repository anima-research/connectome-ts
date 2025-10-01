/**
 * ContinuationTransform - Handles tag-based continuations
 * 
 * This transform watches for continuation:complete facets and triggers
 * subsequent actions based on matching continuation tags.
 */

import { Transform, ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { BaseTransform } from '../components/base-martem';
import { 
  Facet,
  ContinuationCompleteFacet,
  AgentActivationFacet,
  hasContentAspect
} from '../veil/facet-types';
import { VEILDelta } from '../veil/types';

export class ContinuationTransform extends BaseTransform implements Transform {
  
  facetFilters = undefined;  // Process all facets
  
  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    
    // Process continuation completions
    for (const [id, facet] of state.facets) {
      if (facet.type === 'continuation:complete') {
        const completion = facet as ContinuationCompleteFacet;
        const { success, result, error, continuations } = completion.state;
        
        // Process any explicit continuations
        if (continuations && continuations.length > 0) {
          for (const continuation of continuations) {
            // Check condition
            if (this.shouldExecuteContinuation(continuation, success)) {
              
              // Create the specified facet
              const newFacet = this.createFacetFromSpec(
                continuation.facetType,
                continuation.facetSpec,
                result,
                completion.state.continuationTag
              );
              
              deltas.push({
                type: 'addFacet',
                facet: newFacet
              });
            }
          }
          
          // Remove the continuation:complete facet so it's not processed again in Phase 2 loop
          deltas.push({
            type: 'removeFacet',
            id
          });
        }
      }
    }
    
    return deltas;
  }
  
  private shouldExecuteContinuation(continuation: any, success: boolean): boolean {
    const condition = continuation.condition || 'success';
    switch (condition) {
      case 'success': return success;
      case 'failure': return !success;
      case 'always': return true;
      default: return false;
    }
  }
  
  private createFacetFromSpec(
    facetType: string, 
    spec: any, 
    result: any,
    continuationTag: string
  ): Facet {
    // Deep clone the spec to avoid mutations
    const facetData = JSON.parse(JSON.stringify(spec));
    
    // Interpolate result values into the spec
    this.interpolateValues(facetData, result);
    
    // Ensure required fields
    facetData.id = facetData.id || `${facetType}:continuation:${Date.now()}`;
    facetData.type = facetType;
    
    // Add continuation tracking tag
    facetData.tags = facetData.tags || [];
    facetData.tags.push(`continuation-from:${continuationTag}`);
    
    return facetData as Facet;
  }
  
  private interpolateValues(obj: any, context: any): void {
    if (!context) return;
    
    for (const key in obj) {
      const value = obj[key];
      
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        // Simple template interpolation: {{result.fieldName}}
        const path = value.slice(2, -2).trim();
        const interpolated = this.getValueByPath(context, path);
        if (interpolated !== undefined) {
          obj[key] = interpolated;
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively interpolate nested objects
        this.interpolateValues(value, context);
      }
    }
  }
  
  private getValueByPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }
}

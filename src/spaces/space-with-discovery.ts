/**
 * Example integration of auto-discovery into Space
 * This shows how Space would be modified to support auto-discovery
 */

import { Space } from './space';
import { SpaceAutoDiscovery } from './space-auto-discovery';
import { 
  SpaceEvent, 
  Receptor, 
  Transform, 
  Effector, 
  Maintainer,
  VEILDelta,
  FacetDelta
} from './receptor-effector-types';

/**
 * Enhanced Space with auto-discovery
 * Maintains backwards compatibility with manual registration
 */
export class SpaceWithAutoDiscovery extends Space {
  private discovery = new SpaceAutoDiscovery();
  private useAutoDiscovery = true;
  
  // Cache discovered components for the current frame
  private discoveryCache?: {
    receptors: Map<string, Receptor[]>;
    transforms: Transform[];
    effectors: Effector[];
    maintainers: Maintainer[];
  };
  
  /**
   * Enable or disable auto-discovery
   * Useful for testing or performance-critical scenarios
   */
  setAutoDiscovery(enabled: boolean): void {
    this.useAutoDiscovery = enabled;
    this.clearDiscoveryCache();
  }
  
  /**
   * Clear the discovery cache
   * Called at the start of each frame
   */
  private clearDiscoveryCache(): void {
    this.discoveryCache = undefined;
  }
  
  /**
   * Get receptors through auto-discovery + manual registration
   */
  private getReceptors(): Map<string, Receptor[]> {
    if (!this.useAutoDiscovery) {
      return (this as any).receptors; // Use manual registrations only
    }
    
    // Use cached discovery if available
    if (this.discoveryCache?.receptors) {
      return this.discoveryCache.receptors;
    }
    
    // Discover receptors
    const discovered = this.discovery.discoverReceptors(this);
    
    // Merge with manually registered receptors
    const manualReceptors = (this as any).receptors as Map<string, Receptor[]>;
    for (const [topic, receptors] of manualReceptors) {
      const existing = discovered.get(topic) || [];
      // Add manual receptors that aren't already discovered
      for (const receptor of receptors) {
        if (!existing.includes(receptor)) {
          existing.push(receptor);
        }
      }
      discovered.set(topic, existing);
    }
    
    // Cache for this frame
    if (!this.discoveryCache) {
      this.discoveryCache = {
        receptors: discovered,
        transforms: [],
        effectors: [],
        maintainers: []
      };
    }
    this.discoveryCache.receptors = discovered;
    
    return discovered;
  }
  
  /**
   * Override runPhase1 to use auto-discovery
   */
  protected runPhase1(events: SpaceEvent[]): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const readonlyState = this.getReadonlyState();
    const receptors = this.getReceptors(); // Uses auto-discovery
    
    for (const event of events) {
      const topicReceptors = receptors.get(event.topic) || [];
      
      for (const receptor of topicReceptors) {
        try {
          const newDeltas = receptor.transform(event, readonlyState);
          deltas.push(...newDeltas);
        } catch (error) {
          console.error(`Receptor error for ${event.topic}:`, error);
          // Error handling...
        }
      }
    }
    
    return deltas;
  }
  
  /**
   * Get transforms through auto-discovery + manual registration
   */
  private getTransforms(): Transform[] {
    if (!this.useAutoDiscovery) {
      return (this as any).transforms;
    }
    
    if (this.discoveryCache?.transforms.length > 0) {
      return this.discoveryCache.transforms;
    }
    
    // Discover transforms
    const discovered = this.discovery.discoverTransforms(this);
    const manualTransforms = (this as any).transforms as Transform[];
    
    // Add manually registered transforms that aren't discovered
    for (const transform of manualTransforms) {
      if (!discovered.includes(transform)) {
        discovered.push(transform);
      }
    }
    
    // TODO: Re-sort to respect priorities when Transform.priority is added
    // discovered.sort((a, b) => {
    //   const aPriority = a.priority;
    //   const bPriority = b.priority;
    //   
    //   if (aPriority !== undefined && bPriority !== undefined) {
    //     return aPriority - bPriority;
    //   }
    //   if (aPriority !== undefined) return -1;
    //   if (bPriority !== undefined) return 1;
    //   return 0;
    // });
    
    if (this.discoveryCache) {
      this.discoveryCache.transforms = discovered;
    }
    
    return discovered;
  }
  
  /**
   * Override runPhase2 to use auto-discovery
   */
  protected runPhase2(): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const readonlyState = this.getReadonlyState();
    const transforms = this.getTransforms(); // Uses auto-discovery
    
    for (const transform of transforms) {
      try {
        const newDeltas = transform.process(readonlyState);
        deltas.push(...newDeltas);
      } catch (error) {
        console.error('Transform error:', error);
        // Error handling...
      }
    }
    
    return deltas;
  }
  
  /**
   * Similar overrides for Phase 3 and 4...
   */
  
  /**
   * Override processFrame to clear cache at start
   */
  async processFrame(events: SpaceEvent[]): Promise<void> {
    // Clear discovery cache for new frame
    this.clearDiscoveryCache();
    
    // Log discovery stats in debug mode
    if (process.env.DEBUG_DISCOVERY) {
      const stats = this.discovery.getDiscoveryStats(this);
      console.log('[Discovery]', stats);
    }
    
    // Continue with normal processing
    return super.processFrame(events);
  }
}

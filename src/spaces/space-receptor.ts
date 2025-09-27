/**
 * New Space implementation with Receptor/Effector architecture
 * THIS WILL REPLACE space.ts once migration is complete
 */

import { Element } from './element';
import { VEILStateManager } from '../veil/veil-state';
import { SpaceEvent } from './types';
import { EventPriorityQueue } from './priority-queue';
import { Frame, Facet, VEILOperation, AgentInfo, createDefaultTransition } from '../veil/types';
import { 
  Receptor, 
  Transform, 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState,
  EphemeralCleanupTransform,
  EffectorResult
} from './receptor-effector-types';

export class Space extends Element {
  private eventQueue = new EventPriorityQueue();
  private veilState: VEILStateManager;
  private hostRegistry: Map<string, any>;
  
  // New registries
  private receptors: Map<string, Receptor[]> = new Map();
  private transforms: Transform[] = [new EphemeralCleanupTransform()];
  private effectors: Effector[] = [];
  
  private processingFrame = false;
  private frameSequence = 0;
  
  constructor(veilState: VEILStateManager, hostRegistry?: Map<string, any>) {
    super('root');
    this.veilState = veilState;
    this.hostRegistry = hostRegistry || new Map();
  }
  
  // Registration methods
  
  addReceptor(receptor: Receptor): void {
    for (const topic of receptor.topics) {
      const topicReceptors = this.receptors.get(topic) || [];
      topicReceptors.push(receptor);
      this.receptors.set(topic, topicReceptors);
    }
  }
  
  addTransform(transform: Transform): void {
    this.transforms.push(transform);
  }
  
  addEffector(effector: Effector): void {
    this.effectors.push(effector);
  }
  
  // Event management
  
  queueEvent(event: SpaceEvent): void {
    this.eventQueue.push(event);
    if (!this.processingFrame) {
      setImmediate(() => this.processFrame());
    }
  }
  
  emit(event: SpaceEvent): void {
    this.queueEvent(event);
  }
  
  // THREE-PHASE FRAME PROCESSING
  
  private async processFrame(): Promise<void> {
    if (this.processingFrame) return;
    this.processingFrame = true;
    
    const frameId = ++this.frameSequence;
    const timestamp = new Date().toISOString();
    
    try {
      // Drain event queue
      const events: SpaceEvent[] = [];
      while (!this.eventQueue.isEmpty()) {
        const event = this.eventQueue.shift();
        if (event) events.push(event);
      }
      
      // PHASE 1: Events → VEIL (via Receptors)
      const phase1Facets = this.runPhase1(events);
      
      // PHASE 2: VEIL → VEIL (via Transforms)  
      const phase2Facets = this.runPhase2();
      
      // Combine all facets and create operations
      const allFacets = [...phase1Facets, ...phase2Facets];
      const operations: VEILOperation[] = allFacets.map(facet => ({
        type: 'addFacet' as const,
        facet
      }));
      
      // Apply operations to VEIL
      const transition = createDefaultTransition(frameId, timestamp);
      transition.veilOps = operations;

      const frame: Frame = {
        sequence: frameId,
        timestamp,
        operations,
        transition
      };
      
      const changes = this.veilState.applyFrame(frame);
      
      // PHASE 3: VEIL → Events (via Effectors)
      const newEvents = await this.runPhase3(changes);
      
      // Queue events for next frame
      newEvents.forEach(event => this.queueEvent(event));
      
    } finally {
      // Check if more frames needed
      const hasMore = this.eventQueue.length > 0;
      this.processingFrame = false;
      
      if (hasMore) {
        setImmediate(() => this.processFrame());
      }
    }
  }
  
  // PHASE 1: Events → Facets
  private runPhase1(events: SpaceEvent[]): Facet[] {
    const facets: Facet[] = [];
    const readonlyState = this.getReadonlyState();
    
    for (const event of events) {
      const receptors = this.receptors.get(event.topic) || [];
      
      for (const receptor of receptors) {
        try {
          const newFacets = receptor.transform(event, readonlyState);
          facets.push(...newFacets);
        } catch (error) {
          console.error(`Receptor error for ${event.topic}:`, error);
          // Create error facet
          facets.push({
            id: `error-${Date.now()}-${Math.random()}`,
            type: 'system-error',
            temporal: 'ephemeral',
            visibility: 'debug',
            content: `Receptor error: ${error}`,
            attributes: {
              event: event.topic,
              error: String(error)
            }
          });
        }
      }
    }
    
    return facets;
  }
  
  // PHASE 2: VEIL → VEIL
  private runPhase2(): Facet[] {
    const facets: Facet[] = [];
    const readonlyState = this.getReadonlyState();
    
    for (const transform of this.transforms) {
      try {
        const newFacets = transform.process(readonlyState);
        facets.push(...newFacets);
      } catch (error) {
        console.error('Transform error:', error);
        // Create error facet
        facets.push({
          id: `error-${Date.now()}-${Math.random()}`,
          type: 'system-error',
          temporal: 'ephemeral',
          visibility: 'debug',
          content: `Transform error: ${error}`,
          attributes: {
            transform: transform.constructor.name,
            error: String(error)
          }
        });
      }
    }
    
    return facets;
  }
  
  // PHASE 3: VEIL changes → Events
  private async runPhase3(changes: FacetDelta[]): Promise<SpaceEvent[]> {
    const events: SpaceEvent[] = [];
    const readonlyState = this.getReadonlyState();
    
    for (const effector of this.effectors) {
      // Filter changes this effector cares about
      const relevantChanges = changes.filter(change => 
        this.matchesEffectorFilters(change.facet, effector.facetFilters)
      );
      
      if (relevantChanges.length === 0) continue;
      
      try {
        const result = await effector.process(relevantChanges, readonlyState);
        
        if (result.events) {
          events.push(...result.events);
        }
        
        if (result.externalActions) {
          // Log external actions for now
          for (const action of result.externalActions) {
            console.log(`External action: ${action.type} - ${action.description}`);
          }
        }
      } catch (error) {
        console.error('Effector error:', error);
        // Create error event
        events.push({
          topic: 'system:error',
          source: this.getRef(),
          timestamp: Date.now(),
          payload: {
            type: 'effector-error',
            effector: effector.constructor.name,
            error: String(error)
          }
        });
      }
    }
    
    return events;
  }
  
  // Helper to check if facet matches effector filters
  private matchesEffectorFilters(facet: Facet, filters: any[]): boolean {
    if (filters.length === 0) return true;
    
    return filters.some(filter => {
      // Check type
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        if (!types.includes(facet.type)) return false;
      }
      
      // Check aspects
      if (filter.aspectMatch) {
        for (const [aspect, value] of Object.entries(filter.aspectMatch)) {
          if ((facet as any)[aspect] !== value) return false;
        }
      }
      
      // Check attributes
      if (filter.attributeMatch) {
        if (!facet.attributes) return false;
        for (const [key, value] of Object.entries(filter.attributeMatch)) {
          if (facet.attributes[key] !== value) return false;
        }
      }
      
      return true;
    });
  }
  
  // Get read-only view of state
  private getReadonlyState(): ReadonlyVEILState {
    const state = this.veilState.getState();
    
    return {
      facets: state.facets as ReadonlyMap<string, Facet>,
      scopes: state.scopes as ReadonlySet<string>,
      streams: state.streams as ReadonlyMap<string, any>,
      agents: state.agents as ReadonlyMap<string, AgentInfo>,
      currentStream: state.currentStream,
      currentAgent: state.currentAgent,
      frameHistory: [...state.frameHistory],
      currentSequence: state.currentSequence,
      removals: new Map(state.removals),
      
      getFacetsByType: (type: string) => {
        return Array.from(state.facets.values()).filter(f => f.type === type);
      },
      
      getFacetsByAspect: (aspect: keyof Facet, value: any) => {
        return Array.from(state.facets.values()).filter(f => (f as any)[aspect] === value);
      },
      
      hasFacet: (id: string) => {
        return state.facets.has(id);
      }
    };
  }
}

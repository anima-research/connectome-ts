import { Element } from './element';
import { SpaceEvent, FrameStartEvent, FrameEndEvent, StreamRef, EventPhase, ElementRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame, OutgoingVEILFrame, Frame, Facet, VEILDelta, AgentInfo, createDefaultTransition } from '../veil/types';
import { matchesTopic } from './utils';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { EventPriorityQueue } from './priority-queue';
import { eventBubbles } from './event-utils';
import type { 
  DebugObserver,
  DebugFrameStartContext,
  DebugFrameCompleteContext,
  DebugEventContext,
  DebugOutgoingFrameContext,
  DebugRenderedContextInfo
} from '../debug/types';
import { DebugServer, DebugServerConfig } from '../debug/debug-server';
import { deterministicUUID } from '../utils/uuid';
import { performance } from 'perf_hooks';
import type { RenderedContext } from '../hud/types-v2';
import type { RenderedContextSnapshot } from '../persistence/types';
import { createEventFacet } from '../helpers/factories';
import { 
  Receptor, 
  Transform, 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState,
  EphemeralCleanupTransform,
  EffectorResult,
  FacetFilter
} from './receptor-effector-types';
import { VEILOperationReceptor } from './migration-adapters';

interface RenderedContextRecord {
  context: RenderedContext;
  agentId?: string;
  agentName?: string;
  streamRef?: StreamRef;
  recordedAt: string;
  frameUUID?: string;
}

/**
 * The root Space element that orchestrates the entire system
 */
export class Space extends Element {
  /**
   * Priority event queue for the current frame
   */
  private eventQueue: EventPriorityQueue = new EventPriorityQueue();
  
  /**
   * Reference to the host's registry (single source of truth)
   */
  private hostRegistry: Map<string, any>;
  
  /**
   * VEIL state manager
   */
  private veilState: VEILStateManager;
  
  /**
   * Current frame being processed
   */
  private currentFrame?: IncomingVEILFrame;
  
  /**
   * Active stream reference
   */
  private activeStream?: StreamRef;
  
  
  /**
   * Whether we're currently processing a frame
   */
  private processingFrame: boolean = false;
  
  /**
   * Tracer for observability
   */
  private tracer: TraceStorage | undefined;
  
  /**
   * Registered debug observers that mirror internal activity to external tooling
   */
  private debugObservers: DebugObserver[] = [];

  private debugServerInstance?: DebugServer;

  private renderedContextLog: Map<number, RenderedContextRecord> = new Map();
  
  // NEW: Receptor/Effector architecture
  private receptors: Map<string, Receptor[]> = new Map();
  private transforms: Transform[] = [new EphemeralCleanupTransform()];
  private effectors: Effector[] = [];
  
  constructor(veilState: VEILStateManager, hostRegistry?: Map<string, any>) {
    super('root');
    this.veilState = veilState;
    this.hostRegistry = hostRegistry || new Map(); // Fallback for tests
    this.tracer = getGlobalTracer();
    
    // Subscribe to agent frame events
    this.subscribe('agent:frame-ready');
    this.subscribe('agent:activate');
    
    // Subscribe to element lifecycle events for transition tracking
    this.subscribe('element:mount');
    this.subscribe('element:unmount');
    
    // Add built-in VEIL operation receptor for compatibility
    this.addReceptor(new VEILOperationReceptor());
  }
  
  // NEW: Receptor/Effector registration methods
  
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
  
  /**
   * Attach an external debug observer. Observers are notified about frame
   * lifecycle events and outgoing agent frames to feed the debug UI.
   */
  addDebugObserver(observer: DebugObserver): void {
    this.debugObservers.push(observer);
  }
  
  /**
   * Convenience helper for spinning up the embedded debug server.
   */
  enableDebugServer(config?: Partial<DebugServerConfig>): void {
    if (this.debugServerInstance) {
      return;
    }
    this.debugServerInstance = new DebugServer(this, config);
    this.debugServerInstance.start();
  }

  /**
   * Record the rendered context produced for an agent cycle so the debug UI
   * can display exactly what the LLM saw.
   */
  recordRenderedContext(
    frame: IncomingVEILFrame,
    context: RenderedContext,
    metadata: { agentId?: string; agentName?: string; streamRef?: StreamRef } = {}
  ): void {
    const record: RenderedContextRecord = {
      context,
      agentId: metadata.agentId,
      agentName: metadata.agentName,
      streamRef: metadata.streamRef || frame.activeStream,
      recordedAt: new Date().toISOString(),
      frameUUID: frame.uuid
    };

    this.renderedContextLog.set(frame.sequence, record);
    this.pruneRenderedContexts();

    this.notifyDebugRenderedContext({
      frameSequence: frame.sequence,
      frameUUID: frame.uuid,
      context,
      agentId: record.agentId,
      agentName: record.agentName,
      streamRef: record.streamRef
    });
  }

  getRenderedContextSnapshot(sequence: number): RenderedContextRecord | undefined {
    return this.renderedContextLog.get(sequence);
  }

  clearRenderedContext(sequence: number): void {
    this.renderedContextLog.delete(sequence);
  }

  pruneRenderedContexts(maxEntries: number = 200): void {
    if (this.renderedContextLog.size <= maxEntries) {
      return;
    }
    const sequences = Array.from(this.renderedContextLog.keys()).sort((a, b) => a - b);
    while (this.renderedContextLog.size > maxEntries && sequences.length) {
      const seq = sequences.shift();
      if (typeof seq === 'number') {
        this.renderedContextLog.delete(seq);
      }
    }
  }

  replayRenderedContextFromSnapshot(snapshot: RenderedContextSnapshot): void {
    const record: RenderedContextRecord = {
      context: snapshot.context,
      agentId: snapshot.agentId,
      agentName: snapshot.agentName,
      streamRef: snapshot.streamRef,
      recordedAt: snapshot.recordedAt,
      frameUUID: snapshot.frameUUID
    };
    this.renderedContextLog.set(snapshot.sequence, record);
    this.notifyDebugRenderedContext({
      frameSequence: snapshot.sequence,
      frameUUID: snapshot.frameUUID,
      context: snapshot.context,
      agentId: snapshot.agentId,
      agentName: snapshot.agentName,
      streamRef: snapshot.streamRef
    });
  }

  
  /**
   * Get the current active stream
   */
  getActiveStream(): StreamRef | undefined {
    return this.activeStream;
  }
  
  /**
   * Get the current frame (for components to add operations)
   */
  getCurrentFrame(): IncomingVEILFrame | undefined {
    return this.currentFrame;
  }
  
  /**
   * Queue an event for processing
   */
  queueEvent(event: SpaceEvent): void {
    this.eventQueue.push(event);
    
    this.tracer?.record({
      id: `evt-${Date.now()}`,
      timestamp: Date.now(),
      level: 'debug',
      category: TraceCategory.EVENT_QUEUE,
      component: 'Space',
      operation: 'queueEvent',
      data: {
        topic: event.topic,
        source: event.source.elementId,
        priority: event.priority || 'normal',
        queueLength: this.eventQueue.length,
        queueState: this.eventQueue.getDebugInfo()
      }
    });
    
    // If not processing, start a frame
    if (!this.processingFrame) {
      // Use setImmediate or similar to process on next tick
      setImmediate(() => this.processFrame());
    }
  }
  
  /**
   * Override emit to handle events at the space level
   */
  emit(event: SpaceEvent): void {
    this.queueEvent(event);
  }
  
  /**
   * Process one frame - NEW THREE-PHASE IMPLEMENTATION
   */
  private async processFrame(): Promise<void> {
    if (this.processingFrame) return;
    this.processingFrame = true;
    
    const frameId = this.veilState.getNextSequence();
    const frameStartClock = performance.now();
    const frameSpan = this.tracer?.startSpan('processFrame', 'Space');
    const timestamp = new Date().toISOString();

    try {
      // Create frame structure
      const frame: Frame = {
        sequence: frameId,
        timestamp,
        uuid: deterministicUUID(`frame-${frameId}`),
        events: [],  // Will be populated with processed events
        deltas: [],
        transition: createDefaultTransition(frameId, timestamp)
      };
      
      // Keep currentFrame for compatibility
      this.currentFrame = frame as IncomingVEILFrame;
      this.notifyDebugFrameStart(this.currentFrame, {
        queuedEvents: this.eventQueue.length
      });
      
      // Drain event queue
      const events: SpaceEvent[] = [];
      while (!this.eventQueue.isEmpty()) {
        const event = this.eventQueue.shift();
        if (event) {
          events.push(event);
        }
      }
      
      // Record events in frame
      frame.events = events;
      
      // PHASE 1: Events → VEIL (via Receptors)
      const phase1Facets = this.runPhase1(events);
      
      // Apply Phase 1 facets to state first
      const phase1Frame: Frame = {
        sequence: frameId,
        timestamp,
        events: [],
        deltas: phase1Facets.map(facet => ({
          type: 'addFacet' as const,
          facet
        })),
        transition: createDefaultTransition(frameId, timestamp)
      };
      const phase1Changes = this.veilState.applyFrame(phase1Frame);
      
      // PHASE 2: VEIL → VEIL (via Transforms) - loop until no more facets
      const allPhase2Facets: Facet[] = [];
      let iteration = 0;
      const maxIterations = 10; // Prevent infinite loops
      
      while (iteration < maxIterations) {
        const phase2Facets = this.runPhase2();
        
        if (phase2Facets.length === 0) {
          // No more facets generated, we're done
          break;
        }
        
        // Apply these facets to state so next iteration can see them
        const phase2Sequence = this.veilState.getNextSequence();
        const phase2Frame: Frame = {
          sequence: phase2Sequence,
          timestamp,
          events: [],
          deltas: phase2Facets.map(facet => ({
            type: 'addFacet' as const,
            facet
          })),
          transition: createDefaultTransition(phase2Sequence, timestamp)
        };
        this.veilState.applyFrame(phase2Frame);
        
        allPhase2Facets.push(...phase2Facets);
        iteration++;
      }
      
      if (iteration === maxIterations) {
        console.warn(`Phase 2 hit max iterations (${maxIterations}), possible infinite loop in transforms`);
      }
      
      // Collect all operations for the complete frame
      const allFacets = [...phase1Facets, ...allPhase2Facets];
      frame.deltas = allFacets.map(facet => ({
        type: 'addFacet' as const,
        facet
      }));
      
      // Also support legacy distributeEvent for components not yet migrated
      for (const event of events) {
        await this.distributeEvent(event);
        if (this.currentFrame) {
          this.notifyDebugFrameEvent(this.currentFrame, event, {
            phase: event.eventPhase ?? EventPhase.NONE,
            targetId: event.target?.elementId
          });
        }
      }
      
      // Update currentFrame operations with all operations (including legacy)
      this.currentFrame.deltas = [...this.currentFrame.deltas, ...frame.deltas];
      
      // Check if frame has content
      const hasOperations = this.currentFrame.deltas.length > 0;
      const hasActivation = this.currentFrame.deltas.some(
        op => op.type === 'addFacet' && (op as any).facet?.type === 'agent-activation'
      );
      
      // Update transition with all operations
      if (frame.transition) {
        frame.transition.veilOps = [...this.currentFrame.deltas];
      }
      
      // Collect all changes from both phases
      const allChanges = [...phase1Changes];
      if (allPhase2Facets.length > 0) {
        const phase2Changes: FacetDelta[] = allPhase2Facets.map(facet => ({
          type: 'added' as const,
          facet
        }));
        allChanges.push(...phase2Changes);
      }
      
      // PHASE 3: VEIL → Events (via Effectors)
      const newEvents = await this.runPhase3(allChanges);
      
      // Queue new events for next frame
      newEvents.forEach(event => this.queueEvent(event));
      
      // Notify debug observers
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: events.length
        });
        
      // Emit frame:end for compatibility
      await this.distributeEvent({
        topic: 'frame:end',
        source: this.getRef(),
        payload: { 
          frameId, 
          hasOperations, 
          hasActivation,
          transition: frame.transition 
        },
        timestamp: Date.now()
      } as FrameEndEvent);
      
    } finally {
      this.currentFrame = undefined;
      
      if (frameSpan) {
        this.tracer?.endSpan(frameSpan.id);
      }
      
      // Process next frame if events are queued
      // IMPORTANT: Check queue before setting processingFrame to false
      // to prevent race conditions with queueEvent
      const hasMore = this.eventQueue.length > 0;
      this.processingFrame = false;
      
      if (hasMore) {
        setImmediate(() => this.processFrame());
      }
    }
  }
  
  // NEW: Three-phase processing methods
  
  /**
   * PHASE 1: Events → Facets
   */
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
          facets.push(
            createEventFacet({
              id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              content: `Receptor error: ${String(error)}`,
              source: 'space',
              eventType: 'receptor-error',
              metadata: {
                event: event.topic,
                error: String(error)
              },
              streamId: 'system',
              streamType: 'system'
            })
          );
        }
      }
    }
    
    return facets;
  }
  
  /**
   * PHASE 2: VEIL → VEIL
   */
  private runPhase2(): Facet[] {
    const facets: Facet[] = [];
    const readonlyState = this.getReadonlyState();
    
    for (const transform of this.transforms) {
      try {
        const newFacets = transform.process(readonlyState);
        facets.push(...newFacets);
      } catch (error) {
        console.error('Transform error:', error);
        facets.push(
          createEventFacet({
            id: `error-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            content: `Transform error: ${String(error)}`,
            source: 'space',
            eventType: 'transform-error',
            metadata: {
              transform: transform.constructor.name,
              error: String(error)
            },
            streamId: 'system',
            streamType: 'system'
          })
        );
      }
    }
    
    return facets;
  }
  
  /**
   * PHASE 3: VEIL changes → Events
   */
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
        
        // External actions can be surfaced through tracing or debug observers
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
  
  /**
   * Helper to check if facet matches effector filters
   */
  private matchesEffectorFilters(facet: Facet, filters: FacetFilter[]): boolean {
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
  
  /**
   * Get read-only view of state
   */
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
  
  /**
   * Distribute an event through the element tree
   */
  private async distributeEvent(event: SpaceEvent): Promise<void> {
    // For broadcast-style events (like agent:response), distribute to all subscribers
    if (this.isBroadcastEvent(event)) {
      await this.broadcastEvent(event);
      return;
    }
    
    // Otherwise use three-phase propagation
    await this.propagateEvent(event);
  }
  
  /**
   * Check if an event should be broadcast to all subscribers
   */
  private isBroadcastEvent(event: SpaceEvent): boolean {
    // Default to broadcast unless explicitly set to false
    if ('broadcast' in event) {
      return event.broadcast !== false;
    }
    
    // All events broadcast by default
    return true;
  }
  
  /**
   * Broadcast an event to all subscribed elements
   */
  private async broadcastEvent(event: SpaceEvent): Promise<void> {
    await this.broadcastToElement(this, event);
  }
  
  /**
   * Recursively broadcast to element and children
   */
  private async broadcastToElement(element: Element, event: SpaceEvent): Promise<void> {
    if (!element.active) return;
    
    if (element.isSubscribedTo(event.topic)) {
      await element.handleEvent(event);
    }
    
    // Broadcast to all children
    for (const child of element.children) {
      await this.broadcastToElement(child, event);
    }
  }
  
  /**
   * Use three-phase propagation for an event
   */
  private async propagateEvent(event: SpaceEvent): Promise<void> {
    // Find the target element based on the event source
    const targetElement = this.findElementByRef(event.source);
    if (!targetElement) {
      console.warn(`Target element not found for event: ${event.topic}`, event.source);
      return;
    }
    
    // Set the target
    event.target = targetElement.getRef();
    
    // Build the propagation path from root to target
    const path: Element[] = [];
    let current: Element | null = targetElement;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    
    // Phase 1: Capturing phase (root to target)
    event.eventPhase = EventPhase.CAPTURING_PHASE;
    for (let i = 0; i < path.length - 1; i++) {
      const element = path[i];
      if (!element.active) continue;
      
      if (element.isSubscribedTo(event.topic)) {
        await element.handleEvent(event);
        
        if (event.propagationStopped) {
          return;
        }
      }
    }
    
    // Phase 2: At target
    event.eventPhase = EventPhase.AT_TARGET;
    if (targetElement.active && targetElement.isSubscribedTo(event.topic)) {
      await targetElement.handleEvent(event);
      
      if (event.propagationStopped) {
        return;
      }
    }
    
    // Phase 3: Bubbling phase (target to root)
    if (eventBubbles(event)) {
      event.eventPhase = EventPhase.BUBBLING_PHASE;
      for (let i = path.length - 2; i >= 0; i--) {
        const element = path[i];
        if (!element.active) continue;
        
        if (element.isSubscribedTo(event.topic)) {
          await element.handleEvent(event);
          
          if (event.propagationStopped) {
            return;
          }
        }
      }
    }
    
    // Reset phase
    event.eventPhase = EventPhase.NONE;
  }
  
  /**
   * Find an element by its reference
   */
  private findElementByRef(ref: ElementRef): Element | null {
    return this.findElementByIdInTree(this, ref.elementId);
  }
  
  /**
   * Recursively find element by ID in the tree
   */
  private findElementByIdInTree(root: Element, id: string): Element | null {
    if (root.id === id) return root;
    
    for (const child of root.children) {
      const found = this.findElementByIdInTree(child, id);
      if (found) return found;
    }
    
    return null;
  }
  
  
  /**
   * Get the VEIL state manager
   */
  getVEILState(): VEILStateManager {
    return this.veilState;
  }
  
  /**
   * Register a reference for dependency injection
   * Delegates to the host registry (single source of truth)
   */
  registerReference(id: string, value: any): void {
    this.hostRegistry.set(id, value);
  }
  
  /**
   * Get a reference by ID
   * Delegates to the host registry (single source of truth)
   */
  getReference(id: string): any {
    return this.hostRegistry.get(id);
  }
  
  /**
   * List all available references (for debugging)
   */
  listReferences(): string[] {
    return Array.from(this.hostRegistry.keys());
  }

  private notifyDebugFrameStart(frame: IncomingVEILFrame, context: DebugFrameStartContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameStart?.(frame, context);
    }
  }

  private notifyDebugFrameEvent(frame: IncomingVEILFrame, event: SpaceEvent, context: DebugEventContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameEvent?.(frame, event, context);
    }
  }

  private notifyDebugFrameComplete(frame: IncomingVEILFrame, context: DebugFrameCompleteContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameComplete?.(frame, context);
    }
  }

  private notifyDebugOutgoingFrame(frame: OutgoingVEILFrame, context: DebugOutgoingFrameContext): void {
    for (const observer of this.debugObservers) {
      observer.onOutgoingFrame?.(frame, context);
    }
  }

  private notifyDebugRenderedContext(info: DebugRenderedContextInfo): void {
    for (const observer of this.debugObservers) {
      observer.onRenderedContext?.(info);
    }
  }
  
  /**
   * Activate the agent with specified stream configuration
   * Eliminates the need for manual ActivationHandler components
   */
  activateAgent(
    streamId: string, 
    options: {
      source?: string;
      reason?: string;
      priority?: 'low' | 'normal' | 'high';
      streamType?: string;
      metadata?: Record<string, any>;
    } = {}
  ): void {
    // Queue an event that will trigger activation in the next frame
    this.emit({
      topic: 'agent:activate',
      source: this.getRef(),
      payload: {
        streamId,
        ...options
      },
      timestamp: Date.now()
    });
    
    // Subscribe to agent:activate if not already subscribed
    if (!this.isSubscribedTo('agent:activate')) {
      this.subscribe('agent:activate');
    }
  }
  
  /**
   * Handle agent activation internally
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Handle agent:activate events
    if (event.topic === 'agent:activate' && this.currentFrame) {
      const payload = event.payload as any;
      
      // Add activation facet
      this.currentFrame.deltas.push({
        type: 'addFacet',
        facet: {
          id: `agent-activation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'agent-activation',
          content: payload.reason || 'Agent activation requested',
          attributes: {
        source: payload.source || 'system',
            sourceAgentId: payload.sourceAgentId,
            sourceAgentName: payload.sourceAgentName,
        reason: payload.reason || 'requested',
            priority: payload.priority || 'normal',
            targetAgent: payload.targetAgent,
            targetAgentId: payload.targetAgentId,
            config: payload.config
          }
        }
      } as any);
      
      // Set active stream for response routing
      if (!payload.streamId) {
        console.warn('[Space] agent:activate event missing streamId - using console:default as fallback. Agent responses may not route correctly.');
      }
      const streamId = payload.streamId || 'console:default';
      this.currentFrame.activeStream = {
        streamId: streamId,
        streamType: payload.streamType || streamId.split(':')[0],
        metadata: payload.metadata || {}
      };
    }
    
    // Handle agent:frame-ready events
    if (event.topic === 'agent:frame-ready') {
      const { frame: agentFrame, agentId, agentName, renderedContext, rawCompletion } = event.payload as any;
      
      // Clone the frame to avoid mutating the agent's original
      const nextSequence = this.veilState.getNextSequence();
      const frame: OutgoingVEILFrame = {
        ...agentFrame,
        deltas: [...agentFrame.deltas],
        sequence: nextSequence,
        timestamp: agentFrame.timestamp || new Date().toISOString(),
        activeStream: agentFrame.activeStream || this.activeStream,
        uuid: deterministicUUID(`outgoing-${nextSequence}`)
      };

      // Attach raw completion to outgoing frame for debug purposes
      if (rawCompletion) {
        (frame as any).renderedContext = rawCompletion;
      }

      // Record the frame with agent information
      this.veilState.recordOutgoingFrame(frame, { agentId, agentName });
      this.notifyDebugOutgoingFrame(frame, { agentId, agentName });
      
      // If rendered context was provided, record it for the current frame (incoming frame)
      if (renderedContext && this.currentFrame) {
        this.recordRenderedContext(this.currentFrame, renderedContext, {
          agentId,
          agentName,
          streamRef: frame.activeStream
        });
      }
      
      // LEGACY: Process operations - will be handled by effectors
      // For now, just process regular VEIL operations
      for (const op of frame.deltas) {
        // Skip legacy operations that no longer exist
        if (['act', 'speak', 'think'].includes(op.type)) {
          console.warn(`Legacy operation type "${op.type}" - should be using addFacet instead`);
          continue;
        }
      }
    }
    
    // Track element operations in transition
    if (this.currentFrame?.transition) {
      if (event.topic === 'element:mount') {
        const { element } = event.payload as any;
        this.currentFrame.transition.elementOps.push({
          type: 'add-element',
          parentRef: event.source,
          element: {
            id: element.elementId,
            name: element.elementPath[element.elementPath.length - 1],
            type: element.elementType || 'Element'
          }
        });
      }
      
      if (event.topic === 'element:unmount') {
        const { element } = event.payload as any;
        this.currentFrame.transition.elementOps.push({
          type: 'remove-element',
          elementRef: element
        });
      }
    }
  }
  
  /**
   * Find element by path (helper for tool processing)
   */
  private findElementByPath(path: string[]): Element | null {
    if (path.length === 0) return this;
    
    let current: Element = this;
    for (const segment of path) {
      const child = current.children.find(c => c.name === segment || c.id === segment);
      if (!child) return null;
      current = child;
    }
    return current;
  }
}

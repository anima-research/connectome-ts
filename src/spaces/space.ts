import { Element } from './element';
import { SpaceEvent, FrameStartEvent, FrameEndEvent, StreamRef, ElementRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { Frame, Facet, VEILDelta, AgentInfo, createDefaultTransition } from '../veil/types';
import { matchesTopic } from './utils';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { EventPriorityQueue } from './priority-queue';
import type { 
  DebugObserver,
  DebugFrameStartContext,
  DebugFrameCompleteContext,
  DebugEventContext,
  DebugAgentFrameContext,
  DebugRenderedContextInfo
} from '../debug/types';
import { DebugServer, DebugServerConfig } from '../debug/debug-server';
import { deterministicUUID } from '../utils/uuid';
import { performance } from 'perf_hooks';
import type { RenderedContext } from '../hud/types-v2';
import type { RenderedContextSnapshot } from '../persistence/types';
import { createEventFacet } from '../helpers/factories';
import { 
  Modulator,
  Receptor, 
  Transform, 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState,
  EffectorResult,
  FacetFilter,
  Maintainer
} from './receptor-effector-types';
import { VEILOperationReceptor } from './migration-adapters';
import { SpaceAutoDiscovery } from './space-auto-discovery';
import { TransformConstraintSolver } from './constraint-solver';
import { 
  isReceptor, 
  isTransform, 
  isEffector, 
  isMaintainer,
  isModulator 
} from '../utils/retm-type-guards';

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
  private currentFrame?: Frame;
  
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
  
  /**
   * Frame completion observers (for persistence, etc)
   */
  private frameObservers: Array<(frame: Frame) => Promise<void>> = [];

  private debugServerInstance?: DebugServer;

  private renderedContextLog: Map<number, RenderedContextRecord> = new Map();
  
  // MARTEM architecture components
  private modulators: Modulator[] = [];
  private receptors: Map<string, Receptor[]> = new Map();
  private transforms: Transform[] = [];
  private effectors: Effector[] = [];
  private maintainers: Maintainer[] = [];
  
  // Auto-discovery
  private discovery = new SpaceAutoDiscovery();
  private useAutoDiscovery = true;  // Enabled by default
  private discoveryCache?: {
    receptors: Map<string, Receptor[]>;
    transforms: Transform[];
    effectors: Effector[];
    maintainers: Maintainer[];
  };
  
  constructor(veilState: VEILStateManager, hostRegistry?: Map<string, any>) {
    super('root');
    this.veilState = veilState;
    this.hostRegistry = hostRegistry || new Map(); // Fallback for tests
    this.tracer = getGlobalTracer();
    
    // Subscribe to agent activation events
    this.subscribe('agent:activate');
    
    // Add built-in VEIL operation receptor for compatibility
    this.addReceptor(new VEILOperationReceptor());
  }
  
  /**
   * Enable or disable auto-discovery of RETM components
   */
  setAutoDiscovery(enabled: boolean): void {
    this.useAutoDiscovery = enabled;
    this.discoveryCache = undefined;
  }
  
  /**
   * Discover RETM components in the element tree
   * Caches results per frame for performance
   */
  private getDiscoveredComponents(): {
    receptors: Map<string, Receptor[]>;
    transforms: Transform[];
    effectors: Effector[];
    maintainers: Maintainer[];
  } {
    if (!this.useAutoDiscovery) {
      return {
        receptors: new Map(),
        transforms: [],
        effectors: [],
        maintainers: []
      };
    }
    
    // Use cache if available
    if (this.discoveryCache) {
      return this.discoveryCache;
    }
    
    // Discover components
    const discovered = {
      receptors: this.discovery.discoverReceptors(this),
      transforms: this.discovery.discoverTransforms(this),
      effectors: this.discovery.discoverEffectors(this),
      maintainers: this.discovery.discoverMaintainers(this)
    };
    
    this.discoveryCache = discovered;
    return discovered;
  }
  
  /**
   * Clear discovery cache at start of frame
   */
  private clearDiscoveryCache(): void {
    this.discoveryCache = undefined;
  }
  
  // MARTEM registration methods
  
  addModulator(modulator: Modulator): void {
    this.modulators.push(modulator);
  }
  
  addReceptor(receptor: Receptor): void {
    for (const topic of receptor.topics) {
      const topicReceptors = this.receptors.get(topic) || [];
      topicReceptors.push(receptor);
      this.receptors.set(topic, topicReceptors);
    }
  }
  
  /**
   * Register a transform for Phase 2 processing.
   * 
   * EXECUTION ORDER:
   * 1. Transforms with explicit priority execute first (lower number = earlier)
   * 2. Transforms without priority execute in registration order
   * 
   * IMPORTANT: Order matters if transforms share mutable state!
   * Example: CompressionTransform should run before ContextTransform
   * 
   * TODO [constraint-solver]: Replace numeric priorities with declarative constraints
   * Future API:
   *   transform.provides = ['compressed-frames'];
   *   transform.requires = ['state-changes'];
   * Then use topological sort to determine execution order automatically.
   * See docs/transform-ordering.md for migration path.
   * 
   * @example
   * // Option 1: Use priority (explicit, recommended for critical ordering)
   * compressionTransform.priority = 10;
   * space.addTransform(compressionTransform);  // Runs first due to priority
   * space.addTransform(contextTransform);      // Runs after (no priority)
   * 
   * @example
   * // Option 2: Use registration order (simple, works for most cases)
   * space.addTransform(compressionTransform);  // Register first = runs first
   * space.addTransform(contextTransform);      // Register second = runs second
   * 
   * @param transform - The transform to register
   */
  /**
   * Register a transform for Phase 2 processing.
   * 
   * EXECUTION ORDER (Dual System):
   * 
   * 1. CONSTRAINT-BASED (Preferred):
   *    If ANY transform uses provides/requires, the constraint solver is activated.
   *    System performs topological sort based on declared dependencies.
   *    Catches missing providers and circular dependencies with helpful errors.
   * 
   * 2. PRIORITY-BASED (Backwards Compatible):
   *    If no constraints used, falls back to priority-based sorting.
   *    Lower priority number = runs earlier.
   *    Transforms without priority use registration order.
   * 
   * @example Constraint-based (recommended)
   * const snapshotTransform = new FrameSnapshotTransform();
   * // snapshotTransform.provides = ['frame-snapshots']
   * 
   * const compressionTransform = new CompressionTransform({ engine });
   * // compressionTransform.requires = ['frame-snapshots']
   * // compressionTransform.provides = ['compressed-frames']
   * 
   * space.addTransform(compressionTransform);  // Register in any order!
   * space.addTransform(snapshotTransform);     // Solver figures it out
   * // Result: snapshot → compression (automatic)
   * 
   * @example Priority-based (legacy)
   * const transformA = new MyTransform();
   * transformA.priority = 10;
   * space.addTransform(transformA);  // Runs first
   * 
   * @param transform - The transform to register
   * @throws Error if constraint validation fails (circular deps, missing providers)
   */
  addTransform(transform: Transform): void {
    this.transforms.push(transform);
    
    // Use constraint solver if any transform has constraints
    if (TransformConstraintSolver.hasConstraints(this.transforms)) {
      try {
        const solver = new TransformConstraintSolver();
        this.transforms = solver.solve(this.transforms);
        return;
      } catch (error) {
        // Re-throw with context
        throw new Error(`[Space] Transform registration failed: ${(error as Error).message}`);
      }
    }
    
    // Fallback: Priority-based sorting (backwards compatible)
    this.sortTransformsByPriority();
  }
  
  /**
   * Sort transforms by priority (backwards compatible behavior)
   */
  private sortTransformsByPriority(): void {
    this.transforms.sort((a, b) => {
      const aPriority = a.priority;
      const bPriority = b.priority;
      
      // Both have priority: sort by priority value
      if (aPriority !== undefined && bPriority !== undefined) {
        return aPriority - bPriority;
      }
      
      // Only a has priority: a comes first
      if (aPriority !== undefined) {
        return -1;
      }
      
      // Only b has priority: b comes first
      if (bPriority !== undefined) {
        return 1;
      }
      
      // Neither has priority: maintain registration order (stable sort)
      return 0;
    });
  }
  
  addEffector(effector: Effector): void {
    this.effectors.push(effector);
  }
  
  addMaintainer(maintainer: Maintainer): void {
    this.maintainers.push(maintainer);
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
    frame: Frame,
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
  getCurrentFrame(): Frame | undefined {
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
      this.currentFrame = frame;
      
      // Clear discovery cache at start of frame
      this.clearDiscoveryCache();
      
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
      
      // PHASE 0: Event preprocessing (via Modulators)
      const processedEvents = this.runPhase0(events);
      
      // Record processed events in frame
      frame.events = processedEvents;
      
      // PHASE 1: Events → VEIL (via Receptors)
      // Receptors return deltas directly (can add, rewrite, or remove facets)
      const phase1Deltas = this.runPhase1(processedEvents);
      const phase1Changes = this.veilState.applyDeltasDirect(phase1Deltas);
      
      // PHASE 2: VEIL → VEIL (via Transforms) - loop until no more deltas
      // Apply deltas directly to state (not creating intermediate frames)
      const allPhase2Deltas: VEILDelta[] = [];
      const allPhase2Changes: FacetDelta[] = [];
      let iteration = 0;
      const maxIterations = 100; // Prevent infinite loops
      let lastPhase2Deltas: VEILDelta[] = [];
      
      while (iteration < maxIterations) {
        const phase2Deltas = this.runPhase2();
        lastPhase2Deltas = phase2Deltas;
        
        if (phase2Deltas.length === 0) {
          // No more deltas generated, we're done
          break;
        }
        
        // Apply deltas directly to state (no frame creation, no listener notification)
        // This allows next iteration to see the changes immediately
        const phase2Changes = this.veilState.applyDeltasDirect(phase2Deltas);
        
        allPhase2Deltas.push(...phase2Deltas);
        allPhase2Changes.push(...phase2Changes);
        iteration++;
      }
      
      if (iteration === maxIterations) {
        throw new Error(`Phase 2 exceeded maximum iterations (${maxIterations}). Possible infinite loop in transforms. Last ${lastPhase2Deltas.length} deltas were of types: ${lastPhase2Deltas.map(d => d.type).join(', ')}`);
      }
      
      // Collect all deltas for the complete frame
      frame.deltas = [...phase1Deltas, ...allPhase2Deltas];
      
      // Update currentFrame with all deltas
      this.currentFrame.deltas = [...this.currentFrame.deltas, ...frame.deltas];
      
      // Finalize the frame: add to history, update sequence, notify listeners
      // State already has the changes from applyDeltasDirect calls
      this.veilState.finalizeFrame(frame, true); // Skip ephemeral cleanup for now
      
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
      const allChanges = [...phase1Changes, ...allPhase2Changes];
      
      // PHASE 3: VEIL → Events (via Effectors)
      const newEvents = await this.runPhase3(allChanges);
      
      // PHASE 4: Maintenance (Element tree, references, cleanup)
      const maintenanceResult = await this.runPhase4(this.currentFrame, allChanges);
      
      // Apply maintainer deltas immediately (for infrastructure like component-state facets)
      if (maintenanceResult.deltas && maintenanceResult.deltas.length > 0) {
        const maintenanceChanges = this.veilState.applyDeltasDirect(maintenanceResult.deltas);
        allChanges.push(...maintenanceChanges);
        frame.deltas.push(...maintenanceResult.deltas);
      }
      
      // Queue all new events for next frame
      [...newEvents, ...(maintenanceResult.events || [])].forEach(event => this.queueEvent(event));
      
      // Clean up ephemeral facets now that all phases are complete
      const ephemeralCleanup = this.veilState.cleanupEphemeralFacets();
      allChanges.push(...ephemeralCleanup);
      
      // Notify debug observers
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: events.length
        });
        
      
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
  
  // MARTEM processing phases
  
  /**
   * PHASE 0: Event preprocessing (Modulators)
   */
  private runPhase0(events: SpaceEvent[]): SpaceEvent[] {
    let processedEvents = events;
    
    // Run events through each modulator in sequence
    for (const modulator of this.modulators) {
      processedEvents = modulator.process(processedEvents);
    }
    
    return processedEvents;
  }
  
  /**
   * PHASE 1: Events → VEIL Deltas (Receptors)
   * Receptors can add facets, rewrite existing facets, or remove facets
   * Uses auto-discovery + manual registrations
   */
  private runPhase1(events: SpaceEvent[]): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const readonlyState = this.getReadonlyState();
    
    // Merge discovered + manual receptors
    const discovered = this.getDiscoveredComponents();
    const allReceptors = new Map(this.receptors);
    
    for (const [topic, discoveredList] of discovered.receptors) {
      const manual = allReceptors.get(topic) || [];
      allReceptors.set(topic, [...manual, ...discoveredList]);
    }
    
    for (const event of events) {
      const receptors = allReceptors.get(event.topic) || [];
      
      for (const receptor of receptors) {
        try {
          const newDeltas = receptor.transform(event, readonlyState);
          deltas.push(...newDeltas);
        } catch (error) {
          console.error(`Receptor error for ${event.topic}:`, error);
          deltas.push({
            type: 'addFacet',
            facet: createEventFacet({
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
          });
        }
      }
    }
    
    return deltas;
  }
  
  /**
   * PHASE 2: VEIL → VEIL
   * Uses auto-discovery + manual registrations
   */
  private runPhase2(): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const readonlyState = this.getReadonlyState();
    
    // Merge discovered + manual transforms
    const discovered = this.getDiscoveredComponents();
    const allTransforms = [...this.transforms, ...discovered.transforms];
    
    for (const transform of allTransforms) {
      try {
        const newDeltas = transform.process(readonlyState);
        deltas.push(...newDeltas);
      } catch (error) {
        console.error('Transform error:', error);
        deltas.push({
          type: 'addFacet',
          facet: createEventFacet({
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
        });
      }
    }
    
    return deltas;
  }
  
  /**
   * PHASE 3: VEIL changes → Events
   * Uses auto-discovery + manual registrations
   */
  private async runPhase3(changes: FacetDelta[]): Promise<SpaceEvent[]> {
    const events: SpaceEvent[] = [];
    const readonlyState = this.getReadonlyState();
    
    // Merge discovered + manual effectors
    const discovered = this.getDiscoveredComponents();
    const allEffectors = [...this.effectors, ...discovered.effectors];
    
    if (discovered.effectors.length > 0 && events.length === 0) {
      console.log(`[Phase3] Discovered ${discovered.effectors.length} effectors, ${allEffectors.length} total`);
    }
    
    for (const effector of allEffectors) {
      // Filter changes this effector cares about
      const relevantChanges = changes.filter(change => 
        this.matchesEffectorFilters(change.facet, effector.facetFilters || [])
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
   * PHASE 4: Maintenance
   * Maintainers can modify VEIL for infrastructure concerns
   * Uses auto-discovery + manual registrations
   */
  private async runPhase4(frame: Frame, changes: FacetDelta[]): Promise<{ events: SpaceEvent[]; deltas: VEILDelta[] }> {
    const events: SpaceEvent[] = [];
    const deltas: VEILDelta[] = [];
    const readonlyState = this.getReadonlyState();
    
    // Merge discovered + manual maintainers
    const discovered = this.getDiscoveredComponents();
    const allMaintainers = [...this.maintainers, ...discovered.maintainers];
    
    for (const maintainer of allMaintainers) {
      try {
        const result = await maintainer.process(frame, changes, readonlyState);
        
        // Collect events for next frame
        if (result.events) {
          events.push(...result.events);
        }
        
        // Collect deltas to apply in current frame
        if (result.deltas) {
          deltas.push(...result.deltas);
        }
      } catch (error) {
        console.error('Maintainer error:', error);
        // Create error event
        events.push({
          topic: 'system:error',
          source: this.getRef(),
          timestamp: Date.now(),
          payload: {
            type: 'maintainer-error',
            maintainer: maintainer.constructor.name,
            error: String(error)
          }
        });
      }
    }
    
    return { events, deltas };
  }
  
  /**
   * Apply component-state delta with scoped write validation
   * Called by Effectors/Maintainers during their phase to update their own state
   * 
   * @internal
   */
  _applyComponentStateDelta(delta: VEILDelta, componentId: string): void {
    // Validate this is a component-state facet update
    if (delta.type !== 'rewriteFacet' || !delta.id.startsWith('component-state:')) {
      throw new Error(`_applyComponentStateDelta can only be used for component-state facets`);
    }
    
    // Validate the component is modifying its own state
    const expectedId = `component-state:${componentId}`;
    if (delta.id !== expectedId) {
      throw new Error(
        `Component ${componentId} attempted to modify ${delta.id}. ` +
        `Components can only modify their own state (${expectedId})`
      );
    }
    
    // Apply the delta immediately
    const changes = this.veilState.applyDeltasDirect([delta]);
    
    // Add to current frame for history tracking
    if (this.currentFrame) {
      this.currentFrame.deltas.push(delta);
    }
    
    // Note: We don't add to allChanges here because this happens during Phase 3/4
    // after change tracking is done. The delta is in frame.deltas for persistence.
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

  private notifyDebugFrameStart(frame: Frame, context: DebugFrameStartContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameStart?.(frame, context);
    }
  }

  private notifyDebugFrameEvent(frame: Frame, event: SpaceEvent, context: DebugEventContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameEvent?.(frame, event, context);
    }
  }

  private notifyDebugFrameComplete(frame: Frame, context: DebugFrameCompleteContext): void {
    for (const observer of this.debugObservers) {
      observer.onFrameComplete?.(frame, context);
    }
  }

  private notifyDebugAgentFrame(frame: Frame, context: DebugAgentFrameContext): void {
    for (const observer of this.debugObservers) {
      observer.onAgentFrame?.(frame, context);
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
    
  }
  
  /**
   * Handle events by queueing them for frame processing
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Queue the event for processing
    this.queueEvent(event);
    
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

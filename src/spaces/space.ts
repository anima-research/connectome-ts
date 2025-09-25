import { Element } from './element';
import { SpaceEvent, FrameStartEvent, FrameEndEvent, StreamRef, EventPhase, ElementRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame, OutgoingVEILFrame } from '../veil/types';
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
   * Reference registry for dependency injection
   */
  private referenceRegistry = new Map<string, any>();
  
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
  
  constructor(veilState: VEILStateManager) {
    super('root');
    this.veilState = veilState;
    this.tracer = getGlobalTracer();
    
    // Subscribe to agent frame events
    this.subscribe('agent:frame-ready');
    this.subscribe('agent:activate');
    
    // Subscribe to element lifecycle events for transition tracking
    this.subscribe('element:mount');
    this.subscribe('element:unmount');
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
   * Process one frame
   */
  private async processFrame(): Promise<void> {
    if (this.processingFrame) return;
    this.processingFrame = true;
    
    const frameId = this.veilState.getNextSequence();
    const frameStartClock = performance.now();
    const frameSpan = this.tracer?.startSpan('processFrame', 'Space');

    try {
      // Start frame
      this.currentFrame = {
        sequence: frameId,
        timestamp: new Date().toISOString(),
        operations: [],
        transition: {
          sequence: frameId,
          timestamp: new Date().toISOString(),
          elementOps: [],
          componentOps: [],
          componentChanges: [],
          veilOps: [],  // Will be populated from operations at frame end
          extensions: {}
        }
      };
      this.currentFrame.uuid = deterministicUUID(`incoming-${frameId}`);
      this.notifyDebugFrameStart(this.currentFrame, {
        queuedEvents: this.eventQueue.length
      });
      
      this.tracer?.record({
        id: `frame-start-${frameId}`,
        timestamp: Date.now(),
        level: 'info',
        category: TraceCategory.FRAME_START,
        component: 'Space',
        operation: 'processFrame',
        data: {
          frameId,
          sequence: frameId,
          queuedEvents: this.eventQueue.length
        },
        parentId: frameSpan?.id
      });
      
      // Emit frame:start
      await this.distributeEvent({
        topic: 'frame:start',
        source: this.getRef(),
        payload: { frameId },
        timestamp: Date.now()
      } as FrameStartEvent);
      
      // Process all queued events in priority order
      const events: SpaceEvent[] = [];
      while (!this.eventQueue.isEmpty()) {
        const event = this.eventQueue.shift();
        if (event) events.push(event);
      }
      
      for (const event of events) {
        await this.distributeEvent(event);
        if (this.currentFrame) {
          this.notifyDebugFrameEvent(this.currentFrame, event, {
            phase: event.eventPhase ?? EventPhase.NONE,
            targetId: event.target?.elementId
          });
        }
      }
      
      // Check if frame has content
      const hasOperations = this.currentFrame.operations.length > 0;
      const hasActivation = this.currentFrame.operations.some(
        op => op.type === 'addFacet' && (op as any).facet?.type === 'agentActivation'
      );
      
      // Apply frame BEFORE emitting frame:end
      // This ensures sequence is updated before agents respond
      if (hasOperations || hasActivation) {
        this.tracer?.record({
          id: `frame-end-${frameId}`,
          timestamp: Date.now(),
          level: 'info',
          category: TraceCategory.FRAME_END,
          component: 'Space',
          operation: 'processFrame',
          data: {
            frameId,
            operations: this.currentFrame.operations.length,
            hasActivation,
            activeStream: this.currentFrame.activeStream?.streamId
          },
          parentId: frameSpan?.id
        });
        
        // Update active stream if provided
        if (this.currentFrame.activeStream) {
          this.activeStream = this.currentFrame.activeStream;
        }
        
        // Copy VEIL operations to transition before applying
        if (this.currentFrame.transition) {
          this.currentFrame.transition.veilOps = [...this.currentFrame.operations];
        }
        
        // Record the frame
        this.veilState.applyIncomingFrame(this.currentFrame);
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: events.length
        });
        
        // Agent processing is handled by AgentComponent(s) listening to frame:end
      } else {
        // Still record empty frames to maintain sequence continuity
        this.veilState.applyIncomingFrame(this.currentFrame);
        this.notifyDebugFrameComplete(this.currentFrame, {
          durationMs: performance.now() - frameStartClock,
          processedEvents: events.length
        });
        
        this.tracer?.record({
          id: `frame-empty-${frameId}`,
          timestamp: Date.now(),
          level: 'debug',
          category: TraceCategory.FRAME_END,
          component: 'Space',
          operation: 'processFrame',
          data: {
            frameId,
            message: 'Frame empty (no operations) but recorded for sequence continuity'
          },
          parentId: frameSpan?.id
        });
      }
      
      // Emit frame:end AFTER applying the frame
      await this.distributeEvent({
        topic: 'frame:end',
        source: this.getRef(),
        payload: { 
          frameId, 
          hasOperations, 
          hasActivation,
          transition: this.currentFrame?.transition 
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
   */
  registerReference(id: string, value: any): void {
    this.referenceRegistry.set(id, value);
  }
  
  /**
   * Get a reference by ID
   */
  getReference(id: string): any {
    return this.referenceRegistry.get(id);
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
      this.currentFrame.operations.push({
        type: 'addFacet',
        facet: {
          id: `agent-activation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'agentActivation',
          content: payload.reason || 'Agent activation requested',
          attributes: {
            source: payload.source || 'system',
            reason: payload.reason || 'requested',
            priority: payload.priority || 'normal',
            targetAgent: payload.targetAgent,
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
        operations: [...agentFrame.operations],
        sequence: nextSequence,
        timestamp: agentFrame.timestamp || new Date().toISOString(),
        activeStream: agentFrame.activeStream || this.activeStream,
        uuid: deterministicUUID(`outgoing-${nextSequence}`)
      };

      // Attach raw completion to outgoing frame for debug purposes
      if (rawCompletion) {
        (frame as any).renderedContext = rawCompletion;
      }

      // Record the frame
      this.veilState.recordOutgoingFrame(frame);
      this.notifyDebugOutgoingFrame(frame, { agentId, agentName });
      
      // If rendered context was provided, record it for the current frame (incoming frame)
      if (renderedContext && this.currentFrame) {
        this.recordRenderedContext(this.currentFrame, renderedContext, {
          agentId,
          agentName,
          streamRef: frame.activeStream
        });
      }
      
      // Process tool calls synchronously to avoid starting new frames
      for (const op of frame.operations) {
        if (op.type === 'act') {
          // Process action directly instead of emitting events
          // Extract element ID from toolName (e.g., 'dispenser.dispense' -> 'dispenser')
          const targetId = op.target || op.toolName.split('.')[0];
          const targetElement = targetId ? this.findElementByIdInTree(this, targetId) : null;
          if (targetElement) {
            // Extract action name from toolName
            const actionParts = op.toolName.split('.');
            const actionName = actionParts.slice(1).join('.');
            await targetElement.handleEvent({
              topic: 'element:action',
              source: this.getRef(),
              payload: {
                action: actionName,
                parameters: op.parameters
              },
              timestamp: Date.now()
            });
          }
        }
      }
      
      // Emit agent responses (these are broadcast and don't trigger new frames)
      for (const op of frame.operations) {
        if (op.type === 'speak') {
          await this.distributeEvent({
            topic: 'agent:response',
            source: this.getRef(),
            payload: {
              content: op.content,
              stream: frame.activeStream || this.activeStream,
              agentId,
              agentName
            },
            timestamp: Date.now()
          });
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

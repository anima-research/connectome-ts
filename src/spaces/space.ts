import { Element } from './element';
import { SpaceEvent, FrameStartEvent, FrameEndEvent, StreamRef, EventPhase, ElementRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame } from '../veil/types';
import { matchesTopic } from './utils';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { EventPriorityQueue } from './priority-queue';
import { eventBubbles } from './event-utils';

/**
 * The root Space element that orchestrates the entire system
 */
export class Space extends Element {
  /**
   * Priority event queue for the current frame
   */
  private eventQueue: EventPriorityQueue = new EventPriorityQueue();
  
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
  
  constructor(veilState: VEILStateManager) {
    super('root');
    this.veilState = veilState;
    this.tracer = getGlobalTracer();
    
    // Subscribe to agent frame events
    this.subscribe('agent:frame-ready');
    
    // Subscribe to element lifecycle events for transition tracking
    this.subscribe('element:mount');
    this.subscribe('element:unmount');
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
      }
      
      // Check if frame has content
      const hasOperations = this.currentFrame.operations.length > 0;
      const hasActivation = this.currentFrame.operations.some(
        op => op.type === 'agentActivation'
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
        
        // Agent processing is handled by AgentComponent(s) listening to frame:end
      } else {
        // Still record empty frames to maintain sequence continuity
        this.veilState.applyIncomingFrame(this.currentFrame);
        
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
        payload: { frameId, hasOperations, hasActivation },
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
    if (this.isBroadcastEvent(event.topic)) {
      await this.broadcastEvent(event);
      return;
    }
    
    // Otherwise use three-phase propagation
    await this.propagateEvent(event);
  }
  
  /**
   * Check if an event should be broadcast to all subscribers
   */
  private isBroadcastEvent(topic: string): boolean {
    // These events should reach all subscribers regardless of tree position
    const broadcastTopics = ['agent:response', 'agent:frame-ready', 'frame:start', 'frame:end', 'element:action'];
    return broadcastTopics.some(t => topic.startsWith(t));
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
      
      // Add activation operation
      this.currentFrame.operations.push({
        type: 'agentActivation',
        source: payload.source || 'system',
        reason: payload.reason || 'requested',
        priority: payload.priority || 'normal'
      } as any);
      
      // Set active stream for response routing
      this.currentFrame.activeStream = {
        streamId: payload.streamId,
        streamType: payload.streamType || payload.streamId.split(':')[0],
        metadata: payload.metadata || {}
      };
    }
    
    // Handle agent:frame-ready events
    if (event.topic === 'agent:frame-ready') {
      const { frame: agentFrame, agentId, agentName } = event.payload as any;
      
      // Clone the frame to avoid mutating the agent's original
      const frame = {
        ...agentFrame,
        operations: [...agentFrame.operations],
        sequence: this.veilState.getNextSequence()
      };
      
      // Record the frame
      this.veilState.recordOutgoingFrame(frame);
      
      // Process tool calls synchronously to avoid starting new frames
      for (const op of frame.operations) {
        if (op.type === 'action') {
          // Process action directly instead of emitting events
          const targetElement = this.findElementByIdInTree(this, op.elementId);
          if (targetElement) {
            await targetElement.handleEvent({
              topic: 'element:action',
              source: this.getRef(),
              payload: {
                path: [...op.path, op.action],
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

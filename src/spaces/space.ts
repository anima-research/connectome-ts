import { Element } from './element';
import { SpaceEvent, AgentInterface, FrameStartEvent, FrameEndEvent, StreamRef, EventPhase, ElementRef } from './types';
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
   * Agent interface (optional)
   */
  private agent?: AgentInterface;
  
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
  }
  
  /**
   * Set the agent interface
   */
  setAgent(agent: AgentInterface): void {
    this.agent = agent;
    // Auto-wire bidirectional connection if agent supports it
    if ('setSpace' in agent && typeof (agent as any).setSpace === 'function') {
      (agent as any).setSpace(this, this.id);
    }
  }
  
  /**
   * Get the current active stream
   */
  getActiveStream(): StreamRef | undefined {
    return this.activeStream;
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
        operations: []
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
      
      // Emit frame:end
      await this.distributeEvent({
        topic: 'frame:end',
        source: this.getRef(),
        payload: { frameId, hasOperations, hasActivation },
        timestamp: Date.now()
      } as FrameEndEvent);
      
      // Finalize frame
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
        
        // Record the frame
        this.veilState.applyIncomingFrame(this.currentFrame);
        
        // Let agent process if available
        if (this.agent) {
          const agentResponse = await this.agent.onFrameComplete(
            this.currentFrame,
            this.veilState.getState()
          );
          
          // If agent generated a response, emit events for routing
          if (agentResponse) {
            for (const op of agentResponse.operations) {
              if (op.type === 'speak') {
                const responseStream = this.currentFrame.activeStream || this.activeStream;
                await this.distributeEvent({
                  topic: 'agent:response',
                  source: this.getRef(),
                  payload: {
                    content: op.content,
                    stream: responseStream
                  },
                  timestamp: Date.now()
                });
              }
            }
          }
        }
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
      
    } finally {
      this.currentFrame = undefined;
      this.processingFrame = false;
      if (frameSpan) {
        this.tracer?.endSpan(frameSpan.id);
      }
      
      // Process next frame if events are queued
      if (this.eventQueue.length > 0) {
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
    const broadcastTopics = ['agent:response', 'frame:start', 'frame:end', 'element:action'];
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
   * Get the current VEIL frame being built
   */
  getCurrentFrame(): IncomingVEILFrame | undefined {
    return this.currentFrame;
  }
  
  /**
   * Get the VEIL state manager
   */
  getVEILState(): VEILStateManager {
    return this.veilState;
  }
}

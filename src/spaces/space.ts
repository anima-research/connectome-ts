import { Element } from './element';
import { SpaceEvent, AgentInterface, FrameStartEvent, FrameEndEvent, StreamRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame } from '../veil/types';
import { matchesTopic } from './utils';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { EventPriorityQueue } from './priority-queue';

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
    // Recursively distribute to all elements that are subscribed
    await this.distributeToElement(this, event);
  }
  
  /**
   * Recursively distribute event to an element and its children
   */
  private async distributeToElement(element: Element, event: SpaceEvent): Promise<void> {
    if (!element.active) return;
    
    // Check if element is subscribed
    if (element.isSubscribedTo(event.topic)) {
      await element.handleEvent(event);
    }
    
    // Distribute to children
    for (const child of element.children) {
      await this.distributeToElement(child, event);
    }
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

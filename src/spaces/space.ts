import { Element } from './element';
import { SpaceEvent, AgentInterface, FrameStartEvent, FrameEndEvent, StreamRef } from './types';
import { VEILStateManager } from '../veil/veil-state';
import { IncomingVEILFrame } from '../veil/types';
import { matchesTopic } from './utils';

/**
 * The root Space element that orchestrates the entire system
 */
export class Space extends Element {
  /**
   * Event queue for the current frame
   */
  private eventQueue: SpaceEvent[] = [];
  
  /**
   * VEIL state manager
   */
  private veilState: VEILStateManager;
  
  /**
   * Current frame being processed
   */
  private currentFrame?: IncomingVEILFrame;
  
  /**
   * Current frame ID
   */
  private frameCounter: number = 0;
  
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
  
  constructor(veilState: VEILStateManager) {
    super('root');
    this.veilState = veilState;
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
    
    const frameId = ++this.frameCounter;
    
    try {
      // Start frame
      this.currentFrame = {
        sequence: frameId,
        timestamp: new Date().toISOString(),
        operations: []
      };
      
      // Emit frame:start
      await this.distributeEvent({
        topic: 'frame:start',
        source: this.getRef(),
        payload: { frameId },
        timestamp: Date.now()
      } as FrameStartEvent);
      
      // Process all queued events
      const events = [...this.eventQueue];
      this.eventQueue = [];
      
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
        // Update active stream if provided
        if (this.currentFrame.activeStream) {
          this.activeStream = this.currentFrame.activeStream;
        }
        
        // Record the frame
        this.veilState.applyIncomingFrame(this.currentFrame);
        
        // Let agent process if available
        if (this.agent) {
          await this.agent.onFrameComplete(
            this.currentFrame,
            this.veilState.getState()
          );
        }
      }
      // If frame is empty, discard it
      
    } finally {
      this.currentFrame = undefined;
      this.processingFrame = false;
      
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

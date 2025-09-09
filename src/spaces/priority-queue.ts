import { SpaceEvent, EventPriority } from './types';

/**
 * Priority queue for events with support for immediate, high, normal, and low priorities.
 * Immediate priority events are never preempted and processed first.
 */
export class EventPriorityQueue {
  private immediate: SpaceEvent[] = [];
  private high: SpaceEvent[] = [];
  private normal: SpaceEvent[] = [];
  private low: SpaceEvent[] = [];
  
  /**
   * Add an event to the queue based on its priority
   */
  push(event: SpaceEvent): void {
    const priority = event.priority || 'normal';
    
    switch (priority) {
      case 'immediate':
        this.immediate.push(event);
        break;
      case 'high':
        this.high.push(event);
        break;
      case 'normal':
        this.normal.push(event);
        break;
      case 'low':
        this.low.push(event);
        break;
    }
  }
  
  /**
   * Get the next event from the queue (highest priority first)
   */
  shift(): SpaceEvent | undefined {
    // Immediate events always process first
    if (this.immediate.length > 0) {
      return this.immediate.shift();
    }
    
    // Then high priority
    if (this.high.length > 0) {
      return this.high.shift();
    }
    
    // Then normal priority
    if (this.normal.length > 0) {
      return this.normal.shift();
    }
    
    // Finally low priority
    if (this.low.length > 0) {
      return this.low.shift();
    }
    
    return undefined;
  }
  
  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.length === 0;
  }
  
  /**
   * Get total number of events in queue
   */
  get length(): number {
    return this.immediate.length + this.high.length + 
           this.normal.length + this.low.length;
  }
  
  /**
   * Get number of events by priority
   */
  getLengthByPriority(priority: EventPriority): number {
    switch (priority) {
      case 'immediate':
        return this.immediate.length;
      case 'high':
        return this.high.length;
      case 'normal':
        return this.normal.length;
      case 'low':
        return this.low.length;
    }
  }
  
  /**
   * Clear all events from the queue
   */
  clear(): void {
    this.immediate = [];
    this.high = [];
    this.normal = [];
    this.low = [];
  }
  
  /**
   * Get debug information about queue state
   */
  getDebugInfo(): Record<EventPriority, number> {
    return {
      immediate: this.immediate.length,
      high: this.high.length,
      normal: this.normal.length,
      low: this.low.length
    };
  }
}

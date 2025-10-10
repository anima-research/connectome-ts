/**
 * Base implementation for Afferent components
 * Provides command queue management and lifecycle hooks
 */

import { 
  Afferent, 
  AfferentContext, 
  AfferentStatus, 
  AfferentMetrics,
  AfferentError
} from '../spaces/receptor-effector-types';
import { SpaceEvent } from '../spaces/types';
import { Element } from '../spaces/element';
import { Component } from '../spaces/component';

/**
 * Async queue for command processing
 */
class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: ((item: T) => void)[] = [];
  
  enqueue(item: T): void {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(item);
    } else {
      this.items.push(item);
    }
  }
  
  async dequeue(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift()!;
    }
    
    // Wait for next item
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
  
  async flush(): Promise<void> {
    while (this.items.length > 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  clear(): void {
    this.items = [];
    // Reject waiting promises
    this.resolvers.forEach(resolve => resolve(null as any));
    this.resolvers = [];
  }
}

/**
 * Base implementation for Afferent components
 */
export abstract class BaseAfferent<TConfig = any, TCommand = any> 
  extends Component
  implements Afferent<TConfig, TCommand> {
  
  protected context!: AfferentContext<TConfig>;
  protected running = false;
  protected commandQueue: AsyncQueue<TCommand>;
  protected status: AfferentStatus;
  protected metrics: AfferentMetrics;
  
  constructor() {
    super();
    this.commandQueue = new AsyncQueue<TCommand>();
    this.status = {
      state: 'stopped',
      lastActivity: Date.now(),
      errorCount: 0
    };
    this.metrics = {
      eventsEmitted: 0,
      commandsProcessed: 0,
      uptime: 0,
      memoryUsage: 0
    };
  }
  
  // Afferent interface methods (required by Afferent<T>)
  
  async mount(element: Element): Promise<void> {
    this.element = element;
    // Initialize will be called separately by effector or onReferencesResolved
  }
  
  async unmount(): Promise<void> {
    await this.stop(true);
    // Note: element is marked with ! so we don't set it to undefined
  }
  
  // Override Component lifecycle methods
  
  async onMount(): Promise<void> {
    // No-op - mount() is called instead for afferents
  }
  
  async onUnmount(): Promise<void> {
    // No-op - unmount() is called instead for afferents
  }
  
  async onDestroy(): Promise<void> {
    await this.stop(false);
    this.commandQueue.clear();
    await this.onDestroyAfferent();
  }
  
  // Afferent lifecycle methods
  
  async initialize(context: AfferentContext<TConfig>): Promise<void> {
    this.context = context;
    this.status.state = 'initializing';
    
    try {
      await this.onInitialize();
      this.status.state = 'stopped';
    } catch (error) {
      this.handleError('fatal', 'Initialization failed', error);
      throw error;
    }
  }
  
  async start(): Promise<void> {
    if (this.running) return;
    
    this.running = true;
    this.status.state = 'running';
    const startTime = Date.now();
    
    // Start command processing loop
    this.processCommands().catch(err => 
      this.handleError('fatal', 'Command loop crashed', err)
    );
    
    // Start afferent-specific logic
    try {
      await this.onStart();
      
      // Update metrics
      this.metrics.uptime = Date.now() - startTime;
    } catch (error) {
      this.running = false;
      this.status.state = 'error';
      this.handleError('fatal', 'Start failed', error);
      throw error;
    }
  }
  
  async stop(graceful = true): Promise<void> {
    if (!this.running) return;
    
    this.status.state = 'stopping';
    this.running = false;
    
    if (graceful) {
      // Process remaining commands with timeout
      const timeout = new Promise(resolve => setTimeout(resolve, 5000));
      await Promise.race([this.commandQueue.flush(), timeout]);
    }
    
    try {
      await this.onStop();
    } catch (error) {
      this.handleError('processing', 'Error during stop', error);
    }
    
    this.status.state = 'stopped';
  }
  
  enqueueCommand(command: TCommand): void {
    if (!this.running && this.status.state !== 'initializing') {
      throw new Error(`Afferent is not running (state: ${this.status.state})`);
    }
    this.commandQueue.enqueue(command);
  }
  
  getStatus(): AfferentStatus {
    return { ...this.status };
  }
  
  getMetrics(): AfferentMetrics {
    return { 
      ...this.metrics,
      uptime: this.running ? Date.now() - (this.status.lastActivity - this.metrics.uptime) : this.metrics.uptime
    };
  }
  
  // Protected methods for subclasses
  
  protected abstract onInitialize(): Promise<void>;
  protected abstract onStart(): Promise<void>;
  protected abstract onStop(): Promise<void>;
  protected abstract onDestroyAfferent(): Promise<void>;
  protected abstract onCommand(command: TCommand): Promise<void>;
  
  // Helper methods
  
  protected emit(event: SpaceEvent): void {
    this.context.emit(event);
    this.metrics.eventsEmitted++;
    this.status.lastActivity = Date.now();
  }

  /**
   * Override emitFacet for afferents
   * Afferents can emit facets via events (will be queued for next frame)
   */
  protected emitFacet(facet: import('../veil/types').Facet): void {
    this.emit({
      topic: 'veil:operation',
      source: { elementId: this.element?.id || 'afferent', elementPath: [] },
      timestamp: Date.now(),
      payload: {
        operation: {
          type: 'addFacet',
          facet
        }
      }
    });
  }
  
  protected handleError(
    type: AfferentError['errorType'], 
    message: string, 
    error?: any
  ): void {
    this.status.errorCount++;
    this.status.lastError = message;
    
    if (type === 'fatal') {
      this.status.state = 'error';
    }
    
    this.context.emitError({
      afferentId: this.context.afferentId,
      afferentType: this.constructor.name,
      errorType: type,
      message,
      stack: error?.stack,
      recoverable: type !== 'fatal',
      details: error
    });
  }
  
  // Command processing loop
  private async processCommands(): Promise<void> {
    while (this.running) {
      try {
        const command = await this.commandQueue.dequeue();
        if (!this.running || command === null) break;
        
        await this.onCommand(command);
        this.metrics.commandsProcessed++;
        this.status.lastActivity = Date.now();
      } catch (error) {
        this.handleError('processing', 'Command processing failed', error);
        // Continue processing unless fatal
        if (this.status.state === 'error') break;
      }
    }
  }
}

import { ComponentLifecycle, EventHandler, SpaceEvent, ElementRef } from './types';
import type { Element } from './element';

/**
 * Base component class that can be attached to Elements
 * Similar to Unity's MonoBehaviour
 */
export abstract class Component implements ComponentLifecycle, EventHandler {
  /**
   * The element this component is attached to
   */
  element!: Element;
  
  /**
   * Whether this component is enabled
   */
  private _enabled: boolean = true;
  
  /**
   * Track if we've seen the first frame
   */
  private _firstFrameSeen: boolean = false;
  
  get enabled(): boolean {
    return this._enabled;
  }
  
  set enabled(value: boolean) {
    if (this._enabled === value) return;
    
    this._enabled = value;
    if (value) {
      this.onEnable?.();
    } else {
      this.onDisable?.();
    }
  }
  
  /**
   * Called when component is attached to an element
   */
  onMount(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is removed from an element
   */
  onUnmount(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is enabled
   */
  onEnable(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is disabled
   */
  onDisable(): void {
    // Override in subclasses
  }
  
  /**
   * Handle events that reach this component
   * Override to process specific events
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Check for first frame
    if (!this._firstFrameSeen && event.topic === 'frame:start') {
      this._firstFrameSeen = true;
      if (this.onFirstFrame) {
        await this.onFirstFrame();
      }
    }
  }
  
  /**
   * Called on the first frame after mounting
   * Override to initialize facets, state, etc.
   */
  onFirstFrame?(): void | Promise<void>;
  
  /**
   * Internal method to attach to an element
   * Returns a promise if the component has async initialization
   */
  async _attach(element: Element): Promise<void> {
    this.element = element;
    const mountResult = this.onMount();
    
    // Wait for async mount if it returns a promise
    if (mountResult !== undefined && mountResult !== null && typeof (mountResult as any).then === 'function') {
      await mountResult;
    }
    
    if (this._enabled) {
      this.onEnable();
    }
  }
  
  /**
   * Internal method to detach from an element
   */
  _detach(): void {
    if (this._enabled) {
      this.onDisable();
    }
    this.onUnmount();
  }
  
  // ========== Convenience Methods ==========
  
  /**
   * Emit an event from the parent element
   */
  protected emit(event: Omit<SpaceEvent, 'source' | 'timestamp'> & { timestamp?: number }): void {
    this.element.emit({
      ...event,
      source: this.element.getRef(),
      timestamp: event.timestamp || Date.now()
    });
  }
  
  /**
   * Subscribe the parent element to an event topic
   */
  protected subscribe(topic: string): void {
    this.element.subscribe(topic);
  }
  
  /**
   * Find a child element by ID
   */
  protected findChild(id: string): Element | null {
    return this.element.findChild(id);
  }
  
  /**
   * Get the parent element's ID
   */
  protected get elementId(): string {
    return this.element.id;
  }
  
  /**
   * Get a reference to the parent element
   */
  protected getRef(): ElementRef {
    return this.element.getRef();
  }
}

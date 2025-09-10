import { ComponentLifecycle, EventHandler, SpaceEvent } from './types';
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
    // Override in subclasses
  }
  
  /**
   * Internal method to attach to an element
   */
  _attach(element: Element): void {
    this.element = element;
    this.onMount();
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
}

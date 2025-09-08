import { ElementRef, SpaceEvent } from './types';
import { Component } from './component';
import { generateId } from './utils';

/**
 * Base Element class - the building block of the Space system
 * Similar to Unity's GameObject
 */
export class Element {
  /**
   * Unique identifier for this element
   */
  readonly id: string;
  
  /**
   * Human-readable name
   */
  name: string;
  
  /**
   * Parent element (null for root)
   */
  private _parent: Element | null = null;
  
  /**
   * Child elements
   */
  private _children: Element[] = [];
  
  /**
   * Components attached to this element
   */
  private _components: Component[] = [];
  
  /**
   * Whether this element is active in the hierarchy
   */
  private _active: boolean = true;
  
  /**
   * Topic subscriptions for this element
   */
  private _subscriptions: string[] = [];
  
  constructor(name: string, id?: string) {
    this.id = id || generateId();
    this.name = name;
  }
  
  get parent(): Element | null {
    return this._parent;
  }
  
  get children(): ReadonlyArray<Element> {
    return this._children;
  }
  
  get components(): ReadonlyArray<Component> {
    return this._components;
  }
  
  get active(): boolean {
    return this._active;
  }
  
  set active(value: boolean) {
    if (this._active === value) return;
    
    this._active = value;
    // Propagate to children
    for (const child of this._children) {
      child.active = value;
    }
  }
  
  /**
   * Get the root Space element
   */
  get space(): Element {
    let current: Element = this;
    while (current.parent) {
      current = current.parent;
    }
    return current;
  }
  
  /**
   * Get the path from root to this element
   */
  getPath(): string[] {
    const path: string[] = [];
    let current: Element | null = this;
    
    while (current) {
      path.unshift(current.name);
      current = current.parent;
    }
    
    return path;
  }
  
  /**
   * Get a reference to this element
   */
  getRef(): ElementRef {
    return {
      elementId: this.id,
      elementPath: this.getPath(),
      elementType: this.constructor.name
    };
  }
  
  /**
   * Add a child element
   */
  addChild(child: Element): void {
    if (child._parent) {
      child._parent.removeChild(child);
    }
    
    this._children.push(child);
    child._parent = this;
    
    // Emit mount event
    this.space.emit({
      topic: 'element:mount',
      source: this.getRef(),
      payload: { element: child.getRef() },
      timestamp: Date.now()
    });
  }
  
  /**
   * Remove a child element
   */
  removeChild(child: Element): boolean {
    const index = this._children.indexOf(child);
    if (index === -1) return false;
    
    this._children.splice(index, 1);
    child._parent = null;
    
    // Emit unmount event
    this.space.emit({
      topic: 'element:unmount',
      source: this.getRef(),
      payload: { element: child.getRef() },
      timestamp: Date.now()
    });
    
    return true;
  }
  
  /**
   * Find a child element by name (direct children only)
   */
  findChild(name: string): Element | null {
    return this._children.find(child => child.name === name) || null;
  }
  
  /**
   * Find an element by name in the entire subtree
   */
  findInChildren(name: string): Element | null {
    for (const child of this._children) {
      if (child.name === name) return child;
      const found = child.findInChildren(name);
      if (found) return found;
    }
    return null;
  }
  
  /**
   * Add a component to this element
   */
  addComponent<T extends Component>(component: T): T {
    this._components.push(component);
    component._attach(this);
    return component;
  }
  
  /**
   * Remove a component from this element
   */
  removeComponent(component: Component): boolean {
    const index = this._components.indexOf(component);
    if (index === -1) return false;
    
    this._components.splice(index, 1);
    component._detach();
    return true;
  }
  
  /**
   * Get the first component of a specific type
   */
  getComponent<T extends Component>(type: new (...args: any[]) => T): T | null {
    return this._components.find(c => c instanceof type) as T || null;
  }
  
  /**
   * Get all components of a specific type
   */
  getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
    return this._components.filter(c => c instanceof type) as T[];
  }
  
  /**
   * Subscribe to event topics
   */
  subscribe(topicPattern: string): void {
    this._subscriptions.push(topicPattern);
  }
  
  /**
   * Check if this element is subscribed to a topic
   */
  isSubscribedTo(topic: string): boolean {
    return this._subscriptions.some(pattern => {
      // Simple pattern matching: "discord.*" matches "discord.message"
      if (pattern === '*') return true;
      if (pattern === topic) return true;
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        return topic.startsWith(prefix);
      }
      return false;
    });
  }
  
  /**
   * Handle an event
   */
  handleEvent(event: SpaceEvent): void {
    if (!this._active) return;
    
    // Let components handle the event
    for (const component of this._components) {
      if (component.enabled) {
        component.handleEvent(event);
      }
    }
  }
  
  /**
   * Emit an event (delegates to space)
   */
  emit(event: SpaceEvent | Omit<SpaceEvent, 'source'>): void {
    const fullEvent: SpaceEvent = 'source' in event ? event : {
      ...event,
      source: this.getRef()
    };
    
    // This will be overridden in Space class
    // For regular elements, bubble up to space
    if (this.parent) {
      this.parent.emit(fullEvent);
    }
  }
}

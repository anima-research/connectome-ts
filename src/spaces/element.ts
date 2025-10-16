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
   * For Space, this persists across restores (part of lifecycle)
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
   * Get the element's subscriptions
   */
  get subscriptions(): ReadonlyArray<string> {
    return this._subscriptions;
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
   * Register RETM components in an element's subtree (called when adding element to Space)
   */
  private registerSubtreeComponents(element: Element, space: any): void {
    const { isReceptor, isEffector, isTransform, isMaintainer } = require('../utils/retm-type-guards');
    
    const traverse = (el: Element) => {
      // Register this element's components
      for (const component of el.components) {
        if (isReceptor(component)) space.addReceptor(component);
        if (isEffector(component)) space.addEffector(component);
        if (isTransform(component)) space.addTransform(component);
        if (isMaintainer(component)) space.addMaintainer(component);
      }
      
      // Traverse children
      for (const child of el.children) {
        traverse(child);
      }
    };
    
    traverse(element);
  }
  
  /**
   * Add a child element
   */
  addChild(child: Element): void {
    // Check if child already exists (prevent duplicates)
    if (this._children.includes(child)) {
      console.warn(`[Element.addChild] Element ${child.id} already exists in ${this.id}, skipping`);
      return;
    }
    
    // Also check by ID (in case it's a different instance with same ID)
    if (this._children.some(c => c.id === child.id)) {
      console.warn(`[Element.addChild] Element with ID ${child.id} already exists in ${this.id}, skipping`);
      return;
    }
    
    console.log(`[Element.addChild] Adding ${child.id} to ${this.id}`);
    
    if (child._parent) {
      child._parent.removeChild(child);
    }
    
    this._children.push(child);
    child._parent = this;
    
    // If this element is in a Space, register RETM components in the child's subtree
    const space = this.findSpace();
    if (space) {
      this.registerSubtreeComponents(child, space);
    }
    
    // Auto-subscribe to element:action if the child or its components can handle actions
    if (child.handleAction || child._components.some((c: any) => c.actions && c.actions.size > 0)) {
      child.subscribe('element:action');
    }
    
    // Auto-register element actions if agent supports it
    if (space && 'agent' in space && (space as any).agent && 
        'registerElementAutomatically' in (space as any).agent) {
      ((space as any).agent as any).registerElementAutomatically(child);
    }
    
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
   * Note: Component mounting may be async. Use addComponentAsync if you need to wait for initialization.
   */
  addComponent<T extends Component>(component: T, isRestoring: boolean = false): T {
    this._components.push(component);
    // Start async attachment but don't wait for it
    component._attach(this, isRestoring).catch(error => {
      console.error(`Failed to attach component ${component.constructor.name}:`, error);
    });
    return component;
  }
  
  /**
   * Add a component and wait for it to fully initialize
   */
  async addComponentAsync<T extends Component>(component: T, isRestoring: boolean = false): Promise<T> {
    this._components.push(component);
    await component._attach(this, isRestoring);
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
   * Complete mounting for all components after restoration
   * Called after external services are ready
   */
  async completeMountForRestoration(): Promise<void> {
    // Complete mount for all components
    const promises: Promise<void>[] = [];
    for (const component of this._components) {
      promises.push(component._completeMount());
    }
    await Promise.all(promises);
    
    // Recursively complete mount for all children
    const childPromises: Promise<void>[] = [];
    for (const child of this.children) {
      childPromises.push(child.completeMountForRestoration());
    }
    await Promise.all(childPromises);
  }
  
  /**
   * Get all components of a specific type
   */
  getComponents<T extends Component>(type: new (...args: any[]) => T): T[] {
    return this._components.filter(c => c instanceof type) as T[];
  }
  
  /**
   * Check if this element is a Space
   */
  get isSpace(): boolean {
    return this.constructor.name === 'Space';
  }
  
  /**
   * Find the root Space element by walking up the parent chain
   */
  findSpace(): Element | null {
    if (this.isSpace) return this;
    return this._parent?.findSpace() || null;
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
  async handleEvent(event: SpaceEvent): Promise<void> {
    if (!this._active) return;
    
    // Update current target
    event.currentTarget = this.getRef();
    
    // Check if this is an element:action event meant for us
    if (event.topic === 'element:action') {
      const payload = event.payload as any;
      const path = payload.path || [];
      const action = path[path.length - 1];
      const elementPath = path.slice(0, -1);
      
      // Check if this action is for this element
      // Handle both direct ID match and path match
      if (elementPath.length === 1 && elementPath[0] === this.id) {
        // First try element's own handleAction
        if (this.handleAction) {
          await this.handleAction(action, payload.parameters);
        } else {
          // Otherwise delegate to InteractiveComponent if present
          for (const component of this._components) {
            const comp = component as any;
            if (comp.actions && comp.actions.has(action)) {
              const handler = comp.actions.get(action);
              await handler(payload.parameters);
              break;
            }
          }
        }
      }
    }
    
    // Let components handle the event
    for (const component of this._components) {
      if (component.enabled && component.handleEvent) {
        await component.handleEvent(event);
        
        // Check if immediate propagation was stopped
        if (event.immediatePropagationStopped) {
          return;
        }
      }
    }
  }
  
  /**
   * Handle an action - subclasses can override
   */
  protected async handleAction?(action: string, parameters?: any): Promise<any>;
  
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

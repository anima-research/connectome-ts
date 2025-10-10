import { ComponentLifecycle, EventHandler, SpaceEvent, ElementRef } from './types';
import type { Element } from './element';
import type { Space } from './space';
import type { VEILDelta } from '../veil/types';
import {
  createAmbientFacet,
  createStateFacet,
  createEventFacet
} from '../helpers/factories';

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
   * Called when component is first created (either new or from persistence)
   * Use for basic initialization that doesn't require external resources
   */
  onInit(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is being restored from persistence
   * Use for restoration-specific setup
   */
  onRestore(): void {
    // Override in subclasses
  }
  
  /**
   * Called when component is attached to an element and ready for operation
   * Use for connecting to external services, starting operations
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
   * Get a reference from the host registry with helpful errors
   */
  protected requireReference<T>(id: string): T {
    const space = this.element?.findSpace() as Space | null;
    if (!space) {
      throw new Error(`Component ${this.constructor.name} not mounted - cannot access references`);
    }
    
    const value = space.getReference(id);
    if (!value) {
      const available = space.listReferences();
      throw new Error(
        `Required reference '${id}' not found for ${this.constructor.name}.\n` +
        `Available references: ${available.join(', ')}\n` +
        `Hint: Ensure the reference is registered before component initialization.`
      );
    }
    
    return value as T;
  }
  
  /**
   * Get an optional reference
   */
  protected getReference<T>(id: string): T | undefined {
    const space = this.element?.findSpace() as Space | null;
    return space?.getReference(id) as T | undefined;
  }
  
  /**
   * Internal method to attach to an element
   * Returns a promise if the component has async initialization
   */
  async _attach(element: Element, isRestoring: boolean = false): Promise<void> {
    this.element = element;
    
    // Always call onInit first
    const initResult = this.onInit();
    if (initResult !== undefined && initResult !== null && typeof (initResult as any).then === 'function') {
      await initResult;
    }
    
    // If restoring, call onRestore but delay onMount
    if (isRestoring) {
      const restoreResult = this.onRestore();
      if (restoreResult !== undefined && restoreResult !== null && typeof (restoreResult as any).then === 'function') {
        await restoreResult;
      }
      // Don't call onMount yet - wait for external services
    } else {
      // For new components, call onMount immediately
      const mountResult = this.onMount();
      if (mountResult !== undefined && mountResult !== null && typeof (mountResult as any).then === 'function') {
        await mountResult;
      }
    }
    
    if (this._enabled) {
      this.onEnable();
    }
  }
  
  /**
   * Complete mounting after restoration when external services are ready
   */
  async _completeMount(): Promise<void> {
    const mountResult = this.onMount();
    if (mountResult !== undefined && mountResult !== null && typeof (mountResult as any).then === 'function') {
      await mountResult;
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

  // ============================================
  // Component State Management (VEIL-based)
  // ============================================

  /**
   * Get this component's unique ID for state scoping
   */
  protected getComponentId(): string {
    // Use element ID + component type + index as unique ID
    const components = Array.from(this.element.components);
    const index = components.indexOf(this);
    return `${this.element.id}:${this.constructor.name}:${index}`;
  }

  /**
   * Get this component's state from VEIL
   * Returns empty object if state facet doesn't exist yet
   */
  protected getComponentState<T = Record<string, any>>(): T {
    const space = this.element?.findSpace() as Space | undefined;
    if (!space || !(space as any).getVEILState) {
      return {} as T;
    }
    
    const veilState = (space as any).getVEILState().getState();
    const componentId = this.getComponentId();
    const stateFacet = veilState.facets.get(`component-state:${componentId}`);
    
    return (stateFacet?.state || {}) as T;
  }

  /**
   * Update this component's state in VEIL
   * 
   * For VEILComponents (Phase 1/2): Uses addOperation() - applies via normal flow
   * For Effectors/Maintainers (Phase 3/4): Directly modifies VEIL (side effect!) via Space hook
   * For Afferents: Must emit event, use runtime cache
   * 
   * @param updates - Partial state updates (deep merged)
   */
  protected updateComponentState(updates: Record<string, any>): void {
    const componentId = this.getComponentId();
    const currentState = this.getComponentState();
    
    const delta = {
      type: 'rewriteFacet' as const,
      id: `component-state:${componentId}`,
      changes: {
        state: { ...currentState, ...updates }
      }
    };
    
    // Try to apply as scoped write (for Effectors/Maintainers in their phase)
    const space = this.element?.findSpace() as any;
    if (space && space._applyComponentStateDelta) {
      // Direct application during Phase 3/4
      space._applyComponentStateDelta(delta, componentId);
    } else {
      // Fallback to normal addOperation (for VEILComponents)
      this.addOperation(delta);
    }
  }

  /**
   * Replace entire component state
   */
  protected setComponentState<T = Record<string, any>>(state: T): void {
    const componentId = this.getComponentId();
    
    this.addOperation({
      type: 'rewriteFacet',
      id: `component-state:${componentId}`,
      changes: {
        state
      }
    });
  }

  /**
   * Add a VEIL operation to the current frame
   * This is the primary way components interact with VEIL state
   */
  protected addOperation(operation: VEILDelta): void {
    const space = this.element?.findSpace() as Space | undefined;
    if (!space) {
      throw new Error(
        `[${this.constructor.name}] Cannot add operation - element not attached to space`
      );
    }
    
    const frame = (space as any).getCurrentFrame ? (space as any).getCurrentFrame() : undefined;
    if (!frame) {
      throw new Error(
        `[${this.constructor.name}] VEIL operations are only allowed during frame processing. ` +
        `Move this operation from onMount() to onFirstFrame() or an event handler.`
      );
    }
    
    frame.deltas.push(operation);
  }

  // ============================================
  // Helper methods for common operations
  // ============================================

  /**
   * Adds an ambient facet with optional ID
   * @param content - The facet content
   * @param idOrAttributes - Either a string ID or attributes object
   * @param attributes - Attributes if second param was an ID
   * 
   * @example
   * // Auto-generated ID
   * this.addAmbient('System initialized', { timestamp: Date.now() });
   * 
   * // Stable ID
   * this.addAmbient('System initialized', 'init-message', { timestamp: Date.now() });
   */
  protected addAmbient(
    content: string, 
    idOrAttributes?: string | Record<string, any>,
    attributes?: Record<string, any>
  ): void {
    let id: string;
    let attrs: Record<string, any>;
    
    if (typeof idOrAttributes === 'string') {
      id = idOrAttributes;
      attrs = attributes || {};
    } else {
      // Simple counter-based ID generation
      id = `${this.element.id}-ambient-${Date.now()}`;
      attrs = idOrAttributes || {};
    }
    
    const { streamId = `${this.element.id}:ambient`, streamType, ...metadata } = attrs;

    this.addOperation({
      type: 'addFacet',
      facet: createAmbientFacet({
        id,
        content,
        streamId,
        streamType
      })
    });
    if (Object.keys(metadata).length > 0) {
      this.addOperation({
        type: 'addFacet',
        facet: createEventFacet({
          id: `${id}-meta`,
          content: `metadata:${JSON.stringify(metadata)}`,
          source: this.element.id,
          eventType: 'ambient-metadata',
          metadata,
          streamId,
          streamType
        })
      });
    }
  }

  /**
   * Adds a state facet
   * @param id - The facet ID (will be prefixed with element ID)
   * @param content - The facet content  
   * @param attributes - Optional attributes
   * 
   * @example
   * this.addState('status', 'Ready', { connections: 5 });
   */
  protected addState(id: string, content: string, attributes: Record<string, any> = {}): void {
    const facetId = `${this.element.id}-${id}`;
    this.addOperation({
      type: 'addFacet',
      facet: createStateFacet({
        id: facetId,
        content,
        entityType: 'component',
        entityId: this.element.id,
        state: attributes,
        scopes: []
      })
    });
  }

  /**
   * Changes/updates an existing state facet
   * @param id - The facet ID (without element prefix)
   * @param updates - Content and/or attributes to update
   * 
   * @example
   * this.changeState('status', { content: 'Connected', attributes: { online: true } });
   */
  protected changeState(
    id: string, 
    changes: { content?: string; attributes?: Record<string, any> }
  ): void {
    const facetId = `${this.element.id}-${id}`;
    const delta: any = {};
    if (changes.content !== undefined) {
      delta.content = changes.content;
    }
    if (changes.attributes) {
      delta.state = changes.attributes;
    }
    this.addOperation({
      type: 'rewriteFacet',
      id: facetId,
      changes: delta
    });
  }

  /**
   * @deprecated Use changeState() instead - renamed for consistency with VEIL operations
   */
  protected updateState(
    id: string, 
    changes: { content?: string; attributes?: Record<string, any> }
  ): void {
    console.warn('updateState() is deprecated. Use changeState() for consistency with VEIL operations.');
    this.changeState(id, changes);
  }

  /**
   * Adds an event facet with proper structure
   * @param content - The event content
   * @param eventType - Optional event subtype
   * @param idOrAttributes - Either a string ID or attributes object
   * @param attributes - Attributes if third param was an ID
   * 
   * @example
   * // Auto-generated ID
   * this.addEvent('User logged in', 'auth', { userId: '123' });
   * 
   * // Stable ID
   * this.addEvent('User logged in', 'auth', 'login-event', { userId: '123' });
   */
  protected addEvent(
    content: string, 
    eventType?: string,
    idOrAttributes?: string | Record<string, any>,
    attributes?: Record<string, any>
  ): void {
    let id: string;
    let attrs: Record<string, any>;
    
    if (typeof idOrAttributes === 'string') {
      id = idOrAttributes;
      attrs = attributes || {};
    } else {
      // Simple timestamp-based ID
      id = `${this.element.id}-event-${Date.now()}`;
      attrs = idOrAttributes || {};
    }
    
    const { source = this.element.id, streamId: streamIdAttr, streamType: streamTypeAttr, ...metadata } = attrs;
    const streamId = typeof streamIdAttr === 'string' ? streamIdAttr : 'default';
    const streamType = typeof streamTypeAttr === 'string' ? streamTypeAttr : undefined;

    const facet = createEventFacet({
      id,
      content,
      source,
      eventType: eventType || 'event',
      metadata: Object.keys(metadata).length ? metadata : undefined,
      streamId,
      streamType
    });
    this.addOperation({ type: 'addFacet', facet });
  }

  /**
   * Checks if we're currently in a frame (safe to add operations)
   * @returns true if in frame, false otherwise
   * 
   * @example
   * if (this.inFrame()) {
   *   this.addOperation(...);
   * }
   */
  protected inFrame(): boolean {
    const space = this.element.findSpace() as any;
    return space?.isProcessingFrame || false;
  }

  /**
   * Requires that we're in a frame, throws descriptive error if not
   * Use this when an operation MUST happen in a frame
   * 
   * @example
   * this.requireFrame();
   * this.element.addOperation(...); // Safe now
   */
  protected requireFrame(): void {
    if (!this.inFrame()) {
      const space = this.element.findSpace();
      throw new Error(
        `[${this.constructor.name}] This operation requires an active frame. ` +
        `Make sure you're calling this during frame processing or from an event handler. ` +
        `Current frame state: ${space ? 'Space exists but not in frame' : 'No space found'}. ` +
        `If you need to defer operations, use element.space.requestFrame().`
      );
    }
  }

  /**
   * Helper to safely get current VEIL state
   * @returns The current VEIL state or null if not available
   * 
   * @example
   * const state = this.getVeilState();
   * const myFacet = state?.facets.get('my-facet-id');
   */
  protected getVeilState() {
    const space = this.element.findSpace() as any;
    return space?.veilState?.getState() || null;
  }

  /**
   * Defers an operation until the next frame
   * Useful for operations that need to happen outside of current frame
   * 
   * @param operation - Function to execute in next frame
   * 
   * @example
   * this.deferToNextFrame(() => {
   *   this.addAmbient('Deferred operation completed');
   * });
   */
  protected deferToNextFrame(operation: () => void): void {
    const space = this.element.findSpace() as any;
    if (!space) {
      throw new Error(`[${this.constructor.name}] Cannot defer operation - no space found`);
    }
    
    space.once('frame:start', () => {
      operation();
    });
    space.requestFrame();
  }

  // ============================================
  // Convenience Helpers for Facet Creation
  // ============================================

  /**
   * Emit a facet via veil:operation event
   * For Effectors/Maintainers/Afferents that can't directly add to frame
   * Can be overridden in subclasses for validation
   */
  protected emitFacet(facet: import('../veil/types').Facet): void {
    this.emit({
      topic: 'veil:operation',
      payload: {
        operation: {
          type: 'addFacet',
          facet
        }
      }
    });
  }

  /**
   * Emit an agent activation (convenience)
   * Can be overridden for validation
   */
  protected activateAgent(reason: string, options?: {
    priority?: 'low' | 'normal' | 'high' | 'critical';
    source?: string;
    streamRef?: any;
  }): void {
    const { createAgentActivation } = require('../helpers/factories');
    this.emitFacet(createAgentActivation(reason, {
      source: options?.source || this.element.id,
      priority: options?.priority || 'normal',
      streamRef: options?.streamRef
    }));
  }

  /**
   * Emit an event facet (convenience)
   * Can be overridden for validation
   */
  protected emitEventFacet(content: string, options?: {
    eventType?: string;
    metadata?: any;
  }): void {
    const { createEventFacet } = require('../helpers/factories');
    this.emitFacet(createEventFacet({
      id: `${this.element.id}-event-${Date.now()}`,
      content,
      source: this.element.id,
      eventType: options?.eventType || 'event',
      metadata: options?.metadata,
      streamId: 'default'
    }));
  }
}

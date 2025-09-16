import { Component } from '../spaces/component';
import { SpaceEvent } from '../spaces/types';
import { Space } from '../spaces/space';
import { IncomingVEILFrame, VEILOperation, Facet } from '../veil/types';
import { ComponentChange } from '../persistence/transition-types';

/**
 * Base component for producing VEIL operations
 */
export abstract class VEILComponent extends Component {
  // Track previous values for change detection
  private _previousValues: Map<string, any> = new Map();
  
  /**
   * Add an operation to the current frame
   */
  protected addOperation(operation: VEILOperation): void {
    const space = this.element?.space as Space | undefined;
    if (!space) {
      // Element not yet attached to space - defer operation
      if (!this._deferredOperations) {
        this._deferredOperations = [];
      }
      this._deferredOperations.push(operation);
      return;
    }
    
    const frame = space.getCurrentFrame ? space.getCurrentFrame() : undefined;
    if (!frame) {
      throw new Error(
        `VEIL operations are only allowed during frame processing. ` +
        `Move this operation from onMount() to onFirstFrame() or an event handler. ` +
        `Component: ${this.constructor.name}, Operation: ${operation.type}`
      );
    }
    
    frame.operations.push(operation);
  }
  
  /**
   * Track property change in transition
   */
  protected trackPropertyChange(propertyName: string, oldValue: any, newValue: any): void {
    const space = this.element?.space as Space | undefined;
    if (!space) return;
    
    const frame = space.getCurrentFrame ? space.getCurrentFrame() : undefined;
    if (!frame?.transition) return;
    
    // Get component index in element
    const componentIndex = this.element.components.indexOf(this);
    if (componentIndex === -1) return;
    
    frame.transition.componentChanges.push({
      elementRef: this.element.getRef(),
      componentClass: this.constructor.name,
      componentIndex,
      property: propertyName,
      oldValue,
      newValue
    });
  }
  
  /**
   * Set a tracked property value
   */
  protected setTrackedProperty<K extends keyof this>(key: K, value: this[K]): void {
    const oldValue = this[key];
    if (oldValue !== value) {
      this[key] = value;
      this.trackPropertyChange(key as string, oldValue, value);
    }
  }
  
  private _deferredOperations?: VEILOperation[];
  
  /**
   * Process any deferred operations when element is added to space
   */
  protected processDeferredOperations(): void {
    if (this._deferredOperations && this.element?.space) {
      const space = this.element.space as Space;
      const frame = space.getCurrentFrame ? space.getCurrentFrame() : undefined;
      if (frame) {
        for (const op of this._deferredOperations) {
          frame.operations.push(op);
        }
      }
      this._deferredOperations = undefined;
    }
  }
  
  
  /**
   * Add a facet to the current frame
   */
  protected addFacet(facetDef: {
    id: string;
    type: 'event' | 'state' | 'ambient';
    content?: string;
    displayName?: string;
    scope?: string[];
    attributes?: Record<string, any>;
    attributeRenderers?: Record<string, (value: any, oldValue?: any) => string | null>;
    transitionRenderers?: Record<string, (newValue: any, oldValue: any) => string | null>;
    children?: Facet[];
  }): void {
    // Create proper facet based on type
    let facet: Facet;
    
    switch (facetDef.type) {
      case 'event':
        facet = {
          id: facetDef.id,
          type: 'event',
          content: facetDef.content,
          displayName: facetDef.displayName,
          attributes: facetDef.attributes || {},
          children: facetDef.children
        };
        break;
      case 'state':
        facet = {
          id: facetDef.id,
          type: 'state',
          content: facetDef.content,
          displayName: facetDef.displayName,
          attributes: facetDef.attributes || {},
          attributeRenderers: facetDef.attributeRenderers,
          transitionRenderers: facetDef.transitionRenderers,
          children: facetDef.children
        };
        break;
      case 'ambient':
        facet = {
          id: facetDef.id,
          type: 'ambient',
          content: facetDef.content,
          displayName: facetDef.displayName,
          scope: facetDef.scope || [],
          attributes: facetDef.attributes || {},
          children: facetDef.children
        };
        break;
    }
    
    this.addOperation({
      type: 'addFacet',
      facet
    });
  }
  
  /**
   * Update a state facet
   */
  protected updateState(facetId: string, updates: {
    content?: string;
    attributes?: Record<string, any>;
  }, updateMode?: 'full' | 'attributesOnly'): void {
    this.addOperation({
      type: 'changeState',
      facetId,
      updates,
      updateMode
    });
  }
}

/**
 * Base component for handling interactions
 */
export abstract class InteractiveComponent extends VEILComponent {
  /**
   * Static property for declaring component actions
   * Components should override this to declare their available actions
   */
  static actions?: Record<string, string | { description: string; params?: any }>;
  
  protected actions: Map<string, (params?: any) => Promise<void>> = new Map();
  
  /**
   * Register an action handler
   */
  protected registerAction(name: string, handler: (params?: any) => Promise<void>): void {
    this.actions.set(name, handler);
  }
  
  /**
   * Handle incoming events
   * Note: element:action events are now handled by Element class delegation
   */
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Call parent to handle first frame
    await super.handleEvent(event);
    
    // Element now handles element:action delegation to components
    // so we don't need to process those events here
  }
}

/**
 * Base component for managing state
 */
export abstract class StateComponent<T = any> extends VEILComponent {
  protected state: T;
  protected stateId: string;
  
  constructor(initialState: T, stateId: string) {
    super();
    this.state = initialState;
    this.stateId = stateId;
  }
  
  /**
   * Update state and emit VEIL operation
   */
  protected setState(updates: Partial<T>): void {
    // Track individual property changes
    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = this.state[key as keyof T];
      if (oldValue !== newValue) {
        this.trackPropertyChange(`state.${key}`, oldValue, newValue);
      }
    }
    
    this.state = { ...this.state, ...updates };
    this.emitStateUpdate();
  }
  
  /**
   * Get current state
   */
  getState(): T {
    return this.state;
  }
  
  /**
   * Emit state update to VEIL
   */
  protected abstract emitStateUpdate(): void;
}

/**
 * Helper to create a component with minimal boilerplate
 */
export function createComponent<T extends Component>(
  setup: (component: T) => void
): T {
  const ComponentClass = class extends Component {
    constructor() {
      super();
      setup(this as any);
    }
  };
  return new ComponentClass() as T;
}

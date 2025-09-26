/**
 * AXON Component Interfaces
 * 
 * These interfaces define the contract between AXON components and the Connectome framework.
 * AXON components should depend only on these interfaces, not on concrete implementations.
 */

// Event system interfaces
export interface ISpaceEvent<T = unknown> {
  topic: string;
  source: IElementRef;
  payload: T;
  timestamp: number;
  priority?: 'immediate' | 'normal' | 'deferred';
  metadata?: Record<string, any>;
}

export interface IElementRef {
  elementId: string;
  elementPath: string[];
  elementType: string;
}

// Component lifecycle and structure
export interface IComponent {
  onMount?(): void | Promise<void>;
  onUnmount?(): void | Promise<void>;
  handleEvent?(event: ISpaceEvent): void | Promise<void>;
  handleAction?(action: string, params?: any): Promise<void>;
  readonly element: IElement;
}

export interface IElement {
  readonly id: string;
  readonly name: string;
  readonly space?: ISpace;
  
  getRef(): IElementRef;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  emit(event: Omit<ISpaceEvent, 'source'>): void;
}

export interface ISpace {
  emit(event: Omit<ISpaceEvent, 'source'>): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

// VEIL interfaces
export interface IVEILOperation {
  type: 'addFacet' | 'changeState' | 'removeFacet' | 'speak' | 'action';
  [key: string]: any;
}

export interface IFacet {
  id: string;
  type: 'event' | 'state' | 'ambient' | 'speech' | 'action' | 'thought';
  content?: string;
  displayName?: string;
  attributes?: Record<string, any>;
  children?: IFacet[];
}

export interface IVEILFrame {
  operations: IVEILOperation[];
}

// Component base classes as interfaces
export interface IVEILComponent extends IComponent {
  addOperation(operation: IVEILOperation): void;
  trackPropertyChange(propertyName: string, oldValue: any, newValue: any): void;
  setTrackedProperty<K extends keyof any>(key: K, value: any): void;
  addFacet(facetDef: {
    id: string;
    type: 'event' | 'state' | 'ambient';
    content?: string;
    displayName?: string;
    scope?: string[];
    attributes?: Record<string, any>;
    children?: IFacet[];
  }): void;
  updateState(facetId: string, updates: {
    content?: string;
    attributes?: Record<string, any>;
  }, updateMode?: 'full' | 'attributesOnly'): void;
}

export interface IInteractiveComponent extends IVEILComponent {
  registerAction(name: string, handler: (params?: any) => Promise<void>): void;
  
  // Helper methods from Component base class (added in API improvements)
  addAmbient(content: string, idOrAttributes?: string | Record<string, any>, attributes?: Record<string, any>): void;
  addState(facetId: string, content: string, attributes?: Record<string, any>): void;
  changeState(facetId: string, updates: { content?: string; attributes?: Record<string, any> }): void;
  addEvent(displayName: string, content: string, idOrAttributes?: string | Record<string, any>, attributes?: Record<string, any>): void;
  inFrame(): boolean;
  requireFrame(): void;
  getVeilState(): any;
  deferToNextFrame(operation: () => void): void;
}

// Decorator metadata interfaces
export interface IPersistentMetadata {
  propertyKey: string;
  version?: number;
}

export interface IExternalMetadata {
  propertyKey: string;
  resourceId: string;
}

// Component factory interface for AxonElement
export interface IAxonComponentConstructor {
  new(): IInteractiveComponent;
  actions?: Record<string, string | { description: string; params?: any }>;
  persistentProperties?: IPersistentMetadata[];
  externalResources?: IExternalMetadata[];
}

// Environment interface - what AxonElement provides to components
export interface IAxonEnvironment {
  // Component base classes
  Component: abstract new() => IComponent;
  VEILComponent: abstract new() => IVEILComponent;
  InteractiveComponent: abstract new() => IInteractiveComponent;
  
  // Decorators (as functions that can be applied)
  persistent: (target: any, propertyKey: string) => void;
  persistable: (version: number) => (target: any) => void;
  external: (resourceId: string) => (target: any, propertyKey: string) => void;
  
  // Type references
  SpaceEvent: new<T>() => ISpaceEvent<T>;
  
  // WebSocket (if needed)
  WebSocket?: any;
}

// Manifest interface for AXON components
export interface IAxonManifest {
  name: string;
  version: string;
  description?: string;
  main: string;
  componentClass: string;
  moduleType?: 'class' | 'function'; // 'function' means module exports a factory
  extends?: string;
  dependencies?: Array<{
    name: string;
    manifest: string; // URL to dependency manifest
  }>;
  actions?: Record<string, {
    description: string;
    parameters?: Record<string, any>;
  }>;
  config?: Record<string, {
    type: string;
    description?: string;
    required?: boolean;
  }>;
  hotReload?: string;
  hash?: string;
}

/**
 * Base Component interface for MARTEM architecture
 * All processing components (Modulator, Afferent, Receptor, Transform, Effector, Maintainer)
 * extend this base interface
 */

import { Element } from '../spaces/element';

/**
 * Minimal component interface - just lifecycle management
 */
export interface Component {
  /**
   * Mount the component to an element
   * Called when the component is attached to the element tree
   */
  mount(element: Element): Promise<void>;
  
  /**
   * Unmount the component
   * Called when the component is removed from the element tree or element is unmounted
   */
  unmount(): Promise<void>;
  
  /**
   * Optional destroy method for cleanup beyond unmount
   * Called when the component needs complete cleanup (e.g., closing connections)
   */
  destroy?(): Promise<void>;
}

/**
 * Component metadata for registration and management
 */
export interface ComponentMetadata {
  /** Unique component type identifier (e.g., 'discord-afferent', 'rate-limit-modulator') */
  componentType: string;
  
  /** Component class for Space registration */
  componentClass: 'modulator' | 'afferent' | 'receptor' | 'transform' | 'effector' | 'maintainer';
  
  /** Optional version for hot-reload compatibility */
  version?: string;
  
  /** Optional dependencies on other components */
  dependencies?: string[];
}

/**
 * Component constructor type
 */
export type ComponentConstructor<T extends Component = Component> = new (...args: any[]) => T;

/**
 * Component registry entry
 */
export interface ComponentRegistryEntry {
  constructor: ComponentConstructor;
  metadata: ComponentMetadata;
}

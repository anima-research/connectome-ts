/**
 * Decorators for marking persistent properties
 */

import { ComponentPersistenceMetadata, PersistentPropertyMetadata, Serializer, SerializableValue } from './types';

// Global registry of component persistence metadata
const componentMetadataRegistry = new Map<string, ComponentPersistenceMetadata>();

/**
 * Decorator to mark a property as persistent
 */
export function persistent(options?: {
  serializer?: Serializer<any>;
  version?: number;
}) {
  return function (target: any, propertyKey: string) {
    const className = target.constructor.name;
    
    // Get or create metadata for this component class
    let metadata = componentMetadataRegistry.get(className);
    if (!metadata) {
      metadata = {
        className,
        version: 1,
        properties: new Map()
      };
      componentMetadataRegistry.set(className, metadata);
    }
    
    // Add property metadata
    const propertyMetadata: PersistentPropertyMetadata = {
      key: propertyKey,
      serializer: options?.serializer,
      version: options?.version || 1
    };
    
    metadata.properties.set(propertyKey, propertyMetadata);
  };
}

/**
 * Decorator to mark a component class as persistable with version
 */
export function persistable(version: number = 1) {
  return function (constructor: Function) {
    const className = constructor.name;
    
    // Ensure metadata exists
    let metadata = componentMetadataRegistry.get(className);
    if (!metadata) {
      metadata = {
        className,
        version,
        properties: new Map()
      };
      componentMetadataRegistry.set(className, metadata);
    } else {
      metadata.version = version;
    }
    
    // Add a static method to get persistence metadata
    (constructor as any).getPersistenceMetadata = () => metadata;
  };
}

/**
 * Get persistence metadata for a component instance
 */
export function getPersistenceMetadata(component: any): ComponentPersistenceMetadata | undefined {
  const className = component.constructor.name;
  return componentMetadataRegistry.get(className);
}

/**
 * Common serializers
 */
export const Serializers = {
  /**
   * Date serializer
   */
  date: {
    serialize: (value: Date) => value.toISOString(),
    deserialize: (value: string) => new Date(value)
  } as Serializer<Date>,
  
  /**
   * Set serializer
   */
  set<T extends string | number>(): Serializer<Set<T>> {
    return {
      serialize: (value: Set<T>) => Array.from(value),
      deserialize: (value: T[]) => new Set(value)
    };
  },
  
  /**
   * Map serializer  
   */
  map<V>(): Serializer<Map<string, V>> {
    return {
      serialize: (value: Map<string, V>) => Array.from(value.entries()) as any,
      deserialize: (value: SerializableValue) => new Map(value as any)
    };
  },
  
  /**
   * Custom object serializer
   */
  object<T>(
    serialize: (obj: T) => any,
    deserialize: (data: any) => T
  ): Serializer<T> {
    return { serialize, deserialize };
  }
};

/**
 * Example usage:
 * 
 * @persistable(1)
 * class MyComponent extends Component {
 *   @persistent()
 *   private count: number = 0;
 *   
 *   @persistent({ serializer: Serializers.date })
 *   private lastUpdate: Date = new Date();
 *   
 *   @persistent({ serializer: Serializers.set<string>() })
 *   private tags: Set<string> = new Set();
 * }
 */

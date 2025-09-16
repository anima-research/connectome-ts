/**
 * Component Registry for built-in Connectome components
 * 
 * Most components will be loaded via AXON in practice.
 * This registry is for core system components that need to be
 * available for restoration.
 */

import { Component } from '../spaces/component';

type ComponentConstructor = new (...args: any[]) => Component;

class ComponentRegistryImpl {
  private components = new Map<string, ComponentConstructor>();
  
  /**
   * Register a component class
   */
  register(name: string, constructor: ComponentConstructor): void {
    this.components.set(name, constructor);
  }
  
  /**
   * Create a component instance by name
   */
  create(name: string, ...args: any[]): Component | null {
    const Constructor = this.components.get(name);
    if (!Constructor) {
      console.warn(`Component not found in registry: ${name}`);
      return null;
    }
    
    try {
      return new Constructor(...args);
    } catch (error) {
      console.error(`Failed to create component ${name}:`, error);
      return null;
    }
  }
  
  /**
   * Check if a component is registered
   */
  has(name: string): boolean {
    return this.components.has(name);
  }
  
  /**
   * Get all registered component names
   */
  getRegisteredNames(): string[] {
    return Array.from(this.components.keys());
  }
  
  /**
   * Clear all registrations (useful for testing)
   */
  clear(): void {
    this.components.clear();
  }
}

// Global singleton instance
export const ComponentRegistry = new ComponentRegistryImpl();

/**
 * Decorator to auto-register components
 */
export function registeredComponent(name?: string) {
  return function <T extends ComponentConstructor>(constructor: T): T {
    const componentName = name || constructor.name;
    ComponentRegistry.register(componentName, constructor);
    return constructor;
  };
}

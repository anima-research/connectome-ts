/**
 * Decorators for the Host reference system
 */

import { Component } from '../spaces/component';

export interface ReferenceMetadata {
  propertyKey: string;
  referenceId?: string;  // Optional explicit ID, otherwise uses propertyKey
  required: boolean;
}

export interface ExternalMetadata {
  propertyKey: string;
  resourcePath: string;  // e.g., 'secret:discord.token'
  required: boolean;
}

// Store metadata on component constructors
const referenceMetadata = new WeakMap<any, ReferenceMetadata[]>();
const externalMetadata = new WeakMap<any, ExternalMetadata[]>();

/**
 * Mark a property as a reference to another component or service
 */
export function reference(referenceId?: string, required: boolean = true) {
  return function(target: any, propertyKey: string) {
    if (!target) {
      throw new Error(`@reference decorator called with undefined target for property ${propertyKey}. This usually means the transpiler doesn't support decorators properly.`);
    }
    const constructor = target.constructor || Object.getPrototypeOf(target)?.constructor;
    if (!constructor) {
      throw new Error(`@reference decorator: Cannot determine constructor for property ${propertyKey}`);
    }
    const existing = referenceMetadata.get(constructor) || [];
    existing.push({ propertyKey, referenceId: referenceId || propertyKey, required });
    referenceMetadata.set(constructor, existing);
  };
}

/**
 * Mark a property as requiring an external resource
 */
export function external(resourcePath: string, required: boolean = true) {
  return function(target: any, propertyKey: string) {
    if (!target) {
      throw new Error(`@external decorator called with undefined target for property ${propertyKey}. This usually means the transpiler doesn't support decorators properly.`);
    }
    const constructor = target.constructor || Object.getPrototypeOf(target)?.constructor;
    if (!constructor) {
      throw new Error(`@external decorator: Cannot determine constructor for property ${propertyKey}`);
    }
    const existing = externalMetadata.get(constructor) || [];
    existing.push({ propertyKey, resourcePath, required });
    externalMetadata.set(constructor, existing);
  };
}

/**
 * Get reference metadata for a component instance
 */
export function getReferenceMetadata(component: Component): ReferenceMetadata[] {
  return referenceMetadata.get(component.constructor) || [];
}

/**
 * Get external resource metadata for a component instance
 */
export function getExternalMetadata(component: Component): ExternalMetadata[] {
  return externalMetadata.get(component.constructor) || [];
}

/**
 * Interface for components that need reference resolution
 */
export interface RestorableComponent extends Component {
  onReferencesResolved?(): void | Promise<void>;
}

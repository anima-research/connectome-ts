/**
 * Type guards for RETM component interfaces
 * Used for auto-discovery of components in the element tree
 */

import { 
  Modulator,
  Receptor, 
  Transform, 
  Effector, 
  Maintainer,
  SpaceEvent,
  ReadonlyVEILState,
  VEILDelta,
  FacetDelta,
  EffectorResult,
  MaintainerResult,
  Frame
} from '../spaces/receptor-effector-types';

/**
 * Symbols for RETM component type identification
 * Components should set these to enable auto-discovery
 */
export const RETM_TYPE = Symbol('retm-type');

export const RETM_TYPES = {
  MODULATOR: Symbol('modulator'),
  RECEPTOR: Symbol('receptor'), 
  TRANSFORM: Symbol('transform'),
  EFFECTOR: Symbol('effector'),
  MAINTAINER: Symbol('maintainer')
} as const;

/**
 * Check if a component implements the Modulator interface
 */
export function isModulator(component: any): component is Modulator {
  // Prefer explicit type marking
  if (component?.[RETM_TYPE] === RETM_TYPES.MODULATOR) {
    return true;
  }
  
  // Fallback to duck typing for backwards compatibility
  return component &&
    typeof component.process === 'function' &&
    component.process.length === 1; // Takes events array
}

/**
 * Check if a component implements the Receptor interface
 */
export function isReceptor(component: any): component is Receptor {
  // Prefer explicit type marking
  if (component?.[RETM_TYPE] === RETM_TYPES.RECEPTOR) {
    return true;
  }
  
  // Fallback to duck typing
  return component &&
    Array.isArray(component.topics) &&
    component.topics.length > 0 &&
    typeof component.transform === 'function';
}

/**
 * Check if a component implements the Transform interface
 */
export function isTransform(component: any): component is Transform {
  // Prefer explicit type marking
  if (component?.[RETM_TYPE] === RETM_TYPES.TRANSFORM) {
    return true;
  }
  
  // If explicitly marked as something else, not a transform
  if (component?.[RETM_TYPE] && component[RETM_TYPE] !== RETM_TYPES.TRANSFORM) {
    return false;
  }
  
  // Fallback to duck typing (sync process method, not effector/maintainer)
  return component &&
    typeof component.process === 'function' &&
    component.process.constructor.name !== 'AsyncFunction' &&  // Not effector
    component.process.length < 3; // Not maintainer (which takes 3 params)
}

/**
 * Check if a component implements the Effector interface
 */
export function isEffector(component: any): component is Effector {
  // Prefer explicit type marking
  if (component?.[RETM_TYPE] === RETM_TYPES.EFFECTOR) {
    return true;
  }
  
  // If explicitly marked as something else, not an effector
  if (component?.[RETM_TYPE] && component[RETM_TYPE] !== RETM_TYPES.EFFECTOR) {
    return false;
  }
  
  // Fallback to duck typing (async process method with 2 params)
  return component &&
    typeof component.process === 'function' &&
    component.process.constructor.name === 'AsyncFunction' &&
    component.process.length === 2; // Takes changes and state
}

/**
 * Check if a component implements the Maintainer interface
 */
export function isMaintainer(component: any): component is Maintainer {
  // Prefer explicit type marking
  if (component?.[RETM_TYPE] === RETM_TYPES.MAINTAINER) {
    return true;
  }
  
  // If explicitly marked as something else, not a maintainer
  if (component?.[RETM_TYPE] && component[RETM_TYPE] !== RETM_TYPES.MAINTAINER) {
    return false;
  }
  
  // Fallback to duck typing (process with 3 params: frame, changes, state)
  return component &&
    typeof component.process === 'function' &&
    component.process.length >= 3;
}

/**
 * Get all RETM interface types a component implements
 */
export function getRETMInterfaces(component: any): string[] {
  const interfaces: string[] = [];
  
  if (isModulator(component)) interfaces.push('Modulator');
  if (isReceptor(component)) interfaces.push('Receptor');
  if (isTransform(component)) interfaces.push('Transform');
  if (isEffector(component)) interfaces.push('Effector');
  if (isMaintainer(component)) interfaces.push('Maintainer');
  
  return interfaces;
}

/**
 * Check if a component implements any RETM interface
 */
export function isRETMComponent(component: any): boolean {
  return isModulator(component) ||
         isReceptor(component) ||
         isTransform(component) ||
         isEffector(component) ||
         isMaintainer(component);
}

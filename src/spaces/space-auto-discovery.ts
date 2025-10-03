/**
 * Auto-discovery methods for Space
 * These will be integrated into Space to eliminate dual registration
 */

import { Element } from './element';
import { Component } from './component';
import {
  Modulator,
  Receptor,
  Transform,
  Effector,
  Maintainer
} from './receptor-effector-types';
import {
  isModulator,
  isReceptor,
  isTransform,
  isEffector,
  isMaintainer
} from '../utils/retm-type-guards';

export class SpaceAutoDiscovery {
  /**
   * Traverse all components in the element tree
   */
  private traverseComponents(root: Element, callback: (component: Component) => void): void {
    const traverse = (element: Element) => {
      // Process this element's components
      for (const component of element.components) {
        callback(component);
      }
      
      // Recurse into children
      for (const child of element.children) {
        traverse(child);
      }
    };
    
    traverse(root);
  }
  
  /**
   * Discover all modulators in the element tree
   */
  discoverModulators(root: Element): Modulator[] {
    const modulators: Modulator[] = [];
    
    this.traverseComponents(root, (component) => {
      if (isModulator(component)) {
        modulators.push(component);
      }
    });
    
    return modulators;
  }
  
  /**
   * Discover all receptors in the element tree, grouped by topic
   */
  discoverReceptors(root: Element): Map<string, Receptor[]> {
    const receptorsByTopic = new Map<string, Receptor[]>();
    
    this.traverseComponents(root, (component) => {
      if (isReceptor(component)) {
        // Add to each topic this receptor handles
        for (const topic of component.topics) {
          const list = receptorsByTopic.get(topic) || [];
          list.push(component);
          receptorsByTopic.set(topic, list);
        }
      }
    });
    
    return receptorsByTopic;
  }
  
  /**
   * Discover all transforms in the element tree
   * Note: Maintains registration order within each element
   */
  discoverTransforms(root: Element): Transform[] {
    const transforms: Transform[] = [];
    
    this.traverseComponents(root, (component) => {
      if (isTransform(component)) {
        transforms.push(component);
      }
    });
    
    // TODO: Sort by priority when Transform.priority is added
    // For now, maintain discovery order
    
    // transforms.sort((a, b) => {
    //   const aPriority = a.priority;
    //   const bPriority = b.priority;
    //   
    //   if (aPriority !== undefined && bPriority !== undefined) {
    //     return aPriority - bPriority;
    //   }
    //   if (aPriority !== undefined) return -1;
    //   if (bPriority !== undefined) return 1;
    //   return 0; // Maintain discovery order
    // });
    
    return transforms;
  }
  
  /**
   * Discover all effectors in the element tree
   */
  discoverEffectors(root: Element): Effector[] {
    const effectors: Effector[] = [];
    
    this.traverseComponents(root, (component) => {
      if (isEffector(component)) {
        effectors.push(component);
      }
    });
    
    return effectors;
  }
  
  /**
   * Discover all maintainers in the element tree
   */
  discoverMaintainers(root: Element): Maintainer[] {
    const maintainers: Maintainer[] = [];
    
    this.traverseComponents(root, (component) => {
      if (isMaintainer(component)) {
        maintainers.push(component);
      }
    });
    
    return maintainers;
  }
  
  /**
   * Get discovery statistics for debugging
   */
  getDiscoveryStats(root: Element): {
    totalComponents: number;
    modulators: number;
    receptors: number;
    transforms: number;
    effectors: number;
    maintainers: number;
    unmatchedComponents: number;
  } {
    let totalComponents = 0;
    let modulators = 0;
    let receptors = 0;
    let transforms = 0;
    let effectors = 0;
    let maintainers = 0;
    
    this.traverseComponents(root, (component) => {
      totalComponents++;
      
      // Count each type (component might implement multiple)
      if (isModulator(component)) modulators++;
      if (isReceptor(component)) receptors++;
      if (isTransform(component)) transforms++;
      if (isEffector(component)) effectors++;
      if (isMaintainer(component)) maintainers++;
    });
    
    const retmComponents = modulators + receptors + transforms + effectors + maintainers;
    const unmatchedComponents = totalComponents - retmComponents;
    
    return {
      totalComponents,
      modulators,
      receptors,
      transforms,
      effectors,
      maintainers,
      unmatchedComponents
    };
  }
}

/**
 * Base implementations for MARTEM components
 * Provides default no-op implementations of Component lifecycle methods
 */

import { Element } from '../spaces/element';
import { Component } from '../spaces/component';
import { 
  Modulator,
  Receptor, 
  Transform, 
  Effector, 
  Maintainer,
  SpaceEvent,
  ReadonlyVEILState,
  FacetDelta,
  EffectorResult
} from '../spaces/receptor-effector-types';
import { Frame, Facet, VEILDelta } from '../veil/types';

/**
 * Base Modulator with default lifecycle
 */
export abstract class BaseModulator extends Component implements Modulator {
  abstract process(events: SpaceEvent[]): SpaceEvent[];
  
  reset?(): void;
  
  // Implement Component interface requirements
  async mount(element: Element): Promise<void> {
    this.element = element;
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }
}

/**
 * Base Receptor with default lifecycle
 */
export abstract class BaseReceptor extends Component implements Receptor {
  abstract topics: string[];
  abstract transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[];
  
  async mount(element: Element): Promise<void> {
    this.element = element;
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }
}

/**
 * Base Transform with default lifecycle
 */
export abstract class BaseTransform extends Component implements Transform {
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(state: ReadonlyVEILState): VEILDelta[];
  
  async mount(element: Element): Promise<void> {
    this.element = element;
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }
}

/**
 * Base Effector with default lifecycle
 */
export abstract class BaseEffector extends Component implements Effector {
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult>;
  
  async mount(element: Element): Promise<void> {
    this.element = element;
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }

  /**
   * Override emitFacet with validation for effectors
   * Effectors should primarily emit event/activation facets, not domain state
   */
  protected emitFacet(facet: import('../veil/types').Facet): void {
    // Validate effectors aren't creating state facets (should use Receptors/Transforms)
    if (facet.type === 'state' && !facet.type.includes('component-state')) {
      console.warn(
        `[${this.constructor.name}] Effector creating state facet '${facet.id}'. ` +
        `Consider using a Transform instead for domain state.`
      );
    }
    
    super.emitFacet(facet);
  }
}

/**
 * Base Maintainer with default lifecycle
 */
export abstract class BaseMaintainer extends Component implements Maintainer {
  abstract process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<import('../spaces/receptor-effector-types').MaintainerResult>;
  
  async mount(element: Element): Promise<void> {
    this.element = element;
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }
}

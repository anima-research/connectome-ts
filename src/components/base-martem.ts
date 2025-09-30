/**
 * Base implementations for MARTEM components
 * Provides default no-op implementations of Component lifecycle methods
 */

import { Element } from '../spaces/element';
import { Component } from '../types/component';
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
 * Base class with no-op lifecycle methods
 * Allows existing RETM implementations to work without changes
 */
abstract class BaseComponent implements Component {
  async mount(element: Element): Promise<void> {
    // No-op by default
  }
  
  async unmount(): Promise<void> {
    // No-op by default
  }
  
  async destroy(): Promise<void> {
    // No-op by default
  }
}

/**
 * Base Modulator with default lifecycle
 */
export abstract class BaseModulator extends BaseComponent implements Modulator {
  abstract process(events: SpaceEvent[]): SpaceEvent[];
  
  reset?(): void;
}

/**
 * Base Receptor with default lifecycle
 */
export abstract class BaseReceptor extends BaseComponent implements Receptor {
  abstract topics: string[];
  abstract transform(event: SpaceEvent, state: ReadonlyVEILState): Facet[];
}

/**
 * Base Transform with default lifecycle
 */
export abstract class BaseTransform extends BaseComponent implements Transform {
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(state: ReadonlyVEILState): VEILDelta[];
}

/**
 * Base Effector with default lifecycle
 */
export abstract class BaseEffector extends BaseComponent implements Effector {
  facetFilters?: import('../spaces/receptor-effector-types').FacetFilter[];
  abstract process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult>;
}

/**
 * Base Maintainer with default lifecycle
 */
export abstract class BaseMaintainer extends BaseComponent implements Maintainer {
  abstract process(frame: Frame, changes: FacetDelta[], state: ReadonlyVEILState): Promise<SpaceEvent[]>;
}

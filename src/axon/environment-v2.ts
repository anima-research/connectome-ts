/**
 * AXON Environment V2 - Extended with RETM Support
 * 
 * Provides Receptor/Effector/Transform/Maintainer interfaces to AXON modules
 */

import { Component } from '../spaces/component';
import { VEILComponent, InteractiveComponent } from '../components/base-components';
import { BaseAfferent } from '../components/base-afferent';
import { SpaceEvent } from '../spaces/types';
import { persistent, persistable } from '../persistence/decorators';
import { external } from '../host/decorators';
import { IAxonEnvironment } from '@connectome/axon-interfaces';
import { IAxonEnvironmentV2 } from './interfaces-v2';
import {
  Receptor,
  Effector,
  Transform,
  Maintainer,
  FacetDelta,
  ReadonlyVEILState,
  EffectorResult,
  ExternalAction
} from '../spaces/receptor-effector-types';
import {
  VEILDelta,
  Facet,
  SpeechFacet,
  EventFacet,
  StateFacet,
  ThoughtFacet,
  ActionFacet
} from '../veil/types';
import {
  createEventFacet,
  createSpeechFacet,
  createStateFacet,
  createThoughtFacet,
  createActionFacet,
  createAmbientFacet,
  createAgentActivation
} from '../helpers/factories';

// Re-export WebSocket for components that need it
let WebSocketImpl: any;
try {
  // Try to import ws for Node.js environments
  WebSocketImpl = require('ws');
} catch {
  // Fall back to browser WebSocket if available
  if (typeof WebSocket !== 'undefined') {
    WebSocketImpl = WebSocket;
  }
}

/**
 * Create the extended AXON environment with RETM support
 */
export function createAxonEnvironmentV2(): IAxonEnvironmentV2 {
  return {
    // Original component base classes
    Component: Component as any,
    VEILComponent: VEILComponent as any,
    InteractiveComponent: InteractiveComponent as any,
    BaseAfferent: BaseAfferent as any,
    
    // Decorators
    persistent,
    persistable,
    external,
    
    // Type references - SpaceEvent is created as a plain object
    SpaceEvent: class SpaceEvent {
      constructor(
        public topic: string, 
        public source: any, 
        public payload?: any, 
        public broadcast?: boolean
      ) {}
    } as any,
    
    // WebSocket
    WebSocket: WebSocketImpl,
    
    // New RETM interfaces (as abstract base classes for AXON)
    Receptor: class {
      topics: string[] = [];
      transform(event: SpaceEvent, state: ReadonlyVEILState): VEILDelta[] {
        throw new Error('Receptor.transform must be implemented');
      }
    } as any,
    
    Effector: class {
      facetFilters: any[] = [];
      async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
        throw new Error('Effector.process must be implemented');
      }
    } as any,
    
    Transform: class {
      process(state: ReadonlyVEILState): VEILDelta[] {
        throw new Error('Transform.process must be implemented');
      }
    } as any,
    
    Maintainer: class {
      maintain(state: ReadonlyVEILState): SpaceEvent[] {
        throw new Error('Maintainer.maintain must be implemented');
      }
    } as any,
    
    // Type constructors for AXON modules
    VEILDelta: class {} as any,
    FacetDelta: class {} as any,
    ReadonlyVEILState: class {} as any,
    EffectorResult: class {} as any,
    ExternalAction: class {} as any,
    
    // Facet types
    Facet: class {} as any,
    EventFacet: class {} as any,
    SpeechFacet: class {} as any,
    StateFacet: class {} as any,
    ThoughtFacet: class {} as any,
    ActionFacet: class {} as any,
    
    // Factory functions
    createEventFacet,
    createSpeechFacet,
    createStateFacet,
    createThoughtFacet,
    createActionFacet,
    createAmbientFacet,
    createAgentActivation,
    
    // Helper to check if state has facet
    hasFacet: (state: ReadonlyVEILState, id: string) => state.hasFacet(id),
    
    // Helper to get facets by type
    getFacetsByType: (state: ReadonlyVEILState, type: string) => 
      state.getFacetsByType(type)
  };
}

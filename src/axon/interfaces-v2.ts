/**
 * Extended AXON Interfaces for RETM Support
 */

import { IAxonManifest, IAxonEnvironment } from '@connectome/axon-interfaces';

/**
 * Extended manifest for RETM modules
 */
export interface IAxonManifestV2 extends IAxonManifest {
  // New fields for RETM exports
  exports?: {
    components?: string[];      // Component class names
    receptors?: string[];       // Receptor class/function names
    effectors?: string[];       // Effector class names
    transforms?: string[];      // Transform class/function names
    maintainers?: string[];     // Maintainer class names
  };
  
  // Metadata for each export
  metadata?: {
    [exportName: string]: {
      description?: string;
      topics?: string[];        // For Receptors
      facetFilters?: any[];     // For Effectors
      requirements?: string[];  // External dependencies needed
    };
  };
}

/**
 * Module exports structure for RETM modules
 */
export interface IAxonRETMExports {
  // Traditional component (optional)
  default?: any;
  component?: any;
  
  // RETM exports
  receptors?: Record<string, any>;
  effectors?: Record<string, any>;
  transforms?: Record<string, any>;
  maintainers?: Record<string, any>;
}

/**
 * Extended AXON Environment with RETM support
 */
export interface IAxonEnvironmentV2 extends IAxonEnvironment {
  // Component base classes
  BaseAfferent: any;
  
  // RETM base classes/interfaces
  Receptor: any;
  Effector: any;
  Transform: any;
  Maintainer: any;
  
  // Helper types
  VEILDelta: any;
  FacetDelta: any;
  ReadonlyVEILState: any;
  EffectorResult: any;
  ExternalAction: any;
  
  // Facet types
  Facet: any;
  EventFacet: any;
  SpeechFacet: any;
  StateFacet: any;
  ThoughtFacet: any;
  ActionFacet: any;
  
  // Factory functions
  createEventFacet: any;
  createSpeechFacet: any;
  createStateFacet: any;
  createThoughtFacet: any;
  createActionFacet: any;
  createAmbientFacet: any;
  createAgentActivation: any;
  
  // Helper functions
  hasFacet: (state: any, id: string) => boolean;
  getFacetsByType: (state: any, type: string) => any[];
}

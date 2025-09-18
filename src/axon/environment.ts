/**
 * AXON Environment Implementation
 * 
 * Provides concrete implementations of AXON interfaces using Connectome internals
 */

import { Component } from '../spaces/component';
import { VEILComponent, InteractiveComponent } from '../components/base-components';
import { SpaceEvent } from '../spaces/types';
import { persistent, persistable } from '../persistence/decorators';
import { external } from '../host/decorators';
import { IAxonEnvironment } from './interfaces';

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
 * Create the AXON environment with all necessary dependencies
 */
export function createAxonEnvironment(): IAxonEnvironment {
  return {
    // Component base classes
    Component: Component as any,
    VEILComponent: VEILComponent as any,
    InteractiveComponent: InteractiveComponent as any,
    
    // Decorators
    persistent,
    persistable,
    external,
    
    // Type references - SpaceEvent is created as a plain object
    SpaceEvent: class SpaceEvent {
      constructor(public topic: string, public source: any, public payload?: any, public broadcast?: boolean) {}
    } as any,
    
    // WebSocket
    WebSocket: WebSocketImpl
  };
}

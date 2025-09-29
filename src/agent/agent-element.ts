/**
 * AgentElement - A specialized Element for hosting agents
 * 
 * This ensures proper element type identification for 
 * frame attribution and debugging.
 */

import { Element } from '../spaces/element';

export class AgentElement extends Element {
  constructor(name: string, id?: string) {
    super(name, id);
  }
  
  /**
   * Override getRef to include proper element type
   */
  getRef() {
    const ref = super.getRef();
    return {
      ...ref,
      elementType: 'AgentElement'
    };
  }
}


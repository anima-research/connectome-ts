import { Element } from '../spaces/element';
import { StateComponent, InteractiveComponent } from './base-components';
import { SpaceEvent } from '../spaces/types';
import { stopPropagation } from '../spaces/event-utils';

/**
 * Box configuration
 */
export interface BoxConfig {
  id: string;
  size: 'small' | 'medium' | 'large';
  color: 'red' | 'blue' | 'green' | 'rainbow';
  contents?: string;
}

/**
 * Box state
 */
interface BoxState {
  isOpen: boolean;
  size: string;
  color: string;
  contents: string;
}

/**
 * Component that manages box state and VEIL
 */
export class BoxStateComponent extends StateComponent<BoxState> {
  constructor(config: BoxConfig) {
    super({
      isOpen: false,
      size: config.size,
      color: config.color,
      contents: config.contents || 'Something mysterious'
    }, `box-${config.id}-state`);
  }
  
  onFirstFrame(): void {
    // Initialize state facet
    this.addFacet({
      id: this.stateId,
      type: 'state',
      displayName: 'box_info',
      content: this.getStateDescription(),
      attributes: this.state
    });
  }
  
  protected emitStateUpdate(): void {
    this.updateState(this.stateId, {
      content: this.getStateDescription(),
      attributes: this.state
    });
  }
  
  private getStateDescription(): string {
    const { isOpen, size, color, contents } = this.state;
    if (isOpen) {
      return `The ${size} ${color} box is open, revealing ${contents}!`;
    }
    return `A ${size} ${color} box sits here, closed and mysterious.`;
  }
  
  open(): void {
    if (!this.state.isOpen) {
      this.setState({ isOpen: true });
      
      // Emit event facet for the opening
      this.addFacet({
        id: `${this.stateId}-opened-${Date.now()}`,
        type: 'event',
        content: `💥 The ${this.state.color} box opens with a ${this.getOpeningEffect()}!`
      });
    }
  }
  
  private getOpeningEffect(): string {
    switch (this.state.color) {
      case 'red': return 'burst of flame';
      case 'blue': return 'splash of water';
      case 'green': return 'shower of leaves';
      case 'rainbow': return 'cascade of rainbow sparkles';
      default: return 'puff of smoke';
    }
  }
}

/**
 * Component that handles box interactions
 */
class BoxInteractionComponent extends InteractiveComponent {
  // Declare available actions for auto-registration
  static actions = {
    open: {
      description: 'Open this mysterious box',
      params: { 
        type: 'object',
        properties: {
          method: { 
            type: 'string', 
            enum: ['gently', 'forcefully', 'carefully'],
            description: 'How to open the box'
          }
        }
      }
    }
  };
  
  private stateComponent!: BoxStateComponent;
  
  onMount(): void {
    this.stateComponent = this.element.getComponent(BoxStateComponent)!;
    
    // Register open action
    this.registerAction('open', async (params) => {
      await this.openBox(params?.method || 'normally');
    });
    
    // No need to subscribe to element:action - base Element handles this
  }
  
  async onFirstFrame(): Promise<void> {
    const state = this.stateComponent.getState();
    if (!state.isOpen) {
      this.addFacet({
        id: `${this.element.id}-actions`,
        type: 'ambient',
        scope: [this.element.id],
        content: `You can open this box with @${this.element.id}.open()`
      });
    }
  }
  
  async openBox(method: string): Promise<void> {
    const state = this.stateComponent.getState();
    
    if (state.isOpen) {
      this.addFacet({
        id: `box-${this.element.id}-already-open`,
        type: 'event',
        content: 'The box is already open!'
      });
      return;
    }
    
    // Open the box
    this.stateComponent.open();
    
    // Emit activation for agent to react
    this.addOperation({
      type: 'agentActivation',
      source: this.element.name,
      reason: `Box opened ${method}`,
      priority: 'high'
    });
  }
}

/**
 * Create a box element with state and interaction components
 */
export function createBox(config: BoxConfig): Element {
  const boxId = `box-${config.id}`;
  const box = new Element(boxId, boxId);
  
  // Add components
  box.addComponent(new BoxStateComponent(config));
  box.addComponent(new BoxInteractionComponent());
  
  return box;
}

// For backwards compatibility, export Box as the factory function
export const Box = createBox;

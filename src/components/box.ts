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
class BoxStateComponent extends StateComponent<BoxState> {
  constructor(config: BoxConfig) {
    super({
      isOpen: false,
      size: config.size,
      color: config.color,
      contents: config.contents || 'Something mysterious'
    }, `box-${config.id}-state`);
  }
  
  onMount(): void {
    // We'll emit initial state on first frame
    this.element.subscribe('frame:start');
    this._initialized = false;
  }
  
  private _initialized = false;
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    if (event.topic === 'frame:start' && !this._initialized) {
      this._initialized = true;
      this.addFacet({
        id: this.stateId,
        type: 'state',
        displayName: 'box_info',
        content: this.getStateDescription(),
        attributes: this.state
      });
    }
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
  private stateComponent!: BoxStateComponent;
  
  onMount(): void {
    this.stateComponent = this.element.getComponent(BoxStateComponent)!;
    
    // Register open action
    this.registerAction('open', async (params) => {
      await this.openBox(params?.method || 'normally');
    });
    
    // Subscribe to action events
    this.element.subscribe('element:action');
  }
  
  private async openBox(method: string): Promise<void> {
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
 * Box element that can be opened to reveal contents
 */
export class Box extends Element {
  constructor(config: BoxConfig) {
    const boxId = `box-${config.id}`;
    super(boxId, boxId); // name and id both set to same value
    
    // Add components
    this.addComponent(new BoxStateComponent(config));
    this.addComponent(new BoxInteractionComponent());
  }
}

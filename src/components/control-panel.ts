import { StateComponent } from './base-components';
import { SpaceEvent } from '../spaces/types';

/**
 * Control panel settings
 */
export interface ControlPanelSettings {
  size: 'small' | 'medium' | 'large';
  color: 'red' | 'blue' | 'green' | 'rainbow';
}

/**
 * Component that manages control panel state
 */
export class ControlPanelComponent extends StateComponent<ControlPanelSettings> {
  constructor() {
    super({
      size: 'medium',
      color: 'rainbow'
    }, 'control-panel-settings');
  }
  
  onMount(): void {
    // Subscribe to setting change events using convenience method
    this.subscribe('control:*');
  }
  
  onFirstFrame(): void {
    // Initialize state facet
    this.addFacet({
      id: this.stateId,
      type: 'state',
      displayName: 'control_panel',
      content: this.getSettingsDescription(),
      scope: ['dispenser'],
      attributes: this.state
    });
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    if (event.topic === 'control:size') {
      const size = event.payload as any;
      if (['small', 'medium', 'large'].includes(size)) {
        this.setState({ size });
      }
    } else if (event.topic === 'control:color') {
      const color = event.payload as any;
      if (['red', 'blue', 'green', 'rainbow'].includes(color)) {
        this.setState({ color });
      }
    }
  }
  
  protected emitStateUpdate(): void {
    this.updateState(this.stateId, {
      content: this.getSettingsDescription(),
      attributes: this.state
    });
  }
  
  private getSettingsDescription(): string {
    return `Control Panel Settings:
- Size: ${this.state.size}
- Color: ${this.state.color}

You can change settings with:
@dispenser.setSize("small"|"medium"|"large")
@dispenser.setColor("red"|"blue"|"green"|"rainbow")`;
  }
  
  getSettings(): ControlPanelSettings {
    return { ...this.state };
  }
}

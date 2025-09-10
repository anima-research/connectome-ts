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
    // Subscribe to setting change events
    this.element.subscribe('control:*');
    this.element.subscribe('frame:start');
    
    // We'll add the facet on first frame
    this._initialized = false;
  }
  
  private _initialized = false;
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    // Initialize on first frame
    if (event.topic === 'frame:start' && !this._initialized) {
      this._initialized = true;
      this.addFacet({
        id: this.stateId,
        type: 'state',
        displayName: 'control_panel',
        content: this.getSettingsDescription(),
        scope: ['dispenser'],
        attributes: this.state
      });
    }
    
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

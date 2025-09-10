import { Element } from '../spaces/element';
import { InteractiveComponent, VEILComponent } from './base-components';
import { ControlPanelComponent } from './control-panel';
import { ContentGeneratorComponent } from './content-generator';
import { Box } from './box';
import { SpaceEvent } from '../spaces/types';
import { LLMProvider } from '../llm/llm-interface';

/**
 * Component that handles box dispensing
 */
class BoxDispenserComponent extends InteractiveComponent {
  private controlPanel!: ControlPanelComponent;
  private contentGenerator!: ContentGeneratorComponent;
  private boxCount = 0;
  
  onMount(): void {
    // Get other components
    this.controlPanel = this.element.getComponent(ControlPanelComponent)!;
    this.contentGenerator = this.element.getComponent(ContentGeneratorComponent)!;
    
    // Register actions
    this.registerAction('dispense', async () => this.dispenseBox());
    this.registerAction('setSize', async (params) => this.setSize(params?.value || params));
    this.registerAction('setColor', async (params) => this.setColor(params?.value || params));
    
    // Subscribe to events
    this.element.subscribe('element:action');
    this.element.subscribe('button:pressed');
    this.element.subscribe('frame:start');
    
    // We'll add initial facets on first frame
    this._initialized = false;
  }
  
  private _initialized = false;
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Initialize on first frame
    if (event.topic === 'frame:start' && !this._initialized) {
      this._initialized = true;
      
      // Add initial state
      this.addFacet({
        id: 'dispenser-state',
        type: 'state',
        displayName: 'dispenser',
        content: 'A magical box dispenser with a big red button and a control panel.',
        attributes: {
          boxesDispensed: 0
        }
      });
      
      // Add ambient instructions
      this.addFacet({
        id: 'dispenser-instructions',
        type: 'ambient',
        scope: ['dispenser'],
        content: `Available actions:
- @dispenser.dispense() - Press the button to dispense a new box
- @dispenser.setSize("small"|"medium"|"large") - Change box size
- @dispenser.setColor("red"|"blue"|"green"|"rainbow") - Change box color`
      });
    }
    
    // Handle button press
    if (event.topic === 'button:pressed') {
      await this.dispenseBox();
    }
  }
  
  private async dispenseBox(): Promise<void> {
    const settings = this.controlPanel.getSettings();
    this.boxCount++;
    
    // Generate unique contents
    const contents = await this.contentGenerator.generateContents(
      settings.size,
      settings.color
    );
    
    // Create new box
    const box = new Box({
      id: `${this.boxCount}`,
      size: settings.size,
      color: settings.color,
      contents
    });
    
    // Add box to the space
    this.element.parent?.addChild(box);
    
    // Emit events
    this.addFacet({
      id: `dispense-${this.boxCount}`,
      type: 'event',
      content: `🎁 *WHIRRR* *CLICK* A new ${settings.size} ${settings.color} box materializes!`
    });
    
    // Update dispenser state
    this.updateState('dispenser-state', {
      attributes: {
        boxesDispensed: this.boxCount
      }
    });
    
    // Trigger agent activation
    this.addOperation({
      type: 'agentActivation',
      source: 'dispenser',
      reason: 'New box dispensed',
      priority: 'normal'
    });
  }
  
  private async setSize(size: string): Promise<void> {
    if (['small', 'medium', 'large'].includes(size)) {
      this.element.emit({
        topic: 'control:size',
        payload: size,
        source: this.element.getRef(),
        timestamp: Date.now()
      });
      
      this.addFacet({
        id: `size-change-${Date.now()}`,
        type: 'event',
        content: `The control panel clicks as the size dial turns to "${size}".`
      });
    }
  }
  
  private async setColor(color: string): Promise<void> {
    if (['red', 'blue', 'green', 'rainbow'].includes(color)) {
      this.element.emit({
        topic: 'control:color',
        payload: color,
        source: this.element.getRef(),
        timestamp: Date.now()
      });
      
      this.addFacet({
        id: `color-change-${Date.now()}`,
        type: 'event',
        content: `The control panel's color selector shifts to ${color} with a soft hum.`
      });
    }
  }
}

/**
 * Component that represents the dispense button
 */
class DispenseButtonComponent extends VEILComponent {
  onMount(): void {
    // Subscribe to frame start
    this.element.subscribe('frame:start');
    this._initialized = false;
  }
  
  private _initialized = false;
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    if (event.topic === 'frame:start' && !this._initialized) {
      this._initialized = true;
      this.addFacet({
        id: 'dispense-button',
        type: 'state',
        displayName: 'button',
        content: 'A big, inviting red button labeled "DISPENSE"'
      });
    }
  }
  
  /**
   * Press the button
   */
  press(): void {
    this.addFacet({
      id: `button-press-${Date.now()}`,
      type: 'event',
      content: '*CLICK* The button depresses with a satisfying mechanical sound.'
    });
    
    // Emit button press event
    this.element.emit({
      topic: 'button:pressed',
      source: this.element.getRef(),
      payload: {},
      timestamp: Date.now(),
      bubbles: true // Let it bubble up to dispenser
    });
  }
}

/**
 * Box dispenser element that creates new boxes
 */
export class BoxDispenser extends Element {
  constructor(llmProvider: LLMProvider) {
    super('dispenser', 'dispenser'); // name and id both set to 'dispenser'
    
    // Add components
    this.addComponent(new ControlPanelComponent());
    this.addComponent(new ContentGeneratorComponent(llmProvider));
    this.addComponent(new BoxDispenserComponent());
    this.addComponent(new DispenseButtonComponent());
  }
}

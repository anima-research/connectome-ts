/**
 * Register core Connectome components
 * 
 * This file registers built-in components that are part of the
 * Connectome core system. Extension components (like box dispenser)
 * should eventually be loaded via AXON.
 */

import { ComponentRegistry } from './persistence/component-registry';

// Core components
import { AgentComponent } from './agent/agent-component';
import { ConsoleChatComponent } from './elements/console-chat';
import { SpaceNotesComponent } from './components/space-notes';

// Register core components
ComponentRegistry.register('AgentComponent', AgentComponent);
ComponentRegistry.register('ConsoleChatComponent', ConsoleChatComponent);
ComponentRegistry.register('SpaceNotesComponent', SpaceNotesComponent);

// Temporary: Register test components
// TODO: Move these to AXON extensions
import { 
  BoxDispenserComponent,
  DispenseButtonComponent
} from './components/box-dispenser';
import { ControlPanelComponent } from './components/control-panel';
import { ContentGeneratorComponent } from './components/content-generator';
import { BoxStateComponent } from './components/box';

// These should be AXON components in the future
ComponentRegistry.register('BoxDispenserComponent', BoxDispenserComponent);
ComponentRegistry.register('ControlPanelComponent', ControlPanelComponent);
ComponentRegistry.register('ContentGeneratorComponent', ContentGeneratorComponent);
ComponentRegistry.register('DispenseButtonComponent', DispenseButtonComponent);
ComponentRegistry.register('BoxStateComponent', BoxStateComponent);

console.log('Core components registered:', ComponentRegistry.getRegisteredNames());

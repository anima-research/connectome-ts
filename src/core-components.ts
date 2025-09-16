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

// Register core components
ComponentRegistry.register('AgentComponent', AgentComponent);
ComponentRegistry.register('ConsoleChatComponent', ConsoleChatComponent);

// Temporary: Register test components
// TODO: Move these to AXON extensions
import { 
  BoxDispenserComponent,
  DispenseButtonComponent
} from './components/box-dispenser';
import { ControlPanelComponent } from './components/control-panel';
import { ContentGeneratorComponent } from './components/content-generator';
import { BoxStateComponent } from './components/box';
import { DiscordAxonComponent } from './components/discord-axon';
import { DiscordChatComponent } from './components/discord-chat';

// These should be AXON components in the future
ComponentRegistry.register('BoxDispenserComponent', BoxDispenserComponent);
ComponentRegistry.register('ControlPanelComponent', ControlPanelComponent);
ComponentRegistry.register('ContentGeneratorComponent', ContentGeneratorComponent);
ComponentRegistry.register('DispenseButtonComponent', DispenseButtonComponent);
ComponentRegistry.register('BoxStateComponent', BoxStateComponent);
ComponentRegistry.register('DiscordAxonComponent', DiscordAxonComponent);
ComponentRegistry.register('DiscordChatComponent', DiscordChatComponent);

console.log('Core components registered:', ComponentRegistry.getRegisteredNames());

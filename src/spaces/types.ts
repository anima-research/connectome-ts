/**
 * Core types for the Space/Element system
 */

/**
 * Element reference that can survive serialization
 */
export interface ElementRef {
  elementId: string;
  elementPath: string[];  // ["root", "discord", "channel-handler"]
  elementType?: string;   // Optional type hint
}

/**
 * Stream reference with metadata
 */
export interface StreamRef {
  streamId: string;
  streamType: string;  // "discord", "terminal", "minecraft", etc.
  metadata?: Record<string, any>;  // Adapter-specific metadata
}

/**
 * Event priority levels
 * - immediate: For agent action processing frames (never preempted)
 * - high: User messages, important system events
 * - normal: Default priority for most events
 * - low: Background tasks, periodic updates
 */
export type EventPriority = 'immediate' | 'high' | 'normal' | 'low';

/**
 * Base event class for the Space system
 */
export interface SpaceEvent<T = unknown> {
  topic: string;  // "discord.message", "timer.expired", "agent.response"
  source: ElementRef;
  payload: T;
  timestamp: number;
  priority?: EventPriority;  // Defaults to 'normal'
  metadata?: Record<string, any>;
}

/**
 * Frame lifecycle events
 */
export interface FrameStartEvent extends SpaceEvent<{ frameId: number }> {
  topic: 'frame:start';
}

export interface FrameEndEvent extends SpaceEvent<{ 
  frameId: number; 
  hasOperations: boolean;
  hasActivation: boolean;
}> {
  topic: 'frame:end';
}

/**
 * Time events
 */
export interface TimeEvent extends SpaceEvent<{ 
  timestamp: number;
  delta: number;
}> {
  topic: 'time:tick';
}

/**
 * Element lifecycle events
 */
export interface ElementMountEvent extends SpaceEvent<{ element: ElementRef }> {
  topic: 'element:mount';
}

export interface ElementUnmountEvent extends SpaceEvent<{ element: ElementRef }> {
  topic: 'element:unmount';
}

/**
 * Agent response event for routing speak operations
 */
export interface AgentResponseEvent extends SpaceEvent<{
  content: string;
  streamRef?: StreamRef;
  metadata?: Record<string, any>;
}> {
  topic: 'agent:response';
}

/**
 * Component lifecycle interface
 */
export interface ComponentLifecycle {
  onMount?(): void | Promise<void>;
  onUnmount?(): void | Promise<void>;
  onEnable?(): void | Promise<void>;
  onDisable?(): void | Promise<void>;
}

/**
 * Event handler interface
 */
export interface EventHandler {
  handleEvent(event: SpaceEvent): void | Promise<void>;
}

/**
 * Topic subscription configuration
 */
export interface TopicSubscription {
  pattern: string;  // "discord.*", "timer.expired", etc.
  handler: (event: SpaceEvent) => void | Promise<void>;
}

/**
 * Agent interface that processes completed frames
 */
export interface AgentInterface {
  /**
   * Called after all components have processed frame:end
   * Returns outgoing frame if agent generates a response
   */
  onFrameComplete(frame: any, state: any): Promise<any>;
  
  /**
   * Check if activation should proceed
   */
  shouldActivate(activation: any, state: any): boolean;
  
  /**
   * Perform the agent cycle
   */
  runCycle(context: any, streamRef?: StreamRef): Promise<any>;
  
  /**
   * Handle special agent commands (sleep, ignore, etc.)
   */
  handleCommand?(command: any): void;
}

/**
 * Types for the Agent system
 */

import { IncomingVEILFrame, OutgoingVEILFrame, OutgoingVEILOperation, AgentActivationOperation, VEILState, StreamRef } from '../veil/types';
import { RenderedContext } from '../hud/types-v2';

/**
 * Result from parsing an LLM completion
 */
export interface ParsedCompletion {
  operations: OutgoingVEILOperation[];
  hasMoreToSay: boolean;
  rawContent: string;
}

/**
 * Tool definition for the agent
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON schema
  handler: (params: any) => Promise<any>;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name?: string;
  systemPrompt?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  tools?: ToolDefinition[];
}

/**
 * Agent state that can be modified by commands
 */
export interface AgentState {
  sleeping: boolean;
  ignoringSources: Set<string>;
  attentionThreshold: number;
  pendingActivations?: AgentActivationOperation[];
}

/**
 * Agent command types
 */
export type AgentCommand = 
  | { type: 'sleep'; duration?: number }
  | { type: 'wake' }
  | { type: 'ignore'; source: string }
  | { type: 'unignore'; source: string }
  | { type: 'setThreshold'; threshold: number };

/**
 * Core agent interface
 */
export interface AgentInterface {
  /**
   * Called after all components have processed frame:end
   * Returns outgoing frame if agent generates a response
   */
  onFrameComplete(frame: IncomingVEILFrame, state: VEILState): Promise<OutgoingVEILFrame | undefined>;
  
  /**
   * Check if activation should proceed
   */
  shouldActivate(activation: AgentActivationOperation, state: VEILState): boolean;
  
  /**
   * Perform the agent cycle
   */
  runCycle(context: RenderedContext, streamRef?: StreamRef): Promise<OutgoingVEILFrame>;
  
  /**
   * Parse LLM completion into VEIL operations
   */
  parseCompletion(completion: string): ParsedCompletion;
  
  /**
   * Handle special agent commands
   */
  handleCommand(command: AgentCommand): void;
  
  /**
   * Get current agent state
   */
  getState(): AgentState;
  
  /**
   * Check if there are pending activations that should be processed
   */
  hasPendingActivations(): boolean;
  
  /**
   * Get and clear the first pending activation
   */
  popPendingActivation(): AgentActivationOperation | undefined;
}

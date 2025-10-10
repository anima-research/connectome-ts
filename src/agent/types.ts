/**
 * Types for the Agent system
 */

import { Frame, OutgoingVEILOperation, VEILState, StreamRef } from '../veil/types';
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
  
  // Element routing
  elementPath?: string[];  // e.g., ['box'] for @box.open
  elementId?: string;      // Direct element ID reference
  
  // Event emission
  emitEvent?: {
    topic: string;          // e.g., 'box:action'
    payloadTemplate?: any;  // Template for event payload, can use {params} placeholder
  };
  
  // Legacy handler (optional, for backward compatibility)
  handler?: (params: any) => Promise<any>;
}

/**
 * Configuration for bulk action registration
 */
export interface ActionConfig {
  description: string;
  params?: string[] | any;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name?: string;
  systemPrompt?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;  // Max tokens for LLM generation (e.g., 200-1000)
  contextTokenBudget?: number;  // Token budget for context window (e.g., 4000-8000)
  tools?: ToolDefinition[];
}

/**
 * Agent state that can be modified by commands
 */
export interface AgentState {
  sleeping: boolean;
  ignoringSources: Set<string>;
  attentionThreshold: number;
  // Note: pendingActivations removed - activation facets remain in state until processed
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
   * Returns an agent-generated frame if the agent produces a response
   */
  onFrameComplete(frame: Frame, state: VEILState): Promise<Frame | undefined>;
  
  /**
   * Check if activation should proceed
   */
  shouldActivate(activation: any, state: VEILState): boolean;
  
  /**
   * Perform the agent cycle
   */
  runCycle(context: RenderedContext, streamRef?: StreamRef): Promise<Frame>;
  
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
   * @deprecated Activation facets remain in state until processed
   */
  hasPendingActivations(): boolean;
}

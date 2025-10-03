/**
 * Factory functions for creating agents with a cleaner API
 */

import { BasicAgent } from './basic-agent';
import { AgentConfig } from './types';
import { LLMProvider } from '../llm/llm-interface';
import { VEILStateManager } from '../veil/veil-state';

/**
 * Options for creating a BasicAgent
 * All configuration in one intuitive object
 */
export interface CreateAgentOptions {
  // Required
  name: string;
  provider: LLMProvider;
  
  // Optional agent configuration
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  contextTokenBudget?: number;
  tools?: any[];
  
  // Optional infrastructure
  veilStateManager?: VEILStateManager;
  // Note: compressionEngine removed - use CompressionTransform + ContextTransform for compression
}

/**
 * Creates a BasicAgent with a more intuitive API
 * 
 * @example
 * const agent = createBasicAgent({
 *   name: 'Assistant',
 *   provider: myLLMProvider,
 *   systemPrompt: 'You are a helpful assistant',
 *   temperature: 0.7
 * });
 */
export function createBasicAgent(options: CreateAgentOptions): BasicAgent {
  const {
    name,
    provider,
    systemPrompt,
    maxTokens,
    contextTokenBudget,
    tools,
    veilStateManager
  } = options;
  
  // Build config from options
  const config: AgentConfig = {
    name,
    systemPrompt,
    defaultMaxTokens: maxTokens,
    contextTokenBudget,
    tools
  };
  
  // Create agent with separated parameters (old way)
  return new BasicAgent(
    config,
    provider,
    veilStateManager
  );
}

/**
 * Alternative: Update BasicAgent to accept both patterns
 * This would be added to basic-agent.ts
 * 
 * @example
 * // Old way still works
 * new BasicAgent(config, provider, veilState);
 * 
 * // New way with options
 * new BasicAgent({
 *   config: { name: 'Assistant', ... },
 *   provider: myProvider,
 *   veilStateManager: veilState
 * });
 */
export type BasicAgentConstructorOptions = {
  config: AgentConfig;
  provider: LLMProvider;
  veilStateManager?: VEILStateManager;
  // Note: compressionEngine removed - use CompressionTransform + ContextTransform for compression
};

/**
 * Helper to detect if constructor argument is the new options pattern
 */
export function isAgentOptions(arg: any): arg is BasicAgentConstructorOptions {
  return arg && typeof arg === 'object' && 'config' in arg && 'provider' in arg;
}

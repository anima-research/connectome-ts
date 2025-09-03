/**
 * LLM provider interface
 */
export interface LLMProvider {
  complete(
    systemPrompt: string,
    messages: Array<{role: 'user' | 'assistant'; content: string}>,
    config?: {
      temperature?: number;
      maxTokens?: number;
      stopSequences?: string[];
    }
  ): Promise<string>;
}

/**
 * Configuration for agent loop
 */
export interface AgentLoopConfig {
  llmProvider: LLMProvider;
  maxCycles?: number;  // Maximum cycles in one activation
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

/**
 * Result of an agent activation
 */
export interface AgentActivationResult {
  cycles: number;
  totalTokens?: number;
  stopped: 'max_cycles' | 'no_activation' | 'error' | 'complete';
  error?: Error;
}

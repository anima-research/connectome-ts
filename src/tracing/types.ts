/**
 * Tracing system types
 * 
 * Provides observability into the system's internal operations.
 * Not just "logging" - this is core infrastructure for understanding
 * and debugging complex event flows.
 */

export interface TraceEvent {
  id: string;
  timestamp: number;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  category: TraceCategory;
  component: string;  // e.g., "Space", "BasicAgent", "ConsoleChat"
  operation: string;  // e.g., "processFrame", "handleEvent", "generate"
  data: Record<string, any>;
  parentId?: string;  // For tracing nested operations
  duration?: number;  // For completed operations
}

export enum TraceCategory {
  // Event system
  EVENT_EMIT = 'event.emit',
  EVENT_RECEIVE = 'event.receive',
  EVENT_QUEUE = 'event.queue',
  
  // Frame processing
  FRAME_START = 'frame.start',
  FRAME_END = 'frame.end',
  FRAME_OPERATION = 'frame.operation',
  
  // VEIL operations
  VEIL_STATE_CHANGE = 'veil.state_change',
  VEIL_FACET_ADD = 'veil.facet_add',
  VEIL_STREAM_UPDATE = 'veil.stream_update',
  
  // Agent operations
  AGENT_ACTIVATION = 'agent.activation',
  AGENT_CONTEXT_BUILD = 'agent.context_build',
  AGENT_LLM_CALL = 'agent.llm_call',
  AGENT_RESPONSE_PARSE = 'agent.response_parse',
  AGENT_TOOL_CALL = 'agent.tool_call',
  
  // LLM interactions
  LLM_REQUEST = 'llm.request',
  LLM_RESPONSE = 'llm.response',
  LLM_ERROR = 'llm.error',
  LLM_TOKEN_USAGE = 'llm.token_usage',
  
  // Adapter operations
  ADAPTER_INPUT = 'adapter.input',
  ADAPTER_OUTPUT = 'adapter.output',
  
  // HUD operations
  HUD_RENDER = 'hud.render',
  HUD_COMPRESS = 'hud.compress',
  
  // System operations
  SYSTEM_ERROR = 'system.error',
  SYSTEM_LIFECYCLE = 'system.lifecycle'
}

export interface TraceSpan {
  id: string;
  startTime: number;
  endTime?: number;
  operation: string;
  component: string;
  events: TraceEvent[];
  metadata?: Record<string, any>;
}

export interface TraceQuery {
  categories?: TraceCategory[];
  components?: string[];
  operations?: string[];
  timeRange?: {
    start: number;
    end: number;
  };
  parentId?: string;
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

export interface TraceStorage {
  record(event: TraceEvent): void;
  query(query: TraceQuery): TraceEvent[];
  startSpan(operation: string, component: string): TraceSpan;
  endSpan(spanId: string): void;
  getSpan(spanId: string): TraceSpan | undefined;
  export(format: 'json' | 'csv' | 'markdown'): string;
  clear(): void;
}

export interface Traceable {
  tracer?: TraceStorage;
  trace(
    level: TraceEvent['level'],
    category: TraceCategory,
    operation: string,
    data: Record<string, any>
  ): void;
}

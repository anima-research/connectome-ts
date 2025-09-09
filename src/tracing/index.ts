/**
 * Tracing system exports
 */

export * from './types';
export { MemoryTraceStorage } from './memory-trace-storage';

import { MemoryTraceStorage } from './memory-trace-storage';
import { TraceStorage } from './types';

// Global tracer instance
let globalTracer: TraceStorage | undefined;

export function setGlobalTracer(tracer: TraceStorage): void {
  globalTracer = tracer;
}

export function getGlobalTracer(): TraceStorage | undefined {
  return globalTracer;
}

export function createDefaultTracer(): TraceStorage {
  const tracer = new MemoryTraceStorage();
  setGlobalTracer(tracer);
  return tracer;
}

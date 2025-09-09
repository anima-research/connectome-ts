/**
 * Tracing system exports
 */

export * from './types';
export { MemoryTraceStorage } from './memory-trace-storage';
export { FileTraceStorage, FileTraceStorageConfig } from './file-trace-storage';

import { MemoryTraceStorage } from './memory-trace-storage';
import { FileTraceStorage, FileTraceStorageConfig } from './file-trace-storage';
import { TraceStorage } from './types';

// Global tracer instance
let globalTracer: TraceStorage | undefined;

export function setGlobalTracer(tracer: TraceStorage): void {
  globalTracer = tracer;
}

export function getGlobalTracer(): TraceStorage | undefined {
  return globalTracer;
}

export interface TracerConfig {
  type: 'memory' | 'file';
  fileConfig?: FileTraceStorageConfig;
}

export function createTracer(config?: TracerConfig): TraceStorage {
  if (!config || config.type === 'memory') {
    return new MemoryTraceStorage();
  }
  
  if (config.type === 'file') {
    if (!config.fileConfig) {
      throw new Error('File tracer requires fileConfig');
    }
    return new FileTraceStorage(config.fileConfig);
  }
  
  return new MemoryTraceStorage();
}

export function createDefaultTracer(config?: TracerConfig): TraceStorage {
  const tracer = createTracer(config);
  setGlobalTracer(tracer);
  return tracer;
}

/**
 * File-based trace storage implementation
 * Persists traces to disk for long-term analysis
 */

import * as fs from 'fs';
import * as path from 'path';
import { TraceStorage, TraceEvent, TraceSpan, TraceCategory, TraceQuery } from './types';

export interface FileTraceStorageConfig {
  directory: string;
  maxFileSize?: number; // Max size per file in bytes (default: 10MB)
  rotationPolicy?: 'size' | 'daily' | 'hourly';
  keepFiles?: number; // Number of old files to keep (default: 10)
}

export class FileTraceStorage implements TraceStorage {
  private config: Required<FileTraceStorageConfig>;
  private currentFile: string;
  private currentStream?: fs.WriteStream;
  private traces: Map<string, TraceEvent> = new Map();
  private spans: Map<string, TraceSpan> = new Map();
  
  constructor(config: FileTraceStorageConfig) {
    this.config = {
      directory: config.directory,
      maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
      rotationPolicy: config.rotationPolicy || 'size',
      keepFiles: config.keepFiles || 10
    };
    
    // Ensure directory exists
    if (!fs.existsSync(this.config.directory)) {
      fs.mkdirSync(this.config.directory, { recursive: true });
    }
    
    this.currentFile = this.generateFileName();
    this.openStream();
  }
  
  record(event: TraceEvent): void {
    const fullTrace: TraceEvent = {
      ...event,
      id: event.id || `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    this.traces.set(fullTrace.id, fullTrace);
    this.writeTrace(fullTrace);
    
    // Check if rotation needed
    this.checkRotation();
    
    // Also log to console based on level
    this.logToConsole(fullTrace);
  }
  
  startSpan(operation: string, component: string): TraceSpan {
    const span: TraceSpan = {
      id: `span-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operation,
      component,
      startTime: Date.now(),
      events: [],
      metadata: {}
    };
    
    this.spans.set(span.id, span);
    
    // Record span start
    this.record({
      id: `${span.id}-start`,
      timestamp: span.startTime,
      level: 'debug',
      category: TraceCategory.SYSTEM_LIFECYCLE,
      component,
      operation,
      data: { spanId: span.id, type: 'span-start' }
    });
    
    return span;
  }
  
  endSpan(spanId: string): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    
    span.endTime = Date.now();
    const duration = span.endTime - span.startTime;
    
    // Record span end
    this.record({
      id: `${span.id}-end`,
      timestamp: span.endTime,
      level: 'debug',
      category: TraceCategory.SYSTEM_LIFECYCLE,
      component: span.component,
      operation: span.operation,
      data: { 
        spanId: span.id, 
        duration,
        type: 'span-end'
      }
    });
  }
  
  query(query: TraceQuery): TraceEvent[] {
    let traces = Array.from(this.traces.values());
    
    if (query.categories && query.categories.length > 0) {
      traces = traces.filter(t => query.categories!.includes(t.category));
    }
    if (query.components && query.components.length > 0) {
      traces = traces.filter(t => query.components!.includes(t.component));
    }
    if (query.timeRange) {
      traces = traces.filter(t => 
        t.timestamp >= query.timeRange!.start && 
        t.timestamp <= query.timeRange!.end
      );
    }
    if (query.operations && query.operations.length > 0) {
      traces = traces.filter(t => query.operations!.includes(t.operation));
    }
    if (query.parentId) {
      traces = traces.filter(t => t.parentId === query.parentId);
    }
    if (query.level) {
      traces = traces.filter(t => t.level === query.level);
    }
    
    return traces.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }
  
  export(format: 'json' | 'csv' | 'markdown'): string {
    const traces = this.query({});
    
    switch (format) {
      case 'json':
        return JSON.stringify(traces, null, 2);
        
      case 'csv':
        const headers = ['timestamp', 'level', 'category', 'component', 'operation', 'data'];
        const rows = traces.map(t => [
          new Date(t.timestamp).toISOString(),
          t.level,
          t.category,
          t.component,
          t.operation,
          JSON.stringify(t.data)
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
        
      case 'markdown':
        const lines = ['# Trace Log', ''];
        for (const trace of traces) {
          lines.push(`## ${new Date(trace.timestamp).toISOString()} - ${trace.component}:${trace.operation}`);
          lines.push(`- **Level**: ${trace.level}`);
          lines.push(`- **Category**: ${trace.category}`);
          if (Object.keys(trace.data).length > 0) {
            lines.push(`- **Data**: \`\`\`json\n${JSON.stringify(trace.data, null, 2)}\n\`\`\``);
          }
          lines.push('');
        }
        return lines.join('\n');
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
  
  clear(): void {
    this.traces.clear();
    this.spans.clear();
  }
  
  private writeTrace(trace: TraceEvent): void {
    if (!this.currentStream) {
      this.openStream();
    }
    
    const line = JSON.stringify({
      ...trace,
      _type: 'trace'
    }) + '\n';
    
    this.currentStream!.write(line);
  }
  
  private openStream(): void {
    if (this.currentStream) {
      this.currentStream.end();
    }
    
    const filePath = path.join(this.config.directory, this.currentFile);
    this.currentStream = fs.createWriteStream(filePath, { flags: 'a' });
  }
  
  private generateFileName(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    return `trace-${timestamp}.jsonl`;
  }
  
  private checkRotation(): void {
    if (this.config.rotationPolicy === 'size') {
      const filePath = path.join(this.config.directory, this.currentFile);
      try {
        const stats = fs.statSync(filePath);
        if (stats.size >= this.config.maxFileSize) {
          this.rotate();
        }
      } catch (error) {
        // File doesn't exist yet, no need to rotate
      }
    }
  }
  
  private rotate(): void {
    this.currentFile = this.generateFileName();
    this.openStream();
    this.cleanOldFiles();
  }
  
  private cleanOldFiles(): void {
    const files = fs.readdirSync(this.config.directory)
      .filter(f => f.startsWith('trace-') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
    
    if (files.length > this.config.keepFiles) {
      const filesToDelete = files.slice(this.config.keepFiles);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(this.config.directory, file));
      }
    }
  }
  
  private logToConsole(trace: TraceEvent): void {
    const timestamp = new Date(trace.timestamp).toISOString();
    const prefix = `[${trace.component}:${trace.operation}]`;
    
    // Color based on level
    let levelColor = '\x1b[0m'; // default
    switch (trace.level) {
      case 'error': levelColor = '\x1b[31m'; break; // red
      case 'warn': levelColor = '\x1b[33m'; break; // yellow
      case 'info': levelColor = '\x1b[36m'; break; // cyan
      case 'debug': levelColor = '\x1b[90m'; break; // gray
    }
    
    const message = this.formatEventMessage(trace);
    
    console.log(`${levelColor}${prefix} ${message}\x1b[0m`);
  }
  
  private formatEventMessage(event: TraceEvent): string {
    switch (event.category) {
      case TraceCategory.EVENT_QUEUE:
        return ``;
        
      case TraceCategory.FRAME_START:
      case TraceCategory.FRAME_END:
        return `frame=${event.data?.frameId}${event.data?.operations ? ` ops=${event.data.operations}` : ''}`;
        
      case TraceCategory.AGENT_LLM_CALL:
        return `"${this.truncate(event.data?.response || event.data?.error || 'Processing...', 50)}..."`;
        
      case TraceCategory.ADAPTER_INPUT:
      case TraceCategory.ADAPTER_OUTPUT:
        return `"${this.truncate(event.data?.message || event.data?.content || '', 50)}"`;
        
      default:
        return JSON.stringify(event.data || {});
    }
  }
  
  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength);
  }
  
  /**
   * Load traces from a file
   */
  async loadFromFile(filename: string): Promise<void> {
    const filePath = path.join(this.config.directory, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data._type === 'trace') {
          this.traces.set(data.id, data);
        }
      } catch (error) {
        console.error('Failed to parse trace line:', error);
      }
    }
  }
  
  /**
   * Export traces to a file
   */
  exportToFile(filename: string, query?: TraceQuery): void {
    const traces = this.query(query || {});
    const filePath = path.join(this.config.directory, filename);
    
    const stream = fs.createWriteStream(filePath);
    for (const trace of traces) {
      stream.write(JSON.stringify(trace) + '\n');
    }
    stream.end();
  }
  
  /**
   * Close the storage and clean up resources
   */
  close(): void {
    if (this.currentStream) {
      this.currentStream.end();
      this.currentStream = undefined;
    }
  }
}

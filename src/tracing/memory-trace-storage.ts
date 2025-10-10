/**
 * In-memory trace storage implementation
 * 
 * Stores traces in memory with query capabilities.
 * Can be extended to persist to disk or external systems.
 */

import { 
  TraceEvent, 
  TraceSpan, 
  TraceQuery, 
  TraceStorage 
} from './types';

export class MemoryTraceStorage implements TraceStorage {
  private events: TraceEvent[] = [];
  private spans: Map<string, TraceSpan> = new Map();
  private idCounter = 0;
  
  record(event: TraceEvent): void {
    this.events.push(event);
    
    // Also add to parent span if specified
    if (event.parentId) {
      const span = this.spans.get(event.parentId);
      if (span) {
        span.events.push(event);
      }
    }
    
    // Console output for real-time visibility (configurable)
    if (this.shouldLog(event)) {
      this.logEvent(event);
    }
  }
  
  query(query: TraceQuery): TraceEvent[] {
    return this.events.filter(event => {
      if (query.categories && !query.categories.includes(event.category)) {
        return false;
      }
      if (query.components && !query.components.includes(event.component)) {
        return false;
      }
      if (query.operations && !query.operations.includes(event.operation)) {
        return false;
      }
      if (query.level && event.level !== query.level) {
        return false;
      }
      if (query.parentId && event.parentId !== query.parentId) {
        return false;
      }
      if (query.timeRange) {
        if (event.timestamp < query.timeRange.start || 
            event.timestamp > query.timeRange.end) {
          return false;
        }
      }
      return true;
    });
  }
  
  startSpan(operation: string, component: string): TraceSpan {
    const span: TraceSpan = {
      id: `span-${++this.idCounter}`,
      startTime: Date.now(),
      operation,
      component,
      events: []
    };
    this.spans.set(span.id, span);
    return span;
  }
  
  endSpan(spanId: string): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.endTime = Date.now();
    }
  }
  
  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }
  
  export(format: 'json' | 'csv' | 'markdown' = 'json'): string {
    switch (format) {
      case 'json':
        return JSON.stringify({
          events: this.events,
          spans: Array.from(this.spans.values())
        }, null, 2);
        
      case 'markdown':
        return this.exportMarkdown();
        
      case 'csv':
        return this.exportCSV();
        
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }
  
  clear(): void {
    this.events = [];
    this.spans.clear();
  }
  
  private shouldLog(event: TraceEvent): boolean {
    // Skip trace level by default to reduce noise
    if (event.level === 'trace') return false;
    
    // Always show warnings and errors
    if (event.level === 'warn' || event.level === 'error') return true;
    
    // Show info and debug
    return true;
  }
  
  private logEvent(event: TraceEvent): void {
    const prefix = `[${event.component}:${event.operation}]`;
    const levelColor = this.getLevelColor(event.level);
    const message = this.formatEventMessage(event);
    
    console.log(`${levelColor}${prefix} ${message}\x1b[0m`);
  }
  
  private getLevelColor(level: TraceEvent['level']): string {
    switch (level) {
      case 'trace': return '\x1b[90m';  // Gray
      case 'debug': return '\x1b[36m';  // Cyan
      case 'info': return '\x1b[0m';    // Default
      case 'warn': return '\x1b[33m';   // Yellow
      case 'error': return '\x1b[31m';  // Red
    }
  }
  
  private formatEventMessage(event: TraceEvent): string {
    const parts: string[] = [];
    
    // Add key data points
    if (event.data.message) {
      parts.push(event.data.message);
    }
    if (event.data.frameId) {
      parts.push(`frame=${event.data.frameId}`);
    }
    if (event.data.operations) {
      parts.push(`ops=${event.data.operations}`);
    }
    if (event.data.id) {
      parts.push(`facet=${event.data.id}`);
    }
    if (event.data.content) {
      const truncated = event.data.content.length > 50 
        ? event.data.content.substring(0, 50) + '...'
        : event.data.content;
      parts.push(`"${truncated}"`);
    }
    
    return parts.join(' ');
  }
  
  private exportMarkdown(): string {
    const lines: string[] = ['# Trace Export', ''];
    
    // Events by component
    const byComponent = new Map<string, TraceEvent[]>();
    for (const event of this.events) {
      const list = byComponent.get(event.component) || [];
      list.push(event);
      byComponent.set(event.component, list);
    }
    
    for (const [component, events] of byComponent) {
      lines.push(`## ${component}`, '');
      
      for (const event of events) {
        const time = new Date(event.timestamp).toISOString();
        lines.push(`- **${time}** [${event.level}] ${event.operation}`);
        if (event.data.message) {
          lines.push(`  - ${event.data.message}`);
        }
        lines.push('');
      }
    }
    
    return lines.join('\n');
  }
  
  private exportCSV(): string {
    const headers = ['timestamp', 'level', 'category', 'component', 'operation', 'data'];
    const rows = [headers];
    
    for (const event of this.events) {
      rows.push([
        event.timestamp.toString(),
        event.level,
        event.category,
        event.component,
        event.operation,
        JSON.stringify(event.data)
      ]);
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }
}

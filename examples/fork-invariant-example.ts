/**
 * Example of fork-invariant components that survive frame deletions
 */

import { VEILComponent } from '../src/components/base-components';
import { Component } from '../src/spaces/component';
import { ForkInvariantComponent } from '../src/spaces/types';
import { persistent, persistable } from '../src/persistence/decorators';

/**
 * Fork-invariant cache component - survives frame deletions
 * Use case: Caching expensive computations or API results
 */
@persistable()
export class CacheComponent extends VEILComponent implements ForkInvariantComponent {
  readonly forkInvariant = true as const;
  
  private cache = new Map<string, { value: any; timestamp: number }>();
  private ttl: number = 60000; // 1 minute default TTL
  
  get(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    // Check if expired
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value;
  }
  
  set(key: string, value: any, ttl?: number): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  onFrameFork(deletedRange: { from: number; to: number }): void {
    console.log(`[Cache] Surviving frame deletion ${deletedRange.from}-${deletedRange.to}`);
    console.log(`[Cache] Current cache size: ${this.cache.size} entries`);
    // Cache doesn't need to do anything special - it maintains its state
  }
}

/**
 * Fork-invariant metrics collector - survives frame deletions
 * Use case: Tracking performance metrics across the entire session
 */
@persistable()
export class MetricsComponent extends VEILComponent implements ForkInvariantComponent {
  readonly forkInvariant = true as const;
  
  private metrics = new Map<string, number>();
  private timers = new Map<string, number>();
  
  increment(metric: string, value: number = 1): void {
    this.metrics.set(metric, (this.metrics.get(metric) || 0) + value);
  }
  
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }
  
  endTimer(name: string): number | null {
    const start = this.timers.get(name);
    if (!start) return null;
    
    const duration = Date.now() - start;
    this.timers.delete(name);
    this.increment(`${name}_duration_ms`, duration);
    this.increment(`${name}_count`);
    
    return duration;
  }
  
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }
  
  onFrameFork(deletedRange: { from: number; to: number }): void {
    console.log(`[Metrics] Frame deletion detected, continuing to track metrics`);
    this.increment('frame_deletions');
    this.increment('frames_deleted', deletedRange.to - deletedRange.from + 1);
  }
}

/**
 * Fork-invariant connection pool - survives frame deletions
 * Use case: Managing database or API connections
 */
@persistable()
export class ConnectionPoolComponent extends VEILComponent implements ForkInvariantComponent {
  readonly forkInvariant = true as const;
  
  @persistent()
  private maxConnections: number = 5;
  
  private connections: Array<{ id: string; inUse: boolean; connection: any }> = [];
  private waitQueue: Array<(conn: any) => void> = [];
  
  async acquire(): Promise<any> {
    // Find available connection
    const available = this.connections.find(c => !c.inUse);
    if (available) {
      available.inUse = true;
      return available.connection;
    }
    
    // Create new connection if under limit
    if (this.connections.length < this.maxConnections) {
      const conn = await this.createConnection();
      this.connections.push({
        id: `conn-${Date.now()}`,
        inUse: true,
        connection: conn
      });
      return conn;
    }
    
    // Wait for connection to become available
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }
  
  release(connection: any): void {
    const entry = this.connections.find(c => c.connection === connection);
    if (entry) {
      entry.inUse = false;
      
      // Give to waiting request if any
      const waiter = this.waitQueue.shift();
      if (waiter) {
        entry.inUse = true;
        waiter(connection);
      }
    }
  }
  
  private async createConnection(): Promise<any> {
    // Simulate connection creation
    await new Promise(r => setTimeout(r, 100));
    return { id: Date.now(), connected: true };
  }
  
  onFrameFork(deletedRange: { from: number; to: number }): void {
    console.log(`[ConnectionPool] Maintaining ${this.connections.length} connections through frame deletion`);
    const inUse = this.connections.filter(c => c.inUse).length;
    console.log(`[ConnectionPool] ${inUse} connections in use, ${this.waitQueue.length} waiting`);
  }
  
  async onShutdown(): Promise<void> {
    // This is called during full shutdown, not frame deletion
    console.log('[ConnectionPool] Closing all connections...');
    for (const conn of this.connections) {
      // Close connection
      if (conn.connection.close) {
        conn.connection.close();
      }
    }
    this.connections = [];
    
    // Reject waiting requests
    for (const waiter of this.waitQueue) {
      waiter(null);
    }
    this.waitQueue = [];
  }
}

/**
 * Example usage showing fork-invariant and stateful components together
 */
export function setupWithForkInvariantComponents() {
  // import { Element } from '../src/spaces/element';
  // import { DiscordChatComponent } from '../src/components/discord-chat';
  
  // Create element with mixed components
  // const serviceLayer = new Element('services');
  
  // Fork-invariant components - survive frame deletion
  // const cache = new CacheComponent();
  // const metrics = new MetricsComponent();
  // const pool = new ConnectionPoolComponent();
  
  // serviceLayer.addComponent(cache);
  // serviceLayer.addComponent(metrics);
  // serviceLayer.addComponent(pool);
  
  // Stateful component - will be reinitialized on frame deletion
  // const discord = new Element('discord');
  // const chat = new DiscordChatComponent();
  // discord.addComponent(chat);
  
  // Chat can use services that survive deletion
  // In chat component:
  // const cache = this.element.parent?.getComponent(CacheComponent);
  // const cachedUser = cache?.get(`user-${userId}`);
  
  console.log('Fork-invariant example - see code for usage patterns');
}

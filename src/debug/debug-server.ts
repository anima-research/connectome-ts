import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { debugLLMBridge, DebugLLMRequest } from '../llm/debug-llm-bridge';

import type { Space } from '../spaces/space';
import { VEILStateManager } from '../veil/veil-state';
import type { IncomingVEILFrame, OutgoingVEILFrame, Facet, StreamRef, StreamInfo } from '../veil/types';
import type { SpaceEvent, ElementRef } from '../spaces/types';
import type { DebugObserver, DebugFrameStartContext, DebugFrameCompleteContext, DebugEventContext, DebugOutgoingFrameContext, DebugRenderedContextInfo } from './types';
import { deterministicUUID } from '../utils/uuid';
import { Element } from '../spaces/element';
import type { Component } from '../spaces/component';
import type { RenderedContext } from '../hud/types-v2';

export interface DebugServerConfig {
  enabled: boolean;
  host: string;
  port: number;
  maxFrames: number;
  retentionMinutes: number;
  corsOrigins: string[];
}

const DEFAULT_CONFIG: DebugServerConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 8888,
  maxFrames: 1000,
  retentionMinutes: 60,
  corsOrigins: ['*']
};

const MAX_SANITIZE_DEPTH = 8;
const MAX_COLLECTION_PREVIEW = 20;
const FACET_TREE_MAX_DEPTH = 10;

interface DebugEventRecord {
  id: string;
  topic: string;
  source: ElementRef;
  target?: ElementRef;
  payload: any;
  phase: string;
  timestamp: number;
}

interface DebugFrameRecord {
  uuid: string;
  sequence: number;
  timestamp: string;
  kind: 'incoming' | 'outgoing';
  operations: any[];
  events: DebugEventRecord[];
  queueLength?: number;
  durationMs?: number;
  processedEvents?: number;
  agent?: {
    id?: string;
    name?: string;
  };
  activeStream?: StreamRef;
  renderedContext?: RenderedContext;
}

interface DebugMetrics {
  incomingFrames: number;
  outgoingFrames: number;
  lastFrameTimestamp?: string;
  averageDurationMs: number;
  totalEvents: number;
}

function sanitizePayload(value: any, depth: number = 0, seen: WeakSet<object> = new WeakSet()): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth > MAX_SANITIZE_DEPTH && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_COLLECTION_PREVIEW);
    }
    if (value instanceof Map) {
      return {
        '[depth-limit]': true,
        size: value.size,
        keys: Array.from(value.keys()).slice(0, MAX_COLLECTION_PREVIEW)
      };
    }
    if (value instanceof Set) {
      return {
        '[depth-limit]': true,
        size: value.size
      };
    }
    return {
      '[depth-limit]': true,
      keys: Object.keys(value).slice(0, MAX_COLLECTION_PREVIEW)
    };
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[circular]';
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_COLLECTION_PREVIEW).map(item => sanitizePayload(item, depth + 1, seen));
    }

    if (value instanceof Map) {
      return Array.from(value.entries())
        .slice(0, MAX_COLLECTION_PREVIEW)
        .map(([key, val]) => [sanitizePayload(key, depth + 1, seen), sanitizePayload(val, depth + 1, seen)]);
    }

    if (value instanceof Set) {
      return Array.from(value.values())
        .slice(0, MAX_COLLECTION_PREVIEW)
        .map(val => sanitizePayload(val, depth + 1, seen));
    }

    if (Buffer.isBuffer(value)) {
      const stringValue = value.toString('utf8');
      return stringValue.length > 256 ? `${stringValue.slice(0, 256)}…` : stringValue;
    }

    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'function') continue;
      if (key.startsWith('_')) continue;
      result[key] = sanitizePayload(val, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

class DebugStateTracker extends EventEmitter implements DebugObserver {
  private frames: DebugFrameRecord[] = [];
  private frameIndex: Map<string, DebugFrameRecord> = new Map();
  private metrics: DebugMetrics = {
    incomingFrames: 0,
    outgoingFrames: 0,
    averageDurationMs: 0,
    totalEvents: 0
  };

  constructor(private maxFrames: number) {
    super();
  }

  onFrameStart(frame: IncomingVEILFrame, context: DebugFrameStartContext): void {
    const uuid = frame.uuid || deterministicUUID(`incoming-${frame.sequence}`);
    const record: DebugFrameRecord = {
      uuid,
      sequence: frame.sequence,
      timestamp: frame.timestamp,
      kind: 'incoming',
      events: [],
      operations: [],
      queueLength: context.queuedEvents,
      activeStream: frame.activeStream
    };
    this.insertFrame(record);
    this.metrics.incomingFrames += 1;
    this.metrics.lastFrameTimestamp = frame.timestamp;
    this.emit('frame:start', record);
  }

  onFrameEvent(frame: IncomingVEILFrame, event: SpaceEvent, context: DebugEventContext): void {
    const record = this.lookup(frame);
    if (!record) return;

    const eventRecord: DebugEventRecord = {
      id: deterministicUUID(`${record.uuid}:${record.events.length}`),
      topic: event.topic,
      source: sanitizePayload(event.source),
      target: sanitizePayload(event.target),
      payload: sanitizePayload(event.payload),
      phase: EventPhaseName[context.phase] || 'unknown',
      timestamp: event.timestamp
    };

    record.events.push(eventRecord);
    this.metrics.totalEvents += 1;
    this.emit('frame:event', { frame: record, event: eventRecord });
  }

  onFrameComplete(frame: IncomingVEILFrame, context: DebugFrameCompleteContext): void {
    const record = this.lookup(frame);
    if (!record) return;

    record.operations = frame.operations.map(op => sanitizePayload(op));
    record.durationMs = context.durationMs;
    record.processedEvents = context.processedEvents;
    record.activeStream = frame.activeStream;

    if (context.durationMs > 0) {
      const totalDuration = this.metrics.averageDurationMs * (this.metrics.incomingFrames - 1) + context.durationMs;
      this.metrics.averageDurationMs = totalDuration / this.metrics.incomingFrames;
    }

    this.emit('frame:complete', record);
  }

  onOutgoingFrame(frame: OutgoingVEILFrame, context: DebugOutgoingFrameContext): void {
    const uuid = frame.uuid || deterministicUUID(`outgoing-${frame.sequence}`);
    const record: DebugFrameRecord = {
      uuid,
      sequence: frame.sequence,
      timestamp: frame.timestamp,
      kind: 'outgoing',
      events: [],
      operations: frame.operations.map(op => sanitizePayload(op)),
      agent: {
        id: context.agentId,
        name: context.agentName
      },
      activeStream: frame.activeStream
    };

    // Capture raw completion if attached
    if ((frame as any).renderedContext) {
      record.renderedContext = sanitizePayload((frame as any).renderedContext) as RenderedContext;
    }

    this.insertFrame(record);
    this.metrics.outgoingFrames += 1;
    this.metrics.lastFrameTimestamp = frame.timestamp;
    this.emit('frame:outgoing', record);
  }

  onRenderedContext(info: DebugRenderedContextInfo): void {
    const record = this.lookupByInfo(info);
    if (!record) {
      return;
    }

    record.renderedContext = sanitizePayload(info.context) as RenderedContext;
    if (info.streamRef) {
      record.activeStream = info.streamRef;
    }
    if (info.agentId || info.agentName) {
      record.agent = record.agent || {};
      if (info.agentId) {
        record.agent.id = info.agentId;
      }
      if (info.agentName) {
        record.agent.name = info.agentName;
      }
    }

    this.emit('frame:context', { frame: record, context: info.context });
  }

  getFrames(limit?: number, offset: number = 0): DebugFrameRecord[] {
    // Sort frames in descending order by sequence (most recent first)
    const sortedFrames = [...this.frames].sort((a, b) => b.sequence - a.sequence);
    
    // Apply pagination
    const start = offset;
    const end = limit ? offset + limit : sortedFrames.length;
    
    const result = sortedFrames.slice(start, end);
    
    console.log(`[DebugTracker] getFrames: total=${this.frames.length}, sorted=${sortedFrames.length}, offset=${offset}, limit=${limit}, returning=${result.length} frames`);
    if (result.length > 0) {
      console.log(`[DebugTracker] Frame range: ${result[result.length - 1].sequence} to ${result[0].sequence}`);
    }
    
    return result;
  }

  getFrame(uuid: string): DebugFrameRecord | undefined {
    return this.frameIndex.get(uuid);
  }

  getMetrics(): DebugMetrics {
    return { ...this.metrics };
  }

  clear(): void {
    this.frames = [];
    this.frameIndex.clear();
    this.metrics = {
      incomingFrames: 0,
      outgoingFrames: 0,
      averageDurationMs: 0,
      totalEvents: 0
    };
  }

  private lookup(frame: IncomingVEILFrame | OutgoingVEILFrame): DebugFrameRecord | undefined {
    const uuid = frame.uuid || deterministicUUID(`${frame.sequence}`);
    return this.frameIndex.get(uuid);
  }

  private lookupByInfo(info: DebugRenderedContextInfo): DebugFrameRecord | undefined {
    if (info.frameUUID) {
      const record = this.frameIndex.get(info.frameUUID);
      if (record) {
        return record;
      }
    }
    return this.frames.find(frame => frame.sequence === info.frameSequence && frame.kind === 'incoming');
  }

  private insertFrame(record: DebugFrameRecord): void {
    this.frames.push(record);
    this.frameIndex.set(record.uuid, record);

    // If we exceed max frames, remove the oldest by sequence (not by insertion order)
    if (this.frames.length > this.maxFrames) {
      console.log(`[DebugTracker] Frame limit exceeded: ${this.frames.length} > ${this.maxFrames}, removing oldest frames`);
      
      // Sort by sequence to find the oldest
      const sorted = [...this.frames].sort((a, b) => a.sequence - b.sequence);
      const toRemove = sorted.slice(0, this.frames.length - this.maxFrames);
      
      console.log(`[DebugTracker] Removing ${toRemove.length} frames, sequences: ${toRemove.map(f => f.sequence).join(', ')}`);
      
      // Remove the oldest frames
      for (const frame of toRemove) {
        this.frameIndex.delete(frame.uuid);
        const idx = this.frames.indexOf(frame);
        if (idx >= 0) {
          this.frames.splice(idx, 1);
        }
      }
    }
  }

  removeFramesBySequence(sequences: number[]): number {
    const sequenceSet = new Set(sequences);
    const before = this.frames.length;
    
    // Remove from index
    for (const frame of this.frames) {
      if (sequenceSet.has(frame.sequence)) {
        this.frameIndex.delete(frame.uuid);
      }
    }
    
    // Remove from array
    this.frames = this.frames.filter(frame => !sequenceSet.has(frame.sequence));
    
    const removed = before - this.frames.length;
    return removed;
  }

  loadHistoricalFrame(record: DebugFrameRecord): void {
    // Don't add duplicates
    if (this.frameIndex.has(record.uuid)) {
      return;
    }
    
    // Insert the frame
    this.insertFrame(record);
    
    // Update metrics
    if (record.kind === 'incoming') {
      this.metrics.incomingFrames += 1;
    } else {
      this.metrics.outgoingFrames += 1;
    }
    this.metrics.totalEvents += record.events.length;
    this.metrics.lastFrameTimestamp = record.timestamp;
  }

}

const EventPhaseName: Record<number, string> = {
  0: 'none',
  1: 'capturing',
  2: 'target',
  3: 'bubbling'
};

interface SerializedComponent {
  type: string;
  enabled: boolean;
  state: Record<string, any>;
}

interface SerializedElement {
  id: string;
  name: string;
  type: string;
  active: boolean;
  path: string[];
  subscriptions: string[];
  components: SerializedComponent[];
  children: SerializedElement[];
}

function serializeComponent(component: Component): SerializedComponent {
  const state: Record<string, any> = {};
  for (const key of Object.keys(component as any)) {
    if (key.startsWith('_')) continue;
    const value = (component as any)[key];
    if (typeof value === 'function') continue;
    state[key] = sanitizePayload(value);
  }
  return {
    type: component.constructor.name,
    enabled: component.enabled,
    state
  };
}

function serializeElement(element: Element): SerializedElement {
  const children = Array.from(element.children || []).map(serializeElement);
  const components = Array.from(element.components || []).map(c => serializeComponent(c as Component));
  return {
    id: element.id,
    name: element.name,
    type: element.constructor.name,
    active: element.active,
    path: element.getPath(),
    subscriptions: [...element.subscriptions],
    components,
    children
  };
}

interface SerializedVEILState {
  facets: Array<Facet & { facetId: string }>;
  streams: Array<{ id: string; info: StreamInfo }>;
  currentStream?: StreamRef;
  sequence: number;
}

function serializeVEILState(stateManager: VEILStateManager): SerializedVEILState {
  const state = stateManager.getState();
  return {
    facets: Array.from(state.facets.values()).map(facet => ({
      ...sanitizePayload(facet),
      facetId: facet.id
    })),
    streams: Array.from(state.streams.entries()).map(([id, stream]) => ({
      id,
      info: stream
    })),
    currentStream: state.currentStream,
    sequence: state.currentSequence
  };
}

function sanitizeFacetTreeNode(facet: Facet, depth: number = 0): any {
  const baseNode = {
    id: facet.id,
    type: facet.type,
    displayName: facet.displayName || '',
    content: facet.content || ''
  };

  if (depth >= FACET_TREE_MAX_DEPTH) {
    return {
      ...baseNode,
      truncated: true,
      childrenCount: facet.children ? facet.children.length : 0
    };
  }

  return {
    ...baseNode,
    attributes: facet.attributes ? sanitizePayload(facet.attributes, depth + 1) : undefined,
    scope: facet.scope || undefined,
    saliency: facet.saliency ? sanitizePayload(facet.saliency, depth + 1) : undefined,
    children: (facet.children || []).map(child => sanitizeFacetTreeNode(child, depth + 1))
  };
}

function describeFacet(facet: Facet): string {
  return `${facet.id}:${facet.type || 'unknown'}:${facet.displayName || facet.content || ''}`;
}

interface FrameListResponse {
  frames: DebugFrameRecord[];
  metrics: DebugMetrics;
}

export class DebugServer {
  private readonly config: DebugServerConfig;
  private readonly app = express();
  private readonly httpServer: Server;
  private readonly wsServer: WebSocketServer;
  private readonly tracker: DebugStateTracker;
  private readonly veilState: VEILStateManager;
  private subscriptions: Array<() => void> = [];
  private debugLLMEnabled: boolean;

  constructor(private readonly space: Space, config?: Partial<DebugServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.httpServer = createServer(this.app);
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.tracker = new DebugStateTracker(this.config.maxFrames);
    this.veilState = space.getVEILState();
    this.debugLLMEnabled = debugLLMBridge.isEnabled();

    this.space.addDebugObserver(this.tracker);

    // Load historical frames from VEIL state
    this.loadHistoricalFrames();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupStaticAssets();
    this.setupDebugLLMBridge();
  }

  private loadHistoricalFrames(): void {
    const veilState = this.veilState.getState();
    const frameHistory = veilState.frameHistory;
    
    console.log(`[DebugServer] Loading ${frameHistory.length} historical frames into tracker`);
    
    // Convert VEIL frames to debug frame records
    frameHistory.forEach(frame => {
      const isOutgoing = 'operations' in frame && frame.operations.some(
        (op: any) => op.type === 'speak' || op.type === 'toolCall' || op.type === 'action'
      );
      
      const record: DebugFrameRecord = {
        uuid: frame.uuid || deterministicUUID(`${isOutgoing ? 'outgoing' : 'incoming'}-${frame.sequence}`),
        sequence: frame.sequence,
        timestamp: frame.timestamp,
        kind: isOutgoing ? 'outgoing' : 'incoming',
        events: [],
        operations: frame.operations.map((op: any) => sanitizePayload(op)),
        queueLength: 0,
        activeStream: frame.activeStream
      };
      
      // Add the frame to the tracker
      this.tracker.loadHistoricalFrame(record);
    });
    
    console.log(`[DebugServer] After loading historical frames: tracker has ${(this.tracker as any).frames.length} frames`);
  }

  start(): void {
    if (!this.config.enabled) return;
    
    this.httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(`⚠️  Debug UI port ${this.config.port} is already in use. Debug UI will not be available.`);
        console.warn(`    Try running with --debug-port=<different-port> to use a different port.`);
      } else {
        console.error('Debug server error:', error);
      }
    });
    
    this.httpServer.listen(this.config.port, this.config.host, () => {
      console.log(`🔍 Debug UI available at http://${this.config.host}:${this.config.port}`);
    });

    const unsubscribe = this.veilState.subscribe(() => {
      const state = serializeVEILState(this.veilState);
      this.broadcast({ type: 'state:changed', payload: state });
    });
    this.subscriptions.push(unsubscribe);

    this.tracker.on('frame:start', (frame: DebugFrameRecord) => {
      this.broadcast({ type: 'frame:start', payload: frame });
    });
    this.tracker.on('frame:complete', (frame: DebugFrameRecord) => {
      this.broadcast({ type: 'frame:complete', payload: frame });
    });
    this.tracker.on('frame:outgoing', (frame: DebugFrameRecord) => {
      this.broadcast({ type: 'frame:outgoing', payload: frame });
    });
    this.tracker.on('frame:event', ({ frame, event }: { frame: DebugFrameRecord; event: DebugEventRecord }) => {
      this.broadcast({ type: 'frame:event', payload: { frameId: frame.uuid, event } });
    });
    this.tracker.on('frame:context', ({ frame }: { frame: DebugFrameRecord; context: RenderedContext }) => {
      this.broadcast({ type: 'frame:context', payload: frame });
    });
  }

  stop(): void {
    for (const unsubscribe of this.subscriptions) {
      try {
        unsubscribe();
      } catch (err) {
        console.warn('Failed to remove debug subscription', err);
      }
    }
    this.subscriptions = [];
    this.wsServer.close();
    this.httpServer.close();
  }

  private setupDebugLLMBridge(): void {
    const handleProviderChange = (enabled: boolean) => {
      this.debugLLMEnabled = enabled;
      this.broadcast({ type: 'debugLLM:enabled', payload: { enabled } });
    };
    const handleCreated = (request: DebugLLMRequest) => {
      if (!this.debugLLMEnabled) return;
      this.broadcast({ type: 'debugLLM:request-created', payload: request });
    };
    const handleUpdated = (request: DebugLLMRequest) => {
      if (!this.debugLLMEnabled) return;
      this.broadcast({ type: 'debugLLM:request-updated', payload: request });
    };

    debugLLMBridge.on('provider-change', handleProviderChange);
    debugLLMBridge.on('request-created', handleCreated);
    debugLLMBridge.on('request-updated', handleUpdated);

    this.subscriptions.push(() => {
      debugLLMBridge.off('provider-change', handleProviderChange);
      debugLLMBridge.off('request-created', handleCreated);
      debugLLMBridge.off('request-updated', handleUpdated);
    });
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      if (this.config.corsOrigins.includes('*')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      } else {
        const origin = req.headers.origin || '';
        if (this.config.corsOrigins.includes(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Cache-Control', 'no-store');
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/api/frames', (req, res) => {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
      const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
      const frames = this.tracker.getFrames(limit, offset);
      const metrics = this.tracker.getMetrics();
      const response: FrameListResponse = { frames, metrics };
      res.json(response);
    });

    this.app.get('/api/frames/:uuid', (req, res) => {
      const frame = this.tracker.getFrame(req.params.uuid);
      if (!frame) {
        res.status(404).json({ error: 'frame not found' });
        return;
      }
      const facetsSnapshot = this.buildFacetSnapshot(frame.sequence);
      res.json({
        ...frame,
        facetsTree: facetsSnapshot.facets,
        facetsSequence: facetsSnapshot.sequence
      });
    });

    this.app.get('/api/state', (_req, res) => {
      res.json({
        space: serializeElement(this.space),
        veil: serializeVEILState(this.veilState),
        metrics: this.tracker.getMetrics(),
        manualLLMEnabled: this.debugLLMEnabled
      });
    });

    this.app.get('/api/elements/:id', (req, res) => {
      const element = this.findElement(this.space, req.params.id);
      if (!element) {
        res.status(404).json({ error: 'element not found' });
        return;
      }
      res.json(serializeElement(element));
    });

    this.app.get('/api/facets', (_req, res) => {
      res.json(serializeVEILState(this.veilState));
    });

    this.app.post('/api/events', (req, res) => {
      const { topic, payload, sourceId } = req.body || {};
      if (!topic) {
        res.status(400).json({ error: 'topic is required' });
        return;
      }
      const sourceElement = sourceId ? this.findElement(this.space, sourceId) : this.space;
      const sourceRef = sourceElement ? sourceElement.getRef() : this.space.getRef();
      this.space.emit({
        topic,
        source: sourceRef,
        payload: payload || {},
        timestamp: Date.now()
      } as SpaceEvent);
      res.json({ status: 'ok' });
    });

    this.app.put('/api/elements/:id/props', (req, res) => {
      const element = this.findElement(this.space, req.params.id);
      if (!element) {
        res.status(404).json({ error: 'element not found' });
        return;
      }
      const { component, props } = req.body || {};
      if (component === undefined) {
        res.status(400).json({ error: 'component index or name required' });
        return;
      }
      const comp = this.resolveComponent(element, component);
      if (!comp) {
        res.status(404).json({ error: 'component not found' });
        return;
      }
      if (props && typeof props === 'object') {
        Object.entries(props).forEach(([key, value]) => {
          if (typeof (comp as any)[key] === 'function') {
            return;
          }
          (comp as any)[key] = value;
        });
      }
      res.json(serializeComponent(comp));
    });

    this.app.get('/api/debug-llm/requests', (_req, res) => {
      if (!debugLLMBridge.isEnabled()) {
        res.json({ enabled: false, requests: [] });
        return;
      }
      res.json({ enabled: true, requests: debugLLMBridge.getRequests() });
    });

    this.app.post('/api/debug-llm/requests/:id/complete', (req, res) => {
      if (!debugLLMBridge.isEnabled()) {
        res.status(503).json({ error: 'Debug LLM provider not enabled' });
        return;
      }
      const { id } = req.params;
      const { content, modelId, tokensUsed } = req.body || {};

      if (typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      let parsedTokens: number | undefined;
      if (tokensUsed !== undefined) {
        const numeric = typeof tokensUsed === 'number' ? tokensUsed : parseInt(String(tokensUsed), 10);
        if (!Number.isFinite(numeric) || numeric < 0) {
          res.status(400).json({ error: 'tokensUsed must be a non-negative number' });
          return;
        }
        parsedTokens = numeric;
      }

      const request = debugLLMBridge.completeRequest(id, {
        content: content.trim(),
        modelId: typeof modelId === 'string' && modelId.trim() ? modelId.trim() : undefined,
        tokensUsed: parsedTokens
      });

      if (!request) {
        res.status(404).json({ error: 'request not found or already resolved' });
        return;
      }

      res.json({ status: 'ok', request });
    });

    this.app.get('/api/metrics', (_req, res) => {
      res.json(this.tracker.getMetrics());
    });

    // Frame deletion endpoint
    this.app.post('/api/frames/delete', async (req, res) => {
      const { count } = req.body || {};
      
      if (!count || typeof count !== 'number' || count <= 0) {
        res.status(400).json({ error: 'count must be a positive number' });
        return;
      }
      
      try {
        // Check if we have a TransitionManager available
        const persistence = (this.space as any).persistence || (global as any).globalPersistence;
        if (!persistence) {
          res.status(503).json({ error: 'Persistence not available' });
          return;
        }
        
        // Get current state info before deletion
        const veilState = this.veilState.getState();
        const beforeCount = veilState.frameHistory.length;
        const beforeSequence = veilState.currentSequence;
        
        if (count > beforeCount) {
          res.status(400).json({ 
            error: `Cannot delete ${count} frames, only ${beforeCount} exist` 
          });
          return;
        }
        
        // Execute frame deletion using VEILStateManager with selective reinit
        const result = await this.veilState.deleteRecentFramesWithReinit(
          count,
          this.space
        );
        
        // Remove deleted frames from debug tracker
        const deletedSequences = result.deletedFrames.map(f => f.sequence);
        this.tracker.removeFramesBySequence(deletedSequences);
        
        // Save deletion record if we have persistence
        let deletionRecord;
        if (persistence) {
          try {
            // Create a new snapshot after deletion
            await persistence.createSnapshot();
          } catch (e) {
            console.warn('[DebugUI] Could not create deletion snapshot:', e);
          }
        }
        
        // Notify connected clients about the deletion
        this.broadcast({
          type: 'frame-deletion',
          payload: {
            deletedCount: count,
            beforeSequence,
            afterSequence: result.revertedSequence,
            deletedFrames: result.deletedFrames,
            warnings: result.warnings
          }
        });
        
        res.json({
          success: true,
          deletedCount: count,
          deletedFrames: result.deletedFrames,
          revertedToSequence: result.revertedSequence,
          warnings: result.warnings || []
        });
        
      } catch (error: any) {
        console.error('[DebugUI] Frame deletion failed:', error);
        res.status(500).json({ 
          error: 'Frame deletion failed', 
          details: error.message 
        });
      }
    });
  }

  private setupWebSocket(): void {
    this.wsServer.on('connection', socket => {
      socket.send(JSON.stringify({
        type: 'hello',
        payload: {
          frames: [], // Let HTTP API handle initial frame loading with proper pagination
          state: serializeVEILState(this.veilState),
          metrics: this.tracker.getMetrics(),
          manualLLMEnabled: this.debugLLMEnabled,
          debugLLMRequests: this.debugLLMEnabled ? debugLLMBridge.getRequests() : []
        }
      }));

      socket.on('message', data => {
        try {
          const message = JSON.parse(String(data));
          if (message.type === 'pauseUpdates') {
            // Client side throttling - no server state needed yet
          }
        } catch (err) {
          console.warn('Debug socket message parsing failed', err);
        }
      });
    });
  }

  private setupStaticAssets(): void {
    const candidates = [
      path.resolve(__dirname, '..', '..', 'debug-ui'),
      path.resolve(process.cwd(), 'debug-ui'),
      path.resolve(process.cwd(), 'dist', 'debug-ui')
    ];

    const uiPath = candidates.find(candidate => fs.existsSync(candidate));

    if (!uiPath) {
      console.warn('[DebugServer] No debug-ui directory found. UI assets will not be served.');
      return;
    }

    this.app.use(express.static(uiPath));
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(uiPath, 'index.html'));
    });
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of this.wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private findElement(root: Element, id: string): Element | null {
    if (root.id === id) return root;
    for (const child of root.children) {
      const found = this.findElement(child, id);
      if (found) return found;
    }
    return null;
  }

  private resolveComponent(element: Element, selector: number | string): Component | null {
    const components = Array.from(element.components) as Component[];
    if (typeof selector === 'number') {
      return components[selector] || null;
    }
    return components.find(comp => comp.constructor.name === selector) || null;
  }

  private buildFacetSnapshot(sequence: number): { facets: any[]; sequence: number } {
    const state = this.veilState.getState();
    const temp = new VEILStateManager();
    const framesToApply = state.frameHistory.filter(frame => frame.sequence <= sequence);
    // if (sequence === state.currentSequence) {
    //   console.log('[DebugServer] live facets count', {
    //     liveSequence: state.currentSequence,
    //     totalFacets: state.facets.size,
    //     facetIds: Array.from(state.facets.keys()).slice(0, 10)
    //   });
    // }
    let incomingCount = 0;
    let outgoingCount = 0;

    for (const frame of framesToApply) {
      if ('activeStream' in frame) {
        temp.applyIncomingFrame(frame as IncomingVEILFrame);
        incomingCount += 1;
      } else {
        temp.recordOutgoingFrame(frame as OutgoingVEILFrame);
        outgoingCount += 1;
      }
    }

    let snapshot = temp.getState();
    let facets = Array.from(snapshot.facets.values());
    let facetDescriptions = facets.map(describeFacet);
    if (facetDescriptions.length <= 1) {
      const lastFrame = framesToApply[framesToApply.length - 1];
      // console.log('[DebugServer] facet snapshot diagnostic', {
      //   requestSequence: sequence,
      //   facetsCount: facetDescriptions.length,
      //   lastFrameKind: 'agent' in (lastFrame as any) ? 'outgoing' : 'incoming',
      //   lastFrameOperations: (lastFrame as any).operations?.map((op: any) => op.type),
      //   lastFrameHasFacets: (lastFrame as any).operations?.some((op: any) => op.type === 'addFacet'),
      //   lastFrameKeys: Object.keys(lastFrame || {})
      // });
      const liveState = this.veilState.getState();
      const liveFacets = Array.from(liveState.facets.values());
      if (liveFacets.length > facetDescriptions.length) {
        // console.log('[DebugServer] facet snapshot fallback to live state', {
        //   requestSequence: sequence,
        //   snapshotSequence: snapshot.currentSequence,
        //   liveSequence: liveState.currentSequence,
        //   liveFacetCount: liveFacets.length
        // });
        facets = liveFacets;
        snapshot = liveState;
        facetDescriptions = facets.map(describeFacet);
      }
    }
    // console.log('[DebugServer] buildFacetSnapshot', {
    //   requestSequence: sequence,
    //   historyLength: state.frameHistory.length,
    //   framesApplied: framesToApply.length,
    //   incomingCount,
    //   outgoingCount,
    //   snapshotSequence: snapshot.currentSequence,
    //   requestedFrameSequence: sequence,
    //   facets: facetDescriptions
    // });
    return {
      facets: facets.map(facet => sanitizeFacetTreeNode(facet)),
      sequence: snapshot.currentSequence
    };
  }
}

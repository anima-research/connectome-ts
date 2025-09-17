import express from 'express';
import { createServer, Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

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
    const sliceEnd = this.frames.length - offset;
    const sliceStart = Math.max(0, limit ? sliceEnd - limit : 0);
    return this.frames.slice(sliceStart, sliceEnd);
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

    if (this.frames.length > this.maxFrames) {
      const removed = this.frames.shift();
      if (removed) {
        this.frameIndex.delete(removed.uuid);
      }
    }
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

  constructor(private readonly space: Space, config?: Partial<DebugServerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.httpServer = createServer(this.app);
    this.wsServer = new WebSocketServer({ server: this.httpServer });
    this.tracker = new DebugStateTracker(this.config.maxFrames);
    this.veilState = space.getVEILState();

    this.space.addDebugObserver(this.tracker);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.setupStaticAssets();
  }

  start(): void {
    if (!this.config.enabled) return;
    this.httpServer.listen(this.config.port, this.config.host, () => {
      console.log(`🔍 Debug UI listening at http://${this.config.host}:${this.config.port}`);
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
      const facetsTree = this.buildFacetSnapshot(frame.sequence);
      res.json({
        ...frame,
        facetsTree
      });
    });

    this.app.get('/api/state', (_req, res) => {
      res.json({
        space: serializeElement(this.space),
        veil: serializeVEILState(this.veilState),
        metrics: this.tracker.getMetrics()
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

    this.app.get('/api/metrics', (_req, res) => {
      res.json(this.tracker.getMetrics());
    });
  }

  private setupWebSocket(): void {
    this.wsServer.on('connection', socket => {
      socket.send(JSON.stringify({
        type: 'hello',
        payload: {
          frames: this.tracker.getFrames(50),
          state: serializeVEILState(this.veilState),
          metrics: this.tracker.getMetrics()
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

  private buildFacetSnapshot(sequence: number): any[] {
    const state = this.veilState.getState();
    const temp = new VEILStateManager();

    for (const frame of state.frameHistory) {
      if ('activeStream' in frame) {
        temp.applyIncomingFrame(frame as IncomingVEILFrame);
      } else {
        temp.recordOutgoingFrame(frame as OutgoingVEILFrame);
      }
      if (frame.sequence >= sequence) {
        break;
      }
    }

    const snapshot = temp.getState();
    return Array.from(snapshot.facets.values()).map(facet => sanitizeFacetTreeNode(facet));
  }
}

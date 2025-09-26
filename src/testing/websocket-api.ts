/**
 * WebSocket API for Session Server
 * 
 * Provides real-time access to terminal sessions
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { EventEmitter } from 'events';
import { PersistentSessionServer } from './session-server-v3';

interface APIMessage {
  id: string;
  method: string;
  params?: any;
}

interface APIResponse {
  id: string;
  result?: any;
  error?: string;
}

interface SubscriptionState {
  sessions: Set<string>;
  all: boolean;
  replayLines: number;
}

export interface EventEnvelope {
  type: 'event';
  event: string;
  sessionId?: string;
  payload: any;
}

export class SessionAPI {
  private wss: WebSocketServer;
  private server: PersistentSessionServer;
  private httpServer: any;
  private subscriptions = new Map<WebSocket, SubscriptionState>();
  private serverListeners: Array<{ event: string; handler: (payload: any) => void }> = [];
  
  constructor(port: number = 3100) {
    this.server = new PersistentSessionServer();
    this.registerServerListener('session:created', (payload) => {
      this.pushEvent('session:created', payload, payload.sessionId);
    });
    this.registerServerListener('session:output', (payload) => {
      this.pushEvent('session:output', payload, payload.sessionId);
    });
    this.registerServerListener('session:exit', (payload) => {
      this.pushEvent('session:exit', payload, payload.sessionId);
    });
    this.registerServerListener('command:start', (payload) => {
      this.pushEvent('command:start', payload, payload.sessionId);
    });
    this.registerServerListener('command:finished', (payload) => {
      this.pushEvent('command:finished', payload, payload.sessionId);
    });
    this.registerServerListener('session:input', (payload) => {
      this.pushEvent('session:input', payload, payload.sessionId);
    });
    this.registerServerListener('session:signal', (payload) => {
      this.pushEvent('session:signal', payload, payload.sessionId);
    });
    
    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      // Simple health check
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok', 
          sessions: this.server.listSessions().length 
        }));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });
    
    this.wss.on('connection', (ws) => {
      this.ensureSubscription(ws);
      if (process.env.DEBUG_SESSION_API) {
        console.error('[SessionAPI] Client connected');
      }
      
      ws.on('message', async (data) => {
        try {
          const message: APIMessage = JSON.parse(data.toString());
          const response = await this.handleMessage(ws, message);
          ws.send(JSON.stringify(response));
        } catch (error: any) {
          ws.send(JSON.stringify({
            id: 'error',
            error: error.message
          }));
        }
      });
      
      ws.on('close', () => {
        if (process.env.DEBUG_SESSION_API) {
          console.error('[SessionAPI] Client disconnected');
        }
        this.subscriptions.delete(ws);
      });
    });
    
    this.httpServer.listen(port, () => {
      console.log(`[SessionAPI] Listening on port ${port}`);
    });
  }
  
  private async handleMessage(ws: WebSocket, message: APIMessage): Promise<APIResponse> {
    const { id, method, params } = message;
    
    try {
      let result: any;
      
      switch (method) {
        case 'session.subscribe':
          result = await this.handleSubscribe(ws, params);
          break;

        case 'session.unsubscribe':
          result = this.handleUnsubscribe(ws, params);
          break;

        case 'session.create':
          result = await this.server.createSession(params);
          break;
          
        case 'session.exec':
          result = await this.server.execCommand(params.sessionId, params.command);
          break;
          
        case 'session.output':
          result = this.server.getOutput(params.sessionId, params.lines);
          break;
          
        case 'session.search':
          result = this.server.searchLogs(
            params.sessionId, 
            params.pattern, 
            params.contextLines
          );
          break;
          
        case 'session.list':
          result = this.server.listSessions();
          break;
          
        case 'session.kill':
          await this.server.killSession(params.sessionId, params.graceful);
          result = { success: true };
          break;
          
        case 'service.start':
          result = await this.server.startService(params);
          break;
          
        case 'session.input':
          this.server.sendInput(params.sessionId, params.input, params.appendNewline);
          result = { success: true };
          break;
          
        case 'session.signal':
          this.server.sendSignal(params.sessionId, params.signal);
          result = { success: true };
          break;
          
        case 'session.env':
          result = await this.server.getEnvironment(params.sessionId);
          break;
          
        case 'session.pwd':
          result = await this.server.getCurrentDirectory(params.sessionId);
          break;
          
        case 'session.killAll':
          await this.server.killAll(params?.graceful);
          result = { success: true };
          break;
          
        default:
          throw new Error(`Unknown method: ${method}`);
      }
      
      return { id, result };
    } catch (error: any) {
      return { id, error: error.message };
    }
  }
  
  private async handleSubscribe(ws: WebSocket, rawParams: any = {}): Promise<{
    sessionIds: string[];
    all: boolean;
  }> {
    const params = rawParams || {};
    const subscription = this.ensureSubscription(ws);
    const targetSessions = new Set<string>();

    if (params.all || params.sessionId === '*' || params.sessions === '*') {
      subscription.all = true;
    }

    const provided = Array.isArray(params.sessions)
      ? params.sessions
      : params.sessionId
        ? [params.sessionId]
        : [];

    for (const id of provided) {
      if (typeof id === 'string' && id.trim().length > 0) {
        subscription.sessions.add(id);
        targetSessions.add(id);
      }
    }

    const replayLines = typeof params.replay === 'number' ? params.replay : subscription.replayLines;
    if (typeof params.replay === 'number') {
      subscription.replayLines = params.replay;
    }

    if (process.env.DEBUG_SESSION_API) {
      console.error('[SessionAPI] subscribe', {
        sessions: Array.from(subscription.sessions),
        all: subscription.all,
        replayLines,
      });
    }

    if (replayLines > 0) {
      const sessionsToReplay = subscription.all ? this.server.listSessions().map((s) => s.id) : Array.from(targetSessions);
      for (const sessionId of sessionsToReplay) {
        this.sendBackfill(ws, sessionId, replayLines);
      }
    }

    return {
      sessionIds: Array.from(subscription.sessions),
      all: subscription.all
    };
  }

  private handleUnsubscribe(ws: WebSocket, rawParams: any = {}): {
    sessionIds: string[];
    all: boolean;
  } {
    const params = rawParams || {};
    const subscription = this.ensureSubscription(ws);

    if (params.all || params.sessionId === '*' || params.sessions === '*') {
      subscription.all = false;
    }

    const provided = Array.isArray(params.sessions)
      ? params.sessions
      : params.sessionId
        ? [params.sessionId]
        : [];

    for (const id of provided) {
      if (typeof id === 'string') {
        subscription.sessions.delete(id);
      }
    }

    return {
      sessionIds: Array.from(subscription.sessions),
      all: subscription.all
    };
  }

  private ensureSubscription(ws: WebSocket): SubscriptionState {
    let subscription = this.subscriptions.get(ws);
    if (!subscription) {
      subscription = {
        sessions: new Set<string>(),
        all: false,
        replayLines: 0
      };
      this.subscriptions.set(ws, subscription);
    }
    return subscription;
  }

  private sendBackfill(ws: WebSocket, sessionId: string, lines: number): void {
    try {
      const logs = this.server.getOutput(sessionId, lines);
      if (!logs.length) {
        return;
      }
      if (process.env.DEBUG_SESSION_API) {
        console.error('[SessionAPI] backfill', sessionId, { lines, count: logs.length });
      }
      for (const line of logs) {
        const sanitized = typeof line === 'string' ? line : String(line);
        this.sendEvent(ws, 'session:output', {
          sessionId,
          chunk: `${sanitized}\n`,
          lines: [sanitized],
          timestamp: new Date()
        });
      }
    } catch (error) {
      if (process.env.DEBUG_SESSION_API) {
        console.error('[SessionAPI] Failed to backfill logs:', error);
      }
    }
  }

  private registerServerListener(event: string, handler: (payload: any) => void): void {
    this.server.on(event as any, handler);
    this.serverListeners.push({ event, handler });
  }

  private pushEvent(event: string, payload: any, sessionId?: string): void {
    for (const [ws, subscription] of this.subscriptions.entries()) {
      const targetSession = sessionId ?? payload?.sessionId;
      const isSubscribed = subscription.all || (targetSession && subscription.sessions.has(targetSession));
      if (!isSubscribed) {
        continue;
      }
      this.sendEvent(ws, event, payload);
    }
  }

  private sendEvent(ws: WebSocket, event: string, payload: any): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const envelope: EventEnvelope = {
      type: 'event',
      event,
      sessionId: payload?.sessionId,
      payload
    };
    ws.send(JSON.stringify(envelope));
  }

  async stop(): Promise<void> {
    await this.server.killAll(); // Graceful shutdown by default
    this.wss.close();
    this.httpServer.close();
    for (const { event, handler } of this.serverListeners) {
      this.server.off(event as any, handler);
    }
    this.serverListeners = [];
    this.subscriptions.clear();
  }
}

// Simple client for testing
export class SessionClient extends EventEmitter {
  private ws: any; // WebSocket from 'ws' package
  private pending = new Map<string, (response: APIResponse) => void>();
  private connected: Promise<void>;
  
  constructor(url: string = 'ws://localhost:3100') {
    super();
    const WebSocket = require('ws');
    this.ws = new WebSocket(url);
    
    this.connected = new Promise((resolve, reject) => {
      this.ws.on('open', () => {
        if (process.env.MCP_DEBUG) {
          console.error('[Client] Connected to session server');
        }
        resolve();
      });
      this.ws.on('error', (err: Error) => {
        if (process.env.MCP_DEBUG) {
          console.error('[Client] Connection error:', err.message);
        }
        reject(err);
      });
    });
    
    this.ws.on('message', (data: Buffer) => {
      const payload = JSON.parse(data.toString());
      if (process.env.MCP_DEBUG) {
        console.error('[Client] Received response:', payload);
      }

      if (payload && payload.type === 'event') {
        const envelope = payload as EventEnvelope;
        this.emit('event', envelope);
        this.emit(envelope.event, envelope);
        if (envelope.sessionId) {
          this.emit(`${envelope.event}:${envelope.sessionId}`, envelope);
        }
        return;
      }

      const response: APIResponse = payload;
      const handler = this.pending.get(response.id);
      if (handler) {
        handler(response);
        this.pending.delete(response.id);
      }
    });
  }
  
  async request(method: string, params?: any): Promise<any> {
    await this.connected;
    
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substr(2, 9);
      const message = { id, method, params };
      
      if (process.env.MCP_DEBUG) {
        console.error('[Client] Sending request:', message);
      }
      
      this.pending.set(id, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });
      
      this.ws.send(JSON.stringify(message));
    });
  }
  
  async createSession(params: any) {
    return this.request('session.create', params);
  }
  
  async exec(sessionId: string, command: string) {
    return this.request('session.exec', { sessionId, command });
  }
  
  async getOutput(sessionId: string, lines?: number) {
    return this.request('session.output', { sessionId, lines });
  }
  
  async searchLogs(sessionId: string, pattern: string, contextLines?: number) {
    return this.request('session.search', { sessionId, pattern, contextLines });
  }
  
  async listSessions() {
    return this.request('session.list');
  }
  
  async startService(params: any) {
    return this.request('service.start', params);
  }
  
  async sendInput(sessionId: string, input: string, appendNewline?: boolean) {
    return this.request('session.input', { sessionId, input, appendNewline });
  }
  
  async sendSignal(sessionId: string, signal: string = 'SIGINT') {
    return this.request('session.signal', { sessionId, signal });
  }
  
  async getEnvironment(sessionId: string) {
    return this.request('session.env', { sessionId });
  }
  
  async getCurrentDirectory(sessionId: string) {
    return this.request('session.pwd', { sessionId });
  }
  
  async subscribe(params: {
    sessionId?: string;
    sessions?: string[];
    all?: boolean;
    replay?: number;
  }) {
    return this.request('session.subscribe', params);
  }

  async unsubscribe(params: {
    sessionId?: string;
    sessions?: string[];
    all?: boolean;
  }) {
    return this.request('session.unsubscribe', params);
  }

  async killAll() {
    return this.request('session.killAll');
  }
  
  close() {
    this.ws.close();
  }
}

// Start server if run directly
if (require.main === module) {
  const api = new SessionAPI();
  
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await api.stop();
    process.exit(0);
  });
}

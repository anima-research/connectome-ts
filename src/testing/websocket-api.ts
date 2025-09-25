/**
 * WebSocket API for Session Server
 * 
 * Provides real-time access to terminal sessions
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
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

export class SessionAPI {
  private wss: WebSocketServer;
  private server: PersistentSessionServer;
  private httpServer: any;
  
  constructor(port: number = 3100) {
    this.server = new PersistentSessionServer();
    
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
      if (process.env.DEBUG_SESSION_API) {
        console.error('[SessionAPI] Client connected');
      }
      
      ws.on('message', async (data) => {
        try {
          const message: APIMessage = JSON.parse(data.toString());
          const response = await this.handleMessage(message);
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
      });
    });
    
    this.httpServer.listen(port, () => {
      console.log(`[SessionAPI] Listening on port ${port}`);
    });
  }
  
  private async handleMessage(message: APIMessage): Promise<APIResponse> {
    const { id, method, params } = message;
    
    try {
      let result: any;
      
      switch (method) {
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
          this.server.killSession(params.sessionId);
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
          this.server.killAll();
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
  
  stop(): void {
    this.server.killAll();
    this.wss.close();
    this.httpServer.close();
  }
}

// Simple client for testing
export class SessionClient {
  private ws: any; // WebSocket from 'ws' package
  private pending = new Map<string, (response: APIResponse) => void>();
  private connected: Promise<void>;
  
  constructor(url: string = 'ws://localhost:3100') {
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
      const response: APIResponse = JSON.parse(data.toString());
      if (process.env.MCP_DEBUG) {
        console.error('[Client] Received response:', response);
      }
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
  
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    api.stop();
    process.exit(0);
  });
}

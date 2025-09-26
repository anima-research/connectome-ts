import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface EventEnvelope {
  type: 'event';
  event: string;
  sessionId?: string;
  payload: any;
}

interface APIResponse {
  id: string;
  result?: any;
  error?: string;
}

export class SessionClient extends EventEmitter {
  private ws: WebSocket;
  private pending = new Map<string, (response: APIResponse) => void>();
  private connected: Promise<void>;

  constructor(private url: string = process.env.SESSION_API_URL || 'ws://localhost:3100') {
    super();
    this.ws = new WebSocket(this.url);

    this.connected = new Promise((resolve, reject) => {
      this.ws.once('open', () => {
        resolve();
      });
      this.ws.once('error', (err: Error) => {
        reject(err);
      });
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      const payload = JSON.parse(data.toString());

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

    this.ws.on('close', () => {
      this.pending.forEach((handler) => handler({ id: 'close', error: 'Connection closed' }));
      this.pending.clear();
    });
  }

  private async ensureConnected(): Promise<void> {
    return this.connected;
  }

  async request(method: string, params?: any): Promise<any> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substr(2, 9);
      const message = { id, method, params };

      this.pending.set(id, (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });

      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
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

  async killSession(sessionId: string) {
    return this.request('session.kill', { sessionId });
  }

  async killAll() {
    return this.request('session.killAll');
  }

  close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

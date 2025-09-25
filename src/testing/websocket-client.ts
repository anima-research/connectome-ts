import { EventEmitter } from 'events';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting'
}

export class RobustSessionClient extends EventEmitter {
  private ws: any | null = null;
  private url: string;
  private pending = new Map<string, PendingRequest>();
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private requestTimeout = 10000; // 10 second timeout for requests
  
  constructor(url: string = 'ws://localhost:3100') {
    super();
    this.url = url;
    this.connect();
  }
  
  private connect(): void {
    if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
      return;
    }
    
    this.state = ConnectionState.CONNECTING;
    const WebSocket = require('ws');
    
    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      this.handleConnectionError(error);
    }
  }
  
  private setupEventHandlers(): void {
    if (!this.ws) return;
    
    this.ws.on('open', () => {
      if (process.env.MCP_DEBUG) {
        console.error('[RobustClient] Connected to session server');
      }
      this.state = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this.emit('connected');
    });
    
    this.ws.on('error', (err: Error) => {
      if (process.env.MCP_DEBUG) {
        console.error('[RobustClient] Connection error:', err.message);
      }
      this.handleConnectionError(err);
    });
    
    this.ws.on('close', () => {
      if (process.env.MCP_DEBUG) {
        console.error('[RobustClient] Connection closed');
      }
      this.handleDisconnection();
    });
    
    this.ws.on('message', (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        if (process.env.MCP_DEBUG) {
          console.error('[RobustClient] Received response:', response);
        }
        
        const pending = this.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(response.id);
          
          if (response.error) {
            pending.reject(new Error(response.error));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('[RobustClient] Error parsing message:', error);
      }
    });
  }
  
  private handleConnectionError(error: any): void {
    this.state = ConnectionState.DISCONNECTED;
    
    // Reject all pending requests
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection lost'));
    }
    this.pending.clear();
    
    // Clean up WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    
    // Schedule reconnection
    this.scheduleReconnect();
  }
  
  private handleDisconnection(): void {
    this.handleConnectionError(new Error('WebSocket closed'));
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (process.env.MCP_DEBUG) {
        console.error('[RobustClient] Max reconnection attempts reached');
      }
      this.emit('max_reconnect_failed');
      return;
    }
    
    this.state = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;
    
    if (process.env.MCP_DEBUG) {
      console.error(`[RobustClient] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`);
    }
    
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
    
    // Exponential backoff with max delay of 30 seconds
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
  
  async request(method: string, params?: any): Promise<any> {
    // Wait for connection if not connected
    if (this.state !== ConnectionState.CONNECTED) {
      await this.waitForConnection();
    }
    
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).substr(2, 9);
      const message = { id, method, params };
      
      if (process.env.MCP_DEBUG) {
        console.error('[RobustClient] Sending request:', message);
      }
      
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);
      
      // Store pending request
      this.pending.set(id, { resolve, reject, timeout });
      
      // Send message
      try {
        if (!this.ws || this.ws.readyState !== 1) { // 1 = OPEN
          throw new Error('WebSocket not connected');
        }
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        // Clean up and reject
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  
  private waitForConnection(): Promise<void> {
    if (this.state === ConnectionState.CONNECTED) {
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeListener('connected', onConnect);
        reject(new Error('Connection timeout'));
      }, this.requestTimeout);
      
      const onConnect = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      this.once('connected', onConnect);
      
      // Try to connect if not already trying
      if (this.state === ConnectionState.DISCONNECTED) {
        this.connect();
      }
    });
  }
  
  // API methods
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
    // Cancel reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    
    // Reject pending requests
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client closed'));
    }
    this.pending.clear();
    
    this.state = ConnectionState.DISCONNECTED;
  }
}


/**
 * MCP Server for Connectome Testing
 * 
 * Exposes session management tools to AI assistants
 */

import { RobustSessionClient } from './websocket-client';

interface ServiceConfig {
  name: string;
  command: string;
  cwd?: string;
  readyPatterns?: string[];
  errorPatterns?: string[];
}

interface CommandResult {
  output: string;
  exitCode: number;
  duration: number;
}

interface LogMatch {
  lineNumber: number;
  line: string;
  context: string[];
}

export class ConnectomeTestingMCP {
  private client: RobustSessionClient | null = null;
  private apiUrl: string;
  private serviceMap = new Map<string, string>(); // name -> sessionId
  
  constructor(apiUrl: string = 'ws://localhost:3100') {
    this.apiUrl = apiUrl;
  }
  
  private getClient(): RobustSessionClient {
    if (!this.client) {
      this.client = new RobustSessionClient(this.apiUrl);
    }
    return this.client;
  }
  
  private resetClient(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
  
  // Note: withConnectionRetry is now less critical since RobustSessionClient
  // handles reconnection automatically, but we keep it for extra safety
  private async withConnectionRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      // The RobustSessionClient should handle most reconnection scenarios,
      // but this provides an extra layer of safety for edge cases
      if (error.message?.includes('ECONNREFUSED') || 
          error.message?.includes('WebSocket') ||
          error.message?.includes('EPIPE') ||
          error.message?.includes('socket hang up') ||
          error.message?.includes('Connection lost')) {
        this.resetClient();
        // Try once more with a fresh connection
        return await operation();
      }
      throw error;
    }
  }
  
  /**
   * Start a service with intelligent startup detection
   * @tool
   */
  async startService(config: ServiceConfig): Promise<{
    status: 'ready' | 'error' | 'running';
    logs: string[];
    sessionId?: string;
  }> {
    try {
      const result = await this.getClient().startService(config);
      
      if (result.sessionId) {
        this.serviceMap.set(config.name, result.sessionId);
      }
      
      // Format response for readability
      return {
        status: result.status,
        logs: result.logs,
        sessionId: result.sessionId
      };
    } catch (error: any) {
      // Reset client on connection errors
      if (error.message?.includes('ECONNREFUSED') || 
          error.message?.includes('WebSocket') ||
          error.message?.includes('EPIPE')) {
        this.resetClient();
      }
      return {
        status: 'error',
        logs: [`Failed to start service: ${error.message}`]
      };
    }
  }
  
  /**
   * Run a command in a specific session
   * @tool
   */
  async runCommand(params: {
    session: string; // Can be sessionId or service name
    command: string;
  }): Promise<CommandResult> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    return await this.getClient().exec(sessionId, params.command);
  }
  
  /**
   * Get recent output from a session
   * @tool
   */
  async tailLogs(params: {
    session: string;
    lines?: number;
  }): Promise<string[]> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    const rawLogs = await this.getClient().getOutput(sessionId, params.lines || 50);
    return this.concatenateSameLine(rawLogs);
  }
  
  /**
   * Concatenate log entries that are on the same line
   * This handles character-by-character input that gets logged separately
   */
  private concatenateSameLine(logs: string[]): string[] {
    if (logs.length === 0) return logs;
    
    const processed: string[] = [];
    let currentLine = '';
    
    for (const entry of logs) {
      // Check if this entry contains a newline or carriage return
      if (entry.includes('\n') || entry.includes('\r')) {
        // This is a complete line or contains line breaks
        if (currentLine) {
          // Flush any accumulated characters
          processed.push(currentLine + entry);
          currentLine = '';
        } else {
          processed.push(entry);
        }
      } else if (entry.startsWith('$') || entry.startsWith('[') || entry.startsWith('===')) {
        // These are likely command prompts or system messages - treat as new lines
        if (currentLine) {
          processed.push(currentLine);
          currentLine = '';
        }
        processed.push(entry);
      } else if (entry.length === 1) {
        // Single character - likely from interactive input
        currentLine += entry;
      } else {
        // Multi-character entry without newlines
        if (currentLine) {
          // Continue accumulating
          currentLine += entry;
        } else {
          // Start a new line or it's a complete entry
          processed.push(entry);
        }
      }
    }
    
    // Don't forget any accumulated characters
    if (currentLine) {
      processed.push(currentLine);
    }
    
    return processed;
  }
  
  /**
   * Search logs with context
   * @tool
   */
  async searchLogs(params: {
    session: string;
    pattern: string;
    context?: number;
  }): Promise<LogMatch[]> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    return await this.getClient().searchLogs(
      sessionId, 
      params.pattern, 
      params.context || 3
    );
  }
  
  /**
   * List all active sessions
   * @tool
   */
  async listSessions(): Promise<Array<{
    id: string;
    name?: string;
    pid: number;
    startTime: Date;
    isAlive: boolean;
  }>> {
    const sessions = await this.withConnectionRetry(() =>
      this.getClient().listSessions()
    );
    
    // Enhance with service names
    return sessions.map((session: any) => {
      const name = Array.from(this.serviceMap.entries())
        .find(([_, id]) => id === session.id)?.[0];
      
      return {
        id: session.id,
        name,
        pid: session.pid,
        startTime: session.startTime,
        isAlive: session.isAlive
      };
    });
  }
  
  /**
   * Kill a specific session
   * @tool
   */
  async killSession(params: {
    session: string;
  }): Promise<{ success: boolean }> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    
    try {
      await this.getClient().request('session.kill', { sessionId });
      
      // Remove from service map
      for (const [name, id] of Array.from(this.serviceMap.entries())) {
        if (id === sessionId) {
          this.serviceMap.delete(name);
          break;
        }
      }
      
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }
  
  /**
   * Create a new terminal session
   * @tool
   */
  async createSession(params: {
    id: string;
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<{
    sessionId: string;
    info: any;
  }> {
    return await this.getClient().createSession(params);
  }
  
  /**
   * Send input to an interactive session
   * @tool
   */
  async sendInput(params: {
    session: string;
    input: string;
  }): Promise<{ success: boolean }> {
    try {
      const sessionId = this.serviceMap.get(params.session) || params.session;
      await this.withConnectionRetry(() =>
        this.getClient().sendInput(sessionId, params.input)
      );
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }
  
  /**
   * Send a signal to a session (e.g., SIGINT for Ctrl+C)
   * @tool
   */
  async sendSignal(params: {
    session: string;
    signal?: string;
  }): Promise<{ success: boolean }> {
    try {
      const sessionId = this.serviceMap.get(params.session) || params.session;
      await this.withConnectionRetry(() =>
        this.getClient().sendSignal(sessionId, params.signal || 'SIGINT')
      );
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }
  
  /**
   * Get environment variables for a session
   * @tool
   */
  async getEnvironment(params: {
    session: string;
  }): Promise<Record<string, string>> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    return await this.getClient().getEnvironment(sessionId);
  }
  
  /**
   * Get current working directory for a session
   * @tool
   */
  async getCurrentDirectory(params: {
    session: string;
  }): Promise<string> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    return await this.getClient().getCurrentDirectory(sessionId);
  }
  
  /**
   * Kill all sessions
   * @tool
   */
  async killAll(): Promise<{ success: boolean }> {
    try {
      await this.getClient().killAll();
      this.serviceMap.clear();
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  }
  
  /**
   * Run a test scenario with assertions
   * @tool
   */
  async runTest(params: {
    name: string;
    setup: string[];
    test: string;
    cleanup?: string[];
    timeout?: number;
  }): Promise<{
    success: boolean;
    output: string;
    duration: number;
  }> {
    const sessionId = `test-${params.name}-${Date.now()}`;
    const startTime = Date.now();
    const outputs: string[] = [];
    
    try {
      // Create test session
      await this.createSession({ id: sessionId });
      
      // Run setup commands
      for (const cmd of params.setup) {
        const result = await this.runCommand({ session: sessionId, command: cmd });
        outputs.push(`$ ${cmd}\n${result.output}\n`);
        
        if (result.exitCode !== 0) {
          throw new Error(`Setup failed: ${cmd}`);
        }
      }
      
      // Run test
      const testResult = await this.runCommand({ 
        session: sessionId, 
        command: params.test 
      });
      outputs.push(`$ ${params.test}\n${testResult.output}\n`);
      
      // Run cleanup
      if (params.cleanup) {
        for (const cmd of params.cleanup) {
          await this.runCommand({ session: sessionId, command: cmd });
        }
      }
      
      // Clean up session
      await this.killSession({ session: sessionId });
      
      return {
        success: testResult.exitCode === 0,
        output: outputs.join('\n'),
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      // Ensure cleanup
      await this.killSession({ session: sessionId }).catch(() => {});
      
      return {
        success: false,
        output: outputs.join('\n') + `\nError: ${error.message}`,
        duration: Date.now() - startTime
      };
    }
  }
  
  /**
   * Wait for a pattern to appear in logs
   * @tool
   */
  async waitForPattern(params: {
    session: string;
    pattern: string;
    timeout?: number;
  }): Promise<{
    found: boolean;
    match?: LogMatch;
    elapsed: number;
  }> {
    const sessionId = this.serviceMap.get(params.session) || params.session;
    const timeout = params.timeout || 10000;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const matches = await this.searchLogs({
        session: sessionId,
        pattern: params.pattern,
        context: 3
      });
      
      if (matches.length > 0) {
        return {
          found: true,
          match: matches[0],
          elapsed: Date.now() - startTime
        };
      }
      
      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return {
      found: false,
      elapsed: Date.now() - startTime
    };
  }
}

// Example usage for testing
if (require.main === module) {
  const demo = async () => {
    const mcp = new ConnectomeTestingMCP();
    
    // Start a service
    console.log('Starting test server...');
    const result = await mcp.startService({
      name: 'test-server',
      command: 'npx http-server -p 8080',
      readyPatterns: ['listening', 'available']
    });
    
    console.log('Service status:', result.status);
    console.log('Startup logs:', result.logs);
    
    // Search logs
    const matches = await mcp.searchLogs({
      session: 'test-server',
      pattern: 'listening'
    });
    
    console.log('Found matches:', matches);
    
    // List sessions
    const sessions = await mcp.listSessions();
    console.log('Active sessions:', sessions);
  }
  
  demo().catch(console.error);
}

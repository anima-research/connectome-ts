/**
 * Session Server v3 - Persistent Shell Sessions
 * 
 * Features:
 * - Real persistent shell sessions using node-pty
 * - Environment variable persistence
 * - Working directory persistence
 * - Interactive input support
 * - Signal handling (SIGINT, SIGTERM)
 */

import * as pty from 'node-pty';
import { IPty } from 'node-pty';
import { EventEmitter } from 'events';

interface SessionInfo {
  id: string;
  name: string;
  shell: IPty;
  logs: string[];
  cwd: string;
  env: Record<string, string>;
  isAlive: boolean;
  createdAt: Date;
  lastActivity: Date;
  outputBuffer: string;
  isProcessingCommand: boolean;
  commandQueue: Array<{
    command: string;
    resolve: (result: CommandResult) => void;
    startTime: number;
  }>;
  currentCommand?: {
    command: string;
    resolve: (result: CommandResult) => void;
    startTime: number;
  };
  lineBuffer: string; // Buffer for incomplete lines
}

interface CommandResult {
  output: string;
  exitCode: number;
  duration: number;
}

interface ServiceStartOptions {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  readyPatterns?: string[];
  errorPatterns?: string[];
  shell?: string;
}

type PublicSessionInfo = {
  id: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  isAlive: boolean;
  createdAt: Date;
  lastActivity: Date;
  logSize: number;
};

type SessionEventMap = {
  'session:created': {
    sessionId: string;
    info: PublicSessionInfo;
  };
  'session:output': {
    sessionId: string;
    chunk: string;
    lines: string[];
    timestamp: Date;
  };
  'session:exit': {
    sessionId: string;
    exitCode: number | null;
    timestamp: Date;
  };
  'command:start': {
    sessionId: string;
    command: string;
    startedAt: Date;
  };
  'command:finished': {
    sessionId: string;
    command: string;
    duration: number;
    exitCode: number;
    output: string;
    finishedAt: Date;
  };
  'session:input': {
    sessionId: string;
    input: string;
    appendNewline: boolean;
    timestamp: Date;
  };
  'session:signal': {
    sessionId: string;
    signal: string;
    timestamp: Date;
  };
};

export class PersistentSessionServer extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private readonly maxLogSize = 10000; // lines per session
  private readonly commandTimeout = 2000; // 2 seconds - quick return
  private readonly promptMarker = '<<<PROMPT>>>';
  private readonly exitCodeMarker = '<<<EXIT:';

  constructor() {
    super();
    // Clean up on exit
    process.on('exit', () => this.killAll());
    process.on('SIGINT', () => {
      this.killAll();
      process.exit(0);
    });
  }

  /**
   * Create a new shell session
   */
  async createSession(id: string, options: { cwd?: string; env?: Record<string, string>; shell?: string } = {}): Promise<string> {
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }

    const shell = options.shell || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
    const cwd = options.cwd || process.cwd();
    const env = { ...process.env, ...options.env };

    // Create PTY instance
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cwd,
      env,
      cols: 120,
      rows: 30
    });

    const sessionInfo: SessionInfo = {
      id,
      name: id,
      shell: ptyProcess,
      logs: [],
      cwd,
      env: options.env || {},
      isAlive: true,
      createdAt: new Date(),
      lastActivity: new Date(),
      outputBuffer: '',
      isProcessingCommand: false,
      commandQueue: [],
      lineBuffer: ''
    };

    // Handle output
    ptyProcess.onData((data: string) => {
      sessionInfo.lastActivity = new Date();
      sessionInfo.outputBuffer += data;
      
      // Buffer characters and only log complete lines
      sessionInfo.lineBuffer += data;
      
      // Process any complete lines in the buffer
      const segments = sessionInfo.lineBuffer.split(/\r?\n/);
      const completedLines: string[] = [];
      
      // All but the last element are complete lines
      for (let i = 0; i < segments.length - 1; i++) {
        const line = segments[i];
        if (line.length > 0) {
          this.addLog(sessionInfo, line);
          completedLines.push(line);
        }
      }
      
      // The last element is either empty (if data ended with newline) or incomplete
      sessionInfo.lineBuffer = segments[segments.length - 1];

      if (data.length > 0) {
        this.notify('session:output', {
          sessionId: sessionInfo.id,
          chunk: data,
          lines: completedLines,
          timestamp: new Date()
        });
      }

      // Check if we're done with current command
      this.checkCommandCompletion(sessionInfo);
    });

    // Handle exit
    ptyProcess.onExit(({ exitCode }) => {
      sessionInfo.isAlive = false;
      
      // Flush any remaining buffered line
      if (sessionInfo.lineBuffer.length > 0) {
        this.addLog(sessionInfo, sessionInfo.lineBuffer);
        sessionInfo.lineBuffer = '';
      }
      
      this.addLog(sessionInfo, `[Session terminated with code ${exitCode}]`);
      this.notify('session:exit', {
        sessionId: sessionInfo.id,
        exitCode,
        timestamp: new Date()
      });
    });

    this.sessions.set(id, sessionInfo);

    // Initialize the shell and wait for it to be ready
    await this.initializeShell(sessionInfo);

    this.notify('session:created', {
      sessionId: id,
      info: this.toPublicInfo(sessionInfo)
    });

    return id;
  }

  /**
   * Initialize shell with minimal setup
   */
  private async initializeShell(session: SessionInfo): Promise<void> {
    // Just set basic environment, no custom prompts
    const isWindows = process.platform === 'win32';
    
    if (!isWindows) {
      // Minimal setup - just ensure a clean environment
      session.shell.write('export TERM=xterm-color\n');
      await this.sleep(200); // Give shell time to initialize
      
      // Clear any initial output/warnings
      session.outputBuffer = '';
      session.logs = [];
    }
  }

  /**
   * Execute a command in a session
   */
  async execCommand(sessionId: string, command: string): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!session.isAlive) {
      throw new Error(`Session ${sessionId} is not alive`);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Queue the command
      session.commandQueue.push({
        command,
        resolve,
        startTime
      });

      // Process queue if not already processing
      if (!session.isProcessingCommand) {
        this.processCommandQueue(session);
      }
    });
  }

  /**
   * Process queued commands
   */
  private async processCommandQueue(session: SessionInfo): Promise<void> {
    if (session.commandQueue.length === 0 || session.isProcessingCommand) {
      return;
    }

    session.isProcessingCommand = true;
    const currentCommand = session.commandQueue.shift()!;
    session.currentCommand = currentCommand;

    // Clear output buffer
    session.outputBuffer = '';

    // Add command to logs
    this.addLog(session, `$ ${currentCommand.command}`);

    this.notify('command:start', {
      sessionId: session.id,
      command: currentCommand.command,
      startedAt: new Date(currentCommand.startTime)
    });

    // Write command
    session.shell.write(currentCommand.command + '\n');

    // Set up timeout - return quickly with whatever output we have
    const timeout = setTimeout(() => {
      session.isProcessingCommand = false;
      
      // Clean output (remove our markers if any)
      const cleanOutput = session.outputBuffer
        .replace(new RegExp(`${this.exitCodeMarker}\\d+\\n?`, 'g'), '')
        .replace(new RegExp(`${this.promptMarker}\\n?`, 'g'), '')
        .trim();
      
      this.notify('command:finished', {
        sessionId: session.id,
        command: currentCommand.command,
        duration: Date.now() - currentCommand.startTime,
        exitCode: 0,
        output: cleanOutput,
        finishedAt: new Date()
      });

      currentCommand.resolve({
        output: cleanOutput,
        exitCode: 0, // 0 indicates "still running" rather than error
        duration: Date.now() - currentCommand.startTime
      });
      session.currentCommand = undefined;
      this.processCommandQueue(session);
    }, this.commandTimeout);

    // Store timeout so we can clear it
    (session as any).currentTimeout = timeout;
  }

  /**
   * Check if command execution is complete (simplified)
   */
  private checkCommandCompletion(session: SessionInfo): void {
    // Since we're using a timeout-based approach, we don't need complex detection
    // The output is being collected in the buffer and will be returned when timeout fires
  }

  /**
   * Send input to a session (for interactive programs)
   */
  sendInput(sessionId: string, input: string, appendNewline: boolean = true): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      throw new Error(`Session ${sessionId} not available`);
    }

    // Append newline by default (most interactive programs expect this)
    const dataToSend = appendNewline ? `${input}\n` : input;
    session.shell.write(dataToSend);
    session.lastActivity = new Date();

    this.notify('session:input', {
      sessionId,
      input,
      appendNewline,
      timestamp: new Date()
    });
  }

  /**
   * Send a signal to a session
   */
  sendSignal(sessionId: string, signal: string = 'SIGINT'): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isAlive) {
      throw new Error(`Session ${sessionId} not available`);
    }

    // For SIGINT, send Ctrl+C
    if (signal === 'SIGINT') {
      session.shell.write('\x03');
    } else if (signal === 'SIGTERM') {
      session.shell.kill('SIGTERM');
    } else {
      session.shell.kill(signal as any);
    }

    this.notify('session:signal', {
      sessionId,
      signal,
      timestamp: new Date()
    });
  }

  /**
   * Start a service (simplified - just create session and run command)
   */
  async startService(options: ServiceStartOptions): Promise<{
    status: 'ready' | 'running' | 'error';
    logs: string[];
    sessionId: string;
  }> {
    // Create session
    const sessionId = await this.createSession(options.name, {
      cwd: options.cwd,
      env: options.env
    });

    // Execute command and return quickly
    const result = await this.execCommand(sessionId, options.command);
    
    const session = this.sessions.get(sessionId)!;
    
    // Simple status detection from output
    let status: 'ready' | 'running' | 'error' = 'running';
    
    if (options.errorPatterns) {
      for (const pattern of options.errorPatterns) {
        if (result.output.includes(pattern)) {
          status = 'error';
          break;
        }
      }
    }
    
    if (status !== 'error' && options.readyPatterns) {
      for (const pattern of options.readyPatterns) {
        if (result.output.includes(pattern)) {
          status = 'ready';
          break;
        }
      }
    }
    
    return {
      status,
      logs: session.logs.slice(-20),
      sessionId
    };
  }

  /**
   * Get session output/logs
   */
  getOutput(sessionId: string, lines?: number): string[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (lines) {
      return session.logs.slice(-lines);
    }
    return session.logs;
  }

  /**
   * Search logs with optional regex
   */
  searchLogs(sessionId: string, pattern: string | RegExp, options?: {
    limit?: number;
    context?: number;
  }): Array<{ line: string; lineNumber: number; context?: string[] }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const regex = typeof pattern === 'string' ? 
      new RegExp(pattern, 'i') : pattern;

    const results: Array<{ line: string; lineNumber: number; context?: string[] }> = [];
    const limit = options?.limit || 100;
    const contextLines = options?.context || 0;

    for (let i = 0; i < session.logs.length && results.length < limit; i++) {
      if (regex.test(session.logs[i])) {
        const result: any = {
          line: session.logs[i],
          lineNumber: i + 1
        };

        if (contextLines > 0) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(session.logs.length, i + contextLines + 1);
          result.context = session.logs.slice(start, end);
        }

        results.push(result);
      }
    }

    return results;
  }

  /**
   * List all sessions
   */
  listSessions(): Array<{
    id: string;
    name: string;
    isAlive: boolean;
    createdAt: Date;
    lastActivity: Date;
    logSize: number;
  }> {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({
      id,
      name: session.name,
      isAlive: session.isAlive,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      logSize: session.logs.length
    }));
  }

  /**
   * Kill a session with optional graceful shutdown
   */
  async killSession(sessionId: string, graceful: boolean = true): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.isAlive) {
      if (graceful) {
        // Send SIGINT for graceful shutdown
        session.shell.kill('SIGINT');
        
        // Wait up to 5 seconds for process to exit gracefully
        const timeout = 3000;
        const startTime = Date.now();
        
        while (session.isAlive && Date.now() - startTime < timeout) {
          await this.sleep(100);
        }
        
        // If still alive after timeout, force kill
        if (session.isAlive) {
          this.addLog(session, '[Process did not exit gracefully, forcing termination]');
          session.shell.kill('SIGKILL');
        }
      } else {
        // Force kill immediately
        session.shell.kill('SIGKILL');
      }
    }
    
    // Wait a bit to ensure the process has fully terminated
    await this.sleep(100);
    this.sessions.delete(sessionId);
  }

  /**
   * Kill all sessions with optional graceful shutdown
   */
  async killAll(graceful: boolean = true): Promise<void> {
    const killPromises = Array.from(this.sessions.keys()).map(id => 
      this.killSession(id, graceful)
    );
    await Promise.all(killPromises);
    this.sessions.clear();
  }

  /**
   * Get environment variables for a session
   */
  async getEnvironment(sessionId: string): Promise<Record<string, string>> {
    const result = await this.execCommand(sessionId, 'env');
    const env: Record<string, string> = {};
    
    const lines = result.output.split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }
    
    return env;
  }

  /**
   * Get current working directory
   */
  async getCurrentDirectory(sessionId: string): Promise<string> {
    const result = await this.execCommand(sessionId, 'pwd');
    return result.output.trim();
  }

  // Helper methods
  private addLog(session: SessionInfo, line: string): void {
    session.logs.push(line);
    if (session.logs.length > this.maxLogSize) {
      session.logs.shift();
    }
  }

  private toPublicInfo(session: SessionInfo): PublicSessionInfo {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      env: session.env,
      isAlive: session.isAlive,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      logSize: session.logs.length
    };
  }

  private notify<K extends keyof SessionEventMap>(
    event: K,
    payload: SessionEventMap[K]
  ): void {
    this.emit(event, payload);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

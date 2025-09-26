import * as vscode from 'vscode';
import stripAnsi from 'strip-ansi';
import { SessionClient, EventEnvelope } from './sessionClient';

interface CommandEntry {
  id: string;
  command: string;
  status: 'running' | 'finished';
  timestamp: string;
  duration?: number;
  exitCode?: number;
  outputPreview?: string;
}

interface SessionViewState {
  id: string;
  isAlive: boolean;
  output: string[];
  commandLog: CommandEntry[];
  cwd?: string;
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('connectome.sessionViewer.open', () => {
      SessionViewerPanel.createOrShow(context.extensionUri);
    })
  );
}

export function deactivate() {}

class SessionViewerPanel {
  private static currentPanel: SessionViewerPanel | undefined;

  static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SessionViewerPanel.currentPanel) {
      SessionViewerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'connectomeSessionViewer',
      'Connectome Sessions',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    SessionViewerPanel.currentPanel = new SessionViewerPanel(panel, extensionUri);
  }

  private panel: vscode.WebviewPanel;
  private sessionClient: SessionClient;
  private disposables: vscode.Disposable[] = [];
  private sessions = new Map<string, SessionViewState>();
  private selectedSessionId: string | undefined;
  private commandTrackers = new Map<string, CommandEntry>();
  private readonly maxOutputLines = 500;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.renderHtml();
    this.sessionClient = new SessionClient();

    this.setupListeners();
    this.initialize();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private setupListeners() {
    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'selectSession':
          this.selectedSessionId = message.sessionId;
          this.pushState();
          break;
        case 'createSession':
          await this.handleCreateSession();
          break;
        case 'killSession':
          await this.handleKillSession(message.sessionId);
          break;
        case 'sendCommand':
          await this.handleSendCommand(message.sessionId, message.command);
          break;
        case 'sendInput':
          await this.handleSendInput(message.sessionId, message.input);
          break;
        case 'sendSignal':
          await this.handleSendSignal(message.sessionId, message.signal);
          break;
        default:
          break;
      }
    }, null, this.disposables);

    const onEvent = (envelope: EventEnvelope) => this.handleEvent(envelope);
    this.sessionClient.on('event', onEvent);
    this.disposables.push({ dispose: () => this.sessionClient.off('event', onEvent) });
  }

  private async initialize() {
    try {
      const sessions: Array<{ id: string; name?: string; isAlive?: boolean; cwd?: string }> = await this.sessionClient.listSessions();
      for (const session of sessions) {
        this.ensureSession(session.id);
        const state = this.sessions.get(session.id)!;
        state.isAlive = session.isAlive ?? true;
        state.cwd = session.cwd;
        const logs = await this.sessionClient.getOutput(session.id, 100);
        state.output = this.mergeOutput(state.output, logs.map((line: string) => sanitize(line)));
      }
      if (sessions.length > 0) {
        this.selectedSessionId = sessions[0].id;
      }
      await this.sessionClient.subscribe({ all: true, replay: 100 });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to connect to session server: ${error.message}`);
    } finally {
      this.pushState();
    }
  }

  private async handleCreateSession() {
    const id = await vscode.window.showInputBox({
      prompt: 'New session name',
      placeHolder: 'session-id',
      value: `session-${Date.now()}`
    });
    if (!id) {
      return;
    }
    try {
      await this.sessionClient.createSession({ id, shell: process.env.SHELL || '/bin/zsh' });
      this.selectedSessionId = id;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create session: ${error.message}`);
    }
  }

  private async handleKillSession(sessionId: string) {
    const confirm = await vscode.window.showWarningMessage(`Kill session ${sessionId}?`, 'Yes', 'No');
    if (confirm !== 'Yes') {
      return;
    }
    try {
      await this.sessionClient.killSession(sessionId);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to kill session: ${error.message}`);
    }
  }

  private async handleSendCommand(sessionId: string, command: string) {
    if (!command?.trim()) {
      return;
    }
    try {
      await this.sessionClient.exec(sessionId, command);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to run command: ${error.message}`);
    }
  }

  private async handleSendInput(sessionId: string, input: string) {
    if (!input) {
      return;
    }
    try {
      await this.sessionClient.sendInput(sessionId, input, true);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to send input: ${error.message}`);
    }
  }

  private async handleSendSignal(sessionId: string, signal: string) {
    try {
      await this.sessionClient.sendSignal(sessionId, signal);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to send signal: ${error.message}`);
    }
  }

  private handleEvent(envelope: EventEnvelope) {
    const sessionId = envelope.sessionId || 'unknown';
    const state = this.ensureSession(sessionId);

    switch (envelope.event) {
      case 'session:created':
        state.isAlive = true;
        state.cwd = envelope.payload?.info?.cwd;
        if (!this.selectedSessionId) {
          this.selectedSessionId = sessionId;
        }
        break;
      case 'session:exit':
        state.isAlive = false;
        break;
      case 'session:output': {
        const lines: string[] = envelope.payload?.lines ?? [];
        const chunk: string | undefined = envelope.payload?.chunk;
        const sanitizedLines: string[] = [];
        for (const line of lines) {
          const clean = sanitize(line);
          if (clean) {
            sanitizedLines.push(clean);
          }
        }
        if (!sanitizedLines.length && chunk) {
          const cleanChunk = sanitize(chunk);
          if (cleanChunk) {
            sanitizedLines.push(cleanChunk);
          }
        }
        state.output = this.mergeOutput(state.output, sanitizedLines);
        break;
      }
      case 'command:start': {
        const entry: CommandEntry = {
          id: `${Date.now()}-${Math.random()}`,
          command: envelope.payload?.command ?? 'unknown',
          status: 'running',
          timestamp: new Date().toISOString()
        };
        state.commandLog = [entry, ...state.commandLog].slice(0, 100);
        this.commandTrackers.set(sessionId, entry);
        break;
      }
      case 'command:finished': {
        const tracker = this.commandTrackers.get(sessionId);
        if (tracker) {
          tracker.status = 'finished';
          tracker.duration = envelope.payload?.duration;
          tracker.exitCode = envelope.payload?.exitCode;
          tracker.outputPreview = sanitize(envelope.payload?.output || '').split('\n').slice(0, 3).join('\n');
          this.commandTrackers.delete(sessionId);
        } else {
          const entry: CommandEntry = {
            id: `${Date.now()}-${Math.random()}`,
            command: envelope.payload?.command ?? 'command',
            status: 'finished',
            timestamp: new Date().toISOString(),
            duration: envelope.payload?.duration,
            exitCode: envelope.payload?.exitCode,
            outputPreview: sanitize(envelope.payload?.output || '').split('\n').slice(0, 3).join('\n')
          };
          state.commandLog = [entry, ...state.commandLog].slice(0, 100);
        }
        break;
      }
      default:
        break;
    }

    this.pushState();
  }

  private ensureSession(sessionId: string): SessionViewState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        isAlive: true,
        output: [],
        commandLog: []
      });
    }
    return this.sessions.get(sessionId)!;
  }

  private mergeOutput(existing: string[], additions: string[]): string[] {
    if (!additions.length) {
      return existing;
    }
    const next = existing.concat(additions);
    if (next.length > this.maxOutputLines) {
      return next.slice(next.length - this.maxOutputLines);
    }
    return next;
  }

  private pushState() {
    const sessions = Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      isAlive: session.isAlive,
      cwd: session.cwd,
      output: session.output,
      commandLog: session.commandLog
    }));

    this.panel.webview.postMessage({
      type: 'state',
      sessions,
      selectedSessionId: this.selectedSessionId ?? sessions[0]?.id ?? null
    });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connectome Sessions</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      display: flex;
      height: 100vh;
    }
    .layout {
      display: grid;
      grid-template-columns: 220px 1fr 240px;
      grid-template-rows: auto 48px;
      grid-template-areas:
        "commands output sessions"
        "input input sessions";
      width: 100%;
      height: 100%;
    }
    .commands {
      grid-area: commands;
      border-right: 1px solid #333;
      overflow-y: auto;
      padding: 8px;
    }
    .commands h2 {
      margin-top: 0;
      font-size: 12px;
      text-transform: uppercase;
      color: #cccccc;
    }
    .command-entry {
      border-bottom: 1px solid #2a2a2a;
      padding: 6px 0;
    }
    .command-entry.running {
      color: #89d185;
    }
    .command-entry.finished {
      color: #dcdcaa;
    }
    .output {
      grid-area: output;
      padding: 8px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .sessions {
      grid-area: sessions;
      border-left: 1px solid #333;
      padding: 8px;
      display: flex;
      flex-direction: column;
    }
    .sessions-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
      text-transform: uppercase;
      color: #cccccc;
    }
    .session-list {
      flex: 1;
      overflow-y: auto;
    }
    .session-item {
      padding: 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }
    .session-item:hover {
      background: rgba(255,255,255,0.04);
    }
    .session-item.active {
      border-color: #007acc;
      background: rgba(0,122,204,0.15);
    }
    .session-actions button {
      background: transparent;
      border: none;
      color: #d4d4d4;
      cursor: pointer;
    }
    .session-actions button:hover {
      color: #f48771;
    }
    .input-bar {
      grid-area: input;
      padding: 8px;
      border-top: 1px solid #333;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .input-bar input {
      flex: 1;
      padding: 6px;
      border-radius: 4px;
      border: 1px solid #555;
      background: #252526;
      color: inherit;
    }
    .input-bar button {
      background: #0e639c;
      border: none;
      color: #fff;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
    }
    .input-bar button.secondary {
      background: #3a3d41;
    }
    .empty-state {
      opacity: 0.6;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="commands">
      <h2>Commands</h2>
      <div id="commandLog"></div>
    </aside>
    <main class="output" id="output">
      <div class="empty-state">Select a session to view output.</div>
    </main>
    <aside class="sessions">
      <div class="sessions-header">
        <span>Sessions</span>
        <button id="createSession" title="New session">＋</button>
      </div>
      <div class="session-list" id="sessionList"></div>
    </aside>
    <div class="input-bar">
      <input id="commandInput" type="text" placeholder="Enter command or input..." />
      <button id="sendCommand">Run</button>
      <button id="sendInput" class="secondary">Send Input</button>
      <button id="sendSigint" class="secondary" title="Send SIGINT">Ctrl+C</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const escapeHtml = (str) => String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    let state = { sessions: [], selectedSessionId: null };

    function render() {
      const sessionList = document.getElementById('sessionList');
      const output = document.getElementById('output');
      const commandLog = document.getElementById('commandLog');
      sessionList.innerHTML = '';
      commandLog.innerHTML = '';

      state.sessions.forEach((session) => {
        const item = document.createElement('div');
        item.className = 'session-item' + (state.selectedSessionId === session.id ? ' active' : '');
        item.dataset.sessionId = session.id;
        const statusLabel = session.isAlive ? '' : ' (exited)';
        const sessionLabel = escapeHtml(session.id + statusLabel);
        item.innerHTML =
          '<span>' + sessionLabel + '</span>' +
          '<span class="session-actions">' +
          '<button data-action="kill" data-session="' + escapeHtml(session.id) + '">x</button>' +
          '</span>';
        item.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) {
            vscode.postMessage({ type: 'selectSession', sessionId: session.id });
            return;
          }
          const action = target.dataset.action;
          if (action === 'kill') {
            vscode.postMessage({ type: 'killSession', sessionId: session.id });
            event.stopPropagation();
            return;
          }
          vscode.postMessage({ type: 'selectSession', sessionId: session.id });
        });
        sessionList.appendChild(item);
      });

      const activeSession = state.sessions.find((s) => s.id === state.selectedSessionId);
      if (!activeSession) {
        output.innerHTML = '<div class="empty-state">Select a session to view output.</div>';
        return;
      }

      output.textContent = activeSession.output.join('\n') || 'No output yet';

      activeSession.commandLog.forEach((entry) => {
        const container = document.createElement('div');
        container.className = 'command-entry ' + entry.status;
        const exitFragment = entry.exitCode !== undefined ? ' - exit ' + entry.exitCode : '';
        const durationFragment = entry.duration !== undefined ? ' - ' + entry.duration + 'ms' : '';
        const previewHtml = entry.outputPreview
          ? '<pre style="margin: 4px 0 0; white-space: pre-wrap;">' + escapeHtml(entry.outputPreview) + '</pre>'
          : '';
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        container.innerHTML =
          '<div>' + escapeHtml(entry.command) + '</div>' +
          '<div style="font-size: 11px; opacity: 0.7;">' +
          timestamp + ' · ' + entry.status + exitFragment + durationFragment +
          '</div>' +
          previewHtml;
        commandLog.appendChild(container);
      });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'state') {
        state = {
          sessions: message.sessions,
          selectedSessionId: message.selectedSessionId
        };
        render();
      }
    });

    document.getElementById('createSession').addEventListener('click', () => {
      vscode.postMessage({ type: 'createSession' });
    });

    document.getElementById('sendCommand').addEventListener('click', () => {
      const input = document.getElementById('commandInput');
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const command = input.value.trim();
      if (!command || !state.selectedSessionId) {
        return;
      }
      vscode.postMessage({ type: 'sendCommand', sessionId: state.selectedSessionId, command });
      input.value = '';
    });

    document.getElementById('sendInput').addEventListener('click', () => {
      const input = document.getElementById('commandInput');
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      const text = input.value;
      if (!text || !state.selectedSessionId) {
        return;
      }
      vscode.postMessage({ type: 'sendInput', sessionId: state.selectedSessionId, input: text });
      input.value = '';
    });

    document.getElementById('sendSigint').addEventListener('click', () => {
      if (!state.selectedSessionId) {
        return;
      }
      vscode.postMessage({ type: 'sendSignal', sessionId: state.selectedSessionId, signal: 'SIGINT' });
    });

    document.getElementById('commandInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && state.selectedSessionId) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        const value = target.value.trim();
        if (!value) {
          return;
        }
        vscode.postMessage({ type: 'sendCommand', sessionId: state.selectedSessionId, command: value });
        target.value = '';
      }
    });
  </script>
</body>
</html>`;
  }

  private dispose() {
    SessionViewerPanel.currentPanel = undefined;
    this.sessionClient.close();
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }
}

function sanitize(value: string): string {
  if (!value) {
    return '';
  }
  return stripAnsi(value).replace(/\r+/g, '').trimEnd();
}

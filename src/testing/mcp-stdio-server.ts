#!/usr/bin/env node

/**
 * Minimal MCP Server Implementation for Connectome Session Manager
 * 
 * Implements just enough of the MCP protocol to work with Cursor
 */

import * as readline from 'readline';
import { ConnectomeTestingMCP } from './mcp-server';

// Create readline interface for stdio communication
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Initialize our MCP wrapper (lazy - connection will be established on first use)
let mcp: ConnectomeTestingMCP | null = null;

function getMCP() {
  if (!mcp) {
    mcp = new ConnectomeTestingMCP('ws://localhost:3100');
  }
  return mcp;
}

// Tool definitions
const TOOLS = {
  startService: {
    description: 'Start a service with intelligent startup detection',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Service name' },
        command: { type: 'string', description: 'Command to run' },
        cwd: { type: 'string', description: 'Working directory' },
        readyPatterns: { type: 'array', items: { type: 'string' } },
        errorPatterns: { type: 'array', items: { type: 'string' } }
      },
      required: ['name', 'command']
    }
  },
  runCommand: {
    description: 'Run a command in a session',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        command: { type: 'string' }
      },
      required: ['session', 'command']
    }
  },
  listSessions: {
    description: 'List all active sessions',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  tailLogs: {
    description: 'Get recent logs from a session',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        lines: { type: 'number' }
      },
      required: ['session']
    }
  },
  sendInput: {
    description: 'Send input to an interactive session',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        input: { type: 'string' }
      },
      required: ['session', 'input']
    }
  },
  sendSignal: {
    description: 'Send a signal to a session (e.g., SIGINT for Ctrl+C)',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' },
        signal: { type: 'string', description: 'Signal to send (default: SIGINT)' }
      },
      required: ['session']
    }
  },
  killSession: {
    description: 'Kill a specific session',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string' }
      },
      required: ['session']
    }
  },
  killAll: {
    description: 'Kill all active sessions',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
};

// Send response
function sendResponse(id: string | number, result?: any, error?: any) {
  const response = {
    jsonrpc: '2.0',
    id,
    ...(error ? { error } : { result })
  };
  console.log(JSON.stringify(response));
}

// Handle incoming messages
rl.on('line', async (line) => {
  try {
    const message = JSON.parse(line);
    const { id, method, params } = message;
    
    // Log to stderr for debugging
    if (process.env.MCP_DEBUG) {
      console.error('Received:', method, params);
    }
    
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'connectome-session-server',
            version: '1.0.0'
          }
        });
        break;
        
      case 'tools/list':
        sendResponse(id, {
          tools: Object.entries(TOOLS).map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: def.parameters
          }))
        });
        break;
        
      case 'tools/call':
        try {
          const { name, arguments: args } = params;
          let result;
          
          // Call the appropriate method
          const mcpInstance = getMCP();
          switch (name) {
            case 'startService':
              result = await mcpInstance.startService(args);
              break;
            case 'runCommand':
              result = await mcpInstance.runCommand(args);
              break;
            case 'listSessions':
              result = await mcpInstance.listSessions();
              break;
            case 'tailLogs':
              result = await mcpInstance.tailLogs(args);
              break;
            case 'sendInput':
              result = await mcpInstance.sendInput(args);
              break;
            case 'sendSignal':
              result = await mcpInstance.sendSignal(args);
              break;
            case 'killSession':
              result = await mcpInstance.killSession(args);
              break;
            case 'killAll':
              result = await mcpInstance.killAll();
              break;
            default:
              throw new Error(`Unknown tool: ${name}`);
          }
          
          sendResponse(id, {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }]
          });
        } catch (err: any) {
          sendResponse(id, null, {
            code: -32000,
            message: err.message
          });
        }
        break;
        
      default:
        sendResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`
        });
    }
  } catch (err: any) {
    console.error('Error processing message:', err);
  }
});

// Minimal startup - don't pollute stderr unless debugging
if (process.env.MCP_DEBUG) {
  console.error('Connectome Session MCP Server started');
  console.error('Make sure session server is running on port 3100');
}

// Keep process alive
process.stdin.resume();

// Handle graceful shutdown
process.on('SIGINT', () => {
  if (mcp) {
    // Close WebSocket connection if it exists
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  if (mcp) {
    // Close WebSocket connection if it exists
    process.exit(0);
  }
});

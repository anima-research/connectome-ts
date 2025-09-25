#!/usr/bin/env node

/**
 * MCP Server CLI for Connectome Testing
 * 
 * This exposes our session management tools via the MCP protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConnectomeTestingMCP } from './mcp-server';

// Create MCP instance
const mcp = new ConnectomeTestingMCP();

// Create MCP server
const server = new Server({
  name: 'connectome-session-server',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {}
  }
});

// Register all MCP methods as tools
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'startService',
        description: 'Start a service with intelligent startup detection',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Service name' },
            command: { type: 'string', description: 'Command to run' },
            cwd: { type: 'string', description: 'Working directory' },
            readyPatterns: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Patterns that indicate service is ready' 
            },
            errorPatterns: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Patterns that indicate an error' 
            }
          },
          required: ['name', 'command']
        }
      },
      {
        name: 'runCommand',
        description: 'Run a command in a specific session',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'Session ID or service name' },
            command: { type: 'string', description: 'Command to execute' }
          },
          required: ['session', 'command']
        }
      },
      {
        name: 'tailLogs',
        description: 'Get recent output from a session',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'Session ID or service name' },
            lines: { type: 'number', description: 'Number of lines to return' }
          },
          required: ['session']
        }
      },
      {
        name: 'searchLogs',
        description: 'Search logs with context',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'Session ID or service name' },
            pattern: { type: 'string', description: 'Search pattern (regex supported)' },
            context: { type: 'number', description: 'Lines of context around matches' }
          },
          required: ['session', 'pattern']
        }
      },
      {
        name: 'listSessions',
        description: 'List all active sessions',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'killSession',
        description: 'Kill a specific session',
        inputSchema: {
          type: 'object',
          properties: {
            session: { type: 'string', description: 'Session ID or service name' }
          },
          required: ['session']
        }
      },
      {
        name: 'createSession',
        description: 'Create a new terminal session',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Session ID' },
            cwd: { type: 'string', description: 'Working directory' },
            env: { type: 'object', description: 'Environment variables' }
          },
          required: ['id']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler('tools/call', async (request: any) => {
  const { name, arguments: args } = request.params;
  
  try {
    let result;
    
    switch (name) {
      case 'startService':
        result = await mcp.startService(args);
        break;
      case 'runCommand':
        result = await mcp.runCommand(args);
        break;
      case 'tailLogs':
        result = await mcp.tailLogs(args);
        break;
      case 'searchLogs':
        result = await mcp.searchLogs(args);
        break;
      case 'listSessions':
        result = await mcp.listSessions();
        break;
      case 'killSession':
        result = await mcp.killSession(args);
        break;
      case 'createSession':
        result = await mcp.createSession(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start server
async function main() {
  console.error('Starting Connectome Session MCP Server...');
  
  // Note: The session server itself needs to be running separately
  console.error('Make sure the session server is running: npm run session-server');
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error('MCP Server ready!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});


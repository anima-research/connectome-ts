#!/usr/bin/env node
import { ConnectomeDebugMCP } from './debug-mcp-server';

// Tool definitions for MCP protocol
const TOOLS = {
  connect: {
    description: 'Connect to a Connectome debug server',
    parameters: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Debug server port' },
        host: { type: 'string', description: 'Debug server host (default: localhost)' }
      },
      required: ['port']
    }
  },
  disconnect: {
    description: 'Disconnect from the debug server',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  getConnectionStatus: {
    description: 'Get connection status',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  setResponseLimits: {
    description: 'Set response limits for MCP responses',
    parameters: {
      type: 'object',
      properties: {
        charLimit: { type: 'number', description: 'Maximum characters in any response' },
        defaultFrameLimit: { type: 'number', description: 'Default number of frames to return' }
      }
    }
  },
  getState: {
    description: 'Get the current VEIL state and space structure',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  getVEILState: {
    description: 'Get just the VEIL state (facets)',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  getFrames: {
    description: 'Get execution frames (history)',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum frames to return' },
        offset: { type: 'number', description: 'Offset for pagination' }
      }
    }
  },
  getFrame: {
    description: 'Get detailed frame information including facet tree',
    parameters: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'Frame UUID' }
      },
      required: ['frameId']
    }
  },
  getElement: {
    description: 'Get a specific element by ID',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'Element ID' }
      },
      required: ['elementId']
    }
  },
  updateElementProps: {
    description: 'Update element properties',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'Element ID' },
        props: { type: 'object', description: 'Properties to update' }
      },
      required: ['elementId', 'props']
    }
  },
  injectEvent: {
    description: 'Inject an event into the system',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Event topic' },
        payload: { type: 'object', description: 'Event payload' },
        sourceId: { type: 'string', description: 'Source ID (default: debug-mcp)' }
      },
      required: ['topic']
    }
  },
  getMetrics: {
    description: 'Get performance metrics',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  deleteFrames: {
    description: 'Delete old frames to free memory',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of frames to delete' }
      },
      required: ['count']
    }
  },
  searchFrames: {
    description: 'Search frames for specific patterns',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern' },
        type: { type: 'string', enum: ['operation', 'event', 'error'], description: 'Frame type filter' },
        limit: { type: 'number', description: 'Maximum results' }
      },
      required: ['pattern']
    }
  },
  searchInField: {
    description: 'Search within a specific field of a frame (for inspecting large fields like context)',
    parameters: {
      type: 'object',
      properties: {
        frameId: { type: 'string', description: 'Frame UUID' },
        fieldPath: { type: 'string', description: 'JSON path to field (e.g., "deltas[0].facet.state.context.messages[0].content")' },
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        contextChars: { type: 'number', description: 'Number of characters to show before/after match (default: 200)' }
      },
      required: ['frameId', 'fieldPath', 'pattern']
    }
  },
  getElementTree: {
    description: 'Get element tree starting from a specific element or root',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'Starting element ID (omit for root)' },
        depth: { type: 'number', description: 'Maximum depth to traverse' }
      }
    }
  },
  getAgents: {
    description: 'Get agents and their current state',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  getDebugLLMStatus: {
    description: 'Get debug LLM status and requests',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  getDebugLLMRequests: {
    description: 'Get debug LLM requests (all or just pending)',
    parameters: {
      type: 'object',
      properties: {
        pendingOnly: { type: 'boolean', description: 'Only return pending requests' }
      }
    }
  },
  getDebugLLMRequest: {
    description: 'Get a specific debug LLM request by ID',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Request ID' }
      },
      required: ['requestId']
    }
  },
  completeDebugLLMRequest: {
    description: 'Complete a pending debug LLM request',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Request ID' },
        content: { type: 'string', description: 'Response content' },
        modelId: { type: 'string', description: 'Model ID (optional)' },
        tokensUsed: { type: 'number', description: 'Tokens used (optional)' }
      },
      required: ['requestId', 'content']
    }
  },
  cancelDebugLLMRequest: {
    description: 'Cancel a pending debug LLM request',
    parameters: {
      type: 'object',
      properties: {
        requestId: { type: 'string', description: 'Request ID' },
        reason: { type: 'string', description: 'Cancellation reason (optional)' }
      },
      required: ['requestId']
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

// Truncate text to character limit
function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  
  const truncated = text.substring(0, limit - 100); // Leave room for truncation notice
  return `${truncated}\n\n[RESPONSE TRUNCATED - Original size: ${text.length} characters, limit: ${limit} characters]`;
}

// Initialize MCP instance
const mcpInstance = new ConnectomeDebugMCP();

// Process messages from stdin
async function processMessage(message: any) {
  if (process.env.MCP_DEBUG) {
    // console.error('[DebugMCP] Received:', message);
  }

  try {
    const { id, method, params } = message;
    
    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'connectome-inspector',
            version: '1.0.0'
          }
        });
        break;
      
      case 'tools/list':
        const tools = Object.entries(TOOLS).map(([name, def]) => ({
          name,
          description: def.description,
          inputSchema: def.parameters
        }));
        sendResponse(id, { tools });
        break;
      
      case 'tools/call':
        try {
          const { name, arguments: args } = params;
          
          // Call the appropriate method on mcpInstance
          let result;
          switch (name) {
            case 'connect':
              result = await mcpInstance.connect(args);
              break;
            case 'disconnect':
              result = await mcpInstance.disconnect();
              break;
            case 'getConnectionStatus':
              result = await mcpInstance.getConnectionStatus();
              break;
            case 'setResponseLimits':
              result = await mcpInstance.setResponseLimits(args);
              break;
            case 'getState':
              result = await mcpInstance.getState();
              break;
            case 'getVEILState':
              result = await mcpInstance.getVEILState();
              break;
            case 'getFrames':
              result = await mcpInstance.getFrames(args);
              break;
            case 'getFrame':
              result = await mcpInstance.getFrame(args);
              break;
            case 'getElement':
              result = await mcpInstance.getElement(args);
              break;
            case 'updateElementProps':
              result = await mcpInstance.updateElementProps(args);
              break;
            case 'injectEvent':
              result = await mcpInstance.injectEvent(args);
              break;
            case 'getMetrics':
              result = await mcpInstance.getMetrics();
              break;
            case 'deleteFrames':
              result = await mcpInstance.deleteFrames(args);
              break;
            case 'searchFrames':
              result = await mcpInstance.searchFrames(args);
              break;
            case 'searchInField':
              result = await mcpInstance.searchInField(args);
              break;
            case 'getElementTree':
              result = await mcpInstance.getElementTree(args);
              break;
            case 'getAgents':
              result = await mcpInstance.getAgents();
              break;
            case 'getDebugLLMStatus':
              result = await mcpInstance.getDebugLLMStatus();
              break;
            case 'getDebugLLMRequests':
              result = await mcpInstance.getDebugLLMRequests(args);
              break;
            case 'getDebugLLMRequest':
              result = await mcpInstance.getDebugLLMRequest(args);
              break;
            case 'completeDebugLLMRequest':
              result = await mcpInstance.completeDebugLLMRequest(args);
              break;
            case 'cancelDebugLLMRequest':
              result = await mcpInstance.cancelDebugLLMRequest(args);
              break;
            default:
              throw new Error(`Unknown tool: ${name}`);
          }
          
          // Get current response limits
          const limits = mcpInstance.getResponseLimits();
          const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          const truncatedText = truncateText(resultText, limits.charLimit);
          
          sendResponse(id, {
            content: [{
              type: 'text',
              text: truncatedText
            }]
          });
        } catch (err: any) {
          sendResponse(id, null, {
            code: -32603,
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
    // console.error('[DebugMCP] Error processing message:', err);
    if (message.id) {
      sendResponse(message.id, null, {
        code: -32603,
        message: err.message
      });
    }
  }
}

// Keep stdin open and read JSON-RPC messages
process.stdin.resume();
process.stdin.setEncoding('utf8');

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  
  // Process complete lines
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    
    if (line) {
      try {
        const message = JSON.parse(line);
        processMessage(message);
      } catch (err) {
        // console.error('[DebugMCP] Failed to parse message:', err);
      }
    }
  }
});

// Handle errors
process.on('uncaughtException', (err) => {
  // console.error('[DebugMCP] Uncaught exception:', err);
});

if (process.env.MCP_DEBUG) {
  // console.error('[DebugMCP] Started debug MCP server');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});




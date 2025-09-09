/**
 * Test interactive elements - A box with a surprise
 */

import { Space } from '../src/spaces/space';
import { BasicAgent } from '../src/agent/basic-agent';
import { AgentConfig, ToolDefinition } from '../src/agent/types';
import { VEILStateManager } from '../src/veil/veil-state';
import { FrameTrackingHUD } from '../src/hud/frame-tracking-hud';
import { 
  IncomingVEILFrame,
  OutgoingVEILFrame,
  StreamRef,
  AgentActivationOperation,
  VEILOperation,
  Facet
} from '../src/veil/types';
import { 
  createTracer,
  setGlobalTracer,
  TraceStorage,
  FileTraceStorageConfig
} from '../src/tracing';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { LLMProvider, LLMMessage, LLMOptions } from '../src/llm/llm-interface';
import { ConsoleChatComponent } from '../src/elements/console-chat';
import { AgentComponent } from '../src/agent/agent-component';
import { Component } from '../src/spaces/component';
import { Element } from '../src/spaces/element';
import { SpaceEvent } from '../src/spaces/types';
import { ParsedCompletion } from '../src/agent/types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create LLM provider
function createLLMProvider(): LLMProvider {
  const useMock = process.env.USE_MOCK_LLM === 'true';
  
  if (useMock) {
    console.log('Using mock provider (USE_MOCK_LLM=true)');
    const mock = new MockLLMProvider();
    
    // Override generate to log what we're receiving
    const originalGenerate = mock.generate.bind(mock);
    mock.generate = async (messages: LLMMessage[], options?: LLMOptions) => {
      // Get the last user message for context
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      const allUserMessages = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      
      // Check if box is already open
      const boxIsOpen = allUserMessages.includes('box is now open') ||
                       allUserMessages.includes('confetti and rainbow sparkles');
      
      // Check for activation reasons or surprise events
      const hasSurpriseEvent = allUserMessages.includes('SURPRISE!') || 
                              allUserMessages.includes('explodes with confetti');
      
      // Choose response based on context
      if (lastUserMsg) {
        const userContent = lastUserMsg.content.toLowerCase();
        
        // If user just said hi/hey/hello
        if (userContent.match(/^(hi|hey|hello)/)) {
          return {
            content: "Hello! I'm here and ready to explore. I notice there's a mysterious box in this room...",
            metadata: {}
          };
        }
        
        // If user mentions opening or the box
        if ((userContent.includes('open') || userContent.includes('box')) && !boxIsOpen) {
          return {
            content: "I see there's a mysterious box here! I know I can use `@box.open` or `@box.open(\"gently\")` to interact with it. Let me try:\n\n" +
                    "@box.open(\"carefully\")\n\n" +
                    "Let's see what's inside!",
            metadata: {}
          };
        }
      }
      
      // If we're being activated because the box just opened
      if (boxIsOpen && hasSurpriseEvent) {
        return {
          content: "Wow! Look at all that confetti and those rainbow sparkles! 🎉✨ What a magical surprise! The box exploded with pure joy and celebration. The colors are dancing through the air!",
          metadata: {}
        };
      }
      
      // Default response
      return {
        content: "I'm here and ready to explore! What would you like to do?",
        metadata: {}
      };
    };
    
    return mock;
  }
  
  // If not using mock, require API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\n❌ Error: ANTHROPIC_API_KEY environment variable is not set');
    console.error('\nTo run this test, you need to either:');
    console.error('1. Set ANTHROPIC_API_KEY in your environment or .env file');
    console.error('2. Use the mock provider with: USE_MOCK_LLM=true npm run test:interactive\n');
    process.exit(1);
  }
  
  return new AnthropicProvider({
    apiKey,
    defaultModel: 'claude-sonnet-4-20250514',
    defaultMaxTokens: 200,
    maxRetries: 3,
    retryDelay: 1000
  });
}

// Create tracer based on environment
function createDefaultTracer(): TraceStorage | undefined {
  const enableTracing = process.env.ENABLE_TRACING !== 'false';
  if (!enableTracing) return undefined;

  const config: FileTraceStorageConfig = {
    directory: './traces',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    rotationPolicy: 'size'
  };
  
  const tracer = createTracer({
    type: 'file',
    fileConfig: config
  });
  setGlobalTracer(tracer);
  return tracer;
}

// Initialize the interactive box state
function initializeBoxState(space: Space, veilState: VEILStateManager) {
  const frame: IncomingVEILFrame = {
    sequence: veilState.getNextSequence(),
    timestamp: new Date().toISOString(),
    activeStream: {
      streamId: 'interactive:main',
      streamType: 'interactive'
    },
    operations: [
      {
        type: 'addFacet',
        facet: {
          id: 'box-state',
          type: 'state',
          content: 'There is a mysterious box in the room.',
          attributes: {
            isOpen: false,
            hasBeenOpened: false,
            contents: 'confetti and rainbow sparkles'
          }
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'available-actions',
          type: 'ambient',
          scope: ['interactive-environment'],
          content: `<info>You can interact with objects in this environment using the @element.action syntax.

Currently available actions:
- @box.open or @box.open("gently")

Example: To open the box, you would say something like "Let me open the box" followed by @box.open

Note: If you want to talk about actions without executing them, wrap them in backticks like \`@box.open\`. This allows you to discuss commands without triggering them.</info>`,
          attributes: {}
        }
      }
    ]
  };
  
  // Queue an event to trigger frame processing
  space.queueEvent({
    topic: 'box:initialized',
    payload: { frame },
    source: { elementId: 'system', elementPath: [] },
    timestamp: Date.now()
  });
  
  // Apply the frame to VEIL state
  veilState.applyIncomingFrame(frame);
}

// Handle box opening action
function handleOpenBox(space: Space, veilState: VEILStateManager): string {
  const boxFacet = Array.from(veilState.getActiveFacets().values())
    .find(f => f.id === 'box-state');
    
  if (!boxFacet || !boxFacet.attributes) {
    return "I don't see any box here.";
  }
  
  const boxAttrs = boxFacet.attributes as any;
  if (boxAttrs.isOpen) {
    return "The box is already open!";
  }
  
  // Queue events for the state changes
  space.queueEvent({
    topic: 'veil:change_state',
    payload: {
      facetId: 'box-state',
      updates: {
        content: `The box is open, containing ${boxAttrs.contents}!`,
        attributes: {
          isOpen: true,
          hasBeenOpened: true
        }
      }
    },
    source: { elementId: 'system', elementPath: [] },
    timestamp: Date.now()
  });
  
  space.queueEvent({
    topic: 'veil:add_facet',
    payload: {
      facet: {
        id: 'surprise-event',
        type: 'event',
        content: `🎉 SURPRISE! The box explodes with ${boxAttrs.contents}! ✨🌈`,
        attributes: {
          dramatic: true,
          timestamp: new Date().toISOString()
        }
      }
    },
    source: { elementId: 'system', elementPath: [] },
    timestamp: Date.now()
  });
  
  // Queue agent activation directly - it will be processed in the next frame
  // since we're already in the middle of processing the current frame
  space.queueEvent({
    topic: 'veil:agent_activation',
    payload: {
      source: 'box-opened',
      reason: 'Dramatic box opening with surprises',
      priority: 'high'
    },
    source: { elementId: 'system', elementPath: [] },
    timestamp: Date.now()
  });
  
  return `The box opens with a burst of ${boxAttrs.contents}!`;
}

// Extended BasicAgent that can handle actions
class InteractiveAgent extends BasicAgent {
  public lastParsedCompletion?: ParsedCompletion;
  
  public parseCompletion(completion: string): ParsedCompletion {
    // Call parent's parseCompletion which now handles @element.action syntax
    const result = super.parseCompletion(completion);
    
    // Store for debugging
    this.lastParsedCompletion = result;
    return result;
  }
}

async function main() {
  console.log('=== Interactive Box Test ===');
  console.log('Testing interactive elements with a mysterious box\n');

  const tracer = createDefaultTracer();
  if (tracer) {
    console.log('Tracing enabled - logs will be saved to ./traces directory');
    console.log('To disable tracing, set ENABLE_TRACING=false\n');
  }

  // Create core components
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  const llmProvider = createLLMProvider();
  
  console.log(`Using ${llmProvider.getProviderName()} provider${llmProvider.getProviderName() === 'anthropic' ? ' (Claude 3.5 Sonnet)' : ''}`);

  // Configure agent without action instructions (they'll come from the environment)
  const agent = new InteractiveAgent(
    {
      systemPrompt: `You're an interactive agent exploring an environment through a console interface. Be curious and explore!`,
      defaultMaxTokens: 200,
      defaultTemperature: 1.0,
      name: 'interactive-explorer'
    },
    llmProvider,
    veilState
  );
  
  // Set agent on space
  space.setAgent(agent);
  agent.setSpace(space, 'agent');
  
  // Add agent component
  const agentComponent = new AgentComponent(agent);
  space.addComponent(agentComponent);
  
  // Initialize interactive elements
  initializeBoxState(space, veilState);
  
  // Add console chat interface with command handler
  const consoleChat = new ConsoleChatComponent();
  
  // Override handleCommand for custom commands
  (consoleChat as any).handleCommand = async (input: string) => {
    // Handle user commands
    if (input.toLowerCase() === '/open' || input.toLowerCase() === '/open box') {
      console.log(`[System]: ${handleOpenBox(space, veilState)}`);
      return true;
    }
    return false;
  };
  
  space.addComponent(consoleChat);
  
  // Create action handler component
  class ActionHandlerComponent extends Component {
    onMount(): void {
      this.element.subscribe('action:open_box');
    }
    
    async handleEvent(event: SpaceEvent): Promise<void> {
      if (event.topic === 'action:open_box') {
        console.log('[System]: Processing open_box action...');
        const result = handleOpenBox(space, veilState);
        console.log(`[System]: ${result}`);
      }
    }
  }
  
  const actionHandler = new ActionHandlerComponent();
  space.addComponent(actionHandler);
  
  // Create VEIL event handler component
  class VEILEventHandler extends Component {
    onMount(): void {
      this.element.subscribe('veil:*');
    }
    
    async handleEvent(event: SpaceEvent): Promise<void> {
      const frame = space.getCurrentFrame();
      if (!frame) return;
      
      switch (event.topic) {
        case 'veil:change_state': {
          const payload = event.payload as any;
          frame.operations.push({
            type: 'changeState',
            facetId: payload.facetId,
            updates: payload.updates
          });
          break;
        }
          
        case 'veil:add_facet': {
          const payload = event.payload as any;
          frame.operations.push({
            type: 'addFacet',
            facet: payload.facet
          });
          break;
        }
        
        case 'veil:agent_activation': {
          const payload = event.payload as any;
          frame.operations.push({
            type: 'agentActivation',
            source: payload.source,
            reason: payload.reason,
            priority: payload.priority
          });
          break;
        }
        
      }
    }
  }
  
  const veilHandler = new VEILEventHandler();
  space.addComponent(veilHandler);
  
  // Register the open_box action with generic event emission
  const openBoxTool: ToolDefinition = {
    name: 'box.open',
    description: 'Open the mysterious box',
    parameters: { 
      value: { type: 'string', description: 'How to open (e.g., "gently")' } 
    },
    elementPath: ['box'],
    emitEvent: {
      topic: 'action:open_box',
      payloadTemplate: { 
        action: 'open_box',
        source: 'agent'
      }
    }
  };
  
  agent.registerTool(openBoxTool);
  
  // Also register as just 'open' for flexibility
  agent.registerTool({
    ...openBoxTool,
    name: 'open'
  });
  
  // Start interactive session
  console.log('\n> System initialized with:');
  console.log('- Space with VEIL state manager');
  console.log('- Interactive agent with action capabilities');
  console.log('- Mysterious box waiting to be discovered');
  console.log('- Console chat interface');
  console.log('\nThe agent can discover and open the box on its own!');
  console.log('You can also type "/open" to open it yourself.\n');
  
  // Handle console closing
  class CleanupComponent extends Component {
    handleEvent(event: SpaceEvent): void {
      if (event.topic === 'console:closing') {
        if (tracer && 'close' in tracer) {
          (tracer as any).close();
        }
      }
    }
  }
  space.addComponent(new CleanupComponent());
  
  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('\n[Interactive Test] Goodbye!');
    if (tracer && 'close' in tracer) {
      (tracer as any).close();
    }
    process.exit(0);
  });
}

main().catch(console.error);

/**
 * Test the box dispenser system with multiple components
 */

import { Space } from '../src/spaces/space';
import { Element } from '../src/spaces/element';
import { Component } from '../src/spaces/component';
import { BasicAgent } from '../src/agent/basic-agent';
import { VEILStateManager } from '../src/veil/veil-state';
import { AgentConfig, ToolDefinition } from '../src/agent/types';
import { 
  IncomingVEILFrame,
  OutgoingVEILFrame,
  StreamRef,
  AgentActivationOperation
} from '../src/veil/types';
import { SpaceEvent, AgentInterface } from '../src/spaces/types';
import { LLMProvider, LLMMessage } from '../src/llm/llm-interface';
import { MockLLMProvider } from '../src/llm/mock-llm-provider';
import { AnthropicProvider } from '../src/llm/anthropic-provider';
import { ConsoleChatComponent } from '../src/elements/console-chat';
import { BoxDispenser } from '../src/components/box-dispenser';
import { Box } from '../src/components/box';
import { 
  createTracer,
  setGlobalTracer,
  FileTraceStorageConfig
} from '../src/tracing';
import { AgentComponent } from '../src/agent/agent-component';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('=== Box Dispenser Test ===');
console.log('Testing complex element interactions with box dispenser\n');

// Set up tracing
function createDefaultTracer() {
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
  
  console.log('Tracing enabled - logs will be saved to ./traces directory');
  console.log('To disable tracing, set ENABLE_TRACING=false\n');
  
  return tracer;
}

// Create LLM provider
function createLLMProvider(): LLMProvider {
  if (process.env.USE_MOCK_LLM === 'true') {
    console.log('Using mock provider (USE_MOCK_LLM=true)');
    return createMockProvider();
  }
  
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY not found in environment');
    console.error('Please set ANTHROPIC_API_KEY in your .env file or use USE_MOCK_LLM=true');
    process.exit(1);
  }
  
  console.log('Using Anthropic provider (Claude 3.5 Sonnet)');
  return new AnthropicProvider({
    apiKey,
    defaultMaxTokens: 200
  });
}

// Create mock provider with box-aware responses
function createMockProvider(): MockLLMProvider {
  const provider = new MockLLMProvider();
  
  const responses = [
    // Initial greeting
    "Oh wow, a magical box dispenser! This is fascinating. Let me explore what it can do.",
    
    // First dispense
    "Let me try pressing the dispense button and see what happens!\n\n@dispenser.dispense()",
    
    // React to first box
    "Amazing! A rainbow box appeared! Let me open it to see what's inside.\n\n@box-1.open()",
    
    // React to contents and change size
    "How magical! Let me try changing the size to small.\n\n@dispenser.setSize(\"small\")",
    
    // Then change color
    "And now I'll change the color to blue.\n\n@dispenser.setColor(\"blue\")",
    
    // Dispense another
    "Now let's see what a small blue box contains!\n\n@dispenser.dispense()",
    
    // Open the new box
    "A tiny blue box! Let me open this one too.\n\n@box-2.open()",
    
    // Try different settings
    "These contents are all so unique! Let me try making a large box.\n\n@dispenser.setSize(\"large\")",
    
    // Change color to green
    "Now I'll make it green.\n\n@dispenser.setColor(\"green\")",
    
    // Dispense the large green box
    "Let's dispense this large green box!\n\n@dispenser.dispense()",
    
    // Open and explore
    "I now have multiple boxes! Let me open this large green one.\n\n@box-3.open()",
    
    // General responses
    "The variety of contents is amazing! Each box truly contains something unique.",
    "I love how the dispenser remembers what's been created and makes each box special."
  ];
  
  provider.setResponses(responses);
  return provider;
}

// Interactive agent that explores the box dispenser
class InteractiveAgent extends BasicAgent implements AgentInterface {
  constructor(
    config: AgentConfig,
    llmProvider: LLMProvider,
    veilStateManager: VEILStateManager
  ) {
    super(config, llmProvider, veilStateManager);
  }
  
  shouldActivate(activation: AgentActivationOperation, state: any): boolean {
    return true; // Always activate for this test
  }
}

// Main setup
async function main() {
  const tracer = createDefaultTracer();
  const veilState = new VEILStateManager();
  const space = new Space(veilState);
  const llmProvider = createLLMProvider();
  
  // Create agent
  const agent = new InteractiveAgent(
    { 
      name: 'interactive-agent',
      systemPrompt: `You are exploring a magical workshop with a box dispenser.
Be curious and creative! Try different combinations of settings and explore what each box contains.
Remember to use the @element.action syntax to interact with objects.`
    },
    llmProvider,
    veilState
  );
  
  // Create workshop environment
  const workshop = new Element('workshop');
  space.addChild(workshop);
  
  // Add box dispenser
  const dispenser = new BoxDispenser(llmProvider);
  workshop.addChild(dispenser);
  
  // Register tools for all dispenser actions
  const dispenserTools: ToolDefinition[] = [
    {
      name: 'dispenser.dispense',
      description: 'Press the button to dispense a new box',
      parameters: {},
      elementPath: ['dispenser'],
      emitEvent: {
        topic: 'element:action',
        payloadTemplate: {}
      }
    },
    {
      name: 'dispenser.setSize',
      description: 'Set the size for new boxes',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', enum: ['small', 'medium', 'large'] }
        }
      },
      elementPath: ['dispenser'],
      emitEvent: {
        topic: 'element:action',
        payloadTemplate: {}
      }
    },
    {
      name: 'dispenser.setColor',
      description: 'Set the color for new boxes',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', enum: ['red', 'blue', 'green', 'rainbow'] }
        }
      },
      elementPath: ['dispenser'],
      emitEvent: {
        topic: 'element:action',
        payloadTemplate: {}
      }
    }
  ];
  
  dispenserTools.forEach(tool => agent.registerTool(tool));
  
  // Register a dynamic tool handler for boxes
  const boxOpenTool: ToolDefinition = {
    name: 'box.open',
    description: 'Open a box',
    parameters: {},
    handler: async (params: any) => {
      // This is a fallback - real handling happens via events
      console.log('[System]: Box open action triggered');
    }
  };
  
  // Register generic box patterns
  for (let i = 1; i <= 10; i++) {
    agent.registerTool({
      name: `box-${i}.open`,
      description: `Open box ${i}`,
      parameters: {},
      elementId: `box-${i}`,
      emitEvent: {
        topic: 'element:action',
        payloadTemplate: {}
      }
    });
  }
  
  // Add agent to space
  space.setAgent(agent);
  agent.setSpace(space, space.id);
  
  // Add agent component for automatic processing
  const agentComponent = new AgentComponent(agent);
  space.addComponent(agentComponent);
  
  // Add activation handler
  space.addComponent(new (class extends Component {
    onMount(): void {
      this.element.subscribe('agent:activate');
    }
    
    async handleEvent(event: SpaceEvent): Promise<void> {
      if (event.topic === 'agent:activate') {
        const activation = (event.payload as any)?.activation;
        if (activation) {
          console.log('[System] Adding activation to current frame');
          const frame = (this.element as Space).getCurrentFrame();
          if (frame) {
            frame.operations.push(activation);
            // Set the active stream for agent response routing
            frame.activeStream = {
              streamId: 'console:main',
              streamType: 'console'
            };
          }
        }
      }
    }
  })());
  
  // Add console interface
  const consoleElement = new Element('console-chat');
  consoleElement.addComponent(new ConsoleChatComponent());
  space.addChild(consoleElement);
  
  // Add cleanup handler
  const cleanupComponent = new (class extends Component {
    async handleEvent(event: SpaceEvent): Promise<void> {
      if (event.topic === 'console:closing' && tracer) {
        const fileTracer = tracer as any;
        if (fileTracer.close) {
          fileTracer.close();
        }
        console.log('[System] Cleanup complete');
      }
    }
  })();
  space.addComponent(cleanupComponent);
  space.subscribe('console:closing');
  
  // Initial state
  const initialFrame: IncomingVEILFrame = {
    sequence: 1,
    timestamp: new Date().toISOString(),
    activeStream: {
      streamId: 'console:main',
      streamType: 'console'
    },
    operations: [
      {
        type: 'addFacet',
        facet: {
          id: 'workshop-state',
          type: 'state',
          displayName: 'workshop',
          content: 'You are in a magical workshop. In the center stands a remarkable box dispenser with a control panel and a big red button.',
          attributes: {}
        }
      },
      {
        type: 'addFacet',
        facet: {
          id: 'workshop-ambient',
          type: 'ambient',
          scope: ['workshop'],
          content: `This workshop can create magical boxes with unique contents.
Each box is different based on its size and color settings.
The dispenser ensures no two boxes contain exactly the same thing.`,
          attributes: {}
        }
      },
    ]
  };
  
  // Apply the initial frame
  veilState.applyIncomingFrame(initialFrame);
  
  // Queue an event to trigger processing
  space.queueEvent({
    topic: 'workshop:initialized',
    source: space.getRef(),
    payload: {},
    timestamp: Date.now()
  });
  
  console.log('System initialized with:');
  console.log('- Magical workshop with box dispenser');
  console.log('- Control panel for size and color settings');
  console.log('- Interactive agent with curiosity');
  console.log('- Dynamic box creation with unique contents');
  console.log('');
  console.log('The agent will explore the dispenser and create various boxes!');
  
  // Trigger agent greeting immediately
  console.log('[System] Triggering initial agent activation...');
  space.queueEvent({
    topic: 'agent:activate',
    source: space.getRef(),
    payload: {
      activation: {
        type: 'agentActivation',
        source: 'system',
        reason: 'Initial greeting',
        priority: 'normal'
      }
    },
    timestamp: Date.now(),
    priority: 'high'
  });
}

// Run the test
main().catch(console.error);

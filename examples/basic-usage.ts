import {
  VEILStateManager,
  PassthroughCompressionEngine,
  XmlHUD,
  AgentLoop,
  IncomingVEILFrame,
  LLMProvider
} from '../src';

/**
 * Example showing basic usage of VEIL, Compression, HUD, and AgentLoop
 */

// Mock LLM provider for testing
class MockLLMProvider implements LLMProvider {
  async complete(
    systemPrompt: string,
    messages: Array<{role: 'user' | 'assistant'; content: string}>,
    config?: any
  ): Promise<string> {
    // In real implementation, this would call OpenAI/Anthropic/etc
    console.log('LLM called with:', { systemPrompt, messages, config });
    
    // Return a mock completion
    return `<my_turn>
<inner_thoughts>
The user is asking about the ship status. I should acknowledge the alert and take action.
</inner_thoughts>

I see we have an anomaly detected in sector 7-G. This requires immediate attention.

<tool_call name="perform_scan">
<sector>7-G</sector>
<type>deep</type>
</tool_call>

Let me run a deep scan of that sector to gather more information.
</my_turn>`;
  }
}

async function runExample() {
  // 1. Initialize components
  const veilState = new VEILStateManager();
  const compression = new PassthroughCompressionEngine();
  const hud = new XmlHUD();
  const llmProvider = new MockLLMProvider();
  
  const agentLoop = new AgentLoop(
    veilState,
    compression,
    hud,
    {
      llmProvider,
      maxCycles: 5,
      defaultTemperature: 0.7,
      defaultMaxTokens: 500
    }
  );

  // 2. Apply some initial VEIL frames
  const frame1: IncomingVEILFrame = {
    sequence: 1,
    timestamp: new Date().toISOString(),
    focus: "starship:bridge",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "ship-status",
          type: "state",
          displayName: "Ship Status", 
          content: "USS Endeavor - Orbiting Kepler-442b\nSystems: Nominal",
          attributes: {
            alert: "green"
          }
        }
      },
      {
        type: "addFacet",
        facet: {
          id: "crew-status",
          type: "state",
          displayName: "Crew Status",
          content: "Bridge crew at stations\nAll departments ready"
        }
      }
    ]
  };

  veilState.applyIncomingFrame(frame1);

  // 3. Simulate an event that triggers agent activation
  const frame2: IncomingVEILFrame = {
    sequence: 2,
    timestamp: new Date().toISOString(),
    focus: "starship:bridge",
    operations: [
      {
        type: "addFacet",
        facet: {
          id: "anomaly-alert",
          type: "event",
          content: "Anomaly detected in sector 7-G",
          attributes: {
            severity: "medium",
            source: "sensors"
          }
        }
      },
      {
        type: "agentActivation",
        config: {
          temperature: 0.7
        }
      }
    ]
  };

  veilState.applyIncomingFrame(frame2);

  // 4. Process agent activation
  console.log("Processing agent activation...");
  const result = await agentLoop.processActivations();
  
  console.log("Activation result:", result);

  // 5. Examine the state after activation
  const finalState = veilState.getState();
  console.log("\nFinal frame count:", finalState.frameHistory.length);
  console.log("Current sequence:", finalState.currentSequence);
  
  // Look at the outgoing frame
  const outgoingFrame = finalState.frameHistory[finalState.frameHistory.length - 1];
  console.log("\nAgent operations:", outgoingFrame);
}

// Run the example
runExample().catch(console.error);

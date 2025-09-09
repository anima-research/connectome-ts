/**
 * Component that integrates an AgentInterface with the Space/Element system
 */

import { Component } from '../spaces/component';
import { SpaceEvent, FrameEndEvent, AgentResponseEvent } from '../spaces/types';
import { AgentInterface, AgentCommand } from './types';
import { Space } from '../spaces/space';
import { OutgoingVEILOperation } from '../veil/types';

export class AgentComponent extends Component {
  constructor(private agent: AgentInterface) {
    super();
  }
  
  onMount(): void {
    // Subscribe to relevant events
    this.element.subscribe('frame:end');
    this.element.subscribe('agent:command');
    
    // Set the agent on the space if this is the root
    const space = this.element.space;
    if (space instanceof Space && space === this.element) {
      space.setAgent(this.agent);
    }
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    switch (event.topic) {
      case 'frame:end':
        await this.handleFrameEnd(event as FrameEndEvent);
        break;
        
      case 'agent:command':
        this.handleAgentCommand(event.payload as AgentCommand);
        break;
    }
  }
  
  private async handleFrameEnd(event: FrameEndEvent): Promise<void> {
    // Agent processing is handled by Space.setAgent()
    // This is here for any additional component-level logic
    
    // We could emit agent state changes, log activity, etc.
    const state = this.agent.getState();
    if (state.sleeping) {
      console.log('[Agent] Currently sleeping, may ignore low-priority activations');
    }
  }
  
  private handleAgentCommand(command: AgentCommand): void {
    this.agent.handleCommand(command);
    
    // Log state changes
    const state = this.agent.getState();
    console.log('[Agent] State updated:', {
      sleeping: state.sleeping,
      ignoringSources: Array.from(state.ignoringSources),
      attentionThreshold: state.attentionThreshold
    });
    
    // If waking up with pending activations, trigger a frame to process them
    if (command.type === 'wake' && this.agent.hasPendingActivations()) {
      // Get the first pending activation
      const pendingActivation = this.agent.popPendingActivation();
      if (pendingActivation) {
        // Create a frame with the pending activation
        this.element.emit({
          topic: 'agent:pending-activation',
          source: this.element.getRef(),
          payload: { activation: pendingActivation },
          timestamp: Date.now()
        });
      }
    }
  }
  
  /**
   * Helper to emit agent response events for routing
   */
  private emitAgentResponse(operations: OutgoingVEILOperation[]): void {
    for (const op of operations) {
      if (op.type === 'speak') {
        this.element.emit({
          topic: 'agent:response',
          payload: {
            content: op.content,
            streamRef: op.target ? {
              streamId: op.target,
              streamType: 'unknown', // Would need more context
              metadata: {}
            } : undefined
          },
          timestamp: Date.now()
        } as AgentResponseEvent);
      }
    }
  }
}

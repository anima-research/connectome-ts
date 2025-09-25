/**
 * Component that integrates an AgentInterface with the Space/Element system
 */

import { VEILComponent } from '../components/base-components';
import { SpaceEvent, FrameEndEvent, AgentResponseEvent } from '../spaces/types';
import { AgentInterface, AgentCommand, AgentConfig } from './types';
import { Space } from '../spaces/space';
import { OutgoingVEILOperation, AgentInfo } from '../veil/types';
import { persistable, persistent } from '../persistence/decorators';
import { reference, RestorableComponent } from '../host/decorators';
import { LLMProvider } from '../llm/llm-interface';
import { VEILStateManager } from '../veil/veil-state';
import { BasicAgent } from './basic-agent';

@persistable(1)
export class AgentComponent extends VEILComponent implements RestorableComponent {
  private agent?: AgentInterface;
  private agentRegistered = false;
  
  // Persist the agent configuration
  @persistent() private agentConfig?: AgentConfig;
  
  // References that will be injected by the Host
  @reference('veilState') private veilState?: VEILStateManager;
  @reference('llmProvider') private llmProvider?: LLMProvider;
  
  constructor(agent?: AgentInterface) {
    super();
    if (agent) {
      this.agent = agent;
      // Save agent config for restoration
      if ('config' in agent) {
        this.agentConfig = (agent as any).config;
      }
    }
  }
  
  setAgent(agent: AgentInterface) {
    this.agent = agent;
    // Save agent config for restoration
    if ('config' in agent) {
      this.agentConfig = (agent as any).config;
    }
  }
  
  /**
   * Called by Host after all references are resolved
   */
  async onReferencesResolved(): Promise<void> {
    console.log(`[AgentComponent ${this.element?.id}] onReferencesResolved - config: ${!!this.agentConfig}, agent: ${!!this.agent}, llm: ${!!this.llmProvider}, veil: ${!!this.veilState}`);
    
    // If we have config but no agent, recreate it
    if (this.agentConfig && !this.agent && this.llmProvider && this.veilState) {
      console.log('✨ Recreating agent from config:', this.agentConfig.name || 'unnamed');
      
      // Check if there's a custom agent factory registered
      const space = this.element?.space;
      const agentFactory = (space as any)?.getReference?.('agentFactory');
      
      if (agentFactory && typeof agentFactory === 'function') {
        // Use custom factory
        this.agent = agentFactory(this.agentConfig, this.llmProvider, this.veilState);
      } else {
        // Default to BasicAgent
        this.agent = new BasicAgent(this.agentConfig, this.llmProvider, this.veilState);
      }
      
      // Re-enable auto action registration if it was enabled
      if ((this.agentConfig as any).autoActionRegistration) {
        (this.agent as BasicAgent).enableAutoActionRegistration();
      }
    }
  }
  
  onMount(): void {
    // Subscribe to relevant events
    this.element.subscribe('frame:start');
    this.element.subscribe('frame:end');
    this.element.subscribe('agent:command');
    this.element.subscribe('agent:pending-activation');
    
    // Agent registration will happen on first frame:start
  }
  
  onUnmount(): void {
    // Unregister agent from VEIL state
    if (this.veilState) {
      this.addOperation({
        type: 'removeAgent',
        agentId: this.element.id,
        reason: 'Component unmounted'
      } as any);
    }
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    switch (event.topic) {
      case 'frame:start':
        // Register agent on first frame (agent might be created in onReferencesResolved)
        console.log(`[AgentComponent ${this.element.id}] frame:start - agent: ${!!this.agent}, veilState: ${!!this.veilState}, registered: ${this.agentRegistered}`);
        if (!this.agentRegistered && this.agent && this.veilState) {
          console.log(`[AgentComponent ${this.element.id}] Registering agent...`);
          const agentInfo = {
            id: this.element.id,
            name: this.agentConfig?.name || this.element.name || 'Agent',
            type: 'assistant',
            capabilities: ['chat', 'code', 'search'],
            metadata: {
              model: (this.agentConfig as any)?.modelName || 'unknown',
              provider: (this.agentConfig as any)?.provider || 'unknown'
            },
            createdAt: new Date().toISOString()
          };
          
          this.addOperation({
            type: 'addAgent',
            agent: agentInfo
          } as any);
          
          this.agentRegistered = true;
        }
        break;
        
      case 'frame:end':
        if (this.agent) {
          await this.handleFrameEnd(event as FrameEndEvent);
        }
        break;
        
      case 'agent:command':
        if (this.agent) {
          this.handleAgentCommand(event.payload as AgentCommand);
        }
        break;
    }
  }
  
  private async handleFrameEnd(event: FrameEndEvent): Promise<void> {
    // Handle agent processing directly in the component
    const space = this.element.findSpace() as any;
    if (!space) return;
    
    const frame = space.getCurrentFrame();
    if (!frame || !event.payload.hasOperations) return;
    
    // Check if this agent should handle this frame - look for activation facets
    const activationOps = frame.operations.filter((op: any) => 
      op.type === 'addFacet' && op.facet?.type === 'agentActivation'
    );
    if (activationOps.length === 0) return;
    
    // Check if any activation targets this agent (or no target specified)
    const shouldHandle = activationOps.some((op: any) => {
      const targetAgent = op.facet?.attributes?.targetAgent;
      const targetAgentId = op.facet?.attributes?.targetAgentId;
      
      // Check by ID first, then by name
      if (targetAgentId) {
        return targetAgentId === this.element.id;
      }
      
      // If no ID specified, check by name (either element name or agent name from config)
      const agentName = this.agentConfig?.name || this.element.name;
      return !targetAgent || targetAgent === this.element.id || targetAgent === this.element.name || targetAgent === agentName;
    });
    
    if (!shouldHandle) return;
    
    if (!this.agent) {
      console.warn('[AgentComponent] No agent set');
      return;
    }
    
    // Let the agent process the frame
    const veilState = space.getVEILState();
    const response = await this.agent.onFrameComplete(frame, veilState.getState());
    
    // If agent generated a response, process it synchronously
    // This must happen within the current frame to maintain sequence order
    if (response && space) {
      // Extract rendered context if attached
      const renderedContext = (response as any).renderedContext;
      delete (response as any).renderedContext; // Clean up before passing
      
      // Extract raw completion if attached
      const rawCompletion = (response as any).rawCompletion;
      delete (response as any).rawCompletion; // Clean up before passing
      
      // Use distributeEvent directly to maintain proper event flow
      // while avoiding the queue (which would defer to next frame)
      await (space as any).distributeEvent({
        topic: 'agent:frame-ready',
        source: this.element.getRef(),
        payload: {
          frame: response,
          agentId: this.element.id,
          agentName: this.element.name,
          renderedContext, // Include rendered context for debug
          rawCompletion // Include raw completion for debug
        },
        priority: 'immediate',
        timestamp: Date.now()
      });
    }
    
    // Log state for debugging
    const state = this.agent.getState();
    if (state.sleeping) {
      console.log(`[Agent ${this.element.name}] Currently sleeping, may have ignored low-priority activations`);
    }
  }
  
  private handleAgentCommand(command: AgentCommand): void {
    if (!this.agent) {
      console.warn('[AgentComponent] No agent set');
      return;
    }
    
    this.agent.handleCommand(command);
    
    // Log state changes
    const state = this.agent.getState();
    console.log('[Agent] State updated:', {
      sleeping: state.sleeping,
      ignoringSources: Array.from(state.ignoringSources),
      attentionThreshold: state.attentionThreshold
    });
    
    // If waking up, check for activation facets in state
    if (command.type === 'wake') {
      // Activation facets persist in state, so we just need to trigger processing
      this.element.emit({
        topic: 'agent:wake',
        source: this.element.getRef(),
        payload: {},
        timestamp: Date.now()
      });
    }
  }
  
}

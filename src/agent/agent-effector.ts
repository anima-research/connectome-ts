/**
 * AgentEffector - Processes agent activations and rendered contexts to produce responses
 * 
 * This replaces AgentComponent in the new Receptor/Effector architecture.
 * It watches for both agentActivation facets and their corresponding 
 * rendered-context facets, then runs the agent to produce speech/action/thought facets.
 */

import { 
  Effector, 
  FacetDelta, 
  ReadonlyVEILState, 
  EffectorResult,
  FacetFilter,
  ExternalAction
} from '../spaces/receptor-effector-types';
import { Facet, VEILOperation, StreamRef } from '../veil/types';
import { SpaceEvent } from '../spaces/types';
import { AgentInterface, AgentState, AgentCommand } from './types';
import { LLMProvider } from '../llm/llm-interface';
import { getGlobalTracer, TraceStorage } from '../tracing';

export class AgentEffector implements Effector {
  // Watch for activation facets AND their rendered contexts
  facetFilters: FacetFilter[] = [
    { type: 'agentActivation' },
    { type: 'rendered-context' }
  ];
  
  private agent: AgentInterface;
  private processingActivations = new Set<string>();
  private tracer?: TraceStorage;
  
  constructor(agent: AgentInterface) {
    this.agent = agent;
    this.tracer = getGlobalTracer();
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    const externalActions: ExternalAction[] = [];
    
    // Check for new activations that have rendered contexts
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      if (change.facet.type === 'agentActivation') {
        const activationId = change.facet.id;
        
        // Skip if already processing
        if (this.processingActivations.has(activationId)) continue;
        
        // Check if this activation targets this agent
        const targetAgentId = change.facet.attributes?.targetAgentId;
        const targetAgentName = change.facet.attributes?.targetAgentName;
        const agentState = this.agent.getState();
        
        // Basic targeting logic (can be enhanced)
        const isTargeted = !targetAgentId || targetAgentId === this.getAgentId();
        if (!isTargeted) continue;
        
        // Check if agent should activate
        // Convert ReadonlyVEILState to VEILState for legacy agent interface
        const veilState = state as any;
        if (!this.agent.shouldActivate(change.facet.attributes, veilState)) {
          continue;
        }
        
        // Look for corresponding rendered context
        const contextFacet = Array.from(state.facets.values()).find(f => 
          f.type === 'rendered-context' && 
          f.attributes?.activationId === activationId
        );
        
        if (!contextFacet) {
          // No context yet, will process in next frame
          continue;
        }
        
        // Mark as processing
        this.processingActivations.add(activationId);
        
        try {
          // Run the agent cycle
          const streamRef = change.facet.attributes?.streamRef as StreamRef | undefined;
          const response = await this.runAgentCycle(
            contextFacet.content || '',
            streamRef,
            activationId
          );
          
          // Create events to add response facets
          for (const facet of response.facets) {
            events.push({
              topic: 'veil:operation',
              source: { elementId: 'agent-effector', elementPath: [] },
              timestamp: Date.now(),
              payload: {
                operation: {
                  type: 'addFacet',
                  facet
                }
              }
            });
          }
          
          // Create event to remove activation facet
          events.push({
            topic: 'veil:operation',
            source: { elementId: 'agent-effector', elementPath: [] },
            timestamp: Date.now(),
            payload: {
              operation: {
                type: 'removeFacet',
                facetId: activationId,
                mode: 'delete'
              }
            }
          });
          
        } catch (error) {
          console.error('Agent cycle error:', error);
          
          // Create error event
          events.push({
            topic: 'veil:operation',
            source: { elementId: 'agent-effector', elementPath: [] },
            timestamp: Date.now(),
            payload: {
              operation: {
                type: 'addFacet',
                facet: {
                  id: `agent-error-${Date.now()}`,
                  type: 'error',
                  content: String(error),
                  temporal: 'persistent',
                  attributes: {
                    agentId: this.getAgentId(),
                    activationId,
                    errorType: 'agent-cycle-error'
                  }
                }
              }
            }
          });
        } finally {
          this.processingActivations.delete(activationId);
        }
      }
    }
    
    return { 
      events,
      externalActions 
    };
  }
  
  private async runAgentCycle(
    renderedContext: string,
    streamRef?: StreamRef,
    activationId?: string
  ): Promise<{ facets: Facet[] }> {
    const facets: Facet[] = [];
    
    // Parse the rendered context to extract token count
    const contextMetadata = this.parseContextMetadata(renderedContext);
    
    // Run the agent's cycle
    const outgoingFrame = await this.agent.runCycle(
      { 
        messages: [{ role: 'user', content: renderedContext }],
        metadata: {
          totalTokens: contextMetadata.totalTokens || 0,
          renderedFrames: []
        }
      },
      streamRef
    );
    
    // Convert agent operations to facets
    for (const operation of outgoingFrame.operations) {
      if (operation.type === 'addFacet' && 'facet' in operation) {
        // Apply stream routing to speech facets
        const facet = operation.facet;
        if (facet.type === 'speech' && streamRef && !facet.attributes?.target) {
          facet.attributes = {
            ...facet.attributes,
            target: streamRef.streamId
          };
        }
        facets.push(facet);
      }
    }
    
    return { facets };
  }
  
  private parseContextMetadata(content: string): { tokenCount?: number; totalTokens?: number } {
    // Look for metadata in comments at the end of context
    const metadataMatch = content.match(/<!-- Metadata: (\{[^}]+\}) -->/);
    if (metadataMatch) {
      try {
        return JSON.parse(metadataMatch[1]);
      } catch {
        // Ignore parse errors
      }
    }
    return {};
  }
  
  private getAgentId(): string {
    // This would need to be set during construction or configuration
    return 'agent-' + Math.random().toString(36).substr(2, 9);
  }
  
  // Handle agent commands via facets
  handleCommand(command: AgentCommand): void {
    this.agent.handleCommand(command);
  }
  
  getState(): AgentState {
    return this.agent.getState();
  }
}

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
import {
  Facet,
  StreamRef,
  hasAgentGeneratedAspect,
  hasContentAspect,
  hasStateAspect,
  hasStreamAspect
} from '../veil/types';
import { SpaceEvent } from '../spaces/types';
import { AgentInterface, AgentState, AgentCommand } from './types';
import { LLMProvider } from '../llm/llm-interface';
import { getGlobalTracer, TraceStorage } from '../tracing';
import { RenderedContext } from '../hud/types-v2';
import { Element } from '../spaces/element';

export class AgentEffector implements Effector {
  // Watch for activation facets AND their rendered contexts
  facetFilters: FacetFilter[] = [
    { type: 'agent-activation' },
    { type: 'rendered-context' }
  ];
  
  private agent: AgentInterface;
  private processingActivations = new Set<string>();
  private tracer?: TraceStorage;
  private cachedAgentId?: string;
  
  constructor(
    private element: Element,
    agent: AgentInterface
  ) {
    this.agent = agent;
    this.tracer = getGlobalTracer();
  }
  
  async process(changes: FacetDelta[], state: ReadonlyVEILState): Promise<EffectorResult> {
    const events: SpaceEvent[] = [];
    const externalActions: ExternalAction[] = [];
    
    // Check for new activations that have rendered contexts
    for (const change of changes) {
      if (change.type !== 'added') continue;
      
      if (change.facet.type === 'agent-activation') {
        const activationId = change.facet.id;
        const activationState = hasStateAspect(change.facet)
          ? (change.facet.state as Record<string, any>)
          : {};
        
        // Skip if already processing
        if (this.processingActivations.has(activationId)) continue;
        
        // Check if this activation targets this agent
        const targetAgentId = activationState.targetAgentId as string | undefined;
        const agentState = this.agent.getState();
        
        // Basic targeting logic (can be enhanced)
        const isTargeted = !targetAgentId || targetAgentId === this.getAgentId();
        if (!isTargeted) continue;
        
        // Check if agent should activate
        // Convert ReadonlyVEILState to VEILState for legacy agent interface
        const veilState = state as any;
        if (!this.agent.shouldActivate(activationState, veilState)) {
          continue;
        }

        // Look for corresponding rendered context
        const contextFacet = Array.from(state.facets.values()).find(f => 
          f.type === 'rendered-context' &&
          hasStateAspect(f) &&
          (f.state as Record<string, any>).activationId === activationId
        );

        if (!contextFacet || !hasStateAspect(contextFacet)) {
          // No context yet, will process in next frame
          continue;
        }

        // Mark as processing
        this.processingActivations.add(activationId);

        const streamRef = activationState.streamRef as StreamRef | undefined;
        const streamId = streamRef?.streamId ?? (activationState.streamId as string | undefined) ?? 'default';

        try {
          // Get the context from the state
          const contextState = contextFacet.state as { context: RenderedContext };
          const context = contextState.context;
          
          // Run the agent cycle
          const response = await this.runAgentCycle(
            context,
            streamRef,
            activationId
          );
          
          // Create events to add response facets
          for (const facet of response.facets) {
            events.push({
              topic: 'veil:operation',
              source: this.element.getRef(),
              timestamp: Date.now(),
              payload: {
                operation: {
                  type: 'addFacet',
                  facet
                }
              }
            });
          }
          
          // Activation facet is ephemeral and will naturally fade away
          // No need to explicitly remove it

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
                  type: 'event',
                  content: String(error),
                  state: {
                    source: this.getAgentId(),
                    eventType: 'agent-cycle-error',
                    metadata: {
                      activationId
                    }
                  },
                  streamId: streamId
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
    context: RenderedContext,
    streamRef?: StreamRef,
    activationId?: string
  ): Promise<{ facets: Facet[] }> {
    const facets: Facet[] = [];
    
    // Run the agent's cycle with the full context
    const outgoingFrame = await this.agent.runCycle(context, streamRef);
    
    // Convert agent operations to facets
    for (const operation of outgoingFrame.deltas) {
      if (operation.type === 'addFacet') {
        const preparedFacet = this.prepareAgentFacet(operation.facet, streamRef);
        facets.push(preparedFacet);
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

  private prepareAgentFacet(facet: Facet, streamRef?: StreamRef): Facet {
    const prepared = { ...facet } as Facet;

    if (hasAgentGeneratedAspect(prepared) && !prepared.agentId) {
      prepared.agentId = this.getAgentId();
    }

    if ((prepared.type === 'speech' || prepared.type === 'thought' || prepared.type === 'action') && !hasAgentGeneratedAspect(prepared)) {
      (prepared as Facet & { agentId: string }).agentId = this.getAgentId();
      if (streamRef?.streamId) {
        (prepared as Facet & { streamId: string }).streamId = streamRef.streamId;
      }
    }

    if (streamRef?.streamId && hasStreamAspect(prepared)) {
      prepared.streamId = prepared.streamId || streamRef.streamId;
    }

    if (prepared.type === 'speech' || prepared.type === 'thought') {
      if (!hasContentAspect(prepared)) {
        (prepared as Facet & { content: string }).content = '';
      }
      if (!prepared.streamId && streamRef?.streamId) {
        (prepared as Facet & { streamId: string }).streamId = streamRef.streamId;
      }
    }

    if (prepared.type === 'action' && hasStateAspect(prepared) && streamRef?.streamId) {
      prepared.streamId = prepared.streamId || streamRef.streamId;
    }

    return prepared;
  }

  private getAgentId(): string {
    // Use the element's ID as the agent ID for consistency
    return this.element.id;
  }
  
  // Handle agent commands via facets
  handleCommand(command: AgentCommand): void {
    this.agent.handleCommand(command);
  }
  
  getState(): AgentState {
    return this.agent.getState();
  }
}

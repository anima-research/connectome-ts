/**
 * Basic implementation of the AgentInterface
 */

import { 
  AgentInterface, 
  AgentState, 
  AgentCommand, 
  ParsedCompletion,
  AgentConfig,
  ToolDefinition,
  ActionConfig
} from './types';
import { 
  Facet,
  IncomingVEILFrame, 
  OutgoingVEILFrame, 
  OutgoingVEILOperation,
  VEILState,
  StreamRef,
  createDefaultTransition,
  hasStateAspect
} from '../veil/types';
import { RenderedContext } from '../hud/types-v2';
import { FrameTrackingHUD } from '../hud/frame-tracking-hud';
import { CompressionEngine } from '../compression/types-v2';
import { LLMProvider } from '../llm/llm-interface';
import { VEILStateManager } from '../veil/veil-state';
import { Element } from '../spaces/element';
import { 
  TraceStorage, 
  TraceCategory, 
  getGlobalTracer 
} from '../tracing';
import { BasicAgentConstructorOptions, isAgentOptions } from './agent-factory';
import { SpaceEvent } from '../spaces/types';
import { parseInlineParameters } from './action-parser';

export class BasicAgent implements AgentInterface {
  private state: AgentState = {
    sleeping: false,
    ignoringSources: new Set(),
    attentionThreshold: 0.5
  };
  
  private config: AgentConfig;
  private hud: FrameTrackingHUD;
  private llmProvider: LLMProvider;
  private veilStateManager: VEILStateManager;
  private compressionEngine?: CompressionEngine;
  private tools: Map<string, ToolDefinition> = new Map();
  private tracer: TraceStorage | undefined;
  private agentId: string;
  
  constructor(
    configOrOptions: AgentConfig | BasicAgentConstructorOptions,
    llmProvider?: LLMProvider,
    veilStateManager?: VEILStateManager,
    compressionEngine?: CompressionEngine
  ) {
    // Support both old and new constructor patterns
    if (isAgentOptions(configOrOptions)) {
      // New intuitive pattern
      this.config = configOrOptions.config;
      this.llmProvider = configOrOptions.provider;
      this.veilStateManager = configOrOptions.veilStateManager!;
      this.compressionEngine = configOrOptions.compressionEngine;
    } else {
      // Old pattern for backward compatibility
      this.config = configOrOptions;
      this.llmProvider = llmProvider!;
      this.veilStateManager = veilStateManager!;
    this.compressionEngine = compressionEngine;
    }
    
    this.hud = new FrameTrackingHUD();
    this.tracer = getGlobalTracer();
    this.agentId = this.createAgentId(this.config.name);
    
    // Register tools
    if (this.config.tools) {
      for (const tool of this.config.tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }
  
  async onFrameComplete(frame: IncomingVEILFrame, state: VEILState): Promise<OutgoingVEILFrame | undefined> {
    this.tracer?.record({
      id: `agent-frame-${frame.sequence}`,
      timestamp: Date.now(),
      level: 'info',
      category: TraceCategory.AGENT_ACTIVATION,
      component: 'BasicAgent',
      operation: 'onFrameComplete',
      data: {
        frameSequence: frame.sequence,
        deltas: frame.deltas.length,
        activeStream: frame.activeStream?.streamId
      }
    });
    
    // Look for activation facets in the state
    const activationFacets = Array.from(state.facets.values())
      .filter(facet => facet.type === 'agent-activation');
    
    if (activationFacets.length === 0) return undefined;
    
    // Check each activation facet
    for (const facet of activationFacets) {
      if (!hasStateAspect(facet)) {
        continue;
      }

      const activation = facet.state as Record<string, any>;

      // Skip if this targets a different agent
      if (activation.targetAgent && activation.targetAgent !== this.config.name) {
        continue;
      }

      if (this.shouldActivate(activation, state)) {
        try {
          // Build context
          const context = this.buildContext(state, frame.activeStream);
          
          // Run cycle
          const response = await this.runCycle(context, frame.activeStream);
          
          // Attach rendered context to the response for debug purposes
          if (response) {
            (response as any).renderedContext = context;
            
            // Prepend operation to remove the activation facet
            response.deltas.unshift({
              type: 'removeFacet',
              id: facet.id
            });
          }
          
          // Return the response frame without recording or processing
          // Space will handle sequencing, recording, and tool processing
          return response;
        } catch (error) {
          console.error('Agent cycle error:', error);
        }
      } else if (this.state.sleeping) {
        // Can't store facets for later - they're in the state, not pending
        // The facet will remain in state until removed
      }
    }
    
    return undefined;
  }
  
  shouldActivate(activation: any, state: VEILState): boolean {
    // Check if sleeping
    if (this.state.sleeping) {
      // Don't activate when sleeping unless explicitly woken
      return false;
    }
    
    // Check ignored sources
    if (activation.source && this.state.ignoringSources.has(activation.source)) {
      return false;
    }
    
    // Check if activation is targeted to a specific agent
    if (activation.targetAgentId || activation.targetAgent) {
      // For ID-based targeting, we need the agent to know its own ID
      // This is typically set by AgentComponent but we check by name for now
      if (activation.targetAgent && activation.targetAgent !== this.config.name) {
        return false;
      }
      
      // TODO: Once agents know their IDs, check targetAgentId as well
      // For now, targetAgentId requires AgentComponent to pass the ID
    }
    
    // Activate if not sleeping, not ignored, and either not targeted or targeted to this agent
    return true;
  }
  
  async runCycle(context: RenderedContext, streamRef?: StreamRef): Promise<OutgoingVEILFrame> {
    const cycleSpan = this.tracer?.startSpan('runCycle', 'BasicAgent');
    
    try {
      // Log context size
      this.tracer?.record({
        id: `llm-context-${Date.now()}`,
        timestamp: Date.now(),
        level: 'info',
        category: TraceCategory.AGENT_CONTEXT_BUILD,
        component: 'BasicAgent',
        operation: 'runCycle',
        data: {
          messages: context.messages.length,
          totalTokens: context.metadata.totalTokens,
          activeStream: streamRef?.streamId
        },
        parentId: cycleSpan?.id
      });
      
      // Debug: Log messages for interactive box test
      if (this.config.name === 'interactive-explorer') {
        console.log('\n[Agent] Messages being sent:');
        context.messages.forEach((msg, i) => {
          console.log(`[${i}] ${msg.role}: ${msg.content.slice(0, 100)}...`);
        });
      }
      
      // Call LLM
      const response = await this.llmProvider.generate(
        context.messages,
        {
          maxTokens: this.config.defaultMaxTokens || 1000,
          temperature: this.config.defaultTemperature || 1.0,
          stopSequences: ['</my_turn>'],
          formatConfig: {
            assistant: {
              prefix: '<my_turn>\n',
              suffix: '\n</my_turn>'
            }
          }
        }
      );
      
      this.tracer?.record({
        id: `llm-response-${Date.now()}`,
        timestamp: Date.now(),
        level: 'info',
        category: TraceCategory.AGENT_LLM_CALL,
        component: 'BasicAgent',
        operation: 'runCycle',
        data: {
          provider: this.llmProvider.getProviderName(),
          tokensUsed: response.tokensUsed,
          responseLength: response.content.length,
          content: response.content.substring(0, 200) + '...'
        },
        parentId: cycleSpan?.id
      });
      
      // Parse the response
      const parsed = this.parseCompletion(response.content);
      
      this.tracer?.record({
        id: `parse-response-${Date.now()}`,
        timestamp: Date.now(),
        level: 'debug',
        category: TraceCategory.AGENT_RESPONSE_PARSE,
        component: 'BasicAgent',
        operation: 'parseCompletion',
        data: {
          operations: parsed.operations.length,
          hasMoreToSay: parsed.hasMoreToSay
        },
        parentId: cycleSpan?.id
      });
      
      // Apply stream routing to speak operations
      const operations = this.applyStreamRouting(parsed.operations, streamRef);
      
      // Create outgoing frame without sequence (Space will assign it)
      const timestamp = new Date().toISOString();
      const transition = createDefaultTransition(-1, timestamp);
      transition.veilOps = operations;

      const frame: OutgoingVEILFrame = {
        sequence: -1, // Placeholder - Space will assign proper sequence
        timestamp,
        events: [],
        deltas: operations,
        transition
      };
      
      // Attach raw LLM completion for debug purposes
      (frame as any).rawCompletion = {
        content: response.content,
        tokensUsed: response.tokensUsed,
        provider: this.llmProvider.getProviderName(),
        timestamp: new Date().toISOString()
      };
      
      return frame;
    } finally {
      if (cycleSpan) {
        this.tracer?.endSpan(cycleSpan.id);
      }
    }
  }
  
  parseCompletion(completion: string): ParsedCompletion {
    const operations: OutgoingVEILOperation[] = [];
    let hasMoreToSay = false;
    
    // The model outputs plain text without <my_turn> tags
    // The HUD handles formatting when rendering
    let turnContent = completion;
    
    // For now, assume the turn is complete if we got a response
    // In a real implementation, we'd check if we hit max tokens
    hasMoreToSay = false;
    
    // First, protect backticked content from being parsed as actions
    const backtickPlaceholders: string[] = [];
    let protectedContent = turnContent.replace(/`([^`]+)`/g, (match, content) => {
      const placeholder = `__BACKTICK_${backtickPlaceholders.length}__`;
      backtickPlaceholders.push(match);
      return placeholder;
    });
    
    // Parse @element.action syntax (now supports hierarchical paths like @chat.general.say)
    // Updated to support hyphens in element names (e.g., @box-1.open)
    const actionRegex = /@([\w.-]+)(?:\s*\(([^)]*)\)|\s*\{([\s\S]*?)\})?/g;
    let actionMatch;
    while ((actionMatch = actionRegex.exec(protectedContent)) !== null) {
      const fullPath = actionMatch[1];
      const inlineParams = actionMatch[2];
      const blockParams = actionMatch[3];
      
      // Split the path (e.g., "chat.general.say" → ["chat", "general", "say"])
      const pathParts = fullPath.split('.');
      
      let parameters: Record<string, any> = {};
      
      if (inlineParams) {
        // Parse inline params: @box.open("gently") or @box.open(speed="slow", careful=true)
        parameters = parseInlineParameters(inlineParams);
      } else if (blockParams) {
        // Parse block parameters: @email.send { to: alice@example.com, subject: Test }
        // This is a simplified parser - could be enhanced
        const lines = blockParams.trim().split('\n');
        let currentKey: string | null = null;
        let currentValue: string[] = [];
        
        for (const line of lines) {
          const keyMatch = line.match(/^\s*(\w+):\s*(.*)/);
          if (keyMatch) {
            // Save previous key/value
            if (currentKey) {
              parameters[currentKey] = currentValue.join('\n').trim();
            }
            currentKey = keyMatch[1];
            currentValue = [keyMatch[2]];
          } else if (currentKey && line.trim()) {
            // Continuation of previous value
            currentValue.push(line);
          }
        }
        // Save last key/value
        if (currentKey) {
          parameters[currentKey] = currentValue.join('\n').trim();
        }
      }
      
      // Restore backticks in parameters
      if (Object.keys(parameters).length > 0) {
        for (const key in parameters) {
          if (typeof parameters[key] === 'string') {
            let value = parameters[key];
            backtickPlaceholders.forEach((original, index) => {
              value = value.replace(`__BACKTICK_${index}__`, original.slice(1, -1)); // Remove backticks
            });
            parameters[key] = value;
          }
        }
      }
      
      // Convert element action to action facet
      // Path like ['dispenser', 'dispense'] becomes toolName 'dispenser.dispense'
      operations.push({
        type: 'addFacet',
        facet: this.createActionFacet(
          pathParts.join('.'),
          Object.keys(parameters).length > 0 ? parameters : {}
        )
      });
    }
    
    // Parse thoughts
    const thoughtRegex = /<thought>([\s\S]*?)<\/thought>/g;
    let thoughtMatch;
    while ((thoughtMatch = thoughtRegex.exec(turnContent)) !== null) {
      operations.push({
        type: 'addFacet',
        facet: this.createThoughtFacet(thoughtMatch[1].trim())
      });
    }
    
    // Parse tool calls
    const toolRegex = /<tool_call\s+name="([^"]+)">([\s\S]*?)<\/tool_call>/g;
    let toolMatch;
    while ((toolMatch = toolRegex.exec(turnContent)) !== null) {
      const toolName = toolMatch[1];
      const paramContent = toolMatch[2];
      
      // Parse parameters
      const params: Record<string, any> = {};
      const paramRegex = /<parameter\s+name="([^"]+)">([^<]*)<\/parameter>/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramContent)) !== null) {
        params[paramMatch[1]] = this.parseParameterValue(paramMatch[2]);
      }
      
      operations.push({
        type: 'addFacet',
        facet: this.createActionFacet(toolName, params)
      });
    }
    
    // Extract speech (everything not in special tags or actions)
    let speechContent = turnContent;
    
    // Protect backticks before removing content
    const speechBacktickPlaceholders: string[] = [];
    let protectedSpeech = speechContent.replace(/`([^`]+)`/g, (match, content) => {
      const placeholder = `__SPEECH_BACKTICK_${speechBacktickPlaceholders.length}__`;
      speechBacktickPlaceholders.push(match);
      return placeholder;
    });
    
    // Remove thoughts
    protectedSpeech = protectedSpeech.replace(/<thought>[\s\S]*?<\/thought>/g, '');
    
    // Remove tool calls
    protectedSpeech = protectedSpeech.replace(/<tool_call\s+name="[^"]+"[\s\S]*?<\/tool_call>/g, '');
    
    // Remove @element.action syntax (now handles hierarchical paths and hyphens)
    protectedSpeech = protectedSpeech.replace(/@[\w.-]+(?:\s*\([^)]*\)|\s*\{[\s\S]*?\})?/g, '');
    
    // Restore backticks
    speechContent = protectedSpeech;
    speechBacktickPlaceholders.forEach((original, index) => {
      speechContent = speechContent.replace(`__SPEECH_BACKTICK_${index}__`, original);
    });
    
    // Clean up whitespace
    speechContent = speechContent.trim();
    
    if (speechContent) {
      operations.push({
        type: 'addFacet',
        facet: this.createSpeechFacet(speechContent)
      });
    }
    
    return { operations, hasMoreToSay, rawContent: completion };
  }
  
  handleCommand(command: AgentCommand): void {
    switch (command.type) {
      case 'sleep':
        this.state.sleeping = true;
        // TODO: Handle duration with timers
        break;
        
      case 'wake':
        this.state.sleeping = false;
        // Activation facets persist in state and will be processed when awake
        console.log(`[Agent] Waking up`);
        break;
        
      case 'ignore':
        this.state.ignoringSources.add(command.source);
        break;
        
      case 'unignore':
        this.state.ignoringSources.delete(command.source);
        break;
        
      case 'setThreshold':
        this.state.attentionThreshold = command.threshold;
        break;
    }
  }
  
  /**
   * Enable automatic action registration for elements
   * When enabled, elements with handleAction will have their actions registered automatically
   */
  enableAutoActionRegistration(): void {
    this._autoActionRegistration = true;
  }
  
  private _autoActionRegistration = false;
  
  /**
   * Register an element's actions automatically
   * Called by Space when elements are added
   */
  registerElementAutomatically(element: Element): void {
    if (!this._autoActionRegistration) return;
    
    // Look for components with declared actions
    const components = (element as any)._components || [];
    
    for (const component of components) {
      const componentClass = component.constructor as any;
      const declaredActions = componentClass.actions;
      
      if (declaredActions && Object.keys(declaredActions).length > 0) {
        // Register all actions declared by this component
        this.registerElementActions(element, declaredActions);
      }
    }
    
    // Special case: if it's a box with no declared actions, add a generic open action
    if (element.id.startsWith('box-')) {
      const hasOpenAction = this.tools.has(`${element.id}.open`);
      if (!hasOpenAction) {
        this.registerElementActions(element, {
          open: 'Open this box'
        });
      }
    }
  }
  
  /**
   * Register multiple actions for an element at once
   */
  registerElementActions(element: Element | string, actions: Record<string, string | ActionConfig>): void {
    const elementId = typeof element === 'string' ? element : element.id;
    
    for (const [actionName, config] of Object.entries(actions)) {
      const description = typeof config === 'string' ? config : config.description;
      const params = typeof config === 'object' ? config.params : undefined;
      
      let parameters: any = {};
      
      // Auto-generate parameter schema from array of allowed values
      if (params && Array.isArray(params)) {
        parameters = {
          type: 'object',
          properties: {
            value: { 
              type: 'string', 
              enum: params,
              description: `One of: ${params.join(', ')}`
            }
          }
        };
      } else if (params && typeof params === 'object') {
        parameters = params;
      }
      
      this.registerTool({
        name: `${elementId}.${actionName}`,
        description,
        parameters,
        elementPath: [elementId],
        emitEvent: {
          topic: 'element:action',
          payloadTemplate: {}
        }
      });
    }
  }
  
  getState(): AgentState {
    return {
      sleeping: this.state.sleeping,
      ignoringSources: new Set(this.state.ignoringSources),
      attentionThreshold: this.state.attentionThreshold
    };
  }
  
  /**
   * Register a tool that the agent can use
   * Can accept either a full ToolDefinition or just a tool name string for common patterns
   */
  registerTool(toolOrName: ToolDefinition | string): void {
    let tool: ToolDefinition;
    
    if (typeof toolOrName === 'string') {
      // Smart defaults for string-based registration
      const parts = toolOrName.split('.');
      
      tool = {
        name: toolOrName,
        description: `Perform ${toolOrName} action`,
        parameters: {},
        elementPath: parts.slice(0, -1),
        emitEvent: {
          topic: 'element:action',
          payloadTemplate: {}
        }
      };
    } else {
      tool = toolOrName;
    }
    
    if (!tool.name) {
      throw new Error('Tool must have a name');
    }
    this.tools.set(tool.name, tool);
  }
  
  
  /**
   * Check if there are pending activations that should be processed
   * @deprecated Activation facets remain in state until processed
   */
  hasPendingActivations(): boolean {
    return false;
  }
  
  private buildContext(state: VEILState, streamRef?: StreamRef): RenderedContext {
    // Note: Pending activations removed - activation facets remain in state
    
    // Render using HUD
    return this.hud.render(
      state.frameHistory,
      new Map(state.facets),
      this.compressionEngine,
      {
        systemPrompt: this.config.systemPrompt,
        maxTokens: this.config.contextTokenBudget || 4000,  // Context window budget, not generation limit
        metadata: {
        },
        formatConfig: {
          assistant: {
            prefix: '<my_turn>\n',
            suffix: '\n</my_turn>'
          }
        },
        // Pass agent name for debugging
        name: this.config.name
      } as any
    );
  }
  
  private applyStreamRouting(
    deltas: OutgoingVEILOperation[], 
    streamRef?: StreamRef
  ): OutgoingVEILOperation[] {
    return deltas.map(op => {
      if (op.type === 'addFacet' && streamRef) {
        const facet = op.facet;
        if ((facet.type === 'speech' || facet.type === 'thought' || facet.type === 'action')) {
          return {
            ...op,
            facet: {
              ...facet,
              streamId: streamRef.streamId
            }
          };
        }
      }
      return op;
    });
  }

  private createActionFacet(toolName: string, parameters: Record<string, any>): Facet {
    return {
      id: this.generateFacetId('agent-action'),
      type: 'action',
      content: JSON.stringify(parameters),
      state: {
        toolName,
        parameters
      },
      agentId: this.resolveAgentId(),
      agentName: this.resolveAgentName(),
      streamId: this.getDefaultStreamId()
    };
  }

  private createSpeechFacet(content: string): Facet {
    return {
      id: this.generateFacetId('agent-speech'),
      type: 'speech',
      content,
      agentId: this.resolveAgentId(),
      agentName: this.resolveAgentName(),
      streamId: this.getDefaultStreamId()
    };
  }

  private createThoughtFacet(content: string): Facet {
    return {
      id: this.generateFacetId('agent-thought'),
      type: 'thought',
      content,
      agentId: this.resolveAgentId(),
      agentName: this.resolveAgentName(),
      streamId: this.getDefaultStreamId()
    };
  }

  private createAgentId(name?: string): string {
    if (name) {
      return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    return `agent-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFacetId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private resolveAgentId(): string {
    return this.agentId;
  }

  private resolveAgentName(): string | undefined {
    return this.config.name;
  }

  private getDefaultStreamId(): string {
    return 'default';
  }

  private parseParameterValue(value: string): any {
    // Try to parse as JSON first
    try {
      return JSON.parse(value);
    } catch {
      // If not JSON, return as string
      return value;
    }
  }
}

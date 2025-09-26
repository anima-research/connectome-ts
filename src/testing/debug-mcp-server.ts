const fetch = (...args: Parameters<typeof import('node-fetch')['default']>) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args) as any);

interface DebugState {
  space: any;
  veil: any;
  metrics: any;
  manualLLMEnabled: boolean;
}

interface Frame {
  uuid: string;
  sequence: number;
  type: string;
  timestamp: string;
  topic?: string;
  operation?: any;
  event?: any;
  error?: any;
}

interface FrameDetail extends Frame {
  facetsTree?: any;
  facetsSequence?: number;
}

export class ConnectomeDebugMCP {
  private debugUrl: string | null = null;
  private isConnected: boolean = false;
  
  constructor() {
    if (process.env.MCP_DEBUG) {
      console.error('[DebugMCP] Initialized');
    }
  }
  
  /**
   * Connect to a Connectome debug server
   * @tool
   */
  async connect(params: { port: number; host?: string }): Promise<{ success: boolean; url: string }> {
    const host = params.host || 'localhost';
    const url = `http://${host}:${params.port}`;
    
    try {
      // Test connection
      const response = await fetch(`${url}/api/state`);
      if (!response.ok) {
        throw new Error(`Debug server returned ${response.status}`);
      }
      
      this.debugUrl = url;
      this.isConnected = true;
      
      if (process.env.MCP_DEBUG) {
        console.error(`[DebugMCP] Connected to ${url}`);
      }
      
      return { success: true, url };
    } catch (error: any) {
      this.debugUrl = null;
      this.isConnected = false;
      throw new Error(`Failed to connect to debug server at ${url}: ${error.message}`);
    }
  }
  
  /**
   * Disconnect from the debug server
   * @tool
   */
  async disconnect(): Promise<{ success: boolean }> {
    this.debugUrl = null;
    this.isConnected = false;
    
    if (process.env.MCP_DEBUG) {
      console.error('[DebugMCP] Disconnected');
    }
    
    return { success: true };
  }
  
  /**
   * Get connection status
   * @tool
   */
  async getConnectionStatus(): Promise<{ connected: boolean; url?: string }> {
    return {
      connected: this.isConnected,
      url: this.debugUrl || undefined
    };
  }
  
  private ensureConnected(): void {
    if (!this.isConnected || !this.debugUrl) {
      throw new Error('Not connected to debug server. Use connect() first.');
    }
  }
  
  private async fetchJSON(path: string, options?: any): Promise<any> {
    this.ensureConnected();
    
    const url = `${this.debugUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      },
      ...options
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Debug API error (${response.status}): ${text}`);
    }
    
    return response.json();
  }
  
  /**
   * Get the current VEIL state and space structure
   * @tool
   */
  async getState(): Promise<DebugState> {
    return this.fetchJSON('/api/state');
  }
  
  /**
   * Get just the VEIL state (facets)
   * @tool
   */
  async getVEILState(): Promise<any> {
    return this.fetchJSON('/api/facets');
  }
  
  /**
   * Get execution frames (history)
   * @tool
   */
  async getFrames(params: { limit?: number; offset?: number } = {}): Promise<{
    frames: Frame[];
    metrics: any;
  }> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', params.limit.toString());
    if (params.offset !== undefined) query.set('offset', params.offset.toString());
    
    const queryString = query.toString();
    const path = queryString ? `/api/frames?${queryString}` : '/api/frames';
    
    return this.fetchJSON(path);
  }
  
  /**
   * Get detailed frame information including facet tree
   * @tool
   */
  async getFrame(params: { frameId: string }): Promise<FrameDetail> {
    return this.fetchJSON(`/api/frames/${params.frameId}`);
  }
  
  /**
   * Get a specific element by ID
   * @tool
   */
  async getElement(params: { elementId: string }): Promise<any> {
    return this.fetchJSON(`/api/elements/${params.elementId}`);
  }
  
  /**
   * Update element properties
   * @tool
   */
  async updateElementProps(params: {
    elementId: string;
    props: Record<string, any>;
  }): Promise<{ success: boolean }> {
    await this.fetchJSON(`/api/elements/${params.elementId}/props`, {
      method: 'PUT',
      body: JSON.stringify(params.props)
    });
    
    return { success: true };
  }
  
  /**
   * Inject an event into the system
   * @tool
   */
  async injectEvent(params: {
    topic: string;
    payload?: any;
    sourceId?: string;
  }): Promise<{ success: boolean }> {
    await this.fetchJSON('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        topic: params.topic,
        payload: params.payload || {},
        sourceId: params.sourceId || 'debug-mcp'
      })
    });
    
    return { success: true };
  }
  
  /**
   * Get performance metrics
   * @tool
   */
  async getMetrics(): Promise<any> {
    return this.fetchJSON('/api/metrics');
  }
  
  /**
   * Delete old frames to free memory
   * @tool
   */
  async deleteFrames(params: { count: number }): Promise<{ deleted: number }> {
    return this.fetchJSON('/api/frames/delete', {
      method: 'POST',
      body: JSON.stringify({ count: params.count })
    });
  }
  
  /**
   * Search frames for specific patterns
   * @tool
   */
  async searchFrames(params: {
    pattern: string;
    type?: 'operation' | 'event' | 'error';
    limit?: number;
  }): Promise<Frame[]> {
    const allFrames = await this.getFrames({ limit: params.limit || 100 });
    
    return allFrames.frames.filter(frame => {
      // Filter by type if specified
      if (params.type && frame.type !== params.type) {
        return false;
      }
      
      // Search in frame content
      const frameStr = JSON.stringify(frame).toLowerCase();
      return frameStr.includes(params.pattern.toLowerCase());
    });
  }
  
  /**
   * Get element tree starting from a specific element or root
   * @tool
   */
  async getElementTree(params: { elementId?: string; depth?: number } = {}): Promise<any> {
    const state = await this.getState();
    
    if (!params.elementId) {
      return state.space;
    }
    
    // Find element in tree
    const findElement = (element: any, id: string): any => {
      if (element.id === id) return element;
      
      if (element.children) {
        for (const child of element.children) {
          const found = findElement(child, id);
          if (found) return found;
        }
      }
      
      return null;
    };
    
    return findElement(state.space, params.elementId);
  }
  
  /**
   * Get agents and their current state
   * @tool
   */
  async getAgents(): Promise<any[]> {
    const state = await this.getState();
    
    // Extract agents from VEIL state
    const agents: any[] = [];
    if (state.veil?.agents) {
      for (const [id, agent] of Object.entries(state.veil.agents)) {
        agents.push({ id, ...(agent as any) });
      }
    }
    
    return agents;
  }
  
  /**
   * Get debug LLM status and requests
   * @tool
   */
  async getDebugLLMStatus(): Promise<{ enabled: boolean; requests?: any[] }> {
    const response = await this.fetchJSON('/api/debug-llm/requests');
    return response;
  }
  
  /**
   * Get debug LLM requests (all or just pending)
   * @tool
   */
  async getDebugLLMRequests(params: { pendingOnly?: boolean } = {}): Promise<any[]> {
    const response = await this.fetchJSON('/api/debug-llm/requests');
    
    if (!response.enabled) {
      throw new Error('Debug LLM provider is not enabled');
    }
    
    let requests = response.requests || [];
    
    if (params.pendingOnly) {
      requests = requests.filter((r: any) => r.status === 'pending');
    }
    
    return requests;
  }
  
  /**
   * Get a specific debug LLM request by ID
   * @tool
   */
  async getDebugLLMRequest(params: { requestId: string }): Promise<any | null> {
    const response = await this.fetchJSON('/api/debug-llm/requests');
    
    if (!response.enabled) {
      throw new Error('Debug LLM provider is not enabled');
    }
    
    const request = (response.requests || []).find((r: any) => r.id === params.requestId);
    return request || null;
  }
  
  /**
   * Complete a pending debug LLM request
   * @tool
   */
  async completeDebugLLMRequest(params: { 
    requestId: string; 
    content: string; 
    modelId?: string; 
    tokensUsed?: number 
  }): Promise<{ success: boolean; request?: any }> {
    const response = await this.fetchJSON(`/api/debug-llm/requests/${params.requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: params.content,
        modelId: params.modelId,
        tokensUsed: params.tokensUsed
      })
    });
    
    if (response.status === 'ok') {
      return { success: true, request: response.request };
    } else {
      throw new Error(response.error || 'Failed to complete request');
    }
  }
  
  /**
   * Cancel a pending debug LLM request
   * @tool
   */
  async cancelDebugLLMRequest(params: { 
    requestId: string; 
    reason?: string 
  }): Promise<{ success: boolean }> {
    // The debug server doesn't have a cancel endpoint yet, so we'll complete with an error message
    const response = await this.fetchJSON(`/api/debug-llm/requests/${params.requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `[CANCELLED: ${params.reason || 'Request cancelled by user'}]`,
        modelId: 'debug-cancelled'
      })
    });
    
    if (response.status === 'ok') {
      return { success: true };
    } else {
      throw new Error(response.error || 'Failed to cancel request');
    }
  }
}




import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { LLMMessage, LLMOptions, LLMResponse } from './llm-interface';

export type DebugLLMRequestStatus = 'pending' | 'completed' | 'cancelled';

export interface DebugLLMRequest {
  id: string;
  providerId: string;
  createdAt: number;
  completedAt?: number;
  status: DebugLLMRequestStatus;
  messages: LLMMessage[];
  options?: LLMOptions;
  response?: LLMResponse;
  metadata?: Record<string, any>;
}

interface PendingEntry {
  request: DebugLLMRequest;
  resolve: (response: LLMResponse) => void;
  reject: (error: Error) => void;
}

export interface DebugLLMRequestInit {
  providerId: string;
  messages: LLMMessage[];
  options?: LLMOptions;
  metadata?: Record<string, any>;
}

export interface DebugLLMCompletion {
  content: string;
  modelId?: string;
  tokensUsed?: number;
}

const HISTORY_LIMIT = 50;

type BridgeEvents = {
  'request-created': (request: DebugLLMRequest) => void;
  'request-updated': (request: DebugLLMRequest) => void;
};

class DebugLLMBridge extends EventEmitter {
  private readonly pending = new Map<string, PendingEntry>();
  private history: DebugLLMRequest[] = [];

  createRequest(init: DebugLLMRequestInit): { request: DebugLLMRequest; completion: Promise<LLMResponse> } {
    const id = randomUUID();
    const request: DebugLLMRequest = {
      id,
      providerId: init.providerId,
      createdAt: Date.now(),
      status: 'pending',
      messages: this.clone(init.messages),
      options: init.options ? this.clone(init.options) : undefined,
      metadata: init.metadata ? this.clone(init.metadata) : undefined
    };

    const completion = new Promise<LLMResponse>((resolve, reject) => {
      this.pending.set(id, {
        request,
        resolve,
        reject
      });
    });

    this.history.unshift(request);
    this.pruneHistory();
    this.emit('request-created', this.clone(request));

    return { request, completion };
  }

  completeRequest(id: string, completion: DebugLLMCompletion): DebugLLMRequest | undefined {
    const entry = this.pending.get(id);
    if (!entry) {
      return undefined;
    }

    const estimatedTokens = completion.tokensUsed ?? Math.ceil(completion.content.length / 4);
    const response: LLMResponse = {
      content: completion.content,
      modelId: completion.modelId,
      tokensUsed: estimatedTokens
    };

    entry.request.status = 'completed';
    entry.request.completedAt = Date.now();
    entry.request.response = response;

    this.pending.delete(id);
    entry.resolve(response);

    const payload = this.clone(entry.request);
    this.emit('request-updated', payload);
    return payload;
  }

  cancelRequest(id: string, reason?: string): DebugLLMRequest | undefined {
    const entry = this.pending.get(id);
    if (!entry) {
      return undefined;
    }

    entry.request.status = 'cancelled';
    entry.request.completedAt = Date.now();
    entry.request.metadata = {
      ...entry.request.metadata,
      cancelledReason: reason || 'cancelled'
    };

    this.pending.delete(id);
    entry.reject(new Error(reason || 'Request cancelled'));

    const payload = this.clone(entry.request);
    this.emit('request-updated', payload);
    return payload;
  }

  getRequests(): DebugLLMRequest[] {
    return this.history.map(request => this.clone(request));
  }

  getPendingRequests(): DebugLLMRequest[] {
    return this.history
      .filter(request => request.status === 'pending')
      .map(request => this.clone(request));
  }

  on<Event extends keyof BridgeEvents>(event: Event, listener: BridgeEvents[Event]): this {
    return super.on(event, listener);
  }

  off<Event extends keyof BridgeEvents>(event: Event, listener: BridgeEvents[Event]): this {
    return super.off(event, listener);
  }

  once<Event extends keyof BridgeEvents>(event: Event, listener: BridgeEvents[Event]): this {
    return super.once(event, listener);
  }

  private pruneHistory(): void {
    if (this.history.length <= HISTORY_LIMIT) {
      return;
    }

    const pending = this.history.filter(request => request.status === 'pending');
    const completed = this.history
      .filter(request => request.status !== 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);

    const availableSlots = Math.max(HISTORY_LIMIT - pending.length, 0);
    const trimmedCompleted = completed.slice(0, availableSlots);

    this.history = [...pending, ...trimmedCompleted].sort((a, b) => b.createdAt - a.createdAt);
  }

  private clone<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }
}

export const debugLLMBridge = new DebugLLMBridge();

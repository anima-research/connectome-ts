import type { Frame, StreamRef } from '../veil/types';
import type { SpaceEvent, EventPhase } from '../spaces/types';
import type { RenderedContext } from '../hud/types-v2';

export interface DebugFrameStartContext {
  queuedEvents: number;
}

export interface DebugFrameCompleteContext {
  durationMs: number;
  processedEvents: number;
}

export interface DebugAgentFrameContext {
  agentId?: string;
  agentName?: string;
}

export interface DebugEventContext {
  phase: EventPhase;
  targetId?: string;
}

export interface DebugRenderedContextInfo {
  frameSequence: number;
  frameUUID?: string;
  context: RenderedContext;
  agentId?: string;
  agentName?: string;
  streamRef?: StreamRef;
}

/**
 * Observer interface used by the Space to notify the debug server about runtime activity.
 */
export interface DebugObserver {
  onFrameStart?(frame: Frame, context: DebugFrameStartContext): void;
  onFrameEvent?(frame: Frame, event: SpaceEvent, context: DebugEventContext): void;
  onFrameComplete?(frame: Frame, context: DebugFrameCompleteContext): void;
  onAgentFrame?(frame: Frame, context: DebugAgentFrameContext): void;
  onRenderedContext?(info: DebugRenderedContextInfo): void;
}

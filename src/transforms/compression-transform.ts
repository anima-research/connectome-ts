/**
 * CompressionTransform
 *
 * Coordinates automatic compression of frame ranges using a CompressionEngine.
 *
 * Responsibilities:
 *  - Monitor VEIL frame history and detect when compression thresholds are met.
 *  - Generate rendered frames (without compression) to provide to the engine.
 *  - Invoke the engine's identify + compress lifecycle asynchronously.
 *  - Persist results as facets so other system parts can observe progress.
 *  - Populate the engine cache so ContextTransform/HUD pick up replacements.
 */

import { BaseTransform } from '../components/base-martem';
import { ReadonlyVEILState } from '../spaces/receptor-effector-types';
import { Facet, VEILDelta } from '../veil/types';
import { FrameTrackingHUD } from '../hud/frame-tracking-hud';
import { CompressionEngine, CompressibleRange, CompressionConfig, RenderedFrame, StateDelta } from '../compression/types-v2';
import { extractFrameRange } from '../hud/frame-extraction';

interface CompressionTransformOptions {
  engine: CompressionEngine;
  engineName?: string;
  hud?: FrameTrackingHUD;
  compressionConfig?: CompressionConfig;
  triggerThreshold?: number;
  minFramesBeforeCompression?: number;
  maxPendingRanges?: number;
  maxConcurrent?: number;
  retryLimit?: number;
  retryDelayMs?: number;
}

type CompressionStatus = 'pending' | 'in-progress' | 'ready' | 'failed';

type SerializableStateDelta = {
  changes: Array<{ facetId: string; data: Record<string, any> }>;
  added: string[];
  deleted: string[];
};

interface CompressionTask {
  id: string;
  range: CompressibleRange;
  status: CompressionStatus;
  attempts: number;
  lastUpdated: number;
  summary?: string;
  stateDelta?: SerializableStateDelta;
  lastError?: string;
}

export class CompressionTransform extends BaseTransform {
  // Priority: Run early in Phase 2, before transforms that consume compression
  // TODO [constraint-solver]: Replace with provides = ['compressed-frames']
  priority = 10;
  
  private readonly engine: CompressionEngine;
  private readonly engineName: string;
  private readonly hud: FrameTrackingHUD;
  private readonly options: Required<Omit<CompressionTransformOptions, 'engine' | 'hud' | 'engineName'>>;

  private lastProcessedSequence = 0;
  private tasks = new Map<string, CompressionTask>();
  private activeJobs = new Map<string, Promise<void>>();
  private cachedRenderingsKey: string | null = null;
  private cachedRenderings: RenderedFrame[] | null = null;

  constructor(config: CompressionTransformOptions) {
    super();

    if (!config.engine) {
      throw new Error('CompressionTransform requires a compression engine.');
    }

    this.engine = config.engine;
    this.engineName = config.engineName ?? this.engine.constructor.name ?? 'CompressionEngine';
    this.hud = config.hud ?? new FrameTrackingHUD();

    this.options = {
      compressionConfig: config.compressionConfig ?? {},
      triggerThreshold: config.triggerThreshold ?? config.compressionConfig?.chunkThreshold ?? 500,
      minFramesBeforeCompression: config.minFramesBeforeCompression ?? 10,
      maxPendingRanges: config.maxPendingRanges ?? 5,
      maxConcurrent: config.maxConcurrent ?? 1,
      retryLimit: config.retryLimit ?? 2,
      retryDelayMs: config.retryDelayMs ?? 200
    };
  }

  process(state: ReadonlyVEILState): VEILDelta[] {
    const deltas: VEILDelta[] = [];
    const lastFrame = state.frameHistory[state.frameHistory.length - 1];

    if (!lastFrame || state.frameHistory.length < this.options.minFramesBeforeCompression) {
      return deltas;
    }

    if (lastFrame.sequence === this.lastProcessedSequence) {
      return deltas;
    }

    const renderedFrames = this.getRenderedFrames(state);
    const ranges = this.engine.identifyCompressibleRanges([...state.frameHistory], renderedFrames);

    this.registerRanges(ranges);
    this.dispatchWork(state, renderedFrames);

    const planFacet = this.buildPlanFacet();
    if (planFacet) {
      deltas.push({ type: 'addFacet', facet: planFacet });
    }

    const resultFacets = this.buildResultFacets();
    for (const facet of resultFacets) {
      deltas.push({ type: 'addFacet', facet });
    }

    this.lastProcessedSequence = lastFrame.sequence;
    return deltas;
  }

  private getRenderedFrames(state: ReadonlyVEILState): RenderedFrame[] {
    const frameHistory = state.frameHistory;
    const key = `${frameHistory.length}:${frameHistory[frameHistory.length - 1]?.sequence}`;

    if (this.cachedRenderingsKey === key && this.cachedRenderings) {
      return this.cachedRenderings;
    }

    const { frameRenderings } = this.hud.renderWithFrameTracking(
      [...frameHistory],
      new Map(state.facets),
      undefined,
      {
        maxTokens: this.options.compressionConfig.maxTokens,
        chunkThreshold: this.options.compressionConfig.chunkThreshold
      } as any
    );

    this.cachedRenderingsKey = key;
    this.cachedRenderings = frameRenderings;
    return frameRenderings;
  }

  private registerRanges(ranges: CompressibleRange[]): void {
    const now = Date.now();

    for (const range of ranges) {
      if (this.tasks.size >= this.options.maxPendingRanges) {
        break;
      }

      const id = this.rangeId(range);
      if (!this.tasks.has(id)) {
        this.tasks.set(id, {
          id,
          range,
          status: 'pending',
          attempts: 0,
          lastUpdated: now
        });
      }
    }
  }

  private dispatchWork(state: ReadonlyVEILState, renderings: RenderedFrame[]): void {
    const availableSlots = this.options.maxConcurrent - this.activeJobs.size;
    if (availableSlots <= 0) return;

    const candidates = Array.from(this.tasks.values())
      .filter(task => task.status === 'pending')
      .slice(0, availableSlots);

    for (const task of candidates) {
      task.status = 'in-progress';
      task.lastUpdated = Date.now();

      const job = this.executeTask(task, state, renderings)
        .catch(error => this.handleFailure(task, error as Error))
        .finally(() => this.activeJobs.delete(task.id));

      this.activeJobs.set(task.id, job);
    }
  }

  private async executeTask(task: CompressionTask, state: ReadonlyVEILState, renderings: RenderedFrame[]): Promise<void> {
    task.attempts += 1;

    const result = await this.engine.compressRange(
      task.range,
      [...state.frameHistory],
      renderings,
      new Map(state.facets)
    );

    task.status = 'ready';
    task.lastUpdated = Date.now();
    task.summary = (result.engineData as any)?.summary ?? '[Compressed range]';
    task.stateDelta = result.stateDelta ? {
      changes: Array.from(result.stateDelta.changes.entries()).map(([facetId, data]) => ({ facetId, data })),
      added: [...result.stateDelta.added],
      deleted: [...result.stateDelta.deleted]
    } : undefined;
    task.lastError = undefined;
  }

  private handleFailure(task: CompressionTask, error: Error): void {
    task.lastError = error.message;
    task.lastUpdated = Date.now();

    if (task.attempts >= this.options.retryLimit) {
      task.status = 'failed';
      return;
    }

    task.status = 'pending';
    setTimeout(() => {
      this.lastProcessedSequence = 0;
    }, this.options.retryDelayMs);
  }

  private buildPlanFacet(): Facet | null {
    if (this.tasks.size === 0) {
      return null;
    }

    const facet: Facet = {
      id: `compression-plan-${Date.now()}`,
      type: 'compression-plan',
      state: {
        engine: this.engineName,
        ranges: Array.from(this.tasks.values()).map(task => ({
          from: task.range.fromFrame,
          to: task.range.toFrame,
          totalTokens: task.range.totalTokens,
          reason: task.range.reason,
          status: task.status,
          lastUpdated: new Date(task.lastUpdated).toISOString(),
          message: task.lastError
        }))
      },
      ephemeral: true
    };

    return facet;
  }

  private buildResultFacets(): Facet[] {
    const results: Facet[] = [];

    for (const task of this.tasks.values()) {
      if (task.status !== 'ready' || !task.summary) {
        continue;
      }

      const facet: Facet = {
        id: `compression-result-${task.id}-${Date.now()}`,
        type: 'compression-result',
        state: {
          engine: this.engineName,
          range: {
            from: task.range.fromFrame,
            to: task.range.toFrame,
            totalTokens: task.range.totalTokens,
            reason: task.range.reason
          },
          summary: task.summary,
          stateDelta: task.stateDelta ? {
            changes: task.stateDelta.changes,
            added: task.stateDelta.added,
            deleted: task.stateDelta.deleted
          } : undefined,
          createdAt: new Date(task.lastUpdated).toISOString()
        },
        ephemeral: true
      };

      results.push(facet);
    }

    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'ready' || task.status === 'failed') {
        this.tasks.delete(id);
      }
    }

    return results;
  }

  private rangeId(range: CompressibleRange): string {
    return `${range.fromFrame}-${range.toFrame}`;
  }
}


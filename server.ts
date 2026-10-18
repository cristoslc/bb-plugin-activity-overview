// bb-plugin-activity-overview — backend entry.
//
// The three aggregate views (Board, Unit treemap, Strip tiles) are entirely
// frontend-rendered from the host's live sidebar thread data, so the backend
// owns no state for them. The backend exists to serve one thing the frontend
// cannot see: the per-thread token burn history behind the Token flow view,
// read from `threads.context` and resampled into equal wall-clock buckets over
// the `flow` RPC, pushed live over the coalesced FLOW_CHANGED channel.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { executionModel, type Row } from "./views/timeline";
import { FLOW_BUCKETS, providerOfModel, resampleWindow } from "./views/model";
import { FLOW_CHANGED, type FlowChangedPayload } from "./shared";

type FlowStatus = z.infer<typeof flowStatusSchema>;

const flowStatusSchema = z.enum([
  "running",
  "waiting",
  "queued",
  "done",
  "error",
  "interrupted",
  "idle",
]);

// One token flow row per thread: totals (context-window usage), provider
// attribution (the context snapshot's model string, else the newest persisted
// `client/turn/requested` event) and the sampled burn history. Family grouping
// and layout are pure frontend math (views/model.ts).
export const flowThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  status: flowStatusSchema,
  parentThreadId: z.string().nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  usedTokens: z.number().nullable(),
  modelContextWindow: z.number().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Sampled context growth, tokens per second (null: no sample history yet). */
  rate: z.number().nullable(),
  /** Σ positive context growth seen by the sampler since the plugin started. */
  tracked: z.number().nullable(),
  /** Per-bucket burn tokens (oldest → newest) over the flow window. */
  series: z.array(z.number()),
});
export const flowSchema = z.object({
  threads: z.array(flowThreadSchema),
  /** The resample window (ms) and bucket count behind `series`. */
  windowMs: z.number(),
  buckets: z.number(),
  generatedAt: z.number(),
  truncated: z.boolean(),
});
export type FlowThread = z.infer<typeof flowThreadSchema>;
export type Flow = z.infer<typeof flowSchema>;

export const rpcContract = defineRpcContract({
  flow: {
    input: z.object({}),
    output: flowSchema,
  },
});

type ThreadDto = {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  status: string;
  parentThreadId: string | null;
  environmentBranchName?: string | null;
  updatedAt: number;
  createdAt: number;
  hasPendingInteraction?: boolean;
  queuedWork?: string;
  runtime?: { displayStatus?: string } | null;
};

// `threads.list` is paginated: one page per call, looping until a page comes
// back short (or the ceiling stops the walk on hosts with huge thread counts).
const THREAD_PAGE = 300;
const THREAD_CEILING = 3000;
const BUILD_MEMO_MS = 750;

// ── flow sampling ─────────────────────────────────────────────────────────
// The host persists only per-thread *context-window usage*, never throughput,
// so burn history is a local sample ring: every reading is a (time, usedTokens)
// pair, and the series resamples the ring's positive growth into equal
// wall-clock buckets. `thread/tokenUsage/updated` /
// `thread/contextWindowUsage/updated` deltas drive extra samples, so a
// streaming thread's newest bucket grows between builds.
const FLOW_WINDOW_MS = 60 * 60_000; // the view's burn window (last hour)
const SAMPLE_MIN_GAP_MS = 3_000;
const SAMPLE_SPAN_MS = FLOW_WINDOW_MS;
const SAMPLE_RING_CAP = 600; // ~30 min at the min gap; oldest evicted

type Sample = { at: number; used: number };

const RUNNING_THREAD_STATUSES = new Set(["active", "starting", "pending"]);

function oneLine(value: string | null, cap = 80): string | null {
  if (value === null) return null;
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}

function threadStatus(thread: ThreadDto): FlowStatus {
  if (thread.hasPendingInteraction) return "waiting";
  if (thread.status === "error") return "error";
  if (RUNNING_THREAD_STATUSES.has(thread.status)) return "running";
  if (thread.queuedWork !== undefined && thread.queuedWork !== "none") return "queued";
  return "idle";
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("activity-overview plugin loaded (token flow served over the flow RPC)");

  const sampleRings = new Map<string, Sample[]>();
  const lastSampledAt = new Map<string, number>();

  /** The sampled burn rate (tok/s) and everything the ring has tracked so far. */
  function tokenRate(threadId: string): { rate: number; tracked: number } {
    const ring = sampleRings.get(threadId) ?? [];
    let tracked = 0;
    let rate = 0;
    const now = Date.now();
    for (let i = 1; i < ring.length; i++) {
      const d = ring[i]!.used - ring[i - 1]!.used;
      const dt = ring[i]!.at - ring[i - 1]!.at;
      if (d > 0 && dt > 0 && dt <= SAMPLE_SPAN_MS) {
        tracked += d;
        if (ring[i]!.at >= now - SAMPLE_SPAN_MS) rate += d / (dt / 1000);
      }
    }
    return { rate, tracked };
  }

  function noteSample(threadId: string, usedTokens: number | null, at = Date.now()): void {
    if (usedTokens === null) return;
    const ring = sampleRings.get(threadId) ?? [];
    ring.push({ at, used: usedTokens });
    const cutoff = at - SAMPLE_SPAN_MS;
    const fresh = ring.filter((s) => s.at >= cutoff);
    sampleRings.set(threadId, fresh.slice(-SAMPLE_RING_CAP));
  }

  /** Throttled context read: the sampler runs while nothing watches the flow
   *  view, so stream-only updates still move the ribbons. */
  async function sampleContext(threadId: string): Promise<void> {
    const now = Date.now();
    if (now - (lastSampledAt.get(threadId) ?? 0) < SAMPLE_MIN_GAP_MS) return;
    lastSampledAt.set(threadId, now);
    try {
      const ctx = (await bb.sdk.threads.context({ threadId })) as {
        usage: { usedTokens?: number | null } | null;
      };
      noteSample(threadId, ctx.usage?.usedTokens ?? null, now);
    } catch (cause) {
      bb.log.warn(`context sample failed for ${threadId}: ${String(cause)}`);
    }
  }

  /**
   * Every non-archived thread, paged through `threads.list` so hosts with
   * more than one page of threads still get their full roster.
   */
  async function listThreads(): Promise<ThreadDto[]> {
    const threads: ThreadDto[] = [];
    for (let offset = 0; offset < THREAD_CEILING; offset += THREAD_PAGE) {
      const result = await bb.sdk.threads.list({ archived: false, limit: THREAD_PAGE, offset });
      const page = (Array.isArray(result) ? result : []) as unknown as ThreadDto[];
      threads.push(...page);
      if (page.length < THREAD_PAGE) return threads;
    }
    return threads;
  }

  async function mapLimited<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const index = next++;
          results[index] = await fn(items[index]!);
        }
      }),
    );
    return results;
  }

  async function buildFlow(): Promise<Flow> {
    /** The model string of a thread's newest persisted turn request. */
    async function newestRequestedModel(threadId: string): Promise<string | null> {
      try {
        const events = (await bb.sdk.threads.events.list({
          threadId,
          types: ["client/turn/requested"],
          order: "desc",
          limit: "1",
        })) as unknown as Row[];
        return executionModel(Array.isArray(events) ? (events[0] ?? null) : null);
      } catch {
        return null;
      }
    }
    const [allThreads, projects] = await Promise.all([
      listThreads(),
      bb.sdk.projects.list({ includePersonal: true }).then((result) =>
        (Array.isArray(result) ? result : []) as Array<{ id: string; name?: string | null }>,
      ),
    ]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name ?? p.id]));
    const now = Date.now();
    const rows = await mapLimited(allThreads, 4, async (thread) => {
      let usedTokens: number | null = null;
      let modelContextWindow: number | null = null;
      let model: string | null = null;
      try {
        const ctx = (await bb.sdk.threads.context({ threadId: thread.id })) as {
          usage: {
            usedTokens?: number | null;
            modelContextWindow?: number | null;
            snapshot?: { model?: string | null } | null;
          } | null;
        };
        usedTokens = ctx.usage?.usedTokens ?? null;
        modelContextWindow = ctx.usage?.modelContextWindow ?? null;
        model = ctx.usage?.snapshot?.model ?? null;
        if (model === null) model = await newestRequestedModel(thread.id);
      } catch (cause) {
        bb.log.warn(`context failed for ${thread.id}: ${String(cause)}`);
      }
      noteSample(thread.id, usedTokens, now);
      const { rate, tracked } = tokenRate(thread.id);
      const series = resampleWindow(sampleRings.get(thread.id) ?? [], now, FLOW_WINDOW_MS, FLOW_BUCKETS);
      return {
        id: thread.id,
        projectId: thread.projectId,
        projectName: projectNames.get(thread.projectId) ?? thread.projectId,
        title: oneLine(thread.title ?? thread.titleFallback, 80) ?? "Untitled thread",
        status: threadStatus(thread),
        parentThreadId: thread.parentThreadId ?? null,
        createdAt: thread.createdAt ?? null,
        updatedAt: thread.updatedAt ?? null,
        usedTokens,
        modelContextWindow,
        model,
        provider: providerOfModel(model),
        rate,
        tracked,
        series,
      };
    });
    return {
      threads: rows,
      windowMs: FLOW_WINDOW_MS,
      buckets: FLOW_BUCKETS,
      generatedAt: now,
      truncated: allThreads.length >= THREAD_CEILING,
    };
  }

  // Every open window asks for the flow on the same realtime signal, so share
  // one in-flight build and reuse the result for a moment after.
  const flowBuildCache = new Map<string, { at: number; promise: Promise<Flow> }>();
  function flowFor(): Promise<Flow> {
    const cached = flowBuildCache.get("*");
    if (cached && Date.now() - cached.at < BUILD_MEMO_MS) return cached.promise;
    const promise = buildFlow();
    flowBuildCache.set("*", { at: Date.now(), promise });
    promise.catch(() => flowBuildCache.delete("*"));
    return promise;
  }

  bb.rpc.register(rpcContract, {
    flow: () => flowFor(),
  });

  // Live updates: coalesce thread changes and tell open flow views to refetch.
  // Streaming text/reasoning deltas are skipped; token-usage deltas do not
  // rebuild anything but feed the burn sampler, so streaming threads keep
  // animating even while nothing watches.
  const STREAM_DELTA_EVENTS = new Set([
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
    "item/commandExecution/outputDelta",
    "item/fileChange/outputDelta",
    "item/plan/delta",
    "provider/rateLimits/updated",
    "item/toolCall/progress",
    "item/mcpToolCall/progress",
    "item/backgroundTask/progress",
    "turn/diff/updated",
  ]);
  const TOKEN_SAMPLING_EVENTS = new Set([
    "thread/tokenUsage/updated",
    "thread/contextWindowUsage/updated",
  ]);
  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      const eventTypes = event.metadata?.eventTypes;
      const sample =
        event.id !== undefined &&
        eventTypes !== undefined &&
        eventTypes.some((type) => TOKEN_SAMPLING_EVENTS.has(type));
      const deltaOnly =
        eventTypes !== undefined &&
        eventTypes.length > 0 &&
        eventTypes.every((type) => STREAM_DELTA_EVENTS.has(type));
      if (deltaOnly) {
        if (sample && event.id) void sampleContext(event.id);
        return;
      }
      if (event.id) {
        flowBuildCache.clear();
        if (sample) void sampleContext(event.id);
        pending.add(event.id);
      }
      flushTimer ??= setTimeout(() => {
        flushTimer = null;
        const threadIds = [...pending];
        pending.clear();
        bb.realtime.publish(FLOW_CHANGED, { threadIds } satisfies FlowChangedPayload);
      }, 600);
    },
  });
  bb.onDispose(() => {
    unsubscribe();
    if (flushTimer !== null) clearTimeout(flushTimer);
  });
}

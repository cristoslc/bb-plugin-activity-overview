// bb-plugin-activity-overview — backend entry.
//
// The four aggregate views (Board, Unit treemap, Strip tiles, Agent lanes)
// are entirely frontend-rendered from the host's live sidebar thread data, so
// the backend owns no state for them. The backend exists to serve one thing
// the frontend cannot see: per-thread turn timelines (project → thread →
// turn → work), published as a flat node tree over the `shape` RPC for the
// Activity flow view.
//
// Timelines are read loosely (as records) so new row kinds degrade to a
// generic work node instead of breaking the view.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { delegationChildId, spawnHint } from "./views/lineage";
import { normalizeTurns, type Row } from "./views/timeline";
import { SHAPE_CHANGED, type ShapeChangedPayload } from "./shared";

const nodeKindSchema = z.enum(["root", "project", "thread", "turn", "work", "more"]);
const nodeStatusSchema = z.enum([
  "running",
  "waiting",
  "queued",
  "done",
  "error",
  "interrupted",
  "idle",
]);
const shapeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: nodeKindSchema,
  label: z.string(),
  sublabel: z.string().nullable(),
  status: nodeStatusSchema,
  threadId: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  input: z.string().nullable(),
  output: z.string().nullable(),
  meta: z.record(z.string(), z.string()),
});
export type ShapeStatus = z.infer<typeof nodeStatusSchema>;
export type ShapeNode = z.infer<typeof shapeNodeSchema>;

const shapeSchema = z.object({
  nodes: z.array(shapeNodeSchema),
  generatedAt: z.number(),
  truncated: z.boolean(),
});
export type Shape = z.infer<typeof shapeSchema>;

export const rpcContract = defineRpcContract({
  shape: {
    input: z.object({}),
    output: shapeSchema,
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

// The flow view caps data at comfortable depths: hot threads (running /
// waiting / queued / error) keep 8 recent turns, cold threads only 1; each
// turn keeps its newest work rows behind a "+N earlier steps" marker. A hard
// node ceiling degrades gracefully: nodes are added hot-first, so the
// ceiling drops the coldest tail, never the live edge.
const MAX_NODES = 2500;
const TURNS_HOT = 8;
const TURNS_COLD = 1;
const WORK_HOT = 8;
const WORK_COLD = 4;
// `threads.list` is paginated: one page per call, looping until a page comes
// back short (or the hard ceiling stops the walk on hosts with huge thread
// counts). Archived threads stay excluded by the `archived: false` filter.
const THREAD_PAGE = 300;
const THREAD_CEILING = 3000;
const TIMELINE_CONCURRENCY = 4;
const BUILD_MEMO_MS = 750;
const RUNNING_THREAD_STATUSES = new Set(["active", "starting", "pending"]);
/** Threads worth their deep (8-turn) timeline in the shape. */
const ACTIVE_THREAD_STATUSES = new Set(["running", "waiting", "queued", "error"]);
/** Lower = hotter; decides rollup status, sort order and what truncation drops. */
const HEAT: Record<ShapeStatus, number> = {
  running: 0,
  waiting: 1,
  error: 2,
  queued: 3,
  interrupted: 4,
  idle: 5,
  done: 6,
};
const DELTA_EVENTS = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "provider/rateLimits/updated",
  "item/toolCall/progress",
  "item/mcpToolCall/progress",
  "item/backgroundTask/progress",
  "turn/diff/updated",
]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clip(value: string | null, cap: number): string | null {
  if (value === null) return null;
  const flat = value.trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}
function oneLine(value: string | null, cap = 80): string | null {
  return clip(value === null ? null : value.replace(/\s+/g, " "), cap);
}

function rowStatus(row: Row, threadRunning: boolean): ShapeStatus {
  if (row.approvalStatus === "waiting_for_approval") return "waiting";
  switch (row.status) {
    case "completed":
      return "done";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    case "pending":
      return threadRunning ? "running" : "interrupted";
    default:
      return "done";
  }
}

function threadStatus(thread: ThreadDto): ShapeStatus {
  if (thread.hasPendingInteraction) return "waiting";
  if (thread.status === "error") return "error";
  if (RUNNING_THREAD_STATUSES.has(thread.status)) return "running";
  if (thread.queuedWork !== undefined && thread.queuedWork !== "none")
    return "queued";
  return "idle";
}

/** The most useful one-line summary of a tool call's arguments. */
function summarizeArgs(args: unknown): string | null {
  if (args === null || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  for (const key of [
    "description",
    "command",
    "file_path",
    "path",
    "pattern",
    "query",
    "url",
    "prompt",
    "skill",
  ]) {
    const value = str(record[key]);
    if (value !== null) return oneLine(value);
  }
  return null;
}

function workLabel(row: Row): { label: string; sublabel: string | null } {
  const presentation = (row.presentation ?? null) as Row | null;
  const title = str(presentation?.title);
  const detail = str(presentation?.detail);
  switch (row.workKind) {
    case "command":
      return { label: "Bash", sublabel: oneLine(str(row.command)) };
    case "tool":
      return {
        label: str(row.toolName) ?? "Tool",
        sublabel: oneLine(detail ?? title) ?? summarizeArgs(row.toolArgs),
      };
    default: {
      const kind = str(row.workKind) ?? "work";
      const pretty = kind
        .split(/[-_]/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      const hint =
        str(row.path) ??
        str(row.query) ??
        str(row.url) ??
        str(row.description) ??
        str(row.toolName);
      return {
        label: title ?? pretty,
        sublabel: oneLine(detail ?? hint),
      };
    }
  }
}

class ShapeBuilder {
  nodes: ShapeNode[] = [];
  truncated = false;
  /** Thread lookups the lineage decorations read: roster ids and full rows. */
  context = { rosterIds: new Set<string>(), byId: new Map<string, ThreadDto>() };

  add(node: Omit<ShapeNode, "meta"> & { meta?: Record<string, string> }) {
    if (this.nodes.length >= MAX_NODES) {
      this.truncated = true;
      return false;
    }
    this.nodes.push({ meta: {}, ...node });
    return true;
  }

  /** Map a turn's work rows (tool calls, subagents, workflows) under it. */
  addWork(rows: Row[], parentId: string, threadId: string, threadRunning: boolean, workLimit: number) {
    const work = rows.filter((row) => row.kind === "work");
    // Subagents and workflows always stay visible; plain tools keep the
    // newest `workLimit`.
    const keepFrom = Math.max(0, work.length - workLimit);
    const shown = work.filter(
      (row, index) =>
        index >= keepFrom || row.workKind === "delegation" || row.workKind === "workflow",
    );
    const hidden = work.length - shown.length;
    shown.forEach((row, index) => {
      const id = `${threadId}:${str(row.id) ?? `${parentId}:w${index}`}`;
      const base = {
        id,
        parentId,
        kind: "work" as const,
        threadId,
        status: rowStatus(row, threadRunning),
        startedAt: num(row.startedAt),
        completedAt: num(row.completedAt),
        input: clip(
          row.workKind === "command" ? str(row.command) : oneLine(JSON.stringify(row.toolArgs ?? null) ?? null, 300),
          1500,
        ),
        output: clip(str(row.output), 1500),
      };
      if (row.workKind === "delegation") {
        const childRows = Array.isArray(row.childRows) ? (row.childRows as Row[]) : [];
        const childWork = childRows.filter((child) => child.kind === "work");
        const childRunning =
          childWork.some((child) => rowStatus(child, threadRunning) === "running") ||
          (row.background === true && threadRunning);
        // A childRef naming a roster thread ("bb thread spawn" lineage) turns
        // this card into the cross-project jump: threadId points at the
        // spawned thread, so the footer's "open thread" and a double-click
        // land on the child even when it lives under another project.
        const childId = delegationChildId(row.childRef, this.context.rosterIds);
        const child = childId !== null ? this.context.byId.get(childId) : undefined;
        const childTitle = child ? oneLine(child.title ?? child.titleFallback, 72) : null;
        this.add({
          ...base,
          threadId: child?.id ?? threadId,
          status: childRunning ? "running" : base.status,
          label:
            oneLine(str(row.description), 60) ?? str(row.subagentType) ?? "Subagent",
          sublabel: [str(row.subagentType) ?? "Subagent", `${childWork.length} steps`]
            .filter(Boolean)
            .join(" · ") || null,
          meta: {
            type: str(row.subagentType) ?? "",
            ...(childTitle !== null ? { "child thread": childTitle } : {}),
            ...(row.background === true ? { mode: "background" } : {}),
            ...(childWork.at(-1)
              ? { "last step": workLabel(childWork.at(-1)!).label ?? "" }
              : {}),
          },
        });
        return;
      }
      if (row.workKind === "workflow") {
        const usage = (row.usage ?? null) as Row | null;
        this.add({
          ...base,
          status:
            row.taskStatus === "running"
              ? "running"
              : row.taskStatus === "failed" || row.taskStatus === "killed"
                ? "error"
                : base.status,
          label: str(row.workflowName) ?? "Workflow",
          sublabel: oneLine(str(row.description)),
          meta: {
            task: str(row.taskStatus) ?? "",
            ...(num((usage as { totalTokens?: unknown } | null)?.totalTokens) !== null
              ? { tokens: String(num((usage as { totalTokens?: unknown }).totalTokens)) }
              : {}),
          },
        });
        return;
      }
      const { label, sublabel } = workLabel(row);
      this.add({
        ...base,
        label,
        sublabel,
        meta: {
          kind: str(row.workKind) ?? "work",
          ...(num(row.exitCode) !== null ? { exit: String(row.exitCode) } : {}),
        },
      });
    });
    if (hidden > 0) {
      this.add({
        id: `${parentId}:work:more`,
        parentId,
        kind: "more",
        label: `+${hidden} earlier steps`,
        sublabel: null,
        status: "done",
        threadId,
        startedAt: null,
        completedAt: null,
        input: null,
        output: null,
      });
    }
  }

  /** Map a thread's turns (newest `turnLimit`) under its thread node. */
  addTurns(rows: Row[], parentId: string, threadId: string, threadRunning: boolean, turnLimit: number, workLimit: number) {
    // Drop turns with nothing to show (no prompt, steps or reply), such as
    // bookkeeping turns, unless they are still live.
    const turns = normalizeTurns(rows, threadRunning).filter(
      (turn) =>
        turn.status === "pending" ||
        turn.children.some((row) => row.kind === "work" || row.kind === "conversation"),
    );
    const shown = turnLimit <= 0 ? [] : turns.slice(-turnLimit);
    if (turns.length > shown.length) {
      this.add({
        id: `${threadId}:turns:more`,
        parentId,
        kind: "more",
        label: `+${turns.length - shown.length} earlier turns`,
        sublabel: null,
        status: "done",
        threadId,
        startedAt: null,
        completedAt: null,
        input: null,
        output: null,
      });
    }
    shown.forEach((turn, index) => {
      const children = turn.children;
      const conversation = children.filter((row) => row.kind === "conversation");
      const prompt = conversation.find((row) => row.role === "user");
      const reply = [...conversation].reverse().find((row) => row.role === "assistant");
      const id = `${threadId}:turn:${turn.turnId}`;
      const work = children.filter((row) => row.kind === "work");
      const last = work.at(-1);
      const ok = this.add({
        id,
        parentId,
        kind: "turn",
        label:
          oneLine(str(prompt?.text), 60) ??
          // No user prompt: the agent was woken by a notification or event.
          (reply ? "Automatic turn" : `Turn ${turns.length - shown.length + index + 1}`),
        sublabel: `${work.length} step${work.length === 1 ? "" : "s"}`,
        status: rowStatus({ status: turn.status }, threadRunning),
        threadId,
        startedAt: turn.startedAt,
        completedAt: turn.completedAt,
        input: clip(str(prompt?.text), 1500),
        output: clip(str(reply?.text), 1500),
        meta: last
          ? { "last step": workLabel(last).label ?? "" }
          : {},
      });
      if (ok) this.addWork(children, id, threadId, threadRunning, workLimit);
    });
  }
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("activity-overview plugin loaded (flow view served over the shape RPC)");

  // A thread's updatedAt does not move while a turn streams, so it is only
  // a hint: entries are also evicted on every structural thread:changed
  // event, running threads always refetch, and an entry only serves
  // requests for at most as many segments as it holds.
  const timelineCache = new Map<
    string,
    { updatedAt: number; segments: number; rows: Row[] }
  >();
  async function timelineRows(thread: ThreadDto, turns: number): Promise<Row[]> {
    const segments = Math.max(1, turns + 1);
    const cached = timelineCache.get(thread.id);
    if (
      cached &&
      cached.updatedAt === thread.updatedAt &&
      cached.segments >= segments &&
      threadStatus(thread) !== "running"
    ) {
      return cached.rows;
    }
    try {
      const timeline = await bb.sdk.threads.timeline({
        threadId: thread.id,
        includeNestedRows: "true",
        segmentLimit: String(segments),
      });
      const rows = timeline.rows as unknown as Row[];
      timelineCache.delete(thread.id);
      timelineCache.set(thread.id, { updatedAt: thread.updatedAt, segments, rows });
      if (timelineCache.size > 200) {
        const oldest = timelineCache.keys().next().value;
        if (oldest !== undefined) timelineCache.delete(oldest);
      }
      return rows;
    } catch (error) {
      bb.log.warn(`timeline failed for ${thread.id}: ${String(error)}`);
      return [];
    }
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

  /**
   * Every non-archived thread, paged through `threads.list` so hosts with
   * more than one page of threads still get their full roster: loop offsets
   * until a page returns short, or the ceiling stops the walk.
   */
  async function listThreads(): Promise<ThreadDto[]> {
    const threads: ThreadDto[] = [];
    for (
      let offset = 0;
      offset < THREAD_CEILING;
      offset += THREAD_PAGE
    ) {
      const result = await bb.sdk.threads.list({
        archived: false,
        limit: THREAD_PAGE,
        offset,
      });
      const page = (Array.isArray(result) ? result : []) as unknown as ThreadDto[];
      threads.push(...page);
      if (page.length < THREAD_PAGE) return threads;
    }
    return threads;
  }

  /**
   * The full flow shape: root → projects → threads → turns → work, threads
   * sorted hot-first so the node ceiling drops the coldest tail, not the
   * live edge. Threads nested under another thread still hang off their
   * project; the delegation work row already shows the parent linkage.
   */
  async function buildShape(): Promise<Shape> {
    const builder = new ShapeBuilder();
    const [allThreads, projects] = await Promise.all([
      listThreads(),
      bb.sdk.projects
        .list({ includePersonal: true })
        .then(
          (result) =>
            (Array.isArray(result) ? result : []) as Array<{
              id: string;
              name?: string | null;
            }>,
        ),
    ]);
    const projectNames = new Map(
      projects.map((project) => [project.id, project.name ?? project.id]),
    );
    const threadById = new Map(allThreads.map((thread) => [thread.id, thread]));
    builder.context = {
      rosterIds: new Set(threadById.keys()),
      byId: threadById,
    };
    const threads = [...allThreads].sort((a, b) => {
      const byHeat = HEAT[threadStatus(a)] - HEAT[threadStatus(b)];
      return byHeat !== 0 ? byHeat : b.updatedAt - a.updatedAt;
    });
    const rows = await mapLimited(threads, TIMELINE_CONCURRENCY, (thread) =>
      timelineRows(thread, TURNS_HOT),
    );
    const threadRunning = (thread: ThreadDto) =>
      RUNNING_THREAD_STATUSES.has(thread.status);
    builder.add({
      id: "root",
      parentId: null,
      kind: "root",
      label: "Activity",
      sublabel: `${threads.length} thread${threads.length === 1 ? "" : "s"}`,
      status: threads.some((thread) => threadStatus(thread) === "running")
        ? "running"
        : "idle",
      threadId: null,
      startedAt: null,
      completedAt: null,
      input: null,
      output: null,
    });
    for (const projectId of new Set(threads.map((thread) => thread.projectId))) {
      const projectThreads = threads.filter((thread) => thread.projectId === projectId);
      const statuses = projectThreads.map(threadStatus);
      builder.add({
        id: `project:${projectId}`,
        parentId: "root",
        kind: "project",
        label: projectNames.get(projectId) ?? projectId,
        sublabel: `${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}`,
        status:
          statuses.reduce((best, s) => (HEAT[s] < HEAT[best] ? s : best), "idle" as ShapeStatus),
        threadId: null,
        startedAt: null,
        completedAt: null,
        input: null,
        output: null,
      });
    }
    for (let index = 0; index < threads.length; index++) {
      const thread = threads[index]!;
      // Cross-project lineage on the card itself: which project spawned this
      // thread. Same-project families stay unlabeled (the parent's delegation
      // rows show the linkage); a parent outside the roster says so plainly.
      const spawnedBy = spawnHint(
        thread,
        threadById,
        (projectId) => projectNames.get(projectId) ?? null,
      );
      const ok = builder.add({
        id: thread.id,
        parentId: `project:${thread.projectId}`,
        kind: "thread",
        label: oneLine(thread.title ?? thread.titleFallback, 72) ?? "Untitled thread",
        sublabel: null,
        status: threadStatus(thread),
        threadId: thread.id,
        startedAt: thread.createdAt,
        completedAt: null,
        input: null,
        output: null,
        meta: {
          ...(thread.updatedAt ? { updated: String(thread.updatedAt) } : {}),
          ...(spawnedBy !== null ? { "spawned by": spawnedBy } : {}),
        },
      });
      if (ok) {
        const active = ACTIVE_THREAD_STATUSES.has(threadStatus(thread));
        builder.addTurns(
          rows[index]!,
          thread.id,
          thread.id,
          threadRunning(thread),
          active ? TURNS_HOT : TURNS_COLD,
          active ? WORK_HOT : WORK_COLD,
        );
      }
    }
    return {
      nodes: builder.nodes,
      generatedAt: Date.now(),
      truncated: builder.truncated,
    };
  }

  // Every open window asks for the shape on the same realtime signal, so
  // share one in-flight build and reuse the result for a moment after.
  const buildCache = new Map<string, { at: number; promise: Promise<Shape> }>();
  function shapeFor(): Promise<Shape> {
    const cached = buildCache.get("*");
    if (cached && Date.now() - cached.at < BUILD_MEMO_MS) return cached.promise;
    const promise = buildShape();
    buildCache.set("*", { at: Date.now(), promise });
    promise.catch(() => buildCache.delete("*"));
    return promise;
  }

  bb.rpc.register(rpcContract, {
    shape: () => shapeFor(),
  });

  // Live updates: coalesce thread changes and tell open flow views to
  // refetch. Streaming deltas are skipped; item start/complete events carry
  // the structural changes the flow draws.
  const pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      const eventTypes = event.metadata?.eventTypes;
      if (
        eventTypes !== undefined &&
        eventTypes.length > 0 &&
        eventTypes.every((type) => DELTA_EVENTS.has(type))
      ) {
        return;
      }
      if (event.id) {
        timelineCache.delete(event.id);
        buildCache.clear();
        pending.add(event.id);
      }
      flushTimer ??= setTimeout(() => {
        flushTimer = null;
        const threadIds = [...pending];
        pending.clear();
        bb.realtime.publish(SHAPE_CHANGED, { threadIds } satisfies ShapeChangedPayload);
      }, 600);
    },
  });
  bb.onDispose(() => {
    unsubscribe();
    if (flushTimer !== null) clearTimeout(flushTimer);
  });
}
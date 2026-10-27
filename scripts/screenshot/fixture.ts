/**
 * Simulated host data for the screenshot/UAT harness: a small but real-looking
 * sidebar (two projects, three threads) and a Shape the `shape` RPC returns.
 *
 * Fields mirror what views/Views.tsx and views/model.ts read: threads carry
 * id/projectId/title/titleFallback/status/updatedAt, projects carry id/name,
 * and the Shape is the flat node tree from server.ts's `shapeSchema`.
 */

export interface SimThread {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string;
  status: string;
  parentThreadId: string | null;
  updatedAt: number;
  createdAt: number;
  isPinned?: boolean;
  /** Set on the demo fixture's needs-you threads (classify reads it first). */
  hasPendingInteraction?: boolean;
  /** Set on the demo fixture's unread threads (classify reads it last). */
  isUnread?: boolean;
}

const NOW = 1760000000000;

export const SIM_PROJECTS: readonly { id: string; name: string }[] = [
  { id: "proj_alpha", name: "Alpha work" },
  { id: "proj_beta", name: "Beta infra" },
];

export const SIM_THREADS: readonly SimThread[] = [
  {
    id: "thr_running",
    projectId: "proj_alpha",
    title: "Refactor the export path",
    titleFallback: "New thread",
    status: "active",
    parentThreadId: null,
    updatedAt: NOW - 60_000,
    createdAt: NOW - 600_000,
  },
  {
    id: "thr_error",
    projectId: "proj_alpha",
    title: "Fix flaky importer test",
    titleFallback: "New thread",
    status: "error",
    parentThreadId: null,
    updatedAt: NOW - 120_000,
    createdAt: NOW - 900_000,
  },
  {
    // A second working thread, deliberately 10× slower than thr_running: the
    // hover/pulse UAT asserts a real 10× period contrast in the DOM, which
    // needs two units that pulse at different rates.
    id: "thr_running_slow",
    projectId: "proj_beta",
    title: "Audit the migration notes",
    titleFallback: "New thread",
    status: "active",
    parentThreadId: null,
    updatedAt: NOW - 240_000,
    createdAt: NOW - 1_200_000,
  },
  {
    id: "thr_idle",
    projectId: "proj_beta",
    title: null,
    titleFallback: "Housekeeping",
    status: "idle",
    parentThreadId: null,
    updatedAt: NOW - 7200_000,
    createdAt: NOW - 9000_000,
  },
];

/**
 * The demo fixture (`?demo=1`): extra projects whose threads carry the statuses
 * the base fixture never shows — needs-you (a pending interaction), unread, and
 * nested children/grandchildren — so the store screenshots and the hero GIF show
 * every dot hue at a realistic density. Appended on top of the base set; UAT
 * suites never set the flag and keep their assertions pinned to the base four
 * threads.
 */
const demoThread = (
  over: Pick<SimThread, "id" | "projectId" | "title" | "status"> &
    Partial<SimThread>,
): SimThread => ({
  titleFallback: "New thread",
  parentThreadId: null,
  updatedAt: NOW - 90_000,
  createdAt: NOW - 700_000,
  ...over,
});

export const SIM_DEMO_PROJECTS: readonly { id: string; name: string }[] = [
  { id: "proj_gamma", name: "Gamma archive" },
  { id: "proj_delta", name: "Delta redesign" },
  { id: "proj_epsilon", name: "Epsilon docs" },
  { id: "proj_zeta", name: "Design system" },
  { id: "proj_eta", name: "Platform services" },
  { id: "proj_theta", name: "Data pipeline" },
  { id: "proj_iota", name: "Mobile shell" },
];

/**
 * Bulk projects so the aggregate views read like a long-lived workspace rather
 * than a demo of five. Generated (never hand-listed) so the fixture stays
 * small and deterministic; statuses cycle through a fixed pattern so every
 * view shows all five hues at a realistic density.
 */
const BULK: readonly { id: string; name: string; count: number }[] = [
  { id: "proj_zeta", name: "Design system", count: 14 },
  { id: "proj_eta", name: "Platform services", count: 20 },
  { id: "proj_theta", name: "Data pipeline", count: 10 },
  { id: "proj_iota", name: "Mobile shell", count: 7 },
];
const BULK_STATUS = ["active", "active", "idle", "idle", "error", "active", "idle"] as const;

const bulkThreads: SimThread[] = BULK.flatMap((project) =>
  Array.from({ length: project.count }, (_, i) =>
    demoThread({
      id: `thr_bulk_${project.id}_${i}`,
      projectId: project.id,
      title: `${project.name} task ${i + 1}`,
      status: BULK_STATUS[i % BULK_STATUS.length],
      updatedAt: NOW - (i + 1) * 60_000,
      isUnread: i % 7 === 3,
      hasPendingInteraction: i % 9 === 5,
    }),
  ),
);

export const SIM_DEMO_THREADS: readonly SimThread[] = [
  // Gamma archive — quiet after a burst; one error and one stuck watcher.
  demoThread({ id: "thr_demo_err", projectId: "proj_gamma", title: "Nightly export crashed", status: "error", updatedAt: NOW - 300_000 }),
  demoThread({ id: "thr_demo_watch", projectId: "proj_gamma", title: "Watch the backup rotation", status: "idle", updatedAt: NOW - 5_400_000 }),
  demoThread({ id: "thr_demo_old", projectId: "proj_gamma", title: "Retire the v1 importer", status: "idle", updatedAt: NOW - 86_400_000 }),
  demoThread({ id: "thr_demo_arch", projectId: "proj_gamma", title: null, status: "idle", updatedAt: NOW - 172_800_000 }),

  // Delta redesign — the active family: a working parent with a nested child
  // and grandchild, plus a needs-you sibling waiting on the operator.
  demoThread({ id: "thr_demo_des", projectId: "proj_delta", title: "Redesign the settings pane", status: "active", updatedAt: NOW - 45_000 }),
  demoThread({ id: "thr_demo_des_c1", projectId: "proj_delta", title: "Wire the new toggles", status: "active", parentThreadId: "thr_demo_des", updatedAt: NOW - 30_000 }),
  demoThread({ id: "thr_demo_des_c2", projectId: "proj_delta", title: "Snapshot the layout", status: "active", parentThreadId: "thr_demo_des", updatedAt: NOW - 120_000 }),
  demoThread({ id: "thr_demo_des_g1", projectId: "proj_delta", title: "Bump the icon set", status: "idle", parentThreadId: "thr_demo_des_c1", updatedAt: NOW - 400_000 }),
  demoThread({ id: "thr_demo_ask", projectId: "proj_delta", title: "Approve the new palette", status: "active", hasPendingInteraction: true, updatedAt: NOW - 20_000 }),
  demoThread({ id: "thr_demo_ask2", projectId: "proj_delta", title: "Pick a default font", status: "idle", hasPendingInteraction: true, updatedAt: NOW - 260_000 }),

  // Epsilon docs — unread handoffs and a fresh idle thread.
  demoThread({ id: "thr_demo_unread", projectId: "proj_epsilon", title: "Review the migration guide", status: "idle", isUnread: true, updatedAt: NOW - 180_000 }),
  demoThread({ id: "thr_demo_unread2", projectId: "proj_epsilon", title: "Reply to the API notes", status: "idle", isUnread: true, updatedAt: NOW - 600_000 }),
  demoThread({ id: "thr_demo_pin", projectId: "proj_epsilon", title: "Tracked: release checklist", status: "idle", isPinned: true, updatedAt: NOW - 900_000 }),
  demoThread({ id: "thr_demo_fresh", projectId: "proj_epsilon", title: "Draft the changelog intro", status: "active", updatedAt: NOW - 8_000 }),

  // The generated bulk families, so the board, treemap, and tiles fill.
  ...bulkThreads,
];

/** A small Shape: root → 2 projects → threads → turns → work. */
export const SIM_SHAPE: {
  nodes: {
    id: string;
    parentId: string | null;
    kind: string;
    label: string;
    sublabel: string | null;
    status: string;
    threadId: string | null;
    startedAt: number | null;
    completedAt: number | null;
    input: string | null;
    output: string | null;
    meta: Record<string, string>;
  }[];
  generatedAt: number;
  truncated: boolean;
} = {
  generatedAt: NOW,
  truncated: false,
  nodes: [
    { id: "root", parentId: null, kind: "root", label: "All activity", sublabel: null, status: "idle", threadId: null, startedAt: null, completedAt: null, input: null, output: null, meta: {} },
    { id: "n:proj_alpha", parentId: "root", kind: "project", label: "Alpha work", sublabel: null, status: "running", threadId: null, startedAt: null, completedAt: null, input: null, output: null, meta: {} },
    { id: "n:thr_running", parentId: "n:proj_alpha", kind: "thread", label: "Refactor the export path", sublabel: null, status: "running", threadId: "thr_running", startedAt: NOW - 600_000, completedAt: null, input: null, output: null, meta: {} },
    { id: "t:thr_running:1", parentId: "n:thr_running", kind: "turn", label: "Turn 1", sublabel: null, status: "done", threadId: "thr_running", startedAt: NOW - 500_000, completedAt: NOW - 480_000, input: "Move the export helper into lib/", output: "Moved and re-exported.", meta: {} },
    { id: "w:t1:1", parentId: "t:thr_running:1", kind: "work", label: "lib/export.ts", sublabel: "edit", status: "done", threadId: "thr_running", startedAt: NOW - 495_000, completedAt: NOW - 490_000, input: null, output: null, meta: {} },
    { id: "t:thr_running:2", parentId: "n:thr_running", kind: "turn", label: "Turn 2", sublabel: null, status: "running", threadId: "thr_running", startedAt: NOW - 300_000, completedAt: null, input: "Now update the callers", output: null, meta: {} },
    { id: "w:t2:1", parentId: "t:thr_running:2", kind: "work", label: "cli.ts", sublabel: "edit", status: "running", threadId: "thr_running", startedAt: NOW - 295_000, completedAt: null, input: null, output: null, meta: {} },
    { id: "n:thr_error", parentId: "n:proj_alpha", kind: "thread", label: "Fix flaky importer test", sublabel: null, status: "error", threadId: "thr_error", startedAt: NOW - 900_000, completedAt: NOW - 120_000, input: null, output: null, meta: {} },
    { id: "t:thr_error:1", parentId: "n:thr_error", kind: "turn", label: "Turn 1", sublabel: null, status: "error", threadId: "thr_error", startedAt: NOW - 800_000, completedAt: NOW - 120_000, input: "Stop the flake", output: "Timed out waiting for fixture.", meta: {} },
    { id: "n:proj_beta", parentId: "root", kind: "project", label: "Beta infra", sublabel: null, status: "idle", threadId: null, startedAt: null, completedAt: null, input: null, output: null, meta: {} },
    { id: "n:thr_idle", parentId: "n:proj_beta", kind: "thread", label: "Housekeeping", sublabel: null, status: "idle", threadId: "thr_idle", startedAt: null, completedAt: null, input: null, output: null, meta: {} },
  ],
};

/**
 * How long the mock `shape` RPC stalls before resolving, in milliseconds —
 * from the harness URL's ?shapeDelay= (default 0). The throbber UAT uses a
 * 2000ms delay to widen the loading window enough to assert against.
 */
export const SHAPE_DELAY_MS = Math.max(
  0,
  Number(new URLSearchParams(window.location.search).get("shapeDelay") ?? "0") || 0,
);

/**
 * Simulated `flow` RPC payload for the screenshot/UAT harness: the swimlane
 * token-flow fixture. Three projects — Alpha work opens by default (it holds
 * the runaway thread plus enough working threads to overflow the Working lane,
 * so the suite can assert independent lane scrolling), Beta infra and Gamma
 * archive stay collapsed. Gamma exists to discriminate the stack's activity
 * sort: it stores the most tokens by far but burns nothing and its threads
 * went quiet hours ago, so an activity-first stack must rank it last (a
 * tokens-first stack would have led with it). Every thread carries a 20-bucket
 * burn series so the rivers and the row sparkline have real shapes.
 */
const FLOW_BUCKETS = 20;
const burn = (peak: number, shape: "ramp" | "steady" | "burst"): number[] =>
  Array.from({ length: FLOW_BUCKETS }, (_, i) => {
    const u = i / (FLOW_BUCKETS - 1);
    const v =
      shape === "ramp"
        ? 0.12 + 0.88 * u ** 1.5
        : shape === "burst"
          ? u < 0.62
            ? 0.12
            : 0.12 + 3.4 * ((u - 0.62) / 0.38) ** 1.3
          : 0.85;
    return Math.max(0, Math.round(peak * v));
  });

type FlowThreadFixture = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  parentThreadId: string | null;
  createdAt: number;
  updatedAt: number;
  usedTokens: number;
  modelContextWindow: number;
  model: string | null;
  provider: string;
  agentProvider: string;
  rate: number;
  tracked: number;
  series: number[];
};

const flowThread = (over: Partial<FlowThreadFixture> & { id: string; usedTokens: number }): FlowThreadFixture => ({
  projectId: "proj_alpha",
  projectName: "Alpha work",
  title: over.id,
  status: "running",
  parentThreadId: null,
  createdAt: NOW - 600_000,
  updatedAt: NOW - 60_000,
  modelContextWindow: 200_000,
  model: "synthetic/hf:zai-org/GLM-5.3-Flash",
  provider: "anthropic",
  agentProvider: "acp-opencode",
  rate: 0,
  tracked: 0,
  series: burn(Math.max(20, over.rate ?? 40), "steady"),
  ...over,
});

export const SIM_FLOW = {
  windowMs: 3_600_000,
  buckets: FLOW_BUCKETS,
  generatedAt: NOW,
  truncated: false,
  threads: [
    // Alpha work — the runaway thread with a contained child and grandchild.
    flowThread({ id: "thr_running", title: "Refactor the export path", usedTokens: 24_600, rate: 264, series: burn(320, "ramp") }),
    flowThread({ id: "thr_running_child", title: "layout regression sweep", usedTokens: 11_400, rate: 172, parentThreadId: "thr_running", createdAt: NOW - 400_000, model: "ollama-cloud/glm-5.3-flash" }),
    flowThread({ id: "thr_running_grand", title: "pixel snapshot pass", usedTokens: 5_200, rate: 60, parentThreadId: "thr_running_child", provider: "google", createdAt: NOW - 300_000, agentProvider: "codex", model: "gpt-6-luna" }),
    // More working threads, so the lane overflows its capped height.
    flowThread({ id: "thr_run_b", title: "backup script review", usedTokens: 8_800, rate: 90, provider: "openai", agentProvider: "codex", model: "gpt-6-luna" }),
    flowThread({ id: "thr_run_c", title: "nightly sync sweep", usedTokens: 7_100, rate: 44, provider: "google", agentProvider: "claude-code", model: "claude-sonnet-5.5" }),
    flowThread({ id: "thr_run_d", title: "cache warm pass", usedTokens: 6_200, rate: 30, provider: "ollama", agentProvider: "pi", model: "pi" }),
    flowThread({ id: "thr_run_e", title: "index rebuild", usedTokens: 5_400, rate: 20, provider: "openai", agentProvider: "codex", model: "gpt-6-luna" }),
    flowThread({ id: "thr_run_f", title: "log tail probe", usedTokens: 4_100, rate: 12, provider: "anthropic", model: "synthetic/syn:small:text" }),
    // A running thread that is barely burning: its rate is below one whole
    // token per minute, which used to render as the misleading "0 tok/min".
    // It heads a group so the quiet label's "quiet · N total" form is on screen.
    flowThread({ id: "thr_trickle", title: "trace tail probe", usedTokens: 2_400, rate: 0.004, provider: "anthropic", model: "synthetic/syn:small:text" }),
    flowThread({ id: "thr_trickle_sub", title: "trace tail sub-sweep", usedTokens: 900, rate: 0, parentThreadId: "thr_trickle", provider: "anthropic", model: "synthetic/syn:small:text" }),
    // The other three lanes.
    flowThread({ id: "thr_error", title: "Fix flaky importer test", status: "error", usedTokens: 31_500, provider: "google", agentProvider: "claude-code", model: "claude-sonnet-5.5", rate: 0, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    flowThread({ id: "thr_done", title: "treemap label layer", status: "done", usedTokens: 12_400, rate: 0, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    flowThread({ id: "thr_idle", title: "legend chips", status: "idle", usedTokens: 3_100, provider: "openai", agentProvider: "codex", model: "gpt-6-luna", rate: 0, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    // A waiting supervisor whose running child must surface in the Working lane
    // rather than hiding nested inside the parent's card — the real-world shape
    // (an orchestrator waiting on the operator, with running threads beneath it)
    // that first broke the view.
    flowThread({ id: "thr_supervisor", title: "Workstation orchestrator", status: "waiting", usedTokens: 20_000, provider: "anthropic", rate: 0, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    flowThread({ id: "thr_supervisor_child", title: "Sashay: agents charter readability", status: "running", usedTokens: 9_000, rate: 120, parentThreadId: "thr_supervisor", provider: "openai", model: "cove/text:standard" }),
    // Beta infra — stays collapsed by default.
    flowThread({ id: "thr_running_slow", projectId: "proj_beta", projectName: "Beta infra", title: "Audit the migration notes", usedTokens: 38_200, rate: 60, provider: "openai", agentProvider: "codex", model: "gpt-6-luna" }),
    flowThread({ id: "thr_wait", projectId: "proj_beta", projectName: "Beta infra", title: "card tween", status: "waiting", usedTokens: 9_600, provider: "anthropic", agentProvider: "claude-code", model: "claude-sonnet-5.5", rate: 0, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    // Gamma archive — the activity sort's discriminator: the largest stored
    // total on the board, no measurable rate, threads quiet for hours. Under
    // the activity-first stack it ranks last; under a tokens-first stack it
    // would have led.
    flowThread({ id: "thr_archive_a", projectId: "proj_gamma", projectName: "Gamma archive", title: "old sweep one", status: "idle", usedTokens: 400_000, rate: 0, updatedAt: NOW - 7200_000, createdAt: NOW - 9000_000, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
    flowThread({ id: "thr_archive_b", projectId: "proj_gamma", projectName: "Gamma archive", title: "old sweep two", status: "idle", usedTokens: 120_000, rate: 0, updatedAt: NOW - 8000_000, createdAt: NOW - 9500_000, series: new Array<number>(FLOW_BUCKETS).fill(0) }),
  ],
};
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
// Hover card for a status dot: the thread's full title plus a snippet from the
// end of its conversation, so the card orients the operator on what the thread
// is and what it was last doing.
//
// The card replaces the browser tooltip on every unit (board dots, treemap
// dots, strip units). It lives in a portal on the panel root rather than inside
// the map canvas's scaled world layer, because that layer is transformed by the
// camera — a card drawn inside it would zoom with the board and be clipped by
// neighbouring cards' overflow. Placement is pure math (hoverCardPlacement in
// views/model.ts), so the geometry is tested without a browser.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "../lib/portal-scope";
import { hoverCardPlacement, type CardPlacement } from "./model";
import type { rpcContract } from "../server";

/** The snippet the backend resolved for one thread (null: no usable history). */
export type CardSnippet = { role: "user" | "assistant"; text: string } | null;

/** The dot the pointer is over, in panel coordinates. */
export type HoverTarget = {
  threadId: string;
  title: string;
  /** Dot rect relative to the panel root, plus the dot's on-screen size. */
  x: number;
  y: number;
  w: number;
  h: number;
};

const CARD_W = 300;
/** Space the card leaves around the dot it belongs to. */
const CARD_GAP = 8;

/**
 * The hover card itself. It renders into the panel root through a portal, so
 * the map camera never scales it and no parent's overflow can clip it.
 *
 * `snippet` is deliberately tri-state: `undefined` means "still loading",
 * `null` means "this thread has no conversation to quote", and an object is
 * the resolved text. Loading and absence render differently, so the card never
 * claims a thread is empty while the answer is still in flight.
 */
export function ThreadHoverCard({
  target,
  snippet,
  status,
  age,
  panel,
  root,
}: {
  target: HoverTarget;
  snippet: CardSnippet | undefined;
  status: string;
  age: string;
  /** Panel size in CSS px, the box the card must stay inside. */
  panel: { w: number; h: number };
  /** The panel root element the card portals into. */
  root: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: CARD_W, h: 0 });
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  const portalScope = usePortalScopeProps();

  // Measure the card, then seat it. A layout effect runs before paint, so the
  // card never flashes at a guessed position.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const h = el.offsetHeight;
    if (h > 0 && h !== size.h) setSize({ w: CARD_W, h });
    const next = hoverCardPlacement(
      { x: target.x, y: target.y, w: target.w, h: target.h },
      { w: CARD_W, h },
      panel,
      CARD_GAP,
    );
    setPlacement(next);
  }, [target.x, target.y, target.w, target.h, panel.w, panel.h, size.h, snippet]);

  if (root === null) return null;
  return createPortal(
    <div
      ref={ref}
      data-attn-hover-card=""
      data-thread-id={target.threadId}
      role="tooltip"
      {...portalScope}
      style={{
        position: "absolute",
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        width: CARD_W,
        // Border-box so the painted width IS CARD_W: hoverCardPlacement clamps
        // against the card's size constant, and a content-box card would overhang
        // the panel by its padding (24px) + border (2px) whenever it is pushed
        // to the right edge.
        boxSizing: "border-box",
        // Invisible until seated: never a one-frame flash at 0,0.
        visibility: placement === null ? "hidden" : "visible",
        zIndex: 60,
        pointerEvents: "none",
        background: "var(--attn-card)",
        color: "var(--attn-emph)",
        border: "1px solid var(--attn-card-border)",
        borderRadius: 8,
        boxShadow: "0 6px 20px rgb(0 0 0 / 0.18)",
        padding: "10px 12px",
      }}
    >
      <div
        data-attn-hover-title=""
        style={{
          fontSize: 12,
          fontWeight: 600,
          lineHeight: "16px",
          // The full title: wrapped, never truncated, so a long thread name is
          // readable in the one place that exists to disambiguate threads.
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {target.title}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          letterSpacing: "0.01em",
          color: "var(--attn-label)",
        }}
      >
        {status} · {age}
      </div>
      <SnippetBlock snippet={snippet} />
    </div>,
    root,
  );
}

/** The end-of-conversation snippet, with honest empty and loading states. */
function SnippetBlock({ snippet }: { snippet: CardSnippet | undefined }) {
  if (snippet === undefined) {
    return (
      <div
        data-attn-hover-snippet="loading"
        style={{ marginTop: 6, fontSize: 11, color: "var(--attn-dim)" }}
      >
        …
      </div>
    );
  }
  if (snippet === null) {
    return (
      <div
        data-attn-hover-snippet="empty"
        style={{ marginTop: 6, fontSize: 11, color: "var(--attn-dim)", fontStyle: "italic" }}
      >
        No conversation yet
      </div>
    );
  }
  return (
    <div data-attn-hover-snippet={snippet.role} style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10, color: "var(--attn-label)" }}>
        {snippet.role === "assistant" ? "Last from the agent" : "Last from you"}
      </div>
      <div
        style={{
          marginTop: 2,
          fontSize: 11,
          lineHeight: "15px",
          color: "var(--attn-dim)",
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {snippet.text}
      </div>
    </div>
  );
}

/**
 * Resolve snippets on demand, one fetch per thread and kept for the session.
 *
 * Hovering is a reading gesture, so the cache never refetches a viewed thread:
 * the card is there to orient, not to track. A failed fetch is remembered too,
 * so a thread with no outline does not retry on every pointer pass; the card
 * simply shows no snippet.
 */
export function useCardSnippets(): {
  snippets: ReadonlyMap<string, CardSnippet>;
  request: (threadId: string) => void;
} {
  const rpc = useRpc<typeof rpcContract>();
  const [snippets, setSnippets] = useState<ReadonlyMap<string, CardSnippet>>(() => new Map());
  /** Threads already asked for (resolved or in flight). */
  const asked = useRef<Set<string>>(new Set());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const request = (threadId: string) => {
    if (asked.current.has(threadId)) return;
    asked.current.add(threadId);
    rpc
      .call("threadCard", { threadId })
      .then(
        (result) => {
          if (!live.current) return;
          setSnippets((prev) => {
            const next = new Map(prev);
            next.set(threadId, result.snippet);
            return next;
          });
        },
        () => {
          if (!live.current) return;
          // A failed lookup has nothing honest to show; remember it as empty so
          // the hover does not retry, and do not surface an error mid-hover.
          setSnippets((prev) => {
            const next = new Map(prev);
            next.set(threadId, null);
            return next;
          });
        },
      );
  };

  return { snippets, request };
}

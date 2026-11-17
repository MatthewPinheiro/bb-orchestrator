// The Orchestrator page as panes (layout.ts holds the rules). Each pane has its own tabs (affectUI's segmented control,
// scrolling sideways when they don't fit), split right, split down and close. Dividers drag to resize. Each pane scrolls on
// its own. A phone-width page shows only the focused pane.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { SegmentedControl } from "./affect/segmented-control-clean.tsx";
import { MAX_PANES, panes, type Layout, type Node, type Pane } from "./layout.ts";
import { Btn, cx } from "./ui.tsx";

export type ViewDef = { id: string; label: string; count?: number | string };

export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * The tab's own width. Observed through a callback ref: the tab first renders its loading state without this element,
 * so an effect keyed on a ref object would never see it, and narrow-panel items (Ask for status, Start lead in ⋯) never showed.
 */
export function useElementWidth(): [number, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [w, setEl];
}

type Props = {
  layout: Layout;
  views: ViewDef[];
  /** A phone-width page: only the focused pane, no splitting */
  compact: boolean;
  render: (view: string, pane: { id: string; width: number }) => ReactNode;
  /** Views that fill the pane themselves (the chat): no padding, no page scroll */
  fill: (view: string) => boolean;
  /** Views that use the pane's whole width (Projects, layout B: the list beside the project), not the reading column */
  wide?: (view: string) => boolean;
  onView: (paneId: string, view: string) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, dir: "row" | "col") => void;
  onClose: (paneId: string) => void;
  onResize: (splitId: string, index: number, delta: number) => void;
};

export function PaneLayout(p: Props) {
  const all = panes(p.layout.root);
  if (p.compact) {
    const f = all.find((x) => x.id === p.layout.focus) ?? all[0]!;
    return <PaneView pane={f} {...p} many={false} canSplit={false} />;
  }
  return <NodeView node={p.layout.root} {...p} many={all.length > 1} canSplit={all.length < MAX_PANES} />;
}

type Inner = Props & { many: boolean; canSplit: boolean };

function NodeView({ node, ...p }: Inner & { node: Node }) {
  const box = useRef<HTMLDivElement>(null);
  if (node.kind === "pane") return <PaneView pane={node} {...p} />;
  const row = node.dir === "row";
  return (
    <div ref={box} data-split={node.id} className={cx("flex h-full min-h-0 w-full min-w-0", row ? "flex-row" : "flex-col")}>
      {node.children.map((c, i) => (
        <div key={c.id} className="contents">
          <div className="flex min-h-0 min-w-0" style={{ flex: `${node.sizes[i]} 1 0` }}>
            <NodeView node={c} {...p} />
          </div>
          {i < node.children.length - 1 ? <Divider row={row} box={box} onMove={(d) => p.onResize(node.id, i, d)} /> : null}
        </div>
      ))}
    </div>
  );
}

/** A divider: drag to move the room between its two neighbours (the move is a share of the whole split). */
function Divider({ row, box, onMove }: { row: boolean; box: RefObject<HTMLDivElement | null>; onMove: (delta: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      data-divider=""
      className={cx("orch-divider", row ? "orch-divider--row" : "orch-divider--col")}
      onPointerDown={(e) => {
        const el = box.current;
        if (!el) return;
        e.preventDefault();
        const size = row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height;
        let last = row ? e.clientX : e.clientY;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
          const now = row ? ev.clientX : ev.clientY;
          if (size > 0 && now !== last) onMove((now - last) / size);
          last = now;
        };
        const up = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", up);
          target.removeEventListener("pointercancel", up);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
        target.addEventListener("pointercancel", up);
      }}
    />
  );
}

const SplitRight = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M8 2.5v11" />
  </svg>
);
const SplitDown = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <path d="M2 8h12" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
    <path d="m4.5 4.5 7 7m0-7-7 7" />
  </svg>
);

function PaneView({ pane, views, render, fill, wide, onView, onFocus, onSplit, onClose, layout, many, canSplit }: Inner & { pane: Pane }) {
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref);
  const focused = layout.focus === pane.id;
  const fills = fill(pane.view);
  const column = wide?.(pane.view) ? "w-full" : "mx-auto w-full max-w-3xl";
  return (
    <section
      ref={ref}
      data-pane={pane.id}
      data-pane-view={pane.view}
      data-focused={focused || undefined}
      className={cx("orch-pane flex min-h-0 min-w-0 flex-1 flex-col", many && "orch-pane--framed")}
      onPointerDownCapture={() => {
        if (!focused) onFocus(pane.id);
      }}
    >
      <header className={cx("flex shrink-0 items-center gap-1", many ? "px-2 pt-2" : `${column} px-4 pt-4`)}>
        <div className="min-w-0 flex-1">
          <SegmentedControl kind="tabs" variant="tray" size="sm" value={pane.view} options={views.map((v) => ({ value: v.id, label: v.label, count: v.count }))} onChange={(id) => onView(pane.id, id)} />
        </div>
        {canSplit ? (
          <>
            <Btn tone="ghost" aria-label="Split right" title="Split right" data-split-right="" onClick={() => onSplit(pane.id, "row")}>
              <SplitRight />
            </Btn>
            <Btn tone="ghost" aria-label="Split down" title="Split down" data-split-down="" onClick={() => onSplit(pane.id, "col")}>
              <SplitDown />
            </Btn>
          </>
        ) : null}
        {many ? (
          <Btn tone="ghost" aria-label="Close pane" title="Close pane" data-close-pane="" onClick={() => onClose(pane.id)}>
            <CloseIcon />
          </Btn>
        ) : null}
      </header>
      {fills ? (
        <div className="flex min-h-0 flex-1 flex-col pt-2">{render(pane.view, { id: pane.id, width })}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={cx(column, "pb-8", many ? "px-3 pt-3" : "px-4 pt-4")}>{render(pane.view, { id: pane.id, width })}</div>
        </div>
      )}
    </section>
  );
}

export const paneCss = /* css */ `
[data-orch] .orch-pane--framed { margin: 4px; border-radius: 10px; box-shadow: 0 0 0 0.5px var(--orch-line); }
[data-orch] .orch-pane--framed[data-focused] { box-shadow: 0 0 0 1px light-dark(rgba(0, 0, 0, 0.16), rgba(255, 255, 255, 0.22)); }
[data-orch] .orch-divider { flex: none; position: relative; touch-action: none; }
[data-orch] .orch-divider--row { width: 6px; cursor: col-resize; }
[data-orch] .orch-divider--col { height: 6px; cursor: row-resize; }
[data-orch] .orch-divider::after { content: ""; position: absolute; border-radius: 2px; background: transparent; transition: background-color 120ms ease; }
[data-orch] .orch-divider--row::after { inset: 8px 2px; }
[data-orch] .orch-divider--col::after { inset: 2px 8px; }
[data-orch] .orch-divider:hover::after, [data-orch] .orch-divider:active::after { background: light-dark(rgba(0, 0, 0, 0.16), rgba(255, 255, 255, 0.22)); }
`;

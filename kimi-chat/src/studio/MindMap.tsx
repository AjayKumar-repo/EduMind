import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, Download, Loader2, Maximize2, Minus, Network, Plus, RefreshCw } from "lucide-react";
import { docsKey, generateMindMap, MindMapNode, store } from "../api";
import "./studio.css";

type Props = { documents: string[] };

type Laid = {
  id: string;
  node: MindMapNode;
  depth: number;
  branch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parent?: Laid;
  hasChildren: boolean;
  collapsed: boolean;
};

const BRANCH_COLORS = ["#4361ee", "#0f9d8a", "#d97706", "#db2777", "#7c3aed", "#0284c7", "#65a30d"];
const FONT = "600 13px Montserrat, system-ui, sans-serif";
const ROOT_FONT = "700 15px Montserrat, system-ui, sans-serif";
const ROW = 44;
const COL_GAP = 64;

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7.5;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

const clip = (s: string, max = 38) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function layout(root: MindMapNode, collapsed: Set<string>): Laid[] {
  const nodes: Laid[] = [];
  const colWidth: number[] = [];

  const build = (node: MindMapNode, id: string, depth: number, branch: number, parent?: Laid): Laid => {
    const label = clip(node.title, depth === 0 ? 44 : 38);
    const w = Math.ceil(textWidth(label, depth === 0 ? ROOT_FONT : FONT)) + (depth === 0 ? 40 : 30) + (node.children.length ? 18 : 0);
    const laid: Laid = {
      id, node, depth, branch, x: 0, y: 0, w, h: depth === 0 ? 44 : 34, parent,
      hasChildren: node.children.length > 0, collapsed: collapsed.has(id),
    };
    colWidth[depth] = Math.max(colWidth[depth] ?? 0, w);
    nodes.push(laid);
    if (!laid.collapsed) {
      node.children.forEach((child, i) => build(child, `${id}.${i}`, depth + 1, depth === 0 ? i : branch, laid));
    }
    return laid;
  };
  const rootLaid = build(root, "0", 0, 0);

  // x: columns by depth; y: leaves in order, parents centred on their children.
  const colX: number[] = [];
  colWidth.forEach((_, d) => {
    colX[d] = d === 0 ? 0 : colX[d - 1] + colWidth[d - 1] + COL_GAP;
  });
  let nextRow = 0;
  const place = (n: Laid): number => {
    n.x = colX[n.depth];
    const kids = nodes.filter((c) => c.parent === n);
    if (kids.length === 0) {
      n.y = nextRow * ROW;
      nextRow += 1;
    } else {
      const ys = kids.map(place);
      n.y = (ys[0] + ys[ys.length - 1]) / 2;
      // Leave a little air between main branches.
      if (n.depth === 1) nextRow += 0.35;
    }
    return n.y;
  };
  place(rootLaid);
  return nodes;
}

const countNodes = (n: MindMapNode): number => 1 + n.children.reduce((s, c) => s + countNodes(c), 0);

// Big maps open with only the main branches showing, so the first view stays readable.
function initialCollapsed(tree: MindMapNode | null): Set<string> {
  if (!tree || countNodes(tree) <= 22) return new Set();
  return new Set(tree.children.map((c, i) => (c.children.length ? `0.${i}` : "")).filter(Boolean));
}

const MindMap: React.FC<Props> = ({ documents }) => {
  const cacheKey = docsKey("mindMap", documents);
  const [tree, setTree] = useState<MindMapNode | null>(() => store.get<MindMapNode>(cacheKey));
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => initialCollapsed(store.get<MindMapNode>(cacheKey)));
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 40, y: 0, k: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const cached = store.get<MindMapNode>(cacheKey);
    setTree(cached);
    setCollapsed(initialCollapsed(cached));
    setSelected(null);
  }, [cacheKey]);

  const nodes = useMemo(() => (tree ? layout(tree, collapsed) : []), [tree, collapsed]);
  const bounds = useMemo(() => {
    if (!nodes.length) return { minY: 0, maxY: 0, maxX: 0 };
    return {
      minY: Math.min(...nodes.map((n) => n.y - n.h / 2)),
      maxY: Math.max(...nodes.map((n) => n.y + n.h / 2)),
      maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    };
  }, [nodes]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !nodes.length) return;
    const pad = 32;
    const width = bounds.maxX;
    const height = bounds.maxY - bounds.minY;
    const k = Math.min(1.15, (el.clientWidth - pad * 2) / width, (el.clientHeight - pad * 2) / height);
    setView({
      k,
      x: (el.clientWidth - width * k) / 2,
      y: (el.clientHeight - height * k) / 2 - bounds.minY * k,
    });
  }, [bounds, nodes.length]);

  // Fit when a map first appears or its shape changes a lot.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // Re-fit when the canvas changes size (window resize, side panels opening).
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = `${el.clientWidth}x${el.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size !== last) {
        last = size;
        fitRef.current();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [tree]);

  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const px = cx ?? el.clientWidth / 2;
    const py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const k = Math.max(0.3, Math.min(2.5, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    if (drag.current && !drag.current.moved) setSelected(null);
    drag.current = null;
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Re-fit after the visible tree changes shape from Expand / Collapse.
  const refit = useRef(false);
  useLayoutEffect(() => {
    if (refit.current) {
      refit.current = false;
      fit();
    }
  }, [nodes, fit]);

  const collapseToBranches = () => {
    if (!tree) return;
    refit.current = true;
    setCollapsed(new Set(tree.children.map((c, i) => (c.children.length ? `0.${i}` : "")).filter(Boolean)));
  };
  const expandAll = () => {
    refit.current = true;
    setCollapsed(new Set());
  };

  const generate = async () => {
    setStatus("loading");
    setError("");
    try {
      const result = await generateMindMap(documents);
      setTree(result);
      setCollapsed(initialCollapsed(result));
      setSelected(null);
      store.set(cacheKey, result);
      setStatus("idle");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  };

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg || !tree) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const pad = 24;
    const g = clone.querySelector("g[data-root]");
    g?.setAttribute("transform", `translate(${pad}, ${pad - bounds.minY})`);
    clone.setAttribute("width", String(bounds.maxX + pad * 2));
    clone.setAttribute("height", String(bounds.maxY - bounds.minY + pad * 2));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = "text{font-family:Montserrat,Arial,sans-serif}";
    clone.prepend(style);
    const url = URL.createObjectURL(new Blob([clone.outerHTML], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tree.title.replace(/[^\w\- ]+/g, "").trim() || "mind-map"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedNode = nodes.find((n) => n.id === selected);

  if (documents.length === 0) {
    return (
      <div className="mm-empty">
        <Network size={28} />
        <h3>Map out your material</h3>
        <p>Select at least one source on the left, then generate a mind map of its main ideas and how they connect.</p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="mm-empty">
        <Loader2 size={26} className="st-spin" />
        <h3>Mapping the ideas…</h3>
        <p>Reading {documents.length === 1 ? documents[0] : `${documents.length} sources`} and organising its key concepts. This takes 10–20 seconds.</p>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="mm-empty">
        <Network size={28} />
        <h3>Map out your material</h3>
        <p>Turn {documents.length === 1 ? documents[0] : `your ${documents.length} sources`} into a branching overview: main themes, the ideas under each, and a one-line note on every topic.</p>
        <button type="button" className="st-primary" onClick={generate}>
          <Network size={16} /> Generate mind map
        </button>
        {status === "error" && <p className="st-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mm">
      <div className="mm-toolbar">
        <div className="mm-tool-group">
          <button type="button" onClick={expandAll} title="Expand all"><ChevronsUpDown size={15} /> Expand</button>
          <button type="button" onClick={collapseToBranches} title="Show main branches only"><ChevronsDownUp size={15} /> Collapse</button>
        </div>
        <div className="mm-tool-group">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={15} /></button>
          <span className="mm-zoom">{Math.round(view.k * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={15} /></button>
          <button type="button" onClick={fit} aria-label="Fit to view" title="Fit to view"><Maximize2 size={14} /></button>
        </div>
        <div className="mm-tool-group">
          <button type="button" onClick={downloadSvg} title="Download as SVG"><Download size={15} /> SVG</button>
          <button type="button" onClick={generate} title="Generate a new map"><RefreshCw size={14} /> Regenerate</button>
        </div>
      </div>

      <div
        className="mm-canvas"
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg ref={svgRef} width="100%" height="100%" role="img" aria-label={`Mind map: ${tree.title}`}>
          <g data-root transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
            {nodes.filter((n) => n.parent).map((n) => {
              const p = n.parent!;
              const x1 = p.x + p.w;
              const x2 = n.x;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={`l-${n.id}`}
                  d={`M${x1},${p.y} C${mid},${p.y} ${mid},${n.y} ${x2},${n.y}`}
                  fill="none"
                  stroke={BRANCH_COLORS[n.branch % BRANCH_COLORS.length]}
                  strokeOpacity={n.depth === 1 ? 0.55 : 0.35}
                  strokeWidth={n.depth === 1 ? 2.2 : 1.6}
                />
              );
            })}
            {nodes.map((n) => {
              const color = BRANCH_COLORS[n.branch % BRANCH_COLORS.length];
              const isRoot = n.depth === 0;
              const isMain = n.depth === 1;
              const isSel = n.id === selected;
              const fill = isRoot ? "#3f37c9" : isMain ? `${color}1a` : "#ffffff";
              const stroke = isRoot ? "#3f37c9" : isSel ? color : isMain ? `${color}66` : "#dfe2f0";
              return (
                <g
                  key={n.id}
                  data-node
                  className="mm-node"
                  transform={`translate(${n.x}, ${n.y - n.h / 2})`}
                  onClick={() => setSelected(n.id)}
                  onDoubleClick={() => n.hasChildren && toggle(n.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.node.title}${n.hasChildren ? (n.collapsed ? ", collapsed" : ", expanded") : ""}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(n.id);
                    if (e.key === " " && n.hasChildren) { e.preventDefault(); toggle(n.id); }
                  }}
                >
                  <rect
                    width={n.w}
                    height={n.h}
                    rx={isRoot ? 14 : 10}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  {!isRoot && !isMain && <circle cx={13} cy={n.h / 2} r={3.5} fill={color} />}
                  <text
                    x={isRoot ? 20 : isMain ? 15 : 24}
                    y={n.h / 2}
                    dominantBaseline="central"
                    fill={isRoot ? "#ffffff" : isMain ? "#1f2233" : "#33374d"}
                    style={{ font: isRoot ? ROOT_FONT : FONT }}
                  >
                    {clip(n.node.title, isRoot ? 44 : 38)}
                  </text>
                  {n.hasChildren && (
                    <g
                      className="mm-toggle"
                      transform={`translate(${n.w - 14}, ${n.h / 2})`}
                      onClick={(e) => { e.stopPropagation(); toggle(n.id); }}
                    >
                      <circle r={8} fill={isRoot ? "#ffffff" : color} fillOpacity={isRoot ? 0.22 : 0.14} />
                      <text textAnchor="middle" dominantBaseline="central" fill={isRoot ? "#ffffff" : color} style={{ font: "700 12px Montserrat, sans-serif" }}>
                        {n.collapsed ? "+" : "−"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {selectedNode && (
          <div className="mm-detail">
            <p className="mm-detail-path">
              {[selectedNode.parent?.parent?.node.title, selectedNode.parent?.node.title].filter(Boolean).join(" › ") || "Central topic"}
            </p>
            <h4>
              <span
                className="mm-swatch"
                style={{ background: selectedNode.depth === 0 ? "#3f37c9" : BRANCH_COLORS[selectedNode.branch % BRANCH_COLORS.length] }}
              />
              {selectedNode.node.title}
            </h4>
            {selectedNode.node.note ? <p>{selectedNode.node.note}</p> : <p className="mm-muted">No extra note for this topic.</p>}
            {selectedNode.hasChildren && (
              <button type="button" onClick={() => toggle(selectedNode.id)}>
                {selectedNode.collapsed ? `Show ${selectedNode.node.children.length} sub-topics` : "Hide sub-topics"}
              </button>
            )}
          </div>
        )}
        <p className="mm-help">Drag to pan · scroll to zoom · click a topic for its note · double-click to fold</p>
      </div>
    </div>
  );
};

export default MindMap;

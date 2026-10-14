// Auto layout for the ER diagram: dagre for tables connected by foreign keys,
// a compact grid for isolated tables (dagre would put them all in one rank).
import dagre from "@dagrejs/dagre";

export type Direction = "LR" | "TB";

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { source: string; target: string }

export function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[], dir: Direction): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const ids = new Set(nodes.map((n) => n.id));
  const linked = new Set<string>();
  for (const e of edges) {
    if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
    linked.add(e.source);
    linked.add(e.target);
  }

  let maxX = 0, maxY = 0;
  const connected = nodes.filter((n) => linked.has(n.id));
  if (connected.length) {
    const g = new dagre.graphlib.Graph({ multigraph: false });
    g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 110, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of connected) g.setNode(n.id, { width: n.width, height: n.height });
    for (const e of edges) if (linked.has(e.source) && linked.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
    dagre.layout(g);
    for (const n of connected) {
      const p = g.node(n.id) as { x: number; y: number };
      const x = p.x - n.width / 2, y = p.y - n.height / 2;
      out.set(n.id, { x, y });
      maxX = Math.max(maxX, x + n.width);
      maxY = Math.max(maxY, y + n.height);
    }
  }

  // Isolated tables: shelf-pack into rows below (LR) or to the right (TB) of the graph.
  const isolated = nodes.filter((n) => !linked.has(n.id));
  if (isolated.length) {
    const gap = 30;
    const totalArea = isolated.reduce((a, n) => a + (n.width + gap) * (n.height + gap), 0);
    const rowWidth = Math.max(connected.length ? maxX : 0, Math.sqrt(totalArea) * 1.6, 900);
    const startX = dir === "TB" && connected.length ? maxX + 120 : 20;
    const startY = dir === "LR" && connected.length ? maxY + 120 : 20;
    let x = startX, y = startY, rowH = 0;
    for (const n of isolated) {
      if (x > startX && x + n.width > startX + rowWidth) {
        x = startX;
        y += rowH + gap;
        rowH = 0;
      }
      out.set(n.id, { x, y });
      x += n.width + gap;
      rowH = Math.max(rowH, n.height);
    }
  }
  return out;
}

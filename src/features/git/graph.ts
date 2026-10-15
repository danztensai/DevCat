// Commit graph lanes (like `git log --graph`), computed from the parents of each commit.
// Commits must be in git log order (children before parents). Pure — no React.

/** One line piece drawn in a row. Lanes are columns; `half` says which part of the row it spans:
 *  "top" = row top → node middle, "bottom" = node middle → row bottom, "full" = straight through. */
export interface GraphEdge { from: number; to: number; half: "top" | "bottom" | "full"; color: number }

export interface GraphRow {
  /** Lane of the commit's dot. */
  col: number;
  color: number;
  edges: GraphEdge[];
  /** Lanes occupied in this row (for the column width). */
  width: number;
}

export const GRAPH_COLORS = ["#f5a524", "#60a5fa", "#4ade80", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c", "#facc15", "#f87171", "#34d399"];

export function computeGraph(commits: ReadonlyArray<{ sha: string; parents: string[] }>): { rows: GraphRow[]; maxWidth: number } {
  // lanes[j] = sha the lane is waiting for (null = free); colors[j] = its color index.
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let maxWidth = 0;
  const rows: GraphRow[] = [];

  const freeSlot = (skip: number) => {
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === null && j !== skip) return j;
    return lanes.length;
  };

  for (const c of commits) {
    const before = lanes.slice();
    const beforeColors = colors.slice();
    let col = lanes.indexOf(c.sha);
    if (col < 0) {
      // Branch tip nobody pointed at yet: new lane.
      col = freeSlot(-1);
      lanes[col] = c.sha;
      colors[col] = nextColor++;
    }
    const color = colors[col];
    const edges: GraphEdge[] = [];

    for (let j = 0; j < before.length; j++) {
      const want = before[j];
      if (want === null || want === undefined) continue;
      if (want === c.sha) {
        edges.push({ from: j, to: col, half: "top", color: beforeColors[j] });
        if (j !== col) lanes[j] = null; // merged into this commit's lane
      } else {
        edges.push({ from: j, to: j, half: "full", color: beforeColors[j] });
      }
    }

    if (c.parents.length === 0) {
      lanes[col] = null;
    } else {
      lanes[col] = c.parents[0];
      edges.push({ from: col, to: col, half: "bottom", color });
      for (const p of c.parents.slice(1)) {
        let k = lanes.indexOf(p);
        if (k < 0) {
          k = freeSlot(col);
          lanes[k] = p;
          colors[k] = nextColor++;
        }
        edges.push({ from: col, to: k, half: "bottom", color: colors[k] });
      }
    }
    // Holes left by sparse assignment are free lanes.
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === undefined) lanes[j] = null;

    const width = Math.max(before.length, lanes.length, col + 1);
    while (lanes.length && lanes[lanes.length - 1] === null) { lanes.pop(); colors.pop(); }
    maxWidth = Math.max(maxWidth, width);
    rows.push({ col, color, edges, width });
  }
  return { rows, maxWidth };
}

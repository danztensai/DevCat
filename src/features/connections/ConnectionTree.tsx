// Sidebar tree of saved connections and their (lazily loaded) database objects.
// State lives in tree/store.ts; rows are flattened in tree/rows.ts and virtualized here.
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsDownUp, Plus, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button, Empty, IconButton } from "../../components/ui";
import { api } from "../../lib/api";
import { useConnections } from "../../store/connections";
import { useUi } from "../../store/ui";
import { useContextMenu } from "./ContextMenu";
import { activateConnection, activateNode, refreshAll, toggleConnection, toggleNode } from "./tree/actions";
import { backgroundMenu, rowMenu } from "./tree/menus";
import { buildRows, isInfra, type Row, type SelectableRow } from "./tree/rows";
import { nodeKey, useTree } from "./tree/store";
import { ROW_H, TreeRow } from "./tree/TreeRow";

const selectable = (r: Row): r is SelectableRow => r.type === "group" || r.type === "conn" || r.type === "node";

export default function ConnectionTree() {
  const connections = useConnections((s) => s.connections);
  const open = useConnections((s) => s.open);
  const markOpen = useConnections((s) => s.markOpen);
  const nodes = useTree((s) => s.nodes);
  const connecting = useTree((s) => s.connecting);
  const collapsedGroups = useTree((s) => s.collapsedGroups);
  const selected = useTree((s) => s.selected);
  const setSelected = useTree((s) => s.setSelected);
  const openDialog = useUi((s) => s.openConnectionDialog);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();
  const showMenu = menu.show;

  // Sync backend sessions that survived a frontend reload.
  useEffect(() => {
    api.openConnectionIds().then((ids) => ids.forEach((id) => markOpen(id, true))).catch(() => {});
  }, [markOpen]);

  // A session closed elsewhere (e.g. connection edited & saved): drop its cached subtree.
  useEffect(() => {
    const t = useTree.getState();
    for (const c of connections) {
      const root = t.nodes[nodeKey(c.id, [])];
      if (root?.expanded && !root.error && !open.has(c.id) && !t.connecting[c.id]) t.clearConn(c.id);
    }
  }, [open, connections]);

  const rows = useMemo(
    () => buildRows({ connections, nodes, collapsedGroups, query }),
    [connections, nodes, collapsedGroups, query],
  );

  // Lazily (re)load expanded nodes that have no cached children (e.g. after a refresh).
  useEffect(() => {
    const t = useTree.getState();
    for (const r of rows) {
      if (r.type === "conn" && r.expanded && open.has(r.conn.id)) {
        const st = t.nodes[nodeKey(r.conn.id, [])];
        if (st && !st.children && !st.loading && !st.error) void t.load(r.conn.id, []);
      } else if (r.type === "node" && r.expanded) {
        const st = t.nodes[nodeKey(r.conn.id, r.node.path)];
        if (!st?.children && !st?.loading && !st?.error) void t.load(r.conn.id, r.node.path);
      }
    }
  }, [rows, open]);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
    getItemKey: (i) => rows[i].id,
  });

  const indexOf = useCallback((id: string | null) => (id ? rows.findIndex((r) => r.id === id) : -1), [rows]);

  const toggle = useCallback((row: Row) => {
    if (row.type === "group") useTree.getState().toggleGroup(row.name);
    else if (row.type === "conn") toggleConnection(row.conn);
    else if (row.type === "node") toggleNode(row.conn, row.node, row.expanded);
  }, []);

  const activate = useCallback((row: Row) => {
    if (row.type === "group") useTree.getState().toggleGroup(row.name);
    else if (row.type === "conn") activateConnection(row.conn);
    else if (row.type === "node") activateNode(row.conn, row.node, row.ctx, row.expanded);
  }, []);

  const refreshRow = useCallback((row: Row) => {
    const t = useTree.getState();
    if (row.type === "conn" && !isInfra(row.conn)) t.refresh(row.conn.id, []);
    else if (row.type === "node") t.refresh(row.conn.id, row.node.hasChildren ? row.node.path : row.parentPath);
    else void refreshAll();
  }, []);

  const onSelect = useCallback((row: Row) => setSelected(row.id), [setSelected]);

  const onRowContextMenu = useCallback((e: MouseEvent, row: Row) => {
    setSelected(row.id);
    const items = rowMenu(row);
    if (items) showMenu(e, items);
  }, [showMenu, setSelected]);

  const onRetry = useCallback((row: Extract<Row, { type: "error" }>) => {
    const t = useTree.getState();
    if (row.path.length === 0) t.refresh(row.conn.id, []);
    else void t.load(row.conn.id, row.path);
  }, []);

  const moveTo = (i: number) => {
    const r = rows[i];
    if (!r) return;
    setSelected(r.id);
    virt.scrollToIndex(i, { align: "auto" });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const idx = indexOf(selected);
    const row = rows[idx];
    const step = (dir: 1 | -1) => {
      for (let i = idx + dir; i >= 0 && i < rows.length; i += dir) if (selectable(rows[i])) return moveTo(i);
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < 0) { const first = rows.findIndex(selectable); if (first >= 0) moveTo(first); } else step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx < 0) return;
        if (idx === 0 || !rows.slice(0, idx).some(selectable)) searchRef.current?.focus();
        else step(-1);
        break;
      case "ArrowRight": {
        e.preventDefault();
        if (!row) return;
        const expandable = row.type === "group" || (row.type === "conn" && !isInfra(row.conn)) || (row.type === "node" && row.node.hasChildren);
        const expanded = row.type === "group" ? !row.collapsed : row.type !== "error" && row.type !== "empty" && row.expanded;
        if (expandable && !expanded) toggle(row);
        else if (expanded && rows[idx + 1]?.parentId === row.id && selectable(rows[idx + 1])) moveTo(idx + 1);
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (!row) return;
        const expanded = row.type === "group" ? !row.collapsed : row.type !== "error" && row.type !== "empty" && row.expanded;
        if (expanded) toggle(row);
        else if (row.parentId) moveTo(indexOf(row.parentId));
        break;
      }
      case "Enter":
        e.preventDefault();
        if (row) activate(row);
        break;
      case "Home": e.preventDefault(); moveTo(rows.findIndex(selectable)); break;
      case "End": e.preventDefault(); { let i = rows.length - 1; while (i >= 0 && !selectable(rows[i])) i--; moveTo(i); } break;
      case "F5":
        e.preventDefault();
        if (row) refreshRow(row); else void refreshAll();
        break;
      case "ContextMenu":
        if (row) {
          e.preventDefault();
          const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.id)}"]`);
          const rect = el?.getBoundingClientRect();
          const items = rowMenu(row);
          if (items && rect) menu.show({ clientX: rect.left + 24, clientY: rect.bottom }, items);
        }
        break;
      default:
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
          e.preventDefault();
          if (row) refreshRow(row); else void refreshAll();
        }
    }
  };

  if (connections.length === 0) {
    return (
      <Empty title="No connections yet">
        <p className="mb-3">Add a database, Kubernetes cluster or RabbitMQ broker to get started.</p>
        <Button variant="primary" onClick={() => openDialog(null)}><Plus className="size-3.5" />New connection</Button>
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            value={query}
            spellCheck={false}
            placeholder="Filter connections & objects"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              else if (e.key === "ArrowDown" || e.key === "Enter") {
                e.preventDefault();
                const first = rows.findIndex(selectable);
                if (first >= 0) moveTo(first);
                scrollRef.current?.focus();
              }
            }}
            className="h-6 w-full rounded-md border border-line bg-app pr-6 pl-7 text-[12px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {query && (
            <button className="absolute top-1/2 right-1.5 -translate-y-1/2 text-faint hover:text-fg" onClick={() => setQuery("")} aria-label="Clear filter">
              <X className="size-3" />
            </button>
          )}
        </div>
        <IconButton title="Refresh all" onClick={() => void refreshAll()}><RefreshCw className="size-3.5" /></IconButton>
        <IconButton title="Collapse all" onClick={() => useTree.getState().collapseAll()}><ChevronsDownUp className="size-3.5" /></IconButton>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto py-1 outline-none focus-visible:outline-none"
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest("[data-row]")) menu.show(e, backgroundMenu());
        }}
      >
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">No matches for “{query}”</div>
        ) : (
          <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div key={vi.key} className="absolute inset-x-0 top-0" style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}>
                  <TreeRow
                    row={row}
                    selected={row.id === selected}
                    focused={focused}
                    isOpen={row.type === "conn" && open.has(row.conn.id)}
                    connecting={row.type === "conn" && !!connecting[row.conn.id]}
                    onSelect={onSelect}
                    onToggle={toggle}
                    onActivate={activate}
                    onContextMenu={onRowContextMenu}
                    onRetry={onRetry}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {menu.element}
    </div>
  );
}

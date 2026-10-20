# Data grid and table designer

Browse and edit table data, filter by typing in a column header, and change a table's structure with a preview of
the SQL.

![A table open in the data grid](../img/table.png)

## Browse a table

Right-click a table → **Open data** (or select it and press <kbd>Enter</kbd>). The grid loads rows page by page,
so big tables stay fast.

- **Filter**: type in a column's header and press <kbd>Enter</kbd>. Filters on several columns combine; **Clear all
  filters** removes them. Right-click a cell → **Filter by this value** is a shortcut.
- **Sort**: click a column header, or right-click → **Sort ascending** / **Sort descending**.
- **Page**: the controls at the bottom move between pages, and **Rows per page** sets the page size.
- **Reload**: <kbd>⌘R</kbd> or <kbd>F5</kbd>.

## Edit rows

1. Double-click a cell to edit it. Large values open in an editor dialog. Right-click → **Set NULL** clears one.
2. **Add row**, **Duplicate selected rows**, or delete the selected rows with <kbd>⌘⌫</kbd> (<kbd>Ctrl+Delete</kbd>).
3. Changes stay pending (highlighted) until you commit them with <kbd>⌘S</kbd> (<kbd>Ctrl+S</kbd>) or **Commit
   changes**, or throw them away with **Discard changes**. **Restore row** undoes one deleted row.

The **form view** shows one row at a time, handy for wide tables.

> **Note:** Tables without a primary key can't be edited, because DevCat can't tell rows apart. Read-only
> connections can't be edited either.

## Copy

Select cells or rows, then:

- <kbd>⌘C</kbd> (<kbd>Ctrl+C</kbd>) copies tab-separated values, ready for a spreadsheet.
- <kbd>⇧⌘C</kbd> (<kbd>Ctrl+Shift+C</kbd>) adds the header row.
- Right-click → **Copy as** for CSV, JSON, SQL INSERT statements, TSV with headers or a Markdown table.

To save to a file, use **Export CSV…**, **Export Excel…**, **Export JSON…** or **Export SQL INSERTs…**.

## Table designer

Right-click a table → **Design table**, or a schema → **New table…**.

1. Edit **Columns** (name, type, length, not null, default, comment), **Indexes** and **Foreign Keys** (with *On
   delete* / *On update*).
2. Check the generated `CREATE` / `ALTER` statement in **SQL Preview**.
3. Save with <kbd>⌘S</kbd> (<kbd>Ctrl+S</kbd>).

## ER diagram

Right-click a schema → **ER diagram**. Tables are laid out automatically, left to right or top to bottom.

- Click a table to highlight its relationships. **Show only the selected table and its directly related tables**
  hides the rest.
- *Find table* (type a name, press <kbd>Enter</kbd>) zooms to a table. **Zoom to fit** shows everything again.
- **Choose tables** limits the diagram to some tables. Drag tables to arrange them; **Re-run auto layout** resets.
- Export the diagram as PNG or SVG.

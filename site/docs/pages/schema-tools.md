# Compare, transfer and backup

Compare two schemas or their data, export and import files, copy tables between servers, and back up a database.

## Schema compare and sync

1. Right-click a connection or schema → **Schema compare…**.
2. Pick the source and the target schema. **Swap source and target** flips them.
3. DevCat groups the objects into **Identical**, **Different**, **Only in source** and **Only in target**. Click
   one to see how its columns, indexes and foreign keys differ.
4. Review the script that makes the target match the source and click **Run script**. DevCat asks before it
   executes anything on the target.

## Data compare

In a schema compare, choose **Compare table data** on a table. Pick the **Key columns** that identify a row; DevCat
lists the rows that differ and builds a **Data sync script** for them.

## Data transfer

Right-click a connection → **Data transfer…**, a schema → **Backup / restore, import / export…**, or a table →
**Export…**. Pick what to do:

| Mode | What it does |
| --- | --- |
| **Export** | Write tables or a custom query to CSV, TSV, JSON, JSON Lines, SQL or Excel |
| **Import** | Load a CSV or JSON file into a table, matching each **File column** to a **Target column**. **Append**, or **Empty table first** |
| **Copy between connections** | Copy tables to another connection, even to a different database (MySQL to PostgreSQL, for example) |
| **Backup** | Write an SQL backup of a schema |
| **Restore** | Run a backup file against a connection |

The **Progress** list shows each table as it goes.

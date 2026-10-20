# MongoDB

Browse and edit documents, build aggregation pipelines, manage indexes and run shell-style queries.

## Connect

Add a MongoDB connection like any other ([Database connections](connections.md)). Expand it to see databases and
their collections, then click a collection to open it.

A collection tab has three sections: **Documents**, **Aggregation** and **Indexes & fields**.

## Documents

Show the documents as **Documents** (a tree per document), **Table** (fields as columns) or **JSON**.

Narrow them down with the boxes at the top, each taking MongoDB JSON:

| Box | Example |
| --- | --- |
| **Filter** | `{ "status": "active" }` |
| **Sort** | `{ "_id": -1 }` |
| **Project** | `{ "name": 1 }` |

Page through with the arrows at the bottom and pick the **Page size**.

### Edit documents

- Double-click a document (**Edit**) to change it as JSON, then **Save document**.
- **Insert document** adds a new one.
- **Duplicate**, **Copy JSON** and **Delete** are on each document (deleting asks first).

## Aggregation

1. Open **Aggregation** and click **Add stage**.
2. Pick the stage (`$match`, `$group`, `$sort`…) and write its body.
3. Reorder stages with **Move up** / **Move down**, or remove one.
4. Choose how many rows to **Preview** and click **Run**.

**Copy code** copies the pipeline as shell code for `mongosh` or your app.

## Indexes and fields

**Indexes & fields** lists the collection's indexes (**Create index**, **Drop index**) and a summary of the fields
found in the documents, with their types.

## Shell-style queries

Right-click the connection or a database → **New query** to write queries the way you would in `mongosh`, for
example:

```js
db.orders.find({ total: { $gt: 100 } })
```

Autocomplete suggests collections and methods like `find`, `aggregate` and `countDocuments`.

# Redis

Browse keys as a tree, edit every data type, set TTLs and type commands in a console.

## Browse keys

Right-click a Redis connection → **Open key browser**.

- Pick the **Database** (0, 1, …) at the top.
- Keys are grouped into a tree by their `:` separated prefixes, so `user:1` and `user:2` sit under `user`.
- Search with a prefix or glob such as `user:*` and press <kbd>Enter</kbd>.
- **Filter by type** shows only strings, hashes and so on (Redis 6 or later).
- Big databases load in pages: **Load more** fetches the next one.

## Edit a key

Click a key to open it. Strings, hashes, lists, sets, sorted sets and streams each get an editor that fits them.

- Change values, then press <kbd>⌘S</kbd> (<kbd>Ctrl+S</kbd>) or **Apply**. **Revert** throws the edits away.
- **Toggle JSON formatting** pretty-prints JSON stored in a string.
- Edit the key name at the top to rename the key.
- **Set TTL** / **Edit TTL** gives the key an expiry.
- **Copy key name** and **Delete key** are in the toolbar (deleting asks first).

**New key** creates a key of any type.

## Console

Right-click the connection → **New console**, or open **Console** in the Redis tab. Type a command such as
`GET user:1` and press <kbd>Enter</kbd>. <kbd>Ctrl+L</kbd> clears the output.

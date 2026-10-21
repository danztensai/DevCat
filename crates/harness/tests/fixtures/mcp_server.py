# Minimal MCP server over stdio for tests: one tool, `add`.
import json, sys

def send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    req = json.loads(line)
    method, rid = req.get("method"), req.get("id")
    if rid is None:
        continue  # notification
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "test", "version": "1"}}})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": rid, "result": {"tools": [{"name": "add", "description": "Add two numbers", "inputSchema": {"type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}}}]}})
    elif method == "tools/call":
        args = req["params"]["arguments"]
        send({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": str(args["a"] + args["b"])}]}})
    else:
        send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "no such method"}})

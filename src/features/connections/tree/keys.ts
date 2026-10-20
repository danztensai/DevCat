// Tree node keys, shared by the tree store and the row builder. No dependencies, so
// rows.check.ts can run under plain Node.
export const SEP = "\u0001";
export const nodeKey = (connId: string, path: string[]) => `${connId}|${path.join(SEP)}`;
export const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);

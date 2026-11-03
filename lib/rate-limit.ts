/**
 * Fixed-window rate limit per key, in memory (doc 08 §4). Each container enforces its own window, which is enough
 * to blunt scripted abuse of uploads and writes; a shared store is not needed at this scale.
 */
const windows = new Map<string, { start: number; count: number }>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) { windows.set(key, { start: now, count: 1 }); return true; }
  w.count++;
  if (windows.size > 10000) for (const [k, v] of windows) if (now - v.start > windowMs) windows.delete(k);
  return w.count <= limit;
}

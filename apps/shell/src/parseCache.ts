/**
 * Tiny LRU cache for expensive parse results (markdown / rich-ui).
 * Caps memory during long dogfood sessions.
 */

export function createParseCache<T>(max = 64) {
  const map = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      const v = map.get(key);
      if (v === undefined) return undefined;
      // refresh LRU
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key: string, value: T): void {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > max) {
        const first = map.keys().next().value as string | undefined;
        if (first === undefined) break;
        map.delete(first);
      }
    },
    get size() {
      return map.size;
    },
    clear() {
      map.clear();
    },
  };
}

/** Cheap content hash for cache keys (not crypto). */
export function hashKey(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ":" + s.length;
}

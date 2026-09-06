export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1m ago";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 5400) return "1h ago";
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "1d ago";
  return `${Math.floor(s / 86400)}d ago`;
}

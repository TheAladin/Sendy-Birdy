/**
 * Where to go after signing in. Only same-site paths are allowed: otherwise a link like
 * /login?next=https://evil.example would send you to a fake page right after a real login
 * (an "open redirect").
 */
export function safeRedirect(next: string | null, fallback = "/"): string {
  // "//evil.example" and "/\evil.example" are treated by browsers as other sites.
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/login") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

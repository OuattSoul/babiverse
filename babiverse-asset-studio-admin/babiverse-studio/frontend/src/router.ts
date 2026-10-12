export function go(hash: string) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = hash;
}

export function parseHash(): { path: string[]; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [p, q] = raw.split("?");
  return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q || "") };
}

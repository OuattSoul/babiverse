import type {
  AssetDetail, AssetSummary, CatalogEntry, Category, CharacterRender, Media, MediaDetail, PartPayload, Report, SceneSummary, Taxonomy, User, World,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public report: Report | null = null) { super(message); }
}

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

// Le jeton de session reste dans le navigateur (préférence locale) ; toutes les données de contenu sont sur le serveur.
let token: string | null = store.get("babiverse.token");
let onAuthLost: (() => void) | null = null;

export function setToken(t: string | null) { token = t; store.set("babiverse.token", t); }
export const hasToken = () => !!token;
export const whenAuthLost = (fn: () => void) => { onAuthLost = fn; };

async function send(method: string, url: string, body?: BodyInit, contentType = "application/json"): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { ...(body !== undefined ? { "Content-Type": contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
  } catch {
    throw new ApiError(0, "Serveur injoignable : vérifiez votre connexion. Rien n'a été enregistré.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== "/api/auth/login") { setToken(null); onAuthLost?.(); }
    let msg = typeof data.detail === "string" ? data.detail : `Erreur ${res.status}`;
    if (Array.isArray(data.detail)) msg = data.detail.map((d: any) => `${d.loc.slice(1).join(".")} : ${d.msg}`).join(" · ");
    throw new ApiError(res.status, msg, data.report ?? null);
  }
  return res;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await send(method, url, body === undefined ? undefined : JSON.stringify(body));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function upload<T>(url: string, file: Blob): Promise<T> {
  const res = await send("POST", url, file, "application/octet-stream");
  return (await res.json()) as T;
}

const qs = (p: Record<string, string | number | boolean | undefined | null>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

export type AssetAction = "submit" | "approve" | "reject" | "publish" | "archive" | "restore";

export const api = {
  login: (username: string, password: string) => call<{ token: string; user: User; dev: boolean }>("POST", "/api/auth/login", { username, password }),
  logout: (everywhere = false) => call<void>("POST", "/api/auth/logout", { everywhere }),
  me: () => call<User>("GET", "/api/auth/me"),
  changePassword: (current_password: string, new_password: string) => call<void>("POST", "/api/auth/password", { current_password, new_password }),
  taxonomy: () => call<Taxonomy>("GET", "/api/taxonomy"),
  dashboard: () => call<any>("GET", "/api/dashboard"),
  system: () => call<any>("GET", "/api/system"),

  assets: (params: Record<string, string> = {}) => call<AssetSummary[]>("GET", "/api/assets?" + qs(params)),
  asset: (id: string) => call<AssetDetail>("GET", `/api/assets/${id}`),
  version: (id: string, v: number) => call<{ definition: any; status: string; validation: Report | null; pins: any; note: string | null }>("GET", `/api/assets/${id}/versions/${v}`),
  diff: (id: string, a: number, b: number) => call<{ changes: { path: string; before: any; after: any; kind: string }[] }>("GET", `/api/assets/${id}/diff?${qs({ a, b })}`),
  render: (id: string, version?: number) => call<CharacterRender>("GET", `/api/assets/${id}/render?${qs({ version })}`),
  create: (category: string, technical_name: string, definition: any) => call<AssetDetail>("POST", "/api/assets", { category, technical_name, definition }),
  validateDefinition: (category: string, definition: any) => call<Report>("POST", "/api/validate", { category, definition }),
  saveDraft: (id: string, definition: any, note?: string) => call<AssetDetail>("PUT", `/api/assets/${id}/draft`, { definition, note }),
  newDraft: (id: string) => call<AssetDetail>("POST", `/api/assets/${id}/new-draft`),
  revert: (id: string, from_version: number) => call<AssetDetail>("POST", `/api/assets/${id}/revert`, { from_version }),
  duplicate: (id: string, technical_name: string, name: string) => call<AssetDetail>("POST", `/api/assets/${id}/duplicate`, { technical_name, name }),
  validate: (id: string, publishCheck = false) => call<Report>("POST", `/api/assets/${id}/validate?publish_check=${publishCheck}`),
  action: (id: string, action: AssetAction) => call<AssetDetail>("POST", `/api/assets/${id}/${action}`),
  migration: (id: string, to: number) => call<any>("GET", `/api/assets/${id}/migration?to=${to}`),
  migrate: (id: string, to_version: number) => call<{ migrated: string[]; skipped: string[] }>("POST", `/api/assets/${id}/migrate`, { to_version }),
  roadCompat: (id: string) => call<any[]>("GET", `/api/assets/${id}/road-compatibility`),
  parts: (drafts = true) => call<PartPayload[]>("GET", `/api/characters/parts?drafts=${drafts}`),
  kitParts: (kit = "", drafts = true) => call<PartPayload[]>("GET", `/api/kits/parts?${qs({ kit, drafts })}`),
  behaviorUsage: () => call<Record<string, { id: string; name: string; family: string; status: string }[]>>("GET", "/api/behaviors/usage"),

  categories: () => call<Category[]>("GET", "/api/categories"),
  createCategory: (c: any) => call<Category>("POST", "/api/categories", c),
  updateCategory: (key: string, patch: any) => call<Category>("PATCH", `/api/categories/${key}`, patch),

  media: (params: Record<string, string | boolean> = {}) => call<Media[]>("GET", "/api/media?" + qs(params as any)),
  mediaDetail: (id: string) => call<MediaDetail>("GET", `/api/media/${id}`),
  mediaSvg: (id: string) => call<{ svg: string }>("GET", `/api/media/${id}/svg`),
  // monde du jeu : villes, zones, cartes (backend/app/worldmaps.py)
  worldMaps: () => call<any>("GET", "/api/game/world"),
  createCity: (body: { id: string; name: string; description?: string }) => call<any>("POST", "/api/game/world/cities", body),
  createDistrict: (body: { id: string; city_id: string; name: string; description?: string }) => call<any>("POST", "/api/game/world/districts", body),
  mapVersion: (id: string, v: number) => call<any>("GET", `/api/game/maps/${encodeURIComponent(id)}/versions/${v}`),
  restoreMap: (id: string, version: number) => call<any>("POST", `/api/game/maps/${encodeURIComponent(id)}/restore`, { version }),
  mapConnections: () => call<any>("GET", "/api/game/connections"),
  createMap: (body: { id: string; district_id: string; name: string; width?: number; height?: number; ground?: string }) => call<any>("POST", "/api/game/maps", body),
  mapDetail: (id: string) => call<any>("GET", `/api/game/maps/${encodeURIComponent(id)}`),
  saveMapDraft: (id: string, draft: unknown) => call<any>("PUT", `/api/game/maps/${encodeURIComponent(id)}/draft`, draft),
  publishMap: (id: string, note = "") => call<any>("POST", `/api/game/maps/${encodeURIComponent(id)}/publish`, { note }),
  setMapStatus: (id: string, enabled: boolean) => call<any>("POST", `/api/game/maps/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`),
  uploadMedia: (file: Blob, filename: string, opts: { name?: string; category?: string; tags?: string } = {}) =>
    upload<Media>("/api/media?" + qs({ filename, ...opts }), file),
  replaceMedia: (id: string, file: Blob, filename: string) => upload<Media>(`/api/media/${id}/replace?` + qs({ filename }), file),
  assignChannels: (id: string, mapping: Record<string, string>) => call<Media>("POST", `/api/media/${id}/channels`, { mapping }),
  updateMedia: (id: string, patch: any) => call<Media>("PATCH", `/api/media/${id}`, patch),
  archiveMedia: (id: string, archived: boolean) => call<Media>("POST", `/api/media/${id}/${archived ? "archive" : "restore"}`),

  catalog: (family = "") => call<CatalogEntry[]>("GET", `/api/catalog?${qs({ family })}`),
  definitions: (keys: string[]) => call<Record<string, { family: string; category: string; definition: any; pins: any }>>("GET", `/api/catalog/definitions?keys=${encodeURIComponent(keys.join(","))}`),
  runtimeCatalog: () => call<any>("GET", "/api/runtime/catalog"),
  gameAdapter: () => call<any>("GET", "/api/runtime/game-adapter"),
  gamePack: () => call<any>("GET", "/api/runtime/game-pack"),
  gameSettings: () => call<any>("GET", "/api/game/settings"),
  gamePlacements: () => call<any>("GET", "/api/game/placements"),
  addGamePlacement: (body: { asset_id: string; x: number; y: number; facing: string; w?: number; h?: number }) => call<any>("POST", "/api/game/placements", body),
  removeOriginal: (key: string, label: string) => call<any>("POST", "/api/game/removals", { key, label }),
  restoreOriginal: (key: string) => call<any>("DELETE", `/api/game/removals/${encodeURIComponent(key)}`),
  removeGamePlacement: (id: string) => call<any>("DELETE", `/api/game/placements/${encodeURIComponent(id)}`),
  saveGameSettings: (body: { home_interior?: string; npcs?: Record<string, string>; extra_inhabitants?: boolean }) => call<any>("PUT", "/api/game/settings", body),
  publishInhabitants: (ids?: string[]) => call<{ published: string[]; failed: { technical_name: string; error: string }[] }>("POST", "/api/game/publish-inhabitants", ids ? { ids } : {}),

  scenes: () => call<SceneSummary[]>("GET", "/api/scenes"),
  scene: (id: string) => call<World>("GET", `/api/scenes/${id}`),
  createScene: (b: any) => call<World>("POST", "/api/scenes", b),
  patchScene: (id: string, b: any) => call<World>("PATCH", `/api/scenes/${id}`, b),
  duplicateScene: (id: string, name: string) => call<World>("POST", `/api/scenes/${id}/duplicate`, { name }),
  clearScene: (id: string) => call<void>("POST", `/api/scenes/${id}/clear`),
  deleteScene: (id: string) => call<void>("DELETE", `/api/scenes/${id}`),
  check: (scene: string, b: any) => call<Report>("POST", `/api/scenes/${scene}/check`, b),
  place: (scene: string, b: any) => call<{ instance: any; report: Report }>("POST", `/api/scenes/${scene}/instances`, b),
  move: (scene: string, id: string, b: any) => call<any>("PATCH", `/api/scenes/${scene}/instances/${id}`, b),
  remove: (scene: string, id: string) => call<void>("DELETE", `/api/scenes/${scene}/instances/${id}`),
  world: () => call<World>("GET", "/api/world"),

  exportBundle: async (b: any): Promise<{ blob: Blob; filename: string; assets: number; media: number }> => {
    const res = await send("POST", "/api/export", JSON.stringify(b));
    const cd = res.headers.get("Content-Disposition") ?? "";
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? "babiverse-export.zip",
      assets: Number(res.headers.get("X-Babiverse-Assets") ?? 0), media: Number(res.headers.get("X-Babiverse-Media") ?? 0) };
  },
  imports: () => call<any[]>("GET", "/api/imports"),
  importPreview: (file: Blob, filename: string) => upload<any>("/api/imports?" + qs({ filename }), file),
  importApply: (id: string, decisions: Record<string, string>, import_scenes = true) => call<any>("POST", `/api/imports/${id}/apply`, { decisions, import_scenes }),
  importRollback: (id: string) => call<any>("POST", `/api/imports/${id}/rollback`),

  audit: (p: Record<string, string> = {}) => call<any[]>("GET", "/api/audit?" + qs(p)),
  users: () => call<any[]>("GET", "/api/users"),
  createUser: (b: any) => call<any>("POST", "/api/users", b),
  updateUser: (id: number, b: any) => call<any>("PATCH", `/api/users/${id}`, b),
};

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

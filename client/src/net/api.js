// Client HTTP : jeton de session, clés d'idempotence, reprises automatiques, état de connexion.
import { bus } from '../state/store.js';

const TOKEN_KEY = 'babiverse.token';
const TIMEOUT_MS = 8000;
const RETRIES = 3;

function safeStorage(fn, fallback = null) {
  try { return fn(); } catch { return fallback; }
}

export const auth = {
  get token() { return safeStorage(() => localStorage.getItem(TOKEN_KEY)); },
  set token(value) {
    safeStorage(() => (value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY)));
  },
};

/** Identifiant aléatoire ; crypto.randomUUID n'existe pas hors HTTPS (test sur réseau local). */
export function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ApiError extends Error {
  constructor(code, message, status, body) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

let online = true;
function setOnline(value) {
  if (online !== value) {
    online = value;
    bus.emit('network', value);
  }
}
export const isOnline = () => online;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ordre des positions : chaque requête qui porte `pos` est horodatée par cet onglet (horloge croissante) ; le serveur
// ignore une position plus ancienne qu'une autre déjà appliquée pour le même onglet (requête lente arrivée après un
// changement de zone : battement de cœur, rencontres).
export const CLIENT_ID = Math.random().toString(36).slice(2, 12);
const posClock = () => Math.round((performance.timeOrigin || 0) + performance.now());
export function stampPos(body) {
  if (!body || typeof body !== 'object' || !body.pos || typeof body.pos !== 'object') return body;
  return { ...body, pos: { ...body.pos, t: posClock(), c: CLIENT_ID } };
}

/**
 * Envoie une requête. Les actions critiques reçoivent une clé d'idempotence unique,
 * réutilisée à l'identique pour chaque nouvelle tentative : le serveur ne l'appliquera qu'une fois.
 */
export async function request(method, path, body, { idempotent = false, keepalive = false, retries = RETRIES } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (idempotent) headers['Idempotency-Key'] = newKey();
  body = stampPos(body); // horodaté une fois : les nouvelles tentatives gardent le même instant

  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`/api/${path}`, {
        method, headers, keepalive, signal: ctrl.signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.status >= 500 || res.status === 429) {
        lastError = new ApiError('server_unavailable', 'Le serveur ne répond pas correctement.', res.status, data);
      } else {
        setOnline(true);
        if (res.status === 401) bus.emit('auth-lost');
        if (!res.ok || data.ok === false) {
          const err = data.error || {};
          throw new ApiError(err.code || 'error', err.message || 'Action refusée.', res.status, data);
        }
        return data;
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;
      lastError = new ApiError('network', 'Connexion impossible.', 0);
    }
    if (attempt < retries - 1) await sleep(400 * 2 ** attempt);
  }
  setOnline(false);
  throw lastError;
}

export const api = {
  config: () => request('GET', 'config'),
  atelierPack: () => request('GET', 'atelier/pack'),
  register: (data) => request('POST', 'auth/register', data),
  login: (username, password) => request('POST', 'auth/login', { username, password }),
  logout: (everywhere = false) => request('POST', 'auth/logout', { everywhere }),
  account: () => request('GET', 'account'),
  changePassword: (current, next) => request('POST', 'auth/password/change', { current_password: current, new_password: next }),
  forgotPassword: (login) => request('POST', 'auth/password/forgot', { login }),
  setEmail: (email, password) => request('POST', 'auth/email', { email, password }),
  resendEmail: () => request('POST', 'auth/email/resend'),
  verifyEmail: (token) => request('POST', 'auth/email/verify', { token }),
  resetPassword: (token, password) => request('POST', 'auth/password/reset', { token, password }),
  state: () => request('GET', 'state'),
  createCharacter: (data) => request('POST', 'character', data),
  deleteCharacter: () => request('DELETE', 'character'),
  deleteAccount: () => request('DELETE', 'account'),
  reportBug: (message, zone) => request('POST', 'feedback', { message, zone }),
  presence: () => request('GET', 'presence'),
  /** Rencontres entre joueurs : poll, request, respond, read, cancel, hangup, signal, unfriend, message, messages/read. */
  social: (path, body) => request('POST', `social/${path}`, body),
  // Boucle périodique : pas de reprise, le tour suivant (1 à 2 s plus tard) en tient lieu.
  socialPoll: (body) => request('POST', 'social/poll', body, { retries: 1 }),
  sync: (pos, opts) => request('POST', 'sync', { pos }, opts),
  action: (path, body, idempotent = true) => request('POST', path, body, { idempotent }),
};

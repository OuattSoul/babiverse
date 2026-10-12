// Publicités de la ville (module pur, testé).
//
// Séparation des responsabilités :
// - support physique : AD_SLOTS (shared/city.json) : position, type de support, dimensions ;
// - annonce : ADVERTS (shared/ads.json) : annonceur, titre, description, image, lien, dates ;
// - affectation : PLACEMENTS (shared/ads.json) : statut de l'emplacement et annonce associée ;
// - campagne d'un joueur : état serveur (store.state.world.ads), prioritaire sur un emplacement libre ;
// - statistiques : game/adTracking.js.
// Remplacer une annonce ne demande donc ni de toucher à la géométrie ni de reconstruire la scène.
import ADS from '../../../shared/ads.json';

export const ADVERTS = ADS.adverts;
export const PLACEMENTS = ADS.placements;
export const SLOT_STATUSES = ['free', 'reserved', 'active', 'disabled'];

export const SUPPORT_LABELS = {
  billboard: 'Panneau en bord de route',
  totem: 'Totem de zone commerciale',
};

/** Lien externe acceptable : HTTPS uniquement, sans identifiants, longueur raisonnable. Sinon null. */
export function safeExternalUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  return url.href;
}

/** Image d'annonce : fichier du jeu (chemin absolu local) ou adresse HTTPS. Sinon null. */
export function safeImageUrl(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('..')) return raw;
  return safeExternalUrl(raw);
}

/**
 * Ce que montre un emplacement à l'instant `now` (ms).
 * Retourne { status: 'active'|'free'|'reserved'|'disabled', ad?, source?, issue? } où `issue`
 * explique pourquoi une affectation n'est pas diffusée : missing, inactive, expired, scheduled, invalid.
 */
export function resolveSlot(slotId, { placements = PLACEMENTS, adverts = ADVERTS, live = null, now = Date.now() } = {}) {
  const placement = placements[slotId] || { status: 'free' };
  if (placement.status === 'disabled') return { status: 'disabled' };
  if (live && Date.parse(live.ends_at) > now) {
    return {
      status: 'active', source: 'player',
      ad: {
        id: `campaign_${slotId}`, title: live.title, description: live.subtitle,
        advertiser: live.mine ? 'Ton entreprise' : live.owner, bg: live.bg, fg: live.fg,
        image: null, link: null, endsAt: live.ends_at, mine: !!live.mine,
      },
    };
  }
  if (placement.status === 'reserved') return { status: 'reserved' };
  if (placement.status !== 'active') return { status: 'free' };
  const ad = adverts[placement.ad];
  if (!ad) return { status: 'free', issue: 'missing' };
  if (ad.status && ad.status !== 'active') return { status: 'free', issue: 'inactive' };
  if (ad.ends_at && Date.parse(ad.ends_at) <= now) return { status: 'free', issue: 'expired' };
  if (ad.starts_at && Date.parse(ad.starts_at) > now) return { status: 'free', issue: 'scheduled' };
  const image = safeImageUrl(ad.image);
  if (!ad.title || !image) return { status: 'free', issue: 'invalid' };
  return {
    status: 'active', source: 'catalog',
    ad: {
      id: placement.ad, title: ad.title, description: ad.description || '', advertiser: ad.advertiser || '',
      bg: ad.bg || '#2c3e50', fg: ad.fg || '#ffffff', image, link: safeExternalUrl(ad.url), endsAt: ad.ends_at || null,
    },
  };
}

/** Visuel d'un support sans annonce diffusée (libre, réservé, hors service). */
export function placeholderFor(view) {
  if (view.status === 'reserved') return { title: 'RÉSERVÉ', subtitle: 'Une annonce arrive bientôt', bg: '#d6dbdf', fg: '#2c3e50' };
  if (view.status === 'disabled') return { title: 'HORS SERVICE', subtitle: '', bg: '#7f8c8d', fg: '#ecf0f1' };
  return { title: 'VOTRE PUB ICI', subtitle: 'Emplacement disponible', bg: '#f5f0e6', fg: '#2b2118', dashed: true };
}

export const ISSUE_TEXT = {
  missing: "L'annonce prévue pour cet emplacement est introuvable.",
  inactive: "L'annonce prévue pour cet emplacement est suspendue.",
  expired: "L'annonce qui occupait cet emplacement a expiré.",
  scheduled: 'Une annonce est programmée ici prochainement.',
  invalid: "L'annonce prévue pour cet emplacement est incomplète.",
};

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { orbitPosition, outdoorZoomFor, panDelta, clampToBounds, mapBounds, ZOOM } from '../src/engine3d/cameraMath.js';
import { ADVERTS, resolveSlot, safeExternalUrl, safeImageUrl } from '../src/world/ads.js';
import { PLOTS } from '../src/world/city.js';
import { plotView } from '../src/world/plots.js';
import { exceedsSlop, isTap, POINTER, wheelIntent } from '../src/world/pointer.js';
import { buildSelectables, navigationOf, pickSelectable, resolveTap } from '../src/world/selectables.js';
import { describeSelection } from '../src/world/selection.js';
import { ZONES } from '../src/world/zones.js';

const city = ZONES.quartier;
const maison = ZONES.maison;
const citySel = buildSelectables(city);
const maisonSel = buildSelectables(maison);
const NOW = Date.parse('2026-10-10T12:00:00Z');

/** Rayon d'un clic visant le point `aim` (unités 3D) avec une caméra orbitale donnée (écran 360×740). */
function rayTo(aim, { target = aim, yaw = 0.35, pitch = 1.0, dist = 17 } = {}) {
  const cam = new THREE.PerspectiveCamera(55, 360 / 740, 0.1, 400);
  const p = orbitPosition(target, yaw, pitch, dist);
  cam.position.set(p.x, p.y, p.z);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld();
  const ndc = new THREE.Vector3(aim.x, aim.y, aim.z).project(cam);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  return ray.ray;
}
const center = (id, y = 0.6) => {
  const b = citySel.find((s) => s.id === id).boxes[0];
  return { x: (b.x0 + b.x1) / 2, y, z: (b.z0 + b.z1) / 2 };
};

describe('gestes : clic ou glissement', () => {
  it('un glissement de souris au-delà du seuil n\'est pas un clic', () => {
    expect(exceedsSlop('mouse', 20, 0)).toBe(true);
    expect(isTap({ button: 0, dragged: true, ms: 120 })).toBe(false);
  });

  it('un toucher bref avec un léger tremblement du doigt reste un toucher', () => {
    expect(exceedsSlop('touch', 7, 6)).toBe(false);
    expect(isTap({ button: 0, dragged: false, ms: 140 })).toBe(true);
  });

  it('le seuil est plus strict à la souris qu\'au doigt, et configurable', () => {
    expect(exceedsSlop('mouse', 9, 0)).toBe(true);
    expect(exceedsSlop('touch', 9, 0)).toBe(false);
    expect(exceedsSlop('touch', 9, 0, { ...POINTER, tapSlop: { touch: 4 } })).toBe(true);
  });

  it('pincement, appui long et clic droit ne sont jamais des clics', () => {
    expect(isTap({ button: 0, multi: true, ms: 100 })).toBe(false);
    expect(isTap({ button: 0, ms: POINTER.tapMaxMs + 1 })).toBe(false);
    expect(isTap({ button: 2, ms: 100 })).toBe(false);
  });

  it('molette et pincement du pavé tactile zooment ; défilement horizontal à deux doigts déplace', () => {
    expect(wheelIntent({ deltaY: 100 })).toBe('zoom');
    expect(wheelIntent({ deltaY: 3, ctrlKey: true })).toBe('zoom');
    expect(wheelIntent({ deltaX: 14, deltaY: 2 })).toBe('pan');
  });
});

describe('caméra : limites de la carte', () => {
  it('un glissement ne sort pas la caméra de la carte (marge comprise)', () => {
    const b = mapBounds(city.map[0].length, city.map.length);
    const t = { x: 50, z: 30 };
    for (let i = 0; i < 50; i++) { const d = panDelta(-300, -300, 0, 17, 740); clampToBounds(Object.assign(t, { x: t.x + d.x, z: t.z + d.z }), b); }
    expect(t.x).toBe(b.maxX);
    expect(t.z).toBe(b.maxZ);
  });
});

describe('modèle de sélection', () => {
  it('chaque bâtiment est sélectionnable et regroupe les éléments de sa façade', () => {
    for (const b of city.buildings) expect(citySel.some((s) => s.id === `bld_${b.id}`), b.id).toBe(true);
    expect(citySel.find((s) => s.id === 'bld_kouassi').attached).toEqual(expect.arrayContaining(['door_kouassi', 'drop_sud_1']));
    expect(citySel.some((s) => s.id === 'bld_maison')).toBe(false);
    expect(citySel.find((s) => s.id === 'bld_epicerie').category).toBe('shop');
    expect(citySel.find((s) => s.id === 'bld_epicerie').attached).toEqual(expect.arrayContaining(['door_epicerie', 'drop_epicerie']));
  });

  it('parcelles, panneaux et kiosque ont leur propre volume ; le décor aucun', () => {
    for (const p of PLOTS) expect(citySel.find((s) => s.id === `plot_${p.id}`)?.category).toBe('plot');
    expect(citySel.filter((s) => s.category === 'billboard')).toHaveLength(city.interactables.filter((i) => i.type === 'billboard').length);
    expect(citySel.find((s) => s.id === 'kiosk').category).toBe('shop');
    expect(citySel.some((s) => s.category === 'decor')).toBe(false);
  });

  it('le logement distingue meubles et porte', () => {
    expect(maisonSel.find((s) => s.id === 'lit').category).toBe('furniture');
    expect(maisonSel.find((s) => s.id === 'frigo').category).toBe('furniture');
    expect(maisonSel.find((s) => s.id === 'sortie_maison').category).toBe('door');
  });

  it("un élément décoratif placé devant ne bloque pas l'objet interactif derrière lui", () => {
    const zone = { interactables: [{ id: 'arbre', type: 'info', category: 'decor', tile: [5, 12] }], buildings: [city.buildings[0]] };
    const items = buildSelectables(zone);
    expect(items.map((i) => i.id)).toEqual(['bld_voisin_nord']);
    // Même avec un volume décoratif explicitement sur le trajet du rayon.
    const decor = { id: 'arbre', category: 'decor', boxes: [{ x0: 7, z0: 11, x1: 10, z1: 12, y0: 0, y1: 3 }] };
    const ray = rayTo(center('bld_voisin_nord'));
    expect(pickSelectable(ray, [decor, ...items])?.item.id).toBe('bld_voisin_nord');
  });

  it('un petit objet passe devant le grand volume qui le contient (priorité de catégorie)', () => {
    const big = { id: 'b', category: 'building', boxes: [{ x0: 0, z0: 0, x1: 4, z1: 2, y0: 0, y1: 2 }] };
    const door = { id: 'd', category: 'door', boxes: [{ x0: 1, z0: 1.2, x1: 2, z1: 2, y0: 0, y1: 1.3 }] };
    const ray = { origin: { x: 1.5, y: 1, z: 10 }, direction: { x: 0, y: 0, z: -1 } };
    expect(pickSelectable(ray, [big, door]).item.id).toBe('d');
  });
});

describe('clic dans la ville (navigation par caméra)', () => {
  const nav = navigationOf(city);
  const views = {
    'vue par défaut': {},
    'après zoom avant': { dist: 6, pitch: 0.8 },
    'après zoom arrière': { dist: 30, pitch: 1.3 },
    'après rotation': { yaw: -1.1 },
  };

  it('la ville est en navigation par caméra', () => expect(nav).toBe('camera'));

  for (const [label, cam] of Object.entries(views)) {
    it(`un clic sur un bâtiment le sélectionne sans déplacement (${label})`, () => {
      for (const id of ['bld_kouassi', 'bld_epicerie', 'bld_pharmacie']) {
        const pick = pickSelectable(rayTo(center(id), cam), citySel);
        expect(pick?.item.id, id).toBe(id);
        expect(resolveTap({ navigation: nav, pick, ground: { x: 1, y: 1 } })).toEqual({ kind: 'select', id });
      }
    });
  }

  it('un clic sur une parcelle ou un panneau les sélectionne, même après un déplacement de caméra', () => {
    const panned = { target: { x: 30, y: 0.5, z: 20 } };
    const plot = PLOTS.find((p) => p.id === 'P04');
    const aim = { x: plot.x + 1, y: 0.06, z: plot.y + 1.5 };
    expect(pickSelectable(rayTo(aim), citySel)?.item.id).toBe('plot_P04');
    expect(pickSelectable(rayTo(aim, { ...panned, target: { x: 40, y: 0.5, z: 10 } }), citySel)?.item.id).toBe('plot_P04');
    expect(pickSelectable(rayTo(center('ad_pub_place', 1.8), panned), citySel)?.item.id).toBe('ad_pub_place');
  });

  it('un clic sur le sol de la ville ne fait rien (jamais de marche automatique)', () => {
    const pick = pickSelectable(rayTo({ x: 20, y: 0, z: 14 }), citySel);
    expect(pick).toBeNull();
    expect(resolveTap({ navigation: nav, pick, ground: { x: 640, y: 448 } })).toEqual({ kind: 'none' });
  });
});

describe('clic dans le logement (navigation par clic)', () => {
  const nav = navigationOf(maison);
  const view = { target: { x: 5, y: 0.5, z: 4 }, yaw: 0, dist: 10, pitch: 1.1 };

  it('un clic sur le sol donne une destination au personnage', () => {
    const pick = pickSelectable(rayTo({ x: 3.5, y: 0, z: 5.5 }, view), maisonSel);
    expect(pick).toBeNull();
    expect(resolveTap({ navigation: nav, pick, ground: { x: 112, y: 176 } })).toEqual({ kind: 'walk', point: { x: 112, y: 176 } });
  });

  it("un clic sur un meuble le sélectionne et n'en fait pas une destination", () => {
    const pick = pickSelectable(rayTo({ x: 2, y: 0.4, z: 1.5 }, view), maisonSel);
    expect(pick?.item.id).toBe('lit');
    expect(resolveTap({ navigation: nav, pick, ground: { x: 64, y: 48 } })).toEqual({ kind: 'select', id: 'lit' });
  });

  it('la porte est sélectionnable', () => {
    expect(pickSelectable(rayTo({ x: 4.5, y: 0.6, z: 7.5 }, view), maisonSel)?.item.id).toBe('sortie_maison');
  });
});

describe('parcelles', () => {
  const p04 = PLOTS.find((p) => p.id === 'P04');

  it('parcelle disponible : achat possible seulement si le joueur est éligible', () => {
    expect(plotView(p04, { price: 15000, balance: 20000 })).toMatchObject({ state: 'available', eligible: true, reason: null, size: '5×5 cases' });
    expect(plotView(p04, { price: 15000, balance: 100 })).toMatchObject({ state: 'available', eligible: false });
    expect(plotView(p04, { price: 15000, balance: 20000, ownsPlot: true }).eligible).toBe(false);
  });

  it('parcelle occupée : propriétaire et bâtiment, jamais achetable', () => {
    const claim = { owner: 'Awa', mine: false, building: { template: 'boutique', name: 'Chez Awa' } };
    expect(plotView(p04, { claim, price: 15000, balance: 1e6 })).toMatchObject({ state: 'occupied', eligible: false, owner: 'Awa' });
  });

  it('parcelle indisponible : motif affiché', () => {
    const p = PLOTS.find((q) => q.status === 'unavailable');
    expect(p).toBeTruthy();
    expect(plotView(p, { price: 15000, balance: 1e6 })).toMatchObject({ state: 'unavailable', eligible: false, reason: p.reason });
  });
});

describe('publicités', () => {
  const advert = { title: 'Test', description: 'Desc', image: '/ads/x.svg', url: 'https://example.com/x', status: 'active', ends_at: '2027-01-01T00:00:00Z' };
  const opts = (placement, ad = advert) => ({ placements: { s: placement }, adverts: { a: ad }, now: NOW });

  it("valide les liens : HTTPS uniquement", () => {
    expect(safeExternalUrl('https://example.com/offre?x=1')).toBe('https://example.com/offre?x=1');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pw@example.com', '//example.com', 'pas une url', '', null]) {
      expect(safeExternalUrl(bad), String(bad)).toBeNull();
    }
    expect(safeImageUrl('/ads/x.svg')).toBe('/ads/x.svg');
    expect(safeImageUrl('//evil.example/x.png')).toBeNull();
    expect(safeImageUrl('/ads/../../secret')).toBeNull();
  });

  it('états distincts : active, libre, réservée, hors service', () => {
    expect(resolveSlot('s', opts({ status: 'active', ad: 'a' }))).toMatchObject({ status: 'active', ad: { title: 'Test', link: 'https://example.com/x' } });
    expect(resolveSlot('s', opts({ status: 'free' })).status).toBe('free');
    expect(resolveSlot('s', opts({ status: 'reserved' })).status).toBe('reserved');
    expect(resolveSlot('s', opts({ status: 'disabled' })).status).toBe('disabled');
    expect(resolveSlot('inconnu', opts({ status: 'active', ad: 'a' })).status).toBe('free');
  });

  it('annonce absente, inactive, expirée ou incomplète : support vide, jamais de fiche invalide', () => {
    expect(resolveSlot('s', opts({ status: 'active', ad: 'zzz' }))).toEqual({ status: 'free', issue: 'missing' });
    expect(resolveSlot('s', opts({ status: 'active', ad: 'a' }, { ...advert, status: 'inactive' }))).toEqual({ status: 'free', issue: 'inactive' });
    expect(resolveSlot('s', opts({ status: 'active', ad: 'a' }, { ...advert, ends_at: '2026-01-01T00:00:00Z' }))).toEqual({ status: 'free', issue: 'expired' });
    expect(resolveSlot('s', opts({ status: 'active', ad: 'a' }, { ...advert, image: 'javascript:x' }))).toEqual({ status: 'free', issue: 'invalid' });
  });

  it("un lien non HTTPS n'empêche pas l'annonce mais supprime le bouton", () => {
    expect(resolveSlot('s', opts({ status: 'active', ad: 'a' }, { ...advert, url: 'http://example.com' })).ad.link).toBeNull();
  });

  it('une campagne de joueur occupe un emplacement libre jusqu\'à son expiration', () => {
    const live = { title: 'KIOSQUE DE AWA', subtitle: 'Boissons', owner: 'Awa', mine: false, bg: '#000', fg: '#fff', ends_at: '2026-10-11T00:00:00Z' };
    expect(resolveSlot('pub_place', { live, now: NOW })).toMatchObject({ status: 'active', source: 'player', ad: { title: 'KIOSQUE DE AWA', link: null } });
    expect(resolveSlot('pub_place', { live, now: Date.parse('2026-10-12T00:00:00Z') }).status).toBe('free');
  });

  it('les annonces de démonstration sont valides (image locale, lien HTTPS)', () => {
    for (const [id, ad] of Object.entries(ADVERTS)) {
      expect(safeImageUrl(ad.image), id).toBeTruthy();
      expect(safeExternalUrl(ad.url), id).toBeTruthy();
    }
  });
});

describe('fiches de sélection', () => {
  const store = {
    state: { world: { plots: {}, ads: {} }, character: { balance: 20000 }, business: { open: false }, job: { active: null }, missions: [] },
    config: { plot_price: 15000, ad_rental: { price: 2000 } },
    serverNow: () => new Date(NOW),
  };
  const actions = { buyPlot: vi.fn(), inspect: vi.fn(), enterDoor: vi.fn(), openBuildPanel: vi.fn(), rentAd: vi.fn() };
  const ctx = { store, actions, ui: {}, scene: {} };
  const byId = new Map([...city.interactables].map((i) => [i.id, i]));
  const sel = (id) => describeSelection(citySel.find((s) => s.id === id), ctx, byId);

  it("fiche d'une publicité : image complète, titre, description, lien", () => {
    const d = sel('ad_pub_avenue_ouest');
    expect(d.view).toBe('ad');
    expect(d.ad).toMatchObject({ title: 'Garba Chez Adjoua', image: '/ads/garba-adjoua.svg', link: 'https://example.com/garba-chez-adjoua' });
    expect(d.ad.description.length).toBeGreaterThan(10);
  });

  it("un support libre n'ouvre pas de fiche d'annonce", () => {
    const d = sel('ad_pub_place');
    expect(d.view).toBe('info');
    expect(d.title).toBe('Emplacement publicitaire libre');
  });

  it("fiche d'une parcelle disponible : informations et bouton Acheter, sans achat à la sélection", () => {
    const d = sel('plot_P04');
    expect(d.facts.map(([k]) => k)).toEqual(['Identifiant', 'Dimensions', 'Catégorie', 'Prix', 'Conditions']);
    const buy = d.actions.find((a) => a.id === 'buy');
    expect(buy).toMatchObject({ enabled: true, remote: true });
    expect(actions.buyPlot).not.toHaveBeenCalled();
    buy.run();
    expect(actions.buyPlot).toHaveBeenCalledWith('P04', '5×5');
  });

  it("fiche d'une parcelle indisponible : motif, aucun achat", () => {
    const id = PLOTS.find((p) => p.status === 'unavailable').id;
    const d = sel(`plot_${id}`);
    expect(d.subtitle).toBe('Non disponible');
    expect(d.actions.some((a) => a.id === 'buy')).toBe(false);
  });

  it("fiche d'un bâtiment : informations et actions de proximité (entrer)", () => {
    const d = sel('bld_kouassi');
    expect(d.title).toBe('Maison des Kouassi');
    expect(d.actions).toEqual([expect.objectContaining({ id: 'enter', source: 'door_kouassi' })]);
    expect(d.actions[0].remote).toBeFalsy();
  });
});

describe('zoom de la ville selon sa taille', () => {
  it('garde les réglages de base pour la carte actuelle et recule pour une carte plus grande', () => {
    expect(outdoorZoomFor(56, 40)).toMatchObject({ overview: ZOOM.outdoor.overview, max: ZOOM.outdoor.max });
    const big = outdoorZoomFor(112, 40);
    expect(big.overview).toBe(ZOOM.outdoor.overview * 2);
    expect(big.max).toBeGreaterThan(big.overview);
    expect(big.min).toBe(ZOOM.outdoor.min);
  });
});

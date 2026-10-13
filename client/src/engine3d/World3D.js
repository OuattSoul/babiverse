// Monde 3D : rendu Three.js, caméra orbitale, joueur, PNJ, interactions, transitions.
// La logique de jeu (collisions, interactions, actions, état serveur) est inchangée :
// seules la représentation et les commandes de caméra sont propres à ce module.
import * as THREE from 'three';
import { actions } from '../game/actions.js';
import { api } from '../net/api.js';
import { dayPhase } from '../sim/needs.js';
import { bus, store } from '../state/store.js';
import { ui } from '../ui/ui.js';
import { anchorOf, buildGrid, frontOf, moveBody, rectCollides, TILE } from '../world/grid.js';
import { findTarget, primaryAction } from '../world/interaction.js';
import { actionsFor, slotView } from '../world/interactionTypes.js';
import { NPCS } from '../world/npcs.js';
import { findPath, nearestWalkable } from '../world/pathfinding.js';
import { PLAYER_BUILDINGS, PLOTS } from '../world/city.js';
import { buildSelectables, navigationOf, npcSelectables, pickSelectable, resolveTap } from '../world/selectables.js';
import { describeSelection } from '../world/selection.js';
import { adTracking } from '../game/adTracking.js';
import { resolveZoneRequest, setResidentialBlocks, ZONES, zoneById } from '../world/zones.js';
import { freeLots, homeBuildings, lotSelectables } from '../world/residential.js';
import { exitSpawnOf, interiorIdOf } from '../world/interiors.js';
import { KioskCustomers, Npc } from './actors.js';
import { RemotePlayers } from './remotePlayers.js';
import { CityAmbient } from './ambient.js';
import { buildBuilding, buildFreeLots, buildProp, buildZone, makeMarker, makeRing, setNight } from './builders.js';
import { CameraRig } from './CameraRig.js';
import { clamp, inputToWorld, outdoorZoomFor, ZOOM } from './cameraMath.js';
import { animateCharacter, buildCharacter, faceTowards, setDiscShadows } from './character.js';
import { setAnimationViewer } from './characterKit.js';
import { quality, qualityFor, shadowExtent, snapToTexel, tooSlow } from './quality.js';
import { roamerDefs } from '../atelier/pack.js';
import { keyboardVector, touchInput } from './input.js';
import { disposeGroup, iconSprite, mat, textSprite } from './materials.js';
import { placeIcon } from '../world/icons.js';
import { buildLandscapes, detachLandscapes } from './landscapes.js';
import { modelCache } from './modelCache.js';
import { prefetchPlan } from '../world/dataMaps.js';

const SPEED = 115; // px/s
const BODY = { hw: 7, hh: 5 };
const SCAN_MS = 100;
const SMOOTH_GRACE_MS = 10000;
const MARKER_Y = { npc: 2.3, door: 1.75, default: 1.6 };
// Niveaux de détail selon la distance de la caméra (unités) : petit mobilier et noms des habitants
// de près, étiquettes des lieux de loin (elles grossissent avec la distance pour rester lisibles).
const LOD = { details: 30, npcNames: 34, labelsFrom: 22, labelsFull: 30, labelY: 2.15 };
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const isMobile = matchMedia('(pointer: coarse)').matches;
// Direction du soleil (de la cible vers le soleil) : il suit la caméra, l'angle des ombres reste le même.
const SUN_DIR = new THREE.Vector3(-12, 20, 8).normalize();

export class World3D {
  constructor(container) {
    this.container = container;
    this.ui = ui;
    actions.scene = this;
    // Anticrénelage fixé au lancement ; finesse, ombres et cadence suivent l'économie de batterie (applyQuality).
    const q = qualityFor({ dpr: window.devicePixelRatio, mobile: isMobile, saver: quality.saver });
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x6b5a45, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sun.position.copy(SUN_DIR).multiplyScalar(25);
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.shadowExtent = 0;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.rig = new CameraRig(this.renderer.domElement, {
      onTap: (x, y) => this.onTap(x, y),
      onFreeChange: (free) => { document.getElementById('btn-recenter').hidden = !free; },
    });
    this.time = 0;
    this.floating = [];
    this.frames = 0;
    this.fpsValue = 60;
    this.fpsAt = performance.now();
    this.unsubscribe = bus.on('state', () => this.refreshWorldState());
    // Fermeture d'une fiche : la sélection disparaît, le contrôle revient au joueur.
    bus.on('sheet-closed', () => { this.selected = null; });
    window.addEventListener('resize', () => this.resize());
    bus.on('quality', () => this.applyQuality());
    this.applyQuality();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // --- Zones ----------------------------------------------------------------------
  loadZone(zoneId, { spawn, pos } = {}) {
    if (this.zoneGroup) {
      detachLandscapes(this.landscapes);
      this.remotes?.clear();
      this.customers?.destroy();
      this.ambient?.destroy();
      this.scene.remove(this.zoneGroup);
      disposeGroup(this.zoneGroup);
    }
    setResidentialBlocks(this.residentialBlocks());
    // Zone introuvable (carte de l'atelier retirée ou indisponible) : Cité Akwaba, point de départ, message.
    const req = resolveZoneRequest(zoneId, this.playerBuildingList(), { spawn, pos });
    if (req.fallback) ui.toast("Ce lieu n'est plus accessible : retour à la Cité Akwaba.", "error", 3500);
    ({ spawn, pos } = req);
    this.zone = req.zone;
    this.zoneId = this.zone.id;
    this.fpsSamples = [];
    // Premières secondes d'une zone lentes (shaders, premières images) : pas de mesure de fluidité.
    this.smoothFrom = performance.now() + SMOOTH_GRACE_MS;
    this.fronts = new Map();
    this.grid = buildGrid(this.zone, this.playerBuildingRects());
    this.worldKey = null;
    const built = buildZone(this.zone, (def) => this.propState(def));
    this.zoneGroup = built.group;
    // Paysages 3D (cartes publiées par l'atelier) : posés tout de suite, modèles chargés en arrière-plan.
    // Les modèles qu'aucune zone chargée n'utilise plus sont libérés.
    this.landscapes = this.zone.landscapes?.length
      ? buildLandscapes(this.zone, modelCache, { origin: pos ? [pos.x / TILE, pos.y / TILE] : this.spawnTile(this.zone, spawn), onError: () => ui.toast("Un élément du décor n'a pas pu être chargé.", 'error', 2500) })
      : null;
    modelCache.release(this.landscapes?.urls || []);
    if (this.landscapes) this.zoneGroup.add(this.landscapes.group);
    this.schedulePrefetch();
    this.props = built.props;
    this.details = built.details;
    for (const p of this.props) p.object.userData.key = JSON.stringify(this.propState(p.def));
    this.playerGroup = new THREE.Group();
    this.zoneGroup.add(this.playerGroup);
    this.dynamicInteractables = [];
    this.scene.add(this.zoneGroup);
    this.buildings = this.zoneGroup.children.filter((o) => o.userData.kind === 'building');
    this.mapLabels = [];
    for (const b of this.zone.buildings || []) if (b.category === 'shop') this.addMapLabel(b);
    this.scene.background = new THREE.Color(this.zone.outdoor ? '#a8d8f0' : '#1d1d22');

    this.createPlayer(spawn, pos);
    this.remotes = new RemotePlayers(this);
    // PNJ de la zone, plus en ville les habitants de l'atelier qui n'ont pas de rôle (promeneurs).
    const npcDefs = this.zone.id === 'quartier' ? [...this.zone.npcs, ...roamerDefs(this.zone)] : this.zone.npcs;
    this.npcs = npcDefs.map((def) => {
      const info = NPCS[def.id];
      const c = anchorOf(def);
      return Object.assign(new Npc(this, { id: def.id, x: c.x, y: c.y, look: info.look, name: info.name, behavior: def.behavior }), { def });
    });
    this.customers = this.zone.customers ? new KioskCustomers(this, this.zone.customers) : null;
    this.ambient = this.zone.ambient ? new CityAmbient(this, this.zone.ambient) : null;

    this.targetMarker = makeMarker();
    this.targetMarker.visible = false;
    this.zoneGroup.add(this.targetMarker);
    this.selectionMarker = makeMarker(1.2, 0xffffff);
    this.selectionMarker.visible = false;
    this.zoneGroup.add(this.selectionMarker);
    this.selected = null;
    this.selectables = buildSelectables(this.zone);
    this.ring = makeRing();
    this.ring.visible = false;
    this.zoneGroup.add(this.ring);
    this.deliveryMarkers = [];
    this.giverBubbles = [];
    this.path = null;
    this.pending = null;
    this.current = null;
    this.lastScan = 0;
    this.transitioning = false;

    this.rig.setBounds(this.grid.w, this.grid.h);
    this.zoom = this.zone.outdoor ? outdoorZoomFor(this.grid.w, this.grid.h) : ZOOM.indoor;
    const zoom = this.zoom;
    this.rig.setZoomRange(zoom);
    this.rig.setDefaults(this.zone.outdoor ? { dist: zoom.default } : { dist: zoom.default, yaw: 0 });
    this.rig.recenter();
    this.rig.snapTo(this.player.body.x / TILE, this.player.body.y / TILE);
    this.updateDaylight();
    this.refreshWorldState();
    store.pos = { zone: this.zoneId, x: this.player.body.x, y: this.player.body.y };
    // Compile les shaders tout de suite plutôt qu'à la première image (évite un à-coup).
    this.rig.update(1, { x: this.player.body.x / TILE, z: this.player.body.y / TILE });
    this.renderer.compile(this.scene, this.rig.camera);
    ui.toast(this.zone.name, 'zone', 1800);
    bus.emit('zone', this.zoneId);
  }

  /**
   * Préchargement discret des modèles des cartes voisines (cache HTTP seulement), une fois la zone affichée et le
   * navigateur au repos. Rien n'est demandé depuis une zone sans passage vers une carte de l'atelier.
   */
  schedulePrefetch() {
    const plan = prefetchPlan(this.zone, (id) => this.zoneById(id), { cached: (u) => modelCache.has(u), connection: navigator.connection || null });
    this.prefetched = this.prefetched || new Set();
    const todo = plan.filter((u) => !this.prefetched.has(u));
    if (!todo.length) return;
    const run = () => { for (const u of todo) { this.prefetched.add(u); fetch(u, { priority: 'low' }).catch(() => this.prefetched.delete(u)); } };
    (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(run, { timeout: 4000 });
  }

  /** Mesures de rendu et de chargement (debug, tests de performance). */
  perfStats() {
    const info = this.renderer.info;
    return {
      zone: this.zoneId, fps: this.fpsValue, shadows: this.sun.castShadow, pixelRatio: this.renderer.getPixelRatio(), drawCalls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures,
      models: { ...modelCache.stats, cached: modelCache.size() }, landscapes: this.landscapes ? { ...this.landscapes.status, done: undefined } : null,
      prefetched: [...(this.prefetched || [])],
    };
  }

  /** Icône d'un lieu au-dessus de son toit (à la place de son nom), affichée quand la caméra est éloignée. */
  addMapLabel(b, mine = false) {
    // Pastille compacte : les étiquettes voisines ne se chevauchent pas ; le nom reste dans la fiche du lieu.
    const s = iconSprite(placeIcon(b), mine ? { bg: '#ffe2c4', ring: '#e67e22' } : {});
    s.userData.icon = placeIcon(b);
    s.position.set((b.x0 + b.x1 + 1) / 2, LOD.labelY, (b.y0 + b.y1 + 1) / 2);
    s.userData.base = s.scale.clone();
    s.visible = false;
    s.userData.player = 'owner' in b; // construction d'un joueur : étiquette refaite avec les constructions
    this.zoneGroup.add(s);
    this.mapLabels.push(s);
  }

  /** Détails et étiquettes selon la distance de la caméra ; brume repoussée quand on dézoome. */
  updateLod() {
    const d = this.rig.cur.dist;
    if (this.details) this.details.visible = d < LOD.details;
    for (const npc of this.npcs) if (npc.label) npc.label.visible = d < LOD.npcNames;
    const k = smooth(LOD.labelsFrom, LOD.labelsFull, d);
    const grow = Math.max(1, d / 20);
    for (const s of this.mapLabels) {
      s.visible = k > 0.01;
      if (!s.visible) continue;
      s.material.opacity = k;
      s.scale.copy(s.userData.base).multiplyScalar(grow);
    }
    if (this.scene.fog) {
      this.scene.fog.near = 15 + d;
      this.scene.fog.far = 58 + d * 1.6;
    }
  }

  resolveSpawn(spawn, p) {
    // Position sauvegardée valide ? Sinon point d'apparition (données incompatibles ou absentes).
    if (p && typeof p.x === 'number' && typeof p.y === 'number' && !rectCollides(this.grid, p.x, p.y, BODY.hw, BODY.hh)) return { x: p.x, y: p.y };
    const [tx, ty] = this.spawnTile(this.zone, spawn);
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }

  /** Zone par identifiant, y compris l'intérieur d'une construction de joueur. */
  zoneById(id) { return zoneById(id, this.playerBuildingList()); }

  /**
   * Case d'apparition : point nommé de la zone, ou devant la porte d'une construction de joueur
   * (from_pb_<parcelle>, connue seulement par l'état serveur). En sortant du studio (from_maison),
   * on réapparaît devant ma maison du lotissement.
   */
  spawnTile(zone, spawn) {
    const b = zone.outdoor && this.playerBuildingList().find((x) => exitSpawnOf(x.zone || x.id) === spawn);
    if (b) return [b.x0 + b.facade.indexOf('D'), b.facing === 'S' ? b.y1 + 1 : b.y0 - 1];
    return zone.spawns[spawn] || zone.spawns.default;
  }

  /** Entre dans un bâtiment touché dans la ville : fondu, puis le joueur est à l'intérieur. */
  enterBuilding(b) {
    // Construction ou maison d'un autre joueur : on n'entre pas (le serveur refuse aussi), la fiche s'ouvre.
    if (b.owner !== undefined && !b.mine) return false;
    const zone = interiorIdOf(b);
    if (!this.zoneById(zone)) return false;
    this.path = null;
    this.pending = null;
    this.transitionTo(zone, 'entree', () => this.rig.recenter());
    return true;
  }

  createPlayer(spawn, pos) {
    const start = this.resolveSpawn(spawn, pos);
    const model = buildCharacter({ ...store.state.character.appearance, pants: '#2c3e50' }, { hd: true });
    model.rotation.y = spawn?.startsWith('from_') ? 0 : Math.PI;
    const pkg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.22), mat('#b9770e'));
    pkg.position.set(0, model.userData.kit ? 1.72 : 1.32, 0); // colis porté sur la tête
    pkg.visible = false;
    model.add(pkg);
    this.zoneGroup.add(model);
    this.player = { body: { ...start, ...BODY }, model, pkg, speed: 0 };
    this.syncPlayer();
  }

  /** Nouvelle apparence (changée depuis « Mon profil ») : le modèle est reconstruit sur place. */
  refreshPlayerLook() {
    const p = this.player;
    if (!p) return;
    const model = buildCharacter({ ...store.state.character.appearance, pants: '#2c3e50' }, { hd: true });
    model.rotation.y = p.model.rotation.y;
    model.add(p.pkg);
    p.model.removeFromParent();
    disposeGroup(p.model);
    this.zoneGroup.add(model);
    p.model = model;
    this.syncPlayer();
  }

  syncPlayer() {
    const p = this.player;
    p.model.position.set(p.body.x / TILE, 0, p.body.y / TILE);
  }

  // --- Boucle ------------------------------------------------------------------------
  frame() {
    const now = performance.now();
    // Économie de batterie : une image sur deux environ (30 par seconde).
    if (this.quality.maxFps && now - this.last < 1000 / this.quality.maxFps - 2) return;
    const dt = Math.min(now - this.last, 50) / 1000;
    this.last = now;
    this.time += dt * 1000;
    this.frames++;
    if (now - this.fpsAt >= 1000) {
      this.fpsValue = (this.frames * 1000) / (now - this.fpsAt);
      this.frames = 0;
      this.fpsAt = now;
      this.watchSmoothness();
    }
    if (!this.zoneGroup || document.hidden) return;

    setAnimationViewer(this.rig.camera.position);
    this.movePlayer(dt);
    for (const npc of this.npcs) npc.update(this.time, dt, this.grid);
    this.remotes.update(dt, this.rig.cur.dist < LOD.npcNames);
    if (this.customers) {
      const kiosk = anchorOf(this.zone.interactables.find((i) => i.id === 'kiosk'));
      const p = this.player.body;
      this.customers.update(this.time, dt, this.grid, Math.hypot(p.x - kiosk.x, p.y - kiosk.y) < TILE * 5);
    }
    if (this.ambient) {
      const people = [this.player.body, ...this.npcs.map((n) => n.body), ...[...this.remotes.byId.values()].map((r) => r.body)];
      if (this.customers?.current) people.push(this.customers.current.npc.body);
      this.ambient.update(this.time, dt, people);
    }
    if (this.time - this.lastScan > SCAN_MS) { this.lastScan = this.time; this.scan(); this.updateOcclusion(); }
    if (touchInput.actionQueued) {
      touchInput.actionQueued = false;
      if (!store.modalOpen) this.interact();
    }
    this.animateMarkers(dt);
    this.rig.update(dt, { x: this.player.body.x / TILE, z: this.player.body.y / TILE });
    this.updateLod();
    this.updateSun();
    this.updateCompass();
    this.renderer.render(this.scene, this.rig.camera);
  }

  movePlayer(dt) {
    const p = this.player;
    let dir = null;
    if (touchInput.forced) dir = { x: touchInput.forced.x, z: touchInput.forced.y };
    else {
      const kb = keyboardVector();
      const ix = touchInput.x || kb.x;
      const iy = touchInput.y || kb.y;
      if (Math.hypot(ix, iy) > 0.01) dir = inputToWorld(ix, iy, this.rig.cur.yaw);
    }
    if (dir) {
      // Une commande manuelle annule le trajet en cours et recentre la caméra sur le joueur.
      this.path = null;
      this.pending = null;
      this.ring.visible = false;
      this.rig.recenter();
    } else if (this.path?.length) {
      const wp = this.path[0];
      const dx = wp.x - p.body.x;
      const dy = wp.y - p.body.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) {
        this.path.shift();
        if (!this.path.length) { this.path = null; this.ring.visible = false; }
      } else dir = { x: dx / d, z: dy / d, arrive: Math.min(1, d / 10) };
    }
    const len = dir ? Math.hypot(dir.x, dir.z) : 0;
    if (store.modalOpen || this.transitioning || len < 0.01) {
      p.speed = 0;
      animateCharacter(p.model, dt, 0, true);
      return;
    }
    const scale = (len > 1 ? 1 / len : 1) * (dir.arrive ?? 1);
    const tired = store.needs().energy < store.config.needs.tired_threshold ? 0.7 : 1;
    const step = SPEED * tired * dt;
    const before = { x: p.body.x, y: p.body.y };
    const dx = dir.x * scale * step;
    const dy = dir.z * scale * step;
    // Sous-pas : jamais plus d'un quart de case par itération (aucun passage à travers un mur).
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE / 4)));
    let pos = { ...p.body };
    for (let i = 0; i < steps; i++) pos = { ...pos, ...moveBody(this.grid, pos, dx / steps, dy / steps) };
    p.body.x = pos.x;
    p.body.y = pos.y;
    const moved = Math.hypot(p.body.x - before.x, p.body.y - before.y);
    p.speed = moved / Math.max(dt, 1e-3) / SPEED;
    faceTowards(p.model, dir.x, dir.z, dt);
    animateCharacter(p.model, dt, p.speed, true);
    this.syncPlayer();
    store.pos.x = p.body.x;
    store.pos.y = p.body.y;
    // Trajet bloqué (un PNJ ou un décor imprévu) : on abandonne.
    if (this.path && moved < step * 0.05) { this.path = null; this.ring.visible = false; }
  }

  // --- Interactions ------------------------------------------------------------------
  candidates() {
    const ctx = { store, actions, ui, scene: this };
    const list = [];
    for (const it of [...this.zone.interactables, ...this.dynamicInteractables]) {
      const acts = actionsFor(it, ctx);
      if (acts.length) list.push({ ...anchorOf(it), id: it.id, type: it.type, range: it.range, acts, front: this.frontFor(it) });
    }
    for (const npc of this.npcs) {
      list.push({ x: npc.x, y: npc.y, id: npc.id, type: 'npc', range: npc.def.range ?? 48, acts: actionsFor({ type: 'npc', npc: npc.id }, ctx) });
    }
    return list;
  }

  scan() {
    const target = findTarget(this.grid, this.player.body, this.candidates());
    this.current = target ? { ...target, action: primaryAction(target.acts) } : null;
    ui.setPrompt(this.current?.action || null);
    this.targetMarker.visible = !!this.current;
    // Arrivé à portée de l'élément choisi avec « Y aller » : l'action demandée se déclenche.
    if (this.pending) {
      const target = this.candidates().find((c) => c.id === this.pending.id);
      if (target && findTarget(this.grid, this.player.body, [target])) {
        const action = target.acts.find((a) => a.id === this.pending.action);
        this.pending = null;
        this.path = null;
        this.ring.visible = false;
        if (!action) return;
        if (action.enabled === false) ui.toast(action.reason, 'error');
        else action.run();
      }
    }
  }

  interact() {
    if (this.transitioning) return;
    this.scan();
    const action = this.current?.action;
    if (!action) return;
    if (action.enabled === false) { ui.toast(action.reason, 'error'); return; }
    action.run();
  }

  // --- Clic / toucher bref ----------------------------------------------------------------
  // Point d'entrée unique de tous les clics dans le monde (la caméra a déjà écarté les glissements).
  onTap(clientX, clientY) {
    if (this.transitioning || this.rig.gestureActive) return;
    // Une fiche d'objet ouverte se ferme d'un clic dans le monde ; les autres panneaux bloquent le clic.
    if (store.modalOpen) {
      if (ui.kind !== 'selection') return;
      ui.close();
    }
    const ray = this.rig.raycaster(clientX, clientY);
    const pick = pickSelectable(ray.ray, [...this.selectables, ...npcSelectables(this.npcs, TILE)]);
    const intent = resolveTap({ navigation: navigationOf(this.zone), pick, ground: pick ? null : this.groundHit(ray) });
    const building = intent.kind === 'select' && this.zone.outdoor ? this.selectableById(intent.id)?.building : null;
    if (building && this.enterBuilding(building)) return;
    if (intent.kind === 'select') this.select(intent.id);
    else if (intent.kind === 'walk' && !this.walkTo(intent.point)) ui.toast('Impossible d\'aller là.', 'error', 1500);
  }

  /** Point du décor visé (sol, mur...) en pixels de grille : destination d'un clic dans le logement. */
  groundHit(ray) {
    const hit = ray.intersectObject(this.zoneGroup, true)
      .find((h) => h.object.isMesh && h.object !== this.ring && h.object !== this.targetMarker && h.object !== this.selectionMarker);
    // (seuls les objets pleins comptent : les câbles électriques, très fins, ne doivent pas capter le clic)
    return hit ? { x: hit.point.x * TILE, y: hit.point.z * TILE } : null;
  }

  selectableById(id) {
    return this.selectables.find((s) => s.id === id) || npcSelectables(this.npcs, TILE).find((s) => s.id === id) || null;
  }

  /** Ouvre la fiche d'un objet sélectionnable. Ni le personnage ni la caméra ne bougent. */
  select(id) {
    if (!this.selectableById(id)) return;
    const ctx = { store, actions, ui, scene: this };
    const describe = () => {
      const item = this.selectableById(id);
      const interactables = new Map([...this.zone.interactables, ...this.dynamicInteractables].map((i) => [i.id, i]));
      return item ? describeSelection(item, ctx, interactables) : null;
    };
    const first = describe();
    if (first.view === 'ad') adTracking.track('open', { slot: first.slot, ad: first.ad.id });
    ui.selection({
      describe,
      near: (source) => this.isNear(source),
      approach: (action) => this.approach(action),
      onOpenLink: (ad) => actions.openAdLink(ad, first.slot),
    });
    this.selected = id;
  }

  /** Fiche de l'objet portant un élément interactif (le bâtiment pour une porte de la ville). */
  selectByInteractable(id) {
    const item = this.selectables.find((s) => s.attached.includes(id));
    if (item) this.select(item.id);
  }

  /** Le joueur est-il à portée (et en vue) de cet élément ou de ce PNJ ? */
  isNear(sourceId) {
    const target = this.candidates().find((c) => c.id === sourceId);
    return !!target && !!findTarget(this.grid, this.player.body, [target]);
  }

  /** « Y aller » : marche jusqu'à l'élément, puis exécute l'action choisie à l'arrivée. */
  approach(action) {
    const npc = this.npcs.find((n) => n.id === action.source);
    const dest = npc ? { x: npc.x, y: npc.y } : this.standPoint(action.source);
    if (!dest || !this.walkTo(dest, { id: action.source, action: action.id })) ui.toast('Impossible d\'aller là.', 'error', 1500);
  }

  /**
   * Changement de zone : fondu, sauvegarde immédiate de la position, construction de la zone.
   * onLoaded : appelé une fois la nouvelle zone construite (cadrage de la caméra, fiche...).
   */
  transitionTo(zone, spawn, onLoaded) {
    if (this.transitioning) return;
    // Destination indisponible (carte désactivée depuis le chargement du pack…) : on reste sur place.
    if (!this.zoneById(zone)) { ui.toast('Ce passage est fermé pour le moment.', 'error', 2500); return; }
    this.transitioning = true;
    ui.setPrompt(null);
    const [tx, ty] = this.spawnTile(this.zoneById(zone), spawn);
    store.pos = { zone, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    api.sync({ ...store.pos }).then((res) => store.apply(res.state)).catch(() => {});
    fade(true);
    setTimeout(() => { this.loadZone(zone, { spawn }); fade(false); onLoaded?.(); }, 220);
  }

  /** Fondu au noir pendant une action (sieste). */
  async fadeAction(fn) {
    this.transitioning = true;
    fade(true);
    await new Promise((r) => setTimeout(r, 450));
    try { await fn(); } finally {
      fade(false);
      this.transitioning = false;
    }
  }

  floatText(x, y, text) {
    const s = textSprite(text, { size: 26 });
    s.position.set(x / TILE, 2.0, y / TILE);
    s.userData.born = this.time;
    this.zoneGroup.add(s);
    this.floating.push(s);
  }

  makeBubble() {
    const s = textSprite('!', { size: 30, color: '#222', bg: '#f1c40f', scale: 0.012 });
    return s;
  }

  /** Côté praticable d'un élément posé dans un mur (porte, façade), mis en cache par zone. */
  frontFor(it) {
    if (!this.fronts.has(it.id)) {
      const a = anchorOf(it);
      const inWall = !it.w && rectCollides(this.grid, a.x, a.y, 1, 1);
      this.fronts.set(it.id, inWall ? frontOf(this.grid, it.tile[0], it.tile[1]) : { dx: 0, dy: 0 });
    }
    return this.fronts.get(it.id);
  }

  /**
   * Marche jusqu'à un point (pixels de grille) en suivant un chemin calculé.
   * pending : { id, action } à exécuter une fois à portée de l'élément `id`.
   */
  walkTo(dest, pending = null) {
    const path = findPath(this.grid, this.player.body, dest, BODY);
    if (!path) return false;
    this.path = path.length ? path : null;
    this.pending = pending;
    const end = path.at(-1) || dest;
    this.ring.position.set(end.x / TILE, 0.03, end.y / TILE);
    this.ring.visible = !!this.path;
    this.ring.scale.setScalar(1);
    this.rig.recenter();
    return true;
  }

  /** Point où se tenir pour utiliser un élément (case libre devant la porte, etc.). */
  standPoint(id) {
    const it = [...this.zone.interactables, ...this.dynamicInteractables].find((i) => i.id === id);
    if (!it) return null;
    const a = anchorOf(it);
    const f = this.frontFor(it);
    return { x: a.x + f.dx * TILE, y: a.y + f.dy * TILE };
  }

  // --- Menu de navigation ------------------------------------------------------------
  /** Va dans une zone (fondu) si on n'y est pas déjà, puis exécute `then`. */
  goToZone(zone, spawn, then) {
    if (this.transitioning) return;
    if (this.zoneId === zone) then?.();
    else this.transitionTo(zone, spawn, then);
  }

  /** Point d'apparition dans la ville quand on y revient depuis un intérieur (devant sa porte). */
  citySpawn() {
    const exit = this.zone.interactables.find((i) => i.type === 'door' && i.target?.zone === 'quartier');
    return exit?.target.spawn || 'default';
  }

  /** « Chez moi » : intérieur du logement du joueur. */
  goHome() {
    this.goToZone('maison', 'entree', () => this.rig.recenter());
  }

  /**
   * « Ville » : vue d'ensemble du quartier (caméra libre, dézoomée, centrée sur la carte).
   * Déjà en vue d'ensemble : retour au personnage à la distance habituelle.
   */
  showCity() {
    this.goToZone('quartier', this.citySpawn(), () => {
      const r = this.rig;
      if (r.free && r.goal.dist >= this.zoom.overview - 1) {
        r.goal.dist = ZOOM.outdoor.default;
        r.recenter();
        return;
      }
      r.lookAt(this.grid.w / 2, this.grid.h / 2, this.zoom.overview);
    });
  }

  /**
   * Cadre un objet sélectionnable de la ville et ouvre sa fiche (depuis la liste des opportunités).
   * ids : identifiants candidats, le premier présent dans la ville est retenu.
   */
  locate(ids) {
    this.goToZone('quartier', this.citySpawn(), () => {
      const item = [].concat(ids).map((id) => this.selectableById(id)).find(Boolean);
      if (!item) return;
      const id = item.id;
      const b = item.boxes.at(-1);
      this.rig.lookAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 14);
      this.select(id);
    });
  }

  /** Autres joueurs reçus par la boucle sociale ; ignorés s'ils concernent une autre zone (changement en cours). */
  syncRemotePlayers(players, zone, intervalS) {
    if (!this.remotes) return;
    if (zone !== this.zoneId || this.transitioning) this.remotes.clear();
    else this.remotes.sync(players, intervalS);
  }

  kioskOpen() { return !!store.state?.business?.open && !!this.props.find((p) => p.def.kind === 'kiosk'); }
  fps() { return this.fpsValue; }

  // --- État du monde lié à la simulation -------------------------------------------
  propState(def) {
    const world = store.state?.world;
    if (def.kind === 'kiosk') return { open: !!store.state?.business?.open };
    if (def.kind === 'plotsign') {
      const p = world?.plots?.[def.plot];
      if (p) return { owner: p.owner, mine: p.mine };
      return PLOTS.find((q) => q.id === def.plot)?.status === 'unavailable' ? { unavailable: true } : {};
    }
    if (def.kind === 'billboard') return { view: slotView(def.slot, store) };
    return {};
  }

  /** Bâtiments construits par les joueurs (état serveur partagé), en rectangles de cases. */
  playerBuildings() {
    return this.zone?.outdoor ? this.playerBuildingList() : [];
  }

  /** Blocs ouverts du lotissement, selon le serveur. */
  residentialBlocks() { return store.state?.world?.residential?.blocks || 1; }

  /** Constructions sur parcelle et maisons initiales du lotissement (état serveur). */
  playerBuildingList() {
    const homes = homeBuildings(store.state?.world?.residential?.homes || [], PLAYER_BUILDINGS);
    return [...this.plotBuildingList(), ...homes];
  }

  plotBuildingList() {
    return Object.entries(store.state?.world?.plots || {}).filter(([, p]) => p.building).map(([plot, p]) => {
      const t = PLAYER_BUILDINGS[p.building.template];
      const b = p.building;
      return {
        id: `pb_${plot}`, category: b.template === 'boutique' ? 'shop' : 'building',
        plot, owner: p.owner, mine: p.mine, name: b.name, template: b.template,
        x0: b.x0, y0: b.y0, x1: b.x0 + t.facade.length - 1, y1: b.y0 + 1,
        facade: t.facade, roof: t.roof, facing: b.facing,
        sign: t.sign ? { text: b.name.toUpperCase(), bg: p.mine ? '#e67e22' : '#34495e', fg: '#ffffff' } : null,
      };
    });
  }

  playerBuildingRects() { return this.playerBuildings().map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })); }

  /** Reconstruit constructions des joueurs, grille de collision et interactions associées. */
  refreshPlayerBuildings() {
    for (const o of [...this.playerGroup.children]) { o.removeFromParent(); disposeGroup(o); }
    const list = this.playerBuildings();
    this.grid = buildGrid(this.zone, list);
    this.fronts = new Map();
    this.dynamicInteractables = list.map((b) => {
      const door = [b.x0 + b.facade.indexOf('D'), b.facing === 'S' ? b.y1 : b.y0];
      return { id: b.id, type: 'player_building', tile: door, building: b };
    });
    this.selectables = buildSelectables(this.zone, { dynamic: this.dynamicInteractables, playerBuildings: list });
    // Lotissement : emplacements encore libres (bordure, fond blanc, « + »), sélectionnables.
    const res = this.zone.residential;
    if (res) {
      const lots = freeLots(res.blocks, store.state?.world?.residential?.homes || []);
      if (lots.length) this.playerGroup.add(buildFreeLots(lots, res.lot));
      this.selectables.push(...lotSelectables(lots));
    }
    this.mapLabels = this.mapLabels.filter((s) => {
      if (!s.userData.player) return true;
      s.removeFromParent();
      disposeGroup(s);
      return false;
    });
    for (const b of list) {
      const g = buildBuilding(b);
      this.playerGroup.add(g);
      this.buildings.push(g);
      // Lotissement : seule ma maison est étiquetée (des centaines d'étiquettes seraient illisibles).
      if (b.plot || b.mine) this.addMapLabel(b, b.mine);
    }
    this.buildings = this.buildings.filter((g) => g.parent);
    // Une construction apparue sous mes pieds (autre joueur) : je suis déplacé sur la case libre voisine.
    const p = this.player.body;
    if (rectCollides(this.grid, p.x, p.y, p.hw, p.hh)) {
      const free = nearestWalkable(this.grid, p.x, p.y);
      if (free) { p.x = (free.tx + 0.5) * TILE; p.y = (free.ty + 0.5) * TILE; this.syncPlayer(); }
    }
    this.path = null;
  }

  refreshWorldState() {
    if (!this.player || !store.state) return;
    // Nouveau bloc de lotissement ouvert par le serveur : la ville grandit, on la recharge sur place.
    if (setResidentialBlocks(this.residentialBlocks()) && this.zoneId === 'quartier') {
      this.loadZone('quartier', { pos: { x: this.player.body.x, y: this.player.body.y } });
      return;
    }
    for (const prop of this.props) {
      const state = this.propState(prop.def);
      const key = JSON.stringify(state);
      if (prop.object.userData.key === key) continue;
      prop.object.removeFromParent();
      disposeGroup(prop.object);
      prop.object = buildProp(prop.def, state);
      prop.object.userData.key = key;
      this.zoneGroup.add(prop.object);
    }
    const worldKey = JSON.stringify(this.playerBuildings());
    if (worldKey !== this.worldKey) { this.worldKey = worldKey; this.refreshPlayerBuildings(); }

    for (const m of this.deliveryMarkers) m.removeFromParent();
    this.deliveryMarkers = [];
    const shift = store.state.job.active;
    if (shift) {
      for (const it of this.zone.interactables) {
        if (it.type !== 'delivery' || !shift.targets.includes(it.id) || shift.delivered.includes(it.id)) continue;
        const a = anchorOf(it);
        const f = this.frontFor(it);
        const m = makeMarker(1.8);
        m.position.set(a.x / TILE + f.dx * 0.5, 2.3, a.y / TILE + f.dy * 0.5);
        m.userData.baseY = 2.3;
        this.zoneGroup.add(m);
        this.deliveryMarkers.push(m);
      }
    }
    this.player.pkg.visible = !!shift && shift.delivered.length < shift.targets.length;

    for (const b of this.giverBubbles) b.removeFromParent();
    this.giverBubbles = [];
    for (const npc of this.npcs) {
      const hasNews = store.state.missions.some((m) => (m.status === 'available' || m.status === 'completed')
        && store.config.missions.find((d) => d.id === m.id)?.giver === npc.id);
      if (hasNews) {
        const b = this.makeBubble();
        b.position.y = 1.78;
        npc.model.add(b);
        this.giverBubbles.push(b);
      }
    }
  }

  animateMarkers(dt) {
    const bob = Math.sin(this.time / 160) * 0.06;
    if (this.current) {
      const y = MARKER_Y[this.current.type] ?? MARKER_Y.default;
      // Porte ou façade : repère du côté de la rue (l'ancre est au centre de la case du mur).
      const f = this.current.front || { dx: 0, dy: 0 };
      this.targetMarker.position.set(this.current.x / TILE + f.dx * 0.6, y + bob, this.current.y / TILE + f.dy * 0.6);
      this.targetMarker.rotation.y += dt * 2;
    }
    this.placeSelectionMarker(bob);
    for (const m of this.deliveryMarkers) { m.position.y = m.userData.baseY + bob * 2; m.rotation.y += dt * 2; }
    if (this.ring.visible) this.ring.scale.setScalar(1 + Math.sin(this.time / 120) * 0.12);
    this.floating = this.floating.filter((s) => {
      const t = (this.time - s.userData.born) / 1400;
      if (t >= 1) { s.removeFromParent(); s.material.map.dispose(); s.material.dispose(); return false; }
      s.position.y = 2.0 + t * 0.8;
      s.material.opacity = 1 - t;
      return true;
    });
  }

  /** Repère blanc au-dessus de l'objet dont la fiche est ouverte. */
  placeSelectionMarker(bob) {
    const m = this.selectionMarker;
    const item = this.selected && this.selectableById(this.selected);
    m.visible = !!item && store.modalOpen;
    if (!m.visible) return;
    // Au-dessus du volume le plus haut (panneau d'une parcelle, toit d'un bâtiment...).
    const b = item.boxes.reduce((a, c) => (c.y1 > a.y1 ? c : a));
    m.position.set((b.x0 + b.x1) / 2, b.y1 + 0.45 + bob, (b.z0 + b.z1) / 2);
    m.rotation.y += 0.04;
  }

  /** Rend transparents les bâtiments situés entre la caméra et le joueur. */
  updateOcclusion() {
    const cam = this.rig.camera.position;
    const head = new THREE.Vector3(this.player.body.x / TILE, 0.7, this.player.body.y / TILE);
    const dir = head.clone().sub(cam);
    const ray = new THREE.Raycaster(cam, dir.clone().normalize(), 0, dir.length());
    const hidden = new Set();
    for (const hit of ray.intersectObjects(this.buildings, true)) {
      let o = hit.object;
      while (o && o.userData.kind !== 'building') o = o.parent;
      if (o) hidden.add(o);
    }
    for (const b of this.buildings) {
      const target = hidden.has(b) ? 0.28 : 1;
      for (const m of b.userData.fadeMaterials) {
        m.opacity += (target - m.opacity) * 0.5;
        if (Math.abs(m.opacity - target) < 0.02) m.opacity = target;
        const transparent = m.opacity < 0.999;
        if (m.transparent !== transparent) { m.transparent = transparent; m.depthWrite = !transparent; m.needsUpdate = true; }
      }
    }
  }

  updateDaylight() {
    if (!this.zone) return;
    const phase = dayPhase(store.serverNow());
    const k = this.zone.outdoor ? phase.darkness : 0;
    this.hemi.intensity = 1.25 * (1 - k * 0.6);
    this.sun.intensity = 1.5 * (1 - k * 0.8);
    this.night = k > 0.6; // la nuit, le soleil n'a plus d'ombre
    this.updateShadows();
    setNight(k);
    this.hemi.color.set('#fff4e0').lerp(new THREE.Color('#9db4ff'), k * 1.5);
    if (this.zone.outdoor) {
      const sky = new THREE.Color('#a8d8f0').lerp(new THREE.Color('#1b2a4a'), k * 1.8);
      this.scene.background = sky;
      // Brume d'horizon : la ville se fond dans le ciel au lieu de s'arrêter net.
      this.scene.fog = new THREE.Fog(sky, 32, 75);
    } else this.scene.fog = null;
    clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(() => this.updateDaylight(), 30000);
  }

  updateCompass() {
    const needle = document.getElementById('compass-needle');
    if (needle) needle.style.transform = `rotate(${(this.rig.cur.yaw * 180) / Math.PI}deg)`;
  }

  /** Économie de batterie (Réglages) ou lancement : finesse de l'image, ombres, cadence. */
  applyQuality() {
    this.quality = qualityFor({ dpr: window.devicePixelRatio, mobile: isMobile, saver: quality.saver });
    this.shadowsDropped = false;
    this.fpsSamples = [];
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.resize();
    this.updateShadows();
  }

  /** Ombres du soleil allumées si la qualité le permet et qu'il fait jour ; sinon disque sous les personnages. */
  updateShadows() {
    const on = !!this.quality?.shadows && !this.night && !this.shadowsDropped;
    setDiscShadows(!on);
    if (this.renderer.shadowMap.enabled === on && this.sun.castShadow === on) return;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // Les matériaux déjà compilés doivent l'être à nouveau avec (ou sans) les ombres.
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }

  /** Appareil trop lent pour les ombres (mesuré en jeu, hors chargement de zone) : elles sont coupées pour la session. */
  watchSmoothness() {
    if (!this.sun.castShadow || this.transitioning || document.hidden || performance.now() < this.smoothFrom) { this.fpsSamples = []; return; }
    this.fpsSamples.push(this.fpsValue);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    if (!tooSlow(this.fpsSamples)) return;
    this.shadowsDropped = true;
    this.updateShadows();
    ui.toast('Ombres coupées pour garder le jeu fluide (⚙️ Réglages → Économie de batterie).', 'info', 4000);
  }

  /**
   * Le soleil suit le point visé par la caméra ; la zone couverte par les ombres grandit avec le dézoom.
   * Position arrondie à la taille d'un pixel d'ombre pour qu'elles ne scintillent pas en marchant.
   */
  updateSun() {
    if (!this.sun.castShadow) return;
    const extent = shadowExtent(this.rig.cur.dist);
    if (extent !== this.shadowExtent) {
      this.shadowExtent = extent;
      Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: extent * 2 + 60 });
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    const t = this.rig.cur.target;
    const x = snapToTexel(t.x, extent, this.quality.shadowMapSize);
    const z = snapToTexel(t.z, extent, this.quality.shadowMapSize);
    this.sun.target.position.set(x, 0, z);
    this.sun.position.copy(SUN_DIR).multiplyScalar(extent + 30).add(this.sun.target.position);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w, h);
  }
}

function fade(on) {
  document.getElementById('fade').classList.toggle('on', on);
}


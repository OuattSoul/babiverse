// Boucle sociale : envoie la position toutes les 2 s (1 s pendant un appel) et reçoit les joueurs proches,
// les notifications, les nouveaux messages et l'appel en cours. Pilote la barre de proximité, les demandes
// reçues, les discussions et les appels. Le serveur décide de tout (proximité, sonnerie de 30 s…).
import { api, auth } from '../net/api.js';
import { bus, store } from '../state/store.js';
import { ui } from '../ui/ui.js';
import { socialUi } from '../ui/socialUi.js';
import { KINDS, mergeMessages, nearestPlayer, newOutcomes, nextIncoming } from '../world/social.js';
import { ringtone, VoiceCall } from './voice.js';

const TILE = 32;

export const social = {
  me: null,
  players: [],
  notifications: [],
  unread: 0,
  friends: [],
  chats: [],
  messages: new Map(), // id de l'interlocuteur → messages
  lastMessage: 0,
  call: null, // appel en cours ou qui sonne (vu par le serveur)
  voice: null,
  signalAfter: 0,
  readIds: new Set(), // notifications lues ici : une réponse partie avant la lecture ne les remet pas « non lues »
  shown: new Set(), // demandes déjà montrées en surimpression
  announced: new Set(), // réponses à mes demandes déjà annoncées
  started: false,
  busy: false,

  get cfg() { return store.config.social; },

  start(world) {
    this.world = world;
    socialUi.init(this);
    this.started = true;
    this.loop();
    setInterval(() => this.updateBar(), 250);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.pollNow(); });
  },

  loop() {
    clearTimeout(this.timer);
    // Rythme rapide le temps qu'un appel sonne ou se mette en relation ; normal une fois la voix établie.
    const fast = this.call && !this.voice?.connected;
    this.timer = setTimeout(() => this.loop(), (fast ? this.cfg.call_poll_s : this.cfg.poll_s) * 1000);
    if (document.visibilityState === 'visible') this.poll();
  },

  pollNow() { if (this.started) this.loop(); },

  async poll() {
    if (this.busy || !store.pos.zone || !auth.token) return;
    this.busy = true;
    try {
      const res = await api.socialPoll({ pos: { ...store.pos }, after: this.lastMessage, signal_after: this.signalAfter });
      this.apply(res);
    } catch { /* hors ligne : on réessaie au prochain tour */ } finally {
      this.busy = false;
    }
  },

  apply(res) {
    const first = this.me === null;
    this.me = res.me;
    this.players = res.players;
    this.world.syncRemotePlayers(res.players, res.zone, this.cfg.poll_s);
    this.notifications = res.notifications;
    let stale = 0;
    for (const n of this.notifications) if (!n.read && this.readIds.has(n.id)) { n.read = true; stale++; }
    this.unread = Math.max(0, res.unread - stale);
    this.friends = res.friends;
    this.chats = res.chats;
    const fresh = res.messages.filter((m) => m.id > this.lastMessage);
    mergeMessages(this.messages, res.messages);
    for (const m of res.messages) this.lastMessage = Math.max(this.lastMessage, m.id);
    if (first) {
      // Au lancement, les anciennes réponses ne sont pas réannoncées (elles restent dans 🔔).
      for (const n of this.notifications) if (n.direction === 'out') this.announced.add(n.id);
    } else {
      for (const m of fresh) if (!m.mine) this.onMessage(m);
      for (const n of newOutcomes(this.notifications, this.announced)) this.onOutcome(n);
    }
    this.handleCall(res.call);
    const incoming = nextIncoming(this.notifications, this.shown);
    if (incoming && !socialUi.incomingOpen()) {
      this.shown.add(incoming.id);
      socialUi.showIncoming(incoming);
    }
    socialUi.renderBadge(this.unread);
    bus.emit('social');
  },

  // --- Barre de proximité -------------------------------------------------------------
  updateBar() {
    const w = this.world;
    const show = w?.player && !store.modalOpen && !w.transitioning;
    const near = show ? nearestPlayer(w.player.body, w.remotes?.list() || [], this.cfg.near_tiles * TILE) : null;
    socialUi.renderBar(near);
  },

  isFriend(id) { return this.friends.some((f) => f.id === id); },

  // --- Demandes ---------------------------------------------------------------------
  async request(kind, other) {
    if (kind === 'chat' && this.chats.includes(other.id)) { this.openChat(other); return; }
    try {
      const res = await api.social('request', { to: other.id, kind, pos: { ...store.pos } });
      if (kind === 'call') {
        this.call = { ...res.request, role: 'caller', signals: [] };
        socialUi.showCall(this.call);
        ringtone.start('out');
        this.pollNow();
      } else ui.toast(`${KINDS[kind].icon} Demande envoyée à ${other.name}.`, 'success');
    } catch (err) {
      if (err.code === 'chat_open') this.openChat(other);
      else ui.toast(err.message, 'error');
    }
  },

  async respond(n, answer) {
    try {
      await api.social('respond', { id: n.id, answer });
      if (answer === 'accept') {
        if (n.kind === 'chat') { this.chats = [...new Set([...this.chats, n.other.id])]; this.openChat(n.other); }
        if (n.kind === 'friend') ui.toast(`🤝 ${n.other.name} et toi êtes maintenant amis.`, 'success');
      }
      this.pollNow();
    } catch (err) {
      ui.toast(err.message, 'error');
      this.pollNow();
    }
  },

  /** Notifications vues sans réponse : elles restent, marquées lues. */
  async markRead(ids) {
    if (!ids.length) return;
    for (const id of ids) this.readIds.add(id);
    for (const n of this.notifications) if (ids.includes(n.id)) n.read = true;
    this.unread = this.notifications.filter((n) => !n.read).length
      + [...this.messages.values()].flat().filter((m) => !m.mine && !m.read).length;
    socialUi.renderBadge(this.unread);
    try { this.unread = (await api.social('read', { ids })).unread; socialUi.renderBadge(this.unread); } catch { /* au prochain tour */ }
  },

  async unfriend(other) {
    try { await api.social('unfriend', { id: other.id }); ui.toast(`${other.name} n'est plus dans tes amis.`, 'info'); this.pollNow(); } catch (err) { ui.toast(err.message, 'error'); }
  },

  onOutcome(n) {
    this.announced.add(n.id);
    if (n.kind === 'call') return; // annoncé par la fin de l'appel
    const ok = n.status === 'accepted';
    ui.toast(`${KINDS[n.kind].icon} ${n.other.name} ${ok ? 'a accepté' : 'a refusé'} ta ${KINDS[n.kind].noun}.`, ok ? 'success' : 'info', 5000);
    if (ok && n.kind === 'chat' && !store.modalOpen) { this.markRead([n.id]); this.openChat(n.other); }
  },

  // --- Discussions -----------------------------------------------------------------
  openChat(other) {
    socialUi.openChat(other);
    this.readChat(other.id);
  },

  readChat(otherId) {
    const unread = (this.messages.get(otherId) || []).some((m) => !m.mine && !m.read);
    if (!unread) return;
    for (const m of this.messages.get(otherId)) if (!m.mine) m.read = true;
    api.social('messages/read', { with: otherId }).then((r) => { this.unread = r.unread; socialUi.renderBadge(this.unread); }).catch(() => {});
  },

  async sendMessage(other, text) {
    const res = await api.social('message', { to: other.id, text });
    mergeMessages(this.messages, [res.message]);
    this.lastMessage = Math.max(this.lastMessage, res.message.id);
    bus.emit('social');
    return res.message;
  },

  onMessage(m) {
    if (socialUi.chatWith() === m.with) { this.readChat(m.with); return; }
    const name = this.nameOf(m.with);
    ui.toast(`💬 ${name} : ${m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text}`, 'info', 5000);
  },

  nameOf(id) {
    return this.players.find((p) => p.id === id)?.name || this.friends.find((f) => f.id === id)?.name
      || this.notifications.find((n) => n.other.id === id)?.other.name || 'Un joueur';
  },

  // --- Appels -----------------------------------------------------------------------
  handleCall(next) {
    const prev = this.call;
    // Mon appel vient d'être envoyé : le serveur ne l'a peut-être pas encore renvoyé, on garde l'écran.
    if (!next && prev?.status === 'pending' && prev.role === 'caller' && !prev.seen) {
      prev.seen = true;
      return;
    }
    this.call = next;
    if (!next) {
      if (prev) this.endCall(prev);
      return;
    }
    if (next.status === 'pending') {
      ringtone.start(next.role === 'callee' ? 'in' : 'out');
      socialUi.showCall(next);
      return;
    }
    // Décroché : mise en relation audio.
    ringtone.stop();
    if (!this.voice || this.voice.id !== next.id) {
      this.voice?.close();
      this.signalAfter = 0;
      this.callStart = Date.now();
      this.voice = new VoiceCall({
        id: next.id, role: next.role, iceServers: this.cfg.ice_servers,
        send: (kind, payload) => api.social('signal', { id: next.id, kind, payload }).catch(() => {}),
        onState: (text) => socialUi.callState(text),
      });
      this.voice.start();
    }
    for (const s of next.signals) {
      if (s.id <= this.signalAfter) continue;
      this.signalAfter = s.id;
      this.voice.onSignal(s);
    }
    socialUi.showCall(next, this.callStart);
  },

  endCall(prev) {
    ringtone.stop();
    this.voice?.close();
    this.voice = null;
    this.signalAfter = 0;
    socialUi.hideCall();
    const n = this.notifications.find((x) => x.id === prev.id);
    const who = prev.other.name;
    if (prev.status === 'accepted') ui.toast(`📞 Appel avec ${who} terminé.`, 'info');
    else if (prev.hungUp) ui.toast('📞 Appel annulé.', 'info');
    else if (prev.role === 'caller') {
      this.announced.add(prev.id);
      ui.toast(n?.status === 'declined' ? `📞 ${who} a refusé ton appel.` : `📞 ${who} n'a pas répondu.`, 'info', 5000);
    } else if (n?.status === 'missed') ui.toast(`📞 Appel manqué de ${who} — tu peux le rappeler depuis 🔔.`, 'info', 6000);
  },

  async acceptCall() {
    const call = this.call;
    if (!call) return;
    ringtone.stop();
    try {
      await api.social('respond', { id: call.id, answer: 'accept' });
      this.pollNow();
    } catch (err) { ui.toast(err.message, 'error'); this.pollNow(); }
  },

  async declineCall() {
    const call = this.call;
    if (!call) return;
    ringtone.stop();
    socialUi.hideCall();
    try { await api.social('respond', { id: call.id, answer: 'decline' }); } catch { /* déjà terminé */ }
    this.pollNow();
  },

  /** Raccrocher : annule un appel qui sonne encore, ou termine la communication. */
  async hangup() {
    const call = this.call;
    if (!call) return;
    ringtone.stop();
    call.hungUp = true;
    try {
      if (call.status === 'pending') await api.social('cancel', { id: call.id });
      else await api.social('hangup', { id: call.id });
    } catch { /* déjà terminé */ }
    this.pollNow();
  },

  callback(other) { this.request('call', other); },
};

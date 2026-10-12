// Appel vocal entre deux joueurs (WebRTC, audio seulement). Le serveur relaie seulement la mise en
// relation (offre, réponse, candidats réseau) ; la voix passe directement d'un navigateur à l'autre.
// Sans micro (refusé, absent, page non sécurisée), l'appel reste établi en écoute seule.

export class VoiceCall {
  /** send(kind, payload) : relaie un message à l'autre joueur ; onState(texte) : état affiché. */
  constructor({ id, role, iceServers = [], send, onState }) {
    this.id = id;
    this.role = role;
    this.send = send;
    this.onState = onState || (() => {});
    this.pendingIce = [];
    this.closed = false;
    this.muted = false;
    this.micOk = false;
    this.audio = new Audio();
    this.audio.autoplay = true;
    this.pc = typeof RTCPeerConnection === 'function' ? new RTCPeerConnection({ iceServers }) : null;
  }

  async start() {
    const pc = this.pc;
    if (!pc) { this.onState('Ton navigateur ne permet pas les appels vocaux.'); return; }
    // Les candidats trouvés avant l'envoi de l'offre (ou de la réponse) y sont inclus ; seuls les retardataires partent à part.
    pc.onicecandidate = (e) => { if (e.candidate && this.described) this.send('ice', e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      this.audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.onState(this.micOk ? 'En ligne' : 'En ligne (micro coupé : tu écoutes seulement)');
      else if (s === 'failed') this.onState('Liaison audio impossible (réseau). Vous pouvez discuter par écrit.');
      else if (s === 'disconnected') this.onState('Liaison audio interrompue…');
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
      this.micOk = true;
    } catch {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      this.onState('Micro indisponible : tu écoutes seulement.');
    }
    if (this.closed) return;
    this.onState('Connexion audio…');
    if (this.role === 'caller') await this.describe(await pc.createOffer());
    this.ready = true;
    for (const s of this.early || []) await this.onSignal(s);
    this.early = null;
  }

  /** Message reçu de l'autre joueur. */
  async onSignal({ kind, payload }) {
    const pc = this.pc;
    if (!pc || this.closed) return;
    // L'offre peut arriver avant que le micro soit prêt : on la garde pour plus tard.
    if (!this.ready) { (this.early ||= []).push({ kind, payload }); return; }
    try {
      if (kind === 'offer' && this.role === 'callee') {
        await pc.setRemoteDescription(payload);
        await this.flushIce();
        await this.describe(await pc.createAnswer());
      } else if (kind === 'answer' && this.role === 'caller') {
        await pc.setRemoteDescription(payload);
        await this.flushIce();
      } else if (kind === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(payload);
        else this.pendingIce.push(payload);
      }
    } catch (err) {
      console.warn('appel : message ignoré', kind, err);
    }
  }

  /** Applique l'offre ou la réponse locale, attend les candidats réseau (1,5 s au plus), puis l'envoie en un message. */
  async describe(desc) {
    const pc = this.pc;
    await pc.setLocalDescription(desc);
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const timer = setTimeout(resolve, 1500);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
      });
    });
    if (this.closed) return;
    this.described = true;
    const local = pc.localDescription;
    this.send(local.type, { type: local.type, sdp: local.sdp });
  }

  get connected() { return this.pc?.connectionState === 'connected'; }

  async flushIce() {
    for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }

  setMuted(muted) {
    this.muted = muted;
    for (const t of this.stream?.getAudioTracks() || []) t.enabled = !muted;
  }

  close() {
    this.closed = true;
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.pc?.close();
    this.audio.srcObject = null;
  }
}

/** Sonnerie discrète (deux bips par seconde et demie) et vibration, sans fichier audio. */
export const ringtone = {
  timer: null,
  start(kind = 'in') {
    if (this.timer) return;
    const beep = () => {
      try {
        this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        const t = this.ctx.currentTime;
        for (const at of kind === 'in' ? [0, 0.25] : [0]) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.frequency.value = kind === 'in' ? 880 : 440;
          gain.gain.setValueAtTime(0.0001, t + at);
          gain.gain.exponentialRampToValueAtTime(0.12, t + at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.2);
          osc.connect(gain).connect(this.ctx.destination);
          osc.start(t + at);
          osc.stop(t + at + 0.22);
        }
      } catch { /* pas de son : on garde la vibration */ }
      if (kind === 'in') navigator.vibrate?.([200, 100, 200]);
    };
    beep();
    this.timer = setInterval(beep, 1500);
  },
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    navigator.vibrate?.(0);
  },
};

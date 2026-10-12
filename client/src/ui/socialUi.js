// Interface des rencontres entre joueurs : barre de proximité (Chatter / Appeler / Ajouter ami), demande reçue
// en surimpression (Accepter / Refuser / ignorer), écran d'appel, panneau 🔔 Notifications et discussion.
// Les données viennent du contrôleur `social/social.js` ; ce module ne fait que de l'affichage.
import { bus, store } from '../state/store.js';
import { clockOf, KINDS, noticeActions, noticeText, secondsLeft } from '../world/social.js';
import { ui } from './ui.js';

const el = ui.el;
const $ = (sel) => document.querySelector(sel);
const INCOMING_MS = 20000; // une demande ignorée disparaît de l'écran (elle reste, lue, dans 🔔)

let ctl = null; // contrôleur social
let barFor = null; // joueur affiché dans la barre (clé)
let incoming = null; // { n, timer }
let chat = null; // discussion ouverte : { other, list, input }
let callTimer = null;

function ago(iso) {
  const s = Math.max(0, (store.serverNow() - Date.parse(iso)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

const initial = (name) => el('span', { class: 'soc-avatar', 'aria-hidden': 'true' }, (name || '?').charAt(0).toUpperCase());

export const socialUi = {
  init(controller) {
    ctl = controller;
    const app = $('#app');
    app.append(
      el('div', { id: 'social-bar', role: 'toolbar', 'aria-label': 'Joueur à proximité', hidden: true }),
      el('div', { id: 'social-incoming', role: 'alertdialog', 'aria-live': 'assertive', hidden: true }),
      el('section', { id: 'call-panel', role: 'dialog', 'aria-label': 'Appel', hidden: true }),
    );
    $('#btn-social').addEventListener('click', () => this.openNotifications());
    bus.on('social', () => {
      if (ui.kind === 'social') ui.refresh();
      if (chat && ui.kind === 'chat') this.renderChat();
    });
    bus.on('sheet-closed', () => { chat = null; });
  },

  renderBadge(n) {
    const badge = $('#social-count');
    badge.hidden = !n;
    badge.textContent = n > 9 ? '9+' : String(n);
    const label = n ? `Notifications : ${n} non lue${n > 1 ? 's' : ''}` : 'Notifications';
    $('#btn-social').dataset.tip = label;
    $('#btn-social').setAttribute('aria-label', label);
  },

  // --- Barre de proximité -------------------------------------------------------------
  renderBar(player) {
    const bar = $('#social-bar');
    const friend = player && ctl.isFriend(player.id);
    const key = player ? `${player.id}:${player.name}:${friend}` : null;
    document.getElementById('app').classList.toggle('social-near', !!player);
    if (key === barFor) return;
    barFor = key;
    bar.hidden = !player;
    if (!player) { bar.replaceChildren(); return; }
    const btn = (kind, label, icon, opts = {}) => el('button', {
      class: `soc-act ${kind}`, 'data-kind': kind, disabled: opts.disabled, 'aria-label': `${label} ${player.name}`,
      onclick: (e) => { e.currentTarget.blur(); ctl.request(kind, player); },
    }, el('span', { class: 'soc-icon', 'aria-hidden': 'true' }, icon), el('span', {}, label));
    bar.replaceChildren(
      el('div', { class: 'soc-who' }, initial(player.name), el('strong', {}, player.name), friend ? el('span', { class: 'soc-friend' }, '★ Ami') : null),
      el('div', { class: 'soc-acts' },
        btn('chat', KINDS.chat.action, KINDS.chat.icon),
        btn('call', KINDS.call.action, KINDS.call.icon),
        friend ? null : btn('friend', KINDS.friend.action, KINDS.friend.icon)),
    );
  },

  // --- Demande reçue ------------------------------------------------------------------
  incomingOpen() { return !!incoming; },

  showIncoming(n) {
    const box = $('#social-incoming');
    const close = (read = true) => {
      clearTimeout(incoming?.timer);
      incoming = null;
      box.hidden = true;
      box.replaceChildren();
      if (read) ctl.markRead([n.id]);
    };
    box.replaceChildren(
      el('div', { class: 'soc-in-head' }, el('span', { class: 'soc-icon', 'aria-hidden': 'true' }, KINDS[n.kind].icon),
        el('strong', { class: 'grow' }, noticeText(n)),
        el('button', { class: 'soc-x', 'aria-label': 'Ignorer (la demande reste dans 🔔)', onclick: () => close() }, '✕')),
      el('div', { class: 'soc-in-acts' },
        el('button', { class: 'primary', id: 'soc-accept', onclick: () => { close(false); ctl.respond(n, 'accept'); } }, 'Accepter'),
        el('button', { id: 'soc-decline', onclick: () => { close(false); ctl.respond(n, 'decline'); } }, 'Refuser')),
    );
    box.hidden = false;
    incoming = { n, timer: setTimeout(() => close(), INCOMING_MS) };
  },

  // --- Appel --------------------------------------------------------------------------
  showCall(call, startedAt) {
    const panel = $('#call-panel');
    const who = call.other.name;
    const ringing = call.status === 'pending';
    const key = `${call.id}:${call.status}:${call.role}`;
    if (panel.dataset.key !== key) {
      panel.dataset.key = key;
      const acts = [];
      if (ringing && call.role === 'callee') {
        acts.push(el('button', { class: 'ok', id: 'call-accept', onclick: () => ctl.acceptCall() }, '📞 Décrocher'),
          el('button', { class: 'bad', id: 'call-decline', onclick: () => ctl.declineCall() }, 'Refuser'));
      } else {
        if (!ringing) {
          acts.push(el('button', { id: 'call-mute', onclick: (e) => {
            const muted = !ctl.voice?.muted;
            ctl.voice?.setMuted(muted);
            e.currentTarget.textContent = muted ? '🎙️ Réactiver le micro' : '🔇 Couper le micro';
          } }, '🔇 Couper le micro'));
          if (ctl.chats.includes(call.other.id)) acts.push(el('button', { onclick: () => ctl.openChat(call.other) }, '💬 Écrire'));
        }
        acts.push(el('button', { class: 'bad', id: 'call-hangup', onclick: () => ctl.hangup() }, 'Raccrocher'));
      }
      const title = ringing ? (call.role === 'callee' ? `${who} t'appelle…` : `Appel vers ${who}…`) : `En ligne avec ${who}`;
      panel.replaceChildren(
        el('div', { class: 'call-head' }, el('span', { class: `call-icon${ringing ? ' ring' : ''}`, 'aria-hidden': 'true' }, '📞'),
          el('div', { class: 'grow' }, el('strong', {}, title), el('small', { id: 'call-time' }, ''))),
        el('p', { id: 'call-state', class: 'muted' }, ringing ? '' : 'Connexion audio…'),
        el('div', { class: 'call-acts' }, ...acts));
    }
    panel.hidden = false;
    clearInterval(callTimer);
    const tick = () => {
      const t = $('#call-time');
      if (!t) return;
      t.textContent = ringing ? `Sonne encore ${secondsLeft(call.expires_at, store.serverNow())} s` : clockOf((Date.now() - (startedAt || Date.now())) / 1000);
    };
    tick();
    callTimer = setInterval(tick, 500);
  },

  callState(text) { const p = $('#call-state'); if (p) p.textContent = text; },

  hideCall() {
    clearInterval(callTimer);
    const panel = $('#call-panel');
    panel.hidden = true;
    panel.dataset.key = '';
    panel.replaceChildren();
  },

  // --- Panneau des notifications ---------------------------------------------------------
  openNotifications() {
    ui.open('🔔 Notifications', 'Demandes, appels, discussions et amis', () => this.notificationsBody(), 'social');
    // Ouvertes = vues : elles restent dans la liste, marquées lues.
    ctl.markRead(ctl.notifications.filter((n) => !n.read).map((n) => n.id));
  },

  notificationsBody() {
    const out = [];
    const action = (n, a) => {
      if (a === 'accept') return el('button', { class: 'primary', onclick: () => ctl.respond(n, 'accept') }, 'Accepter');
      if (a === 'decline') return el('button', { onclick: () => ctl.respond(n, 'decline') }, 'Refuser');
      if (a === 'callback') return el('button', { class: 'primary', onclick: () => { ui.close(); ctl.callback(n.other); } }, '📞 Rappeler');
      return el('button', { onclick: () => ctl.openChat(n.other) }, '💬 Ouvrir');
    };
    out.push(el('h3', { class: 'soc-h' }, 'Demandes et appels'));
    if (!ctl.notifications.length) out.push(el('p', { class: 'muted' }, "Rien pour l'instant. Approche-toi d'un autre joueur dans la ville pour discuter, l'appeler ou devenir amis."));
    for (const n of ctl.notifications) {
      const acts = noticeActions(n, ctl);
      out.push(el('div', { class: `soc-row${n.read ? '' : ' unread'}`, 'data-id': n.id },
        el('span', { class: 'soc-icon', 'aria-hidden': 'true' }, n.kind === 'call' && n.status === 'missed' ? '📵' : KINDS[n.kind].icon),
        el('div', { class: 'grow' }, el('span', {}, noticeText(n)), el('small', { class: 'muted' }, `${ago(n.created_at)}${n.read ? '' : ' · nouveau'}`)),
        acts.length ? el('div', { class: 'soc-row-acts' }, ...acts.map((a) => action(n, a))) : null));
    }

    const partners = [...new Set([...ctl.messages.keys(), ...ctl.chats])];
    if (partners.length) {
      out.push(el('h3', { class: 'soc-h' }, 'Discussions'));
      for (const id of partners) {
        const list = ctl.messages.get(id) || [];
        const last = list.at(-1);
        const unread = list.filter((m) => !m.mine && !m.read).length;
        const other = { id, name: ctl.nameOf(id) };
        out.push(el('div', { class: `soc-row${unread ? ' unread' : ''}` },
          initial(other.name),
          el('div', { class: 'grow' }, el('strong', {}, other.name),
            el('small', { class: 'muted soc-preview' }, last ? `${last.mine ? 'Toi : ' : ''}${last.text}` : 'Aucun message')),
          unread ? el('span', { class: 'badge' }, String(unread)) : null,
          el('div', { class: 'soc-row-acts' }, el('button', { onclick: () => ctl.openChat(other) }, '💬 Ouvrir'))));
      }
    }

    out.push(el('h3', { class: 'soc-h' }, 'Amis'));
    if (!ctl.friends.length) out.push(el('p', { class: 'muted' }, "Pas encore d'amis : propose « 🤝 Ajouter ami » à un joueur croisé dans la ville."));
    for (const f of ctl.friends) {
      out.push(el('div', { class: 'soc-row' },
        initial(f.name),
        el('div', { class: 'grow' }, el('strong', {}, f.name), el('small', { class: `muted soc-online${f.online ? ' on' : ''}` }, f.online ? 'en jeu' : 'absent')),
        el('div', { class: 'soc-row-acts' },
          el('button', { onclick: () => ctl.openChat(f) }, '💬'),
          el('button', { disabled: !f.online, 'aria-label': `Appeler ${f.name}`, onclick: () => { ui.close(); ctl.request('call', f); } }, '📞'),
          el('button', { class: 'ghost', 'aria-label': `Retirer ${f.name} de mes amis`, onclick: () => ctl.unfriend(f) }, '✕'))));
    }
    return out;
  },

  // --- Discussion ----------------------------------------------------------------------
  chatWith() { return ui.kind === 'chat' ? chat?.other.id ?? null : null; },

  openChat(other) {
    const list = el('div', { class: 'chat-list', id: 'chat-list', 'aria-live': 'polite' });
    const input = el('input', { id: 'chat-input', type: 'text', maxlength: String(store.config.social.message_max), placeholder: 'Écris un message…', autocomplete: 'off', enterkeyhint: 'send' });
    const form = el('form', { class: 'chat-form', onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.disabled = true;
      try { await ctl.sendMessage(other, text); input.value = ''; } catch (err) { ui.toast(err.message, 'error'); } finally {
        input.disabled = false;
        input.focus();
      }
    } }, input, el('button', { class: 'primary', type: 'submit', id: 'chat-send' }, 'Envoyer'));
    const open = ctl.chats.includes(other.id);
    const nodes = [list, open ? form : el('p', { class: 'muted' }, `${other.name} n'a pas encore accepté de discuter.`)];
    ui.open(`💬 ${other.name}`, open ? 'Discussion' : '', () => nodes, 'chat');
    chat = { other, list, input };
    this.renderChat();
  },

  renderChat() {
    const { other, list } = chat;
    const messages = ctl.messages.get(other.id) || [];
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(...(messages.length ? messages.map((m) => el('div', { class: `chat-msg${m.mine ? ' mine' : ''}` },
      el('span', {}, m.text), el('small', {}, ago(m.at)))) : [el('p', { class: 'muted' }, 'Dis bonjour 👋')]));
    if (atBottom || !list.dataset.scrolled) { list.scrollTop = list.scrollHeight; list.dataset.scrolled = '1'; }
    ctl.readChat(other.id);
  },
};

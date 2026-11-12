// Kleine DOM-Helfer. Text wird immer als Text gesetzt (kein innerHTML), außer im
// Markdown-Renderer, der vorher alles escaped.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'selected') el.selected = !!v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  boards: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  companies: '<path d="M4 20V6l8-3 8 3v14"/><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 20v-4h4v4"/>',
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

// Dialog: body = Element; actions = [{label, primary, danger, onClick}] — onClick darf
// false zurückgeben, um offen zu bleiben. Gibt das <dialog> zurück.
export function modal(title, body, actions = []) {
  const dlg = h('dialog', { class: 'modal' });
  const close = () => { dlg.close(); dlg.remove(); };
  const footer = h('div', { class: 'modal-actions' },
    h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Abbrechen'),
    actions.map((a) =>
      h('button', {
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        type: 'button',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const keep = await a.onClick?.();
            if (keep !== false) close();
          } catch (err) {
            toast(err.message || String(err), 'error');
          } finally {
            btn.disabled = false;
          }
        },
      }, a.label),
    ),
  );
  dlg.append(h('div', { class: 'modal-head' }, h('h2', {}, title)), h('div', { class: 'modal-body' }, body), footer);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('input, textarea, select');
  if (first) first.focus();
  return dlg;
}

export function confirmDialog(title, text, label = 'Löschen') {
  return new Promise((resolve) => {
    const dlg = modal(title, h('p', {}, text), [{ label, danger: true, onClick: () => resolve(true) }]);
    dlg.addEventListener('close', () => resolve(false));
  });
}

export function toast(msg, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) document.body.append((box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
  const t = h('div', { class: 'toast ' + kind }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 2600);
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const daysSince = (ts) => (ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 864e5) : 0);

const DF = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DTF = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso) => (iso ? DF.format(new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)) : '');
export const fmtDateTime = (iso) => (iso ? DTF.format(new Date(iso)) : '');

export function dueLabel(iso) {
  if (!iso) return null;
  const t = todayISO();
  if (iso < t) {
    const n = daysSince(iso + 'T12:00:00');
    return { text: n <= 1 ? 'seit gestern fällig' : `seit ${n} Tagen fällig`, cls: 'overdue' };
  }
  if (iso === t) return { text: 'heute', cls: 'today' };
  if (iso === addDays(t, 1)) return { text: 'morgen', cls: 'soon' };
  return { text: fmtDate(iso), cls: 'later' };
}

export const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || 'Ohne Namen';
export const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

// Minimaler, sicherer Markdown-Renderer (Überschriften, Listen, fett, Links)
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}
export function renderMarkdown(md) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.join('')}</${list.t}>`); list = null; } };
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); const n = Math.min(m[1].length + 2, 6); out.push(`<h${n}>${inline(m[2])}</h${n}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list?.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list?.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) flush();
    else { flush(); out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  const div = h('div', { class: 'md' });
  div.innerHTML = out.join('');
  return div;
}

// ---------- Kontaktfoto ----------

const safePhoto = (p) => (/^data:image\/(jpeg|png|webp);base64,/.test(p || '') ? p : null);

// Rundes Avatar: Foto, sonst Initialen.
export function avatar(c, size = 'md') {
  const photo = safePhoto(c?.photo);
  const name = fullName(c);
  const ini = [c?.first_name, c?.last_name].filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || name[0]?.toUpperCase() || '?';
  const el = h('span', { class: 'avatar avatar-' + size, 'aria-hidden': 'true' });
  if (photo) el.append(h('img', { src: photo, alt: '', draggable: 'false' }));
  else el.textContent = ini;
  return el;
}

// Datei -> quadratisch zugeschnittenes JPEG (Data-URL), damit die Datenbank klein bleibt.
export async function resizePhoto(file, px = 192) {
  if (!/^image\//.test(file.type)) throw new Error('Bitte eine Bilddatei wählen.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Das Bild konnte nicht gelesen werden.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
    return cv.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

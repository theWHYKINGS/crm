import { db, mode, TEMPLATES } from './db.js';
import { STUCK_DAYS } from './config.js';
import {
  h, icon, modal, confirmDialog, toast, field, todayISO, addDays, daysSince,
  fmtDate, fmtDateTime, dueLabel, fullName, byId, renderMarkdown, avatar, resizePhoto, logoBox, fetchLogo, resizeLogo } from './ui.js';

const root = document.getElementById('app');

const EVENT_KINDS = {
  note: 'Notiz', call: 'Anruf', email: 'E-Mail', meeting: 'Treffen', touchpoint: 'Touchpoint',
  stage: 'Spaltenwechsel', transcript: 'Transkript', research: 'Recherche',
};

const RESEARCH_TOPICS = [
  ['company', 'Unternehmen / Kanzlei', 'Größe, Standorte, Mitarbeiterzahl, Schwerpunkte, Gründung'],
  ['person', 'Person', 'Rolle, Werdegang, Ausbildung, öffentliches Profil (LinkedIn, Xing)'],
  ['news', 'Aktuelles', 'News, Pressemitteilungen, Veröffentlichungen, Vorträge der letzten 12 Monate'],
  ['leadership', 'Führung & Team', 'Wachstum, offene Stellen, Nachfolge, Fachkräftemangel, Kultur'],
  ['hooks', 'Aufhänger für die Ansprache', 'Konkrete Anknüpfungspunkte für ein persönliches Anschreiben'],
];

// ---------- Router ----------

let lastHash = '';
async function route() {
  const hash = location.hash || '#/today';
  const [, view, id] = hash.split('/');
  const sameView = hash === lastHash;
  const scroll = sameView ? { y: window.scrollY, x: document.querySelector('.kanban')?.scrollLeft || 0 } : null;
  lastHash = hash;

  if (mode === 'supabase' && !(await db.user())) {
    root.replaceChildren(viewLogin());
    return;
  }
  let content;
  try {
    if (view === 'boards') content = await viewBoards();
    else if (view === 'board') content = await viewBoard(id);
    else if (view === 'contacts') content = await viewContacts();
    else if (view === 'contact') content = await viewContact(id);
    else if (view === 'companies') content = await viewCompanies();
    else if (view === 'company') content = await viewCompany(id);
    else content = await viewToday();
  } catch (e) {
    console.error(e);
    content = h('div', { class: 'empty error' }, 'Da ist etwas schiefgelaufen: ', e.message);
  }
  const active = view === 'board' ? 'boards' : view === 'contact' ? 'contacts' : view === 'company' ? 'companies' : view || 'today';
  root.replaceChildren(shell(active, content));
  if (scroll) {
    window.scrollTo(0, scroll.y);
    const k = document.querySelector('.kanban');
    if (k) k.scrollLeft = scroll.x;
  } else window.scrollTo(0, 0);
}
const refresh = () => route();
window.addEventListener('hashchange', route);
route();

function shell(active, content) {
  const nav = [['today', 'Heute'], ['boards', 'Boards'], ['companies', 'Unternehmen'], ['contacts', 'Kontakte']];
  return h('div', { class: 'shell' },
    h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' },
      brandEl(),
      nav.map(([k, label]) =>
        h('a', { class: 'nav-item' + (active === k ? ' active' : ''), href: '#/' + k, 'aria-current': active === k ? 'page' : null },
          icon(k, 20), h('span', {}, label)),
      ),
      h('div', { class: 'nav-foot' },
        mode === 'demo'
          ? h('div', { class: 'demo-badge', title: 'Daten liegen nur in diesem Browser' }, 'Demo-Modus')
          : h('button', { class: 'link', type: 'button', onclick: async () => { await db.signOut(); refresh(); } }, 'Abmelden'),
      ),
    ),
    h('main', { class: 'main' }, h('header', { class: 'topbar' }, brandEl()), content),
  );
}

function brandEl(big = false) {
  return h(big ? 'div' : 'a', { class: 'brand' + (big ? ' big' : ''), href: big ? null : '#/today', 'aria-label': 'theWHYKINGS CRM' },
    h('img', { class: 'brand-logo', src: 'img/helm-gold.png', alt: '', width: 116, height: 54 }),
    h('span', { class: 'brand-text' }, 'THE WHYKINGS', h('small', {}, 'CRM')));
}

// ---------- Login ----------

function viewLogin() {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', {
    class: 'login-card',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await db.signIn(email.value.trim(), pw.value);
        refresh();
      } catch (ex) {
        err.textContent = 'Anmeldung fehlgeschlagen: ' + ex.message;
      }
    },
  },
    brandEl(true),
    field('E-Mail', email), field('Passwort', pw), err,
    h('button', { class: 'btn primary wide', type: 'submit' }, 'Anmelden'),
  );
  return h('div', { class: 'login' }, form);
}

// ---------- Daten laden ----------

async function loadAll() {
  const [boards, stages, cards, contacts, companies] = await Promise.all([
    db.list('boards', { order: ['position'] }),
    db.list('stages', { order: ['position'] }),
    db.list('cards'),
    db.list('contacts'),
    db.list('companies'),
  ]);
  return { boards, stages, cards, contacts, companies, B: byId(boards), S: byId(stages), C: byId(contacts), F: byId(companies) };
}

const companyName = (d, contact) => d.F[contact?.company_id]?.name || '';
const isCompanyBoard = (b) => b?.kind === 'company';
const cardValid = (d, c) => (c.company_id ? d.F[c.company_id] : d.C[c.contact_id]) && d.S[c.stage_id];
const cardTarget = (c) => (c.company_id ? { company_id: c.company_id } : { contact_id: c.contact_id });
const contactsOf = (d, companyId) => d.contacts.filter((x) => x.company_id === companyId);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// ---------- Heute ----------

async function viewToday() {
  const d = await loadAll();
  const today = todayISO();
  const live = d.cards.filter((c) => cardValid(d, c));
  const due = live.filter((c) => c.due_date && c.due_date <= today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const week = live.filter((c) => c.due_date && c.due_date > today && c.due_date <= addDays(today, 7)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const stuck = live
    .filter((c) => !c.due_date && daysSince(c.stage_entered_at) >= STUCK_DAYS)
    .sort((a, b) => (a.stage_entered_at < b.stage_entered_at ? -1 : 1));
  const events = await db.list('events', { order: ['created_at', false], limit: 8 });

  const row = (c, extra) => {
    const contact = d.C[c.contact_id];
    const co = c.company_id ? d.F[c.company_id] : null;
    const dl = dueLabel(c.due_date);
    return h('a', { class: 'task', href: co ? '#/company/' + co.id : '#/contact/' + contact.id },
      h('div', { class: 'task-main' },
        co
          ? h('div', { class: 'task-name' }, co.name, h('span', { class: 'muted' }, ' · Unternehmen'))
          : h('div', { class: 'task-name' }, fullName(contact), companyName(d, contact) ? h('span', { class: 'muted' }, ' · ' + companyName(d, contact)) : null),
        h('div', { class: 'task-sub' }, c.next_step || h('span', { class: 'muted' }, 'Kein nächster Schritt notiert')),
      ),
      h('div', { class: 'task-meta' },
        h('span', { class: 'chip' }, d.B[c.board_id]?.name + ' · ' + d.S[c.stage_id]?.name),
        extra || (dl ? h('span', { class: 'due ' + dl.cls }, dl.text) : null),
      ),
    );
  };
  const section = (title, items, emptyText, render = (c) => row(c)) =>
    h('section', { class: 'panel' + (items.length ? '' : ' panel-empty') },
      h('h2', { class: 'panel-title' }, title, h('span', { class: 'count' }, items.length)),
      items.length ? h('div', { class: 'tasks' }, items.map(render)) : h('p', { class: 'empty' }, emptyText),
    );

  const greeting = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())), h('h1', {}, greeting + ', Dominik'),
        h('p', { class: 'today-summary' },
          due.length ? h('span', { class: 'due overdue' }, due.length + ' fällig') : h('span', { class: 'due later' }, 'nichts fällig'),
          week.length ? h('span', { class: 'due soon' }, week.length + ' in 7 Tagen') : null,
          stuck.length ? h('span', { class: 'due today' }, stuck.length + ' hängen fest') : null)),
    ),
    h('div', { class: 'stats' },
      d.boards.map((b) => {
        const n = live.filter((c) => c.board_id === b.id).length;
        const od = live.filter((c) => c.board_id === b.id && c.due_date && c.due_date <= today).length;
        return h('a', { class: 'stat', href: '#/board/' + b.id },
          h('span', { class: 'stat-num' }, n), h('span', { class: 'stat-label' }, b.name),
          od ? h('span', { class: 'due overdue' }, od + ' fällig') : null);
      }),
    ),
    h('div', { class: 'today-grid' },
      h('div', { class: 'col' },
        section('Fällig', due, 'Nichts fällig. Gut so.'),
        section('Nächste 7 Tage', week, 'Für die nächsten Tage ist nichts geplant.'),
      ),
      h('div', { class: 'col' },
        section(`Hängt fest (≥ ${STUCK_DAYS} Tage, kein Termin)`, stuck, 'Kein Kontakt hängt fest.',
          (c) => row(c, h('span', { class: 'due soon' }, daysSince(c.stage_entered_at) + ' Tage in Spalte'))),
        h('section', { class: 'panel' },
          h('h2', { class: 'panel-title' }, 'Zuletzt passiert'),
          events.length
            ? h('ul', { class: 'feed' }, events.map((e) => {
              const co = e.company_id ? d.F[e.company_id] : null;
              return h('li', {},
                co ? h('a', { href: '#/company/' + co.id }, co.name) : h('a', { href: '#/contact/' + e.contact_id }, fullName(d.C[e.contact_id])),
                h('span', { class: 'muted' }, ' · ' + (EVENT_KINDS[e.kind] || e.kind) + ' · ' + fmtDateTime(e.created_at)),
                e.body ? h('div', { class: 'feed-body' }, e.body) : null);
            }))
            : h('p', { class: 'empty' }, 'Noch keine Aktivität.'),
        ),
      ),
    ),
  );
}

// ---------- Boards ----------

async function viewBoards() {
  const d = await loadAll();
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Pipelines'), h('h1', {}, 'Boards')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => boardDialog() }, icon('plus'), 'Neues Board'),
    ),
    d.boards.length
      ? h('div', { class: 'board-grid' }, d.boards.map((b) => {
        const stages = d.stages.filter((s) => s.board_id === b.id);
        const cards = d.cards.filter((c) => c.board_id === b.id);
        return h('a', { class: 'board-tile', href: '#/board/' + b.id },
          h('h2', {}, b.name, isCompanyBoard(b) ? h('span', { class: 'kind-chip' }, 'Unternehmen') : null),
          b.goal ? h('p', { class: 'muted' }, b.goal) : null,
          h('div', { class: 'mini-pipe' }, stages.map((s) => {
            const n = cards.filter((c) => c.stage_id === s.id).length;
            return h('div', { class: 'mini-stage', title: s.name }, h('span', { class: 'mini-num' }, n), h('span', { class: 'mini-name' }, s.name));
          })),
          h('p', { class: 'tile-foot' }, isCompanyBoard(b) ? plural(cards.length, 'Unternehmen', 'Unternehmen') : plural(cards.length, 'Kontakt', 'Kontakte')),
        );
      }))
      : h('div', { class: 'empty big' }, h('p', {}, 'Noch kein Board. Leg dein erstes an.')),
  );
}

function boardDialog(board, cardCount = 0) {
  const name = h('input', { value: board?.name || '', placeholder: 'z. B. Steuerberater-Training' });
  const goal = h('input', { value: board?.goal || '', placeholder: 'Wofür ist das Board?' });
  const stageTxt = h('textarea', { rows: 6, placeholder: 'Eine Spalte pro Zeile' });
  const kind = h('select', { 'aria-label': 'Art des Boards', disabled: !!board && cardCount > 0 },
    h('option', { value: 'contact', selected: board?.kind !== 'company' }, 'Kontakte (Personen)'),
    h('option', { value: 'company', selected: board?.kind === 'company' }, 'Unternehmen (Kontakte erscheinen klein darunter)'));
  const body = h('div', { class: 'form' }, field('Name', name), field('Ziel', goal),
    field('Karten sind …', kind, board && cardCount > 0 ? 'Die Art lässt sich nur ändern, solange das Board leer ist.' : null));
  if (!board) {
    body.append(
      h('div', { class: 'templates' }, h('span', { class: 'muted' }, 'Vorlage: '),
        TEMPLATES.map((t) => h('button', {
          class: 'chip-btn', type: 'button',
          onclick: () => { name.value = t.name; goal.value = t.goal; kind.value = t.kind || 'contact'; stageTxt.value = t.stages.join('\n'); },
        }, t.name))),
      field('Spalten (Touchpoints / Status)', stageTxt, 'Eine pro Zeile. Lässt sich später jederzeit ändern.'),
    );
  }
  const actions = [{
    label: board ? 'Speichern' : 'Board anlegen', primary: true,
    onClick: async () => {
      if (!name.value.trim()) { toast('Bitte einen Namen eingeben.', 'error'); return false; }
      if (board) {
        const patch = { name: name.value.trim(), goal: goal.value.trim() || null };
        if (!kind.disabled) patch.kind = kind.value;
        await db.update('boards', board.id, patch);
        refresh();
        return;
      }
      const lines = stageTxt.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const b = await db.insert('boards', { name: name.value.trim(), goal: goal.value.trim() || null, kind: kind.value, position: Date.now() });
      await db.insert('stages', (lines.length ? lines : ['Neu', 'In Arbeit', 'Erledigt']).map((n, i) => ({ board_id: b.id, name: n, position: i })));
      location.hash = '#/board/' + b.id;
    },
  }];
  if (board) {
    actions.unshift({
      label: 'Board löschen', danger: true,
      onClick: async () => {
        const ok = await confirmDialog('Board löschen?', `„${board.name}“ mit allen Spalten wird gelöscht. Kontakte und Unternehmen selbst bleiben erhalten.`);
        if (!ok) return false;
        await db.remove('boards', board.id);
        location.hash = '#/boards';
      },
    });
  }
  modal(board ? 'Board bearbeiten' : 'Neues Board', body, actions);
}

function getBoardView(id) {
  try { return localStorage.getItem('why-crm-view-' + id) === 'companies' ? 'companies' : 'contacts'; } catch { return 'contacts'; }
}
function setBoardView(id, v) {
  try { localStorage.setItem('why-crm-view-' + id, v); } catch {}
}

async function viewBoard(id) {
  const d = await loadAll();
  const board = d.B[id];
  if (!board) return h('div', { class: 'empty' }, 'Board nicht gefunden. ', h('a', { href: '#/boards' }, 'Zu den Boards'));
  const stages = d.stages.filter((s) => s.board_id === id);
  const cards = d.cards.filter((c) => c.board_id === id && cardValid(d, c)).sort((a, b) => a.position - b.position);
  const co = isCompanyBoard(board);
  const view = co ? 'contacts' : getBoardView(id);
  const grouped = !co && view === 'companies';

  // Firmen-Ansicht auf Kontakt-Boards: Kontakte nach Unternehmen zusammenfassen
  const groups = [];
  const loose = [];
  if (grouped) {
    const byCo = new Map();
    for (const c of cards) {
      const ct = d.C[c.contact_id];
      if (ct?.company_id && d.F[ct.company_id]) {
        if (!byCo.has(ct.company_id)) byCo.set(ct.company_id, []);
        byCo.get(ct.company_id).push(c);
      } else loose.push(c);
    }
    for (const [companyId, list] of byCo) {
      const stageIdx = Math.max(...list.map((c) => stages.findIndex((x) => x.id === c.stage_id)));
      groups.push({ company: d.F[companyId], cards: list, stageIdx, stageId: stages[stageIdx]?.id });
    }
    groups.sort((a, b) => a.company.name.localeCompare(b.company.name, 'de'));
  }

  const column = (s, idx) => {
    const list = grouped ? [] : cards.filter((c) => c.stage_id === s.id);
    const gList = grouped ? groups.filter((g) => g.stageId === s.id) : [];
    const lList = grouped ? loose.filter((c) => c.stage_id === s.id) : [];
    const total = grouped ? gList.length + lList.length : list.length;
    const col = h('section', { class: 'column', 'data-stage': s.id },
      h('header', { class: 'column-head' }, h('h2', {}, s.name), h('span', { class: 'count' }, total)),
      h('div', { class: 'column-body' },
        grouped ? [gList.map((g) => groupEl(d, g, board, stages)), lList.map((c) => cardEl(d, c, board, stages, idx))] : list.map((c) => cardEl(d, c, board, stages, idx)),
        total ? null : h('p', { class: 'drop-hint' }, 'Hierher ziehen'),
      ),
      idx === 0 ? h('button', { class: 'add-card', type: 'button', onclick: () => addToBoardDialog(d, board, stages[0]) }, icon('plus', 16), co ? 'Unternehmen hinzufügen' : 'Kontakt hinzufügen') : null,
    );
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const dragId = e.dataTransfer.getData('text/card');
      if (dragId.startsWith('group:')) {
        const g = groups.find((x) => x.company.id === dragId.slice(6));
        if (g) await moveGroup(g, s, board, stages);
        return;
      }
      const card = cards.find((c) => c.id === dragId);
      if (card) await moveCard(card, s, board, stages);
    });
    return col;
  };

  return h('div', { class: 'page wide' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, h('a', { href: '#/boards' }, 'Boards'), co ? ' · Unternehmen' : null), h('h1', {}, board.name), board.goal ? h('p', { class: 'muted' }, board.goal) : null),
      h('div', { class: 'head-actions' },
        co ? null : h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' },
          [['contacts', 'Kontakte'], ['companies', 'Unternehmen']].map(([k, label]) =>
            h('button', { class: 'seg-btn', type: 'button', 'aria-pressed': view === k ? 'true' : 'false', onclick: () => { setBoardView(id, k); refresh(); } }, label))),
        h('button', { class: 'btn', type: 'button', onclick: () => stagesDialog(board, stages, cards) }, 'Spalten'),
        h('button', { class: 'btn', type: 'button', onclick: () => boardDialog(board, cards.length) }, icon('edit', 16), 'Board'),
        h('button', { class: 'btn', type: 'button', onclick: () => bulkAddDialog(d, board, stages[0]) }, 'Mehrere hinzufügen'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => addToBoardDialog(d, board, stages[0]) }, icon('plus'), co ? 'Unternehmen' : 'Kontakt'),
      ),
    ),
    stages.length ? h('div', { class: 'kanban' }, stages.map(column)) : h('p', { class: 'empty' }, 'Dieses Board hat noch keine Spalten.'),
  );
}

function cardEl(d, c, board, stages, idx) {
  const company = c.company_id ? d.F[c.company_id] : null;
  const contact = company ? null : d.C[c.contact_id];
  const dl = dueLabel(c.due_date);
  const days = daysSince(c.stage_entered_at);
  const next = stages[idx + 1];
  const people = company ? contactsOf(d, company.id) : [];
  const el = h('article', { class: 'card' + (company ? ' company-card' : ''), draggable: 'true' },
    h('a', { class: 'card-link', href: company ? '#/company/' + company.id : '#/contact/' + contact.id },
      company
        ? h('div', { class: 'card-head' }, logoBox(company, 'md'), h('div', { class: 'card-name' }, company.name))
        : h('div', { class: 'card-head' }, avatar(contact, 'md'), h('div', { class: 'card-name' }, fullName(contact))),
      company
        ? ((company.city || company.industry) ? h('div', { class: 'card-company' }, [company.city, company.industry].filter(Boolean).join(' · ')) : null)
        : (companyName(d, contact) ? h('div', { class: 'card-company' }, companyName(d, contact)) : null),
      c.next_step ? h('div', { class: 'card-next' }, c.next_step) : null,
    ),
    company && people.length
      ? h('ul', { class: 'mini-contacts', 'aria-label': 'Kontakte' },
        people.slice(0, 4).map((p) => h('li', {}, h('a', { href: '#/contact/' + p.id, draggable: 'false' }, fullName(p), p.job_title ? h('span', { class: 'muted' }, ' · ' + p.job_title) : null))),
        people.length > 4 ? h('li', { class: 'muted more' }, '+ ' + (people.length - 4) + ' weitere') : null)
      : null,
    h('div', { class: 'card-foot' },
      dl ? h('span', { class: 'due ' + dl.cls }, dl.text) : h('span', { class: 'muted small' }, days ? days + ' T. in Spalte' : 'neu'),
      next ? h('button', {
        class: 'icon-btn', type: 'button', title: 'Weiter nach „' + next.name + '“', 'aria-label': 'Weiter nach ' + next.name,
        onclick: () => moveCard(c, next, board, stages),
      }, icon('next', 16)) : null,
    ),
  );
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/card', c.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

async function moveCards(cards, stage, board, stages) {
  const now = new Date().toISOString();
  const events = [];
  for (const card of cards) {
    if (card.stage_id === stage.id) continue;
    const from = stages.find((s) => s.id === card.stage_id);
    await db.update('cards', card.id, { stage_id: stage.id, stage_entered_at: now, position: Date.now() });
    events.push({ ...cardTarget(card), board_id: board.id, kind: 'stage', body: `${board.name}: ${from?.name || '–'} → ${stage.name}` });
  }
  if (events.length) await db.insert('events', events);
}

async function moveCard(card, stage, board, stages) {
  if (card.stage_id === stage.id) return;
  await moveCards([card], stage, board, stages);
  refresh();
}

// Firmenkarte (Firmen-Ansicht auf Kontakt-Boards): verschiebt alle Kontakte der Firma auf diesem Board
async function moveGroup(g, stage, board, stages) {
  const todo = g.cards.filter((c) => c.stage_id !== stage.id);
  if (!todo.length) return;
  if (new Set(g.cards.map((c) => c.stage_id)).size > 1) {
    const ok = await confirmDialog('Alle Kontakte verschieben?',
      `Die Kontakte von „${g.company.name}“ stehen in verschiedenen Spalten. Alle nach „${stage.name}“ verschieben?`, 'Verschieben');
    if (!ok) return;
  }
  await moveCards(todo, stage, board, stages);
  refresh();
}

function groupEl(d, g, board, stages) {
  const next = stages[g.stageIdx + 1];
  const withDue = g.cards.filter((c) => c.due_date).sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0];
  const dl = withDue ? dueLabel(withDue.due_date) : null;
  const shownCards = g.cards.map((c) => ({ c, ct: d.C[c.contact_id] }))
    .sort((a, b) => stages.findIndex((x) => x.id === b.c.stage_id) - stages.findIndex((x) => x.id === a.c.stage_id));
  const el = h('article', { class: 'card company-card group-card', draggable: 'true' },
    h('a', { class: 'card-link', href: '#/company/' + g.company.id },
      h('div', { class: 'card-name' }, g.company.name),
      (g.company.city || g.company.industry) ? h('div', { class: 'card-company' }, [g.company.city, g.company.industry].filter(Boolean).join(' · ')) : null,
      withDue?.next_step ? h('div', { class: 'card-next' }, withDue.next_step) : null,
    ),
    h('ul', { class: 'mini-contacts', 'aria-label': 'Kontakte auf diesem Board' },
      shownCards.slice(0, 6).map(({ c, ct }) => {
        const st = stages.findIndex((x) => x.id === c.stage_id);
        const nx = stages[st + 1];
        return h('li', { class: 'mc' },
          h('a', { href: '#/contact/' + ct.id, draggable: 'false' }, fullName(ct), ct.job_title ? h('span', { class: 'muted' }, ' · ' + ct.job_title) : null),
          h('span', { class: 'stage-tag', title: 'Spalte dieses Kontakts' }, stages[st]?.name),
          nx ? h('button', { class: 'icon-btn tiny', type: 'button', title: 'Nur diesen Kontakt nach „' + nx.name + '“', 'aria-label': 'Kontakt weiter nach ' + nx.name, onclick: () => moveCard(c, nx, board, stages) }, icon('next', 12)) : null);
      }),
      shownCards.length > 6 ? h('li', { class: 'muted more' }, '+ ' + (shownCards.length - 6) + ' weitere') : null),
    h('div', { class: 'card-foot' },
      dl ? h('span', { class: 'due ' + dl.cls }, dl.text) : h('span', { class: 'muted small' }, plural(g.cards.length, 'Kontakt', 'Kontakte')),
      next ? h('button', {
        class: 'icon-btn', type: 'button', title: 'Alle Kontakte weiter nach „' + next.name + '“', 'aria-label': 'Alle Kontakte weiter nach ' + next.name,
        onclick: () => moveGroup(g, next, board, stages),
      }, icon('next', 16)) : null,
    ),
  );
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/card', 'group:' + g.company.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

function stagesDialog(board, stages, cards) {
  const rows = stages.map((s) => ({ ...s, _name: s.name }));
  const list = h('div', { class: 'stage-list' });
  const removed = [];
  const draw = () => {
    list.replaceChildren(...rows.map((s, i) => {
      const count = s.id ? cards.filter((c) => c.stage_id === s.id).length : 0;
      const input = h('input', { value: s._name, 'aria-label': 'Spaltenname', oninput: (e) => { s._name = e.target.value; } });
      return h('div', { class: 'stage-row' },
        input,
        h('span', { class: 'muted small' }, count ? count + ' Kontakte' : ''),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nach oben', disabled: i === 0, onclick: () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); } }, icon('up', 16)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Nach unten', disabled: i === rows.length - 1, onclick: () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); } }, icon('down', 16)),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Spalte löschen', disabled: count > 0,
          title: count ? 'Erst die Kontakte verschieben' : 'Löschen',
          onclick: () => { if (s.id) removed.push(s.id); rows.splice(i, 1); draw(); },
        }, icon('trash', 16)),
      );
    }));
  };
  draw();
  const newName = h('input', { placeholder: 'Neue Spalte, z. B. „Leadership-Brief 4“' });
  const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => { if (newName.value.trim()) { rows.push({ _name: newName.value.trim() }); newName.value = ''; draw(); } } }, icon('plus', 16), 'Hinzufügen');
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); } });
  modal('Spalten von „' + board.name + '“', h('div', { class: 'form' }, list, h('div', { class: 'inline' }, newName, addBtn)), [{
    label: 'Speichern', primary: true,
    onClick: async () => {
      if (rows.some((r) => !r._name.trim())) { toast('Jede Spalte braucht einen Namen.', 'error'); return false; }
      if (!rows.length) { toast('Mindestens eine Spalte wird gebraucht.', 'error'); return false; }
      for (const id of removed) await db.remove('stages', id);
      for (const [i, r] of rows.entries()) {
        if (r.id) {
          if (r._name.trim() !== r.name || r.position !== i) await db.update('stages', r.id, { name: r._name.trim(), position: i });
        } else await db.insert('stages', { board_id: board.id, name: r._name.trim(), position: i });
      }
      refresh();
    },
  }]);
}

function addToBoardDialog(d, board, stage) {
  if (!stage) { toast('Das Board braucht zuerst eine Spalte.', 'error'); return; }
  const co = isCompanyBoard(board);
  const key = co ? 'company_id' : 'contact_id';
  const onBoard = new Set(d.cards.filter((c) => c.board_id === board.id).map((c) => c[key]));
  const q = h('input', { type: 'search', placeholder: co ? 'Unternehmen, Ort oder Branche suchen …' : 'Name, Firma oder E-Mail suchen …' });
  const results = h('div', { class: 'pick-list' });
  let dlg;
  const add = async (id) => {
    await db.insert('cards', { board_id: board.id, stage_id: stage.id, [key]: id, position: Date.now(), stage_entered_at: new Date().toISOString() });
    await db.insert('events', { [key]: id, board_id: board.id, kind: 'stage', body: `${board.name}: aufgenommen in „${stage.name}“` });
    dlg.close();
    refresh();
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const matches = (co
      ? d.companies.filter((c) => !onBoard.has(c.id)).filter((c) => !term || [c.name, c.city, c.industry, c.domain].join(' ').toLowerCase().includes(term))
      : d.contacts.filter((c) => !onBoard.has(c.id)).filter((c) => !term || [fullName(c), c.email, companyName(d, c)].join(' ').toLowerCase().includes(term))
    ).slice(0, 30);
    results.replaceChildren(
      ...matches.map((c) => h('button', { class: 'pick', type: 'button', onclick: () => add(c.id) },
        h('span', {}, co ? c.name : fullName(c)),
        h('span', { class: 'muted' }, co ? plural(contactsOf(d, c.id).length, 'Kontakt', 'Kontakte') : companyName(d, c)))),
      matches.length ? '' : h('p', { class: 'empty' }, co ? 'Kein passendes Unternehmen.' : 'Kein passender Kontakt.'),
    );
  };
  q.addEventListener('input', draw);
  draw();
  const body = h('div', { class: 'form' },
    q, results,
    h('button', {
      class: 'btn wide', type: 'button',
      onclick: () => {
        dlg.close();
        if (co) companyDialog(d, null, async (c) => add(c.id).catch((e) => toast(e.message, 'error')));
        else contactDialog(d, null, async (c) => add(c.id).catch((e) => toast(e.message, 'error')));
      },
    }, icon('plus', 16), co ? 'Neues Unternehmen anlegen' : 'Neuen Kontakt anlegen'),
  );
  dlg = modal((co ? 'Unternehmen' : 'Kontakt') + ' zu „' + board.name + '“ hinzufügen', body, []);
}

// ---------- Kontakte ----------

async function viewContacts() {
  const d = await loadAll();
  const contacts = [...d.contacts].sort((a, b) => fullName(a).localeCompare(fullName(b), 'de'));
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Suchen …', 'aria-label': 'Kontakte suchen' });
  const rows = contacts.map((c) => {
    const boards = d.cards.filter((x) => x.contact_id === c.id).map((x) => d.B[x.board_id]?.name).filter(Boolean);
    const row = h('a', { class: 'contact-row', href: '#/contact/' + c.id },
      h('span', { class: 'cr-name' }, avatar(c, 'sm'), h('span', {}, fullName(c), c.job_title ? h('span', { class: 'muted small' }, ' · ' + c.job_title) : null)),
      h('span', { class: 'cr-company' }, companyName(d, c)),
      h('span', { class: 'cr-boards' }, boards.map((b) => h('span', { class: 'chip' }, b))),
    );
    row.dataset.search = [fullName(c), c.email, c.job_title, companyName(d, c), d.F[c.company_id]?.city].join(' ').toLowerCase();
    return row;
  });
  const counter = h('span', { class: 'muted' }, contacts.length + ' Kontakte');
  const importBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => hubspotImportDialog() }, 'Aus HubSpot importieren');
  fetch('import/hubspot.json', { method: 'HEAD' }).then((r) => { if (r.ok) importBtn.hidden = false; }).catch(() => {});
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) { const hit = !t || r.dataset.search.includes(t); r.hidden = !hit; if (hit) n++; }
    counter.textContent = n + ' Kontakte';
  });
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Adressbuch'), h('h1', {}, 'Kontakte')),
      h('div', { class: 'head-actions' }, importBtn, h('button', { class: 'btn primary', type: 'button', onclick: () => contactDialog(d, null, (c) => { location.hash = '#/contact/' + c.id; }) }, icon('plus'), 'Neuer Kontakt')),
    ),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search', 16), q), counter),
    contacts.length ? h('div', { class: 'contact-list' }, rows) : h('p', { class: 'empty big' }, 'Noch keine Kontakte.'),
  );
}

async function resolveCompany(d, name) {
  const n = name.trim();
  if (!n) return null;
  const hit = d.companies.find((c) => c.name.toLowerCase() === n.toLowerCase());
  if (hit) return hit.id;
  const c = await db.insert('companies', { name: n });
  d.companies.push(c);
  d.F[c.id] = c;
  return c.id;
}

function contactDialog(d, contact, onSaved, preset) {
  const v = (k) => contact?.[k] || '';
  const inp = (k, attrs = {}) => h('input', { value: v(k), ...attrs });
  const f = {
    first_name: inp('first_name', { autocomplete: 'off' }),
    last_name: inp('last_name', { autocomplete: 'off' }),
    job_title: inp('job_title'),
    email: inp('email', { type: 'email' }),
    phone: inp('phone', { type: 'tel' }),
    linkedin_url: inp('linkedin_url', { type: 'url', placeholder: 'https://www.linkedin.com/in/…' }),
    city: inp('city'),
  };
  const dl = h('datalist', { id: 'company-list' }, d.companies.map((c) => h('option', { value: c.name })));
  const company = h('input', { value: d.F[contact?.company_id]?.name || preset?.company || '', list: 'company-list', placeholder: 'Firma oder Kanzlei' });
  const website = h('input', { type: 'url', value: d.F[contact?.company_id]?.website || d.F[d.companies.find((x) => x.name === preset?.company)?.id]?.website || '', placeholder: 'https://…' });
  const notes = h('textarea', { rows: 3, value: v('notes') });
  let photo = contact?.photo || null;
  const preview = h('span', { class: 'photo-preview' });
  const fileIn = h('input', { type: 'file', accept: 'image/*' });
  const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => { photo = null; drawPhoto(); } }, 'Entfernen');
  const drawPhoto = () => {
    preview.replaceChildren(avatar({ photo, first_name: f.first_name.value, last_name: f.last_name.value, email: f.email.value }, 'lg'));
    removeBtn.hidden = !photo;
  };
  drawPhoto();
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    try { photo = await resizePhoto(file); drawPhoto(); } catch (e) { toast(e.message, 'error'); }
  });
  const photoRow = h('div', { class: 'photo-field span2' }, preview,
    h('div', { class: 'photo-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Foto wählen'), removeBtn, fileIn));
  const body = h('div', { class: 'form grid2' },
    photoRow,
    field('Vorname', f.first_name), field('Nachname', f.last_name),
    field('Firma', h('div', {}, company, dl)), field('Website der Firma', website),
    field('Position', f.job_title), field('Ort', f.city),
    field('E-Mail', f.email), field('Telefon', f.phone),
    h('div', { class: 'span2' }, field('LinkedIn', f.linkedin_url)),
    h('div', { class: 'span2' }, field('Notizen', notes)),
  );
  const actions = [{
    label: 'Speichern', primary: true,
    onClick: async () => {
      const row = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() || null]));
      row.notes = notes.value.trim() || null;
      row.photo = photo;
      if (!row.first_name && !row.last_name && !row.email) { toast('Bitte mindestens einen Namen oder eine E-Mail angeben.', 'error'); return false; }
      row.company_id = await resolveCompany(d, company.value);
      if (row.company_id && website.value.trim() && d.F[row.company_id]?.website !== website.value.trim()) {
        await db.update('companies', row.company_id, { website: website.value.trim() });
      }
      const saved = contact ? await db.update('contacts', contact.id, row) : await db.insert('contacts', row);
      if (onSaved) await onSaved(saved);
      else refresh();
    },
  }];
  if (contact) {
    actions.unshift({
      label: 'Löschen', danger: true,
      onClick: async () => {
        const ok = await confirmDialog('Kontakt löschen?', `${fullName(contact)} wird mit Verlauf, Transkripten und Recherchen endgültig gelöscht.`);
        if (!ok) return false;
        await db.remove('contacts', contact.id);
        location.hash = '#/contacts';
      },
    });
  }
  modal(contact ? 'Kontakt bearbeiten' : 'Neuer Kontakt', body, actions);
}

// ---------- Kontaktseite ----------

let contactTab = 'timeline';

async function viewContact(id) {
  const d = await loadAll();
  const c = d.C[id];
  if (!c) return h('div', { class: 'empty' }, 'Kontakt nicht gefunden. ', h('a', { href: '#/contacts' }, 'Zu den Kontakten'));
  const company = d.F[c.company_id];
  const [events, transcripts, research] = await Promise.all([
    db.list('events', { eq: { contact_id: id }, order: ['created_at', false] }),
    db.list('transcripts', { eq: { contact_id: id }, order: ['created_at', false] }),
    db.list('research', { eq: { contact_id: id }, order: ['created_at', false] }),
  ]);
  const memberships = d.cards.filter((x) => x.contact_id === id && d.B[x.board_id]);

  const info = (label, value, href) => value ? h('div', { class: 'info' }, h('dt', {}, label), h('dd', {}, href ? h('a', { href, target: href.startsWith('http') ? '_blank' : null, rel: 'noopener noreferrer' }, value) : value)) : null;
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

  const profile = h('section', { class: 'panel' },
    h('div', { class: 'panel-title row-between' }, h('h2', {}, 'Profil'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bearbeiten', onclick: () => contactDialog(d, c) }, icon('edit', 16))),
    h('dl', { class: 'infos' },
      info('Firma', company?.name, company ? '#/company/' + company.id : null), info('Position', c.job_title), info('Ort', c.city || company?.city),
      info('E-Mail', c.email, c.email ? 'mailto:' + c.email : null), info('Telefon', c.phone, c.phone ? 'tel:' + c.phone.replace(/\s/g, '') : null),
      info('LinkedIn', safeUrl(c.linkedin_url) ? 'Profil öffnen' : null, safeUrl(c.linkedin_url)),
      info('Website', safeUrl(company?.website) ? company.website.replace(/^https?:\/\//, '') : null, safeUrl(company?.website)),
    ),
    c.notes ? h('p', { class: 'notes' }, c.notes) : null,
  );

  const boardsPanel = h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Boards'),
    memberships.map((m) => membershipEl(d, m)),
    addMembershipEl(d, { contact_id: c.id }, memberships),
  );

  const tabs = [
    ['timeline', 'Verlauf', events.length, () => timelineEl({ contact_id: c.id }, events)],
    ['transcripts', 'Transkripte', transcripts.length, () => transcriptsEl(c, transcripts)],
    ['research', 'Recherche', research.length, () => researchEl(d, c, research)],
  ];
  if (!tabs.some((t) => t[0] === contactTab)) contactTab = 'timeline';
  const tabBody = h('div', { class: 'tab-body' });
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const select = (key) => {
    contactTab = key;
    for (const b of tabBar.children) b.setAttribute('aria-selected', b.dataset.key === key ? 'true' : 'false');
    tabBody.replaceChildren(tabs.find((t) => t[0] === key)[3]());
  };
  for (const [key, label, n] of tabs) {
    const b = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => select(key) }, label, n ? h('span', { class: 'count' }, n) : null);
    b.dataset.key = key;
    tabBar.append(b);
  }
  select(contactTab);

  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', { class: 'head-person' },
        avatar(c, 'lg'),
        h('div', {},
          h('p', { class: 'eyebrow' }, h('a', { href: '#/contacts' }, 'Kontakte')),
          h('h1', {}, fullName(c)),
          h('p', { class: 'muted' }, [c.job_title, company?.name].filter(Boolean).join(' · ')),
        ),
      ),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => { contactTab = 'research'; researchDialog(d, c); } }, icon('spark', 16), 'Recherche'),
        h('button', { class: 'btn', type: 'button', onclick: () => contactDialog(d, c) }, icon('edit', 16), 'Bearbeiten'),
      ),
    ),
    h('div', { class: 'contact-grid' },
      h('div', { class: 'col side' }, boardsPanel, profile),
      h('div', { class: 'col' }, h('section', { class: 'panel' }, tabBar, tabBody)),
    ),
  );
}

function membershipEl(d, m) {
  const board = d.B[m.board_id];
  const stages = d.stages.filter((s) => s.board_id === board.id);
  const stageSel = h('select', {
    'aria-label': 'Spalte',
    onchange: (e) => moveCard(m, d.S[e.target.value], board, stages),
  }, stages.map((s) => h('option', { value: s.id, selected: s.id === m.stage_id }, s.name)));
  const next = h('input', { value: m.next_step || '', placeholder: 'Nächster Schritt …' });
  const due = h('input', { type: 'date', value: m.due_date || '' });
  const save = async () => {
    const patch = { next_step: next.value.trim() || null, due_date: due.value || null };
    if (patch.next_step === (m.next_step || null) && patch.due_date === (m.due_date || null)) return;
    await db.update('cards', m.id, patch);
    Object.assign(m, patch);
    toast('Gespeichert');
  };
  next.addEventListener('change', save);
  due.addEventListener('change', save);
  return h('div', { class: 'membership' },
    h('div', { class: 'row-between' },
      h('a', { class: 'mem-board', href: '#/board/' + board.id }, board.name),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Vom Board entfernen', title: 'Vom Board entfernen',
        onclick: async () => {
          if (!(await confirmDialog('Vom Board entfernen?', `${m.company_id ? 'Das Unternehmen' : 'Der Kontakt'} wird von „${board.name}“ entfernt. Verlauf und Daten bleiben.`, 'Entfernen'))) return;
          await db.remove('cards', m.id);
          await db.insert('events', { ...cardTarget(m), board_id: null, kind: 'stage', body: `Von „${board.name}“ entfernt` });
          refresh();
        },
      }, icon('trash', 16)),
    ),
    stageSel,
    h('div', { class: 'mem-fields' }, next, due),
    h('p', { class: 'muted small' }, 'Seit ' + daysSince(m.stage_entered_at) + ' Tagen in dieser Spalte'),
  );
}

function addMembershipEl(d, owner, memberships) {
  const wantCo = !!owner.company_id;
  const free = d.boards.filter((b) => isCompanyBoard(b) === wantCo && !memberships.some((m) => m.board_id === b.id));
  if (!free.length) return null;
  const sel = h('select', { 'aria-label': 'Board wählen' }, h('option', { value: '' }, 'Zu Board hinzufügen …'), free.map((b) => h('option', { value: b.id }, b.name)));
  sel.addEventListener('change', async () => {
    const board = d.B[sel.value];
    const first = d.stages.find((s) => s.board_id === board?.id);
    if (!board || !first) return;
    await db.insert('cards', { board_id: board.id, stage_id: first.id, ...owner, position: Date.now(), stage_entered_at: new Date().toISOString() });
    await db.insert('events', { ...owner, board_id: board.id, kind: 'stage', body: `${board.name}: aufgenommen in „${first.name}“` });
    refresh();
  });
  return h('div', { class: 'add-mem' }, sel);
}

function timelineEl(owner, events) {
  const kind = h('select', { 'aria-label': 'Art' }, ['note', 'call', 'email', 'meeting', 'touchpoint'].map((k) => h('option', { value: k }, EVENT_KINDS[k])));
  const text = h('textarea', { rows: 3, placeholder: 'Was ist passiert?' });
  const form = h('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      await db.insert('events', { ...owner, kind: kind.value, body: text.value.trim() });
      refresh();
    },
  }, text, h('div', { class: 'inline' }, kind, h('button', { class: 'btn primary', type: 'submit' }, 'Eintragen')));
  return h('div', {},
    form,
    events.length
      ? h('ol', { class: 'timeline' }, events.map((e) => h('li', { class: 'tl-item kind-' + e.kind },
        h('div', { class: 'tl-head' }, h('span', { class: 'tl-kind' }, EVENT_KINDS[e.kind] || e.kind), h('time', { class: 'muted small', datetime: e.created_at }, fmtDateTime(e.created_at)),
          ['note', 'call', 'email', 'meeting', 'touchpoint'].includes(e.kind)
            ? h('button', { class: 'icon-btn tl-del', type: 'button', 'aria-label': 'Eintrag löschen', onclick: async () => { if (await confirmDialog('Eintrag löschen?', 'Der Eintrag wird endgültig entfernt.')) { await db.remove('events', e.id); refresh(); } } }, icon('trash', 14))
            : null),
        e.body ? h('p', { class: 'tl-body' }, e.body) : null)))
      : h('p', { class: 'empty' }, 'Noch kein Verlauf.'),
  );
}

// ---------- Transkripte ----------

let mammothLoading;
function loadMammoth() {
  mammothLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
    s.onload = () => res(window.mammoth);
    s.onerror = () => rej(new Error('Word-Import konnte nicht geladen werden'));
    document.head.append(s);
  });
  return mammothLoading;
}

async function readFileText(file) {
  if (/\.docx$/i.test(file.name)) {
    const m = await loadMammoth();
    const r = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value;
  }
  return file.text();
}

function transcriptsEl(c, transcripts) {
  const title = h('input', { placeholder: 'Titel, z. B. „Erstgespräch“' });
  const date = h('input', { type: 'date', value: todayISO(), 'aria-label': 'Datum' });
  const content = h('textarea', { rows: 8, placeholder: 'Transkript aus Wispr Flow hier einfügen …' });
  const file = h('input', { type: 'file', accept: '.txt,.md,.docx,text/plain,text/markdown', hidden: true });
  const drop = h('button', { class: 'file-drop', type: 'button', onclick: () => file.click() }, 'Datei wählen oder hierher ziehen (.txt, .md, .docx)');
  const useFile = async (f) => {
    if (!f) return;
    try {
      content.value = (await readFileText(f)).trim();
      if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '');
      drop.textContent = '✓ ' + f.name;
    } catch (e) { toast(e.message, 'error'); }
  };
  file.addEventListener('change', () => useFile(file.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag-over'); useFile(e.dataTransfer.files[0]); });

  const form = h('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!content.value.trim()) { toast('Das Transkript ist leer.', 'error'); return; }
      const t = title.value.trim() || 'Transkript vom ' + fmtDate(date.value);
      await db.insert('transcripts', { contact_id: c.id, title: t, content: content.value.trim(), occurred_at: date.value || null, source: 'Wispr Flow' });
      await db.insert('events', { contact_id: c.id, kind: 'transcript', body: t });
      toast('Transkript gespeichert');
      refresh();
    },
  },
    h('div', { class: 'inline' }, title, date),
    content, drop, file,
    h('div', { class: 'inline end' }, h('button', { class: 'btn primary', type: 'submit' }, 'Transkript speichern')),
  );

  const words = (s) => (s.match(/\S+/g) || []).length;
  return h('div', {},
    form,
    transcripts.length
      ? h('div', { class: 'docs' }, transcripts.map((t) => h('details', { class: 'doc' },
        h('summary', {}, h('span', { class: 'doc-title' }, t.title || 'Transkript'), h('span', { class: 'muted small' }, fmtDate(t.occurred_at || t.created_at) + ' · ' + words(t.content) + ' Wörter')),
        h('div', { class: 'doc-actions' },
          h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(t.content); toast('Kopiert'); } catch { toast('Kopieren nicht möglich', 'error'); } } }, 'Kopieren'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Transkript löschen?', `„${t.title}“ wird endgültig gelöscht.`)) { await db.remove('transcripts', t.id); refresh(); } } }, 'Löschen'),
        ),
        h('div', { class: 'doc-text' }, t.content),
      )))
      : h('p', { class: 'empty' }, 'Noch keine Transkripte.'),
  );
}

// ---------- Recherche ----------

function researchEl(d, c, research) {
  return h('div', {},
    h('div', { class: 'research-cta' },
      h('p', { class: 'muted' }, 'Du bestimmst, was du wissen willst. Claude Code arbeitet die vorgemerkten Recherchen ab (Befehl /recherche).'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => researchDialog(d, c) }, icon('spark', 16), 'Recherche vormerken'),
    ),
    research.length
      ? research.map((r) => h('article', { class: 'research' },
        h('header', { class: 'row-between' },
          h('div', {},
            h('strong', {}, fmtDateTime(r.created_at)),
            h('div', { class: 'chips' }, (r.questions?.topics || []).map((k) => h('span', { class: 'chip' }, RESEARCH_TOPICS.find((t) => t[0] === k)?.[1] || k))),
          ),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Recherche löschen', onclick: async () => { if (await confirmDialog('Recherche löschen?', 'Das Dossier wird endgültig gelöscht.')) { await db.remove('research', r.id); refresh(); } } }, icon('trash', 16)),
        ),
        r.questions?.custom ? h('p', { class: 'muted small' }, 'Frage: ' + r.questions.custom) : null,
        r.status === 'queued' ? h('p', { class: 'running' }, h('span', { class: 'spinner' }), 'Vorgemerkt: in Claude Code „/recherche“ ausführen.') : null,
        r.status === 'running' ? h('p', { class: 'running' }, h('span', { class: 'spinner' }), 'Recherche läuft …') : null,
        r.status === 'error' ? h('p', { class: 'form-error' }, 'Fehler: ' + (r.error || 'unbekannt')) : null,
        r.result ? renderMarkdown(r.result) : null,
        r.sources?.length ? h('div', { class: 'sources' }, h('h4', {}, 'Quellen'), h('ol', {}, r.sources.map((s) => /^https?:\/\//.test(s.url) ? h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || s.url)) : null))) : null,
      ))
      : h('p', { class: 'empty' }, 'Noch keine Recherche.'),
  );
}

function researchDialog(d, c) {
  const boxes = RESEARCH_TOPICS.map(([key, label, desc]) => {
    const cb = h('input', { type: 'checkbox', value: key, checked: key !== 'news' });
    return { cb, el: h('label', { class: 'check' }, cb, h('span', {}, h('strong', {}, label), h('span', { class: 'muted small' }, desc))) };
  });
  const custom = h('textarea', { rows: 3, placeholder: 'Eigene Frage, z. B. „Gibt es Hinweise auf Nachfolgeplanung in der Kanzlei?“' });
  const company = d.F[c.company_id];
  modal('Recherche vormerken: ' + fullName(c), h('div', { class: 'form' },
    h('p', { class: 'muted small' }, 'Gesucht wird mit: ' + [fullName(c), c.job_title, company?.name, company?.website, c.city || company?.city].filter(Boolean).join(' · ')),
    boxes.map((b) => b.el),
    field('Was willst du sonst noch wissen?', custom),
  ), [{
    label: 'Recherche vormerken', primary: true,
    onClick: async () => {
      const topics = boxes.filter((b) => b.cb.checked).map((b) => b.cb.value);
      if (!topics.length && !custom.value.trim()) { toast('Bitte mindestens ein Thema wählen.', 'error'); return false; }
      await db.insert('research', { contact_id: c.id, questions: { topics, custom: custom.value.trim() || null }, status: 'queued' });
      await db.insert('events', { contact_id: c.id, kind: 'research', body: 'Recherche vorgemerkt' });
      contactTab = 'research';
      refresh();
      toast('Vorgemerkt. In Claude Code „/recherche“ ausführen.');
    },
  }]);
}

// ---------- HubSpot-Import (einmalig, nur lokal: import/hubspot.json ist nicht im Repo) ----------

function hubspotImportDialog() {
  const status = h('p', { class: 'muted' }, 'Liest import/hubspot.json und legt Firmen und Kontakte an. Bereits importierte Einträge werden aktualisiert, nicht doppelt angelegt.');
  modal('Aus HubSpot importieren', status, [{
    label: 'Import starten', primary: true,
    onClick: async () => {
      const data = await (await fetch('import/hubspot.json')).json();
      const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
      const idMap = {};
      for (const part of chunk(data.companies, 100)) {
        const rows = await db.upsert('companies', part.map((c) => ({ hubspot_id: c.hs_object_id, name: c.name || c.domain || 'Ohne Namen', domain: c.domain, website: c.domain ? 'https://' + c.domain : null, city: c.city, industry: c.industry })), 'hubspot_id');
        for (const r of rows) idMap[r.hubspot_id] = r.id;
      }
      let n = 0;
      for (const part of chunk(data.contacts, 100)) {
        const rows = part.map((c) => ({ hubspot_id: c.hs_object_id, first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone, job_title: c.job_title, city: c.city, company_id: idMap[c.company] || null }));
        n += (await db.upsert('contacts', rows, 'hubspot_id')).length;
      }
      toast(`${Object.keys(idMap).length} Firmen und ${n} Kontakte importiert.`);
      refresh();
    },
  }]);
}

// ---------- Mehrere Kontakte/Unternehmen auf einmal aufs Board ----------

function bulkAddDialog(d, board, stage) {
  if (!stage) { toast('Das Board braucht zuerst eine Spalte.', 'error'); return; }
  const co = isCompanyBoard(board);
  const key = co ? 'company_id' : 'contact_id';
  const onBoard = new Set(d.cards.filter((c) => c.board_id === board.id).map((c) => c[key]));
  const q = h('input', { type: 'search', placeholder: 'z. B. Steuerberater  (mehrere Wörter = alle müssen vorkommen)', 'aria-label': 'Filter' });
  const where = h('select', { 'aria-label': 'Suchen in' },
    h('option', { value: 'all' }, co ? 'in allem (Firma, Ort, Branche, Kontakte)' : 'in allem (Name, Position, Firma, Ort, E-Mail)'),
    h('option', { value: 'job' }, co ? 'nur in den Positionen der Kontakte' : 'nur in der Position'),
    h('option', { value: 'company' }, 'nur im Firmennamen'));
  const list = h('div', { class: 'pick-list bulk' });
  const info = h('p', { class: 'muted small' });
  let shown = [];
  const checks = new Map();

  const haystack = (x) => {
    if (co) {
      const people = contactsOf(d, x.id);
      const jobs = people.map((p) => p.job_title || '').join(' ');
      const names = people.map(fullName).join(' ');
      if (where.value === 'job') return jobs.toLowerCase();
      if (where.value === 'company') return (x.name || '').toLowerCase();
      return [x.name, x.city, x.industry, x.domain, jobs, names].join(' ').toLowerCase();
    }
    const job = (x.job_title || '').toLowerCase();
    const comp = companyName(d, x).toLowerCase();
    if (where.value === 'job') return job;
    if (where.value === 'company') return comp;
    return [fullName(x), x.email, job, comp, x.city, d.F[x.company_id]?.city].join(' ').toLowerCase();
  };
  const selectedCount = () => [...checks.values()].filter((cb) => cb.checked).length;
  const updateInfo = () => {
    info.textContent = shown.length
      ? `${shown.length} Treffer, ${selectedCount()} ausgewählt. Sie kommen in die Spalte „${stage.name}“.`
      : 'Gib einen Suchbegriff ein.';
  };
  const draw = () => {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    checks.clear();
    const pool = co ? d.companies : d.contacts;
    const label = (x) => (co ? x.name : fullName(x));
    shown = words.length
      ? pool.filter((x) => !onBoard.has(x.id)).filter((x) => { const t = haystack(x); return words.every((w) => t.includes(w)); })
          .sort((a, b) => label(a).localeCompare(label(b), 'de'))
      : [];
    list.replaceChildren(...shown.map((x) => {
      const cb = h('input', { type: 'checkbox', checked: true, onchange: updateInfo });
      checks.set(x.id, cb);
      const meta = co
        ? [plural(contactsOf(d, x.id).length, 'Kontakt', 'Kontakte'), x.city].filter(Boolean).join(' · ')
        : [x.job_title, companyName(d, x)].filter(Boolean).join(' · ');
      return h('label', { class: 'pick' }, cb, h('span', { class: 'pick-main' }, h('strong', {}, label(x)), h('span', { class: 'muted small' }, meta)));
    }));
    if (words.length && !shown.length) list.append(h('p', { class: 'empty' }, 'Nichts passt (oder alle Treffer sind schon auf dem Board).'));
    updateInfo();
  };
  q.addEventListener('input', draw);
  where.addEventListener('change', draw);
  updateInfo();

  const toggleAll = (on) => { for (const cb of checks.values()) cb.checked = on; updateInfo(); };
  modal((co ? 'Mehrere Unternehmen' : 'Mehrere Kontakte') + ' zu „' + board.name + '“', h('div', { class: 'form' },
    field('Filter', q), field('Suchen', where),
    h('div', { class: 'inline' },
      h('button', { class: 'btn small', type: 'button', onclick: () => toggleAll(true) }, 'Alle wählen'),
      h('button', { class: 'btn small', type: 'button', onclick: () => toggleAll(false) }, 'Keine wählen')),
    info, list,
  ), [{
    label: 'Hinzufügen', primary: true,
    onClick: async () => {
      const ids = [...checks].filter(([, cb]) => cb.checked).map(([id]) => id);
      if (!ids.length) { toast('Nichts ausgewählt.', 'error'); return false; }
      const now = new Date().toISOString();
      const base = Date.now();
      for (let i = 0; i < ids.length; i += 100) {
        const part = ids.slice(i, i + 100);
        await db.insert('cards', part.map((id, j) => ({ board_id: board.id, stage_id: stage.id, [key]: id, position: base + i + j, stage_entered_at: now })));
        await db.insert('events', part.map((id) => ({ [key]: id, board_id: board.id, kind: 'stage', body: `${board.name}: aufgenommen in „${stage.name}“` })));
      }
      toast(ids.length + ' hinzugefügt.');
      refresh();
    },
  }]);
}

// ---------- Unternehmen ----------

async function viewCompanies() {
  const d = await loadAll();
  const companies = [...d.companies].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Suchen …', 'aria-label': 'Unternehmen suchen' });
  const rows = companies.map((c) => {
    const people = contactsOf(d, c.id);
    const boards = d.cards.filter((x) => x.company_id === c.id).map((x) => d.B[x.board_id]?.name).filter(Boolean);
    const row = h('a', { class: 'contact-row', href: '#/company/' + c.id },
      h('span', { class: 'cr-name' }, logoBox(c, 'sm'), h('span', {}, c.name, c.city ? h('span', { class: 'muted small' }, ' · ' + c.city) : null)),
      h('span', { class: 'cr-company' }, plural(people.length, 'Kontakt', 'Kontakte')),
      h('span', { class: 'cr-boards' }, boards.map((b) => h('span', { class: 'chip' }, b))),
    );
    row.dataset.search = [c.name, c.city, c.industry, c.domain, ...people.map((p) => fullName(p) + ' ' + (p.job_title || ''))].join(' ').toLowerCase();
    return row;
  });
  const counter = h('span', { class: 'muted' }, companies.length + ' Unternehmen');
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) { const hit = !t || r.dataset.search.includes(t); r.hidden = !hit; if (hit) n++; }
    counter.textContent = n + ' Unternehmen';
  });
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Firmen und Kanzleien'), h('h1', {}, 'Unternehmen')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => companyDialog(d, null, (c) => { location.hash = '#/company/' + c.id; }) }, icon('plus'), 'Neues Unternehmen'),
    ),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search', 16), q), counter),
    companies.length ? h('div', { class: 'contact-list' }, rows) : h('p', { class: 'empty big' }, 'Noch keine Unternehmen.'),
  );
}

function companyDialog(d, company, onSaved) {
  const f = {
    name: h('input', { value: company?.name || '', placeholder: 'Firma oder Kanzlei' }),
    website: h('input', { type: 'url', value: company?.website || '', placeholder: 'https://…' }),
    city: h('input', { value: company?.city || '' }),
    industry: h('input', { value: company?.industry || '', placeholder: 'z. B. Steuerberatung' }),
  };
  const notes = h('textarea', { rows: 3, value: company?.notes || '' });
  let logo = company?.logo || null;
  const preview = h('span', {});
  const fileIn = h('input', { type: 'file', accept: 'image/*' });
  const fetchBtn = h('button', { class: 'btn', type: 'button' }, 'Von Website holen');
  const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => { logo = null; drawLogo(); } }, 'Entfernen');
  const drawLogo = () => {
    preview.replaceChildren(logoBox({ name: f.name.value, logo }, 'lg'));
    removeBtn.hidden = !logo;
  };
  drawLogo();
  f.name.addEventListener('input', () => { if (!logo) drawLogo(); });
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    try { logo = await fetchLogo(f.website.value); drawLogo(); } catch (e) { toast(e.message, 'error'); }
    fetchBtn.disabled = false;
  });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    fileIn.value = '';
    if (!file) return;
    try {
      if (!/^image\//.test(file.type)) throw new Error('Bitte eine Bilddatei wählen.');
      logo = (await resizeLogo(file)).dataUrl; drawLogo();
    } catch (e) { toast(e.message, 'error'); }
  });
  const logoRow = h('div', { class: 'logo-field span2' }, preview,
    h('div', { class: 'photo-actions' }, fetchBtn,
      h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, 'Logo wählen'), removeBtn, fileIn));
  const body = h('div', { class: 'form grid2' },
    logoRow,
    h('div', { class: 'span2' }, field('Name', f.name)),
    field('Website', f.website), field('Ort', f.city),
    h('div', { class: 'span2' }, field('Branche', f.industry)),
    h('div', { class: 'span2' }, field('Notizen', notes)),
  );
  const actions = [{
    label: 'Speichern', primary: true,
    onClick: async () => {
      const row = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() || null]));
      row.notes = notes.value.trim() || null;
      row.logo = logo;
      if (!row.name) { toast('Bitte einen Namen eingeben.', 'error'); return false; }
      const saved = company ? await db.update('companies', company.id, row) : await db.insert('companies', row);
      if (onSaved) await onSaved(saved);
      else refresh();
    },
  }];
  if (company) {
    actions.unshift({
      label: 'Löschen', danger: true,
      onClick: async () => {
        const ok = await confirmDialog('Unternehmen löschen?', `„${company.name}“ wird mit Verlauf und Board-Karten gelöscht. Die Kontakte bleiben erhalten, verlieren aber die Firmenzuordnung.`);
        if (!ok) return false;
        await db.remove('companies', company.id);
        location.hash = '#/companies';
      },
    });
  }
  modal(company ? 'Unternehmen bearbeiten' : 'Neues Unternehmen', body, actions);
}

async function viewCompany(id) {
  const d = await loadAll();
  const c = d.F[id];
  if (!c) return h('div', { class: 'empty' }, 'Unternehmen nicht gefunden. ', h('a', { href: '#/companies' }, 'Zu den Unternehmen'));
  const events = await db.list('events', { eq: { company_id: id }, order: ['created_at', false] });
  const memberships = d.cards.filter((x) => x.company_id === id && d.B[x.board_id]);
  const people = contactsOf(d, id).sort((a, b) => fullName(a).localeCompare(fullName(b), 'de'));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const info = (label, value, href) => value ? h('div', { class: 'info' }, h('dt', {}, label), h('dd', {}, href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, value) : value)) : null;

  const profile = h('section', { class: 'panel' },
    h('div', { class: 'panel-title row-between' }, h('h2', {}, 'Profil'), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Bearbeiten', onclick: () => companyDialog(d, c) }, icon('edit', 16))),
    h('dl', { class: 'infos' }, info('Ort', c.city), info('Branche', c.industry),
      info('Website', safeUrl(c.website) ? c.website.replace(/^https?:\/\//, '') : null, safeUrl(c.website))),
    c.notes ? h('p', { class: 'notes' }, c.notes) : null,
  );
  const boardsPanel = h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Boards'),
    memberships.map((m) => membershipEl(d, m)),
    addMembershipEl(d, { company_id: id }, memberships) || (memberships.length ? null : h('p', { class: 'empty' }, 'Lege zuerst ein Unternehmens-Board an.')),
  );
  const contactsPanel = h('section', { class: 'panel' },
    h('div', { class: 'panel-title row-between' },
      h('h2', {}, 'Kontakte', h('span', { class: 'count' }, people.length)),
      h('button', { class: 'btn small', type: 'button', onclick: () => contactDialog(d, null, (ct) => { location.hash = '#/contact/' + ct.id; }, { company: c.name }) }, icon('plus', 14), 'Kontakt')),
    people.length
      ? h('ul', { class: 'people' }, people.map((p) => h('li', {}, h('a', { href: '#/contact/' + p.id },
        h('strong', {}, fullName(p)), p.job_title ? h('span', { class: 'muted small' }, p.job_title) : null,
        p.email ? h('span', { class: 'muted small' }, p.email) : null))))
      : h('p', { class: 'empty' }, 'Noch keine Kontakte bei diesem Unternehmen.'),
  );
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', { class: 'head-person' }, logoBox(c, 'lg'),
        h('div', {}, h('p', { class: 'eyebrow' }, h('a', { href: '#/companies' }, 'Unternehmen')), h('h1', {}, c.name),
          h('p', { class: 'muted' }, [c.industry, c.city].filter(Boolean).join(' · ')))),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => companyDialog(d, c) }, icon('edit', 16), 'Bearbeiten')),
    ),
    h('div', { class: 'contact-grid' },
      h('div', { class: 'col side' }, boardsPanel, profile),
      h('div', { class: 'col' }, contactsPanel, h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Verlauf'), timelineEl({ company_id: id }, events))),
    ),
  );
}

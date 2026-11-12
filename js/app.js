import { db, mode, TEMPLATES } from './db.js';
import { STUCK_DAYS } from './config.js';
import {
  h, icon, modal, confirmDialog, toast, field, todayISO, addDays, daysSince,
  fmtDate, fmtDateTime, dueLabel, fullName, byId, renderMarkdown,
} from './ui.js';

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
    else content = await viewToday();
  } catch (e) {
    console.error(e);
    content = h('div', { class: 'empty error' }, 'Da ist etwas schiefgelaufen: ', e.message);
  }
  const active = view === 'board' ? 'boards' : view === 'contact' ? 'contacts' : view || 'today';
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
  const nav = [['today', 'Heute'], ['boards', 'Boards'], ['contacts', 'Kontakte']];
  return h('div', { class: 'shell' },
    h('nav', { class: 'nav', 'aria-label': 'Hauptnavigation' },
      h('a', { class: 'brand', href: '#/today' }, 'the', h('b', {}, 'WHY'), 'KINGS', h('span', {}, 'CRM')),
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
    h('main', { class: 'main' }, content),
  );
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
    h('div', { class: 'brand big' }, 'the', h('b', {}, 'WHY'), 'KINGS', h('span', {}, 'CRM')),
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

// ---------- Heute ----------

async function viewToday() {
  const d = await loadAll();
  const today = todayISO();
  const live = d.cards.filter((c) => d.C[c.contact_id] && d.S[c.stage_id]);
  const due = live.filter((c) => c.due_date && c.due_date <= today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const week = live.filter((c) => c.due_date && c.due_date > today && c.due_date <= addDays(today, 7)).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  const stuck = live
    .filter((c) => !c.due_date && daysSince(c.stage_entered_at) >= STUCK_DAYS)
    .sort((a, b) => (a.stage_entered_at < b.stage_entered_at ? -1 : 1));
  const events = await db.list('events', { order: ['created_at', false], limit: 8 });

  const row = (c, extra) => {
    const contact = d.C[c.contact_id];
    const dl = dueLabel(c.due_date);
    return h('a', { class: 'task', href: '#/contact/' + contact.id },
      h('div', { class: 'task-main' },
        h('div', { class: 'task-name' }, fullName(contact), companyName(d, contact) ? h('span', { class: 'muted' }, ' · ' + companyName(d, contact)) : null),
        h('div', { class: 'task-sub' }, c.next_step || h('span', { class: 'muted' }, 'Kein nächster Schritt notiert')),
      ),
      h('div', { class: 'task-meta' },
        h('span', { class: 'chip' }, d.B[c.board_id]?.name + ' · ' + d.S[c.stage_id]?.name),
        extra || (dl ? h('span', { class: 'due ' + dl.cls }, dl.text) : null),
      ),
    );
  };
  const section = (title, items, emptyText, render = (c) => row(c)) =>
    h('section', { class: 'panel' },
      h('h2', { class: 'panel-title' }, title, h('span', { class: 'count' }, items.length)),
      items.length ? h('div', { class: 'tasks' }, items.map(render)) : h('p', { class: 'empty' }, emptyText),
    );

  const greeting = new Date().getHours() < 11 ? 'Guten Morgen' : new Date().getHours() < 18 ? 'Hallo' : 'Guten Abend';
  return h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())), h('h1', {}, greeting + ', Dominik')),
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
              const contact = d.C[e.contact_id];
              return h('li', {},
                h('a', { href: '#/contact/' + e.contact_id }, fullName(contact)),
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
          h('h2', {}, b.name),
          b.goal ? h('p', { class: 'muted' }, b.goal) : null,
          h('div', { class: 'mini-pipe' }, stages.map((s) => {
            const n = cards.filter((c) => c.stage_id === s.id).length;
            return h('div', { class: 'mini-stage', title: s.name }, h('span', { class: 'mini-num' }, n), h('span', { class: 'mini-name' }, s.name));
          })),
          h('p', { class: 'tile-foot' }, cards.length + (cards.length === 1 ? ' Kontakt' : ' Kontakte')),
        );
      }))
      : h('div', { class: 'empty big' }, h('p', {}, 'Noch kein Board. Leg dein erstes an.')),
  );
}

function boardDialog(board, stages) {
  const name = h('input', { value: board?.name || '', placeholder: 'z. B. Steuerberater-Training' });
  const goal = h('input', { value: board?.goal || '', placeholder: 'Wofür ist das Board?' });
  const stageTxt = h('textarea', { rows: 6, placeholder: 'Eine Spalte pro Zeile' });
  const body = h('div', { class: 'form' }, field('Name', name), field('Ziel', goal));
  if (!board) {
    body.append(
      h('div', { class: 'templates' }, h('span', { class: 'muted' }, 'Vorlage: '),
        TEMPLATES.map((t) => h('button', {
          class: 'chip-btn', type: 'button',
          onclick: () => { name.value = t.name; goal.value = t.goal; stageTxt.value = t.stages.join('\n'); },
        }, t.name))),
      field('Spalten (Touchpoints / Status)', stageTxt, 'Eine pro Zeile. Lässt sich später jederzeit ändern.'),
    );
  }
  const actions = [{
    label: board ? 'Speichern' : 'Board anlegen', primary: true,
    onClick: async () => {
      if (!name.value.trim()) { toast('Bitte einen Namen eingeben.', 'error'); return false; }
      if (board) {
        await db.update('boards', board.id, { name: name.value.trim(), goal: goal.value.trim() || null });
        refresh();
        return;
      }
      const lines = stageTxt.value.split('\n').map((s) => s.trim()).filter(Boolean);
      const b = await db.insert('boards', { name: name.value.trim(), goal: goal.value.trim() || null, position: Date.now() });
      await db.insert('stages', (lines.length ? lines : ['Neu', 'In Arbeit', 'Erledigt']).map((n, i) => ({ board_id: b.id, name: n, position: i })));
      location.hash = '#/board/' + b.id;
    },
  }];
  if (board) {
    actions.unshift({
      label: 'Board löschen', danger: true,
      onClick: async () => {
        const ok = await confirmDialog('Board löschen?', `„${board.name}“ mit allen Spalten wird gelöscht. Die Kontakte selbst bleiben erhalten.`);
        if (!ok) return false;
        await db.remove('boards', board.id);
        location.hash = '#/boards';
      },
    });
  }
  modal(board ? 'Board bearbeiten' : 'Neues Board', body, actions);
}

async function viewBoard(id) {
  const d = await loadAll();
  const board = d.B[id];
  if (!board) return h('div', { class: 'empty' }, 'Board nicht gefunden. ', h('a', { href: '#/boards' }, 'Zu den Boards'));
  const stages = d.stages.filter((s) => s.board_id === id);
  const cards = d.cards.filter((c) => c.board_id === id && d.C[c.contact_id]).sort((a, b) => a.position - b.position);

  const column = (s, idx) => {
    const list = cards.filter((c) => c.stage_id === s.id);
    const col = h('section', { class: 'column', 'data-stage': s.id },
      h('header', { class: 'column-head' }, h('h2', {}, s.name), h('span', { class: 'count' }, list.length)),
      h('div', { class: 'column-body' },
        list.map((c) => cardEl(d, c, board, stages, idx)),
        list.length ? null : h('p', { class: 'drop-hint' }, 'Hierher ziehen'),
      ),
      idx === 0 ? h('button', { class: 'add-card', type: 'button', onclick: () => addToBoardDialog(d, board, stages[0]) }, icon('plus', 16), 'Kontakt hinzufügen') : null,
    );
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const card = cards.find((c) => c.id === e.dataTransfer.getData('text/card'));
      if (card) await moveCard(card, s, board, stages);
    });
    return col;
  };

  return h('div', { class: 'page wide' },
    h('header', { class: 'page-head' },
      h('div', {}, h('p', { class: 'eyebrow' }, h('a', { href: '#/boards' }, 'Boards')), h('h1', {}, board.name), board.goal ? h('p', { class: 'muted' }, board.goal) : null),
      h('div', { class: 'head-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => stagesDialog(board, stages, cards) }, 'Spalten'),
        h('button', { class: 'btn', type: 'button', onclick: () => boardDialog(board) }, icon('edit', 16), 'Board'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => addToBoardDialog(d, board, stages[0]) }, icon('plus'), 'Kontakt'),
      ),
    ),
    stages.length ? h('div', { class: 'kanban' }, stages.map(column)) : h('p', { class: 'empty' }, 'Dieses Board hat noch keine Spalten.'),
  );
}

function cardEl(d, c, board, stages, idx) {
  const contact = d.C[c.contact_id];
  const dl = dueLabel(c.due_date);
  const days = daysSince(c.stage_entered_at);
  const next = stages[idx + 1];
  const el = h('article', { class: 'card', draggable: 'true' },
    h('a', { class: 'card-link', href: '#/contact/' + contact.id },
      h('div', { class: 'card-name' }, fullName(contact)),
      companyName(d, contact) ? h('div', { class: 'card-company' }, companyName(d, contact)) : null,
      c.next_step ? h('div', { class: 'card-next' }, c.next_step) : null,
    ),
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

async function moveCard(card, stage, board, stages) {
  if (card.stage_id === stage.id) return;
  const from = stages.find((s) => s.id === card.stage_id);
  await db.update('cards', card.id, { stage_id: stage.id, stage_entered_at: new Date().toISOString(), position: Date.now() });
  await db.insert('events', { contact_id: card.contact_id, board_id: board.id, kind: 'stage', body: `${board.name}: ${from?.name || '–'} → ${stage.name}` });
  refresh();
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
  const onBoard = new Set(d.cards.filter((c) => c.board_id === board.id).map((c) => c.contact_id));
  const q = h('input', { type: 'search', placeholder: 'Name, Firma oder E-Mail suchen …' });
  const results = h('div', { class: 'pick-list' });
  let dlg;
  const add = async (contactId) => {
    await db.insert('cards', { board_id: board.id, stage_id: stage.id, contact_id: contactId, position: Date.now(), stage_entered_at: new Date().toISOString() });
    await db.insert('events', { contact_id: contactId, board_id: board.id, kind: 'stage', body: `${board.name}: aufgenommen in „${stage.name}“` });
    dlg.close();
    refresh();
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const matches = d.contacts
      .filter((c) => !onBoard.has(c.id))
      .filter((c) => !term || [fullName(c), c.email, companyName(d, c)].join(' ').toLowerCase().includes(term))
      .slice(0, 30);
    results.replaceChildren(
      ...matches.map((c) => h('button', { class: 'pick', type: 'button', onclick: () => add(c.id) },
        h('span', {}, fullName(c)), h('span', { class: 'muted' }, companyName(d, c)))),
      matches.length ? '' : h('p', { class: 'empty' }, 'Kein passender Kontakt.'),
    );
  };
  q.addEventListener('input', draw);
  draw();
  const body = h('div', { class: 'form' },
    q, results,
    h('button', {
      class: 'btn wide', type: 'button',
      onclick: () => { dlg.close(); contactDialog(d, null, async (c) => add(c.id).catch((e) => toast(e.message, 'error'))); },
    }, icon('plus', 16), 'Neuen Kontakt anlegen'),
  );
  dlg = modal('Kontakt zu „' + board.name + '“ hinzufügen', body, []);
}

// ---------- Kontakte ----------

async function viewContacts() {
  const d = await loadAll();
  const contacts = [...d.contacts].sort((a, b) => fullName(a).localeCompare(fullName(b), 'de'));
  const q = h('input', { type: 'search', class: 'search', placeholder: 'Suchen …', 'aria-label': 'Kontakte suchen' });
  const rows = contacts.map((c) => {
    const boards = d.cards.filter((x) => x.contact_id === c.id).map((x) => d.B[x.board_id]?.name).filter(Boolean);
    const row = h('a', { class: 'contact-row', href: '#/contact/' + c.id },
      h('span', { class: 'cr-name' }, fullName(c), c.job_title ? h('span', { class: 'muted small' }, ' · ' + c.job_title) : null),
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

function contactDialog(d, contact, onSaved) {
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
  const company = h('input', { value: d.F[contact?.company_id]?.name || '', list: 'company-list', placeholder: 'Firma oder Kanzlei' });
  const website = h('input', { type: 'url', value: d.F[contact?.company_id]?.website || '', placeholder: 'https://…' });
  const notes = h('textarea', { rows: 3, value: v('notes') });
  const body = h('div', { class: 'form grid2' },
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
      info('Firma', company?.name), info('Position', c.job_title), info('Ort', c.city || company?.city),
      info('E-Mail', c.email, c.email ? 'mailto:' + c.email : null), info('Telefon', c.phone, c.phone ? 'tel:' + c.phone.replace(/\s/g, '') : null),
      info('LinkedIn', safeUrl(c.linkedin_url) ? 'Profil öffnen' : null, safeUrl(c.linkedin_url)),
      info('Website', safeUrl(company?.website) ? company.website.replace(/^https?:\/\//, '') : null, safeUrl(company?.website)),
    ),
    c.notes ? h('p', { class: 'notes' }, c.notes) : null,
  );

  const boardsPanel = h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Boards'),
    memberships.map((m) => membershipEl(d, m)),
    addMembershipEl(d, c, memberships),
  );

  const tabs = [
    ['timeline', 'Verlauf', events.length, () => timelineEl(c, events)],
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
      h('div', {},
        h('p', { class: 'eyebrow' }, h('a', { href: '#/contacts' }, 'Kontakte')),
        h('h1', {}, fullName(c)),
        h('p', { class: 'muted' }, [c.job_title, company?.name].filter(Boolean).join(' · ')),
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
          if (!(await confirmDialog('Vom Board entfernen?', `Der Kontakt wird von „${board.name}“ entfernt. Verlauf und Daten bleiben.`, 'Entfernen'))) return;
          await db.remove('cards', m.id);
          await db.insert('events', { contact_id: m.contact_id, board_id: null, kind: 'stage', body: `Von „${board.name}“ entfernt` });
          refresh();
        },
      }, icon('trash', 16)),
    ),
    stageSel,
    h('div', { class: 'mem-fields' }, next, due),
    h('p', { class: 'muted small' }, 'Seit ' + daysSince(m.stage_entered_at) + ' Tagen in dieser Spalte'),
  );
}

function addMembershipEl(d, c, memberships) {
  const free = d.boards.filter((b) => !memberships.some((m) => m.board_id === b.id));
  if (!free.length) return null;
  const sel = h('select', { 'aria-label': 'Board wählen' }, h('option', { value: '' }, 'Zu Board hinzufügen …'), free.map((b) => h('option', { value: b.id }, b.name)));
  sel.addEventListener('change', async () => {
    const board = d.B[sel.value];
    const first = d.stages.find((s) => s.board_id === board?.id);
    if (!board || !first) return;
    await db.insert('cards', { board_id: board.id, stage_id: first.id, contact_id: c.id, position: Date.now(), stage_entered_at: new Date().toISOString() });
    await db.insert('events', { contact_id: c.id, board_id: board.id, kind: 'stage', body: `${board.name}: aufgenommen in „${first.name}“` });
    refresh();
  });
  return h('div', { class: 'add-mem' }, sel);
}

function timelineEl(c, events) {
  const kind = h('select', { 'aria-label': 'Art' }, ['note', 'call', 'email', 'meeting', 'touchpoint'].map((k) => h('option', { value: k }, EVENT_KINDS[k])));
  const text = h('textarea', { rows: 3, placeholder: 'Was ist passiert?' });
  const form = h('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return;
      await db.insert('events', { contact_id: c.id, kind: kind.value, body: text.value.trim() });
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
      h('p', { class: 'muted' }, 'Lass Claude im Web recherchieren. Du bestimmst, was du wissen willst.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => researchDialog(d, c) }, icon('spark', 16), 'Recherche starten'),
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
  modal('Recherche zu ' + fullName(c), h('div', { class: 'form' },
    h('p', { class: 'muted small' }, 'Gesucht wird mit: ' + [fullName(c), c.job_title, company?.name, company?.website, c.city || company?.city].filter(Boolean).join(' · ')),
    boxes.map((b) => b.el),
    field('Was willst du sonst noch wissen?', custom),
  ), [{
    label: 'Recherche starten', primary: true,
    onClick: async () => {
      const topics = boxes.filter((b) => b.cb.checked).map((b) => b.cb.value);
      if (!topics.length && !custom.value.trim()) { toast('Bitte mindestens ein Thema wählen.', 'error'); return false; }
      const r = await db.insert('research', { contact_id: c.id, questions: { topics, custom: custom.value.trim() || null }, status: 'running' });
      await db.insert('events', { contact_id: c.id, kind: 'research', body: 'Recherche gestartet' });
      contactTab = 'research';
      refresh();
      toast('Recherche läuft, das dauert etwa eine Minute.');
      db.invoke('research', { research_id: r.id })
        .catch(async (e) => {
          await db.update('research', r.id, { status: 'error', error: e.message }).catch(() => {});
          toast('Recherche fehlgeschlagen: ' + e.message, 'error');
        })
        .finally(() => { if (location.hash === '#/contact/' + c.id) refresh(); });
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

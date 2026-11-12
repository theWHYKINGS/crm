// Datenzugriff: gleiche Schnittstelle für Supabase (echt) und Demo (localStorage).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const mode = SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'demo';
export const TEMPLATES = [
  {
    name: 'Steuerberater-Training',
    goal: 'Steuerberater-Kanzleien für das Training gewinnen',
    stages: ['Erstkontakt', 'Info-Material gesendet', 'Gespräch geführt', 'Angebot', 'Training gebucht'],
  },
  {
    name: 'Sparring-Neumandanten',
    goal: 'Neue Mandanten fürs Sparring über Leadership-Briefe',
    stages: ['Leadership-Brief 1', 'Leadership-Brief 2', 'Leadership-Brief 3', 'Kennenlernen', 'Mandat'],
  },
];

export const db = mode === 'supabase' ? await makeSupabase() : await makeLocal();

async function makeSupabase() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const chk = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  const PAGE = 1000;
  return {
    async list(table, opt = {}) {
      const out = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from(table).select('*');
        for (const [k, v] of Object.entries(opt.eq || {})) q = q.eq(k, v);
        if (opt.order) q = q.order(opt.order[0], { ascending: opt.order[1] !== false });
        q = q.order('id');
        if (opt.limit) return chk(await q.limit(opt.limit));
        const rows = chk(await q.range(from, from + PAGE - 1));
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    async get(table, id) {
      return chk(await sb.from(table).select('*').eq('id', id).maybeSingle());
    },
    async insert(table, row) {
      const rows = chk(await sb.from(table).insert(row).select());
      return Array.isArray(row) ? rows : rows[0];
    },
    async update(table, id, patch) {
      return chk(await sb.from(table).update(patch).eq('id', id).select().single());
    },
    async remove(table, id) {
      chk(await sb.from(table).delete().eq('id', id));
    },
    async user() {
      const { data } = await sb.auth.getSession();
      return data.session?.user || null;
    },
    async signIn(email, password) {
      chk(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async invoke(fn, body) {
      const { data, error } = await sb.functions.invoke(fn, { body });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      return data;
    },
  };
}

async function makeLocal() {
  const KEY = 'why-crm-demo-v1';
  const CASCADE = {
    boards: [['stages', 'board_id'], ['cards', 'board_id']],
    stages: [['cards', 'stage_id']],
    contacts: [['cards', 'contact_id'], ['events', 'contact_id'], ['transcripts', 'contact_id'], ['research', 'contact_id']],
  };
  const DEFAULTS = {
    cards: () => ({ stage_entered_at: new Date().toISOString(), position: Date.now() }),
    research: () => ({ status: 'running', sources: [], questions: {} }),
  };
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { data = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  const T = (t) => (data[t] ||= []);
  const stamp = (t, r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[t]?.() || {}), ...r });
  const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const api = {
    async list(table, opt = {}) {
      let rows = T(table).filter((r) => Object.entries(opt.eq || {}).every(([k, v]) => r[k] === v));
      if (opt.order) {
        const [col, asc] = opt.order;
        rows = [...rows].sort((a, b) => cmp(a[col], b[col]) * (asc === false ? -1 : 1));
      }
      if (opt.limit) rows = rows.slice(0, opt.limit);
      return clone(rows);
    },
    async get(table, id) {
      const r = T(table).find((x) => x.id === id);
      return r ? clone(r) : null;
    },
    async insert(table, row) {
      const rows = (Array.isArray(row) ? row : [row]).map((r) => stamp(table, r));
      if (table === 'cards') {
        for (const r of rows) {
          if (T('cards').some((c) => c.board_id === r.board_id && c.contact_id === r.contact_id)) {
            throw new Error('Kontakt ist bereits auf diesem Board.');
          }
        }
      }
      T(table).push(...rows);
      save();
      return clone(Array.isArray(row) ? rows : rows[0]);
    },
    async update(table, id, patch) {
      const r = T(table).find((x) => x.id === id);
      if (!r) throw new Error('Nicht gefunden');
      Object.assign(r, patch);
      save();
      return clone(r);
    },
    async remove(table, id) {
      for (const [child, fk] of CASCADE[table] || []) {
        for (const c of T(child).filter((x) => x[fk] === id)) await api.remove(child, c.id);
      }
      data[table] = T(table).filter((x) => x.id !== id);
      save();
    },
    async user() { return { email: 'demo' }; },
    async signIn() {},
    async signOut() {},
    async invoke(fn, body) {
      if (fn !== 'research') throw new Error('Unbekannte Funktion');
      await new Promise((r) => setTimeout(r, 1200));
      const res = await api.update('research', body.research_id, {
        status: 'done',
        result:
          '## Demo-Ergebnis\n\nIm Demo-Modus wird keine echte Recherche ausgeführt. Sobald Supabase und der Claude-API-Schlüssel verbunden sind, steht hier ein Dossier mit Quellen.\n\n- **Unternehmen:** Größe, Standorte, Schwerpunkte\n- **Person:** Rolle und Werdegang\n- **Aufhänger:** Ansatzpunkte für die Ansprache',
        sources: [{ title: 'Beispielquelle', url: 'https://example.com' }],
      });
      return res;
    },
  };

  if (!data.seeded) {
    await seed(api);
    data.seeded = true;
    save();
  }
  return api;
}

async function seed(api) {
  const day = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const ago = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const [kb, sl, nl] = await api.insert('companies', [
    { name: 'Kanzlei Berger & Partner', website: 'https://example.com', city: 'München', industry: 'Steuerberatung' },
    { name: 'Steuerbüro Lindner', city: 'Augsburg', industry: 'Steuerberatung' },
    { name: 'Nordlicht Software GmbH', city: 'Hamburg', industry: 'Software' },
  ]);
  const [c1, c2, c3, c4] = await api.insert('contacts', [
    { first_name: 'Julia', last_name: 'Berger', job_title: 'Partnerin', company_id: kb.id, email: 'julia@example.com' },
    { first_name: 'Markus', last_name: 'Lindner', job_title: 'Inhaber', company_id: sl.id },
    { first_name: 'Sophie', last_name: 'Albrecht', job_title: 'Geschäftsführerin', company_id: nl.id },
    { first_name: 'Tobias', last_name: 'Hein', job_title: 'Steuerberater', company_id: kb.id },
  ]);
  for (const [tpl, cards] of [
    [TEMPLATES[0], [[c1, 0, day(0), 'Unterlagen zum Training schicken', 3], [c2, 1, day(-2), 'Nachfassen per Telefon', 9], [c4, 0, null, null, 20]]],
    [TEMPLATES[1], [[c3, 1, day(3), 'Brief 2 schreiben: Thema Entscheidungen', 5]]],
  ]) {
    const board = await api.insert('boards', { name: tpl.name, goal: tpl.goal, position: Date.now() });
    const stages = await api.insert('stages', tpl.stages.map((name, i) => ({ board_id: board.id, name, position: i })));
    for (const [contact, si, due, next, daysIn] of cards) {
      await api.insert('cards', {
        board_id: board.id, stage_id: stages[si].id, contact_id: contact.id,
        due_date: due, next_step: next, stage_entered_at: ago(daysIn),
      });
    }
  }
  await api.insert('events', { contact_id: c1.id, kind: 'call', body: 'Kurzes Telefonat: Interesse am Steuerberater-Training für ihr Team (8 Personen).' });
}

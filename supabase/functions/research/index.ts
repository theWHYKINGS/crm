// Supabase Edge Function "research"
// Nimmt { research_id } entgegen, antwortet sofort und recherchiert im Hintergrund mit der
// Claude-API (Websuche). Das Ergebnis wird in die Tabelle "research" geschrieben; die App
// fragt den Status ab. Benötigtes Secret: ANTHROPIC_API_KEY (Optional: RESEARCH_MODEL).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TOPICS: Record<string, string> = {
  company: 'Unternehmen / Kanzlei: Größe (Mitarbeitende), Standorte, Schwerpunkte und Leistungen, Gründung, Inhaber- bzw. Gesellschafterstruktur',
  person: 'Person: aktuelle Rolle, Werdegang, Ausbildung und Qualifikationen, öffentliches Profil (z. B. LinkedIn, Xing, Verbandsseiten)',
  news: 'Aktuelles: News, Pressemitteilungen, Veröffentlichungen, Vorträge und Auszeichnungen der letzten 12 Monate',
  leadership: 'Führung & Team: Wachstum, offene Stellen, Nachfolgethemen, Fachkräftemangel, Kultur- und Führungsthemen',
  hooks: 'Aufhänger für die Ansprache: 3 bis 5 konkrete, belegbare Anknüpfungspunkte für ein persönliches Anschreiben',
};

const SYSTEM = `Du recherchierst für einen Leadership-Coach und Trainer im DACH-Raum, der Kontakte vor einer persönlichen Ansprache besser verstehen möchte.
Regeln:
- Nutze die Websuche gezielt, aber sparsam. Bevorzuge die Website der Firma, Impressum, Verbandsseiten, Presse und seriöse Medien.
- Nenne nur Fakten, die durch eine Quelle belegt sind. Unsicheres oder Widersprüchliches kennzeichnest du ausdrücklich. Wenn du zur Person nichts Sicheres findest, schreibst du das offen; rate nie und verwechsle keine Namensvetter.
- Schreibe auf Deutsch in Markdown: pro gewünschtem Thema ein Abschnitt mit "## Überschrift", darunter kurze Stichpunkte. Keine Einleitung, kein Fazit.
- Am Ende ein Abschnitt "## Offene Fragen" mit dem, was sich nicht klären ließ.`;

async function callClaude(apiKey: string, model: string, messages: unknown[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      messages,
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 6,
        user_location: { type: 'approximate', country: 'DE', timezone: 'Europe/Berlin' },
      }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `Claude-API Fehler ${res.status}`);
  return body;
}

async function run(sb: ReturnType<typeof createClient>, r: Record<string, any>) {
  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ist in Supabase nicht hinterlegt.');
    const model = Deno.env.get('RESEARCH_MODEL') || 'claude-sonnet-5-5';

    const { data: c } = await sb.from('contacts').select('*').eq('id', r.contact_id).single();
    const { data: co } = c?.company_id
      ? await sb.from('companies').select('*').eq('id', c.company_id).single()
      : { data: null };
    const { data: ts } = await sb.from('transcripts').select('title,content,occurred_at').eq('contact_id', r.contact_id)
      .order('created_at', { ascending: false }).limit(2);

    const topics: string[] = r.questions?.topics ?? [];
    const lines = [
      `Name: ${[c?.first_name, c?.last_name].filter(Boolean).join(' ') || '–'}`,
      c?.job_title && `Position: ${c.job_title}`,
      co?.name && `Firma: ${co.name}`,
      (co?.website || co?.domain) && `Website: ${co.website || co.domain}`,
      (c?.city || co?.city) && `Ort: ${c?.city || co?.city}`,
      c?.email && `E-Mail-Domain: ${String(c.email).split('@')[1] ?? ''}`,
      c?.linkedin_url && `LinkedIn: ${c.linkedin_url}`,
    ].filter(Boolean).join('\n');

    let task = `Recherchiere zu dieser Person:\n${lines}\n\nGewünschte Themen:\n`;
    task += topics.length ? topics.map((k) => `- ${TOPICS[k] ?? k}`).join('\n') : '- (keine festen Themen, nur die eigene Frage unten)';
    if (r.questions?.custom) task += `\n\nZusätzliche Frage: ${r.questions.custom}`;
    if (ts?.length) {
      task += '\n\nBekannter Kontext aus bisherigen Gesprächen (nur zur Orientierung, nicht wiederholen):\n';
      task += ts.map((t) => `[${t.title ?? 'Transkript'}] ${String(t.content).slice(0, 3000)}`).join('\n---\n');
    }

    const messages: unknown[] = [{ role: 'user', content: task }];
    let body = await callClaude(apiKey, model, messages);
    for (let i = 0; i < 3 && body.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: body.content });
      body = await callClaude(apiKey, model, messages);
    }

    const text = (body.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const seen = new Map<string, string>();
    for (const b of body.content as any[]) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const x of b.content) if (x.url) seen.set(x.url, x.title || x.url);
      }
      if (b.type === 'text') for (const cit of b.citations ?? []) if (cit.url) seen.set(cit.url, cit.title || cit.url);
    }
    const sources = [...seen].map(([url, title]) => ({ url, title }));

    await sb.from('research').update({ status: 'done', result: text || 'Kein Ergebnis.', sources, error: null }).eq('id', r.id);
    await sb.from('events').insert({ contact_id: r.contact_id, kind: 'research', body: 'Recherche abgeschlossen' });
  } catch (e) {
    await sb.from('research').update({ status: 'error', error: String((e as Error).message || e).slice(0, 500) }).eq('id', r.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: 'Nicht angemeldet' }, 401);

    const { research_id } = await req.json();
    const { data: r } = await sb.from('research').select('*').eq('id', research_id).maybeSingle();
    if (!r) return json({ error: 'Recherche nicht gefunden' }, 404);

    // @ts-ignore: EdgeRuntime ist in Supabase Edge Functions global verfügbar
    EdgeRuntime.waitUntil(run(sb, r));
    return json({ status: 'running' }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

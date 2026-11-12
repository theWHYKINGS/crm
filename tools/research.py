#!/usr/bin/env python3
"""Brücke zwischen CRM (Supabase) und Claude Code: offene Recherchen holen, Ergebnisse zurückschreiben.

  python3 tools/research.py pending              offene Recherchen als JSON (inkl. Kontakt-, Firmen- und Transkriptdaten)
  python3 tools/research.py done ID ERGEBNIS.md [QUELLEN.json]
  python3 tools/research.py fail ID "Grund"

Zugang: Datei .env mit SUPABASE_URL und SUPABASE_SERVICE_KEY (Service-Role-Key, bleibt lokal, nie ins Repo).
Gesucht wird in: <Repo>/.env, <Haupt-Checkout>/.env, ~/.config/why-crm.env
"""
import json, os, subprocess, sys, urllib.parse, urllib.request, urllib.error

TOPICS = {
    'company': 'Unternehmen / Kanzlei: Größe (Mitarbeitende), Standorte, Schwerpunkte und Leistungen, Gründung, Inhaber- bzw. Gesellschafterstruktur',
    'person': 'Person: aktuelle Rolle, Werdegang, Ausbildung und Qualifikationen, öffentliches Profil (z. B. LinkedIn, Xing, Verbandsseiten)',
    'news': 'Aktuelles: News, Pressemitteilungen, Veröffentlichungen, Vorträge und Auszeichnungen der letzten 12 Monate',
    'leadership': 'Führung & Team: Wachstum, offene Stellen, Nachfolgethemen, Fachkräftemangel, Kultur- und Führungsthemen',
    'hooks': 'Aufhänger für die Ansprache: 3 bis 5 konkrete, belegbare Anknüpfungspunkte für ein persönliches Anschreiben',
}


def sh(*a):
    try:
        return subprocess.run(a, capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ''


def load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    root = sh('git', '-C', here, 'rev-parse', '--show-toplevel')
    common = sh('git', '-C', here, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    cands = [os.path.join(root, '.env') if root else '', os.path.join(os.path.dirname(common), '.env') if common else '',
             os.path.expanduser('~/.config/why-crm.env')]
    for p in cands:
        if p and os.path.isfile(p):
            env = {}
            for line in open(p, encoding='utf-8'):
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"\'')
            if env.get('SUPABASE_URL') and env.get('SUPABASE_SERVICE_KEY'):
                return env
    sys.exit('Zugang fehlt: .env mit SUPABASE_URL und SUPABASE_SERVICE_KEY anlegen (siehe README, Abschnitt Recherche).')


ENV = None


def api(method, table, query='', body=None):
    global ENV
    ENV = ENV or load_env()
    url = ENV['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + table + (('?' + query) if query else '')
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={
        'apikey': ENV['SUPABASE_SERVICE_KEY'], 'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_KEY'],
        'Content-Type': 'application/json', 'Prefer': 'return=representation'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f'Supabase-Fehler {e.code}: {e.read().decode()[:400]}')


def q(**kw):
    return urllib.parse.urlencode(kw)


def pending():
    out = []
    for r in api('GET', 'research', q(select='*', status='in.(queued,running)', order='created_at.asc')):
        c = (api('GET', 'contacts', q(select='*', id='eq.' + r['contact_id'])) or [None])[0]
        co = (api('GET', 'companies', q(select='*', id='eq.' + c['company_id'])) or [None])[0] if c and c.get('company_id') else None
        ts = api('GET', 'transcripts', q(select='title,content,occurred_at', contact_id='eq.' + r['contact_id'], order='created_at.desc', limit='2'))
        for t in ts:
            t['content'] = (t.get('content') or '')[:3000]
        if c:
            c.pop('photo', None)
        if co:
            co.pop('logo', None)
        topics = (r.get('questions') or {}).get('topics') or []
        out.append({
            'research_id': r['id'], 'status': r['status'], 'created_at': r['created_at'],
            'topics': [{'key': k, 'beschreibung': TOPICS.get(k, k)} for k in topics],
            'eigene_frage': (r.get('questions') or {}).get('custom'),
            'kontakt': c, 'unternehmen': co, 'transkripte': ts,
        })
    print(json.dumps(out, ensure_ascii=False, indent=2))


def done(rid, md_path, src_path=None):
    r = (api('GET', 'research', q(select='*', id='eq.' + rid)) or [None])[0]
    if not r:
        sys.exit('Recherche nicht gefunden: ' + rid)
    result = open(md_path, encoding='utf-8').read().strip() or 'Kein Ergebnis.'
    sources = json.load(open(src_path, encoding='utf-8')) if src_path else []
    sources = [{'url': s['url'], 'title': s.get('title') or s['url']} for s in sources if str(s.get('url', '')).startswith('http')]
    api('PATCH', 'research', q(id='eq.' + rid), {'status': 'done', 'result': result, 'sources': sources, 'error': None})
    api('POST', 'events', body={'owner': r['owner'], 'contact_id': r['contact_id'], 'kind': 'research', 'body': 'Recherche abgeschlossen'})
    print('ok: ' + rid)


def fail(rid, msg):
    api('PATCH', 'research', q(id='eq.' + rid), {'status': 'error', 'error': msg[:500]})
    print('als Fehler markiert: ' + rid)


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['pending']:
        pending()
    elif a[:1] == ['done'] and len(a) in (3, 4):
        done(*a[1:])
    elif a[:1] == ['fail'] and len(a) == 3:
        fail(a[1], a[2])
    else:
        sys.exit(__doc__)

# theWHYKINGS CRM

Leichtgewichtiges, persönliches CRM: Boards mit eigenen Spalten (Touchpoints/Status),
Kontaktseite mit Verlauf, Transkripten (Wispr Flow) und Recherche per Knopfdruck,
„Heute“-Ansicht für unterwegs.

## Aufbau

- Statische Web-App ohne Build-Schritt: `index.html`, `css/app.css`, `js/*.js`
- Daten: Supabase (Postgres + Login), Region Frankfurt. Schema: `supabase/schema.sql`
- Ohne Supabase-Zugangsdaten in `js/config.js` läuft die App im **Demo-Modus**
  (Beispieldaten nur im Browser, `localStorage`)
- Recherche: Die App merkt Recherchen vor, Claude Code arbeitet sie über das Abo ab (Skill `/recherche`, Skript `tools/research.py`), ohne API-Kosten. Die Edge Function `research` (Claude-API) bleibt als ungenutzte Alternative im Repo

## Lokal ansehen

```bash
cd ~/Desktop/crm-dev && python3 -m http.server 8765
```

Dann http://127.0.0.1:8765 öffnen.

## Einrichtung Supabase (einmalig)

1. Projekt anlegen, Region **Central EU (Frankfurt)**
2. SQL Editor → Inhalt von `supabase/schema.sql` ausführen
3. Authentication → Users → eigenen Nutzer anlegen; unter Sign In / Providers
   „Allow new users to sign up“ ausschalten
4. Project Settings → API: Project URL + anon key in `js/config.js` eintragen

## Datenbank-Änderungen

Später hinzugekommene Änderungen liegen in `supabase/migrations/`. Jede Datei einmal im SQL-Editor ausführen:

- `002_company_boards.sql`: Unternehmens-Boards (Karten können Unternehmen statt Kontakte sein)
- `003_contact_photo.sql`: Kontaktfoto (`contacts.photo`)
- `004_company_logo.sql`: Firmenlogo (`companies.logo`)

## Recherche über Claude Code (ohne API-Kosten)

1. In der App: Kontakt → Reiter Recherche → „Recherche vormerken" (Status `queued`).
2. In Claude Code in diesem Projekt `/recherche` ausführen. Claude holt alle vorgemerkten Recherchen, sucht im Web und schreibt die Dossiers zurück. Sie erscheinen danach im Reiter Recherche.

Einmalige Einrichtung des Zugangs (die Datei bleibt lokal, `.env` ist in `.gitignore`):

1. Supabase → Project Settings → API Keys → den **service_role**-Key (geheim) kopieren.
2. Datei `.env` im Projektordner anlegen (alternativ `~/.config/why-crm.env`):

```
SUPABASE_URL=https://DEINE-PROJEKT-ID.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

Der Service-Key umgeht den Zeilenschutz der Datenbank. Nie in den Chat einfügen, nie committen, nie in die App (`js/`) schreiben.


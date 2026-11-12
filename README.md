# theWHYKINGS CRM

Leichtgewichtiges, persönliches CRM: Boards mit eigenen Spalten (Touchpoints/Status),
Kontaktseite mit Verlauf, Transkripten (Wispr Flow) und Recherche per Knopfdruck,
„Heute“-Ansicht für unterwegs.

## Aufbau

- Statische Web-App ohne Build-Schritt: `index.html`, `css/app.css`, `js/*.js`
- Daten: Supabase (Postgres + Login), Region Frankfurt. Schema: `supabase/schema.sql`
- Ohne Supabase-Zugangsdaten in `js/config.js` läuft die App im **Demo-Modus**
  (Beispieldaten nur im Browser, `localStorage`)
- Recherche: Supabase Edge Function `research` (folgt), ruft die Claude-API mit Websuche auf

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

-- Firmenlogo: kleines Bild (max. 128 px, PNG) als Data-URL direkt am Unternehmen.
-- Einmal im Supabase SQL-Editor ausführen. Bestehende Daten bleiben unverändert.

alter table companies add column if not exists logo text;

notify pgrst, 'reload schema';

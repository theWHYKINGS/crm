-- Kontaktfoto: kleines (ca. 192 px, JPEG) Bild als Data-URL direkt am Kontakt.
-- Einmal im Supabase SQL-Editor ausführen. Bestehende Daten bleiben unverändert.

alter table contacts add column if not exists photo text;

notify pgrst, 'reload schema';

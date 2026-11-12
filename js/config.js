// Supabase-Zugang. Solange beide Werte leer sind, läuft die App im Demo-Modus
// (Daten nur lokal im Browser). Werte stehen im Supabase-Dashboard unter
// Project Settings → API: "Project URL" und "anon public" Key.
// Der anon-Key darf öffentlich sein: die Daten schützt die Row Level Security.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

// Ab wie vielen Tagen in derselben Spalte ein Kontakt als "hängt fest" gilt
export const STUCK_DAYS = 14;

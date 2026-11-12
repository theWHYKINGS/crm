-- theWHYKINGS CRM — Datenbank-Schema für Supabase
-- Einmal komplett im Supabase SQL-Editor ausführen (Dashboard → SQL Editor → New query → Run).
-- Jede Zeile gehört genau einem Nutzer (owner). Row Level Security sorgt dafür,
-- dass ausschließlich der eingeloggte Besitzer seine Daten lesen und ändern kann.

create extension if not exists pgcrypto;

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  domain      text,
  website     text,
  city        text,
  industry    text,
  notes       text,
  hubspot_id  text unique,
  created_at  timestamptz not null default now()
);

create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null default auth.uid() references auth.users on delete cascade,
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  job_title     text,
  company_id    uuid references companies on delete set null,
  linkedin_url  text,
  city          text,
  notes         text,
  photo         text,
  hubspot_id    text unique,
  created_at    timestamptz not null default now()
);

create table if not exists boards (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  goal        text,
  position    bigint not null default 0,
  created_at  timestamptz not null default now()
);

-- Spalten eines Boards = Touchpoints / Status
create table if not exists stages (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  board_id    uuid not null references boards on delete cascade,
  name        text not null,
  position    bigint not null default 0,
  created_at  timestamptz not null default now()
);

-- Ein Kontakt auf einem Board (ein Kontakt kann auf mehreren Boards sein)
create table if not exists cards (
  id                uuid primary key default gen_random_uuid(),
  owner             uuid not null default auth.uid() references auth.users on delete cascade,
  board_id          uuid not null references boards on delete cascade,
  stage_id          uuid not null references stages on delete cascade,
  contact_id        uuid not null references contacts on delete cascade,
  next_step         text,
  due_date          date,
  stage_entered_at  timestamptz not null default now(),
  position          bigint not null default 0,
  created_at        timestamptz not null default now(),
  unique (board_id, contact_id)
);

-- Verlauf: Spaltenwechsel, Notizen, Touchpoints, Transkripte, Recherchen
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  contact_id  uuid not null references contacts on delete cascade,
  board_id    uuid references boards on delete set null,
  kind        text not null default 'note',
  body        text,
  created_at  timestamptz not null default now()
);

create table if not exists transcripts (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users on delete cascade,
  contact_id   uuid not null references contacts on delete cascade,
  title        text,
  content      text not null,
  source       text,
  occurred_at  date,
  created_at   timestamptz not null default now()
);

create table if not exists research (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users on delete cascade,
  contact_id  uuid not null references contacts on delete cascade,
  questions   jsonb not null default '{}'::jsonb,
  status      text not null default 'running',   -- running | done | error
  result      text,
  sources     jsonb not null default '[]'::jsonb,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists contacts_company_idx   on contacts (company_id);
create index if not exists stages_board_idx       on stages (board_id);
create index if not exists cards_board_idx        on cards (board_id);
create index if not exists cards_contact_idx      on cards (contact_id);
create index if not exists events_contact_idx     on events (contact_id, created_at desc);
create index if not exists transcripts_contact_idx on transcripts (contact_id);
create index if not exists research_contact_idx   on research (contact_id);

-- Zugriffsschutz: nur der Besitzer
do $$
declare t text;
begin
  foreach t in array array['companies','contacts','boards','stages','cards','events','transcripts','research'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_all on %I', t);
    execute format('create policy owner_all on %I for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid())', t);
  end loop;
end $$;

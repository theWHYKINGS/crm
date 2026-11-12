-- Unternehmens-Boards: Karten können jetzt ein Unternehmen statt eines Kontakts sein.
-- Einmal im Supabase SQL-Editor ausführen. Bestehende Daten bleiben unverändert.

alter table boards add column if not exists kind text not null default 'contact';
alter table boards drop constraint if exists boards_kind_check;
alter table boards add constraint boards_kind_check check (kind in ('contact', 'company'));

alter table cards alter column contact_id drop not null;
alter table cards add column if not exists company_id uuid references companies on delete cascade;
alter table cards drop constraint if exists cards_one_target;
alter table cards add constraint cards_one_target check ((contact_id is null) <> (company_id is null));
create unique index if not exists cards_board_company_uniq on cards (board_id, company_id);
create index if not exists cards_company_idx on cards (company_id);

alter table events alter column contact_id drop not null;
alter table events add column if not exists company_id uuid references companies on delete cascade;
alter table events drop constraint if exists events_has_target;
alter table events add constraint events_has_target check (contact_id is not null or company_id is not null);
create index if not exists events_company_idx on events (company_id, created_at desc);

notify pgrst, 'reload schema';

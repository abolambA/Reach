-- ============================================================
-- 002_remove_auth.sql
-- Disables authentication entirely. Anyone visiting the app
-- becomes the same "default" user. URL obscurity is the only
-- access control after this runs.
-- ============================================================

-- Drop the RLS policies created in 001
drop policy if exists "Users can read their own profile" on profiles;
drop policy if exists "Users can update their own profile" on profiles;
drop policy if exists "Users see their own accounts" on linkedin_accounts;
drop policy if exists "Users see threads from their accounts" on threads;
drop policy if exists "Users see messages from their threads" on messages;
drop policy if exists "Users see decisions for their threads" on decisions;

-- Turn off row-level security so the publishable key can read/write everything
alter table profiles disable row level security;
alter table linkedin_accounts disable row level security;
alter table threads disable row level security;
alter table messages disable row level security;
alter table decisions disable row level security;

-- Tear down the auth.users → profiles trigger
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_user();

-- Drop the foreign key so profiles can exist independently of auth.users
alter table profiles drop constraint if exists profiles_id_fkey;

-- Seed the single default user that all data will belong to
insert into profiles (id, email, display_name)
values ('00000000-0000-0000-0000-000000000001', 'default@local', 'Default')
on conflict (id) do nothing;

-- Optional cleanup: if you previously imported a CSV under your own auth
-- user id, re-point it to the default user. Safe to run even if empty.
update linkedin_accounts
set owner_id = '00000000-0000-0000-0000-000000000001'
where owner_id <> '00000000-0000-0000-0000-000000000001';

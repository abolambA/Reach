-- ============================================================
-- LinkedIn Messages Concluder — initial schema
-- ============================================================

-- Profiles: extends auth.users
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can read their own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- LinkedIn accounts (a user can manage multiple LinkedIn accounts,
-- e.g., their own + their manager's)
-- ============================================================
create table if not exists linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  label text not null,             -- "My manager's account", "Mine", etc.
  source text not null check (source in ('csv', 'unipile')),
  unipile_account_id text,         -- if connected via Unipile
  csv_uploaded_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

alter table linkedin_accounts enable row level security;

create policy "Users see their own accounts"
  on linkedin_accounts for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ============================================================
-- Threads (conversations)
-- ============================================================
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  external_id text not null,        -- LinkedIn's conversation id (from CSV) or Unipile chat id
  title text,
  participants text[] default '{}',
  first_message_at timestamptz,
  last_message_at timestamptz,
  message_count integer default 0,
  preview text,
  created_at timestamptz default now(),
  unique (account_id, external_id)
);

create index if not exists idx_threads_account on threads(account_id);
create index if not exists idx_threads_last_message on threads(last_message_at desc);

alter table threads enable row level security;

create policy "Users see threads from their accounts"
  on threads for all
  using (
    account_id in (select id from linkedin_accounts where owner_id = auth.uid())
  )
  with check (
    account_id in (select id from linkedin_accounts where owner_id = auth.uid())
  );

-- ============================================================
-- Messages
-- ============================================================
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads(id) on delete cascade,
  external_id text,
  sender text,
  sender_profile_url text,
  content text,
  subject text,
  sent_at timestamptz,
  direction text check (direction in ('inbound', 'outbound')),
  created_at timestamptz default now()
);

create index if not exists idx_messages_thread on messages(thread_id, sent_at);

alter table messages enable row level security;

create policy "Users see messages from their threads"
  on messages for all
  using (
    thread_id in (
      select t.id from threads t
      join linkedin_accounts a on a.id = t.account_id
      where a.owner_id = auth.uid()
    )
  )
  with check (
    thread_id in (
      select t.id from threads t
      join linkedin_accounts a on a.id = t.account_id
      where a.owner_id = auth.uid()
    )
  );

-- ============================================================
-- Decisions (triage state per thread)
-- ============================================================
create table if not exists decisions (
  thread_id uuid primary key references threads(id) on delete cascade,
  category text,
  status text not null default 'pending' check (status in ('pending','replied','archived','followup','skipped')),
  summary text,
  suggested_reply text,
  draft_reply text,
  notes text,
  urgency text check (urgency in ('low','medium','high')),
  worth_replying boolean,
  ai_classified_at timestamptz,
  updated_at timestamptz default now()
);

create index if not exists idx_decisions_status on decisions(status);

alter table decisions enable row level security;

create policy "Users see decisions for their threads"
  on decisions for all
  using (
    thread_id in (
      select t.id from threads t
      join linkedin_accounts a on a.id = t.account_id
      where a.owner_id = auth.uid()
    )
  )
  with check (
    thread_id in (
      select t.id from threads t
      join linkedin_accounts a on a.id = t.account_id
      where a.owner_id = auth.uid()
    )
  );

-- ============================================================
-- Auto-update updated_at on decisions
-- ============================================================
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_decisions on decisions;
create trigger touch_decisions
  before update on decisions
  for each row execute function touch_updated_at();

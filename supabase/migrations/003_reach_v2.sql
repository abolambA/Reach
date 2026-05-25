-- ============================================================
-- 003_reach_v2.sql — graph, embeddings, goals, action queue
-- Run after 001_initial.sql and 002_remove_auth.sql.
-- ============================================================

-- Enable pgvector for RAG embeddings (built into Supabase).
create extension if not exists vector;

-- ============================================================
-- PEOPLE — every human node we've seen on LinkedIn
-- ============================================================
create table if not exists people (
  urn text primary key,                -- LinkedIn URN, e.g. "urn:li:fsd_profile:ACoAAB..."
  public_id text,                      -- e.g. "sarah-chen" from /in/sarah-chen
  name text,
  headline text,
  company text,
  position text,
  location text,
  profile_url text,
  profile_img text,
  industry text,
  is_self boolean default false,       -- true for the manager himself
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  raw jsonb,                           -- full DOM-extracted blob, for debugging
  -- Derived signals (computed later by workers)
  derived_categories text[] default '{}',
  is_first_degree boolean default false,
  notes text
);

create index if not exists idx_people_name on people using gin (to_tsvector('simple', coalesce(name, '')));
create index if not exists idx_people_headline on people using gin (to_tsvector('simple', coalesce(headline, '')));
create index if not exists idx_people_company on people (company);
create index if not exists idx_people_first_degree on people (is_first_degree) where is_first_degree = true;
create index if not exists idx_people_last_seen on people (last_seen_at desc);

alter table people disable row level security;

-- ============================================================
-- EDGES — directed graph of relationships
-- ============================================================
create table if not exists edges (
  src_urn text not null references people(urn) on delete cascade,
  dst_urn text not null references people(urn) on delete cascade,
  edge_type text not null check (edge_type in ('connected','follows','engages_with','messaged')),
  observed_at timestamptz default now(),
  confidence float default 1.0,        -- 1.0 = directly observed, lower = inferred
  primary key (src_urn, dst_urn, edge_type)
);

create index if not exists idx_edges_src on edges(src_urn);
create index if not exists idx_edges_dst on edges(dst_urn);
create index if not exists idx_edges_type on edges(edge_type);

alter table edges disable row level security;

-- ============================================================
-- POSTS — LinkedIn posts the extension sees (his own + others')
-- ============================================================
create table if not exists posts (
  urn text primary key,                -- post URN
  author_urn text references people(urn) on delete set null,
  content text,
  posted_at timestamptz,
  like_count integer default 0,
  comment_count integer default 0,
  repost_count integer default 0,
  is_self_authored boolean default false,
  observed_at timestamptz default now(),
  raw jsonb
);

create index if not exists idx_posts_author on posts(author_urn);
create index if not exists idx_posts_posted_at on posts(posted_at desc);
create index if not exists idx_posts_self on posts(is_self_authored) where is_self_authored = true;

alter table posts disable row level security;

-- ============================================================
-- INTERACTIONS — likes, comments, reactions (his + on him)
-- ============================================================
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  actor_urn text references people(urn) on delete cascade,
  post_urn text references posts(urn) on delete cascade,
  kind text not null check (kind in ('like','reaction','comment','repost')),
  content text,                        -- for comments
  at timestamptz default now(),
  observed_at timestamptz default now(),
  unique (actor_urn, post_urn, kind)
);

create index if not exists idx_interactions_actor on interactions(actor_urn);
create index if not exists idx_interactions_post on interactions(post_urn);

alter table interactions disable row level security;

-- ============================================================
-- STYLE CORPUS — vectorized chunks of his writing for RAG
-- ============================================================
create table if not exists style_corpus (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('sent_message','post','comment')),
  source_ref text,                     -- thread_id, post_urn, etc.
  text text not null,
  embedding vector(768),               -- Gemini text-embedding-004 dimension
  written_at timestamptz,
  created_at timestamptz default now()
);

-- HNSW index for fast cosine-similarity search across the corpus
create index if not exists idx_style_corpus_embedding on style_corpus
  using hnsw (embedding vector_cosine_ops);

alter table style_corpus disable row level security;

-- The freeform style brief the user writes manually
create table if not exists style_brief (
  id integer primary key default 1,
  content text default '',
  updated_at timestamptz default now(),
  check (id = 1)                       -- enforce single row
);
insert into style_brief (id, content) values (1, '') on conflict do nothing;

alter table style_brief disable row level security;

-- ============================================================
-- GOALS — declared objectives the platform plans around
-- ============================================================
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  kind text not null check (kind in ('followers','role_target','named_person','custom')),
  criteria jsonb default '{}',         -- e.g. {"role_keywords":["CTO"],"industry":"health"}
  target_value integer,
  current_value integer default 0,
  status text default 'active' check (status in ('active','paused','done','archived')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_goals_status on goals(status);

alter table goals disable row level security;

-- ============================================================
-- ACTIONS — the queue the manager taps through
-- ============================================================
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete set null,
  kind text not null check (kind in (
    'reply','outreach','intro_request','comment','react','follow','connect'
  )),
  target_urn text references people(urn) on delete cascade,
  target_post_urn text references posts(urn) on delete set null,
  via_urn text references people(urn) on delete set null,  -- for intro_request: the mutual
  draft text,
  rationale text,                      -- why the planner picked this
  status text not null default 'queued' check (status in (
    'queued','approved','sent','skipped','expired'
  )),
  priority integer default 50,
  created_at timestamptz default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz
);

create index if not exists idx_actions_status on actions(status, priority desc, created_at desc);
create index if not exists idx_actions_target on actions(target_urn);
create index if not exists idx_actions_goal on actions(goal_id);

alter table actions disable row level security;

-- ============================================================
-- PATH CACHE — memoized BFS results
-- ============================================================
create table if not exists path_cache (
  src_urn text not null references people(urn) on delete cascade,
  dst_urn text not null references people(urn) on delete cascade,
  path text[] not null,                -- array of urns
  length integer not null,
  computed_at timestamptz default now(),
  primary key (src_urn, dst_urn)
);

alter table path_cache disable row level security;

-- ============================================================
-- INGEST LOG — what the extension has sent us (debugging + dedupe)
-- ============================================================
create table if not exists ingest_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  url text,
  count integer,
  raw_sample jsonb,
  at timestamptz default now()
);

create index if not exists idx_ingest_log_at on ingest_log(at desc);

alter table ingest_log disable row level security;

-- ============================================================
-- RECURSIVE PATH FINDER (BFS over the edges table)
-- ============================================================
create or replace function find_path(
  start_urn text,
  end_urn text,
  max_depth integer default 4
) returns text[] language plpgsql as $$
declare
  result text[];
begin
  with recursive bfs as (
    select
      src_urn,
      dst_urn,
      array[src_urn, dst_urn] as path,
      1 as depth
    from edges
    where src_urn = start_urn and edge_type = 'connected'

    union all

    select
      e.src_urn,
      e.dst_urn,
      b.path || e.dst_urn,
      b.depth + 1
    from edges e
    join bfs b on e.src_urn = b.dst_urn
    where
      e.edge_type = 'connected'
      and b.depth < max_depth
      and not (e.dst_urn = any(b.path))      -- no cycles
  )
  select path into result
  from bfs
  where dst_urn = end_urn
  order by depth asc
  limit 1;

  return result;
end;
$$;

-- ============================================================
-- RAG MATCH RPC — cosine similarity over style_corpus
-- ============================================================
create or replace function match_style_corpus(
  query_embedding vector(768),
  match_count integer default 5
) returns table (text text, similarity float)
language sql stable as $$
  select
    sc.text,
    1 - (sc.embedding <=> query_embedding) as similarity
  from style_corpus sc
  where sc.embedding is not null
  order by sc.embedding <=> query_embedding
  limit match_count;
$$;

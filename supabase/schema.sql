-- ============================================================================
--  GIG Creative Hub — database, storage and security setup for Supabase
--
--  How to use: Supabase dashboard → SQL Editor → New query → paste this whole
--  file → Run. It is safe to run again later (e.g. after an update).
-- ============================================================================


-- ─── Team members ──────────────────────────────────────────────────────────
-- Only people whose email is in this list can open the team app.
-- Everyone else (including people with an upload link) sees nothing.
create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  created_at  timestamptz not null default now()
);

-- True when the signed-in user has a confirmed account AND is on the team list.
create or replace function public.is_team()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    join auth.users u on lower(u.email) = lower(tm.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;


-- ─── Seasons ───────────────────────────────────────────────────────────────
-- Content with no season is treated as "Evergreen" (regular, any-time content).
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  color       text not null default '#2a78d6',
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.seasons (name, color, sort_order) values
  ('New Year',              '#2a78d6', 1),
  ('Valentine''s Day',      '#e87ba4', 2),
  ('Spring',                '#1baf7a', 3),
  ('Summer',                '#eda100', 4),
  ('Back to School',        '#4a3aa7', 5),
  ('Halloween',             '#eb6834', 6),
  ('Black Friday / 11.11',  '#0b0b0b', 7),
  ('Christmas & Holidays',  '#e34948', 8)
on conflict (name) do nothing;


-- ─── Talents (influencers / creators we're tracking) ───────────────────────
create table if not exists public.talents (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  handle           text,
  platform         text,
  profile_url      text,
  followers        integer,
  engagement_rate  numeric(5,2),
  niche            text,
  location         text,
  email            text,
  phone            text,
  rate             text,
  status           text not null default 'prospect'
                   check (status in ('prospect','contacted','awaiting','approved','in_production','delivered','declined')),
  tags             text[] not null default '{}',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Scouting fields (added later — safe to re-run)
alter table public.talents add column if not exists brand       text;
alter table public.talents add column if not exists tier        text;
alter table public.talents add column if not exists talent_type text;
alter table public.talents add column if not exists languages   text[] not null default '{}';


-- ─── Private upload links ──────────────────────────────────────────────────
-- One link per person. Whoever has the link can ONLY upload files through it.
create table if not exists public.upload_links (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique default replace(gen_random_uuid()::text, '-', ''),
  label           text not null,                     -- who the link is for
  talent_id       uuid references public.talents(id) on delete set null,
  season_id       uuid references public.seasons(id) on delete set null,
  instructions    text,                              -- message shown on the upload page
  is_active       boolean not null default true,
  expires_at      timestamptz,
  upload_count    integer not null default 0,
  last_upload_at  timestamptz,
  created_at      timestamptz not null default now()
);


-- ─── Assets (every photo, video, logo, file) ───────────────────────────────
create table if not exists public.assets (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  category        text not null default 'final' check (category in ('final','raw','brand')),
  media_type      text not null default 'other' check (media_type in ('image','video','audio','document','other')),
  season_id       uuid references public.seasons(id) on delete set null,   -- null = Evergreen
  talent_id       uuid references public.talents(id) on delete set null,
  upload_link_id  uuid references public.upload_links(id) on delete set null,
  source          text not null default 'team' check (source in ('team','talent')),
  storage_path    text not null unique,
  file_name       text,
  mime_type       text,
  size_bytes      bigint,
  tags            text[] not null default '{}',
  status          text not null default 'pending' check (status in ('pending','approved','changes','rejected')),
  review_note     text,
  reviewed_at     timestamptz,
  use_count       integer not null default 0,
  last_used_on    date,
  uploaded_by     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Library items: a video's cover photo and an optional caption.
alter table public.assets add column if not exists cover_path text;
alter table public.assets add column if not exists caption    text;
alter table public.assets add column if not exists external_url text; -- a link (Drive, Dropbox…) instead of a file
alter table public.assets alter column storage_path drop not null;

create index if not exists assets_season_idx  on public.assets (season_id);
create index if not exists assets_status_idx  on public.assets (status);
create index if not exists assets_talent_idx  on public.assets (talent_id);
create index if not exists assets_created_idx on public.assets (created_at desc);


-- ─── Usage log (where/when a piece of content was used) ────────────────────
create table if not exists public.asset_usage (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.assets(id) on delete cascade,
  channel     text,
  note        text,
  used_on     date not null default current_date,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists asset_usage_asset_idx on public.asset_usage (asset_id);


-- ─── Triggers ──────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists talents_updated_at on public.talents;
create trigger talents_updated_at before update on public.talents
  for each row execute function public.set_updated_at();

drop trigger if exists assets_updated_at on public.assets;
create trigger assets_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

-- Keep assets.use_count / last_used_on in sync with the usage log.
create or replace function public.sync_asset_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  aid uuid;
begin
  if tg_op = 'DELETE' then aid := old.asset_id; else aid := new.asset_id; end if;
  update public.assets a set
    use_count    = (select count(*)     from public.asset_usage u where u.asset_id = aid),
    last_used_on = (select max(used_on) from public.asset_usage u where u.asset_id = aid)
  where a.id = aid;
  return null;
end $$;

drop trigger if exists asset_usage_sync on public.asset_usage;
create trigger asset_usage_sync after insert or update or delete on public.asset_usage
  for each row execute function public.sync_asset_usage();


-- ─── Row Level Security: team only ─────────────────────────────────────────
-- Table access is granted to signed-in users, then RLS narrows it to the team list.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on
  public.team_members, public.seasons, public.talents, public.upload_links, public.assets, public.asset_usage
  to authenticated;

alter table public.team_members enable row level security;
alter table public.seasons      enable row level security;
alter table public.talents      enable row level security;
alter table public.upload_links enable row level security;
alter table public.assets       enable row level security;
alter table public.asset_usage  enable row level security;

drop policy if exists "team full access" on public.team_members;
create policy "team full access" on public.team_members for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "team full access" on public.seasons;
create policy "team full access" on public.seasons for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "team full access" on public.talents;
create policy "team full access" on public.talents for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "team full access" on public.upload_links;
create policy "team full access" on public.upload_links for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "team full access" on public.assets;
create policy "team full access" on public.assets for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));

drop policy if exists "team full access" on public.asset_usage;
create policy "team full access" on public.asset_usage for all to authenticated
  using ((select public.is_team())) with check ((select public.is_team()));


-- ─── Upload-link functions (the ONLY things a link holder can call) ────────
create or replace function public.valid_upload_token(p_token text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.upload_links
    where token = p_token
      and is_active
      and (expires_at is null or expires_at > now())
  );
$$;

-- What the upload page shows: who the link is for + the team's instructions.
create or replace function public.upload_link_info(p_token text)
returns table (label text, instructions text, season_name text, talent_name text)
language sql stable security definer set search_path = public as $$
  select l.label, l.instructions, s.name, t.name
  from public.upload_links l
  left join public.seasons s on s.id = l.season_id
  left join public.talents t on t.id = l.talent_id
  where l.token = p_token
    and l.is_active
    and (l.expires_at is null or l.expires_at > now());
$$;

create or replace function public.media_type_for(p_mime text)
returns text language sql immutable as $$
  select case
    when p_mime like 'image/%' then 'image'
    when p_mime like 'video/%' then 'video'
    when p_mime like 'audio/%' then 'audio'
    when p_mime = 'application/pdf'
      or p_mime like 'text/%'
      or p_mime like 'application/msword%'
      or p_mime like 'application/vnd.%' then 'document'
    else 'other'
  end;
$$;

-- Called by the upload page after a file finishes uploading.
create or replace function public.submit_content(
  p_token        text,
  p_path         text,
  p_title        text,
  p_description  text,
  p_file_name    text,
  p_mime_type    text,
  p_size_bytes   bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l       public.upload_links;
  obj     storage.objects;
  new_id  uuid;
  mime    text;
begin
  select * into l from public.upload_links
  where token = p_token and is_active and (expires_at is null or expires_at > now());
  if not found then
    raise exception 'This upload link is no longer active. Please contact the team.';
  end if;

  if p_path is null or left(p_path, length('submissions/' || p_token || '/')) <> 'submissions/' || p_token || '/' then
    raise exception 'Invalid file location.';
  end if;

  select * into obj from storage.objects where bucket_id = 'media' and name = p_path;
  if not found then
    raise exception 'We could not find the uploaded file. Please try again.';
  end if;

  mime := coalesce(obj.metadata ->> 'mimetype', p_mime_type, 'application/octet-stream');

  insert into public.assets (
    title, description, category, media_type, season_id, talent_id, upload_link_id,
    source, storage_path, file_name, mime_type, size_bytes, status, uploaded_by
  ) values (
    coalesce(nullif(trim(p_title), ''), p_file_name, 'Untitled'),
    nullif(trim(p_description), ''),
    'final',
    public.media_type_for(mime),
    l.season_id, l.talent_id, l.id,
    'talent', p_path, p_file_name, mime,
    coalesce((obj.metadata ->> 'size')::bigint, p_size_bytes),
    'pending', l.label
  ) returning id into new_id;

  update public.upload_links
  set upload_count = upload_count + 1, last_upload_at = now()
  where id = l.id;

  return new_id;
end $$;

-- Lets a creator see what they already sent through their link (title + status only).
create or replace function public.link_submissions(p_token text)
returns table (title text, media_type text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.title, a.media_type, a.status, a.created_at
  from public.assets a
  join public.upload_links l on l.id = a.upload_link_id
  where l.token = p_token
    and l.is_active
    and (l.expires_at is null or l.expires_at > now())
  order by a.created_at desc
  limit 200;
$$;

grant execute on function public.is_team()                  to authenticated;
grant execute on function public.valid_upload_token(text)    to anon, authenticated;
grant execute on function public.upload_link_info(text)      to anon, authenticated;
grant execute on function public.link_submissions(text)      to anon, authenticated;
grant execute on function public.submit_content(text, text, text, text, text, text, bigint) to anon, authenticated;


-- ─── File storage ──────────────────────────────────────────────────────────
-- One private bucket. Files are only reachable through short-lived signed links.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "media: team read"   on storage.objects;
drop policy if exists "media: team upload" on storage.objects;
drop policy if exists "media: team update" on storage.objects;
drop policy if exists "media: team delete" on storage.objects;
drop policy if exists "media: upload link" on storage.objects;

create policy "media: team read" on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_team()));

create policy "media: team upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_team()));

create policy "media: team update" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_team()));

create policy "media: team delete" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_team()));

-- Link holders may only ADD files, only inside submissions/<their-token>/,
-- and only while their link is active. They can't list, view or delete anything.
create policy "media: upload link" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'submissions'
    and public.valid_upload_token((storage.foldername(name))[2])
  );


-- ============================================================================
--  LAST STEP — add yourself to the team (change the email, then run this line):
--
--  insert into public.team_members (email, name) values ('you@yourcompany.com', 'Your Name');
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists offices (
  id text primary key,
  name text not null,
  location text,
  qr_token text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id text primary key,
  display_name text not null,
  role text,
  team text,
  avatar_url text,
  seat_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  create type work_mode as enum ('office', 'remote');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type presence_status as enum ('active', 'away', 'meeting', 'checked_out', 'auto_checked_out');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type entry_method as enum ('office_qr', 'remote_manual', 'admin_edit', 'auto_timeout');
exception
  when duplicate_object then null;
end $$;

create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id),
  office_id text not null references offices(id),
  work_mode work_mode not null,
  status presence_status not null default 'active',
  entry_method entry_method not null,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  checkout_reason text,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists current_presence (
  user_id text primary key references profiles(id),
  office_id text not null references offices(id),
  active_session_id uuid references attendance_sessions(id),
  work_mode work_mode not null,
  status presence_status not null,
  entry_method entry_method not null,
  since timestamptz not null,
  last_seen_at timestamptz not null,
  seat_label text,
  position_x numeric,
  position_y numeric
);

create table if not exists presence_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(id),
  office_id text not null references offices(id),
  event_type text not null,
  work_mode work_mode not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table offices enable row level security;
alter table profiles enable row level security;
alter table attendance_sessions enable row level security;
alter table current_presence enable row level security;
alter table presence_events enable row level security;

grant select on offices, profiles, attendance_sessions, current_presence, presence_events to authenticated;
grant all on offices, profiles, attendance_sessions, current_presence, presence_events to service_role;

drop policy if exists "authenticated can read offices" on offices;
create policy "authenticated can read offices"
on offices for select
to authenticated
using (true);

drop policy if exists "authenticated can read active profiles" on profiles;
create policy "authenticated can read active profiles"
on profiles for select
to authenticated
using (is_active = true);

drop policy if exists "authenticated can read sessions" on attendance_sessions;
create policy "authenticated can read sessions"
on attendance_sessions for select
to authenticated
using (true);

drop policy if exists "authenticated can read current presence" on current_presence;
create policy "authenticated can read current presence"
on current_presence for select
to authenticated
using (true);

drop policy if exists "authenticated can read events" on presence_events;
create policy "authenticated can read events"
on presence_events for select
to authenticated
using (true);

create or replace function check_in_presence(
  p_user_id text,
  p_work_mode work_mode,
  p_status presence_status default 'active',
  p_entry_method entry_method default null
)
returns jsonb
language plpgsql
as $$
declare
  v_office_id text := '86-lab-osaka';
  v_checked_at timestamptz := now();
  v_entry_method entry_method;
  v_session_id uuid;
  v_profile profiles%rowtype;
  v_seat_label text;
  v_position_x numeric;
  v_position_y numeric;
  v_mode_label text;
  v_event_type text;
begin
  select *
  into v_profile
  from profiles
  where id = p_user_id
    and is_active = true;

  if not found then
    raise exception 'profile not found: %', p_user_id;
  end if;

  v_entry_method := coalesce(
    p_entry_method,
    case when p_work_mode = 'office' then 'office_qr'::entry_method else 'remote_manual'::entry_method end
  );

  update attendance_sessions
  set checked_out_at = v_checked_at,
      status = 'checked_out',
      checkout_reason = 'mode_switch'
  where user_id = p_user_id
    and checked_out_at is null;

  insert into attendance_sessions (
    user_id,
    office_id,
    work_mode,
    status,
    entry_method,
    checked_in_at,
    memo
  )
  values (
    p_user_id,
    v_office_id,
    p_work_mode,
    p_status,
    v_entry_method,
    v_checked_at,
    case when p_work_mode = 'office' then 'QR入室' else 'リモート入室' end
  )
  returning id into v_session_id;

  v_seat_label := case
    when p_work_mode = 'office' then coalesce(v_profile.seat_label, 'デスク C-1')
    else coalesce(v_profile.seat_label, 'リモートブース')
  end;

  v_position_x := case
    when p_work_mode <> 'office' then null
    when p_user_id = 'hachiro-motoki' then 37
    when p_user_id = 'marubayashi-yuto' then 55
    when p_user_id = 'miyabe-keishi' then 71
    when p_user_id = 'taniguchi-kyoshiro' then 47
    when p_user_id = 'kashima-sakuto' then 62
    when p_user_id = 'kajita-koki' then 47
    else 50
  end;

  v_position_y := case
    when p_work_mode <> 'office' then null
    when p_user_id = 'hachiro-motoki' then 47
    when p_user_id = 'marubayashi-yuto' then 54
    when p_user_id = 'miyabe-keishi' then 47
    when p_user_id = 'taniguchi-kyoshiro' then 61
    when p_user_id = 'kashima-sakuto' then 55
    when p_user_id = 'kajita-koki' then 61
    else 58
  end;

  insert into current_presence (
    user_id,
    office_id,
    active_session_id,
    work_mode,
    status,
    entry_method,
    since,
    last_seen_at,
    seat_label,
    position_x,
    position_y
  )
  values (
    p_user_id,
    v_office_id,
    v_session_id,
    p_work_mode,
    p_status,
    v_entry_method,
    v_checked_at,
    v_checked_at,
    v_seat_label,
    v_position_x,
    v_position_y
  )
  on conflict (user_id) do update
  set active_session_id = excluded.active_session_id,
      work_mode = excluded.work_mode,
      status = excluded.status,
      entry_method = excluded.entry_method,
      since = excluded.since,
      last_seen_at = excluded.last_seen_at,
      seat_label = excluded.seat_label,
      position_x = excluded.position_x,
      position_y = excluded.position_y;

  v_mode_label := case when p_work_mode = 'office' then 'オフィス' else 'リモート' end;
  v_event_type := case when p_work_mode = 'office' then 'check_in' else 'remote_in' end;

  insert into presence_events (user_id, office_id, event_type, work_mode, message, created_at)
  values (
    p_user_id,
    v_office_id,
    v_event_type,
    p_work_mode,
    v_profile.display_name || 'さんが' || v_mode_label || 'で入りました',
    v_checked_at
  );

  return jsonb_build_object('ok', true, 'session_id', v_session_id);
end;
$$;

create or replace function checkout_presence(p_user_id text)
returns jsonb
language plpgsql
as $$
declare
  v_checked_at timestamptz := now();
  v_presence current_presence%rowtype;
  v_profile profiles%rowtype;
  v_mode_label text;
begin
  select *
  into v_profile
  from profiles
  where id = p_user_id;

  if not found then
    raise exception 'profile not found: %', p_user_id;
  end if;

  select *
  into v_presence
  from current_presence
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', true, 'already_checked_out', true);
  end if;

  update attendance_sessions
  set checked_out_at = v_checked_at,
      status = 'checked_out',
      checkout_reason = 'manual_checkout'
  where user_id = p_user_id
    and checked_out_at is null;

  delete from current_presence
  where user_id = p_user_id;

  v_mode_label := case when v_presence.work_mode = 'office' then 'オフィス' else 'リモート' end;

  insert into presence_events (user_id, office_id, event_type, work_mode, message, created_at)
  values (
    p_user_id,
    v_presence.office_id,
    'checkout',
    v_presence.work_mode,
    v_profile.display_name || 'さんが' || v_mode_label || 'で退室しました',
    v_checked_at
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function update_presence_status(
  p_user_id text,
  p_status presence_status
)
returns jsonb
language plpgsql
as $$
declare
  v_checked_at timestamptz := now();
  v_presence current_presence%rowtype;
  v_profile profiles%rowtype;
  v_mode_label text;
  v_status_label text;
begin
  select *
  into v_presence
  from current_presence
  where user_id = p_user_id;

  if not found then
    raise exception 'current presence not found: %', p_user_id;
  end if;

  select *
  into v_profile
  from profiles
  where id = p_user_id;

  update current_presence
  set status = p_status,
      last_seen_at = v_checked_at
  where user_id = p_user_id;

  update attendance_sessions
  set status = p_status
  where user_id = p_user_id
    and checked_out_at is null;

  v_mode_label := case when v_presence.work_mode = 'office' then 'オフィス' else 'リモート' end;
  v_status_label := case
    when p_status = 'active' then '作業中になりました'
    when p_status = 'away' then '離席中になりました'
    when p_status = 'meeting' then '会議中になりました'
    else '更新されました'
  end;

  insert into presence_events (user_id, office_id, event_type, work_mode, message, created_at)
  values (
    p_user_id,
    v_presence.office_id,
    p_status::text,
    v_presence.work_mode,
    v_profile.display_name || 'さんが' || v_mode_label || 'で' || v_status_label,
    v_checked_at
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function check_in_presence(text, work_mode, presence_status, entry_method) from anon, authenticated;
revoke execute on function checkout_presence(text) from anon, authenticated;
revoke execute on function update_presence_status(text, presence_status) from anon, authenticated;
grant execute on function check_in_presence(text, work_mode, presence_status, entry_method) to service_role;
grant execute on function checkout_presence(text) to service_role;
grant execute on function update_presence_status(text, presence_status) to service_role;

insert into offices (id, name, location, qr_token)
values ('86-lab-osaka', '86研究所', '大阪オフィス 6F', '86-lab-office-main')
on conflict (id) do update
set name = excluded.name,
    location = excluded.location,
    qr_token = excluded.qr_token;

insert into profiles (id, display_name, role, team, avatar_url, seat_label)
values
  ('hachiro-motoki', '鉢呂元輝', 'Strategy', '企画', '/assets/avatars/hachiro-motoki.png', 'デスク A-1'),
  ('marubayashi-yuto', '丸林勇登', 'Design', '制作', '/assets/avatars/marubayashi-yuto.png', 'デスク A-2'),
  ('taniguchi-kyoshiro', '谷口強志郎', 'Product', '開発', '/assets/avatars/taniguchi-kyoshiro.png', 'リモートブース 1'),
  ('miyabe-keishi', '宮部啓史', 'Operations', '管理', '/assets/avatars/miyabe-keishi.png', 'デスク B-1'),
  ('kashima-sakuto', '鹿島朔人', 'Engineering', '開発', '/assets/avatars/kashima-sakuto.png', 'リモートブース 2'),
  ('kajita-koki', '梶田航希', 'Support', '運用', '/assets/avatars/kajita-koki.png', 'リモートブース 3')
on conflict (id) do update
set display_name = excluded.display_name,
    role = excluded.role,
    team = excluded.team,
    avatar_url = excluded.avatar_url,
    seat_label = excluded.seat_label,
    is_active = true;

insert into current_presence (
  user_id,
  office_id,
  work_mode,
  status,
  entry_method,
  since,
  last_seen_at,
  seat_label,
  position_x,
  position_y
)
values
  ('hachiro-motoki', '86-lab-osaka', 'office', 'active', 'office_qr', '2026-05-24T09:05:00+09:00', '2026-05-24T10:12:00+09:00', 'デスク A-1', 37, 47),
  ('marubayashi-yuto', '86-lab-osaka', 'office', 'active', 'office_qr', '2026-05-24T09:18:00+09:00', '2026-05-24T10:18:00+09:00', 'デスク A-2', 55, 54),
  ('taniguchi-kyoshiro', '86-lab-osaka', 'remote', 'active', 'remote_manual', '2026-05-24T09:32:00+09:00', '2026-05-24T10:22:00+09:00', 'リモートブース 1', null, null),
  ('miyabe-keishi', '86-lab-osaka', 'office', 'away', 'office_qr', '2026-05-24T10:02:00+09:00', '2026-05-24T10:20:00+09:00', 'デスク B-1', 71, 47),
  ('kashima-sakuto', '86-lab-osaka', 'remote', 'meeting', 'remote_manual', '2026-05-24T09:47:00+09:00', '2026-05-24T10:19:00+09:00', 'リモートブース 2', null, null),
  ('kajita-koki', '86-lab-osaka', 'remote', 'active', 'remote_manual', '2026-05-24T09:56:00+09:00', '2026-05-24T10:16:00+09:00', 'リモートブース 3', null, null)
on conflict (user_id) do update
set work_mode = excluded.work_mode,
    status = excluded.status,
    entry_method = excluded.entry_method,
    since = excluded.since,
    last_seen_at = excluded.last_seen_at,
    seat_label = excluded.seat_label,
    position_x = excluded.position_x,
    position_y = excluded.position_y;

insert into attendance_sessions (
  id,
  user_id,
  office_id,
  work_mode,
  status,
  entry_method,
  checked_in_at,
  checked_out_at,
  memo
)
values
  ('11111111-1111-1111-1111-111111111111', 'hachiro-motoki', '86-lab-osaka', 'office', 'active', 'office_qr', '2026-05-24T09:05:00+09:00', null, '午前は企画、午後はレビュー'),
  ('22222222-2222-2222-2222-222222222222', 'marubayashi-yuto', '86-lab-osaka', 'office', 'active', 'office_qr', '2026-05-24T09:18:00+09:00', null, '制作作業'),
  ('33333333-3333-3333-3333-333333333333', 'taniguchi-kyoshiro', '86-lab-osaka', 'remote', 'active', 'remote_manual', '2026-05-24T09:32:00+09:00', null, 'リモート開発'),
  ('44444444-4444-4444-4444-444444444444', 'miyabe-keishi', '86-lab-osaka', 'office', 'away', 'office_qr', '2026-05-24T10:02:00+09:00', null, '休憩中'),
  ('55555555-5555-5555-5555-555555555555', 'kashima-sakuto', '86-lab-osaka', 'remote', 'meeting', 'remote_manual', '2026-05-24T09:47:00+09:00', null, 'オンラインMTG'),
  ('66666666-6666-6666-6666-666666666666', 'kajita-koki', '86-lab-osaka', 'remote', 'active', 'remote_manual', '2026-05-24T09:56:00+09:00', null, '運用対応'),
  ('77777777-7777-7777-7777-777777777777', 'hachiro-motoki', '86-lab-osaka', 'office', 'checked_out', 'office_qr', '2026-05-23T09:11:00+09:00', '2026-05-23T18:04:00+09:00', '終日オフィス'),
  ('88888888-8888-8888-8888-888888888888', 'taniguchi-kyoshiro', '86-lab-osaka', 'remote', 'checked_out', 'remote_manual', '2026-05-23T10:00:00+09:00', '2026-05-23T17:42:00+09:00', 'リモート')
on conflict (id) do update
set status = excluded.status,
    checked_out_at = excluded.checked_out_at,
    memo = excluded.memo;

insert into presence_events (
  id,
  user_id,
  office_id,
  event_type,
  work_mode,
  message,
  created_at
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'marubayashi-yuto', '86-lab-osaka', 'check_in', 'office', '丸林勇登さんがQRでオフィスに入りました', '2026-05-24T09:18:00+09:00'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'taniguchi-kyoshiro', '86-lab-osaka', 'remote_in', 'remote', '谷口強志郎さんがリモートで入りました', '2026-05-24T09:32:00+09:00'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'kashima-sakuto', '86-lab-osaka', 'meeting', 'remote', '鹿島朔人さんが会議中になりました', '2026-05-24T09:47:00+09:00'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'miyabe-keishi', '86-lab-osaka', 'away', 'office', '宮部啓史さんが離席中になりました', '2026-05-24T10:02:00+09:00')
on conflict (id) do update
set event_type = excluded.event_type,
    work_mode = excluded.work_mode,
    message = excluded.message,
    created_at = excluded.created_at;

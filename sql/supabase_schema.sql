-- =====================================================================
-- Quản Lý Nhập Hàng V5.5.2 - Cấu trúc database Supabase
-- Dựng lại từ code app (app.js, modules/*.js).
--
-- Cách dùng: Supabase Dashboard > SQL Editor > dán toàn bộ file > Run.
-- Chạy lại nhiều lần vẫn an toàn (không xóa dữ liệu đang có).
-- Sau đó chạy sql/set_admin.sql để cấp quyền Admin cho tài khoản chủ.
--
-- Mô hình quyền:
--   * Khách (chưa đăng nhập): chỉ ĐỌC các cột nghiệp vụ (không đọc email, mã thiết bị).
--   * Tài khoản đăng nhập: đọc toàn bộ; GHI theo quyền trong workspace_members.
--   * Không ai xóa cứng được dữ liệu: app xóa mềm bằng cột deleted_at.
--   * Không tự cấp Admin cho người đăng nhập đầu tiên: Admin chỉ được cấp
--     bằng set_admin.sql (chạy trong SQL Editor) hoặc bởi Admin khác trong app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Workspace và thành viên
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Quản Lý Nhập Hàng',
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  can_fill boolean not null default false,
  can_receive boolean not null default false,
  can_stocktake boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
-- App dùng một workspace chung: mỗi tài khoản thuộc tối đa một workspace.
create unique index if not exists workspace_members_user_key on public.workspace_members(user_id);

-- ---------------------------------------------------------------------
-- 2. Nhật ký nghiệp vụ (id dạng text vì app tự sinh id, kể cả "fill25-1")
-- ---------------------------------------------------------------------
create table if not exists public.fill_logs (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  created_by uuid,
  user_id uuid,
  device_id text,
  date date not null,
  machine text not null,
  slot integer,
  product text not null,
  qty numeric not null default 0,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.ncc_logs (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  created_by uuid,
  user_id uuid,
  device_id text,
  batch_id text,
  date date not null,
  machine text not null,
  product text not null,
  qty numeric not null default 0,
  boxes numeric,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Kiểm kê cabin và chuyển tồn (reason bắt đầu bằng "Chuyển tồn:")
create table if not exists public.adjust_logs (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  created_by uuid,
  user_id uuid,
  device_id text,
  batch_id text,
  date date not null,
  machine text not null,
  product text not null,
  qty numeric not null default 0,
  actual numeric,
  reason text,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------
-- 3. Cấu hình máy, layout slot, quy cách thùng (chỉ Admin được ghi)
-- ---------------------------------------------------------------------
create table if not exists public.machines (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  device_id text,
  name text not null,
  original_name text,
  aliases text[] not null default '{}',
  group_name text not null default '',
  cycle_days integer not null default 1,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.machine_slots (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  device_id text,
  machine_id text not null,
  slot_number integer not null,
  product text not null,
  capacity integer not null default 0,
  initial_machine integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.product_storage_rules (
  id text primary key,
  workspace_id uuid references public.workspaces(id),
  device_id text,
  product text not null,
  no_wrap boolean not null default true,
  pack integer not null default 24,
  shelf_per_pack numeric not null default 0.5,
  max_packs integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- App tải dữ liệu theo thứ tự (updated_at, id) và phân trang.
create index if not exists fill_logs_sync_idx on public.fill_logs(updated_at, id);
create index if not exists ncc_logs_sync_idx on public.ncc_logs(updated_at, id);
create index if not exists adjust_logs_sync_idx on public.adjust_logs(updated_at, id);
create index if not exists machines_sync_idx on public.machines(updated_at);
create index if not exists machine_slots_sync_idx on public.machine_slots(updated_at);
create index if not exists product_storage_rules_sync_idx on public.product_storage_rules(updated_at);

-- ---------------------------------------------------------------------
-- 4. Hàm hỗ trợ phân quyền (security definer để RLS không tự gọi lại chính nó)
-- ---------------------------------------------------------------------
create or replace function public.qlnh_my_workspace()
returns uuid
language sql stable security definer set search_path = public
as $$
  select workspace_id from public.workspace_members where user_id = auth.uid()
$$;

create or replace function public.qlnh_has_permission(p_permission text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select m.is_admin
        or (p_permission = 'fill' and m.can_fill)
        or (p_permission = 'receive' and m.can_receive)
        or (p_permission = 'stocktake' and m.can_stocktake)
    from public.workspace_members m
    where m.user_id = auth.uid()
  ), false)
$$;

-- ---------------------------------------------------------------------
-- 5. Trigger: server tự gắn thời gian, người ghi và workspace
--    (app dựa vào updated_at của server để gộp dữ liệu giữa các thiết bị)
-- ---------------------------------------------------------------------
create or replace function public.qlnh_stamp_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  has_owner boolean := tg_argv[0] = 'log';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.workspace_id := coalesce(public.qlnh_my_workspace(), new.workspace_id);
    if has_owner then
      new.created_by := coalesce(auth.uid(), new.created_by);
    end if;
  else
    -- Không cho đổi workspace, thời điểm tạo hoặc người tạo của bản ghi đã có.
    -- Bản ghi cũ chưa thuộc workspace nào thì nhận workspace của người sửa.
    new.workspace_id := coalesce(old.workspace_id, public.qlnh_my_workspace());
    new.created_at := old.created_at;
    if has_owner then
      new.created_by := old.created_by;
    end if;
  end if;
  if has_owner then
    new.user_id := coalesce(auth.uid(), new.user_id); -- người sửa gần nhất
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['fill_logs', 'ncc_logs', 'adjust_logs'] loop
    execute format('drop trigger if exists qlnh_stamp on public.%I', t);
    execute format('create trigger qlnh_stamp before insert or update on public.%I for each row execute function public.qlnh_stamp_row(%L)', t, 'log');
  end loop;
  foreach t in array array['machines', 'machine_slots', 'product_storage_rules'] loop
    execute format('drop trigger if exists qlnh_stamp on public.%I', t);
    execute format('create trigger qlnh_stamp before insert or update on public.%I for each row execute function public.qlnh_stamp_row(%L)', t, 'config');
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.fill_logs enable row level security;
alter table public.ncc_logs enable row level security;
alter table public.adjust_logs enable row level security;
alter table public.machines enable row level security;
alter table public.machine_slots enable row level security;
alter table public.product_storage_rules enable row level security;

-- Thu hồi mọi quyền mặc định rồi cấp lại đúng những gì app cần.
revoke all on public.workspaces, public.workspace_members, public.fill_logs, public.ncc_logs,
  public.adjust_logs, public.machines, public.machine_slots, public.product_storage_rules
  from anon, authenticated;

-- Khách: chỉ đọc các cột nghiệp vụ (đúng danh sách publicFields trong app.js).
grant select (id, date, machine, slot, product, qty, recorded_at, updated_at, deleted_at)
  on public.fill_logs to anon;
grant select (id, batch_id, date, machine, product, qty, boxes, recorded_at, updated_at, deleted_at)
  on public.ncc_logs to anon;
grant select (id, batch_id, date, machine, product, qty, actual, reason, recorded_at, updated_at, deleted_at)
  on public.adjust_logs to anon;
grant select (id, name, original_name, aliases, group_name, cycle_days, archived, created_at, updated_at, deleted_at)
  on public.machines to anon;
grant select (id, machine_id, slot_number, product, capacity, initial_machine, archived, created_at, updated_at, deleted_at)
  on public.machine_slots to anon;
grant select (id, product, no_wrap, pack, shelf_per_pack, max_packs, created_at, updated_at, deleted_at)
  on public.product_storage_rules to anon;

-- Tài khoản đăng nhập: đọc + thêm + sửa (không có DELETE; xóa là xóa mềm).
grant select, insert, update on public.fill_logs, public.ncc_logs, public.adjust_logs,
  public.machines, public.machine_slots, public.product_storage_rules to authenticated;
grant select on public.workspaces, public.workspace_members to authenticated;

do $$
declare
  t text;
  perm text;
  log_tables text[] := array['fill_logs', 'ncc_logs', 'adjust_logs'];
  log_perms text[] := array['fill', 'receive', 'stocktake'];
  i int;
begin
  -- Đọc công khai (dashboard cho khách) và cho mọi tài khoản đăng nhập.
  foreach t in array log_tables || array['machines', 'machine_slots', 'product_storage_rules'] loop
    execute format('drop policy if exists qlnh_read on public.%I', t);
    execute format('create policy qlnh_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  -- Ghi nhật ký theo quyền từng chức năng, chỉ trong workspace của mình.
  for i in 1 .. array_length(log_tables, 1) loop
    t := log_tables[i];
    perm := log_perms[i];
    execute format('drop policy if exists qlnh_insert on public.%I', t);
    execute format('create policy qlnh_insert on public.%I for insert to authenticated with check (public.qlnh_has_permission(%L) and workspace_id = public.qlnh_my_workspace())', t, perm);
    execute format('drop policy if exists qlnh_update on public.%I', t);
    execute format('create policy qlnh_update on public.%I for update to authenticated using (public.qlnh_has_permission(%L) and (workspace_id is null or workspace_id = public.qlnh_my_workspace())) with check (public.qlnh_has_permission(%L) and workspace_id = public.qlnh_my_workspace())', t, perm, perm);
  end loop;

  -- Cấu hình máy/layout/quy cách thùng: chỉ Admin.
  foreach t in array array['machines', 'machine_slots', 'product_storage_rules'] loop
    execute format('drop policy if exists qlnh_insert on public.%I', t);
    execute format('create policy qlnh_insert on public.%I for insert to authenticated with check (public.qlnh_has_permission(%L) and workspace_id = public.qlnh_my_workspace())', t, 'manage');
    execute format('drop policy if exists qlnh_update on public.%I', t);
    execute format('create policy qlnh_update on public.%I for update to authenticated using (public.qlnh_has_permission(%L) and (workspace_id is null or workspace_id = public.qlnh_my_workspace())) with check (public.qlnh_has_permission(%L) and workspace_id = public.qlnh_my_workspace())', t, 'manage', 'manage');
  end loop;
end $$;

-- Thành viên thấy workspace và danh sách thành viên của chính mình.
drop policy if exists qlnh_read on public.workspaces;
create policy qlnh_read on public.workspaces for select to authenticated
  using (id = public.qlnh_my_workspace());
drop policy if exists qlnh_read on public.workspace_members;
create policy qlnh_read on public.workspace_members for select to authenticated
  using (workspace_id = public.qlnh_my_workspace());

-- ---------------------------------------------------------------------
-- 7. RPC app gọi
-- ---------------------------------------------------------------------

-- Trả về quyền của tài khoản đang đăng nhập. Tài khoản chưa được cấp quyền sẽ nhận lỗi.
-- Khi được gọi lần đầu sau khi có workspace, nhận các bản ghi cũ chưa thuộc workspace nào.
create or replace function public.bootstrap_fill_assistant_owner()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  me public.workspace_members;
begin
  if auth.uid() is null then
    raise exception 'Cần đăng nhập.' using errcode = '28000';
  end if;
  select * into me from public.workspace_members where user_id = auth.uid();
  if not found then
    raise exception 'Tài khoản chưa được cấp quyền. Nhờ quản trị viên thêm email này trong Quản lý > Tài khoản.' using errcode = '42501';
  end if;
  if me.is_admin then
    update public.fill_logs set workspace_id = me.workspace_id where workspace_id is null;
    update public.ncc_logs set workspace_id = me.workspace_id where workspace_id is null;
    update public.adjust_logs set workspace_id = me.workspace_id where workspace_id is null;
    update public.machines set workspace_id = me.workspace_id where workspace_id is null;
    update public.machine_slots set workspace_id = me.workspace_id where workspace_id is null;
    update public.product_storage_rules set workspace_id = me.workspace_id where workspace_id is null;
  end if;
  return json_build_object(
    'workspace_id', me.workspace_id,
    'user_id', me.user_id,
    'email', me.email,
    'display_name', me.display_name,
    'role', me.role,
    'can_fill', me.can_fill or me.is_admin,
    'can_receive', me.can_receive or me.is_admin,
    'can_stocktake', me.can_stocktake or me.is_admin,
    'is_admin', me.is_admin
  );
end;
$$;

-- Admin cấp/sửa quyền theo email. Tài khoản phải được tạo trước trong Authentication > Users.
create or replace function public.upsert_fill_assistant_member(
  p_email text,
  p_can_fill boolean,
  p_can_receive boolean,
  p_can_stocktake boolean,
  p_is_admin boolean
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  my_ws uuid := public.qlnh_my_workspace();
  target auth.users;
  existing public.workspace_members;
begin
  if not public.qlnh_has_permission('manage') then
    raise exception 'Chỉ quản trị viên được phân quyền.' using errcode = '42501';
  end if;
  select * into target from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if not found then
    raise exception 'Chưa có tài khoản với email %. Tạo tài khoản trong Supabase > Authentication > Users trước.', trim(p_email);
  end if;
  select * into existing from public.workspace_members where user_id = target.id;
  if found and existing.workspace_id <> my_ws then
    raise exception 'Tài khoản này đang thuộc workspace khác.';
  end if;
  if target.id = auth.uid() and not p_is_admin then
    raise exception 'Không thể tự bỏ quyền Admin của chính mình.';
  end if;
  insert into public.workspace_members as m
    (workspace_id, user_id, email, role, can_fill, can_receive, can_stocktake, is_admin)
  values
    (my_ws, target.id, target.email, case when p_is_admin then 'admin' else 'user' end,
     p_can_fill or p_is_admin, p_can_receive or p_is_admin, p_can_stocktake or p_is_admin, p_is_admin)
  on conflict (workspace_id, user_id) do update set
    email = excluded.email,
    role = excluded.role,
    can_fill = excluded.can_fill,
    can_receive = excluded.can_receive,
    can_stocktake = excluded.can_stocktake,
    is_admin = excluded.is_admin,
    updated_at = now();
  return json_build_object('user_id', target.id, 'email', target.email);
end;
$$;

revoke all on function public.bootstrap_fill_assistant_owner() from public, anon;
revoke all on function public.upsert_fill_assistant_member(text, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.qlnh_my_workspace() from public, anon;
revoke all on function public.qlnh_has_permission(text) from public, anon;
grant execute on function public.bootstrap_fill_assistant_owner() to authenticated;
grant execute on function public.upsert_fill_assistant_member(text, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.qlnh_my_workspace() to authenticated;
grant execute on function public.qlnh_has_permission(text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. View xem nhanh danh sách tài khoản (trong Table Editor)
-- ---------------------------------------------------------------------
create or replace view public.app_users with (security_invoker = true) as
  select email, role, is_admin, can_fill, can_receive, can_stocktake, created_at
  from public.workspace_members
  order by created_at;
revoke all on public.app_users from anon;
grant select on public.app_users to authenticated;

-- Báo cho API Supabase nạp lại cấu trúc mới (tránh lỗi PGRST205 "không tìm thấy bảng").
notify pgrst, 'reload schema';

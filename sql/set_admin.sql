-- =====================================================================
-- Cấp quyền Admin cho tài khoản chủ.
-- 1. Tạo tài khoản trước: Supabase > Authentication > Users > Add user.
-- 2. Sửa email ở dòng admin_email bên dưới thành email của bạn.
-- 3. Dán vào SQL Editor > Run. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================
do $$
declare
  admin_email text := 'email-cua-ban@example.com';  -- <== SỬA EMAIL Ở ĐÂY
  target_id uuid;
  ws uuid;
begin
  select id into target_id from auth.users where lower(email) = lower(admin_email) limit 1;
  if target_id is null then
    raise exception 'Chưa có tài khoản %. Tạo trong Authentication > Users trước.', admin_email;
  end if;

  -- Dùng workspace đang có (của tài khoản này, hoặc workspace đầu tiên), nếu chưa có thì tạo mới.
  select workspace_id into ws from public.workspace_members where user_id = target_id;
  if ws is null then
    select id into ws from public.workspaces order by created_at limit 1;
  end if;
  if ws is null then
    insert into public.workspaces (name) values ('Quản Lý Nhập Hàng') returning id into ws;
  end if;

  insert into public.workspace_members
    (workspace_id, user_id, email, role, can_fill, can_receive, can_stocktake, is_admin)
  values (ws, target_id, admin_email, 'admin', true, true, true, true)
  on conflict (workspace_id, user_id) do update set
    role = 'admin', can_fill = true, can_receive = true, can_stocktake = true,
    is_admin = true, updated_at = now();

  raise notice 'Đã cấp Admin cho % trong workspace %', admin_email, ws;
end $$;

# Cài đặt Supabase cho Quản Lý Nhập Hàng

## Lần đầu (database trống)

1. **Tạo tài khoản Admin:** Supabase > **Authentication > Users** > **Add user** > nhập email, mật khẩu, tick **Auto Confirm User**.
2. **Tạo bảng:** **SQL Editor** > **New query** > dán toàn bộ `sql/supabase_schema.sql` > **Run**.
3. **Cấp quyền Admin:** mở `sql/set_admin.sql`, sửa dòng `admin_email` thành email ở bước 1 > dán vào SQL Editor > **Run**.
4. **Tắt đăng ký tự do (khuyên dùng):** **Authentication > Sign In / Providers** > tắt **Allow new users to sign up**. Tài khoản nhân viên do Admin tạo ở bước 1.
5. Mở app > **Đăng nhập** bằng tài khoản Admin. Huy hiệu chuyển thành **Đã đồng bộ**, dữ liệu trên máy được đẩy lên cloud.

`supabase_schema.sql` chạy lại nhiều lần vẫn an toàn, không xóa dữ liệu.

## Thêm nhân viên

1. Tạo tài khoản trong **Authentication > Users** (như bước 1).
2. Trong app: **Quản lý > Tài khoản và phân quyền** > nhập email, chọn quyền > **Lưu tài khoản**.
3. Nhân viên đăng nhập một lần trên thiết bị của họ; phiên được ghi nhớ.

## Quyền

| Ai | Được làm |
|---|---|
| Khách (chưa đăng nhập) | Xem Dashboard, Tồn cabin, Lịch sử. Không thấy email, mã thiết bị. |
| Tài khoản chưa được cấp quyền | Chỉ xem như khách. |
| Fill nhanh | Thêm, sửa, xóa lịch sử Fill. |
| Nhập hàng | Thêm, sửa, xóa lịch sử Nhập hàng NCC. |
| Kiểm kê cabin | Kiểm kê và chuyển tồn. |
| Admin | Toàn bộ quyền, layout máy, quy cách thùng, phân quyền tài khoản, nhập JSON, reset. |

- Xóa trong app là xóa mềm (`deleted_at`), không ai xóa cứng được qua API.
- Server tự ghi `updated_at`, người tạo (`created_by`) và người sửa gần nhất (`user_id`).
- Muốn tắt chế độ xem cho khách: chạy `revoke select on public.fill_logs, public.ncc_logs, public.adjust_logs, public.machines, public.machine_slots, public.product_storage_rules from anon;`

## Lỗi thường gặp

- **`PGRST205` / "Could not find the table"**: chưa chạy `supabase_schema.sql`, hoặc chạy `notify pgrst, 'reload schema';` trong SQL Editor.
- **"Tài khoản chưa được cấp quyền"**: Admin chưa thêm email này, hoặc chưa chạy `set_admin.sql` cho tài khoản chủ.

Chỉ dùng **Publishable key** trong mã nguồn. Không đưa **Secret key** hoặc `service_role` vào app.

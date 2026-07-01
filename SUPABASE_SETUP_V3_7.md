# Supabase cho Quản Lý Nhập Hàng V4.0.0

## Chuyen tu ban 3.6.0

1. Vao **Supabase > Authentication > Users** va tao tai khoan quan tri bang email, mat khau.
2. Vao **SQL Editor**, mo file `supabase_schema.sql`, dan toan bo noi dung roi bam **Run**.
3. Chay them file `set_admin.sql` de cap Admin cho tai khoan chu.
4. Mở Quản Lý Nhập Hàng bằng `index.html?v=4.0.0`, bấm **Đăng nhập** ở góc phải.
5. Dang nhap tai khoan quan tri. Tai khoan nay se nhan toan bo du lieu cu va co du quyen.
6. Cho huy hieu bao **Da dong bo**, sau do kiem tra lich su Fill, Nhap hang va Kiem ke.

Khong tat hay xoa du lieu cu truoc khi hoan thanh buoc 4. File SQL tu khoa quyen `anon` va chuyen du lieu cu vao workspace khi quan tri vien dau tien dang nhap.

## Them nguoi dung

1. Tao tai khoan moi trong **Authentication > Users**.
2. Trong Quản Lý Nhập Hàng, mở **Hệ thống > Phân quyền tài khoản**.
3. Nhap dung email, chon quyen **Fill nhanh**, **Nhap hang**, **Kiem ke cabin** hoac **Quan tri**, roi bam **Luu quyen**.
4. Nguoi dung dang nhap mot lan tren thiet bi cua ho; Supabase se ghi nho phien.

## Quyen

- **Fill nhanh:** them, sua va xoa lich su Fill.
- **Nhap hang:** them, sua va xoa lich su Nhap hang.
- **Kiem ke cabin:** luu, sua va xoa lich su kiem ke.
- **Quan tri:** co toan bo quyen, quan ly tai khoan, nhap JSON va reset du lieu.
- Tat ca thanh vien duoc xem du lieu chung cua workspace.

Chi dung `Publishable key` trong ma nguon. Khong dua `Secret key` hoac `service_role` vao ung dung.

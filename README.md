# Quản Lý Nhập Hàng V4.2.6

V4.2.6 đổi Nhập Hàng NCC sang danh sách sản phẩm của máy: chọn ngày và máy một lần, nhập số thùng rồi lưu cả lượt. Sản phẩm nằm ở nhiều slot chỉ xuất hiện một lần. Tổng thùng và số sản phẩm quy đổi cập nhật ngay khi nhập; bản nháp được giữ riêng theo máy.

Project PWA chuẩn để upload trực tiếp lên GitHub Pages.

## Có gì trong bản này

- Dashboard hoàn chỉnh.
- Tổng hợp đặt NCC hiển thị ngay trên Dashboard.
- Nút Copy đơn NCC.
- Fill nhanh theo máy.
- Nhập Fill thủ công.
- Nhập NCC thực nhận.
- Sửa / Xóa / Hoàn tác cho Fill, NCC, Điều chỉnh.
- Kiểm tra cabin âm.
- Đối chiếu kiểm kê.
- Responsive cho điện thoại.
- Dữ liệu ngày 25 và dữ liệu Fill/NCC cũ được giữ trong `data.js`.

## Cấu trúc project

```text
index.html
styles.css
app.js
data.js
manifest.json
sw.js
README.md
TEST_REPORT.md
icon-192.png
icon-512.png
```

## Quy tắc dữ liệu

Cabin hiện tại:

```text
Tồn cabin = Tồn ban đầu + NCC thực nhận - Fill + Điều chỉnh
```

Cabin âm:
- Không hiển thị âm.
- Hiển thị 0.
- Tab Kiểm tra báo lệch.

## Gợi ý đặt NCC

Sản phẩm thường:
- Tồn cabin > 12: đặt 1 thùng = 24.
- Tồn cabin <= 12: đặt 2 thùng = 48.

Aqua/Aquafina:
- Tồn cabin >= 28: đặt 2 thùng = 56.
- Tồn cabin < 28: đặt 3 thùng = 84.

## Cập nhật GitHub Pages

1. Giải nén ZIP.
2. Upload toàn bộ file trong thư mục lên repository GitHub.
3. Ghi đè file cũ.
4. Chờ GitHub Pages deploy lại.
5. Nếu điện thoại vẫn hiện bản cũ, refresh vài lần hoặc xóa cache website.

## Sao lưu

Trong app vào tab `Sao lưu` → `Xuất dữ liệu JSON`.

Nên sao lưu cuối ngày.


## V2.2 - Copy đơn NCC theo từng máy

Thay đổi phần NCC:
- `Tổng hợp đặt NCC` đổi thành `Đặt NCC theo từng máy`.
- Mỗi máy có nút `Copy <tên máy>`.
- Nút `Copy tất cả` sẽ copy toàn bộ đơn theo từng máy.

Ví dụ nội dung copy:

```text
Đơn NCC D3:
D3
- Aquafina: 2 thùng (56 chai)
- Pepsi: 1 thùng (24 lon)
```

Hoặc copy tất cả:

```text
Đơn NCC theo máy:
D3
- Aquafina: 2 thùng (56 chai)

D8
- Boss: 1 thùng (24 lon)
```


## V2.3 - Dashboard đặt NCC theo tab máy

Thay đổi:
- Phần `Đặt NCC theo từng máy` chuyển sang dạng tab ngang.
- Bấm từng máy để xem đơn NCC của máy đó.
- Mỗi máy vẫn có nút `Copy <tên máy>`.
- Nút `Copy tất cả` vẫn giữ để copy toàn bộ đơn theo máy.


## V2.4 - Sửa logic đặt NCC

Sản phẩm thường:
- Tồn cabin > 24: không đặt.
- Tồn cabin 13-24: đặt 1 thùng = 24 lon/chai.
- Tồn cabin 0-12: đặt 2 thùng = 48 lon/chai.

Aqua/Aquafina:
- Tồn cabin >= 28: đặt 2 thùng = 56 chai.
- Tồn cabin < 28: đặt 3 thùng = 84 chai.

Dashboard chỉ hiển thị sản phẩm thật sự cần đặt.


## V3.0 - Dashboard theo máy tự do

Thay đổi lớn:
- Bỏ tuyến A/B cố định.
- Dashboard có tab chọn 7 máy tự do.
- Chọn máy nào thì chỉ hiển thị:
  - Gợi ý đặt NCC của máy đó.
  - Đơn NCC của máy đó.
  - Hàng bán chậm/đang học của máy đó.
  - Cabin của máy đó.
- Nút Copy đơn chỉ copy đúng máy đang chọn.
- App nhớ máy cuối cùng bạn đang xem.

Dữ liệu Fill/NCC cũ được giữ bằng cơ chế migrate localStorage từ các bản V2.x.


## V3.1 - Kiểm kê cabin ngay trên Dashboard

Thêm chức năng `Kiểm kê cabin` tại máy đang chọn.

Cách dùng:
1. Vào Dashboard.
2. Chọn máy.
3. Ở phần `Cabin máy đang chọn`, bấm `Kiểm kê cabin`.
4. Nhập số tồn thực tế của từng sản phẩm.
5. Bấm `Lưu`.

App tự tính:
```text
Chênh lệch = Tồn thực tế - Tồn app đang tính
```

Sau đó tự tạo bản ghi `Điều chỉnh` với lý do `Kiểm kê`.

Bạn không cần tự tính + hoặc - nữa.


## V3.2 - Tổng thùng NCC và ngưỡng đặt mới

Quy tắc đặt NCC mới:

Sản phẩm thường:
- Tồn > 12: không đặt.
- Tồn 3-12: đặt 1 thùng.
- Tồn dưới 3: đặt 2 thùng.

Aqua/Aquafina:
- Giữ quy tắc cũ.
- Tồn >= 28: đặt 2 thùng.
- Tồn < 28: đặt 3 thùng.
- Aqua và Aquafina được xem là cùng nhóm nước Aqua.

Bổ sung:
- Dashboard hiển thị `Tổng thùng NCC` của máy đang xem.
- Gợi ý đặt NCC có dòng `Tổng cần đặt`.
- Copy đơn có thêm dòng `TỔNG: x THÙNG`.


## V3.2.1 - Fill nhanh lưu nhiều slot

Thay đổi phần Fill nhanh:
- Nhập số lượng cho nhiều slot trước.
- Bấm `Lưu các slot đã nhập` để lưu toàn bộ slot có số lượng > 0 trong một lượt.
- Nút `Xóa hết` xóa nhanh các số đang nhập nhưng chưa lưu.
- Nếu có số lượng lớn bất thường, app hỏi xác nhận một lần trước khi lưu.


## V3.2.2 - Fill nhanh gọn hơn

Thay đổi phần Fill nhanh:
- Mỗi slot hiển thị thành một dòng gọn hơn.
- Các nút `+1`, `+2`, `+5` nằm ngay cạnh ô nhập số.
- Bỏ các nút cộng lớn trong Fill nhanh để thao tác đỡ rối trên điện thoại.


## V3.2.3 - Nút cộng trong ô nhập số

Thay đổi phần Fill nhanh:
- Các nút `+1`, `+2`, `+3`, `+5` nằm trong cùng khung với ô nhập số.
- Thêm nút `+3`.
- Mỗi slot vẫn lưu chung bằng nút `Lưu các slot đã nhập`.


## V3.2.4 - Nút cộng bên phải ô nhập

Thay đổi phần Fill nhanh:
- Ô nhập số nằm bên trái trong khung nhập.
- Các nút `+1`, `+2`, `+3`, `+5` nằm bên phải trong cùng khung.
- Placeholder số dùng font/style đồng bộ hơn với giao diện.


## V3.2.5 - Font Việt hoá toàn app

Thay đổi giao diện:
- Ép toàn bộ app, nút, ô nhập, select và placeholder dùng font hỗ trợ tiếng Việt.
- Ưu tiên `Segoe UI`, `Tahoma`, `Arial`.
- Hạ các chữ quá đậm từ weight 1000 về 900 để dấu tiếng Việt hiển thị tự nhiên hơn.


## V3.3.0 - Dashboard hành động

Thay đổi Dashboard:
- Thêm dòng `Ưu tiên hôm nay` ngay dưới chọn máy.
- Rút gọn thống kê còn 4 số chính: tổng thùng, món cần đặt, tồn cần chú ý, lỗi dữ liệu.
- Đưa `Đơn NCC` lên làm card chính để copy nhanh.
- Chuyển `Gợi ý đặt NCC` thành `Tồn thấp / cần chú ý`.
- Thu gọn `Hàng bán chậm` và `Cabin đầy đủ` thành mục mở rộng.


## V3.3.1 - Xuất Excel đơn NCC

Thay đổi Dashboard:
- Đổi cách gọi trên Dashboard để ưu tiên `thùng` thay vì `món`.
- Thêm khu vực `Xuất Excel đơn NCC`.
- Có thể chọn một hoặc nhiều máy cùng lúc để xuất file `.xls`.
- File Excel gồm máy, sản phẩm, số thùng, quy đổi, đơn vị và tồn cabin.


## V3.3.2 - Xuất CSV mở bằng Excel

Thay đổi xuất đơn NCC:
- Đổi file xuất từ `.xls` sang `.csv` để Excel không báo lỗi định dạng không khớp đuôi file.
- File CSV có BOM UTF-8 để tiếng Việt mở đúng trong Excel.
- Vẫn chọn được nhiều máy cùng lúc.


## V3.4.0 - Supabase Sync bản nền

Thêm tab `Đồng bộ`:
- Cấu hình Supabase Project URL và publishable/anon key.
- Đăng nhập Supabase bằng email/password.
- Hiển thị trạng thái online/offline, tài khoản và số bản ghi chưa đồng bộ.
- App vẫn lưu local trước như cũ.
- Khi online và đã đăng nhập, bấm `Đồng bộ ngay` để đẩy Fill/NCC/Điều chỉnh lên Supabase và tải dữ liệu online về.
- Khi nhập dữ liệu mới, app tự thử đồng bộ nếu đang online.

File `sql/supabase_schema.sql` đi kèm để tạo bảng và policy trong Supabase.

Lưu ý V3.4.0:
- Bản này ưu tiên đồng bộ thêm/sửa dữ liệu.
- Xóa offline chưa dùng tombstone, nên nếu cần đồng bộ thao tác xóa giữa nhiều thiết bị thì nên nâng tiếp V3.4.1.


## V3.4.1 - Ẩn cấu hình đồng bộ

Thay đổi:
- Tab `Đồng bộ` bị ẩn mặc định.
- Chỉ hiện cấu hình đồng bộ khi URL có `admin=1`.
- Ví dụ local: `index.html?v=3.4.1&admin=1`.
- Người dùng bình thường chỉ thấy app vận hành, không thấy form URL/key Supabase.

## V3.4.2 - Supabase key gan san trong code

Thay doi:
- Co the gan san Supabase Project URL va publishable key trong `app.js`.
- Nguoi dung may khac/dien thoai khong can nhap Project URL/key neu code da co du thong tin.
- Man hinh thuong chi hien dang nhap va dong bo; form URL/key van chi hien khi mo `admin=1`.
- Tuyet doi khong dua `sb_secret_...` hoac service role key vao frontend.

Vi tri cau hinh trong `app.js`:
- `DEFAULT_SUPABASE_URL`
- `DEFAULT_SUPABASE_KEY`

Neu muon che key khoi hien ro trong code, co the luu dang base64 voi tien to `b64:`.
Day chi la che mat nhe, khong phai bao mat that su. Bao mat chinh van la Supabase Auth + RLS.

## V3.5.0 - Luong nhap lieu tong hop

- Menu truot tu ben trai va phu len noi dung.
- Fill nhanh thay the Nhap Fill, giu ngay va luu nhieu slot mot luot.
- NCC doi thanh Nhap hang; Aqua 28 san pham/thung, san pham khac 24 san pham/thung.
- Dieu chinh doi thanh Kiem ke cabin va luu toan bo chenh lech mot luot.
- Lich su rieng gom Nhap Fill, Nhap hang va Kiem ke cabin.
- Dong bo Supabase tu dong bang publishable key, khong can dang nhap.
- Xoa du lieu dung dau xoa de dong bo dung giua nhieu thiet bi.
- Chuc nang Sao luu giu nguyen, chua dua vao pham vi cai to.

Truoc khi dung dong bo V3.5.1, chay lai `sql/supabase_schema.sql` trong Supabase SQL Editor.

## V3.5.1

- Dua Kiem ke cabin vao chung muc Kiem tra.
- Sua nut Nhap lai ben canh Luu kiem ke hien thi ro rang.

## V3.5.2

- Lich su moi hien them gio, phut va giay ghi nhan.
- Du lieu cu khong co moc thoi gian chinh xac van chi hien ngay.

## V3.6.0 - Dong bo on dinh

- Tai lich su theo trang 500 dong, khong bi gioi han 1.000 dong.
- Day du lieu theo lo 250 dong.
- Supabase gan `updated_at` bang thoi gian server.
- Tu dong dong bo moi 30 giay khi app dang mo.
- Reset va khoi phuc JSON duoc dong bo nhat quan len cloud.
- Hien thoi diem dong bo thanh cong gan nhat.

## V3.7.0 - Dang nhap va phan quyen

- Bat buoc dang nhap Supabase de doc va dong bo du lieu online.
- Ghi nho phien dang nhap tren tung thiet bi; mat mang van luu local theo quyen da cap.
- Phan quyen rieng cho Fill nhanh, Nhap hang, Kiem ke cabin va Quan tri.
- Khoa quyen `anon` bang RLS; du lieu cu duoc tai khoan quan tri dau tien nhan vao workspace chung.
- Quan tri co the cap lai quyen theo email ngay trong trang Dong bo.

## V3.7.1 - Quan ly nguoi dung

- Them tab Nguoi dung rieng cho quan tri vien.
- Moi tai khoan co vai tro Admin hoac User va quyen theo tung chuc nang.
- Them view `app_users` trong Supabase de xem nhanh danh sach vai tro.
- Them file `sql/set_admin.sql` de cap quyen Admin truc tiep cho tai khoan chu.

## V3.7.2 - He thong gon hon

- Gop Sao luu, Nguoi dung va Dong bo vao mot tab He thong.
- Tab He thong chi hien khi tai khoan da dang nhap.
- User duoc sao luu va dong bo; quan ly nguoi dung, nhap JSON va reset chi danh cho Admin.

## V3.7.3 - Dashboard cong khai

- Nguoi chua dang nhap van tu dong doc du lieu Dashboard moi tu Supabase.
- Che do cong khai chi duoc SELECT cac cot nghiep vu can thiet, khong doc email hay ma thiet bi.
- Moi thao tac ghi van bat buoc dang nhap va duoc RLS kiem tra quyen.
- Khi chua dang nhap, menu chi hien Dashboard.

## V3.7.4 - Tra cuu cong khai

- Khach duoc xem Dashboard, Ton cabin va Lich su; Lich su khong co nut sua/xoa.
- Ton cabin chia theo may, co tong quan va xuat CSV cho may dang xem.
- Che do khach lay Supabase lam nguon chinh de loai bo ban local cu gay lech so lieu.

## V3.7.5 - Trang thai ro hon

- Trang thai Sap het trong Ton cabin hien thanh nhan xanh de de nhan biet.

## V3.7.6 - Canh bao theo mau

- Trang thai On hien thanh nhan xanh la, Sap het hien thanh nhan do.

## V3.7.7 - Canh bao de nhin

- Trang thai On mau xanh bien, Ton thap mau vang cam, Sap het mau do; tang khoang cach giua ten san pham va nhan trang thai.

## V3.7.8 - Khoang cach ro hon

- Tang khoang cach giua ten san pham va canh bao lech cabin cung dong.

## V3.7.9 - Dashboard gon hon

- Gop Ton thap, Hang ban cham va Ton cabin day du thanh ba tab trong cung mot khu vuc.

## V3.8.0 - Don nhap gon hon

- Aqua: ton tu 56 khong nhap; 28-55 nhap 1 thung; 1-27 nhap 2 thung; het hang nhap 3 thung.
- San pham khac ton tu 12 tro xuong chi nhap 1 thung; du lieu cabin am khong tu dong dua vao don.

## V3.8.1 - Kiem tra du lieu lech

- Muc cabin am hien Kiem tra trong danh sach chu y thay vi hien so thung can nhap.

# TEST REPORT - Quản Lý Nhập Hàng V4.4.2

- PASS: cú pháp `app.js`, `data.js` và `sw.js`.
- PASS: `tests/smoke-test.js` cho công thức Aqua và sản phẩm nhiều slot.
- PASS: chuẩn hóa state, thoát HTML và chống công thức CSV.
- PASS: không trùng ID trong HTML; manifest và cache cùng phiên bản V4.4.2.
- PASS: server local trả HTTP 200 cho `index.html`, `app.js` và toàn bộ module V4.4.2.
- PASS: kiểm tra trực tiếp trên trình duyệt, ba tab Vận hành chuyển đúng và không có lỗi console.
- PASS: lịch sử hiển thị 30 bản ghi mỗi trang; nút Trang sau chuyển đúng từ trang 1 sang trang 2.
- PASS: Nhập Hàng NCC dùng một máy cho cả lượt và chỉ hiển thị mỗi sản phẩm một lần dù nằm ở nhiều slot.
- PASS: tổng thùng và số sản phẩm quy đổi được tính lại khi ô số thùng phát sinh `input` hoặc `change`.
- PASS: kiểm tra trực tiếp ở viewport 390x844, Nhập Hàng NCC không tràn ngang; nhập 2 thùng cập nhật thành 48 sản phẩm và tổng 1 sản phẩm / 2 thùng / 48 sản phẩm.
- PASS: Nhập Hàng NCC trên mobile hiển thị toàn bộ danh sách như desktop, không còn trạng thái hoặc thanh Trước/Tiếp riêng.
- PASS: ghi bản nháp NCC được gom nhịp 180 ms trong khi nhập và ghi ngay khi ô phát sinh `change`.
- PASS: đổi máy Fill Sản phẩm chỉ gọi renderer hiện tại; giao diện runtime không chứa nút +1, +2, +3, +5.
- PASS: loại 60 định nghĩa hàm cũ bị ghi đè; `app.js` giảm khoảng 34% và không còn tên hàm trùng.
- PASS: runtime được nạp theo thứ tự core, Fill, NCC, kiểm kê, chuyển tồn, lịch sử, UI và bootstrap.
- PASS: runtime module đã được kiểm tra trên trình duyệt không có lỗi/cảnh báo console.
- PASS: sản phẩm thường một slot tồn 6 đặt 1 thùng, tồn 7 không đặt.
- PASS: Pepsi chanh hai slot, sức chứa 40 và tồn 0–6 đặt 2 thùng; tồn 7 không đặt.

# TEST REPORT - Quan Ly Nhap Hang V5.5.2

- PASS: `node tests/smoke-test.js` (thêm kiểm thử CRC Excel, ký tự XML, tham chiếu sheet, lịch sử kiểm kê, kiểm kê cabin âm).
- PASS: `node --check` cho `app.js`, `sw.js` và toàn bộ `modules/*.js`.
- PASS: không còn hàm khai báo trùng giữa các file runtime, không còn hàm không được gọi.
- PASS: khởi động trong Chromium headless, không có lỗi JavaScript.
- PASS: so sánh với V5.5.1 trên 4.000 log Fill giả lập (có máy đổi tên, bí danh, bản ghi đã xóa): đơn đặt hàng, tồn cabin, cabin âm, mục cần chú ý, trạng thái máy và số lượng lịch sử trùng khớp 100%.
- PASS: hiệu năng `renderAll()` ~180ms → ~8ms (dữ liệu gốc), ~143ms → ~19ms (~7.500 log).
- PASS: kiểm kê đưa cabin âm (-5) về 0 khi nhập tồn thực tế 0.
- PASS: Quy cách thùng giữ số đang sửa khi app vẽ lại / đồng bộ nền.
- PASS: toast hiển thị nội dung dạng chữ, không chạy HTML chèn vào.
- PASS: xuất 4 loại Excel (đơn NCC, tồn cabin, lịch sử Fill, lịch sử kiểm kê) mở được bằng openpyxl, không có ô NaN/undefined, bộ lọc không gồm dòng TỔNG.
- PASS: service worker cache sẵn file có `?v=`, mở offline được; sau khi deploy chỉ cần tải lại 1 lần là thấy bản mới.

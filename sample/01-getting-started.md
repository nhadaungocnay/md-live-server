# 🚀 Getting Started with md-live-server

Chào mừng bạn đến với **md-live-server**! Đây là file tài liệu mẫu để bạn thử nghiệm các tính năng.

---

## 💡 Hướng dẫn thử nghiệm tính năng Highlight & AI Note

1. **Bôi đen bất kỳ đoạn văn bản nào** trên trang này (ví dụ: đoạn văn bên dưới).
2. Một popup nhỏ sẽ xuất hiện ngay cạnh chuột.
3. Nhập câu hỏi hoặc ghi chú của bạn vào ô text area.
4. Bấm **"Gửi Agent"** để chuyển trực tiếp chỉ thị đến AI Agent (hoặc lưu vào file `.notes/`).

> [!TIP]
> Bạn có thể thử bôi đen dòng chữ: **"Cần tối ưu thuật toán xử lý dữ liệu lớn trong module thanh toán"** và gửi cho AI Agent!

---

## 📋 Danh sách công việc mẫu

- [x] Cài đặt Node.js và clone repository
- [x] Cấu hình file `.env`
- [ ] Khởi động server với lệnh `npm start`
- [ ] Thử tính năng bôi đen văn bản và ghi chú
- [ ] Thử lệnh convert tĩnh `npm run convert`

---

## 💻 Đoạn mã mẫu (Code Block)

```javascript
// Khởi tạo và chạy live server
import { spawn } from 'child_process';

console.log("Starting md-live-server on http://localhost:3456...");
```

---

## 📊 Bảng dữ liệu mẫu

| STT | Tên module | Trạng thái | Ghi chú |
| :--- | :--- | :--- | :--- |
| 01 | Live Markdown Viewer | ✅ Hoàn thành | Render real-time |
| 02 | AI Agent SSE Stream | ✅ Hoàn thành | Hỗ trợ Antigravity / Claude |
| 03 | Static HTML Exporter | ✅ Hoàn thành | CLI `md2html` |

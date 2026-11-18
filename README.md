# 🚀 MD Live Server (`md-live-server`)

> **Local Markdown Viewer App & Live Documentation Server with Native Picker, Drag & Drop, Real-time Live Reload, Highlight Annotation & AI Agent Integration.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Build](https://img.shields.io/badge/build-zero--step-orange.svg)]()

`md-live-server` là ứng dụng local gọn nhẹ giúp bạn xem, tra cứu tài liệu Markdown (`.md`) trực tiếp trên trình duyệt theo thời gian thực mà **không cần cấu hình `.env` thủ công**, tích hợp chọn thư mục/file từ giao diện, kéo thả (Drag & Drop), ghi chú nhanh và giao tiếp trực tiếp với **AI Agent (Google Antigravity, Claude Code, custom CLI)**.

---

## ✨ Tính năng nổi bật

- 🖱️ **Click-to-Run Local App**: Double-click vào **`MD Live Server.app`** (macOS) hoặc `Start MD Live Server.command` / `Start MD Live Server.bat` để tự khởi chạy server ngầm và mở trình duyệt ngay lập tức. Nếu server đã chạy sẵn, app tự động mở tab mới mà không báo lỗi trùng cổng.
- 📂 **Chọn Thư mục / File trực tiếp trên giao diện**:
  - Nút **Chọn thư mục** / **Chọn file** mở hộp thoại Finder (macOS), Explorer (Windows) hoặc Zenity/KDialog (Linux).
  - Nút **Nhập đường dẫn thủ công** hỗ trợ dán nhanh đường dẫn tuyệt đối hoặc dạng `~/...`.
- 📥 **Kéo & Thả (Drag & Drop) toàn màn hình**: Kéo thả 1 file `.md` lẻ, nhiều file hoặc cả thư mục chứa nhiều thư mục con trực tiếp vào cửa sổ trình duyệt để xem ngay.
- 🕒 **Tự nhớ & Lịch sử thư mục gần đây**: Tự động lưu thư mục đang mở và danh sách `recentDirs` vào `.md-server-config.json` (không cần file `.env`).
- 🔄 **Live Reload (SSE)**: Tự động cập nhật nội dung đang đọc ngay khi file `.md` trên ổ cứng thay đổi.
- 🔍 **Cây thư mục trực quan & Tìm kiếm nhanh**: Duyệt toàn bộ cấu trúc thư mục tài liệu với ô search filter thời gian thực.
- 📝 **Highlight-to-Note & 🤖 AI Agent Streaming (SSE)**: Bôi đen bất kỳ đoạn văn bản nào trên trang để tạo ghi chú hoặc gửi chỉ thị trực tiếp đến AI Agent.
- 🔌 **Nút tắt Server ngay trên web**: Chủ động dừng server chạy ngầm bất cứ lúc nào từ footer thanh bên trái.
- 📄 **CLI Convert tĩnh (`md2html`)**: Đi kèm script convert Markdown sang HTML độc lập (standalone).

---

## 📦 Cài đặt

### Yêu cầu hệ thống
- **Node.js** >= `18.0.0` (Khuyên dùng `20.x` hoặc `22.x+`)

### Clone & Cài đặt Dependencies

```bash
# Clone repository
git clone https://github.com/nhadaungocnay/md-live-server.git
cd md-live-server

# Cài đặt thư viện (chỉ phụ thuộc vào thư viện parse Markdown 'marked')
npm install
```

---

## 🚀 Hướng dẫn sử dụng

### Cách 1: Mở như một App Local (Khuyên dùng)

- **macOS**: Double-click vào **`MD Live Server.app`** (có thể kéo vào Dock để dùng hàng ngày) hoặc **`Start MD Live Server.command`**.
- **Windows**: Double-click vào **`Start MD Live Server.bat`**.
- **Từ dòng lệnh**:
  ```bash
  npm run app
  ```

App sẽ tự động:
1. Khởi chạy web server tại `http://localhost:3456` (tự động tăng port nếu cổng bị chiếm bởi ứng dụng khác).
2. Tự động mở trình duyệt mặc định.
3. Nhớ thư mục tài liệu bạn đã mở ở lần trước.

### Cách 2: Chạy qua CLI & Tùy chọn dòng lệnh

```bash
# Chạy server thông thường (không tự mở trình duyệt)
npm start

# Khởi động và tự mở trình duyệt
node md-server.mjs --open

# Xem tài liệu trong thư mục cụ thể
node md-server.mjs ./docs --open

# Đổi cổng và host
node md-server.mjs -p 8080 -H 0.0.0.0

# Tắt tích hợp AI Agent
node md-server.mjs --no-agent

# Tùy chỉnh câu lệnh gọi AI Agent khác (ví dụ Claude CLI)
node md-server.mjs --agent-cmd "claude --continue"
```

---

## ⚙️ Cấu hình `.env` (Tùy chọn)

Bạn **không cần** tạo file `.env` nếu chọn thư mục trực tiếp trên giao diện. File `.env` vẫn được hỗ trợ làm cấu hình dự phòng nếu muốn cố định cổng, lệnh AI Agent hoặc đường dẫn mặc định:

| Biến môi trường | Mặc định | Ý nghĩa / Mô tả |
| :--- | :--- | :--- |
| `PORT` | `3456` | Cổng HTTP Server sẽ lắng nghe |
| `HOST` | `localhost` | Host binding (`localhost` hoặc `0.0.0.0`) |
| `DOCS_DIR` | `./sample` | Đường dẫn dự phòng nếu chưa chọn thư mục trên UI |
| `NOTES_DIR` | `<currentDir>/.notes` | Thư mục lưu các ghi chú tạo từ web viewer |
| `AGENT_ENABLED` | `true` | Bật / tắt tính năng gọi AI Agent (`true`/`false`) |
| `AGENT_COMMAND` | `agy --continue --print` | Lệnh CLI kích hoạt AI Agent |
| `AUTO_OPEN` | `false` | Tự động mở trình duyệt khi chạy (`true`/`false`) |

---

### Chuyển đổi Markdown sang HTML tĩnh (`md2html`)

```bash
# Chuyển đổi toàn bộ tài liệu trong thư mục mặc định
npm run convert

# Chuyển đổi 1 file cụ thể và tự động mở trình duyệt
node md2html.mjs docs/API_Spec.md --open

# Chuyển đổi một thư mục chỉ định
node md2html.mjs ./docs
```

---

## 🤖 Tích hợp AI Agent hoạt động như thế nào?

1. Khi bạn duyệt tài liệu trên web, bôi đen một đoạn nội dung bất kỳ.
2. Popup ghi chú sẽ xuất hiện -> Nhập yêu cầu của bạn.
3. Nhấn **"Gửi Agent"**:
   - Hệ thống tự động tạo một file log ghi chú trong `<currentDir>/.notes/`.
   - Lệnh `AGENT_COMMAND` (mặc định `agy --continue --print`) được gọi ngầm dưới nền.
   - Quá trình suy luận và câu trả lời của Agent được **stream qua Server-Sent Events (SSE)** về khung chat nổi góc dưới màn hình.
   - Kết quả phản hồi cũng được tự động append vào file log để lưu vết.

---

## 📁 Cấu trúc thư mục

```text
md-live-server/
├── MD Live Server.app/          # macOS click-to-run Local App bundle
├── Start MD Live Server.command # macOS click-to-run Terminal launcher
├── Start MD Live Server.bat     # Windows click-to-run launcher
├── .env.example                 # File mẫu cấu hình biến môi trường (tùy chọn)
├── .gitignore                   # Danh sách file / thư mục bỏ qua khi commit
├── LICENSE                      # Giấy phép MIT
├── package.json                 # Định nghĩa package và dependencies
├── README.md                    # Tài liệu hướng dẫn sử dụng
├── md-server.mjs                # Core Web Server, Pickers, Drop & AI Agent engine
└── md2html.mjs                  # CLI Batch Converter Markdown -> Static HTML
```

---

## 📄 License

Dự án được phát hành dưới giấy phép [MIT](LICENSE).
Tác giả: **nhadaungocnay**

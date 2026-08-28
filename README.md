# 🚀 MD Live Server (`md-live-server`)

> **Live Markdown Documentation Server & Converter with Real-time Rendering, Highlight Annotation & AI Agent Integration.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Build](https://img.shields.io/badge/build-zero--step-orange.svg)]()

`md-live-server` là giải pháp gọn nhẹ, hiệu năng cao giúp bạn xem, tra cứu tài liệu Markdown (`.md`) trực tiếp trên trình duyệt theo thời gian thực mà không cần build, đồng thời tích hợp sẵn công cụ ghi chú và giao tiếp trực tiếp với **AI Agent (Google Antigravity, Claude Code, custom CLI)**.

---

## ✨ Tính năng nổi bật

- ⚡ **Live Markdown Preview**: Đọc và render Markdown trực tiếp ngay khi lưu file, không cần convert hay reload server.
- 📂 **Cây thư mục trực quan & Tìm kiếm nhanh**: Duyệt toàn bộ cấu trúc thư mục tài liệu với ô search filter thời gian thực.
- 📝 **Highlight-to-Note**: Bôi đen bất kỳ đoạn văn bản nào trên trang để mở popup ghi chú tức thì.
- 🤖 **Tích hợp AI Agent Streaming (SSE)**: Gửi đoạn trích + chỉ thị trực tiếp đến AI Agent (như `agy --continue --print`), phản hồi được stream về giao diện web theo thời gian thực.
- 💾 **Lưu trữ ghi chú tự động**: Mọi ghi chú và phản hồi từ AI Agent đều được lưu thành file `.md` trong thư mục `.notes/` để đối soát.
- 📄 **CLI Convert tĩnh (`md2html`)**: Đi kèm script convert Markdown sang HTML độc lập (standalone) không cần server.
- ⚙️ **Hỗ trợ `.env` & CLI Flags toàn diện**: Cấu hình linh hoạt qua file `.env` hoặc truyền tham số dòng lệnh.

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

## ⚙️ Cấu hình `.env`

Tạo file `.env` từ file mẫu `.env.example`:

```bash
cp .env.example .env
```

### Bảng biến môi trường hỗ trợ:

| Biến môi trường | Mặc định | Ý nghĩa / Mô tả |
| :--- | :--- | :--- |
| `PORT` | `3456` | Cổng HTTP Server sẽ lắng nghe |
| `HOST` | `localhost` | Host binding (`localhost` hoặc `0.0.0.0`) |
| `DOCS_DIR` | `./_workspace` | Đường dẫn thư mục chứa các file tài liệu Markdown |
| `NOTES_DIR` | `<DOCS_DIR>/.notes` | Thư mục lưu các ghi chú tạo từ web viewer |
| `AGENT_ENABLED` | `true` | Bật / tắt tính năng gọi AI Agent (`true`/`false`) |
| `AGENT_COMMAND` | `agy --continue --print` | Lệnh CLI kích hoạt AI Agent |

#### Ví dụ file `.env`:

```ini
PORT=3456
HOST=localhost
DOCS_DIR=./_workspace
AGENT_ENABLED=true
AGENT_COMMAND=agy --continue --print
```

---

## 🚀 Hướng dẫn sử dụng

### 1. Khởi động Web Server xem tài liệu trực tiếp

```bash
# Chạy với cấu hình trong .env
npm start

# Hoặc chạy ở chế độ dev (auto-reload khi code server thay đổi)
npm run dev
```

Truy cập trên trình duyệt: **`http://localhost:3456`**

#### Các tùy chọn dòng lệnh (CLI Options):

```bash
# Xem tài liệu trong thư mục cụ thể
node md-server.mjs ./docs

# Đổi cổng và host
node md-server.mjs -p 8080 -H 0.0.0.0

# Tắt tích hợp AI Agent
node md-server.mjs --no-agent

# Tùy chỉnh câu lệnh gọi AI Agent khác (ví dụ Claude CLI)
node md-server.mjs --agent-cmd "claude --continue"
```

---

### 2. Chuyển đổi Markdown sang HTML tĩnh (`md2html`)

Nếu bạn cần xuất tài liệu ra các file `.html` độc lập để gửi cho đối tác hoặc mở offline:

```bash
# Chuyển đổi toàn bộ tài liệu trong DOCS_DIR
npm run convert

# Chuyển đổi 1 file cụ thể và tự động mở trình duyệt
node md2html.mjs docs/API_Spec.md --open

# Chuyển đổi một thư mục chỉ định
node md2html.mjs ./docs
```

---

## 🤖 Tích hợp AI Agent hoạt động như thế nào?

1. Khi bạn duyệt tài liệu trên `http://localhost:3456`, bôi đen một đoạn nội dung (ví dụ: một lỗi logic, một yêu cầu nghiệp vụ cần sửa).
2. Popup ghi chú sẽ xuất hiện -> Nhập yêu cầu của bạn (ví dụ: *"Kiểm tra lại logic tính thuế này và cập nhật TASK-102"*).
3. Nhấn **"Gửi Agent"**:
   - Hệ thống tự động tạo một file log ghi chú trong `<DOCS_DIR>/.notes/`.
   - Lệnh `AGENT_COMMAND` (mặc định `agy --continue --print`) được gọi ngầm dưới nền.
   - Quá trình suy luận và câu trả lời của Agent được **stream qua Server-Sent Events (SSE)** về khung chat nổi góc dưới màn hình.
   - Kết quả phản hồi cũng được tự động append vào file log để lưu vết (provenance).

---

## 📁 Cấu trúc thư mục

```text
md-live-server/
├── .env.example         # File mẫu cấu hình biến môi trường
├── .env                 # File cấu hình biến môi trường cục bộ (không commit)
├── .gitignore           # Danh sách file / thư mục bỏ qua khi commit
├── LICENSE              # Giấy phép MIT
├── package.json         # Định nghĩa package và dependencies
├── README.md            # Tài liệu hướng dẫn sử dụng
├── md-server.mjs        # Core Web Server & AI Agent streaming engine
└── md2html.mjs          # CLI Batch Converter Markdown -> Static HTML
```

---

## 🛠️ Đóng góp & Phát triển

Mọi đóng góp, báo lỗi (Issues) và Pull Requests đều được hoan nghênh!
1. Fork repository
2. Tạo branch mới (`git checkout -b feature/amazing-feature`)
3. Commit thay đổi (`git commit -m 'feat: add amazing feature'`)
4. Push lên branch (`git push origin feature/amazing-feature`)
5. Tạo Pull Request

---

## 📄 License

Dự án được phát hành dưới giấy phép [MIT](LICENSE).
Tác giả: **nhadaungocnay**

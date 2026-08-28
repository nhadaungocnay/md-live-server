# 🏛️ Kiến trúc hệ thống (System Architecture)

Tài liệu này mô tả luồng hoạt động giữa **md-live-server**, **Trình duyệt (Client)** và **AI Agent Engine**.

---

## 🔄 Sơ đồ luồng xử lý (Workflow)

1. **User Request**: Người dùng truy cập `http://localhost:3456`.
2. **File Discovery**: Server quét toàn bộ thư mục `DOCS_DIR` (mặc định `./sample` hoặc `./docs`) và tạo cây thư mục.
3. **Real-time Parsing**: Nội dung Markdown được chuyển đổi tức thì thành HTML thông qua `marked`.
4. **Annotation Event**: Người dùng bôi đen văn bản và gửi yêu cầu.
5. **SSE Streaming**: Server gọi tiến trình Agent (ví dụ: `agy --continue --print`) và stream từng token về giao diện chat.
6. **Persistence**: Lưu toàn bộ lịch sử trao đổi vào thư mục `.notes/` dưới dạng file Markdown có timestamp.

---

## 🛠️ Cấu trúc thư mục ghi chú

```text
.notes/
├── 2026-08-28T11-00-00-000Z.md
└── 2026-08-28T11-15-30-500Z.md
```

> [!NOTE]
> Mọi ghi chú đều được định dạng chuẩn để các AI Agent khác có thể đọc lại context trong các phiên làm việc tiếp theo.

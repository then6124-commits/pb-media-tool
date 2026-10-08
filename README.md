# PB MEDIA (Tauri)

UI mới kiểu dark SaaS (gần SuperVeo), **không ghi đè** `K:\MUSE TOOL`.

## Thư mục

`K:\PB_MEDIA_TAURI`

## Toolchain hiện tại

| Tool | Trạng thái |
|------|------------|
| Node / npm | Có (đã dùng) |
| Rust (`rustc` / `cargo`) | **Chưa cài** |
| Visual Studio Build Tools (MSVC) | Cần cho `tauri build` trên Windows |

## Chạy UI ngay (trình duyệt)

```bat
cd /d "K:\PB_MEDIA_TAURI"
npm install
npm run dev
```

Mở http://localhost:1420

## Chạy thật (cầu nối Python) — 08/10/2026

`npm run dev` tự bật **`scripts/pb_bridge.py`** (cổng 1431); Vite chuyển `/api/*` sang đó.
Cầu nối import thẳng code của tool cũ `C:\Users\Admin\Downloads\PB_MEDIA_SRT_clean`
(đổi bằng biến `PB_TOOL_DIR`) — tài khoản, cookie, đúc reCAPTCHA dùng chung với tool cũ.

| Tab | Trạng thái | Code tool cũ được gọi |
|-----|-----------|------------------------|
| Vids | **Thật** | `google_vids_api.GoogleVidsClient.generate_video` |
| Tạo Ảnh | **Thật** | `image_gen.MediaBatch` mode `t2i` |
| Veo3 → Text To Video | **Thật** | `image_gen.MediaBatch` mode `auto` + `flow_api.VIDEO_BAC` |
| Veo3 → Image To Video | **Thật** | mode `i2v` + `flow_api.I2V_BAC` (ảnh đổi tên theo số cảnh) |
| Veo3 → Ingredients / Nhân vật | **Thật** | mode `chars` (ảnh đặt tên = @tag) |
| Veo3 → Video To Video, Omni | **Thật** | mode `v2v`, model `abra_edit`, ≤5 ảnh ref, giọng đọc |
| Veo3 → Script To Video | Giả lập | cần AI viết kịch bản — tool cũ không có |
| Muse | **Thật** | `K:\MUSE TOOL\muse_video.chay_hang` (Chrome `_ho_so_muse`, CDP 9341) |
| Tube Hunter | **Thật** | `yt-dlp ytsearch` + gợi ý tìm kiếm YouTube; nút Tải = `yt-dlp` |
| Upscale (nút ⇧ ở Vids/Tạo ảnh/Veo3, Auto Upscale) | **Thật** | `realesrgan` của thư mục SuperVeo + `ffmpeg` |
| Vẽ tay (nút ✍ / ô 🎨 Draw ở Tạo ảnh) | **Thật** | `scripts/draw_engine.py` (tự viết theo cách SuperVeo: stroke_reveal / outline_fill / object_place) |
| Grok, Seedance, Voice, Ghép Video… | Giả lập | — |

**Đúc token kiểu SuperVeo (08/10):** cầu nối nạp bộ mint 02/10 trong `scripts/flow_overlay`
(trước file tool cũ) và bật `CAPCUT_MINT_ABOUT=1` — đúc reCAPTCHA trên `flow.google.com/about`
bằng Chrome hồ sơ tạm, không qua tiện ích Cookie Flow. Tắt: `set PB_MINT_ABOUT=0`.
File tool cũ KHÔNG bị sửa.

File người dùng chọn được gửi lên cầu nối bằng `POST /api/upload?name=` (nhị phân), lưu ở
`%LOCALAPPDATA%\PBMedia\pb_bridge_refs\`. End Frame của Image To Video chưa hỗ trợ.

- Tài khoản: tick ở tool cũ (sổ `AccountPool`); cầu nối đọc lại mỗi lần chạy.
- Lưu mặc định: `Videos\PB_MEDIA\Vids\<dự án>`, `Videos\PB_MEDIA\Tao_anh`, `Videos\PB_MEDIA\Veo3`.
- Mỗi lúc chỉ 1 mẻ Flow (Tạo ảnh **hoặc** Veo3) — hai mẻ tranh nhau Chrome đúc token.
- **Đừng mở tool cũ cùng lúc**: cả hai cùng nghe cổng tiện ích Cookie Flow (17361 / 3456).
- Kiểm tra nhanh: http://localhost:1420/api/health · nhật ký: http://localhost:1420/api/logs

## Chạy cửa sổ desktop (Tauri)

1. Cài Rust: https://rustup.rs → `rustup-init.exe`
2. Cài **Visual Studio Build Tools** + workload “Desktop development with C++”
WebView2 thường đã có trên Windows 10/11
3. Rồi:

```bat
cd /d "K:\PB_MEDIA_TAURI"
npm install
npm run tauri:dev
```

Build release:

```bat
npm run tauri:build
```

## SuperVeo — tái sử dụng?

**Được (ý tưởng / pattern công khai):** bố cục dark SaaS, sidebar + tab, bảng job, accent xanh-tím, nhãn tiếng Việt giống MUSE TOOL.

**Không copy:** `SuperVeo.exe`, script sidecar/enc, binary ffmpeg/node helper, model realesrgan, pen-presets, watermark code, bất kỳ JS/CSS nhúng trong exe. UI app nằm trong binary Tauri — không tách/sao chép.

Repo này **tự thiết kế** theme/layout, không lấy source SuperVeo.

## Bước tiếp

- Nối Muse CDP / bridge từ MUSE TOOL Python sang lệnh Tauri
- License / cập nhật (port từ Python)
- Icon chính thức: thay `src-tauri/icons/*` và chạy `npm run tauri icon path\to\logo.png`

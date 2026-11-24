# Good Docs v5.5 — GitHub Pages + Google Apps Script + Google Sheets

Website frontend chạy **trên GitHub Pages**, Google Sheets là database, Apps Script là API trung gian. Không cần OAuth Client ID trên frontend, không cần đăng nhập Google khi sử dụng Good Docs.

> **CẢNH BÁO BẢO MẬT NGHIÊM TRỌNG:** Web app chạy `Execute as: Me` và `Who has access: Anyone` nên ai có endpoint cũng có thể đọc, sửa hoặc xóa TOÀN BỘ dữ liệu. URL trong `config.js` là công khai, không phải mật khẩu. Chỉ sử dụng cho thông tin hoàn toàn công khai/không nhạy cảm. Không dùng để lưu mật khẩu, thông tin cá nhân, tài liệu bí mật. Tạo bảng tính Google riêng chỉ chứa Good Docs, không chia sẻ các dữ liệu khác.

## Cấu trúc

```
Good-Docs-v5-GitHub-Pages/
├── index.html             # Frontend GitHub Pages
├── style.css              # Dark Mode / mobile
├── app.js                 # Notes, Dictionary, autosave
├── sheets.js              # JSONP read + hidden-form POST + receipt polling
├── config.js              # Chỉ chứa URL Apps Script /exec
├── apps-script/
│   └── Code.gs            # Backend dán vào Google Apps Script
└── README.md
```

## Bước 1 — Tạo Google Sheets

1. Tạo bảng tính mới trên https://sheets.google.com, đặt tên **Good Docs Database**.
2. Mở bảng tính, vào **Extensions → Apps Script** (Tiện ích mở rộng → Apps Script). Cách này tạo script gắn với bảng tính, `SpreadsheetApp.getActiveSpreadsheet()` sẽ truy cập đúng bảng.
3. Sao chép **toàn bộ** nội dung `apps-script/Code.gs` vào file `Code.gs` trong Apps Script, bấm **Save**.
4. Trong trình soạn thảo Apps Script, chọn hàm `gdInit_` và bấm Run để tạo các sheet nếu được phép, sau đó cấp quyền Google. Nếu trình soạn thảo không cho chạy hàm có `_` cuối tên, tạo một hàm `function setup(){gdInit_();}` tạm thời rồi Run `setup`.
5. Các sheet `Settings`, `Data_A`, `Data_B`, `Dictionary_A`, `Dictionary_B` cũng được tự tạo khi request đầu tiên tới web app.

## Bước 2 — Deploy Apps Script API

1. Trong Apps Script chọn **Deploy → New deployment → Web app**.
2. `Execute as`: **Me**.
3. `Who has access`: **Anyone**.
4. Bấm **Deploy**, cấp quyền và lấy URL `https://script.google.com/macros/s/.../exec`.
5. Mở URL `/exec` trên Chrome/Edge. Khi không có `action` và `callback`, trang có thể hiển thị `Invalid callback`; điều đó bình thường, KHÔNG phải lỗi. Trình duyệt sẽ sử dụng URL này khi gọi API.

**Khi sửa `Code.gs` về sau:** Deploy → Manage deployments → Edit (biểu tượng bút chì) → Version: New version → Deploy. Việc chỉ nhấn Save trong Apps Script không tự cập nhật Web app version `/exec`.

## Bước 3 — Điền config.js

Sửa file `config.js` trong thư mục frontend:

```js
window.GOODDOCS_CONFIG = Object.freeze({
  webAppUrl: "https://script.google.com/macros/s/XXXXX/exec"
});
```

Không sử dụng URL `/dev`, phải dùng URL `/exec`. Không cần OAuth Client ID hoặc Spreadsheet ID trong frontend.

## Bước 4 — Deploy frontend lên GitHub Pages

1. Upload **5 file tại thư mục gốc**: `index.html`, `style.css`, `app.js`, `sheets.js`, `config.js`. Không upload Apps Script backend lên Pages để mong backend chạy; `Code.gs` phải được dán vào Apps Script.
2. Repo → Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save.
3. Mở `https://USERNAME.github.io/REPOSITORY/`. Trang tự động gọi Apps Script khi tải, không cần đăng nhập Google.
4. Tạo thử tab, nhập nội dung, đợi trạng thái **Đã lưu vào Google Sheets ✓**, F5 rồi kiểm tra.
5. Mở Chrome/Edge khác để kiểm tra. Vì endpoint là public, không có đăng nhập nào ngăn người lạ sử dụng cùng dữ liệu.

## Kiểm tra API (không cần đăng nhập)

Bạn có thể mở trực tiếp:

```
https://script.google.com/macros/s/XXXXX/exec?action=meta&callback=GoodDocsCallbacks.test
```

Kết quả trả về JavaScript dạng `GoodDocsCallbacks.test({"ok":true,"meta":...});`. Đây là JSONP, không phải JSON thuần. Nếu báo `Sorry, unable to open the file...`, hãy kiểm tra Apps Script deployment và chế độ Anyone.

## Cơ chế đọc / ghi và xử lý 50.000 ký tự / ô

- **Đọc dữ liệu:** sử dụng JSONP `doGet`, tránh lỗi CORS khi website GitHub Pages lấy kết quả từ Apps Script.
- **Ghi dữ liệu:** submit biểu mẫu HTML POST vào iframe ẩn, `doPost` ghi lên Google Sheets. Trình duyệt **không thể đọc trực tiếp phản hồi iframe**; `sheets.js` truy vấn `doGet?action=receipt` để chỉ xác nhận sau khi server ghi hoàn tất.
- Snapshot của Notes và Dictionary được mã hóa UTF-8 → Base64 và chia thành nhiều phần mỗi ô tối đa **30.000 ký tự** trong sheet `Data_A`/`Data_B`, thấp hơn 50.000 ký tự mỗi ô.
- `Dictionary_A`/`Dictionary_B` có hai cột đầu English / Tiếng Việt để tiện xem bằng Google Sheets. Hai sheet là các bản luân phiên (active/inactive); dữ liệu JSON snapshot mới là nguồn dữ liệu chính.
- Kiểm tra `revision` được thực hiện trong `LockService` ở backend để phát hiện ghi đè đồng thời. Bản trước vẫn còn trong slot còn lại (chỉ giữ tối đa một bản trước).
- Phiên bản mẫu giới hạn mỗi lần lưu tối đa **1.200.000 ký tự Base64** (khoảng 900KB nhị phân trước mã hóa), 250 Notes, 5.000 từ. Giới hạn này có thể điều chỉnh nhưng Apps Script/Sheets có quota và thời gian xử lý thực tế; đây không phải hệ thống lưu tài liệu lớn vô hạn.
- Dùng **Xuất JSON** để sao lưu định kỳ. Nếu thấy xung đột, xuất JSON trước rồi tải lại.

## Lưu ý quan trọng

- Script `Anyone + Execute as Me` là **API không xác thực**. Người lạ có thể lấy URL từ mã nguồn GitHub Pages và gửi POST trực tiếp. Đừng coi ẩn nút hay giấu URL là cơ chế bảo mật.
- JSONP cũng cho phép các website khác đọc API. Nó chỉ phù hợp khi bạn chấp nhận dữ liệu công khai.
- Khi endpoint hoặc quota bị chặn, hoặc Apps Script hết quota, Good Docs có thể không tải hoặc lưu được; GitHub Pages vẫn có thể tải giao diện.
- Cách POST form/iframe + JSONP polling được thiết kế để né giới hạn CORS thông thường, nhưng chưa được kiểm chứng với deployment thật của bạn; nếu Google thay đổi hành vi redirect/sandbox có thể cần điều chỉnh.
- Ứng dụng đồng bộ khi mở trang và khi bấm Tải lại; không có cộng tác thời gian thực. Tránh nhiều trình duyệt chỉnh sửa song song.
- **Không cần upload folder `apps-script` lên GitHub Pages** để chạy website. Bạn có thể lưu nó trong repo để quản lý phiên bản, nhưng cần cập nhật Apps Script deployment riêng.

## Nguồn tài liệu chính thức

- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/content#serving_jsonp_in_web_pages
- https://developers.google.com/apps-script/guides/services/quotas

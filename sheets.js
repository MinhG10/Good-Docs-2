
/*
 * =========================================================
 * GOOD DOCS v5.1 - GOOGLE SHEETS CONNECTION
 * =========================================================
 *
 * Architecture:
 * GitHub Pages -> Google Apps Script -> Google Sheets
 *
 * Authentication:
 * Public Apps Script Web App, no Google OAuth.
 *
 * READ:
 * JSONP requests through Apps Script doGet().
 *
 * WRITE:
 * Hidden HTML form POST to Apps Script doPost().
 * Poll request receipt via JSONP to confirm save result.
 *
 * IMPORTANT:
 * Public API means anyone with endpoint access may be
 * able to read, modify or delete the stored data.
 * Do not store sensitive information in Good Docs.
 */

'use strict';

window.GoodDocsCloud = (() => {

  const CFG = window.GOODDOCS_CONFIG || {};

  const CALLBACKS = window.GoodDocsCallbacks = {};

  let counter = 0;

  const TIMEOUT = 25000;

  const MAX_PAYLOAD_LENGTH = 1200000;


  /* =====================================================
     1. VALIDATE CONFIGURATION
     ===================================================== */

  function validate() {
    const url = String(
      CFG.webAppUrl || ''
    ).trim();

    const pattern =
      /^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/;

    if (!pattern.test(url)) {
      throw new Error(
        'Hãy điền URL Google Apps Script Web App /exec trong config.js.'
      );
    }

    return url;
  }


  /* =====================================================
     2. JSONP REQUEST
     ===================================================== */

  function jsonp(params, timeout = TIMEOUT) {

    const base = validate();

    const key = 'cb_' + (++counter);

    return new Promise((resolve, reject) => {

      const script = document.createElement('script');

      let settled = false;
      let timer;

      function finish(error, value) {

        if (settled) return;

        settled = true;

        clearTimeout(timer);

        delete CALLBACKS[key];

        script.remove();

        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      }

      CALLBACKS[key] = payload => {
        finish(null, payload);
      };

      const query = new URLSearchParams({
        ...params,
        callback: 'GoodDocsCallbacks.' + key,
        _: String(Date.now())
      });

      timer = setTimeout(() => {
        finish(
          new Error(
            'API không phản hồi. Kiểm tra URL /exec, quyền Anyone và kết nối mạng.'
          )
        );
      }, timeout);

      script.onerror = () => {
        finish(
          new Error(
            'Không tải được Google Apps Script API. Kiểm tra quyền Anyone.'
          )
        );
      };

      script.src = base + '?' + query.toString();

      document.head.appendChild(script);
    });
  }


  /* =====================================================
     3. CHECK API RESPONSE
     ===================================================== */

  function check(result) {

    if (!result?.ok) {

      const message =
        result?.error ||
        'Google Apps Script trả về lỗi không xác định.';

      const error = new Error(message);

      error.conflict =
        !!result?.conflict ||
        String(message).startsWith('CONFLICT:');

      throw error;
    }

    return result;
  }


  /* =====================================================
     4. CONNECTION
     ===================================================== */

  async function connect() {

    validate();

    return true;
  }

  async function meta() {

    const response = await jsonp({
      action: 'meta'
    });

    return check(response).meta;
  }


  /* =====================================================
     5. UTF-8 / BASE64 ENCODING
     ===================================================== */

  function utf8ToBase64(text) {

    const bytes = new TextEncoder().encode(
      String(text)
    );

    const parts = [];

    const blockSize = 8192;

    for (
      let i = 0;
      i < bytes.length;
      i += blockSize
    ) {

      const block = bytes.subarray(
        i,
        i + blockSize
      );

      parts.push(
        String.fromCharCode(...block)
      );
    }

    return btoa(parts.join(''));
  }

  function base64ToUtf8(base64) {

    const binary = atob(base64);

    const bytes = new Uint8Array(
      binary.length
    );

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new TextDecoder(
      'utf-8',
      { fatal: true }
    ).decode(bytes);
  }


  /* =====================================================
     6. NORMALIZE DATA
     ===================================================== */

  function normalizeState(state) {

    if (
      !state ||
      !Array.isArray(state.notes) ||
      !Array.isArray(state.dictionary)
    ) {
      throw new Error(
        'Dữ liệu Google Sheets không hợp lệ.'
      );
    }

    return {

      notes: state.notes,

      // Compatibility with Good Docs v5.0.
      folders: Array.isArray(state.folders)
        ? state.folders
        : [],

      dictionary: state.dictionary
    };
  }


  /* =====================================================
     7. LOAD DATA FROM GOOGLE SHEETS
     ===================================================== */

  async function load() {

    // Retry once when data changes during loading.
    for (
      let attempt = 0;
      attempt < 2;
      attempt++
    ) {

      const head = await meta();

      // Empty database.
      if (!head.chunks) {

        return {

          notes: [],
          folders: [],
          dictionary: [],
          revision: head.revision
        };
      }

      const parts = new Array(
        head.chunks
      );

      // Limit simultaneous requests.
      let next = 0;

      async function worker() {

        while (next < head.chunks) {

          const index = next++;

          const response = check(
            await jsonp({

              action: 'chunk',

              slot: head.slot,

              revision: String(
                head.revision
              ),

              index: String(index)
            })
          );

          // Detect snapshot changes.
          if (
            response.index !== index ||
            response.revision !== head.revision
          ) {

            throw new Error(
              'Snapshot changed; reload.'
            );
          }

          parts[index] = response.data;
        }
      }

      try {

        const workers = Math.min(
          4,
          head.chunks
        );

        await Promise.all(
          Array.from(
            { length: workers },
            () => worker()
          )
        );

        // Verify revision after reading.
        const verify = await meta();

        if (
          verify.revision !== head.revision ||
          verify.slot !== head.slot
        ) {
          continue;
        }

        const encoded = parts.join('');

        const decoded = base64ToUtf8(
          encoded
        );

        const parsed = JSON.parse(
          decoded
        );

        const state = normalizeState(
          parsed
        );

        return {

          notes: state.notes,

          folders: state.folders,

          dictionary: state.dictionary,

          revision: head.revision
        };

      } catch (error) {

        const changed =
          String(error.message)
            .includes('Snapshot changed');

        if (changed && attempt === 0) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      'Dữ liệu thay đổi trong lúc tải. Hãy thử lại.'
    );
  }


  /* =====================================================
     8. POST DATA USING HIDDEN FORM
     ===================================================== */

  function postForm(fields) {

    const id =
      'gooddocs_post_' +
      Math.random()
        .toString(36)
        .slice(2);

    const iframe = document.createElement(
      'iframe'
    );

    iframe.name = id;

    iframe.title = 'Good Docs Save';

    iframe.style.display = 'none';

    const form = document.createElement(
      'form'
    );

    form.action = validate();

    form.method = 'POST';

    form.target = id;

    form.style.display = 'none';

    for (
      const [name, value] of Object.entries(fields)
    ) {

      const input = document.createElement(
        'input'
      );

      input.type = 'hidden';

      input.name = name;

      input.value = String(value);

      form.appendChild(input);
    }

    document.body.append(
      iframe,
      form
    );

    try {

      form.submit();

    } catch (error) {

      form.remove();
      iframe.remove();

      throw error;
    }

    // The cross-origin iframe response cannot be read.
    // Receipt polling is required for confirmation.

    return () => {

      form.remove();

      iframe.remove();
    };
  }


  /* =====================================================
     9. SAVE DATA TO GOOGLE SHEETS
     ===================================================== */

  async function save(
    state,
    expectedRevision
  ) {

    // Validate data.
    if (
      !state ||
      !Array.isArray(state.notes) ||
      !Array.isArray(state.folders) ||
      !Array.isArray(state.dictionary)
    ) {

      throw new Error(
        'Dữ liệu không hợp lệ: thiếu notes, folders hoặc dictionary.'
      );
    }

    // Serialize all application data.
    const snapshot = {

      notes: state.notes,

      folders: state.folders,

      dictionary: state.dictionary
    };

    const json = JSON.stringify(
      snapshot
    );

    const payload = utf8ToBase64(
      json
    );

    if (
      payload.length > MAX_PAYLOAD_LENGTH
    ) {

      throw new Error(
        'Dữ liệu vượt giới hạn lưu trữ của Good Docs v5.1 (1,2 triệu ký tự Base64).'
      );
    }

    const requestId =
      'req_' +
      Date.now() +
      '_' +
      Math.random()
        .toString(36)
        .slice(2);

    const cleanup = postForm({

      action: 'save',

      requestId,

      expectedRevision,

      payload
    });

    const start = Date.now();

    try {

      // Wait for backend receipt.
      while (
        Date.now() - start < 95000
      ) {

        await new Promise(resolve => {
          setTimeout(resolve, 1400);
        });

        let result;

        try {

          result = await jsonp({

            action: 'receipt',

            id: requestId
          });

        } catch (error) {

          // Temporary network failure.
          // Continue polling instead of claiming failure.
          continue;
        }

        if (result?.pending) {
          continue;
        }

        return check(result).revision;
      }

      // Receipt might be lost even after successful save.
      // Check backend metadata before reporting failure.

      const head = await meta();

      if (
        head.lastRequestId === requestId
      ) {

        return head.revision;
      }

      throw new Error(
        'Không xác nhận được kết quả lưu. Hãy kiểm tra dữ liệu Google Sheets trước khi tiếp tục chỉnh sửa.'
      );

    } finally {

      cleanup();
    }
  }


  /* =====================================================
     10. PUBLIC API
     ===================================================== */

  return {

    connect,

    load,

    save,

    // Compatibility with older app.js versions.
    hasToken: () => true
  };

})();

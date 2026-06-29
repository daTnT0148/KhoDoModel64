/**
 * db.js — Lớp lưu trữ dữ liệu
 * Thay thế localStorage bằng Google Sheets qua Google Apps Script Web App.
 *
 * HƯỚNG DẪN THIẾT LẬP:
 * 1. Tạo file env.js (xem env.js mẫu) với APPS_SCRIPT_URL và SECRET_KEY thật
 * 2. File env.js đã được .gitignore — không bao giờ lên GitHub
 * 3. Mỗi thiết bị cần có file env.js riêng
 */

// Đọc từ env.js (không hardcode URL ở đây để tránh lộ lên GitHub)
const APPS_SCRIPT_URL = (window.ENV && window.ENV.APPS_SCRIPT_URL) || "";
const API_SECRET_KEY  = (window.ENV && window.ENV.SECRET_KEY)       || "";

// ─── Kiểm tra đã cấu hình chưa ───────────────────────────────────────────────

function isCloudConfigured() {
  return APPS_SCRIPT_URL && APPS_SCRIPT_URL.trim() !== "";
}

// ─── Hiển thị trạng thái kết nối ─────────────────────────────────────────────

function showSyncStatus(status, message) {
  let el = document.getElementById("syncStatus");
  if (!el) {
    el = document.createElement("div");
    el.id = "syncStatus";
    el.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 9999;
      padding: 8px 16px; border-radius: 8px; font-size: 13px;
      font-family: var(--font-family, sans-serif);
      display: flex; align-items: center; gap: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: opacity 0.3s;
    `;
    document.body.appendChild(el);
  }

  const styles = {
    syncing: { bg: "#1e3a5f", color: "#60a5fa", icon: "⏳" },
    success: { bg: "#14532d", color: "#4ade80", icon: "✓"  },
    error:   { bg: "#450a0a", color: "#f87171", icon: "✗"  },
    offline: { bg: "#1c1917", color: "#a8a29e", icon: "⚡" }
  };

  const s = styles[status] || styles.offline;
  el.style.background = s.bg;
  el.style.color = s.color;
  el.innerHTML = `<span>${s.icon}</span><span>${message}</span>`;
  el.style.opacity = "1";

  if (status === "success") {
    setTimeout(() => { el.style.opacity = "0"; }, 2500);
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function apiPost(action, data) {
  if (!isCloudConfigured()) {
    // Fallback về localStorage
    saveStateToLocalStorage();
    return { ok: true, local: true };
  }

  showSyncStatus("syncing", "Đang đồng bộ...");
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Apps Script yêu cầu text/plain để tránh preflight
      body: JSON.stringify({ action, data, key: API_SECRET_KEY })
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    showSyncStatus("success", "Đã lưu lên Cloud ✓");
    // Luôn lưu localStorage song song làm cache offline
    saveStateToLocalStorage();
    return json;
  } catch (err) {
    console.error("[Cloud] POST error:", err);
    showSyncStatus("error", "Lỗi đồng bộ — đã lưu Local");
    saveStateToLocalStorage();
    return { ok: false, error: err.message };
  }
}

async function apiGet() {
  if (!isCloudConfigured()) return null;

  showSyncStatus("syncing", "Đang tải dữ liệu...");
  try {
    const url = APPS_SCRIPT_URL + "?action=getAllData&key=" + encodeURIComponent(API_SECRET_KEY) + "&t=" + Date.now();
    const res  = await fetch(url);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    showSyncStatus("success", "Đã tải từ Cloud ✓");
    return json;
  } catch (err) {
    console.error("[Cloud] GET error:", err);
    showSyncStatus("offline", "Offline — dùng dữ liệu Local");
    return null;
  }
}

// ─── Load dữ liệu khi mở app ─────────────────────────────────────────────────

async function loadData() {
  // Luôn load localStorage trước để hiển thị ngay lập tức (không chờ network)
  loadStateFromLocalStorage();

  if (!isCloudConfigured()) {
    showSyncStatus("offline", "Chế độ Local (chưa cấu hình Cloud)");
    setTimeout(() => {
      const el = document.getElementById("syncStatus");
      if (el) el.style.opacity = "0";
    }, 3000);
    return;
  }

  const cloudData = await apiGet();
  if (!cloudData) return; // Offline — dữ liệu localStorage đã được load

  // Merge cloud data vào state
  state.portfolios        = cloudData.portfolios;
  state.activePortfolioId = cloudData.activePortfolioId;
  state.transactions      = cloudData.transactions;
  state.currency          = cloudData.currency;
  if (cloudData.feeSettings) state.feeSettings = cloudData.feeSettings;

  if (typeof window.migrateLegacySKUs === "function") {
    const changedPortfolios = window.migrateLegacySKUs();
    // Nếu có portfolio nào bị đổi SKU → sync ngược lên Google Sheets
    if (Array.isArray(changedPortfolios) && changedPortfolios.length > 0 && isCloudConfigured()) {
      console.log("[SKU Migrate] Portfolios đổi SKU:", changedPortfolios);
      changedPortfolios.forEach(pId => {
        dbReplaceTransactions(pId, state.transactions[pId]);
      });
    }
  }

  // Cập nhật localStorage cache
  saveStateToLocalStorage();
}

// ─── Các hàm ghi — thay thế saveStateToLocalStorage() ───────────────────────

function dbSaveTransaction(tx) {
  return apiPost("saveTransaction", {
    ...tx,
    portfolioId: state.activePortfolioId
  });
}

function dbUpdateTransaction(tx) {
  return apiPost("updateTransaction", {
    ...tx,
    portfolioId: state.activePortfolioId
  });
}

function dbDeleteTransaction(txId) {
  return apiPost("deleteTransaction", { id: txId });
}

function dbSavePortfolio(portfolio) {
  return apiPost("savePortfolio", portfolio);
}

function dbDeletePortfolio(portfolioId) {
  return apiPost("deletePortfolio", { id: portfolioId });
}

function dbSaveSettings() {
  return apiPost("saveSettings", {
    currency:          state.currency,
    activePortfolioId: state.activePortfolioId,
    feeSettings:       state.feeSettings
  });
}

function dbReplaceTransactions(portfolioId, transactions) {
  return apiPost("replaceTransactions", { portfolioId, transactions });
}

// ─── IMAGE OPTIMIZE + UPLOAD lên Google Drive ────────────────────────────────

/**
 * Resize ảnh về tối đa 300x300, convert sang WEBP, giảm quality cho đến khi < 100KB.
 * @param {File} file
 * @returns {Promise<{blob: Blob, originalSize: number, optimizedSize: number, fileName: string}>}
 */
async function optimizeImage(file) {
  const MAX_DIM     = 300;
  const TARGET_SIZE = 100 * 1024; // 100KB
  const originalSize = file.size;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      // Tính kích thước mới giữ tỷ lệ
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width >= height) {
          height = Math.round((height / width) * MAX_DIM);
          width  = MAX_DIM;
        } else {
          width  = Math.round((width / height) * MAX_DIM);
          height = MAX_DIM;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Thử với quality 0.75 trước, nếu vẫn > 100KB thì giảm dần
      const tryExport = (quality) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Canvas toBlob thất bại")); return; }

          const optimizedSize = blob.size;
          console.log(`[Image Optimize] Gốc: ${(originalSize/1024).toFixed(1)}KB | Sau: ${(optimizedSize/1024).toFixed(1)}KB | Quality: ${quality} | ${width}x${height}px`);

          if (optimizedSize > TARGET_SIZE && quality > 0.15) {
            // Giảm quality thêm 0.1 và thử lại
            tryExport(Math.round((quality - 0.1) * 10) / 10);
          } else {
            const baseName = file.name.replace(/\.[^.]+$/, "");
            resolve({
              blob,
              originalSize,
              optimizedSize,
              fileName: baseName + ".webp"
            });
          }
        }, "image/webp", quality);
      };

      tryExport(0.75);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Không load được ảnh"));
    };

    img.src = objectUrl;
  });
}

/**
 * Upload file ảnh lên Google Drive qua Apps Script.
 * Tự động resize 300x300, convert WEBP, giảm quality đến < 100KB trước khi upload.
 * @param {File} file - File object từ input[type=file]
 * @param {string} oldFileId - fileId cũ để xóa khi đổi ảnh (optional)
 * @returns {Promise<{ok, fileId, imageUrl, fileName} | null>}
 */
async function dbUploadImage(file, oldFileId = "") {
  if (!isCloudConfigured()) return null;

  showSyncStatus("syncing", "Đang tối ưu ảnh...");

  let optimized;
  try {
    optimized = await optimizeImage(file);
    console.log(`[Image Optimize] ✓ ${optimized.fileName} | ${(optimized.originalSize/1024).toFixed(1)}KB → ${(optimized.optimizedSize/1024).toFixed(1)}KB`);
  } catch (err) {
    console.error("[Image Optimize] Lỗi:", err);
    showSyncStatus("error", "Lỗi tối ưu ảnh: " + err.message);
    return null;
  }

  showSyncStatus("syncing", "Đang upload ảnh...");

  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];

        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "uploadImage",
            key: API_SECRET_KEY,
            data: {
              base64:    base64,
              mimeType:  "image/webp",
              fileName:  optimized.fileName,
              oldFileId: oldFileId
            }
          })
        });

        const json = await res.json();

        if (json.error) {
          showSyncStatus("error", "Upload thất bại: " + json.error);
          resolve(null);
        } else {
          showSyncStatus("success", "Đã upload ảnh ✓");
          resolve(json);
        }

      } catch (err) {
        console.error("[Cloud] Upload error:", err);
        showSyncStatus("error", "Lỗi upload ảnh");
        resolve(null);
      }
    };

    reader.onerror = () => {
      showSyncStatus("error", "Không đọc được file ảnh");
      resolve(null);
    };

    reader.readAsDataURL(optimized.blob);
  });
}
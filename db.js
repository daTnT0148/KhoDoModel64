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

// ─── Offline sync queue (pendingOps) ─────────────────────────────────────────
// Stores writes that failed to reach the cloud so they can be replayed later,
// instead of being silently dropped once the tab is closed.
const PENDING_OPS_KEY = "model_car_pending_ops";

function loadPendingOps() {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("[Sync Queue] Failed to read pending ops, resetting queue", e);
    return [];
  }
}

function savePendingOps(ops) {
  localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(ops));
}

function enqueuePendingOp(action, data) {
  const ops = loadPendingOps();
  ops.push({
    id: "op-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    action,
    data,
    ts: Date.now()
  });
  savePendingOps(ops);
}

// Replays every queued op against the cloud, in original order, keeping whatever
// still fails in the queue (order preserved) so nothing is lost or duplicated.
async function flushPendingOps() {
  if (!isCloudConfigured()) return;
  const ops = loadPendingOps();
  if (ops.length === 0) return;

  showSyncStatus("syncing", `Đang đồng bộ ${ops.length} thao tác đang chờ...`);
  const remaining = [];
  for (const op of ops) {
    try {
      await rawApiPost(op.action, op.data);
    } catch (err) {
      console.error("[Sync Queue] Replay failed, will retry later:", op.action, err);
      remaining.push(op);
    }
  }
  savePendingOps(remaining);

  if (remaining.length === 0) {
    showSyncStatus("success", "Đã đồng bộ toàn bộ thao tác chờ ✓");
  } else {
    showSyncStatus("error", `Còn ${remaining.length} thao tác chưa đồng bộ được`);
  }
}

// Retry automatically when the browser regains connectivity
window.addEventListener("online", () => {
  console.log("[Sync Queue] Back online, flushing pending ops");
  flushPendingOps();
});

// ─── API calls ────────────────────────────────────────────────────────────────

// Core network call, no fallback/queueing — used both by apiPost() and flushPendingOps()
// so a replayed op goes through the exact same path as a live one.
async function rawApiPost(action, data) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // Apps Script yêu cầu text/plain để tránh preflight
    body: JSON.stringify({ action, data, key: API_SECRET_KEY })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function apiPost(action, data) {
  if (!isCloudConfigured()) {
    // Fallback về localStorage
    saveStateToLocalStorage();
    return { ok: true, local: true };
  }

  showSyncStatus("syncing", "Đang đồng bộ...");
  try {
    const json = await rawApiPost(action, data);
    showSyncStatus("success", "Đã lưu lên Cloud ✓");
    // Luôn lưu localStorage song song làm cache offline
    saveStateToLocalStorage();
    return json;
  } catch (err) {
    console.error("[Cloud] POST error:", err);
    // Network/API failure — queue the op instead of dropping it, so it retries once back online
    enqueuePendingOp(action, data);
    showSyncStatus("error", "Mất mạng — đã lưu Local, sẽ tự đồng bộ khi có mạng");
    saveStateToLocalStorage();
    return { ok: false, queued: true, error: err.message };
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

// ─── Reconciliation helpers (local vs cloud, id-based) ───────────────────────

// Which transaction ids currently have an unconfirmed write sitting in the queue.
// Anything in here means "cloud has not seen this change yet" — the merge must not
// let a stale cloud copy overwrite it.
function getPendingTxTouchedIds() {
  const ops = loadPendingOps();
  const saveIds = new Set();
  const deleteIds = new Set();
  const replacePortfolioIds = new Set();

  ops.forEach(op => {
    if ((op.action === "saveTransaction" || op.action === "updateTransaction") && op.data && op.data.id) {
      saveIds.add(op.data.id);
    } else if (op.action === "deleteTransaction" && op.data && op.data.id) {
      deleteIds.add(op.data.id);
    } else if (op.action === "replaceTransactions" && op.data && op.data.portfolioId) {
      replacePortfolioIds.add(op.data.portfolioId);
    }
  });

  return { saveIds, deleteIds, replacePortfolioIds };
}

// Merge one portfolio's local + cloud transaction arrays into a single reconciled array.
// Rules (safety over strictness):
//   - a pending delete always wins → the id is dropped, even if cloud still has it
//   - a pending save/update always wins → keep the local copy, ignore cloud's version
//   - present on both sides → prefer whichever has the newer updatedAt (cloud if unknown)
//   - present locally only (no pending op explains it) → KEEP IT, never silently drop
//   - present on cloud only → adopt it (another device/session created it)
function reconcileTransactions(localTxs, cloudTxs, pending) {
  const localMap = new Map((localTxs || []).map(t => [t.id, t]));
  const cloudMap = new Map((cloudTxs || []).map(t => [t.id, t]));
  const allIds = new Set([...localMap.keys(), ...cloudMap.keys()]);
  const result = [];

  allIds.forEach(id => {
    if (pending.deleteIds.has(id)) return; // honor the not-yet-synced local delete

    if (pending.saveIds.has(id)) {
      if (localMap.has(id)) result.push(localMap.get(id));
      return;
    }

    const localTx = localMap.get(id);
    const cloudTx = cloudMap.get(id);

    if (localTx && cloudTx) {
      const localTime = Number(localTx.updatedAt || 0);
      const cloudTime = Number(cloudTx.updatedAt || 0);
      result.push(localTime > cloudTime ? localTx : cloudTx);
    } else if (localTx) {
      result.push(localTx); // data-safety: never drop a local-only record silently
    } else {
      result.push(cloudTx);
    }
  });

  return result;
}

// Merge cloud data into the in-memory state IN PLACE. Never assigns state.transactions/
// state.portfolios wholesale from cloud — always reconciles id by id.
function mergeStateFromCloud(cloudData) {
  if (!cloudData) return;

  const pendingTx = getPendingTxTouchedIds();
  const ops = loadPendingOps();
  const pendingPortfolioSaveIds = new Set(
    ops.filter(op => op.action === "savePortfolio" && op.data && op.data.id).map(op => op.data.id)
  );
  const pendingPortfolioDeleteIds = new Set(
    ops.filter(op => op.action === "deletePortfolio" && op.data && op.data.id).map(op => op.data.id)
  );
  const hasPendingSettings = ops.some(op => op.action === "saveSettings");

  // --- Portfolios ---
  if (Array.isArray(cloudData.portfolios)) {
    const localMap = new Map((state.portfolios || []).map(p => [p.id, p]));
    const cloudMap = new Map(cloudData.portfolios.map(p => [p.id, p]));
    const allIds = new Set([...localMap.keys(), ...cloudMap.keys()]);
    const merged = [];

    allIds.forEach(id => {
      if (pendingPortfolioDeleteIds.has(id)) return;
      if (pendingPortfolioSaveIds.has(id)) {
        if (localMap.has(id)) merged.push(localMap.get(id));
        return;
      }
      if (cloudMap.has(id)) {
        merged.push(cloudMap.get(id)); // no pending edit — cloud is the confirmed copy
      } else if (localMap.has(id)) {
        merged.push(localMap.get(id)); // data-safety: keep local-only portfolio
      }
    });

    if (merged.length > 0) state.portfolios = merged;
  }

  // --- Transactions, reconciled per portfolio ---
  if (cloudData.transactions) {
    if (!state.transactions) state.transactions = {};
    const allPortfolioIds = new Set([
      ...Object.keys(state.transactions),
      ...Object.keys(cloudData.transactions)
    ]);

    allPortfolioIds.forEach(pid => {
      // A full replaceTransactions push is still queued for this portfolio — local
      // array is the intended final state, don't let a stale cloud pull touch it.
      if (pendingTx.replacePortfolioIds.has(pid)) return;

      const localTxs = state.transactions[pid] || [];
      const cloudTxs = cloudData.transactions[pid] || [];
      state.transactions[pid] = reconcileTransactions(localTxs, cloudTxs, pendingTx);
    });
  }

  // --- Scalar settings — only adopt cloud values if nothing local is unsynced for them ---
  if (!hasPendingSettings) {
    if (cloudData.currency) state.currency = cloudData.currency;
    if (cloudData.feeSettings) state.feeSettings = cloudData.feeSettings;
    if (cloudData.activePortfolioId && state.portfolios.some(p => p.id === cloudData.activePortfolioId)) {
      state.activePortfolioId = cloudData.activePortfolioId;
    }
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

  // Push whatever was queued while offline BEFORE pulling, so the pull already
  // reflects our own writes instead of racing with them.
  await flushPendingOps();

  const cloudData = await apiGet();
  if (!cloudData) return; // Offline — dữ liệu localStorage đã được load

  // Merge instead of overwrite — an unsynced local edit must never be lost just
  // because the cloud pull ran before it was confirmed.
  mergeStateFromCloud(cloudData);

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
  // Backward-compatible: existing records without this field just compare as "oldest"
  tx.updatedAt = Date.now();
  return apiPost("saveTransaction", {
    ...tx,
    portfolioId: state.activePortfolioId
  });
}

function dbUpdateTransaction(tx) {
  tx.updatedAt = Date.now();
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

// ─── Recovery: force local → cloud ────────────────────────────────────────────
// Pushes the full local transaction list for one portfolio to the Sheet, overwriting
// whatever is currently there. Use when local is known-good and cloud is suspected
// to be missing/out of sync (e.g. after a long offline stretch, or a bad merge).
// Goes through dbReplaceTransactions, so a network failure here queues normally too.
async function syncPortfolioToCloud(portfolioId) {
  const txs = (state.transactions && state.transactions[portfolioId]) || [];
  showSyncStatus("syncing", "Đang đẩy toàn bộ dữ liệu portfolio lên Cloud...");
  const result = await dbReplaceTransactions(portfolioId, txs);
  if (result && result.ok !== false) {
    showSyncStatus("success", "Đã đồng bộ toàn bộ portfolio lên Cloud ✓");
  }
  return result;
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
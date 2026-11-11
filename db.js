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
// Dùng let để auth.js có thể gán lại sau khi đăng nhập Firebase
let APPS_SCRIPT_URL = (window.ENV && window.ENV.APPS_SCRIPT_URL) || "";
let API_SECRET_KEY  = (window.ENV && window.ENV.SECRET_KEY)       || "";

// Cho phép auth.js cập nhật config sau khi đăng nhập (thay thế env.js)
function setCloudConfig(url, key) {
  APPS_SCRIPT_URL = url || "";
  API_SECRET_KEY  = key || "";
}

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

// Helper lấy Firebase ID Token (nếu đang đăng nhập)
async function getValidToken(forceRefresh = false) {
  if (typeof window.getAuthToken === "function") {
    return await window.getAuthToken(forceRefresh);
  }
  if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
    try {
      return await firebase.auth().currentUser.getIdToken(forceRefresh);
    } catch (_) {}
  }
  return null;
}

// Core network call, no fallback/queueing — used both by apiPost() and flushPendingOps()
// so a replayed op goes through the exact same path as a live one.
async function rawApiPost(action, data) {
  let token = await getValidToken();
  const payload = {
    action,
    data,
    token: token || "",
    key: API_SECRET_KEY || ""
  };

  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // Apps Script yêu cầu text/plain để tránh preflight
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.error) {
    // Nếu bị lỗi Unauthorized do token hết hạn, thử refresh token 1 lần
    if ((json.error === "Unauthorized" || json.error.includes("token")) && token) {
      const refreshedToken = await getValidToken(true);
      if (refreshedToken && refreshedToken !== token) {
        payload.token = refreshedToken;
        const retryRes = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify(payload)
        });
        const retryJson = await retryRes.json();
        if (retryJson.error) throw new Error(retryJson.error);
        return retryJson;
      }
    }
    throw new Error(json.error);
  }
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
    let token = await getValidToken();
    const buildUrl = (tok) => {
      let u = APPS_SCRIPT_URL + "?action=getAllData&t=" + Date.now();
      if (tok) u += "&token=" + encodeURIComponent(tok);
      if (API_SECRET_KEY) u += "&key=" + encodeURIComponent(API_SECRET_KEY);
      return u;
    };

    let res  = await fetch(buildUrl(token));
    let json = await res.json();

    if (json.error) {
      // Nếu bị Unauthorized do token hết hạn, thử refresh token 1 lần
      if ((json.error === "Unauthorized" || json.error.includes("token")) && token) {
        const refreshedToken = await getValidToken(true);
        if (refreshedToken && refreshedToken !== token) {
          res  = await fetch(buildUrl(refreshedToken));
          json = await res.json();
          if (!json.error) {
            showSyncStatus("success", "Đã tải từ Cloud ✓");
            return json;
          }
        }
      }
      throw new Error(json.error);
    }
    showSyncStatus("success", "Đã tải từ Cloud ✓");
    return json;
  } catch (err) {
    console.error("[Cloud] GET error:", err);
    let errMsg = err.message;
    if (errMsg.includes("Unexpected token")) errMsg = "Lỗi phản hồi (có thể do chuyển hướng đăng nhập Google hoặc hết Quota)";
    if (errMsg.includes("Failed to fetch")) errMsg = "Lỗi kết nối hoặc bị chặn bởi CORS/Adblock";
    showSyncStatus("error", "Lỗi tải Cloud: " + errMsg);
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

// ─── Tombstone (Bia mộ) cho giao dịch đã xóa ─────────────────────────────────
// Lưu danh sách các txId đã xóa kèm thời gian (giữ 30 ngày).
// Ngăn chặn hoàn toàn tình trạng giao dịch đã xóa bị "hồi sinh" do cache cũ của Google Sheets
// hoặc do thiết bị khác chưa đồng bộ đẩy ngược lên.
const TOMBSTONE_TX_KEY = "model_car_deleted_tx_ids";
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

function loadTombstones() {
  try {
    const raw = localStorage.getItem(TOMBSTONE_TX_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    let changed = false;
    for (const [id, ts] of Object.entries(map)) {
      if (now - Number(ts || 0) > TOMBSTONE_TTL_MS) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(TOMBSTONE_TX_KEY, JSON.stringify(map));
    }
    return map;
  } catch (e) {
    console.error("[Tombstone] Failed to load deleted IDs:", e);
    return {};
  }
}

function recordDeletedTxId(txId) {
  if (!txId) return;
  const map = loadTombstones();
  map[String(txId)] = Date.now();
  try {
    localStorage.setItem(TOMBSTONE_TX_KEY, JSON.stringify(map));
  } catch (e) {
    console.error("[Tombstone] Failed to save deleted ID:", e);
  }
}

function isTxDeleted(txId) {
  if (!txId) return false;
  const map = loadTombstones();
  return Boolean(map[String(txId)]);
}

// Merge one portfolio's local + cloud transaction arrays into a single reconciled array.
// Rules (safety over strictness):
//   - a tombstoned id always wins → deleted, never resurrect even if cloud still has it
//   - a pending delete always wins → the id is dropped, even if cloud still has it
//   - a pending save/update always wins → keep the local copy, ignore cloud's version
//   - present on both sides → prefer whichever has the newer updatedAt (cloud if unknown)
//   - present locally only (no pending op explains it) → KEEP IT, never silently drop
//   - present on cloud only → adopt it (another device/session created it)
function reconcileTransactions(localTxs, cloudTxs, pending) {
  const tombstoneMap = loadTombstones();
  const localMap = new Map((localTxs || []).map(t => [t.id, t]));
  const cloudMap = new Map((cloudTxs || []).map(t => [t.id, t]));
  const allIds = new Set([...localMap.keys(), ...cloudMap.keys()]);
  const result = [];

  allIds.forEach(id => {
    // 1. Kiểm tra Bia mộ: nếu giao dịch này đã bị xóa, tiêu diệt hoàn toàn, không hồi sinh!
    if (tombstoneMap[id]) return;

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
    if (cloudData.feeSettings) {
      const fs = cloudData.feeSettings;
      // Trích xuất subFees: ưu tiên từ subFees object hoặc từ các trường phẳng trả về từ Google Sheet
      const cloudSub = fs.subFees || {
        feePayment: fs.feePayment,
        feeFixed:   fs.feeFixed,
        feeVoucher: fs.feeVoucher,
        feeTax:     fs.feeTax,
        feePiship:  fs.feePiship,
        feeInfra:   fs.feeInfra,
        feeManage:  fs.feeManage,
        feePack:    fs.feePack,
        feeAds:     fs.feeAds,
        feeAff:     fs.feeAff
      };

      const hasCloudSub = Object.values(cloudSub).some(v => v !== undefined && v !== null && v !== 0 && v !== '');

      let finalSub = hasCloudSub ? cloudSub : null;
      if (!finalSub) {
        finalSub = (state.feeSettings && state.feeSettings.subFees) || (() => {
          try { return JSON.parse(localStorage.getItem("shopee_sub_fees") || "null"); } catch(e) { return null; }
        })();
      }

      state.feeSettings = Object.assign({}, fs, { subFees: finalSub || undefined });
      if (finalSub) {
        try { localStorage.setItem("shopee_sub_fees", JSON.stringify(finalSub)); } catch(e) {}
      }
    }
    if (cloudData.activePortfolioId && state.portfolios.some(p => p.id === cloudData.activePortfolioId)) {
      state.activePortfolioId = cloudData.activePortfolioId;
    }
  }

  // --- Car Images ---
  if (cloudData.carImages) {
    try {
      const localImages = JSON.parse(localStorage.getItem("car_images") || "{}");
      let updated = false;
      const missingInCloud = [];

      for (const [key, cloudVal] of Object.entries(cloudData.carImages)) {
        const localVal = localImages[key];
        // Merge cloud images (prefer cloud over local if there is a conflict)
        if (!localVal || (typeof cloudVal === "object" && typeof localVal === "object" && cloudVal.fileId !== localVal.fileId)) {
          localImages[key] = cloudVal;
          updated = true;
        } else if (typeof localVal === "string") {
          // Upgrade old string format to object format from cloud
          localImages[key] = cloudVal;
          updated = true;
        }
      }

      // Phát hiện các ảnh cũ chỉ có ở Local mà chưa có trên Cloud Sheet
      for (const [key, localVal] of Object.entries(localImages)) {
        if (!cloudData.carImages[key] && typeof localVal === "object" && localVal.url && localVal.fileId) {
          missingInCloud.push({ imgKey: key, url: localVal.url, fileId: localVal.fileId });
        }
      }

      if (updated) {
        localStorage.setItem("car_images", JSON.stringify(localImages));
      }

      // Tự động đẩy mapping cũ lên server 1 lần
      if (missingInCloud.length > 0) {
        rawApiPost("syncCarImagesMappings", missingInCloud)
          .catch(err => console.error("Auto sync old images failed", err));
      }
    } catch (e) { console.error("Error merging car images from cloud", e); }
  }

  // --- Affiliate Marketing ---
  if (cloudData.affiliate) {
    if (!state.affiliate) state.affiliate = { tiktok: [], shopee: [], uploads: [] };

    // Merge TikTok: index by orderId_skuId
    if (Array.isArray(cloudData.affiliate.tiktok)) {
      const localMap = new Map();
      (state.affiliate.tiktok || []).forEach(item => {
        const key = item.orderId + "_" + (item.skuId || item.productId || "0");
        localMap.set(key, item);
      });
      cloudData.affiliate.tiktok.forEach(cloudItem => {
        const key = cloudItem.orderId + "_" + (cloudItem.skuId || cloudItem.productId || "0");
        const localItem = localMap.get(key);
        if (!localItem || (cloudItem.updatedAt || 0) >= (localItem.updatedAt || 0)) {
          localMap.set(key, cloudItem);
        }
      });
      state.affiliate.tiktok = Array.from(localMap.values());
    }

    // Merge Shopee: index by id
    if (Array.isArray(cloudData.affiliate.shopee)) {
      const localMap = new Map();
      (state.affiliate.shopee || []).forEach(item => localMap.set(item.id, item));
      cloudData.affiliate.shopee.forEach(cloudItem => {
        const localItem = localMap.get(cloudItem.id);
        if (!localItem || (cloudItem.updatedAt || 0) >= (localItem.updatedAt || 0)) {
          localMap.set(cloudItem.id, cloudItem);
        }
      });
      state.affiliate.shopee = Array.from(localMap.values());
    }

    // Merge Uploads
    if (Array.isArray(cloudData.affiliate.uploads) && cloudData.affiliate.uploads.length > 0) {
      const upMap = new Map();
      (state.affiliate.uploads || []).forEach(u => upMap.set(u.uploadId, u));
      cloudData.affiliate.uploads.forEach(u => upMap.set(u.uploadId, u));
      state.affiliate.uploads = Array.from(upMap.values());
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
  // 1. Ghi nhận vào Bia mộ (Tombstone) để ngăn hồi sinh ở mọi nơi
  recordDeletedTxId(txId);

  // 2. Xóa khỏi state bộ nhớ ở tất cả portfolio (nếu có)
  if (window.state && window.state.transactions) {
    Object.keys(window.state.transactions).forEach(pid => {
      if (Array.isArray(window.state.transactions[pid])) {
        window.state.transactions[pid] = window.state.transactions[pid].filter(tx => tx.id !== txId);
      }
    });
  }

  // 3. Cập nhật ngay LocalStorage trên máy (không chờ mạng)
  saveStateToLocalStorage();

  // 4. Gửi yêu cầu xóa lên Cloud (nếu mất mạng sẽ tự động đưa vào pendingOps)
  return apiPost("deleteTransaction", { id: txId });
}

function dbSavePortfolio(portfolio) {
  return apiPost("savePortfolio", portfolio);
}

function dbDeletePortfolio(portfolioId) {
  return apiPost("deletePortfolio", { id: portfolioId });
}

function dbSaveSettings() {
  if (typeof saveStateToLocalStorage === "function") {
    saveStateToLocalStorage();
  }
  try {
    if (state.feeSettings && state.feeSettings.subFees) {
      localStorage.setItem("shopee_sub_fees", JSON.stringify(state.feeSettings.subFees));
    }
  } catch(e) {}

  const fs = state.feeSettings || {};
  const sub = fs.subFees || {};

  return apiPost("saveSettings", {
    currency:          state.currency,
    activePortfolioId: state.activePortfolioId,
    feeSettings: {
      fee:          fs.fee,
      extra:        fs.extra,
      operation:    fs.operation,
      targetMargin: fs.targetMargin,
      subFees:      sub,
      feePayment:   sub.feePayment,
      feeFixed:     sub.feeFixed,
      feeVoucher:   sub.feeVoucher,
      feeTax:       sub.feeTax,
      feePiship:    sub.feePiship,
      feeInfra:     sub.feeInfra,
      feeManage:    sub.feeManage,
      feePack:      sub.feePack,
      feeAds:       sub.feeAds,
      feeAff:       sub.feeAff
    }
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
async function dbUploadImage(file, oldFileId = "", imgKey = "") {
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

        const json = await rawApiPost("uploadImage", {
          base64:    base64,
          mimeType:  "image/webp",
          fileName:  optimized.fileName,
          oldFileId: oldFileId,
          imgKey:    imgKey
        });

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

// ═══════════════════════════════════════════════════════════════════════════════
// AFFILIATE MARKETING (TikTok & Shopee)
// ═══════════════════════════════════════════════════════════════════════════════

async function dbGetAffiliateData() {
  if (!isCloudConfigured()) return { tiktok: [], shopee: [], uploads: [] };
  try {
    return await rawApiPost("getAffiliateData", {});
  } catch (err) {
    console.error("[Affiliate] dbGetAffiliateData error:", err);
    return { tiktok: [], shopee: [], uploads: [] };
  }
}

async function dbSaveAffiliateBatch(platform, items) {
  if (!isCloudConfigured() || !items || items.length === 0) return { ok: true };
  try {
    showSyncStatus("syncing", `Đang đồng bộ ${items.length} đơn Affiliate...`);
    const res = await rawApiPost("saveAffiliateBatch", { platform, items });
    showSyncStatus("success", `Đã lưu ${items.length} đơn Affiliate ✓`);
    return res;
  } catch (err) {
    console.error("[Affiliate] dbSaveAffiliateBatch error:", err);
    showSyncStatus("error", "Lỗi đồng bộ Affiliate lên Cloud");
    return { ok: false, error: err.message };
  }
}

async function dbSaveAffiliateItem(platform, item) {
  if (!isCloudConfigured() || !item) return { ok: true };
  try {
    showSyncStatus("syncing", "Đang lưu giao dịch Affiliate...");
    const res = await rawApiPost("saveAffiliateItem", { platform, item });
    showSyncStatus("success", "Đã lưu Affiliate ✓");
    return res;
  } catch (err) {
    console.error("[Affiliate] dbSaveAffiliateItem error:", err);
    showSyncStatus("error", "Lỗi lưu Affiliate lên Cloud");
    return { ok: false, error: err.message };
  }
}

async function dbDeleteAffiliateItem(platform, id, orderId, skuId) {
  if (!isCloudConfigured() || !id) return { ok: true };
  try {
    showSyncStatus("syncing", "Đang xóa Affiliate...");
    const res = await rawApiPost("deleteAffiliateItem", { platform, id, orderId, skuId });
    showSyncStatus("success", "Đã xóa Affiliate ✓");
    return res;
  } catch (err) {
    console.error("[Affiliate] dbDeleteAffiliateItem error:", err);
    showSyncStatus("error", "Lỗi xóa Affiliate trên Cloud");
    return { ok: false, error: err.message };
  }
}

async function dbUploadAffiliateFile(fileName, base64, mimeType, year) {
  if (!isCloudConfigured()) return null;
  try {
    showSyncStatus("syncing", "Đang lưu file gốc lên Google Drive...");
    const res = await rawApiPost("uploadAffiliateFile", {
      fileName: fileName,
      base64: base64,
      mimeType: mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      year: year || new Date().getFullYear()
    });
    if (res && res.ok) {
      showSyncStatus("success", "Đã lưu file lên Google Drive ✓");
    }
    return res;
  } catch (err) {
    console.error("[Affiliate] dbUploadAffiliateFile error:", err);
    showSyncStatus("error", "Lỗi lưu file lên Drive: " + err.message);
    return null;
  }
}

async function dbSaveAffiliateUploadLog(logData) {
  if (!isCloudConfigured() || !logData) return { ok: true };
  try {
    return await rawApiPost("saveAffiliateUploadLog", logData);
  } catch (err) {
    console.error("[Affiliate] dbSaveAffiliateUploadLog error:", err);
    return { ok: false };
  }
}

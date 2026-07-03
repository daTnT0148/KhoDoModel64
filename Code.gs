/**
 * 1:64 Model Car Portfolio Tracker - Google Apps Script Backend
 * Deploy as Web App: Execute as Me, Anyone can access
 */

const SHEET_ID        = "1VB01bVUDH-fBKwiS4JfOhiNSqsH37snzYZnHefq86Xs";
const DRIVE_FOLDER_ID = "1eaGPgd7czUjSTBBXPsFJ1LT4ac4TlFHg";
const SECRET_KEY      = "Kntvntd482001"; // ← PHẢI GIỐNG VỚI KEY TRONG env.js

function getSpreadsheet() {
  return SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// --- CORS + Router ---

function doGet(e) {
  const action = e && e.parameter && e.parameter.action ? e.parameter.action : "getAllData";
  const key    = e && e.parameter && e.parameter.key ? e.parameter.key : "";
  if (key !== SECRET_KEY) {
    return ContentService.createTextOutput(JSON.stringify({ error: "Unauthorized" })).setMimeType(ContentService.MimeType.JSON);
  }
  let result;
  try {
    if (action === "getAllData") result = getAllData();
    else result = { error: "Unknown action: " + action };
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ error: "Invalid JSON: " + err.message });
  }
  const action = body.action;
  const key    = body.key || "";
  if (key !== SECRET_KEY) return respond({ error: "Unauthorized" });
  let result;
  try {
    switch (action) {
      case "saveTransaction":    result = saveTransaction(body.data);    break;
      case "updateTransaction":  result = updateTransaction(body.data);  break;
      case "deleteTransaction":  result = deleteTransaction(body.data);  break;
      case "savePortfolio":      result = savePortfolio(body.data);      break;
      case "deletePortfolio":    result = deletePortfolio(body.data);    break;
      case "saveSettings":       result = saveSettings(body.data);       break;
      case "replaceTransactions":result = replaceTransactions(body.data);break;
      case "uploadImage":        result = uploadImage(body.data);        break;
      case "writeTaxDeclaration":result = writeTaxDeclaration(body.data);break;
      case "scanSheet":          result = scanSheet(body.data);          break;
      default: result = { error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return respond(result);
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// --- Sheet helpers ---

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = createSheet(ss, name);
  // Trả hàng: tự động bổ sung 2 cột relatedTxId/returnLoss cho sheet Transactions cũ
  // (đã tạo từ trước khi có tính năng Trả hàng) mà không cần người dùng tự sửa tay.
  if (name === "Transactions") ensureTransactionsColumns(sheet);
  return sheet;
}

function ensureTransactionsColumns(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const required = ["relatedTxId", "returnLoss", "taxUnitPrice", "restockToInventory"]; // Trả hàng: liên kết + khoản lỗ + có hoàn kho không | Shopee: giá đăng bán/khai thuế
  let changed = false;
  required.forEach(col => {
    if (headers.indexOf(col) === -1) {
      headers.push(col);
      changed = true;
    }
  });
  if (changed) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
  }
}

function createSheet(ss, name) {
  const sheet = ss.insertSheet(name);
  const headers = {
    Portfolios:   ["portfolioId", "portfolioName"],
    Transactions: ["id", "portfolioId", "type", "modelName", "brand", "qty",
                   "unitCost", "unitPrice", "channel", "notes", "date", "color", "packaging", "sku",
                   "relatedTxId", "returnLoss", "taxUnitPrice", "restockToInventory"], // Trả hàng: liên kết + lỗ + hoàn kho | Shopee: giá đăng bán/khai thuế
    Settings:     ["key", "value"]
  };
  if (headers[name]) {
    sheet.getRange(1, 1, 1, headers[name].length).setValues([headers[name]]);
    sheet.getRange(1, 1, 1, headers[name].length)
      .setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// --- READ ---

function getAllData() {
  const portfolioRows = sheetToObjects(getSheet("Portfolios"));
  const portfolios = portfolioRows
    .filter(r => r.portfolioId)
    .map(r => ({ id: String(r.portfolioId), name: String(r.portfolioName) }));

  const txRows = sheetToObjects(getSheet("Transactions"));
  const transactions = {};
  portfolios.forEach(p => { transactions[p.id] = []; });

  txRows.filter(r => r.id).forEach(r => {
    const pid = String(r.portfolioId);
    if (!transactions[pid]) transactions[pid] = [];
    const tx = {
      id:        String(r.id),
      type:      String(r.type),
      modelName: String(r.modelName),
      brand:     String(r.brand),
      qty:       Number(r.qty),
      date:      r.date instanceof Date
                   ? Utilities.formatDate(r.date, Session.getScriptTimeZone(), "yyyy-MM-dd")
                   : String(r.date),
      notes:     String(r.notes || ""),
      channel:   String(r.channel || ""),
      color:     String(r.color || ""),
      packaging: String(r.packaging || ""),
      sku:       String(r.sku || "")
    };
    if (r.unitCost !== "" && r.unitCost !== null) tx.unitCost = Number(r.unitCost);
    if (r.unitPrice !== "" && r.unitPrice !== null) tx.unitPrice = Number(r.unitPrice);
    // Trả hàng: chỉ gắn relatedTxId/returnLoss khi có dữ liệu, để không tạo field rác cho giao dịch buy/sell thường
    if (r.relatedTxId !== undefined && r.relatedTxId !== "" && r.relatedTxId !== null) tx.relatedTxId = String(r.relatedTxId);
    if (r.returnLoss !== undefined && r.returnLoss !== "" && r.returnLoss !== null) tx.returnLoss = Number(r.returnLoss);
    // Shopee: giá đăng bán/doanh thu khai báo, chỉ gắn khi có giá trị (áp dụng cho kênh Shopee)
    if (r.taxUnitPrice !== undefined && r.taxUnitPrice !== "" && r.taxUnitPrice !== null) tx.taxUnitPrice = Number(r.taxUnitPrice);
    // Trả hàng: restockToInventory mặc định Có (true) nếu ô trống — chỉ gắn false khi Sheet ghi rõ là false/FALSE/"no"
    if (r.restockToInventory === false || r.restockToInventory === "FALSE" || r.restockToInventory === "false" || r.restockToInventory === "no") {
      tx.restockToInventory = false;
    }
    transactions[pid].push(tx);
  });

  const settingRows = sheetToObjects(getSheet("Settings"));
  const settingsMap = {};
  settingRows.forEach(r => { if (r.key) settingsMap[String(r.key)] = String(r.value); });

  const currency        = settingsMap["currency"] || "VND";
  const activePortfolio = settingsMap["activePortfolioId"] || (portfolios[0] ? portfolios[0].id : "p-default");
  const feeSettings = {
    fee:          parseFloat(settingsMap["fee"] || "25"),
    extra:        parseFloat(settingsMap["extra"] || "4620"),
    operation:    parseFloat(settingsMap["operation"] || "5000"),
    targetMargin: settingsMap["targetMargin"] !== undefined ? parseFloat(settingsMap["targetMargin"]) : 10
  };

  if (portfolios.length === 0) {
    portfolios.push({ id: "p-default", name: "Bo suu tap ca nhan" });
    transactions["p-default"] = [];
    const pSheet = getSheet("Portfolios");
    pSheet.appendRow(["p-default", "Bo suu tap ca nhan"]);
  }

  return { portfolios, transactions, currency, activePortfolioId: activePortfolio, feeSettings };
}

// --- WRITE ---

function saveTransaction(tx) {
  const sheet = getSheet("Transactions");
  sheet.appendRow([
    tx.id, tx.portfolioId, tx.type, tx.modelName, tx.brand,
    tx.qty,
    (tx.type === "buy" || tx.type === "return_buy") ? tx.unitCost : "",
    (tx.type === "sell" || tx.type === "return_sell") ? tx.unitPrice : "",
    tx.channel || "", tx.notes || "", tx.date,
    tx.color || "", tx.packaging || "", tx.sku || "",
    tx.relatedTxId || "", // Trả hàng: liên kết giao dịch gốc
    (tx.type === "return_buy" || tx.type === "return_sell") ? Number(tx.returnLoss || 0) : "",
    (tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null) ? Number(tx.taxUnitPrice) : "", // Shopee: giá đăng bán/khai thuế
    (tx.type === "return_buy" || tx.type === "return_sell") ? (tx.restockToInventory !== false) : "" // Trả hàng: có hoàn kho không
  ]);
  return { ok: true };
}

function updateTransaction(tx) {
  const sheet = getSheet("Transactions");
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tx.id)) {
      sheet.getRange(i + 1, 1, 1, 18).setValues([[
        tx.id, tx.portfolioId, tx.type, tx.modelName, tx.brand,
        tx.qty,
        (tx.type === "buy" || tx.type === "return_buy") ? tx.unitCost : "",
        (tx.type === "sell" || tx.type === "return_sell") ? tx.unitPrice : "",
        tx.channel || "", tx.notes || "", tx.date,
        tx.color || "", tx.packaging || "", tx.sku || "",
        tx.relatedTxId || "",
        (tx.type === "return_buy" || tx.type === "return_sell") ? Number(tx.returnLoss || 0) : "",
        (tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null) ? Number(tx.taxUnitPrice) : "",
        (tx.type === "return_buy" || tx.type === "return_sell") ? (tx.restockToInventory !== false) : ""
      ]]);
      return { ok: true };
    }
  }
  return { error: "Transaction not found: " + tx.id };
}

function deleteTransaction(data) {
  const sheet = getSheet("Transactions");
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: "Transaction not found: " + data.id };
}

function savePortfolio(portfolio) {
  const sheet = getSheet("Portfolios");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(portfolio.id)) {
      sheet.getRange(i + 1, 1, 1, 2).setValues([[portfolio.id, portfolio.name]]);
      return { ok: true };
    }
  }
  sheet.appendRow([portfolio.id, portfolio.name]);
  return { ok: true };
}

function deletePortfolio(data) {
  const pSheet = getSheet("Portfolios");
  const tSheet = getSheet("Transactions");
  if (data.id === "__ALL__") {
    const pLast = pSheet.getLastRow();
    if (pLast > 1) pSheet.deleteRows(2, pLast - 1);
    const tLast = tSheet.getLastRow();
    if (tLast > 1) tSheet.deleteRows(2, tLast - 1);
    return { ok: true };
  }
  const pData = pSheet.getDataRange().getValues();
  for (let i = 1; i < pData.length; i++) {
    if (String(pData[i][0]) === String(data.id)) { pSheet.deleteRow(i + 1); break; }
  }
  const tData = tSheet.getDataRange().getValues();
  for (let i = tData.length - 1; i >= 1; i--) {
    if (String(tData[i][1]) === String(data.id)) tSheet.deleteRow(i + 1);
  }
  return { ok: true };
}

function saveSettings(data) {
  const sheet  = getSheet("Settings");
  const values = sheet.getDataRange().getValues();
  const settingsMap = {};
  for (let i = 1; i < values.length; i++) {
    settingsMap[String(values[i][0])] = i + 1;
  }
  const toSave = {
    currency:          data.currency,
    activePortfolioId: data.activePortfolioId,
    fee:               data.feeSettings ? String(data.feeSettings.fee)          : undefined,
    extra:             data.feeSettings ? String(data.feeSettings.extra)        : undefined,
    operation:         data.feeSettings ? String(data.feeSettings.operation)    : undefined,
    targetMargin:      data.feeSettings ? String(data.feeSettings.targetMargin) : undefined
  };
  Object.entries(toSave).forEach(([key, value]) => {
    if (value === undefined) return;
    if (settingsMap[key]) sheet.getRange(settingsMap[key], 2).setValue(value);
    else sheet.appendRow([key, value]);
  });
  return { ok: true };
}

function replaceTransactions(data) {
  const { portfolioId, transactions } = data;
  const sheet  = getSheet("Transactions");
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return { ok: true };
  const headers = values[0];
  const newRows = [headers];
  for (let i = 1; i < values.length; i++) {
    const rowPid = String(values[i][1] || "");
    if (rowPid !== String(portfolioId) && !(rowPid === "" && String(portfolioId) === "p-default")) {
      newRows.push(values[i]);
    }
  }
  transactions.forEach(tx => {
    newRows.push([
      tx.id, portfolioId, tx.type, tx.modelName, tx.brand,
      tx.qty,
      (tx.type === "buy" || tx.type === "return_buy") ? tx.unitCost : "",
      (tx.type === "sell" || tx.type === "return_sell") ? tx.unitPrice : "",
      tx.channel || "", tx.notes || "", tx.date,
      tx.color || "", tx.packaging || "", tx.sku || "",
      tx.relatedTxId || "",
      (tx.type === "return_buy" || tx.type === "return_sell") ? Number(tx.returnLoss || 0) : "",
      (tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null) ? Number(tx.taxUnitPrice) : "",
      (tx.type === "return_buy" || tx.type === "return_sell") ? (tx.restockToInventory !== false) : ""
    ]);
  });
  sheet.clear();
  sheet.getRange(1, 1, newRows.length, headers.length).setValues(newRows);
  sheet.getRange(1, 1, 1, headers.length).setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
  return { ok: true };
}

// --- IMAGE UPLOAD ---

function uploadImage(data) {
  try {
    if (!data || !data.base64 || !data.mimeType || !data.fileName) {
      return { error: "Missing image data" };
    }
    const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED_TYPES.includes(data.mimeType.toLowerCase())) {
      return { error: "Only JPG, PNG, WEBP supported" };
    }
    const MAX_BASE64_LEN = 5 * 1024 * 1024 * 1.37;
    if (data.base64.length > MAX_BASE64_LEN) return { error: "Image too large, max 5MB" };
    const decoded = Utilities.base64Decode(data.base64);
    const blob = Utilities.newBlob(decoded, data.mimeType, data.fileName);
    let folder;
    if (DRIVE_FOLDER_ID && DRIVE_FOLDER_ID.trim() !== "") {
      let rawId = DRIVE_FOLDER_ID.trim();
      if (rawId.includes("id="))       rawId = rawId.split("id=")[1].split("&")[0];
      else if (rawId.includes("folders/")) rawId = rawId.split("folders/")[1].split("?")[0];
      else if (rawId.includes("?"))    rawId = rawId.split("?")[0];
      folder = DriveApp.getFolderById(rawId);
    } else {
      const folders = DriveApp.getFoldersByName("ModelCar_Images");
      folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("ModelCar_Images");
    }
    if (data.oldFileId) {
      try { DriveApp.getFileById(data.oldFileId).setTrashed(true); } catch (e) {}
    }
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fileId = file.getId();
    return { ok: true, fileId, imageUrl: "https://lh3.googleusercontent.com/d/" + fileId, fileName: data.fileName };
  } catch (err) {
    return { error: "Upload failed: " + err.message };
  }
}

// --- DEBUG: Scan sheet cells ---

function scanSheet(data) {
  const ss = getSpreadsheet();
  const allSheets = ss.getSheets().map(s => s.getName());
  const sheetName = data.sheetName || "To Khai";
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { error: "Tab not found: " + sheetName, availableSheets: allSheets };
  const allData = sheet.getDataRange().getValues();
  const cells = [];
  for (let r = 0; r < Math.min(allData.length, 25); r++) {
    for (let c = 0; c < allData[r].length; c++) {
      const v = allData[r][c];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        cells.push({ row: r+1, col: c+1, value: String(v) });
      }
    }
  }
  return { ok: true, availableSheets, cells };
}

// --- TAX DECLARATION ---
// Strip diacritics to ASCII for robust keyword matching regardless of file encoding

function stripDiacritics(s) {
  return String(s || "")
    .replace(/[^\x00-\x7F]/g, function(ch) {
      var map = {
        "\u00e0":"\u0061","\u00e1":"\u0061","\u00e2":"\u0061","\u00e3":"\u0061","\u00e4":"\u0061","\u00e5":"\u0061",
        "\u1ea1":"\u0061","\u1ea3":"\u0061","\u1ea5":"\u0061","\u1ea7":"\u0061","\u1ea9":"\u0061","\u1eab":"\u0061","\u1ead":"\u0061","\u1eaf":"\u0061","\u1eb1":"\u0061","\u1eb3":"\u0061","\u1eb5":"\u0061","\u1eb7":"\u0061","\u1eb9":"\u0061","\u1ebb":"\u0061","\u1ebd":"\u0061","\u1ebf":"\u0061","\u1ec1":"\u0061","\u1ec3":"\u0061",
        "\u00c0":"\u0041","\u00c1":"\u0041","\u00c2":"\u0041","\u00c3":"\u0041","\u00c4":"\u0041","\u00c5":"\u0041",
        "\u1ea0":"\u0041","\u1ea2":"\u0041","\u1ea4":"\u0041","\u1ea6":"\u0041","\u1ea8":"\u0041","\u1eaa":"\u0041","\u1eac":"\u0041","\u1eae":"\u0041","\u1eb0":"\u0041","\u1eb2":"\u0041","\u1eb4":"\u0041","\u1eb6":"\u0041","\u1eb8":"\u0041","\u1eba":"\u0041","\u1ebc":"\u0041","\u1ebe":"\u0041","\u1ec0":"\u0041","\u1ec2":"\u0041",
        "\u00e8":"\u0065","\u00e9":"\u0065","\u00ea":"\u0065","\u00eb":"\u0065",
        "\u1eb9":"\u0065","\u1ebb":"\u0065","\u1ebd":"\u0065","\u1ebf":"\u0065","\u1ec1":"\u0065","\u1ec3":"\u0065","\u1ec5":"\u0065","\u1ec7":"\u0065","\u1ec9":"\u0065",
        "\u00c8":"\u0045","\u00c9":"\u0045","\u00ca":"\u0045","\u00cb":"\u0045",
        "\u00ec":"\u0069","\u00ed":"\u0069","\u00ee":"\u0069","\u00ef":"\u0069",
        "\u1ecb":"\u0069","\u1ecd":"\u0069","\u00cc":"\u0049","\u00cd":"\u0049",
        "\u00f2":"\u006f","\u00f3":"\u006f","\u00f4":"\u006f","\u00f5":"\u006f","\u00f6":"\u006f",
        "\u1ecd":"\u006f","\u1ecf":"\u006f","\u1ed1":"\u006f","\u1ed3":"\u006f","\u1ed5":"\u006f","\u1ed7":"\u006f","\u1ed9":"\u006f","\u1edb":"\u006f","\u1edd":"\u006f","\u1edf":"\u006f","\u1ee1":"\u006f","\u1ee3":"\u006f",
        "\u00d2":"\u004f","\u00d3":"\u004f","\u00d4":"\u004f","\u00d5":"\u004f","\u00d6":"\u004f",
        "\u00f9":"\u0075","\u00fa":"\u0075","\u00fb":"\u0075","\u00fc":"\u0075",
        "\u1ee5":"\u0075","\u1ee7":"\u0075","\u1ee9":"\u0075","\u1eeb":"\u0075","\u1eed":"\u0075","\u1eef":"\u0075","\u1ef1":"\u0075",
        "\u00d9":"\u0055","\u00da":"\u0055","\u00db":"\u0055","\u00dc":"\u0055",
        "\u1ef3":"\u0079","\u00fd":"\u0079","\u1ef5":"\u0079","\u1ef7":"\u0079","\u1ef9":"\u0079",
        "\u00dd":"\u0059","\u1ef2":"\u0059",
        "\u0111":"\u0064","\u0110":"\u0044"
      };
      return map[ch] !== undefined ? map[ch] : "";
    })
    .toLowerCase();
}

function writeTaxDeclaration(data) {
  var ss = getSpreadsheet();
  var declId = String(data.declId || "");

  // Try multiple tab name variants
  var variants = [
    data.sheetName,
    "Mau so " + declId,
    "Mau so " + declId.replace(/-/g, " "),
    declId
  ];
  // Also try original Vietnamese tab names by scanning all sheets
  var allSheets = ss.getSheets();
  var sheet = null;
  var usedSheetName = "";

  // First try exact variants
  for (var vi = 0; vi < variants.length; vi++) {
    if (!variants[vi]) continue;
    var s = ss.getSheetByName(variants[vi]);
    if (s) { sheet = s; usedSheetName = variants[vi]; break; }
  }

  // If not found, search by stripping diacritics from all sheet names
  if (!sheet) {
    var targetNorm = stripDiacritics(data.sheetName || "").replace(/\s+/g," ").trim();
    for (var si = 0; si < allSheets.length; si++) {
      var sName = allSheets[si].getName();
      var sNorm = stripDiacritics(sName).replace(/\s+/g," ").trim();
      if (sNorm === targetNorm || sNorm.includes(stripDiacritics(declId))) {
        sheet = allSheets[si]; usedSheetName = sName; break;
      }
    }
  }

  // Fallback: find any sheet whose normalized name contains "to khai" or "mau so"
  if (!sheet) {
    for (var si2 = 0; si2 < allSheets.length; si2++) {
      var sn = stripDiacritics(allSheets[si2].getName());
      if (sn.includes("to khai") || (sn.includes("mau so") && sn.includes("hkd"))) {
        sheet = allSheets[si2]; usedSheetName = allSheets[si2].getName(); break;
      }
    }
  }

  if (!sheet) {
    return { error: "Tab not found. Tried: " + variants.join(", ") + ". Available: " + allSheets.map(function(s){return s.getName();}).join(", ") };
  }

  var allData = sheet.getDataRange().getValues();

  // Normalize a cell value to ASCII lowercase for matching
  function norm(v) { return stripDiacritics(String(v || "")).replace(/\s+/g," ").trim(); }

  // Find the table header row: must contain BOTH "giao" (from Giao dich) AND "ng" + "thang" pattern
  var rowHeader = -1;
  var colNgay = 1; // default col B
  for (var r = 0; r < allData.length; r++) {
    var rowNorms = allData[r].map(function(c){ return norm(c); });
    var joined = rowNorms.join("|");
    var hasGiao = joined.includes("giao");
    var hasNgay = rowNorms.some(function(v){ return v.includes("ngay") || v.includes("ng "); });
    var hasThang = joined.includes("thang");
    if (hasGiao && (hasNgay || hasThang)) {
      rowHeader = r;
      for (var c = 0; c < rowNorms.length; c++) {
        if (rowNorms[c].includes("ngay") || rowNorms[c].includes("ng ")) { colNgay = c; break; }
      }
      break;
    }
  }

  if (rowHeader < 0) {
    // Return debug info to help diagnose
    var sample = [];
    for (var r2 = 0; r2 < Math.min(allData.length, 15); r2++) {
      var rowNorms2 = allData[r2].map(function(c){ return norm(c); }).filter(function(v){return v.length>0;});
      if (rowNorms2.length > 0) sample.push("Row" + (r2+1) + ": " + rowNorms2.join(" | "));
    }
    return { error: "Cannot find table header row. Sheet: " + usedSheetName + ". Sample: " + sample.join(" ;; ") };
  }

  // Skip sub-header row "A | B | 1"
  var dataStartRow = rowHeader + 1;
  if (allData[dataStartRow]) {
    var subNorm = norm(allData[dataStartRow][colNgay]);
    if (subNorm === "a" || subNorm === "b" || subNorm === "1") dataStartRow++;
  }

  // Find "Tong cong" row after header
  var rowTongCong = -1;
  for (var r3 = dataStartRow; r3 < allData.length; r3++) {
    var joined3 = allData[r3].map(function(c){ return norm(c); }).join(" ");
    if (joined3.includes("tong cong") || joined3.includes("tongcong")) {
      rowTongCong = r3; break;
    }
  }

  // STEP 1: Clear old data area (all columns to remove previous wrong writes)
  var clearEnd = rowTongCong > dataStartRow ? rowTongCong : dataStartRow + 60;
  var numClearCols = Math.max(6, sheet.getLastColumn());
  try {
    sheet.getRange(dataStartRow + 1, 1, clearEnd - dataStartRow, numClearCols).clearContent();
  } catch(e) {}

  // STEP 2: Expand table if needed
  var rows = data.rows || [];
  if (rowTongCong >= 0) {
    var available = rowTongCong - dataStartRow;
    if (rows.length > available) {
      var extra = rows.length - available;
      sheet.insertRowsBefore(rowTongCong + 1, extra);
      var fmtSrc = sheet.getRange(dataStartRow + 1, colNgay + 1, 1, 3);
      for (var ei = 0; ei < extra; ei++) {
        fmtSrc.copyTo(
          sheet.getRange(rowTongCong + 1 + ei + 1, colNgay + 1, 1, 3),
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false
        );
      }
      rowTongCong += extra;
    }
  }

  // STEP 3: Write transaction rows
  for (var ri = 0; ri < rows.length; ri++) {
    var sheetRow = dataStartRow + 1 + ri;
    sheet.getRange(sheetRow, colNgay + 1).setValue(rows[ri].date);
    sheet.getRange(sheetRow, colNgay + 2).setValue("Doanh thu ban hang");
    sheet.getRange(sheetRow, colNgay + 3).setValue(rows[ri].amount);
  }

  // STEP 4: Write Tong cong
  if (rowTongCong >= 0) {
    sheet.getRange(rowTongCong + 1, colNgay + 3).setValue(data.total || 0);
  } else {
    var tcRow = dataStartRow + 1 + rows.length;
    sheet.getRange(tcRow, colNgay + 1).setValue("Tong cong");
    sheet.getRange(tcRow, colNgay + 3).setValue(data.total || 0);
  }

  // STEP 5: Fill header info cells (search by normalized keyword, write to same cell)
  allData = sheet.getDataRange().getValues();

  function fillCell(keyword, value, excludeKeyword) {
    var kNorm = norm(keyword);
    for (var r4 = 0; r4 < rowHeader; r4++) {
      for (var c4 = 0; c4 < allData[r4].length; c4++) {
        var v4 = norm(allData[r4][c4]);
        if (v4.includes(kNorm)) {
          if (excludeKeyword && v4.includes(norm(excludeKeyword))) continue;
          sheet.getRange(r4 + 1, c4 + 1).setValue(value);
          return;
        }
      }
    }
  }

  fillCell("ho, ca nhan kinh doanh", "HO, CA NHAN KINH DOANH: " + (data.businessName || ""));
  fillCell("ma so thue",             "Ma so thue: "              + (data.taxCode     || ""));
  fillCell("dia chi",                "Dia chi: "                  + (data.address     || ""), "diem");
  fillCell("dia diem kinh doanh",    "Dia diem kinh doanh: "      + (data.address     || ""));
  fillCell("ky ke khai",             data.periodStr               || "");

  // STEP 6: Write sign date (search after Tong cong)
  var signFrom = rowTongCong >= 0 ? rowTongCong + 1 : dataStartRow + rows.length + 1;
  for (var r5 = signFrom; r5 < allData.length; r5++) {
    var row5 = allData[r5].map(function(c){ return norm(c); });
    var joined5 = row5.join(" ");
    if (joined5.includes("ngay") && joined5.includes("thang") && joined5.includes("nam")) {
      for (var c5 = 0; c5 < allData[r5].length; c5++) {
        var v5 = norm(allData[r5][c5]);
        if (v5.includes("ngay") || v5.includes("...")) {
          sheet.getRange(r5 + 1, c5 + 1).setValue(data.signDate || "");
          break;
        }
      }
      break;
    }
  }

  return { ok: true, tab: usedSheetName, debug: { rowHeader: rowHeader+1, colNgay: colNgay+1, dataStart: dataStartRow+1, rowTongCong: rowTongCong+1, rowsWritten: rows.length } };
}

/**
 * 1:64 Model Car Portfolio Tracker — Google Apps Script Backend
 * Deploy as Web App: Execute as Me, Anyone can access
 */

const SHEET_ID = "1VB01bVUDH-fBKwiS4JfOhiNSqsH37snzYZnHefq86Xs"; // ← DÁN SPREADSHEET ID VÀO ĐÂY
const DRIVE_FOLDER_ID = "1eaGPgd7czUjSTBBXPsFJ1LT4ac4TlFHg?usp=drive_link"; // ← DÁN GOOGLE DRIVE FOLDER ID VÀO ĐÂY (để trống = lưu root)

function getSpreadsheet() {
  return SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ─── CORS + Router ───────────────────────────────────────────────────────────

function doGet(e) {
  const action = e && e.parameter && e.parameter.action ? e.parameter.action : "getAllData";
  let result;
  try {
    if (action === "getAllData") result = getAllData();
    else result = { error: "Unknown action: " + action };
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ error: "Invalid JSON: " + err.message });
  }

  const action = body.action;
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
      default: result = { error: "Unknown action: " + action };
    }
  } catch (err) {
    result = { error: err.message };
  }

  return respond(result);
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function getSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = createSheet(ss, name);
  return sheet;
}

function createSheet(ss, name) {
  const sheet = ss.insertSheet(name);
  const headers = {
    Portfolios:   ["portfolioId", "portfolioName"],
    Transactions: ["id", "portfolioId", "type", "modelName", "brand", "qty",
                   "unitCost", "unitPrice", "channel", "notes", "date", "color", "packaging", "sku"],
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

// ─── READ ─────────────────────────────────────────────────────────────────────

function getAllData() {
  // Portfolios
  const portfolioRows = sheetToObjects(getSheet("Portfolios"));
  const portfolios = portfolioRows
    .filter(r => r.portfolioId)
    .map(r => ({ id: String(r.portfolioId), name: String(r.portfolioName) }));

  // Transactions
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
    transactions[pid].push(tx);
  });

  // Settings
  const settingRows = sheetToObjects(getSheet("Settings"));
  const settingsMap = {};
  settingRows.forEach(r => { if (r.key) settingsMap[String(r.key)] = String(r.value); });

  const currency        = settingsMap["currency"] || "VND";
  const activePortfolio = settingsMap["activePortfolioId"] || (portfolios[0] ? portfolios[0].id : "p-default");
  const feeSettings = {
    fee:       parseFloat(settingsMap["fee"] || "25"),
    extra:     parseFloat(settingsMap["extra"] || "4620"),
    operation: parseFloat(settingsMap["operation"] || "5000"),
    targetMargin: settingsMap["targetMargin"] !== undefined ? parseFloat(settingsMap["targetMargin"]) : 10
  };

  // Nếu chưa có portfolio nào, tạo mặc định
  if (portfolios.length === 0) {
    portfolios.push({ id: "p-default", name: "Bộ sưu tập cá nhân" });
    transactions["p-default"] = [];
    const pSheet = getSheet("Portfolios");
    pSheet.appendRow(["p-default", "Bộ sưu tập cá nhân"]);
  }

  return { portfolios, transactions, currency, activePortfolioId: activePortfolio, feeSettings };
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

function saveTransaction(tx) {
  const sheet = getSheet("Transactions");
  sheet.appendRow([
    tx.id, tx.portfolioId, tx.type, tx.modelName, tx.brand,
    tx.qty,
    tx.type === "buy" ? tx.unitCost : "",
    tx.type === "sell" ? tx.unitPrice : "",
    tx.channel || "", tx.notes || "", tx.date,
    tx.color || "", tx.packaging || "", tx.sku || ""
  ]);
  return { ok: true };
}

function updateTransaction(tx) {
  const sheet = getSheet("Transactions");
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(tx.id)) {
      sheet.getRange(i + 1, 1, 1, 14).setValues([[
        tx.id, tx.portfolioId, tx.type, tx.modelName, tx.brand,
        tx.qty,
        tx.type === "buy" ? tx.unitCost : "",
        tx.type === "sell" ? tx.unitPrice : "",
        tx.channel || "", tx.notes || "", tx.date,
        tx.color || "", tx.packaging || "", tx.sku || ""
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
  // Kiểm tra đã tồn tại chưa
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

  // Signal đặc biệt: xóa toàn bộ
  if (data.id === "__ALL__") {
    const pLast = pSheet.getLastRow();
    if (pLast > 1) pSheet.deleteRows(2, pLast - 1);
    const tLast = tSheet.getLastRow();
    if (tLast > 1) tSheet.deleteRows(2, tLast - 1);
    return { ok: true };
  }

  // Xóa portfolio khỏi sheet Portfolios
  const pData = pSheet.getDataRange().getValues();
  for (let i = 1; i < pData.length; i++) {
    if (String(pData[i][0]) === String(data.id)) {
      pSheet.deleteRow(i + 1);
      break;
    }
  }

  // Xóa toàn bộ transactions của portfolio đó
  const tData = tSheet.getDataRange().getValues();
  for (let i = tData.length - 1; i >= 1; i--) {
    if (String(tData[i][1]) === String(data.id)) {
      tSheet.deleteRow(i + 1);
    }
  }
  return { ok: true };
}

function saveSettings(data) {
  const sheet  = getSheet("Settings");
  const values = sheet.getDataRange().getValues();
  const settingsMap = {};
  for (let i = 1; i < values.length; i++) {
    settingsMap[String(values[i][0])] = i + 1; // key -> row number
  }

  const toSave = {
    currency:          data.currency,
    activePortfolioId: data.activePortfolioId,
    fee:               data.feeSettings ? String(data.feeSettings.fee)       : undefined,
    extra:             data.feeSettings ? String(data.feeSettings.extra)     : undefined,
    operation:         data.feeSettings ? String(data.feeSettings.operation) : undefined,
    targetMargin:      data.feeSettings ? String(data.feeSettings.targetMargin) : undefined
  };

  Object.entries(toSave).forEach(([key, value]) => {
    if (value === undefined) return;
    if (settingsMap[key]) {
      sheet.getRange(settingsMap[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  });

  return { ok: true };
}

// Thay toàn bộ transactions của 1 portfolio (dùng cho import CSV, load mock data)
function replaceTransactions(data) {
  const { portfolioId, transactions } = data;
  const sheet  = getSheet("Transactions");
  const values = sheet.getDataRange().getValues();
  
  if (values.length === 0) return { ok: true };
  const headers = values[0];
  const newRows = [headers];

  // Giữ lại các giao dịch của portfolio khác
  for (let i = 1; i < values.length; i++) {
    const rowPid = String(values[i][1] || "");
    if (rowPid !== String(portfolioId) && !(rowPid === "" && String(portfolioId) === "p-default")) {
      newRows.push(values[i]);
    }
  }

  // Gắn thêm các giao dịch mới
  transactions.forEach(tx => {
    newRows.push([
      tx.id, portfolioId, tx.type, tx.modelName, tx.brand,
      tx.qty,
      tx.type === "buy" ? tx.unitCost : "",
      tx.type === "sell" ? tx.unitPrice : "",
      tx.channel || "", tx.notes || "", tx.date,
      tx.color || "", tx.packaging || "", tx.sku || ""
    ]);
  });

  // Ghi đè toàn bộ sheet 1 lần duy nhất để tối ưu tốc độ (không bao giờ bị timeout)
  sheet.clear();
  sheet.getRange(1, 1, newRows.length, headers.length).setValues(newRows);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");

  return { ok: true };
}

// ─── IMAGE UPLOAD ─────────────────────────────────────────────────────────────

function uploadImage(data) {
  try {
    // Validate
    if (!data || !data.base64 || !data.mimeType || !data.fileName) {
      return { error: "Thiếu dữ liệu ảnh (base64, mimeType, fileName)" };
    }

    const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!ALLOWED_TYPES.includes(data.mimeType.toLowerCase())) {
      return { error: "Chỉ hỗ trợ JPG, JPEG, PNG, WEBP" };
    }

    // Giới hạn 5MB (base64 ~= 4/3 * size thực)
    const MAX_BASE64_LEN = 5 * 1024 * 1024 * 1.37;
    if (data.base64.length > MAX_BASE64_LEN) {
      return { error: "Ảnh quá lớn, tối đa 5MB" };
    }

    // Decode base64
    const decoded = Utilities.base64Decode(data.base64);
    const blob = Utilities.newBlob(decoded, data.mimeType, data.fileName);

    // Chọn folder lưu
    let folder;
    if (DRIVE_FOLDER_ID && DRIVE_FOLDER_ID.trim() !== "") {
      // Tự động bóc tách ID nếu người dùng lỡ dán cả đường link
      let rawId = DRIVE_FOLDER_ID.trim();
      if (rawId.includes("id=")) {
        rawId = rawId.split("id=")[1].split("&")[0];
      } else if (rawId.includes("folders/")) {
        rawId = rawId.split("folders/")[1].split("?")[0];
      } else if (rawId.includes("?")) {
        rawId = rawId.split("?")[0];
      }
      folder = DriveApp.getFolderById(rawId);
    } else {
      // Tạo folder "ModelCar_Images" ở root nếu chưa có
      const folders = DriveApp.getFoldersByName("ModelCar_Images");
      folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("ModelCar_Images");
    }

    // Xóa file cũ cùng tên nếu có (tránh trùng lặp khi đổi ảnh)
    if (data.oldFileId) {
      try { DriveApp.getFileById(data.oldFileId).setTrashed(true); } catch (e) {}
    }

    // Upload
    const file = folder.createFile(blob);

    // Set quyền xem công khai (ai có link đều xem được)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();

    // URL trực tiếp render được trong <img src="">
    const imageUrl = "https://lh3.googleusercontent.com/d/" + fileId;

    return {
      ok: true,
      fileId: fileId,
      imageUrl: imageUrl,
      fileName: data.fileName
    };

  } catch (err) {
    return { error: "Upload thất bại: " + err.message };
  }
}

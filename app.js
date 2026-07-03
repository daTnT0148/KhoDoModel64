/**
 * 1:64 Model Car Portfolio Tracker - Core Application Logic
 * Đăng ký và xử lý toàn bộ logic tính toán tài chính, vẽ biểu đồ, quản lý kho hàng,
 * tự động gợi ý tên xe, xuất nhập CSV và lưu trữ cục bộ LocalStorage.
 */

// --- KHỞI TẠO CẤU HÌNH & TRẠNG THÁI HỆ THỐNG ---
const EXCHANGE_RATES = {
  VND: 1,
  USD: 1 / 25000, // Giả định tỷ giá: 1 USD = 25.000₫
  EUR: 1 / 27000  // Giả định tỷ giá: 1 EUR = 27.000₫
};

let state = {
  portfolios: [
    { id: "p-default", name: "Bộ sưu tập cá nhân" }
  ],
  activePortfolioId: "p-default",
  transactions: {
    "p-default": [] // Mảng chứa các giao dịch mua/bán
  },
  currency: "VND",
  // Cấu hình phí sàn dùng để tính "Giá hòa vốn" cho từng xe trong kho (Công cụ tính lợi nhuận Shopee)
  feeSettings: {
    fee: 25,        // Phí sàn (%)
    extra: 4620,    // Phí kèm (vnd)
    operation: 5000 // Phí vận hành (vnd)
  },
  // --- MODULE THUẼ ---
  tax: {
    info: {
      taxCode: '',
      businessName: '',
      address: ''
    },
    config: {
      declarationTemplateName: '',
      declarationTemplateLastUpdated: ''
      // Nếu cần lưu file base64 thì thêm: declarationTemplateData: null
    },
    declarations: [
      {
        id: 'S1a-HKD',
        title: 'Sổ chi tiết doanh thu bán hàng hóa, dịch vụ',
        subtitle: 'Doanh thu ít hơn 500 triệu/năm',
        note: '',
        reportPeriod: { from: '', to: '' },
        salesChannel: 'all',
        available: true
      },
      {
        id: 'S2a-HKD',
        title: 'Sổ doanh thu bán hàng hóa, dịch vụ',
        subtitle: 'Doanh thu nhiều hơn 500 triệu/năm và ít hơn 3 tỷ/năm',
        note: '',
        reportPeriod: { from: '', to: '' },
        salesChannel: 'all',
        available: true
      }
    ]
  }
};

// Lưu các biến tham chiếu đến biểu đồ Chart.js để huỷ trước khi vẽ lại
let charts = {
  yoyChart: null,
  yoyReportChart: null,
  channelChart: null,
  brandChart: null
};

// --- HÀM TIỆN ÍCH HỖ TRỢ ---

// Hàm định dạng số dạng 5000 -> 5.000 khi gõ
function formatNumberInput(value) {
  // Loại bỏ mọi ký tự không phải là số hoặc dấu phẩy lẻ
  let cleanValue = value.replace(/[^0-9,]/g, "");
  
  // Tránh việc nhập nhiều dấu phẩy lẻ
  const parts = cleanValue.split(",");
  if (parts.length > 2) {
    cleanValue = parts[0] + "," + parts.slice(1).join("");
  }
  
  // Thêm dấu chấm phân cách hàng nghìn
  let integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  
  if (parts.length === 2) {
    return integerPart + "," + parts[1].substring(0, 2);
  }
  return integerPart;
}

// Chuyển chuỗi định dạng trở lại số thực để tính toán
function getNumericValue(formattedString) {
  if (!formattedString) return 0;
  // Bỏ dấu chấm và đổi dấu phẩy thành dấu chấm để Parse
  let clean = formattedString.replace(/\./g, "").replace(/,/g, ".");
  return parseFloat(clean) || 0;
}

// Thiết lập tự động định dạng khi gõ giá tiền
function setupInputFormatting() {
  const inputs = [
    document.getElementById("buyUnitCost"),
    document.getElementById("sellUnitPrice"),
    document.getElementById("sellTaxUnitPrice"),
    document.getElementById("returnLoss"),
    document.getElementById("editTxReturnLoss"),
    document.getElementById("editTxTaxUnitPrice")
  ];
  inputs.forEach(input => {
    if (!input) return;
    input.addEventListener("input", (e) => {
      const selectionStart = e.target.selectionStart;
      const originalLength = e.target.value.length;
      
      const formatted = formatNumberInput(e.target.value);
      e.target.value = formatted;
      
      // Giữ nguyên vị trí con trỏ chuột khi tự thêm dấu chấm
      const newLength = formatted.length;
      const newCursorPos = selectionStart + (newLength - originalLength);
      e.target.setSelectionRange(newCursorPos, newCursorPos);
    });
  });
}

// Định dạng tiền tệ động theo cấu hình đang chọn
function formatCurrency(amount) {
  const currency = state.currency;
  const rate = EXCHANGE_RATES[currency];
  const convertedAmount = amount * rate;

  if (currency === "VND") {
    // Định dạng tiền Việt Nam dùng dấu chấm làm hàng nghìn, dấu phẩy làm phần thập phân và hậu tố ' vnd'
    const rounded = Math.round(convertedAmount * 100) / 100;
    const parts = rounded.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    if (parts[1]) {
      return parts[0] + "," + parts[1].substring(0, 2) + " vnd";
    }
    return parts[0] + " vnd";
  } else if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(convertedAmount);
  } else if (currency === "EUR") {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 2
    }).format(convertedAmount);
  }
  return amount + " " + currency;
}

// Định dạng ngày hiển thị dd/mm/yyyy
function formatDate(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// Sinh ID ngẫu nhiên cho giao dịch và danh mục
function generateUniqueId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Sinh SKU tự động
function generateSKU(brand, modelName, color, packaging) {
  // --- Helper ---
  const removeAccents = (str) =>
    String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
               .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const clean = (str) => str ? removeAccents(str).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

  // --- Brand (b): mapping đặc biệt, còn lại cắt 3 ký tự ---
  const BRAND_MAP = {
    HOTWHEELS: 'HW', TOMICA: 'TOM', MINIGT: 'MGT',
    MATCHBOX: 'MBX', INNO64: 'INNO', TARMACWORKS: 'TW'
  };
  const bClean = clean(brand);
  const b = BRAND_MAP[bClean] || bClean.substring(0, 3) || 'NA';

  // --- Model (m): ưu tiên cụm có số, còn lại viết tắt từ đầu ---
  const mClean = clean(modelName);
  let m = '';
  if (mClean) {
    const words = removeAccents(String(modelName)).toUpperCase()
                    .replace(/[^A-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
    const numWords = words.filter(w => /\d/.test(w));
    if (numWords.length > 0) {
      // Lấy cụm có số (tối đa 2 cụm) + thêm chữ cái đầu của 1 từ khác
      const numPart  = numWords.slice(0, 2).join('').substring(0, 6);
      const alphaPart = words.filter(w => !/\d/.test(w) && w.length > 1)
                             .map(w => w[0]).join('').substring(0, 2);
      m = (numPart + alphaPart).substring(0, 8);
    } else if (words.length === 1) {
      m = words[0].substring(0, 6);
    } else {
      // Lấy chữ cái đầu mỗi từ (tối đa 3 từ đầu, lấy 2 ký tự mỗi từ)
      m = words.slice(0, 3).map(w => w.substring(0, 2)).join('').substring(0, 8);
    }
  }
  m = m || 'X';

  // --- Color (c): chuẩn hóa sang mã tiếng Việt duy nhất ---
  // Input bất kỳ (có dấu / không dấu / tiếng Anh) → normalize về mã tiếng Việt chuẩn
  const COLOR_MAP = {
    // Đen / black
    DEN: 'DEN', BLACK: 'DEN', BK: 'DEN',
    // Trắng / white
    TRANG: 'TRANG', WHITE: 'TRANG', WH: 'TRANG',
    // Đỏ / red
    DO: 'DO', RED: 'DO', RD: 'DO',
    // Bạc / silver
    BAC: 'BAC', SILVER: 'BAC', SLV: 'BAC',
    // Vàng / yellow / gold
    VANG: 'VANG', YELLOW: 'VANG', YL: 'VANG', GOLD: 'VANG', GD: 'VANG',
    // Hồng / pink
    HONG: 'HON', HON: 'HON', PINK: 'HON', PK: 'HON',
    // Cam / orange
    CAM: 'CAM', ORANGE: 'CAM', OR: 'CAM',
    // Xám / grey / gray
    XAM: 'XAM', GREY: 'XAM', GRAY: 'XAM', GY: 'XAM',
    // Xanh lá / green
    XANHLA: 'XLA', XANH: 'XLA', GREEN: 'XLA', GR: 'XLA',
    // Xanh dương / blue
    XANHDUONG: 'XDUONG', BLUE: 'XDUONG', BL: 'XDUONG',
    // Tím / purple
    TIM: 'TIM', PURPLE: 'TIM', PR: 'TIM',
    // Nâu / brown
    NAU: 'NAU', BROWN: 'NAU',
    // Xanh lam đặc biệt
    TURQUOISE: 'CYAN', CYAN: 'CYAN',
  };
  const cClean = clean(color);
  // Tách từ đầu để khớp với "XANH LA" → "XANHLA"
  const cJoined = (color || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/gi, 'D').replace(/đ/g, 'D')
    .replace(/[^A-Z0-9]/g, '');
  const c = cClean ? (COLOR_MAP[cJoined] || COLOR_MAP[cClean] || cClean.substring(0, 3)) : 'NA';

  // --- Packaging (p): map phổ biến, còn lại 2 ký tự đầu ---
  const PACK_MAP = {
    BOX: 'B', BLISTER: 'BL', CARD: 'C', LOOSE: 'L',
    COHOP: 'B', KHONGHOP: 'L', MICA: 'MC'
  };
  const pClean = clean(packaging);
  const p = pClean ? (PACK_MAP[pClean] || pClean.substring(0, 2)) : 'NA';

  return `${b}-${m}-${c}-${p}`;
}

// Hàm copy SKU toàn cục
window.copySKU = function(event, sku) {
  if (event) event.stopPropagation();
  navigator.clipboard.writeText(sku).then(() => {
    let toast = document.getElementById("copyToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "copyToast";
      toast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(16,185,129,0.9);color:white;padding:8px 16px;border-radius:20px;font-size:12px;z-index:10000;transition:opacity 0.3s;opacity:0;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span style="display:flex;align-items:center;gap:6px;"><i data-lucide="check-circle" style="width:14px;height:14px;"></i> Đã copy SKU</span>`;
    if (window.lucide) window.lucide.createIcons();
    toast.style.opacity = "1";
    setTimeout(() => { toast.style.opacity = "0"; }, 2000);
  }).catch(err => console.error("Copy failed", err));
};

// Chuẩn hóa lại SKU cho toàn bộ dữ liệu (kể cả dữ liệu cũ đã có SKU)
// Xử lý collision: nếu hai xe khác (brand/model/color/packaging) sinh ra cùng SKU → thêm hậu tố -2, -3, ...
// Trả về mảng portfolioId có ít nhất 1 SKU bị thay đổi (để caller sync lên Cloud)
window.migrateLegacySKUs = function() {
  if (!state.transactions) return [];

  const changedPortfolios = [];

  for (const pId in state.transactions) {
    // Map: skuBase → { key: compositeKey, counter }
    const skuRegistry = {};
    let portfolioChanged = false;

    state.transactions[pId].forEach(tx => {
      const base = generateSKU(tx.brand, tx.modelName, tx.color, tx.packaging);
      const compositeKey = [
        (tx.modelName || '').trim().toLowerCase(),
        (tx.brand || '').trim().toLowerCase(),
        (tx.color || '').trim().toLowerCase(),
        (tx.packaging || '').trim().toLowerCase()
      ].join('||');

      let newSku;
      if (!skuRegistry[base]) {
        skuRegistry[base] = { key: compositeKey, counter: 1 };
        newSku = base;
      } else if (skuRegistry[base].key === compositeKey) {
        newSku = base;
      } else {
        skuRegistry[base].counter++;
        newSku = `${base}-${skuRegistry[base].counter}`;
      }

      if (tx.sku !== newSku) {
        tx.sku = newSku;
        portfolioChanged = true;
      }
    });

    if (portfolioChanged) changedPortfolios.push(pId);
  }

  return changedPortfolios;
};


// Lưu trạng thái vào LocalStorage
function saveStateToLocalStorage() {
  localStorage.setItem("model_car_portfolio_state", JSON.stringify(state));
}

// Tải trạng thái từ LocalStorage
function loadStateFromLocalStorage() {
  const saved = localStorage.getItem("model_car_portfolio_state");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Đảm bảo dữ liệu tải lên có đủ cấu trúc cần thiết
      if (parsed.portfolios && parsed.activePortfolioId && parsed.transactions) {
        state = parsed;
        // Đảm bảo tỷ giá tiền tệ hợp lệ
        if (!state.currency) state.currency = "VND";
        // Đảm bảo cấu hình phí Shopee hợp lệ (cho dữ liệu cũ chưa có trường này)
        if (!state.feeSettings) {
          state.feeSettings = { fee: 25, extra: 4620, operation: 5000, targetMargin: 10 };
        } else if (state.feeSettings.targetMargin === undefined) {
          state.feeSettings.targetMargin = 10;
        }
        // Đảm bảo dữ liệu Tax hợp lệ (migrate dữ liệu cũ không có tax)
        if (!state.tax) {
          state.tax = getDefaultTaxState();
        } else {
          // Migrate
          if (!state.tax.info) state.tax.info = { taxCode: '', businessName: '', address: '' };
          if (!state.tax.config) state.tax.config = { declarationTemplateName: '', declarationTemplateLastUpdated: '' };
          
          // MIGRATE: Chuyển dữ liệu base64 (rất nặng) ra khỏi state chính để tránh lag toàn app
          if (state.tax.config.declarationTemplateData) {
            localStorage.setItem('model_car_tax_template', state.tax.config.declarationTemplateData);
            delete state.tax.config.declarationTemplateData;
            localStorage.setItem("model_car_portfolio_state", JSON.stringify(state)); // lưu ngay lập tức
          }

          if (!state.tax.declarations || state.tax.declarations.length === 0) {
            state.tax.declarations = getDefaultTaxState().declarations;
          } else {
            // Loại bỏ S3a-HKD nếu người dùng đã lưu phiên bản cũ có S3a
            state.tax.declarations = state.tax.declarations.filter(d => d.id !== 'S3a-HKD');
          }
        }
      }
    } catch (e) {
      console.error("Lỗi khi đọc dữ liệu LocalStorage, sử dụng dữ liệu mặc định", e);
    }
  }
}

// --- LOGIC XỬ LÝ SỐ LIỆU TÀI CHÍNH ---

/**
 * Tính toán dữ liệu kho hàng hiện tại dựa trên lịch sử giao dịch mua/bán.
 * Tính giá mua trung bình theo phương pháp Bình quân Gia quyền (Weighted Average Cost).
 */
// --- TRẢ HÀNG: Các hàm dùng chung để tính số lượng đã trả / còn có thể trả ---
// Type mới: "return_buy" (trả hàng nhập lại NCC) và "return_sell" (khách trả hàng đã bán).
// Cả 2 type đều có trường relatedTxId trỏ tới giao dịch "buy"/"sell" gốc bị trả.
// Mỗi giao dịch trả hàng có thêm trường restockToInventory (mặc định true nếu không set):
//   - true (Có, mặc định): hàng THỰC SỰ rời khỏi/quay lại kho — ảnh hưởng số lượng tồn kho.
//   - false (Không): chỉ là điều chỉnh tiền (hoàn tiền / giảm doanh thu), hàng KHÔNG rời/về kho
//     vật lý — ví dụ hàng lỗi không thể bán lại (return_sell) hoặc NCC bù tiền nhưng không nhận
//     lại hàng (return_buy). Ta tách riêng 2 map: "restock" (ảnh hưởng kho) và "noRestock"
//     (chỉ ảnh hưởng tiền) để FIFO tính đúng cả tồn kho lẫn tài chính.

// Gom tổng số lượng đã trả cho từng giao dịch gốc, tách theo restockToInventory
// Trả về { restock: {id: qty}, noRestock: {id: qty}, total: {id: qty} }
function computeReturnedQtyMap(txs) {
  const restock = {};
  const noRestock = {};
  const total = {};
  txs.forEach(t => {
    if ((t.type === "return_buy" || t.type === "return_sell") && t.relatedTxId) {
      const qty = Number(t.qty || 0);
      const isRestock = t.restockToInventory !== false; // mặc định Có nếu chưa từng set (dữ liệu cũ)
      total[t.relatedTxId] = (total[t.relatedTxId] || 0) + qty;
      if (isRestock) {
        restock[t.relatedTxId] = (restock[t.relatedTxId] || 0) + qty;
      } else {
        noRestock[t.relatedTxId] = (noRestock[t.relatedTxId] || 0) + qty;
      }
    }
  });
  return { restock, noRestock, total };
}

// Số lượng còn có thể trả của 1 giao dịch buy/sell gốc = qty gốc - tổng đã trả trước đó (không phân biệt hoàn kho hay không)
function getReturnableQty(portfolioId, tx) {
  const txs = state.transactions[portfolioId] || [];
  const returnedMap = computeReturnedQtyMap(txs);
  const already = returnedMap.total[tx.id] || 0;
  return Math.max(0, Number(tx.qty) - already);
}

// Danh sách giao dịch "buy" hoặc "sell" còn số lượng có thể trả > 0 — dùng cho autocomplete Form Trả hàng
function getReturnableTransactions(portfolioId, sourceType) {
  // sourceType: "buy" khi làm Trả hàng nhập, "sell" khi làm Trả hàng bán
  const txs = state.transactions[portfolioId] || [];
  const returnedMap = computeReturnedQtyMap(txs);
  return txs
    .filter(tx => tx.type === sourceType)
    .map(tx => ({ ...tx, returnableQty: Math.max(0, Number(tx.qty) - (returnedMap.total[tx.id] || 0)) }))
    .filter(tx => tx.returnableQty > 0);
}

function calculateInventory(portfolioId) {
  const txs = state.transactions[portfolioId] || [];
  // Số lượng đã trả cho từng giao dịch gốc, tách theo có hoàn lại kho hay không
  const returnedMap = computeReturnedQtyMap(txs);
  const inventoryMap = {};

  // Bước 1: Gom nhóm theo xe, tách riêng buy/sell và sắp xếp theo ngày
  txs.forEach(tx => {
    const key = `${tx.modelName.trim().toLowerCase()}||${tx.brand.trim().toLowerCase()}||${(tx.color || "").trim().toLowerCase()}||${(tx.packaging || "").trim().toLowerCase()}`;

    if (!inventoryMap[key]) {
      inventoryMap[key] = {
        modelName: tx.modelName.trim(),
        brand: tx.brand.trim(),
        color: (tx.color || "").trim(),
        packaging: (tx.packaging || "").trim(),
        buyLots: [],    // { qty, unitCost, date } — các lô mua theo thứ tự thời gian
        sells: [],      // { qty, unitPrice, date }
        totalRevenue: 0,
        totalReturnLoss: 0, // Trả hàng: tổng khoản lỗ kèm theo (ship, bao bì hỏng...) khi trả hàng
        totalReturnBuyCostCredit: 0, // Trả hàng nhập KHÔNG hoàn kho: vẫn được hoàn tiền dù hàng không rời kho
        transactions: []
      };
    }

    inventoryMap[key].transactions.push(tx);

    if (tx.type === "buy") {
      // Trả hàng nhập (return_buy) CÓ hoàn kho: hàng thực sự rời kho → trừ khỏi lô này.
      // Trả hàng nhập KHÔNG hoàn kho: hàng vẫn nằm trong kho, chỉ hoàn tiền (totalReturnBuyCostCredit)
      // chứ không trừ qty của lô — nếu không sẽ làm tồn kho bị âm sai so với thực tế.
      const restockReturned = returnedMap.restock[tx.id] || 0;
      const noRestockReturned = returnedMap.noRestock[tx.id] || 0;
      const effectiveQty = Math.max(0, Number(tx.qty) - restockReturned);
      inventoryMap[key].buyLots.push({
        qty:      effectiveQty,
        unitCost: Number(tx.unitCost),
        date:     tx.date
      });
      inventoryMap[key].totalReturnBuyCostCredit += noRestockReturned * Number(tx.unitCost);
    } else if (tx.type === "sell") {
      // Trả hàng bán (return_sell) CÓ hoàn kho: hàng quay lại kho → giảm số lượng FIFO tiêu thụ
      // (để hàng "hiện diện" lại trong tồn kho) — đồng thời giảm doanh thu.
      // Trả hàng bán KHÔNG hoàn kho (hàng lỗi/không thể bán lại): vẫn giảm doanh thu như bình
      // thường, NHƯNG không được cộng lại vào tồn kho — nên vẫn tính là đã tiêu thụ trong FIFO.
      const restockReturned = returnedMap.restock[tx.id] || 0;
      const noRestockReturned = returnedMap.noRestock[tx.id] || 0;
      const fifoQty    = Math.max(0, Number(tx.qty) - restockReturned); // ảnh hưởng tồn kho & COGS
      const revenueQty = Math.max(0, Number(tx.qty) - restockReturned - noRestockReturned); // ảnh hưởng doanh thu
      inventoryMap[key].sells.push({
        qty:       fifoQty,
        unitPrice: Number(tx.unitPrice),
        date:      tx.date
      });
      inventoryMap[key].totalRevenue += revenueQty * Number(tx.unitPrice);
    }
    // return_buy / return_sell: không tự đẩy vào buyLots/sells — tác dụng của chúng đã được
    // gộp vào effectiveQty/revenueQty của giao dịch buy/sell gốc ở trên (qua returnedMap).
    // Khoản lỗ kèm theo (tiền ship trả hàng, bao bì hỏng...) luôn làm giảm lợi nhuận,
    // dù là trả hàng nhập hay trả hàng bán, dù có hoàn kho hay không.
    if (tx.type === "return_buy" || tx.type === "return_sell") {
      inventoryMap[key].totalReturnLoss += Number(tx.returnLoss || 0);
    }
  });

  // Bước 2: Với mỗi xe, chạy FIFO để xác định:
  //   - Giá vốn hàng đã bán (COGS) theo FIFO
  //   - Các lô hàng còn tồn và giá vốn của chúng
  const inventoryList = [];
  const { fee, extra, operation } = state.feeSettings || { fee: 25, extra: 4620, operation: 5000 };

  for (const key in inventoryMap) {
    const item = inventoryMap[key];

    // Sắp xếp lô mua theo ngày tăng dần (cũ nhất trước — FIFO)
    const lots = item.buyLots
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(l => ({ ...l, remaining: l.qty })); // remaining = số lượng lô chưa bán

    // Tổng số mua / bán
    const totalQtyBought = lots.reduce((s, l) => s + l.qty, 0);
    const totalQtySold   = item.sells.reduce((s, s2) => s + s2.qty, 0);
    const stockLeft      = Math.max(0, totalQtyBought - totalQtySold);

    // Sắp xếp lần bán theo ngày (để tính FIFO đúng thứ tự)
    const sellsSorted = item.sells.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    // Chạy FIFO: trừ lần lượt từng lô mua cũ nhất cho mỗi lần bán
    let totalCOGS = 0; // tổng giá vốn hàng đã bán (theo FIFO)
    let lotIdx = 0;

    for (const sell of sellsSorted) {
      let qtyToSell = sell.qty;

      while (qtyToSell > 0 && lotIdx < lots.length) {
        const lot = lots[lotIdx];
        const take = Math.min(lot.remaining, qtyToSell);

        totalCOGS      += take * lot.unitCost;
        lot.remaining  -= take;
        qtyToSell      -= take;

        if (lot.remaining === 0) lotIdx++;
      }
    }

    // Giá vốn hàng còn tồn = tổng (remaining * unitCost) của các lô chưa bán hết
    let remainingCost = 0;
    let remainingQty  = 0;
    for (const lot of lots) {
      if (lot.remaining > 0) {
        remainingCost += lot.remaining * lot.unitCost;
        remainingQty  += lot.remaining;
      }
    }

    // avgCost = giá vốn TB của hàng CÒN TỒN (không phải toàn bộ lịch sử)
    const avgCost = remainingQty > 0 ? remainingCost / remainingQty : 0;

    // Lợi nhuận ròng = doanh thu - COGS (FIFO) - khoản lỗ kèm theo trả hàng (ship, bao bì...)
    const realizedProfit = item.totalRevenue - totalCOGS - item.totalReturnLoss;

    // Giá trị tồn kho theo giá vốn thực tế còn lại
    const stockValue = remainingCost;

    // ROI = lợi nhuận / COGS (theo FIFO)
    const roi = totalCOGS > 0 ? (realizedProfit / totalCOGS) * 100 : 0;

    // Giá hòa vốn Shopee tính từ giá vốn TB của hàng tồn hiện tại
    const breakEvenPrice = avgCost > 0
      ? (avgCost + extra + operation) / (1 - fee / 100)
      : 0;

    // Tổng chi phí mua (dùng để hiển thị "Tổng chi phí" trong bảng)
    // Trừ thêm khoản đã hoàn tiền từ NCC mà KHÔNG hoàn hàng về kho (vẫn được ghi nhận là tiền đã lấy lại)
    const totalBuyCost = lots.reduce((s, l) => s + l.qty * l.unitCost, 0) - (item.totalReturnBuyCostCredit || 0);

    let oldestStockDate = null;
    const remainingLots = lots.filter(l => l.remaining > 0);
    if (remainingLots.length > 0) {
      oldestStockDate = remainingLots.reduce((min, lot) => {
        const d = (typeof parseDMYToLocalDate === "function") ? parseDMYToLocalDate(lot.date) : new Date(lot.date);
        return (!min || d < min) ? d : min;
      }, null);
    }

    inventoryList.push({
      modelName:      item.modelName,
      brand:          item.brand,
      color:          item.color,
      packaging:      item.packaging,
      stock:          stockLeft,
      totalBought:    totalQtyBought,
      totalSold:      totalQtySold,
      avgCost:        avgCost,        // ← giá vốn TB của hàng TỒN (FIFO)
      totalBuyCost:   totalBuyCost,   // ← tổng chi phí đã bỏ ra
      totalRevenue:   item.totalRevenue,
      realizedProfit: realizedProfit, // ← lợi nhuận theo FIFO (đã trừ khoản lỗ trả hàng nếu có)
      totalReturnLoss: item.totalReturnLoss, // ← tổng khoản lỗ kèm theo trả hàng (ship, bao bì...)
      stockValue:     stockValue,     // ← giá trị tồn theo FIFO
      roi:            roi,            // ← ROI theo FIFO
      txCount:        item.transactions.length,
      breakEvenPrice: breakEvenPrice, // ← hòa vốn Shopee theo giá vốn tồn
      oldestStockDate: oldestStockDate // ← ngày nhập của lô tồn cũ nhất
    });
  }

  return inventoryList;
}

/**
 * Tính toán các chỉ số tài chính tổng quan (KPIs) của Portfolio hoạt động
 */
function calculateKPIs(inventory, portfolioId) {
  let totalInventoryValue = 0;
  let totalCost = 0;
  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalReturnLoss = 0; // Trả hàng: tổng khoản lỗ kèm theo (ship, bao bì hỏng...)
  let soldCount = 0;
  let stockCount = 0;

  inventory.forEach(item => {
    totalInventoryValue += item.stockValue;
    totalCost           += item.totalBuyCost;
    totalRevenue        += item.totalRevenue;
    totalReturnLoss      += Number(item.totalReturnLoss || 0);
    // realizedProfit = totalRevenue - COGS - totalReturnLoss (đã tính đúng theo FIFO trong calculateInventory)
    // => COGS thực = totalRevenue - realizedProfit - totalReturnLoss
    totalCOGS  += (item.totalRevenue - item.realizedProfit - Number(item.totalReturnLoss || 0));
    soldCount  += item.totalSold;
    stockCount += item.stock;
  });

  const realizedProfit = totalRevenue - totalCOGS - totalReturnLoss;
  const roi = totalCOGS > 0 ? (realizedProfit / totalCOGS) * 100 : 0;

  return {
    totalInventoryValue,
    totalCost,
    totalRevenue,
    totalReturnLoss,
    realizedProfit,
    roi,
    stockCount,
    soldCount
  };
}

/**
 * Tính toán số liệu phân tách theo từng năm để phục vụ biểu đồ và bảng báo cáo.
 * Dùng FIFO để tính COGS từng năm: với mỗi giao dịch bán, lấy giá vốn từ lô mua cũ nhất còn lại.
 */
function calculateYearlyStats(portfolioId, inventoryList) {
  const txs = state.transactions[portfolioId] || [];
  // Trả hàng: tách riêng phần "hoàn kho" (ảnh hưởng tồn kho/COGS) và "không hoàn kho" (chỉ ảnh
  // hưởng tiền) giống hệt cách tính ở calculateInventory. Khoản trả được gán vào NĂM của giao dịch
  // gốc (không phải năm trả hàng) — vì bản chất đây là điều chỉnh giảm cho giao dịch đó.
  const returnedMap = computeReturnedQtyMap(txs);

  // Gom nhóm theo xe, chạy FIFO để gán fifoUnitCost cho từng giao dịch bán
  const carMap = {};
  txs.forEach(tx => {
    const key = `${tx.modelName.trim().toLowerCase()}||${tx.brand.trim().toLowerCase()}||${(tx.color || "").trim().toLowerCase()}||${(tx.packaging || "").trim().toLowerCase()}`;
    if (!carMap[key]) carMap[key] = { buys: [], sells: [] };
    if (tx.type === "buy") {
      const restockReturned = returnedMap.restock[tx.id] || 0;
      carMap[key].buys.push({ ...tx, qty: Math.max(0, Number(tx.qty) - restockReturned), unitCost: Number(tx.unitCost) });
    }
    if (tx.type === "sell") {
      const restockReturned = returnedMap.restock[tx.id] || 0;
      // fifoQty: số lượng thực tế được FIFO tiêu thụ khỏi kho (KHÔNG hoàn kho vẫn tính là đã tiêu thụ)
      carMap[key].sells.push({ ...tx, qty: Math.max(0, Number(tx.qty) - restockReturned), unitPrice: Number(tx.unitPrice) });
    }
  });

  // Map txId -> fifoUnitCost để tra khi duyệt yearly
  const fifoSellCostMap = {};

  for (const key in carMap) {
    const { buys, sells } = carMap[key];
    const lots = buys
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(b => ({ unitCost: b.unitCost, remaining: b.qty }));

    const sellsSorted = sells.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const sell of sellsSorted) {
      let qtyLeft = sell.qty;
      let totalCost = 0;
      let lotIdx = 0;

      while (qtyLeft > 0 && lotIdx < lots.length) {
        const lot = lots[lotIdx];
        const take = Math.min(lot.remaining, qtyLeft);
        totalCost    += take * lot.unitCost;
        lot.remaining -= take;
        qtyLeft      -= take;
        if (lot.remaining === 0) lotIdx++;
      }

      // avgUnitCost cho giao dịch bán này theo FIFO
      fifoSellCostMap[sell.id] = sell.qty > 0 ? totalCost / sell.qty : 0;
    }
  }

  const yearlyData = {};

  txs.forEach(tx => {
    if (!tx.date) return;
    const year = new Date(tx.date).getFullYear();
    if (isNaN(year)) return;

    if (!yearlyData[year]) {
      yearlyData[year] = {
        year, revenue: 0, purchaseCost: 0, cogs: 0, profit: 0, returnLoss: 0, buyQty: 0, sellQty: 0
      };
    }

    if (tx.type === "buy") {
      const restockReturned = returnedMap.restock[tx.id] || 0;
      const noRestockReturned = returnedMap.noRestock[tx.id] || 0;
      const fifoQty = Math.max(0, Number(tx.qty) - restockReturned); // ảnh hưởng tồn kho thực tế
      const costCredit = noRestockReturned * Number(tx.unitCost); // hoàn tiền dù hàng không rời kho
      yearlyData[year].purchaseCost += fifoQty * Number(tx.unitCost) - costCredit;
      yearlyData[year].buyQty += fifoQty;
    } else if (tx.type === "sell") {
      const restockReturned = returnedMap.restock[tx.id] || 0;
      const noRestockReturned = returnedMap.noRestock[tx.id] || 0;
      const fifoQty    = Math.max(0, Number(tx.qty) - restockReturned); // số lượng thực tế tiêu thụ khỏi kho (dùng tính COGS)
      const revenueQty = Math.max(0, Number(tx.qty) - restockReturned - noRestockReturned); // số lượng dùng tính doanh thu
      const rev               = revenueQty * Number(tx.unitPrice);
      const fifoUnitCost      = fifoSellCostMap[tx.id] || 0;
      const costOfThisSell    = fifoQty * fifoUnitCost;

      yearlyData[year].revenue  += rev;
      yearlyData[year].cogs     += costOfThisSell;
      yearlyData[year].profit   += (rev - costOfThisSell);
      yearlyData[year].sellQty  += fifoQty;
    }
    // return_buy / return_sell: không cộng doanh thu/chi phí riêng (đã gộp vào effQty của giao
    // dịch gốc ở trên) — nhưng khoản lỗ kèm theo (ship, bao bì hỏng...) là 1 chi phí thực tế phát
    // sinh tại thời điểm trả hàng, nên trừ thẳng vào lợi nhuận của NĂM XẢY RA TRẢ HÀNG.
    if (tx.type === "return_buy" || tx.type === "return_sell") {
      const loss = Number(tx.returnLoss || 0);
      yearlyData[year].profit -= loss;
      yearlyData[year].returnLoss += loss; // Lưu riêng để hiển thị minh bạch trong bảng Báo cáo năm
    }
  });

  return Object.values(yearlyData).sort((a, b) => a.year - b.year);
}

// --- LOGIC HIỂN THỊ GIAO DIỆN (UI RENDERING) ---

// Cập nhật các thẻ chỉ số KPI ở Dashboard
function renderKPIs(kpis) {
  document.getElementById("val-total-inventory").innerText = formatCurrency(kpis.totalInventoryValue);
  document.getElementById("sub-total-inventory").innerText = `Tổng số lượng tồn: ${kpis.stockCount} chiếc xe`;
  
  document.getElementById("val-total-cost").innerText = formatCurrency(kpis.totalCost);
  
  document.getElementById("val-total-revenue").innerText = formatCurrency(kpis.totalRevenue);
  document.getElementById("sub-total-revenue").innerText = `Tổng đã bán: ${kpis.soldCount} chiếc xe`;
  
  const profitEl = document.getElementById("val-net-profit");
  profitEl.innerText = formatCurrency(kpis.realizedProfit);
  
  if (kpis.realizedProfit >= 0) {
    profitEl.className = "kpi-value text-green";
  } else {
    profitEl.className = "kpi-value text-danger";
  }
  document.getElementById("sub-net-profit").innerText = `Tỷ suất ROI thực tế: ${kpis.roi.toFixed(1)}%`;

  // Trả hàng: tổng khoản lỗ kèm theo (ship, bao bì hỏng...) đã trừ vào lợi nhuận ròng ở trên
  const returnLossEl = document.getElementById("val-return-loss");
  if (returnLossEl) {
    returnLossEl.innerText = formatCurrency(kpis.totalReturnLoss || 0);
  }
}

// Nạp danh sách các danh mục vào phần chọn
function renderPortfolioSelectors() {
  const select = document.getElementById("portfolioSelect");
  const listManager = document.getElementById("listPortfolios");
  
  select.innerHTML = "";
  if (listManager) listManager.innerHTML = "";

  state.portfolios.forEach(p => {
    // Dropdown chọn ở Header/Sidebar
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.text = p.name;
    opt.selected = (p.id === state.activePortfolioId);
    select.appendChild(opt);

    // Danh sách quản lý trong Cài đặt
    if (listManager) {
      const row = document.createElement("div");
      row.className = "portfolio-item-row";
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "portfolio-item-name";
      nameSpan.innerText = p.name;
      if (p.id === state.activePortfolioId) {
        nameSpan.innerHTML += " <span class='badge badge-in-stock'>Đang chạy</span>";
      }

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "portfolio-item-actions";

      // Không cho xóa danh mục duy nhất còn lại
      if (state.portfolios.length > 1) {
        const delBtn = document.createElement("button");
        delBtn.innerHTML = "<i data-lucide='trash-2'></i>";
        delBtn.title = "Xóa danh mục";
        delBtn.onclick = () => handleDeletePortfolio(p.id, p.name);
        actionsDiv.appendChild(delBtn);
      }

      row.appendChild(nameSpan);
      row.appendChild(actionsDiv);
      listManager.appendChild(row);
    }
  });

  // Load lại các icon Lucide mới chèn vào DOM
  lucide.createIcons();
}

// Nạp danh sách xe còn hàng vào bộ nhớ tạm để dùng cho autocomplete Bán hàng
function renderSellFormModelSelect(inventory) {
  const hiddenInput = document.getElementById("sellModelSelect");
  const textInput = document.getElementById("sellModelInput");
  const previousValue = hiddenInput.value;

  // Lọc chỉ lấy các xe còn tồn kho > 0, lưu lại để autocomplete sử dụng
  const activeStock = inventory.filter(item => item.stock > 0);
  window.sellableStock = activeStock;

  // Phục hồi lựa chọn cũ nếu nó vẫn còn hợp lệ
  const stillValid = previousValue && activeStock.some(item => `${item.modelName}||${item.brand}` === previousValue);

  if (!stillValid) {
    hiddenInput.value = "";
    textInput.value = "";
    document.getElementById("sellModelCostInfo").classList.add("hidden");
  }
}

// Vẽ bảng các xe sinh lời nhiều nhất ở Dashboard
function renderTopModelsTable(inventory) {
  const tbody = document.querySelector("#topModelsTable tbody");
  tbody.innerHTML = "";

  // Lọc các xe đã bán được và sắp xếp theo lợi nhuận thực tế giảm dần
  const topModels = inventory
    .filter(item => item.totalSold > 0)
    .sort((a, b) => b.realizedProfit - a.realizedProfit)
    .slice(0, 5); // Lấy top 5

  if (topModels.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Chưa có giao dịch bán nào được ghi nhận để tính lợi nhuận.</td></tr>`;
    return;
  }

  topModels.forEach(item => {
    const row = document.createElement("tr");
    
    // Tính giá bán trung bình
    const avgSellPrice = item.totalSold > 0 ? (item.totalRevenue / item.totalSold) : 0;

    row.innerHTML = `
      <td>
        <div class="car-cell">
          <div class="car-icon-avatar">🚗</div>
          <div class="car-info-detail">
            <span class="car-name">${item.modelName}</span>
          </div>
        </div>
      </td>
      <td><span class="text-bold">${item.brand}</span></td>
      <td class="text-center text-bold">${item.totalSold}</td>
      <td>${formatCurrency(item.avgCost)}</td>
      <td class="text-green text-bold">${formatCurrency(item.totalRevenue)}</td>
      <td class="${item.realizedProfit >= 0 ? 'text-green' : 'text-danger'} text-bold">${formatCurrency(item.realizedProfit)}</td>
      <td><span class="badge ${item.realizedProfit >= 0 ? 'badge-in-stock' : 'badge-out-of-stock'}">${item.roi.toFixed(1)}%</span></td>
    `;
    tbody.appendChild(row);
  });
}

// Helper: tính mức cảnh báo tồn kho
function getSlowModelRiskLevel(daysInStock, neverSold) {
  let level = 0; // 0=Bình thường, 1=Cần theo dõi, 2=Cảnh báo, 3=Nguy cơ cao
  if (daysInStock >= 60) level = 3;
  else if (daysInStock >= 45) level = 2;
  else if (daysInStock >= 30) level = 1;
  else level = 0;
  // Chưa bán lần nào và >= 45 ngày: tăng 1 mức (tối đa 3)
  if (neverSold && daysInStock >= 45) level = Math.min(3, level + 1);
  return level;
}

function renderSlowModelsTable(inventory) {
  const tbody = document.getElementById("slowModelsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const today = new Date();
  const txs = state.transactions[state.activePortfolioId] || [];

  const riskLabels = [
    { label: "B\u00ecnh th\u01b0\u1eddng", cls: "badge", style: "background:#1e3a5f;color:#60a5fa;" },
    { label: "C\u1ea7n theo d\u00f5i", cls: "badge", style: "background:#3b2f00;color:#fbbf24;" },
    { label: "C\u1ea3nh b\u00e1o",     cls: "badge", style: "background:#431407;color:#fb923c;" },
    { label: "Nguy c\u01a1 cao",   cls: "badge", style: "background:#450a0a;color:#f87171;" }
  ];

  const slowModels = inventory
    .filter(item => item.stock > 0)
    .map(item => {
      const firstBuyDate = item.oldestStockDate || today;
      const daysInStock = Math.floor((today - firstBuyDate) / (1000 * 60 * 60 * 24));
      const neverSold   = item.totalSold === 0;
      const stockValue  = item.stock * item.avgCost;
      const riskLevel   = getSlowModelRiskLevel(daysInStock, neverSold);
      return { ...item, firstBuyDate, daysInStock, neverSold, stockValue, riskLevel };
    })
    .sort((a, b) =>
      b.riskLevel !== a.riskLevel ? b.riskLevel - a.riskLevel :
      b.daysInStock !== a.daysInStock ? b.daysInStock - a.daysInStock :
      b.stockValue - a.stockValue
    );

  if (slowModels.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:20px 0;">Kh\u00f4ng c\u00f3 xe n\u00e0o \u0111ang t\u1ed3n kho.</td></tr>`;
    return;
  }

  slowModels.forEach(item => {
    const risk = riskLabels[item.riskLevel];
    const daysHtml = item.daysInStock >= 60
      ? `<span style="color:#f87171;font-weight:700;">${item.daysInStock} ng\u00e0y</span>`
      : `<span class="${item.daysInStock >= 30 ? 'text-orange' : 'text-muted'}">${item.daysInStock} ng\u00e0y</span>`;

    const riskBadge = `<span class="${risk.cls}" style="${risk.style}font-size:11px;padding:2px 8px;border-radius:99px;white-space:nowrap;">${risk.label}</span>`;
    const neverSoldBadge = item.neverSold
      ? ` <span class="badge" style="background:#1a1a2e;color:#a78bfa;font-size:10px;padding:2px 7px;border-radius:99px;white-space:nowrap;">Ch\u01b0a b\u00e1n l\u1ea7n n\u00e0o</span>`
      : "";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="car-cell">
          <div class="car-icon-avatar">\ud83c\udfce\ufe0f</div>
          <div class="car-info-detail">
            <span class="car-name">${item.modelName}</span>
            ${item.color ? `<span style="font-size:11px;color:var(--text-muted);">M\u00e0u: ${item.color}${item.packaging ? ' | ' + item.packaging : ''}</span>` : ''}
          </div>
        </div>
      </td>
      <td><span class="text-bold">${item.brand}</span></td>
      <td class="text-bold">${item.stock} chi\u1ebfc</td>
      <td>${formatDate(typeof dateToISO === "function" ? dateToISO(item.firstBuyDate) : item.firstBuyDate.toISOString().split("T")[0])}</td>
      <td>${daysHtml}</td>
      <td>${formatCurrency(item.avgCost)}</td>
      <td class="text-orange text-bold">${formatCurrency(item.breakEvenPrice)}</td>
      <td class="text-bold">${formatCurrency(item.stockValue)}</td>
      <td>${riskBadge}${neverSoldBadge}</td>
    `;
    tbody.appendChild(row);
  });
}

// BẢNG CHI TIẾT KHO HÀNG (Tab Kho Hàng)
function renderInventoryTable(inventory) {
  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = "";

  // Lấy các tham số lọc & tìm kiếm
  const searchQuery = document.getElementById("inventorySearchInput").value.toLowerCase().trim();
  const filterBrand = document.getElementById("filterBrandSelect").value;
  const filterStock = document.getElementById("filterStockSelect").value;
  const sortBy = document.getElementById("sortSelect").value;

  // Áp dụng bộ lọc
  let filtered = inventory.filter(item => {
    // 1. Lọc theo tìm kiếm (tên xe hoặc hãng hoặc màu hoặc đóng gói)
    const matchesSearch = item.modelName.toLowerCase().includes(searchQuery) || 
                          item.brand.toLowerCase().includes(searchQuery) ||
                          (item.color || "").toLowerCase().includes(searchQuery) ||
                          (item.packaging || "").toLowerCase().includes(searchQuery);
    
    // 2. Lọc theo hãng sản xuất
    const matchesBrand = filterBrand === "all" || item.brand.toLowerCase() === filterBrand.toLowerCase();
    
    // 3. Lọc theo trạng thái kho
    let matchesStock = true;
    if (filterStock === "in_stock") {
      matchesStock = item.stock > 0;
    } else if (filterStock === "out_of_stock") {
      matchesStock = item.stock === 0;
    }

    return matchesSearch && matchesBrand && matchesStock;
  });

  // Áp dụng sắp xếp
  filtered.sort((a, b) => {
    if (sortBy === "name_asc") {
      return a.modelName.localeCompare(b.modelName);
    } else if (sortBy === "stock_desc") {
      return b.stock - a.stock;
    } else if (sortBy === "avg_cost_desc") {
      return b.avgCost - a.avgCost;
    } else if (sortBy === "profit_desc") {
      return b.realizedProfit - a.realizedProfit;
    } else if (sortBy === "roi_desc") {
      return b.roi - a.roi;
    }
    return 0;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding: 40px 0;">Không tìm thấy chiếc xe mô hình nào khớp với bộ lọc của bạn.</td></tr>`;
    document.getElementById("inventoryGridContainer").innerHTML = `<div class="text-center text-muted" style="grid-column: 1/-1; padding: 40px 0;">Không có xe mô hình nào hiển thị.</div>`;
    return;
  }

  // Khởi tạo khung hiển thị cho Grid View
  const gridContainer = document.getElementById("inventoryGridContainer");
  gridContainer.innerHTML = "";

  filtered.forEach((item, itemIndex) => {
    // Tính giá bán trung bình
    const avgSellPrice = item.totalSold > 0 ? (item.totalRevenue / item.totalSold) : 0;
    const isOutOfStock = item.stock === 0;

    const { fee = 25, extra = 4620, operation = 5000, targetMargin = 10 } = state.feeSettings || {};
    const denominator = 1 - (fee / 100) - (targetMargin / 100);
    const targetPrice = denominator > 0 ? (item.avgCost + extra + operation) / denominator : 0;

    // --- RENDER TABLE ROW (Collapsible) ---
    const row = document.createElement("tr");
    row.className = "clickable-row";

    const imgKey = buildCarImageKey(item.modelName, item.brand, item.color, item.packaging);
    const imgPath = getCarImage(imgKey);
    const thumbHtml = imgPath
      ? `<div class="inv-thumb-wrap">
           <div class="inv-thumb" onclick="event.stopPropagation();openImgLightbox('${imgPath}','${item.modelName.replace(/'/g,"\\'")}')">
             <img src="${imgPath}" alt="${item.modelName}" onerror="this.parentElement.innerHTML='<span class=\\'thumb-placeholder\\'>🏎️</span>'">
           </div>
           <label class="inv-thumb-edit" title="Đổi ảnh" onclick="event.stopPropagation();">
             <input type="file" accept=".jpg,.jpeg,.png,.webp" style="display:none;" onchange="changeCarImage(event,'${imgKey}')">📷
           </label>
         </div>`
      : `<div class="inv-thumb-wrap">
           <div class="inv-thumb">
             <span class="thumb-placeholder">🏎️</span>
           </div>
           <label class="inv-thumb-edit" title="Thêm ảnh" onclick="event.stopPropagation();">
             <input type="file" accept=".jpg,.jpeg,.png,.webp" style="display:none;" onchange="changeCarImage(event,'${imgKey}')">📷
           </label>
         </div>`;

    row.innerHTML = `
      <td style="padding:8px 10px;">${thumbHtml}</td>
      <td>
        <div class="car-cell">
          <i data-lucide="chevron-down" style="width:14px; height:14px; margin-right:4px; color:var(--text-muted); transition: transform 0.2s;"></i>
          <div class="car-info-detail">
            <span class="car-name">${item.modelName}</span>
            <span class="car-brand">
              ${item.brand}
              ${item.color ? ` | <span style="color:var(--text-muted); font-size:11px;">Màu: ${item.color}</span>` : ''}
              ${item.packaging ? ` | <span style="color:var(--text-muted); font-size:11px;">Gói: ${item.packaging}</span>` : ''}
            </span>
            <div class="sku-inline">
              <span class="badge-sku">${generateSKU(item.brand, item.modelName, item.color, item.packaging)}</span>
              <button class="sku-copy-btn" onclick="window.copySKU(event, '${generateSKU(item.brand, item.modelName, item.color, item.packaging)}')"><i data-lucide="copy" style="width:12px;height:12px;"></i></button>
            </div>
          </div>
        </div>
      </td>
      <td>
        <div style="display:flex; flex-direction:column;">
          <span class="text-bold">${item.stock} chiếc tồn</span>
          <span style="font-size:11px; color:var(--text-muted)">Đã nhập: ${item.totalBought}</span>
        </div>
      </td>
      <td>${formatCurrency(item.avgCost)}</td>
      <td>
        <div style="display:flex;flex-direction:column;">
          <span class="text-orange text-bold">${formatCurrency(item.breakEvenPrice)}</span>
          <span style="font-size:10px;color:var(--text-muted);">Shopee hòa vốn</span>
        </div>
      </td>
      <td>
        <div style="display:flex;flex-direction:column;">
          <span class="text-orange text-bold">${formatCurrency(targetPrice)}</span>
          <span style="font-size:10px;color:var(--text-muted);">Mục tiêu</span>
        </div>
      </td>
      <td class="text-bold">${formatCurrency(item.totalBuyCost)}</td>
      <td>
        ${item.totalSold > 0 
          ? `<div style="display:flex; flex-direction:column;">
              <span class="text-orange text-bold">${item.totalSold} chiếc bán</span>
              <span style="font-size:11px; color:var(--text-muted)">Giá bán TB: ${formatCurrency(avgSellPrice)}</span>
             </div>`
          : `<span class="text-muted">—</span>`
        }
      </td>
      <td class="text-green text-bold">${item.totalRevenue > 0 ? formatCurrency(item.totalRevenue) : "0 vnd"}</td>
      <td class="${item.realizedProfit >= 0 ? 'text-green' : 'text-danger'} text-bold">
        ${formatCurrency(item.realizedProfit)}
      </td>
      <td>
        <span class="badge ${item.realizedProfit >= 0 ? 'badge-in-stock' : 'badge-out-of-stock'}">
          ${item.roi.toFixed(1)}%
        </span>
      </td>
      <td>
        <div style="display:flex; gap: 8px;">
          ${!isOutOfStock 
            ? `<button class="btn btn-orange btn-sm" onclick="event.stopPropagation(); quickSellCar('${item.modelName.replace(/'/g,"\\'")}', '${item.brand.replace(/'/g,"\\'")}', '${(item.color || "").replace(/'/g,"\\'")}', '${(item.packaging || "").replace(/'/g,"\\'")}')" title="Bán nhanh xe này">
                <i data-lucide="shopping-bag" style="width:12px; height:12px;"></i> Bán xe
               </button>`
            : `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.5; cursor:not-allowed;">Hết hàng</button>`
          }
        </div>
      </td>
    `;

    // Lọc lịch sử giao dịch của riêng xe này (gồm cả Màu sắc & Đóng gói)
    const txs = state.transactions[state.activePortfolioId] || [];
    const itemTxs = txs.filter(tx =>
      tx.modelName.trim().toLowerCase() === item.modelName.trim().toLowerCase() &&
      tx.brand.trim().toLowerCase() === item.brand.trim().toLowerCase() &&
      (tx.color || "").trim().toLowerCase() === (item.color || "").trim().toLowerCase() &&
      (tx.packaging || "").trim().toLowerCase() === (item.packaging || "").trim().toLowerCase()
    ).sort((a, b) => new Date(b.date) - new Date(a.date));

    let txItemsHtml = "";
    if (itemTxs.length === 0) {
      txItemsHtml = `<div class="text-center text-muted" style="padding: 12px;">Chưa có giao dịch nào cho xe này.</div>`;
    } else {
      itemTxs.forEach(tx => {
        const isBuy = tx.type === "buy";
        const isReturnBuy = tx.type === "return_buy";
        const isReturnSell = tx.type === "return_sell";
        const price = (isBuy || isReturnBuy) ? Number(tx.unitCost) : Number(tx.unitPrice);
        const total = tx.qty * price;

        let typeText = "Bán";
        let typeCls = "sell";
        if (isBuy) { typeText = "Mua"; typeCls = "buy"; }
        else if (isReturnBuy) { typeText = "Hoàn"; typeCls = "return"; }
        else if (isReturnSell) { typeText = "Hoàn"; typeCls = "return"; }

        const notesText = tx.notes ? `<span class="details-tx-notes">(${tx.notes})</span>` : "";
        const channelText = (tx.type === "sell" || isReturnSell) && tx.channel ? `<span class="badge badge-in-stock" style="font-size:9px;margin-right:8px;">${tx.channel}</span>` : "";
        // Trả hàng: hiển thị thêm khoản lỗ kèm theo (ship, bao bì...), trạng thái hoàn kho, và liên kết giao dịch gốc
        const returnExtra = (isReturnBuy || isReturnSell)
          ? `<span class="details-tx-notes">(Liên kết #${String(tx.relatedTxId || "").slice(-6)}${Number(tx.returnLoss || 0) > 0 ? `, lỗ kèm theo: -${formatCurrency(Number(tx.returnLoss))}` : ''}${tx.restockToInventory === false ? ', ⛔ không hoàn kho' : ''})</span>`
          : "";
        txItemsHtml += `
          <div class="details-tx-item">
            <div class="details-tx-left">
              <span class="details-tx-badge ${typeCls}">${typeText}</span>
              <span class="details-tx-date">${formatDate(tx.date)}</span>
              <span class="details-tx-qty-price">SL: <strong>${tx.qty}</strong> @ <strong>${formatCurrency(price)}</strong></span>
              ${notesText}${returnExtra}
            </div>
            <div class="details-tx-right">
              ${channelText}
              <span class="details-tx-total">${formatCurrency(total)}</span>
              <div class="details-tx-actions">
                <button class="btn-edit" onclick="event.stopPropagation();openEditTxModal('${tx.id}')" title="Sửa">
                  <i data-lucide="edit-2" style="width:12px;height:12px;"></i>
                </button>
                <button class="btn-delete" onclick="event.stopPropagation();deleteTransaction('${tx.id}')" title="Xóa">
                  <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                </button>
              </div>
            </div>
          </div>`;
      });
    }

    const detailsRow = document.createElement("tr");
    detailsRow.className = "details-row hidden";
    detailsRow.id = `details-row-${itemIndex}`;
    detailsRow.innerHTML = `
      <td colspan="12" class="details-cell">
        <div class="details-container">
          <div class="details-header">
            <h4>Lịch sử giao dịch: ${item.brand} - ${item.modelName}${item.color ? ` (${item.color})` : ''}${item.packaging ? ` - ${item.packaging}` : ''}</h4>
            <div style="font-family: monospace; font-size: 12px; color: #64748b; margin-bottom: 8px;">SKU: ${generateSKU(item.brand, item.modelName, item.color, item.packaging)}</div>
            <div class="details-summary">
              <span>Tổng đầu tư: <strong>${formatCurrency(item.totalBuyCost)}</strong></span>
              <span>Lợi nhuận ròng: <strong class="${item.realizedProfit >= 0 ? 'text-green' : 'text-danger'}">${formatCurrency(item.realizedProfit)}</strong></span>
              <span>ROI: <strong class="${item.realizedProfit >= 0 ? 'text-green' : 'text-danger'}">${item.roi.toFixed(1)}%</strong></span>
            </div>
          </div>
          <div class="details-tx-list">${txItemsHtml}</div>
        </div>
      </td>`;

    row.onclick = (e) => {
      if (e.target.closest("button") || e.target.closest("a")) return;
      const details = document.getElementById(`details-row-${itemIndex}`);
      if (details) {
        const isHidden = details.classList.contains("hidden");
        details.classList.toggle("hidden");
        const chevron = row.querySelector("[data-lucide='chevron-down']");
        if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
      }
    };

    tbody.appendChild(row);
    tbody.appendChild(detailsRow);

    // --- RENDER GRID CARD ---
    const card = document.createElement("div");
    card.className = "car-card";
    card.innerHTML = `
      <div class="car-card-header">
        <div>
          <h4>${item.modelName}</h4>
          <span>
            ${item.brand}
            ${item.color ? ` | Màu: ${item.color}` : ''}
            ${item.packaging ? ` | Gói: ${item.packaging}` : ''}
          </span>
          <div class="sku-inline">
            <span class="badge-sku">SKU: ${generateSKU(item.brand, item.modelName, item.color, item.packaging)}</span>
            <button class="sku-copy-btn" onclick="window.copySKU(event, '${generateSKU(item.brand, item.modelName, item.color, item.packaging)}')"><i data-lucide="copy" style="width:12px;height:12px;"></i></button>
          </div>
        </div>
        <span class="badge ${isOutOfStock ? 'badge-out-of-stock' : 'badge-in-stock'}">
          ${isOutOfStock ? 'Hết hàng' : `Còn ${item.stock} chiếc`}
        </span>
      </div>

      <div class="car-card-visual" style="cursor:pointer;" onclick="${imgPath ? `openImgLightbox('${imgPath}','${item.modelName.replace(/'/g,"\\'")}')` : 'void(0)'}">
        ${imgPath
          ? `<img src="${imgPath}" alt="${item.modelName}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.outerHTML='🚗'">`
          : '🚗'}
        <div class="brand-overlay">${item.brand}</div>
      </div>

      <div class="car-card-stats">
        <div class="stat-item">
          <span class="stat-label">Tổng nhập</span>
          <span class="stat-value">${item.totalBought} chiếc</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Giá mua TB</span>
          <span class="stat-value">${formatCurrency(item.avgCost)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Giá hòa vốn Shopee</span>
          <span class="stat-value text-orange">${formatCurrency(item.breakEvenPrice)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Đã bán</span>
          <span class="stat-value text-orange">${item.totalSold} chiếc</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Doanh thu</span>
          <span class="stat-value text-green">${formatCurrency(item.totalRevenue)}</span>
        </div>
      </div>

      <div class="car-card-footer">
        <div class="card-profit-group">
          <span class="stat-label">Lợi nhuận ròng</span>
          <span class="stat-value ${item.realizedProfit >= 0 ? 'text-green' : 'text-danger'}">
            ${formatCurrency(item.realizedProfit)} (${item.roi.toFixed(0)}%)
          </span>
        </div>
        ${!isOutOfStock 
          ? `<button class="btn btn-orange btn-sm" onclick="quickSellCar('${item.modelName.replace(/'/g,"\\'")}', '${item.brand.replace(/'/g,"\\'")}', '${(item.color || "").replace(/'/g,"\\'")}', '${(item.packaging || "").replace(/'/g,"\\'")}')">
              <i data-lucide="shopping-bag" style="width:12px; height:12px;"></i> Bán xe
             </button>`
          : ""
        }
      </div>
    `;
    gridContainer.appendChild(card);
  });

  lucide.createIcons();
}

// Nạp động danh sách các năm có giao dịch vào dropdown "Năm" (giữ lại lựa chọn hiện tại nếu còn hợp lệ)
function populateHistoryYearFilter(txs, currentValue) {
  const select = document.getElementById("historyFilterYear");
  if (!select) return;

  const years = new Set();
  txs.forEach(tx => {
    if (tx.date) years.add(new Date(tx.date).getFullYear());
  });

  const sortedYears = Array.from(years).sort((a, b) => b - a);
  const optionsHtml = ['<option value="all">Tất cả các năm</option>']
    .concat(sortedYears.map(y => `<option value="${y}">Năm ${y}</option>`));

  const newHtml = optionsHtml.join("");
  if (select.innerHTML !== newHtml) {
    select.innerHTML = newHtml;
  }

  // Phục hồi lựa chọn cũ nếu vẫn còn hợp lệ
  if (currentValue && (currentValue === "all" || sortedYears.includes(Number(currentValue)))) {
    select.value = currentValue;
  } else {
    select.value = "all";
  }
}

// BẢNG LỊCH SỬ GIAO DỊCH CHI TIẾT (Tab Giao dịch)
function renderTransactionHistoryTable(portfolioId, inventoryList) {
  const tbody = document.getElementById("transactionHistoryTableBody");
  tbody.innerHTML = "";

  const filterType = document.getElementById("historyFilterType").value;
  const filterYear = document.getElementById("historyFilterYear").value;
  const filterChannelEl = document.getElementById("historyFilterChannel");
  const filterChannel = filterChannelEl ? filterChannelEl.value : "all";
  const sortOrderEl = document.getElementById("historySort");
  const sortOrder = sortOrderEl ? sortOrderEl.value : "desc";

  let txs = state.transactions[portfolioId] || [];

  // Nạp động danh sách các năm có giao dịch vào dropdown "Năm"
  populateHistoryYearFilter(txs, filterYear);

  // Tạo map giá trung bình để hiện lợi nhuận tạm tính cho từng đơn bán lẻ
  const avgCostMap = {};
  inventoryList.forEach(item => {
    avgCostMap[`${item.modelName.toLowerCase()}||${item.brand.toLowerCase()}||${(item.color || "").toLowerCase()}||${(item.packaging || "").toLowerCase()}`] = item.avgCost;
  });

  // Lọc theo loại
  if (filterType !== "all") {
    txs = txs.filter(tx => tx.type === filterType);
  }

  // Lọc theo năm
  if (filterYear !== "all") {
    txs = txs.filter(tx => String(new Date(tx.date).getFullYear()) === filterYear);
  }

  // Lọc theo kênh bán (áp dụng cho giao dịch bán và trả hàng bán, vì cả 2 đều có trường channel)
  if (filterChannel !== "all") {
    txs = txs.filter(tx => (tx.type === "sell" || tx.type === "return_sell") && tx.channel === filterChannel);
  }

  // Sắp xếp theo ngày theo lựa chọn (mới nhất / cũ nhất)
  const sortedTxs = [...txs].sort((a, b) => {
    const diff = new Date(a.date) - new Date(b.date);
    return sortOrder === "asc" ? diff : -diff;
  });

  if (sortedTxs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 30px 0;">Chưa ghi nhận giao dịch nào.</td></tr>`;
    return;
  }

  sortedTxs.forEach(tx => {
    const row = document.createElement("tr");
    
    const isBuy = tx.type === "buy";
    const isReturnBuy = tx.type === "return_buy";
    const isReturnSell = tx.type === "return_sell";
    // Với giao dịch bán qua Shopee: nếu có taxUnitPrice (giá đăng bán/doanh thu Shopee) thì ưu tiên hiển thị giá này
    const isShopee = tx.type === "sell" && tx.channel === "Shopee";
    const displayUnitPrice = (isBuy || isReturnBuy)
      ? Number(tx.unitCost)
      : (isShopee && tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null && tx.taxUnitPrice > 0)
        ? Number(tx.taxUnitPrice)
        : Number(tx.unitPrice);
    const totalAmount = Number(tx.qty) * displayUnitPrice;

    // Mã ngắn của giao dịch gốc để hiển thị badge liên kết trong 2 nhánh trả hàng bên dưới
    const relatedShort = tx.relatedTxId ? `#${String(tx.relatedTxId).slice(-6)}` : "—";

    let detailHtml = "";
    if (isBuy) {
      detailHtml = `<span style="font-size:12px; color:var(--text-muted)">${tx.notes || "—"}</span>`;
    } else if (isReturnBuy) {
      // Trả hàng nhập: hiển thị badge trả hàng + liên kết tới giao dịch mua gốc + khoản lỗ kèm theo (nếu có)
      const lossText = Number(tx.returnLoss || 0) > 0
        ? `<span style="font-size:11px;color:var(--danger);">Lỗ kèm theo: -${formatCurrency(Number(tx.returnLoss))}</span>`
        : '';
      const restockText = tx.restockToInventory === false
        ? `<span style="font-size:11px;color:var(--danger);">⛔ Không hoàn kho</span>`
        : '';
      detailHtml = `
        <div style="display:flex; flex-direction:column;">
          <span class="badge badge-return" style="align-self:flex-start; margin-bottom:2px;">
            <i data-lucide="rotate-ccw" style="width:10px;height:10px;"></i> Trả NCC · ${relatedShort}
          </span>
          ${lossText}
          ${restockText}
          ${tx.notes ? `<span style="font-size:11px;color:var(--text-muted);">${tx.notes}</span>` : ''}
        </div>
      `;
    } else if (isReturnSell) {
      // Trả hàng bán: hiển thị badge trả hàng + kênh gốc + liên kết + khoản lỗ kèm theo (nếu có)
      const lossText = Number(tx.returnLoss || 0) > 0
        ? `<span style="font-size:11px;color:var(--danger);">Lỗ kèm theo: -${formatCurrency(Number(tx.returnLoss))}</span>`
        : '';
      const restockText = tx.restockToInventory === false
        ? `<span style="font-size:11px;color:var(--danger);">⛔ Không hoàn kho</span>`
        : '';
      detailHtml = `
        <div style="display:flex; flex-direction:column;">
          <span class="badge badge-return" style="align-self:flex-start; margin-bottom:2px;">
            <i data-lucide="rotate-ccw" style="width:10px;height:10px;"></i> Khách trả (${tx.channel || '—'}) · ${relatedShort}
          </span>
          ${lossText}
          ${restockText}
          ${tx.notes ? `<span style="font-size:11px;color:var(--text-muted);">${tx.notes}</span>` : ''}
        </div>
      `;
    } else {
      // Bán: Hiển thị kênh bán + Lợi nhuận của đơn bán này dựa trên giá mua trung bình
      const key = `${tx.modelName.toLowerCase()}||${tx.brand.toLowerCase()}||${(tx.color || "").toLowerCase()}||${(tx.packaging || "").toLowerCase()}`;
      const avgCost = avgCostMap[key] || 0;
      // Lợi nhuận thực tế luôn tính trên unitPrice thực nhận (không phải giá khai Shopee)
      const actualUnitPrice = Number(tx.unitPrice);
      const profitFromThisTx = Number(tx.qty) * (actualUnitPrice - avgCost);

      detailHtml = `
        <div style="display:flex; flex-direction:column;">
          <span class="badge badge-in-stock" style="align-self: flex-start; margin-bottom: 2px;">Kênh: ${tx.channel}</span>
          ${isShopee && tx.taxUnitPrice ? `<span style="font-size:10px;color:var(--text-muted);">Giá thực nhận: ${formatCurrency(actualUnitPrice)}</span>` : ''}
          <span style="font-size:11px;" class="${profitFromThisTx >= 0 ? 'text-green' : 'text-danger'}">
            Lời: ${formatCurrency(profitFromThisTx)}
          </span>
        </div>
      `;
    }

    let typeLabel = 'BÁN (Xuất)';
    let typeBadgeClass = 'badge-sell';
    if (isBuy) { typeLabel = 'MUA (Nhập)'; typeBadgeClass = 'badge-buy'; }
    else if (isReturnBuy) { typeLabel = 'HOÀN (Trả NCC)'; typeBadgeClass = 'badge-return'; }
    else if (isReturnSell) { typeLabel = 'HOÀN (Khách trả)'; typeBadgeClass = 'badge-return'; }

    row.innerHTML = `
      <td>${formatDate(tx.date)}</td>
      <td>
        <span class="badge ${typeBadgeClass}">
          ${typeLabel}
        </span>
      </td>
      <td>
        <div style="display:flex; flex-direction:column;">
          <span class="text-bold">${tx.modelName}</span>
          ${(tx.color || tx.packaging) 
            ? `<span style="font-size:11px; color:var(--text-muted)">
                 ${tx.color ? `Màu: ${tx.color}` : ''}
                 ${tx.color && tx.packaging ? ' | ' : ''}
                 ${tx.packaging ? `Gói: ${tx.packaging}` : ''}
               </span>`
            : ''
          }
        </div>
      </td>
      <td>${tx.brand}</td>
      <td class="text-center text-bold">${tx.qty}</td>
      <td>${formatCurrency(displayUnitPrice)}</td>
      <td class="text-bold">${formatCurrency(totalAmount)}</td>
      <td>${detailHtml}</td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" onclick="openEditTxModal('${tx.id}')" title="Sửa giao dịch này">
            <i data-lucide="pencil" style="width:12px; height:12px;"></i>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="deleteTransaction('${tx.id}')" title="Xóa giao dịch này" style="color:var(--danger); border-color: rgba(239,68,68,0.2);">
            <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });

  lucide.createIcons();
}

// BẢNG BÁO CÁO NĂM (Tab Báo cáo năm)
function renderYearlyReportTable(yearlyStats) {
  const tbody = document.getElementById("yoyStatsTableBody");
  tbody.innerHTML = "";

  if (yearlyStats.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 30px 0;">Chưa có đủ số liệu giao dịch theo năm. Vui lòng thêm các giao dịch mua/bán ở các năm khác nhau.</td></tr>`;
    return;
  }

  yearlyStats.forEach(stat => {
    const row = document.createElement("tr");
    
    // Tỷ suất ROI theo năm
    const yearlyRoi = stat.cogs > 0 ? (stat.profit / stat.cogs) * 100 : 0;

    row.innerHTML = `
      <td class="text-bold" style="font-size: 16px; color:#a5b4fc">${stat.year}</td>
      <td class="text-green text-bold">${formatCurrency(stat.revenue)}</td>
      <td>${formatCurrency(stat.cogs)}</td>
      <td class="text-danger">${stat.returnLoss > 0 ? `-${formatCurrency(stat.returnLoss)}` : '—'}</td>
      <td class="${stat.profit >= 0 ? 'text-green' : 'text-danger'} text-bold">${formatCurrency(stat.profit)}</td>
      <td class="text-center">${stat.buyQty} chiếc</td>
      <td class="text-center">${stat.sellQty} chiếc</td>
      <td><span class="badge ${stat.profit >= 0 ? 'badge-in-stock' : 'badge-out-of-stock'}">${yearlyRoi.toFixed(1)}%</span></td>
    `;
    tbody.appendChild(row);
  });
}

// HIỂN THỊ CHI TIẾT HIỆU QUẢ KÊNH BÁN & TỔNG HỢP NHẬN ĐỊNH
function renderFinancialInsights(portfolioId, yearlyStats, inventoryList) {
  const txs = state.transactions[portfolioId] || [];
  
  // 1. Phân tích các Kênh bán hàng (Facebook vs Shopee vs Trực tiếp)
  const channelData = {
    Facebook: { rev: 0, qty: 0 },
    Shopee: { rev: 0, qty: 0 },
    "Trực tiếp": { rev: 0, qty: 0 }
  };

  txs.filter(tx => tx.type === "sell").forEach(tx => {
    const ch = tx.channel || "Trực tiếp";
    if (channelData[ch]) {
      channelData[ch].rev += (Number(tx.qty) * Number(tx.unitPrice));
      channelData[ch].qty += Number(tx.qty);
    }
  });

  const totalRev = Object.values(channelData).reduce((sum, item) => sum + item.rev, 0);

  const channelListEl = document.getElementById("reportChannelList");
  channelListEl.innerHTML = "";

  const channels = Object.keys(channelData);
  channels.forEach(ch => {
    const data = channelData[ch];
    const pct = totalRev > 0 ? (data.rev / totalRev) * 100 : 0;

    const item = document.createElement("div");
    item.className = "channel-progress-item";
    item.innerHTML = `
      <div class="channel-progress-header">
        <span class="channel-progress-name">${ch}</span>
        <span class="channel-progress-val">${formatCurrency(data.rev)} (${pct.toFixed(1)}% - ${data.qty} chiếc)</span>
      </div>
      <div class="channel-progress-bar-bg">
        <div class="channel-progress-bar-fill" style="width: ${pct}%"></div>
      </div>
    `;
    channelListEl.appendChild(item);
  });

  // 2. Tự động đưa ra nhận định tài chính tổng quan bằng thuật toán
  const insightsBox = document.getElementById("insightsBox");
  insightsBox.innerHTML = "";

  const totalBoughtCount = inventoryList.reduce((sum, item) => sum + item.totalBought, 0);
  const totalSoldCount = inventoryList.reduce((sum, item) => sum + item.totalSold, 0);
  const totalProfit = yearlyStats.reduce((sum, s) => sum + s.profit, 0);
  const totalExpenses = yearlyStats.reduce((sum, s) => sum + s.purchaseCost, 0);
  const totalRevenue = yearlyStats.reduce((sum, s) => sum + s.revenue, 0);

  let insights = [];

  // Tạo nhận định dựa trên số liệu
  if (totalBoughtCount === 0) {
    insights.push({
      type: "info",
      text: "Hãy nhập hàng và bắt đầu ghi nhận các giao dịch mua bán xe đầu tiên của bạn để phần mềm phân tích dữ liệu."
    });
  } else {
    // Nhận định về quy mô kho hàng
    insights.push({
      type: "box",
      text: `Hiện đang có **${inventoryList.length}** mẫu xe khác nhau trong danh mục. Tổng lượng xe đã nhập là **${totalBoughtCount}** chiếc.`
    });

    // Nhận định về dòng tiền (Cashflow)
    if (totalExpenses > totalRevenue) {
      const diff = totalExpenses - totalRevenue;
      insights.push({
        type: "trending-down",
        color: "text-orange",
        text: `Dòng tiền của bạn đang chi nhiều hơn thu: Bạn đã bỏ ra **${formatCurrency(totalExpenses)}** mua xe nhưng chỉ mới thu về **${formatCurrency(totalRevenue)}** từ bán. Bạn cần thu hồi vốn thêm **${formatCurrency(diff)}** để hòa vốn dòng tiền.`
      });
    } else {
      const diff = totalRevenue - totalExpenses;
      insights.push({
        type: "trending-up",
        color: "text-green",
        text: `Dòng tiền dương cực kỳ tốt! Bạn đã thu hồi toàn bộ vốn mua hàng và dư ra **${formatCurrency(diff)}** tiền mặt để tiếp tục tái đầu tư.`
      });
    }

    // Nhận định về lợi nhuận gộp hàng bán
    if (totalProfit > 0) {
      insights.push({
        type: "dollar-sign",
        color: "text-green",
        text: `Tổng lợi nhuận thực tế từ các đơn đã bán đạt **${formatCurrency(totalProfit)}**. Kế toán ghi nhận mức sinh lời khả quan.`
      });
    }

    // Nhận định về kênh bán chạy nhất
    let bestChannel = "Facebook";
    let maxChannelRev = 0;
    for (const ch in channelData) {
      if (channelData[ch].rev > maxChannelRev) {
        maxChannelRev = channelData[ch].rev;
        bestChannel = ch;
      }
    }
    if (maxChannelRev > 0) {
      insights.push({
        type: "shopping-bag",
        color: "text-bold",
        text: `Kênh bán hàng mang lại doanh thu lớn nhất là **${bestChannel}** với doanh thu **${formatCurrency(maxChannelRev)}**.`
      });
    }

    // Nhận định về hãng xe chiếm tỷ trọng cao nhất trong kho
    const brandCounts = {};
    inventoryList.forEach(item => {
      if (item.stock > 0) {
        brandCounts[item.brand] = (brandCounts[item.brand] || 0) + item.stock;
      }
    });
    let topBrand = "";
    let maxBrandStock = 0;
    for (const b in brandCounts) {
      if (brandCounts[b] > maxBrandStock) {
        maxBrandStock = brandCounts[b];
        topBrand = b;
      }
    }
    if (maxBrandStock > 0) {
      insights.push({
        type: "award",
        color: "text-bold",
        text: `Hãng xe chiếm số lượng tồn kho nhiều nhất là **${topBrand}** với **${maxBrandStock}** chiếc đang sẵn sàng bán.`
      });
    }
  }

  // Render insights ra DOM
  insights.forEach(ins => {
    const div = document.createElement("div");
    div.className = "insight-item";
    
    // Map icon
    let iconName = "info";
    if (ins.type === "trending-up") iconName = "trending-up";
    else if (ins.type === "trending-down") iconName = "trending-down";
    else if (ins.type === "dollar-sign") iconName = "dollar-sign";
    else if (ins.type === "shopping-bag") iconName = "shopping-bag";
    else if (ins.type === "award") iconName = "award";
    else if (ins.type === "box") iconName = "box";

    // Phân tích markdown đơn giản cho chữ đậm **chữ**
    const textHtml = ins.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    div.innerHTML = `
      <i data-lucide="${iconName}" class="${ins.color || ''}"></i>
      <span class="${ins.color || ''}">${textHtml}</span>
    `;
    insightsBox.appendChild(div);
  });

  lucide.createIcons();
}

// Cập nhật danh sách các Hãng xe trong bộ lọc Kho hàng
function renderBrandFilterSelect(inventoryList) {
  const select = document.getElementById("filterBrandSelect");
  const previousValue = select.value;

  // Lấy danh sách các hãng duy nhất
  const brands = [...new Set(inventoryList.map(item => item.brand))].sort();

  select.innerHTML = '<option value="all">Tất cả hãng</option>';
  
  brands.forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.toLowerCase();
    opt.text = b;
    select.appendChild(opt);
  });

  if (brands.some(b => b.toLowerCase() === previousValue)) {
    select.value = previousValue;
  }
}

// Lấy danh sách các hãng đã từng dùng (từ giao dịch hiện có) gộp với danh sách hãng mẫu, đã loại trùng và sắp xếp
function getKnownBrands() {
  const currentBrands = new Set();
  state.portfolios.forEach(p => {
    const txs = state.transactions[p.id] || [];
    txs.forEach(t => { if (t.brand) currentBrands.add(t.brand.trim()); });
  });

  (typeof MOCK_BRANDS !== "undefined" ? MOCK_BRANDS : []).forEach(b => currentBrands.add(b));

  return [...currentBrands].sort();
}

// --- VẼ BIỂU ĐỒ BẰNG CHART.JS (VISUALIZATIONS) ---

// Vẽ/Cập nhật biểu đồ cột Doanh thu & Chi phí theo Năm (Đã chuyển thành Widget Doanh thu tổng năm nay)
function drawYoYChart(chartId, yearlyStats) {
  const currentYear = new Date().getFullYear().toString();
  const txs = state.transactions[state.activePortfolioId] || [];
  
  let totalRevenueThisYear = 0;
  
  txs.forEach(tx => {
    if (tx.type === "sell" && tx.date && tx.date.startsWith(currentYear)) {
      // Ưu tiên Giá đăng bán Shopee (taxUnitPrice), nếu không có thì lấy Lợi nhuận (unitPrice)
      let finalPriceSource = tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null ? tx.taxUnitPrice : tx.unitPrice;
      const price = parseFloat(String(finalPriceSource || '0').replace(/[^0-9.-]+/g, '')) || 0;
      const qty = Number(tx.qty) || 1;
      totalRevenueThisYear += price * qty;
    }
  });

  const valEl = document.getElementById("val-yearly-revenue");
  if (valEl) {
    valEl.innerText = formatCurrency(totalRevenueThisYear);
  }
}

// Biểu đồ tròn cơ cấu kênh bán hàng
function drawChannelChart(portfolioId) {
  const ctx = document.getElementById("channelChart").getContext("2d");
  if (charts.channelChart) charts.channelChart.destroy();

  const txs = state.transactions[portfolioId] || [];
  const channels = { Facebook: 0, Shopee: 0, "Trực tiếp": 0 };

  txs.filter(tx => tx.type === "sell").forEach(tx => {
    const ch = tx.channel || "Trực tiếp";
    if (channels[ch] !== undefined) {
      channels[ch] += (Number(tx.qty) * Number(tx.unitPrice));
    }
  });

  const values = Object.values(channels);
  const labels = Object.keys(channels);
  const hasData = values.some(v => v > 0);

  charts.channelChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: hasData ? values : [1],
        backgroundColor: hasData ? ["#6366f1", "#f97316", "#10b981"] : ["rgba(255,255,255,0.05)"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#9ca3af", font: { family: "Outfit", size: 11 } }
        },
        tooltip: {
          enabled: hasData,
          callbacks: {
            label: function(context) {
              return " " + context.label + ": " + formatCurrency(context.raw);
            }
          }
        }
      },
      cutout: "70%"
    }
  });
}

// Biểu đồ cơ cấu hãng xe (Brand Allocation)
function drawBrandChart(inventoryList) {
  const ctx = document.getElementById("brandChart").getContext("2d");
  if (charts.brandChart) charts.brandChart.destroy();

  const brandCounts = {};
  let totalStock = 0;

  inventoryList.forEach(item => {
    if (item.stock > 0) {
      brandCounts[item.brand] = (brandCounts[item.brand] || 0) + item.stock;
      totalStock += item.stock;
    }
  });

  // Chia nhóm các hãng xe: Hãng có tỷ trọng >= 5% giữ riêng, < 5% gom vào nhóm "(KHÁC)"
  const sortedBrands = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]);
  
  const mainBrands = [];
  const smallBrands = [];
  let otherStockSum = 0;

  sortedBrands.forEach(([brand, stock]) => {
    const pct = totalStock > 0 ? (stock / totalStock) * 100 : 0;
    if (pct >= 5) {
      mainBrands.push({ brand, stock });
    } else {
      smallBrands.push({ brand, stock });
      otherStockSum += stock;
    }
  });

  const labels = [];
  const values = [];

  mainBrands.forEach(item => {
    labels.push(item.brand);
    values.push(item.stock);
  });

  if (otherStockSum > 0) {
    labels.push("(KHÁC)");
    values.push(otherStockSum);
  }

  const hasData = values.length > 0;

  charts.brandChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: hasData ? labels : ["Không có xe tồn"],
      datasets: [{
        data: hasData ? values : [1],
        backgroundColor: hasData 
          ? ["#8b5cf6", "#ec4899", "#3b82f6", "#10b981", "#f59e0b", "#06b6d4", "#64748b"] 
          : ["rgba(255,255,255,0.05)"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#9ca3af", font: { family: "Outfit", size: 11 } }
        },
        tooltip: {
          enabled: hasData,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const index = context.dataIndex;
              const label = context.chart.data.labels[index];

              if (label === "(KHÁC)") {
                // Trả về mảng chuỗi để tạo nhiều dòng trong tooltip
                const tooltipLines = ["(KHÁC): " + val + " chiếc"];
                smallBrands.forEach(item => {
                  const itemPct = totalStock > 0 ? ((item.stock / totalStock) * 100).toFixed(1) : 0;
                  tooltipLines.push(`  • ${item.brand}: ${item.stock} chiếc (${itemPct}%)`);
                });
                return tooltipLines;
              }

              const pct = totalStock > 0 ? ((val / totalStock) * 100).toFixed(1) : 0;
              return ` ${label}: ${val} chiếc (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// --- LOGIC ĐIỀU HƯỚNG TAB ---
function setupTabNavigation() {
  const navLinks = document.querySelectorAll(".nav-link:not(.nav-link-parent)");
  const panels = document.querySelectorAll(".panel");
  const pageTitle = document.getElementById("pageTitle");

  navLinks.forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      
      // Bỏ kích hoạt ở các tab cũ
      navLinks.forEach(l => l.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));

      // Kích hoạt tab mới
      link.classList.add("active");
      const targetTab = link.getAttribute("data-tab");
      const targetPanel = document.getElementById(`panel-${targetTab}`);
      if (targetPanel) targetPanel.classList.add("active");

      // Đổi tiêu đề Navbar
      pageTitle.innerText = link.querySelector("span").innerText;

      // Đóng sidebar trên thiết bị di động sau khi chọn tab
      document.getElementById("sidebar").classList.remove("mobile-open");

      // Render bảng lịch sử giao dịch khi chuyển sang tab Giao dịch
      if (targetTab === "transactions") {
        const inv = calculateInventory(state.activePortfolioId);
        renderTransactionHistoryTable(state.activePortfolioId, inv);
      }

      // Render Tax panels khi chuyển sang các tab thuế
      if (targetTab === "tax-info") renderTaxInfo();
      if (targetTab === "tax-declarations") renderTaxDeclarations();
      if (targetTab === "tax-config") renderTaxConfig();

      // Cập nhật lại biểu đồ khi chuyển tab để tránh lỗi hiển thị kích thước
      triggerChartsRefresh();
    });
  });

  // Tax parent toggle (expand/collapse submenu)
  const taxToggle = document.getElementById("taxNavToggle");
  const taxSubmenu = document.getElementById("taxSubmenu");
  const taxChevron = document.getElementById("taxNavChevron");
  if (taxToggle && taxSubmenu) {
    taxToggle.addEventListener("click", (e) => {
      e.preventDefault();
      const isOpen = !taxSubmenu.classList.contains("hidden");
      taxSubmenu.classList.toggle("hidden");
      if (taxChevron) taxChevron.style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
    });
  }

  // Tăng cường điều hướng từ Dashboard sang Kho
  document.getElementById("goToInventoryBtn").addEventListener("click", () => {
    const invLink = document.querySelector('.nav-link[data-tab="inventory"]');
    if (invLink) invLink.click();
  });
}

// Thiết lập chuyển đổi qua lại giữa dạng Grid và dạng Bảng ở màn hình Kho
function setupInventoryViewToggle() {
  const tableBtn = document.getElementById("viewTableBtn");
  const gridBtn = document.getElementById("viewGridBtn");
  const tableContainer = document.getElementById("inventoryTableContainer");
  const gridContainer = document.getElementById("inventoryGridContainer");

  tableBtn.addEventListener("click", () => {
    tableBtn.classList.add("active");
    gridBtn.classList.remove("active");
    tableContainer.classList.remove("hidden");
    gridContainer.classList.add("hidden");
  });

  gridBtn.addEventListener("click", () => {
    gridBtn.classList.add("active");
    tableBtn.classList.remove("active");
    gridContainer.classList.remove("hidden");
    tableContainer.classList.add("hidden");
  });
}

// --- LOGIC XỬ LÝ SỰ KIỆN FORM (MUA & BÁN) ---

// Lấy danh sách gợi ý xe từ tất cả portfolio + MOCK_SUGGESTED_CARS (dùng chung)
// Ưu tiên inventory kho hiện tại trước, rồi đến các portfolio khác, rồi MOCK
function getModelSuggestions() {
  const seen = new Set();
  const suggestions = [];

  // Bước 1: Lấy inventory kho đang hoạt động (có avgCost để gợi ý giá)
  const activeInventory = calculateInventory(state.activePortfolioId);
  activeInventory.forEach(item => {
    const key = `${item.modelName.trim().toLowerCase()}||${item.brand.trim().toLowerCase()}||${(item.color||"").trim().toLowerCase()}||${(item.packaging||"").trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({
        name: item.modelName,
        brand: item.brand,
        color: item.color || "",
        packaging: item.packaging || "",
        defaultPrice: item.avgCost,
        isFromInventory: true
      });
    }
  });

  // Bước 2: Quét tất cả transactions của tất cả portfolios để nhặt thêm các biến thể màu/đóng gói chưa được đưa vào
  state.portfolios.forEach(p => {
    const txs = state.transactions[p.id] || [];
    txs.forEach(tx => {
      const key = `${tx.modelName.trim().toLowerCase()}||${tx.brand.trim().toLowerCase()}||${(tx.color||"").trim().toLowerCase()}||${(tx.packaging||"").trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push({
          name: tx.modelName.trim(),
          brand: tx.brand.trim(),
          color: (tx.color || "").trim(),
          packaging: (tx.packaging || "").trim(),
          defaultPrice: 0,
          isFromInventory: false
        });
      }
    });
  });

  // Bước 3: Thêm xe từ MOCK nếu chưa có
  (typeof MOCK_SUGGESTED_CARS !== "undefined" ? MOCK_SUGGESTED_CARS : []).forEach(mockCar => {
    const key = `${mockCar.name.trim().toLowerCase()}||${mockCar.brand.trim().toLowerCase()}||${(mockCar.color||"").trim().toLowerCase()}||${(mockCar.packaging||"").trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push(mockCar);
    }
  });

  return suggestions;
}

// Render danh sách gợi ý xe vào một suggestionsBox
function renderModelSuggestions(suggestionsBox, val, onSelect) {
  suggestionsBox.innerHTML = "";
  const all = getModelSuggestions();

  let matches;
  if (!val) {
    matches = all.filter(c => c.isFromInventory).slice(0, 10)
               .concat(all.filter(c => !c.isFromInventory).slice(0, 3));
    matches = matches.slice(0, 10);
  } else {
    const q = val.toLowerCase();
    matches = all.filter(car =>
      car.name.toLowerCase().includes(q) ||
      car.brand.toLowerCase().includes(q) ||
      (car.color || "").toLowerCase().includes(q) ||
      (car.packaging || "").toLowerCase().includes(q)
    ).slice(0, 10);
  }

  if (matches.length === 0) {
    suggestionsBox.classList.add("hidden");
    return;
  }

  matches.forEach(car => {
    const div = document.createElement("div");
    div.className = "suggestion-item";

    let badgeHtml = car.isFromInventory
      ? ` <span class="badge badge-in-stock" style="font-size: 9px; margin-left: 5px;">Có sẵn</span>`
      : "";
    const colorBadge = car.color
      ? ` <span class="badge badge-secondary" style="font-size: 9px; margin-left: 5px;">${car.color}</span>`
      : "";
    const pkgBadge = car.packaging
      ? ` <span class="badge badge-info" style="font-size: 9px; margin-left: 5px;">${car.packaging}</span>`
      : "";
    const skuLabel = ` <span style="font-size: 10px; font-family: monospace; color: #64748b; margin-left: 5px;">${generateSKU(car.brand, car.name, car.color, car.packaging)}</span>`;

    div.innerHTML = `
      <span class="suggest-name">${car.name}${badgeHtml}${colorBadge}${pkgBadge}${skuLabel}</span>
      <span class="suggest-brand">${car.brand}</span>
    `;

    div.addEventListener("mousedown", (e) => {
      e.preventDefault(); // giữ focus ở input
      onSelect(car);
      suggestionsBox.classList.add("hidden");
    });

    suggestionsBox.appendChild(div);
  });

  suggestionsBox.classList.remove("hidden");
}

// Thiết lập autocomplete cho một input tên xe (dùng chung)
function bindModelAutocomplete(inputEl, suggestionsBoxEl, onSelect) {
  function showSuggestions() {
    renderModelSuggestions(suggestionsBoxEl, inputEl.value.trim(), onSelect);
  }

  inputEl.addEventListener("input", showSuggestions);
  inputEl.addEventListener("focus", showSuggestions);
  inputEl.addEventListener("click", showSuggestions);

  document.addEventListener("click", (e) => {
    if (e.target !== inputEl && e.target !== suggestionsBoxEl && !suggestionsBoxEl.contains(e.target)) {
      suggestionsBoxEl.classList.add("hidden");
    }
  });
}

// Xử lý tự động gợi ý (Autocomplete) tên xe khi nhập — Form Mua
function setupAutocomplete() {
  const input = document.getElementById("buyModelName");
  const suggestionsBox = document.getElementById("buyModelSuggestions");
  const brandInput = document.getElementById("buyBrand");
  const colorInput = document.getElementById("buyColor");
  const packagingInput = document.getElementById("buyPackaging");
  const priceInput = document.getElementById("buyUnitCost");

  bindModelAutocomplete(input, suggestionsBox, (car) => {
    input.value = car.name;
    brandInput.value = car.brand;
    if (colorInput) colorInput.value = car.color || "";
    if (packagingInput) packagingInput.value = car.packaging || "";
    priceInput.value = formatNumberInput((car.defaultPrice || 0).toString());
  });
}

// Xử lý tự động gợi ý (Autocomplete) tên xe — Modal Chỉnh sửa giao dịch
// Tái sử dụng bindModelAutocomplete() và getModelSuggestions() đã có
function setupEditTxAutocomplete() {
  const input = document.getElementById("editTxModelName");
  const suggestionsBox = document.getElementById("editTxModelSuggestions");
  const brandInput = document.getElementById("editTxBrand");
  const colorInput = document.getElementById("editTxColor");
  const packagingInput = document.getElementById("editTxPackaging");

  if (!input || !suggestionsBox) return;

  bindModelAutocomplete(input, suggestionsBox, (car) => {
    input.value = car.name;
    brandInput.value = car.brand;
    if (colorInput) colorInput.value = car.color || "";
    if (packagingInput) packagingInput.value = car.packaging || "";
  });
}


// Tự động gợi ý Hãng sản xuất khi nhập (dựa trên các hãng đã từng nhập + danh sách mẫu)
function setupBrandAutocomplete() {
  const input = document.getElementById("buyBrand");
  const suggestionsBox = document.getElementById("buyBrandSuggestions");

  function showSuggestions() {
    const val = input.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";

    const brands = getKnownBrands();

    let matches;
    if (!val) {
      matches = brands.slice(0, 8);
    } else {
      matches = brands.filter(b => b.toLowerCase().includes(val)).slice(0, 8);
    }

    if (matches.length === 0) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    matches.forEach(brand => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `<span class="suggest-name">${brand}</span>`;

      div.onclick = () => {
        input.value = brand;
        suggestionsBox.classList.add("hidden");
      };

      suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove("hidden");
  }

  input.addEventListener("input", showSuggestions);
  input.addEventListener("focus", showSuggestions);
  input.addEventListener("click", showSuggestions);

  document.addEventListener("click", (e) => {
    if (e.target !== input && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add("hidden");
    }
  });
}

// Theo dõi khi người dùng chọn xe cần bán để hiện giá trung bình & tồn kho của xe đó
// Lấy danh sách màu sắc đã dùng gộp với màu sắc mặc định
function getKnownColors() {
  const currentColors = new Set();
  state.portfolios.forEach(p => {
    const txs = state.transactions[p.id] || [];
    txs.forEach(t => { if (t.color) currentColors.add(t.color.trim()); });
  });

  const DEFAULT_COLORS = ["Đỏ", "Trắng", "Đen", "Xanh dương", "Xanh lá", "Vàng", "Bạc", "Xám", "Cam", "Tím"];
  DEFAULT_COLORS.forEach(c => currentColors.add(c));

  return [...currentColors].sort();
}

// Lấy danh sách đóng gói đã dùng gộp với đóng gói mặc định
function getKnownPackagings() {
  const currentPkgs = new Set();
  state.portfolios.forEach(p => {
    const txs = state.transactions[p.id] || [];
    txs.forEach(t => { if (t.packaging) currentPkgs.add(t.packaging.trim()); });
  });

  const DEFAULT_PKGS = ["Không hộp (Loose)", "Card", "Có hộp", "Mica"];
  DEFAULT_PKGS.forEach(p => currentPkgs.add(p));

  return [...currentPkgs].sort();
}

// Tự động gợi ý Màu sắc khi nhập
function setupColorAutocomplete() {
  const input = document.getElementById("buyColor");
  const suggestionsBox = document.getElementById("buyColorSuggestions");
  if (!input || !suggestionsBox) return;

  function showSuggestions() {
    const val = input.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";

    const colors = getKnownColors();

    let matches;
    if (!val) {
      matches = colors.slice(0, 8);
    } else {
      matches = colors.filter(c => c.toLowerCase().includes(val)).slice(0, 8);
    }

    if (matches.length === 0) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    matches.forEach(color => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `<span class="suggest-name">${color}</span>`;

      div.onclick = () => {
        input.value = color;
        suggestionsBox.classList.add("hidden");
      };

      suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove("hidden");
  }

  input.addEventListener("input", showSuggestions);
  input.addEventListener("focus", showSuggestions);
  input.addEventListener("click", showSuggestions);

  document.addEventListener("click", (e) => {
    if (e.target !== input && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add("hidden");
    }
  });
}

// Tự động gợi ý Đóng gói khi nhập
function setupPackagingAutocomplete() {
  const input = document.getElementById("buyPackaging");
  const suggestionsBox = document.getElementById("buyPackagingSuggestions");
  if (!input || !suggestionsBox) return;

  function showSuggestions() {
    const val = input.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";

    const pkgs = getKnownPackagings();

    let matches;
    if (!val) {
      matches = pkgs.slice(0, 8);
    } else {
      matches = pkgs.filter(p => p.toLowerCase().includes(val)).slice(0, 8);
    }

    if (matches.length === 0) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    matches.forEach(pkg => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `<span class="suggest-name">${pkg}</span>`;

      div.onclick = () => {
        input.value = pkg;
        suggestionsBox.classList.add("hidden");
      };

      suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove("hidden");
  }

  input.addEventListener("input", showSuggestions);
  input.addEventListener("focus", showSuggestions);
  input.addEventListener("click", showSuggestions);

  document.addEventListener("click", (e) => {
    if (e.target !== input && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add("hidden");
    }
  });
}

function setupSellFormWatcher(inventoryList) {
  const select = document.getElementById("sellModelSelect");
  const infoBubble = document.getElementById("sellModelCostInfo");
  const avgCostLabel = document.getElementById("sellAvgCostLabel");
  const stockLabel = document.getElementById("sellStockLabel");
  const sellQtyInput = document.getElementById("sellQty");
  const sellPriceInput = document.getElementById("sellUnitPrice");

  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) {
      infoBubble.classList.add("hidden");
      return;
    }

    const [modelName, brand, color, packaging] = val.split("||");
    const item = inventoryList.find(i => 
      i.modelName === modelName && 
      i.brand === brand && 
      (i.color || "") === (color || "") && 
      (i.packaging || "") === (packaging || "")
    );
    
    if (item) {
      avgCostLabel.innerText = formatCurrency(item.avgCost);
      stockLabel.innerText = `${item.stock} chiếc`;
      
      // Giới hạn max số lượng bán bằng số lượng tồn kho thực tế
      sellQtyInput.max = item.stock;
      sellQtyInput.value = Math.min(Number(sellQtyInput.value), item.stock);
      
      // Gợi ý giá bán = giá mua TB + 30% lãi tạm tính
      sellPriceInput.placeholder = `Gợi ý: ${formatCurrency(item.avgCost * 1.3)}`;

      infoBubble.classList.remove("hidden");
    } else {
      infoBubble.classList.add("hidden");
    }
  });
}

// Thiết lập tự động gợi ý xe trong kho khi gõ ở phần "Bán xe"
function setupSellAutocomplete() {
  const textInput = document.getElementById("sellModelInput");
  const hiddenInput = document.getElementById("sellModelSelect");
  const suggestionsBox = document.getElementById("sellModelSuggestions");

  function clearSelection() {
    if (hiddenInput.value !== "") {
      hiddenInput.value = "";
      hiddenInput.dispatchEvent(new Event("change"));
    }
  }

  textInput.addEventListener("input", () => {
    const val = textInput.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";

    // Nếu người dùng đang sửa lại nội dung, bỏ lựa chọn cũ
    clearSelection();

    if (!val) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    const stock = window.sellableStock || [];

    // Tìm các xe khớp với từ khóa ở tên xe hoặc tên hãng hoặc màu sắc hoặc đóng gói
    const matches = stock.filter(item =>
      item.modelName.toLowerCase().includes(val) || 
      item.brand.toLowerCase().includes(val) ||
      (item.color || "").toLowerCase().includes(val) ||
      (item.packaging || "").toLowerCase().includes(val)
    ).slice(0, 8);

    if (matches.length === 0) {
      suggestionsBox.innerHTML = `<div class="suggestion-item" style="cursor:default;">Không tìm thấy xe phù hợp trong kho</div>`;
      suggestionsBox.classList.remove("hidden");
      return;
    }

    matches.forEach(item => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `
        <span class="suggest-name">${item.modelName} 
          <span class="badge badge-in-stock" style="font-size: 9px; margin-left: 5px;">Còn ${item.stock}</span>
          ${item.color ? `<span class="badge badge-secondary" style="font-size: 9px; margin-left: 5px;">${item.color}</span>` : ''}
          ${item.packaging ? `<span class="badge badge-info" style="font-size: 9px; margin-left: 5px;">${item.packaging}</span>` : ''}
        </span>
        <span class="suggest-brand">${item.brand}</span>
      `;

      div.onclick = () => {
        textInput.value = item.modelName + (item.color ? ` (${item.color})` : '') + (item.packaging ? ` - ${item.packaging}` : '');
        hiddenInput.value = `${item.modelName}||${item.brand}||${item.color || ""}||${item.packaging || ""}`;
        hiddenInput.dispatchEvent(new Event("change"));
        suggestionsBox.classList.add("hidden");
      };

      suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove("hidden");
  });

  // Hiện lại gợi ý khi focus vào ô nếu đã có nội dung gõ
  textInput.addEventListener("focus", () => {
    if (textInput.value.trim()) {
      textInput.dispatchEvent(new Event("input"));
    }
  });

  // Đóng box gợi ý khi click ra ngoài
  document.addEventListener("click", (e) => {
    if (e.target !== textInput && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add("hidden");
    }
  });
}

// Bán nhanh từ nút bấm ở danh sách Kho hàng
function quickSellCar(modelName, brand, color = "", packaging = "") {
  // Chuyển sang tab Giao dịch
  const txTabLink = document.querySelector('.nav-link[data-tab="transactions"]');
  if (txTabLink) txTabLink.click();

  const textInput = document.getElementById("sellModelInput");
  const hiddenInput = document.getElementById("sellModelSelect");
  const optionValue = `${modelName}||${brand}||${color || ""}||${packaging || ""}`;
  
  // Đợi DOM cập nhật rồi gán value
  setTimeout(() => {
    textInput.value = modelName + (color ? ` (${color})` : '') + (packaging ? ` - ${packaging}` : '');
    hiddenInput.value = optionValue;
    // Kích hoạt sự kiện change thủ công để load thông tin tồn kho
    hiddenInput.dispatchEvent(new Event("change"));
    
    // Cuộn nhẹ đến khung form bán
    document.getElementById("sellForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);
}

// --- TRẢ HÀNG: Autocomplete tìm giao dịch gốc (buy/sell) để ghi nhận trả hàng ---
function setupReturnAutocomplete() {
  const typeSelect = document.getElementById("returnType");
  const textInput = document.getElementById("returnTxInput");
  const hiddenInput = document.getElementById("returnTxSelect");
  const suggestionsBox = document.getElementById("returnTxSuggestions");
  const infoBubble = document.getElementById("returnTxInfo");
  if (!typeSelect || !textInput || !hiddenInput || !suggestionsBox) return;

  function clearSelection() {
    if (hiddenInput.value !== "") {
      hiddenInput.value = "";
      if (infoBubble) infoBubble.classList.add("hidden");
    }
  }

  // "return_buy" tìm trong giao dịch "buy" gốc; "return_sell" tìm trong giao dịch "sell" gốc
  function currentSourceType() {
    return typeSelect.value === "return_buy" ? "buy" : "sell";
  }

  textInput.addEventListener("input", () => {
    const val = textInput.value.trim().toLowerCase();
    suggestionsBox.innerHTML = "";
    clearSelection();

    if (!val) {
      suggestionsBox.classList.add("hidden");
      return;
    }

    // Chỉ hiện các giao dịch gốc còn số lượng có thể trả > 0
    const candidates = getReturnableTransactions(state.activePortfolioId, currentSourceType());
    const matches = candidates.filter(tx =>
      tx.modelName.toLowerCase().includes(val) ||
      tx.brand.toLowerCase().includes(val) ||
      formatDate(tx.date).includes(val)
    ).slice(0, 8);

    if (matches.length === 0) {
      suggestionsBox.innerHTML = `<div class="suggestion-item" style="cursor:default;">Không tìm thấy giao dịch phù hợp còn có thể trả</div>`;
      suggestionsBox.classList.remove("hidden");
      return;
    }

    matches.forEach(tx => {
      const priceVal = tx.type === "buy" ? Number(tx.unitCost) : Number(tx.unitPrice);
      const div = document.createElement("div");
      div.className = "suggestion-item";
      div.innerHTML = `
        <span class="suggest-name">${tx.modelName}
          <span class="badge badge-in-stock" style="font-size: 9px; margin-left: 5px;">Còn ${tx.returnableQty} có thể trả</span>
          ${tx.color ? `<span class="badge badge-secondary" style="font-size: 9px; margin-left: 5px;">${tx.color}</span>` : ''}
        </span>
        <span class="suggest-brand">${tx.brand} · ${formatDate(tx.date)} · ${formatCurrency(priceVal)}</span>
      `;

      div.onclick = () => {
        textInput.value = `${tx.modelName} (${formatDate(tx.date)})`;
        hiddenInput.value = tx.id;

        const qtyInput = document.getElementById("returnQty");
        if (qtyInput) qtyInput.max = tx.returnableQty;

        if (infoBubble) {
          infoBubble.innerHTML = `Số lượng gốc: <strong>${tx.qty}</strong> | Còn có thể trả: <strong>${tx.returnableQty}</strong> | ${tx.type === "buy" ? "Giá nhập" : "Giá bán"}: <strong>${formatCurrency(priceVal)}</strong>`;
          infoBubble.classList.remove("hidden");
        }
        suggestionsBox.classList.add("hidden");
      };

      suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove("hidden");
  });

  textInput.addEventListener("focus", () => {
    if (textInput.value.trim()) textInput.dispatchEvent(new Event("input"));
  });

  // Đổi loại trả hàng (Nhập/Bán) → nguồn tìm kiếm đổi (buy/sell) nên phải reset lựa chọn cũ
  typeSelect.addEventListener("change", () => {
    textInput.value = "";
    clearSelection();
    suggestionsBox.classList.add("hidden");
    suggestionsBox.innerHTML = "";
  });

  document.addEventListener("click", (e) => {
    if (e.target !== textInput && e.target !== suggestionsBox && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add("hidden");
    }
  });
}

// --- THỰC THI THÊM/XÓA CÁC ĐỐI TƯỢNG (PORTFOLIO & TRANSACTIONS) ---

// Đăng ký các Form Submit
function setupFormSubmissions() {
  const buyForm = document.getElementById("buyForm");
  const sellForm = document.getElementById("sellForm");

  // FORM MUA HÀNG (BUY)
  buyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const modelName = document.getElementById("buyModelName").value.trim();
    const brand = document.getElementById("buyBrand").value.trim();
    const color = document.getElementById("buyColor").value.trim();
    const packaging = document.getElementById("buyPackaging").value.trim();
    const date = window.datePickers.buyDate.getValue();
    const qty = Number(document.getElementById("buyQty").value);
    const unitCost = getNumericValue(document.getElementById("buyUnitCost").value);
    const notes = document.getElementById("buyNotes").value.trim();

    if (!modelName || !brand || !date || qty <= 0 || unitCost < 0) {
      alert("Vui lòng điền đầy đủ và chính xác thông tin bắt buộc!");
      return;
    }

    const newTx = {
      id: generateUniqueId("tx"),
      type: "buy",
      modelName,
      brand,
      color,
      packaging,
      sku: generateSKU(brand, modelName, color, packaging),
      qty,
      unitCost,
      date,
      notes
    };

    // Thêm vào danh sách của active portfolio
    if (!state.transactions[state.activePortfolioId]) {
      state.transactions[state.activePortfolioId] = [];
    }
    state.transactions[state.activePortfolioId].push(newTx);

    await saveBuyFormImage(modelName, brand, color, packaging);
    dbSaveTransaction(newTx);
    buyForm.reset();
    
    // Đặt lại ngày mặc định là hôm nay
    window.datePickers.buyDate.setValue(dateToISO(new Date()));
    
    alert(`Đã nhập thành công ${qty} chiếc ${modelName} vào kho!`);
    refreshApplicationData();
  });

  // Toggle UI field cho Shopee Revenue
  const sellChannelEl = document.getElementById("sellChannel");
  const taxGroupEl = document.getElementById("sellTaxUnitPriceGroup");
  const unitPriceLabel = document.getElementById("sellUnitPriceLabel");
  
  sellChannelEl.addEventListener("change", (e) => {
    if (e.target.value === "Shopee") {
      taxGroupEl.style.display = "block";
      unitPriceLabel.innerHTML = 'Lợi nhuận thực tế / chiếc <span class="required">*</span>';
    } else {
      taxGroupEl.style.display = "none";
      unitPriceLabel.innerHTML = 'Giá bán / chiếc <span class="required">*</span>';
      document.getElementById("sellTaxUnitPrice").value = "";
    }
  });

  // FORM BÁN HÀNG (SELL)
  sellForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const modelSelectVal = document.getElementById("sellModelSelect").value;
    const channel = sellChannelEl.value;
    const date = window.datePickers.sellDate.getValue();
    const qty = Number(document.getElementById("sellQty").value);
    const unitPrice = getNumericValue(document.getElementById("sellUnitPrice").value);
    
    // Đọc giá trị taxUnitPrice (chỉ dùng cho Shopee)
    let taxUnitPrice = null;
    if (channel === "Shopee") {
      taxUnitPrice = getNumericValue(document.getElementById("sellTaxUnitPrice").value);
      if (taxUnitPrice <= 0) {
        alert("Vui lòng nhập Giá đăng bán Shopee để tính thuế!");
        return;
      }
    }

    const notes = document.getElementById("sellNotes").value.trim();

    if (!modelSelectVal || !channel || !date || qty <= 0 || unitPrice < 0) {
      alert("Vui lòng chọn xe và điền đầy đủ thông tin bán hàng!");
      return;
    }

    const [modelName, brand, color, packaging] = modelSelectVal.split("||");
    
    // Kiểm tra tồn kho trước khi bán để tránh âm kho
    const inventory = calculateInventory(state.activePortfolioId);
    const item = inventory.find(i => 
      i.modelName === modelName && 
      i.brand === brand && 
      (i.color || "") === (color || "") && 
      (i.packaging || "") === (packaging || "")
    );

    if (!item || item.stock < qty) {
      alert(`Lỗi: Số lượng bán (${qty}) vượt quá số lượng xe hiện có trong kho (${item ? item.stock : 0} chiếc)!`);
      return;
    }

    const newTx = {
      id: generateUniqueId("tx"),
      type: "sell",
      modelName,
      brand,
      color: color || "",
      packaging: packaging || "",
      sku: generateSKU(brand, modelName, color, packaging),
      qty,
      unitPrice,
      taxUnitPrice, // Lưu thêm trường thuế
      date,
      channel,
      notes
    };

    state.transactions[state.activePortfolioId].push(newTx);
    dbSaveTransaction(newTx);
    sellForm.reset();
    
    taxGroupEl.style.display = "none"; // Reset form UI
    unitPriceLabel.innerHTML = 'Giá bán / chiếc <span class="required">*</span>';
    
    // Đặt lại ngày mặc định là hôm nay
    window.datePickers.sellDate.setValue(dateToISO(new Date()));
    document.getElementById("sellModelCostInfo").classList.add("hidden");

    alert(`Đã ghi nhận bán thành công ${qty} chiếc ${modelName}!`);
    refreshApplicationData();
  });
}

// Xử lý submit Form Trả hàng (return_buy / return_sell)
function setupReturnFormSubmission() {
  const returnForm = document.getElementById("returnForm");
  if (!returnForm) return;

  returnForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const returnType = document.getElementById("returnType").value; // "return_buy" | "return_sell"
    const relatedTxId = document.getElementById("returnTxSelect").value;
    const qty = Number(document.getElementById("returnQty").value);
    const returnLoss = getNumericValue(document.getElementById("returnLoss").value) || 0; // Khoản lỗ kèm theo (ship, bao bì...)
    const restockToInventory = document.getElementById("returnRestock").value !== "no"; // Mặc định Có
    const date = window.datePickers.returnDate.getValue();
    const notes = document.getElementById("returnNotes").value.trim();

    if (!relatedTxId) {
      alert("Vui lòng chọn giao dịch gốc cần trả hàng!");
      return;
    }
    if (!date || qty <= 0) {
      alert("Vui lòng điền đầy đủ và chính xác thông tin trả hàng!");
      return;
    }

    const originalTx = (state.transactions[state.activePortfolioId] || []).find(tx => tx.id === relatedTxId);
    if (!originalTx) {
      alert("Không tìm thấy giao dịch gốc, vui lòng chọn lại!");
      return;
    }

    // Không cho trả nhiều hơn số lượng gốc còn có thể trả (trừ đi các lần đã trả trước đó)
    const returnableQty = getReturnableQty(state.activePortfolioId, originalTx);
    if (qty > returnableQty) {
      alert(`Số lượng trả không hợp lệ! Chỉ có thể trả tối đa ${returnableQty} chiếc cho giao dịch này.`);
      return;
    }

    const newTx = {
      id: generateUniqueId("tx"),
      type: returnType,
      relatedTxId: originalTx.id,
      modelName: originalTx.modelName,
      brand: originalTx.brand,
      color: originalTx.color || "",
      packaging: originalTx.packaging || "",
      sku: originalTx.sku || generateSKU(originalTx.brand, originalTx.modelName, originalTx.color, originalTx.packaging),
      qty,
      returnLoss, // Khoản lỗ kèm theo (ship, bao bì hỏng...) — luôn làm giảm lợi nhuận dù trả nhập hay trả bán
      restockToInventory, // true = hàng thực sự hoàn về/rời kho | false = chỉ điều chỉnh tiền, không đụng tồn kho
      date,
      notes
    };

    if (returnType === "return_buy") {
      // Trả hàng nhập: copy lại giá vốn gốc để tính đúng phần chi phí được hoàn (giảm totalBuyCost)
      newTx.unitCost = Number(originalTx.unitCost);
    } else {
      // Trả hàng bán: copy lại giá bán + kênh gốc để tính đúng phần doanh thu bị hoàn
      newTx.unitPrice = Number(originalTx.unitPrice);
      newTx.channel = originalTx.channel || "";
    }

    if (!state.transactions[state.activePortfolioId]) {
      state.transactions[state.activePortfolioId] = [];
    }
    state.transactions[state.activePortfolioId].push(newTx);
    dbSaveTransaction(newTx);

    returnForm.reset();
    document.getElementById("returnTxSelect").value = "";
    document.getElementById("returnLoss").value = "0";
    document.getElementById("returnRestock").value = "yes";
    const infoBubble = document.getElementById("returnTxInfo");
    if (infoBubble) infoBubble.classList.add("hidden");
    window.datePickers.returnDate.setValue(dateToISO(new Date()));

    alert(`Đã ghi nhận ${returnType === "return_buy" ? "trả hàng nhập" : "trả hàng bán"} thành công cho ${qty} chiếc ${originalTx.modelName}!`);
    refreshApplicationData();
  });
}

// Xóa một giao dịch khỏi lịch sử
function deleteTransaction(txId) {
  const txs = state.transactions[state.activePortfolioId] || [];
  const targetTx = txs.find(tx => tx.id === txId);

  // Trả hàng: nếu giao dịch bị xóa là 1 giao dịch buy/sell gốc đã có trả hàng liên kết
  // (relatedTxId trỏ tới nó), ta CHỌN CÁCH XÓA LUÔN (cascade) các giao dịch trả hàng đó,
  // thay vì chỉ chặn/cảnh báo suông. Lý do: nếu để lại các bản ghi trả hàng "mồ côi"
  // (relatedTxId trỏ tới 1 giao dịch không còn tồn tại), computeReturnedQtyMap() vẫn sẽ cộng
  // dồn số lượng đã trả cho 1 id không ai dùng tới nữa — vô hại về mặt tính toán, nhưng để lại
  // dữ liệu rác gây khó hiểu khi xem lịch sử. Cascade-delete + cảnh báo rõ trước khi xóa là lựa
  // chọn an toàn và sạch dữ liệu hơn.
  const linkedReturns = targetTx
    ? txs.filter(tx => (tx.type === "return_buy" || tx.type === "return_sell") && tx.relatedTxId === txId)
    : [];

  const confirmMsg = linkedReturns.length > 0
    ? `Giao dịch này có ${linkedReturns.length} lần trả hàng liên kết. Xóa giao dịch gốc sẽ XÓA LUÔN các giao dịch trả hàng liên quan. Bạn có chắc chắn muốn tiếp tục?`
    : "Bạn có chắc chắn muốn xóa giao dịch này? Hành động này sẽ cập nhật lại toàn bộ tồn kho và lợi nhuận.";

  if (!confirm(confirmMsg)) {
    return;
  }

  const idsToDelete = new Set([txId, ...linkedReturns.map(t => t.id)]);
  const updatedTxs = txs.filter(tx => !idsToDelete.has(tx.id));

  state.transactions[state.activePortfolioId] = updatedTxs;
  idsToDelete.forEach(id => dbDeleteTransaction(id));

  refreshApplicationData();
}

// Xử lý đổi danh mục đầu tư (Portfolio)
function setupPortfolioActions() {
  const select = document.getElementById("portfolioSelect");
  const quickAddBtn = document.getElementById("addPortfolioQuickBtn");
  const createNewBtn = document.getElementById("createNewPortfolioBtn");
  const newNameInput = document.getElementById("newPortfolioNameInput");

  // Sự kiện đổi danh mục hoạt động
  select.addEventListener("change", () => {
    state.activePortfolioId = select.value;
    dbSaveSettings();
    refreshApplicationData();
  });

  // Sự kiện nút cộng nhanh ở sidebar chuyển sang tab Cài đặt
  quickAddBtn.addEventListener("click", () => {
    const settingsLink = document.querySelector('.nav-link[data-tab="settings"]');
    if (settingsLink) {
      settingsLink.click();
      setTimeout(() => {
        newNameInput.focus();
      }, 200);
    }
  });

  // Xử lý tạo danh mục mới
  createNewBtn.addEventListener("click", () => {
    const name = newNameInput.value.trim();
    if (!name) {
      alert("Vui lòng nhập tên danh mục!");
      return;
    }

    const newId = generateUniqueId("p");
    state.portfolios.push({ id: newId, name: name });
    state.transactions[newId] = [];
    state.activePortfolioId = newId;
    
    dbSavePortfolio({ id: newId, name: name });
    dbSaveSettings();
    newNameInput.value = "";
    
    alert(`Đã tạo thành công danh mục: "${name}" và chuyển sang danh mục này.`);
    
    renderPortfolioSelectors();
    refreshApplicationData();
  });
}

// Xóa danh mục đầu tư
function handleDeletePortfolio(pId, pName) {
  if (!confirm(`Bạn có chắc chắn muốn xóa danh mục "${pName}"? Toàn bộ giao dịch và lịch sử trong danh mục này sẽ bị mất vĩnh viễn!`)) {
    return;
  }

  // Lọc bỏ portfolio khỏi danh sách
  state.portfolios = state.portfolios.filter(p => p.id !== pId);
  
  // Xóa giao dịch liên quan
  delete state.transactions[pId];

  // Nếu xóa trúng danh mục đang hoạt động, chuyển về danh mục đầu tiên
  if (state.activePortfolioId === pId) {
    state.activePortfolioId = state.portfolios[0].id;
  }

  dbDeletePortfolio(pId);
  dbSaveSettings();
  renderPortfolioSelectors();
  refreshApplicationData();
}

// --- LOGIC NHẬP/XUẤT FILE EXCEL CSV ---

// Xuất danh sách giao dịch ra file CSV
// Xuất danh sách giao dịch ra file CSV
function setupCsvExport() {
  const exportBtn = document.getElementById("exportBackupCsvBtn");
  const reportExportBtn = document.getElementById("exportReportCsvBtn");

  function exportCsvProcess() {
    const txs = state.transactions[state.activePortfolioId] || [];
    
    if (txs.length === 0) {
      alert("Danh mục này chưa có giao dịch nào để xuất file!");
      return;
    }

    // Tạo tiêu đề file CSV (Bản mã UTF-8 với BOM để Excel đọc được dấu tiếng Việt)
    let csvContent = "\uFEFF";
    csvContent += "ID Giao Dịch,Loại Giao Dịch,Tên Xe,Hãng Sản Xuất,Màu Sắc,Đóng Gói,Số Lượng,Đơn Giá,Ngày Giao Dịch,Kênh Bán Hàng,Ghi Chú,Giao Dịch Gốc Liên Kết,Khoản Lỗ Trả Hàng,Hoàn Lại Kho\n";

    const typeLabels = { buy: "Mua", sell: "Bán", return_buy: "Hoàn (Trả NCC)", return_sell: "Hoàn (Khách trả)" };

    txs.forEach(t => {
      const typeLabel = typeLabels[t.type] || t.type;
      const priceVal = (t.type === "buy" || t.type === "return_buy") ? t.unitCost : t.unitPrice;
      const channelLabel = (t.type === "sell" || t.type === "return_sell") ? (t.channel || "") : "";
      
      // Xử lý dấu phẩy trong note tránh hỏng cột CSV
      const noteClean = t.notes ? t.notes.replace(/"/g, '""') : "";
      const colorClean = t.color ? t.color.replace(/"/g, '""') : "";
      const pkgClean = t.packaging ? t.packaging.replace(/"/g, '""') : "";
      const relatedTxClean = t.relatedTxId || "";
      const returnLossClean = (t.type === "return_buy" || t.type === "return_sell") ? Number(t.returnLoss || 0) : "";
      const restockClean = (t.type === "return_buy" || t.type === "return_sell") ? (t.restockToInventory !== false ? "Có" : "Không") : "";

      csvContent += `"${t.id}","${typeLabel}","${t.modelName.replace(/"/g, '""')}","${t.brand.replace(/"/g, '""')}","${colorClean}","${pkgClean}","${t.qty}","${priceVal}","${t.date}","${channelLabel}","${noteClean}","${relatedTxClean}","${returnLossClean}","${restockClean}"\n`;
    });

    // Tạo đường dẫn tải xuống
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    
    const pName = state.portfolios.find(p => p.id === state.activePortfolioId)?.name || "danhmuc";
    
    link.setAttribute("href", url);
    link.setAttribute("download", `GiaoDich_XeMoHinh_${pName.replace(/\s+/g, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  exportBtn.addEventListener("click", exportCsvProcess);
  if (reportExportBtn) reportExportBtn.addEventListener("click", exportCsvProcess);
}

// Nhập danh sách giao dịch từ file CSV (Hỗ trợ cả định dạng cũ 9 cột và mới 11 cột)
function setupCsvImport() {
  const fileInput = document.getElementById("importCsvFile");
  const fileNameSpan = document.getElementById("importCsvFileName");

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileNameSpan.innerText = file.name;

    const reader = new FileReader();
    reader.onload = function(evt) {
      try {
        const text = evt.target.result;
        const lines = text.split(/\r\n|\n/);
        
        let importCount = 0;
        let errorCount = 0;
        const newTxs = [];

        // Đọc từ dòng thứ 2 (dòng 1 là tiêu đề)
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Tách dòng bằng regex hỗ trợ trích dẫn kép "" của CSV
          const columns = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

          // Hàm làm sạch dấu ngoặc kép bọc ngoài
          const clean = str => str ? str.replace(/^"|"$/g, '').trim() : "";

          let id, typeLabel, modelName, brand, color = "", packaging = "", qty, price, date, channel = "Facebook", notes = "", relatedTxId = "", returnLossRaw = "", restockRaw = "";

          if (columns.length >= 14) {
            // Định dạng mới nhất (14 cột — có hỗ trợ Trả hàng + Hoàn lại kho)
            id = clean(columns[0]) || generateUniqueId("tx");
            typeLabel = clean(columns[1]).toLowerCase();
            modelName = clean(columns[2]);
            brand = clean(columns[3]);
            color = clean(columns[4]);
            packaging = clean(columns[5]);
            qty = Number(clean(columns[6]));
            price = Number(clean(columns[7]));
            date = clean(columns[8]);
            channel = clean(columns[9]) || "Facebook";
            notes = clean(columns[10]) || "";
            relatedTxId = clean(columns[11]) || "";
            returnLossRaw = clean(columns[12]) || "";
            restockRaw = clean(columns[13]) || "";
          } else if (columns.length >= 13) {
            // Định dạng cũ hơn (13 cột — có Trả hàng nhưng chưa có Hoàn lại kho, mặc định Có)
            id = clean(columns[0]) || generateUniqueId("tx");
            typeLabel = clean(columns[1]).toLowerCase();
            modelName = clean(columns[2]);
            brand = clean(columns[3]);
            color = clean(columns[4]);
            packaging = clean(columns[5]);
            qty = Number(clean(columns[6]));
            price = Number(clean(columns[7]));
            date = clean(columns[8]);
            channel = clean(columns[9]) || "Facebook";
            notes = clean(columns[10]) || "";
            relatedTxId = clean(columns[11]) || "";
            returnLossRaw = clean(columns[12]) || "";
          } else if (columns.length >= 11) {
            // Định dạng cũ hơn (11 cột)
            id = clean(columns[0]) || generateUniqueId("tx");
            typeLabel = clean(columns[1]).toLowerCase();
            modelName = clean(columns[2]);
            brand = clean(columns[3]);
            color = clean(columns[4]);
            packaging = clean(columns[5]);
            qty = Number(clean(columns[6]));
            price = Number(clean(columns[7]));
            date = clean(columns[8]);
            channel = clean(columns[9]) || "Facebook";
            notes = clean(columns[10]) || "";
          } else if (columns.length >= 9) {
            // Định dạng cũ (9 cột)
            id = clean(columns[0]) || generateUniqueId("tx");
            typeLabel = clean(columns[1]).toLowerCase();
            modelName = clean(columns[2]);
            brand = clean(columns[3]);
            qty = Number(clean(columns[4]));
            price = Number(clean(columns[5]));
            date = clean(columns[6]);
            channel = clean(columns[7]) || "Facebook";
            notes = clean(columns[8]) || "";
          } else {
            errorCount++;
            continue;
          }

          // Kiểm tra tính hợp lệ tối thiểu của dòng
          if (!modelName || !brand || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0 || !date) {
            errorCount++;
            continue;
          }

          // Nhận diện loại giao dịch — hỗ trợ cả nhãn tiếng Việt (Mua/Bán/Hoàn...) lẫn giá trị type gốc
          let type = "sell";
          if (typeLabel === "mua" || typeLabel === "buy") {
            type = "buy";
          } else if (typeLabel.includes("hoàn") && typeLabel.includes("ncc") || typeLabel === "return_buy") {
            type = "return_buy";
          } else if (typeLabel.includes("hoàn") || typeLabel === "return_sell") {
            type = "return_sell";
          } else if (typeLabel === "sell" || typeLabel === "bán") {
            type = "sell";
          }

          // Giao dịch Trả hàng bắt buộc phải có relatedTxId hợp lệ để không phá vỡ FIFO — nếu thiếu, bỏ qua dòng này
          if ((type === "return_buy" || type === "return_sell") && !relatedTxId) {
            errorCount++;
            continue;
          }

          // Hoàn lại kho: mặc định Có nếu cột trống/không hợp lệ, chỉ false khi ghi rõ "không"/"no"/"false"
          const restockLower = restockRaw.toLowerCase();
          const restockToInventory = !(restockLower === "không" || restockLower === "no" || restockLower === "false");

          const tx = {
            id: id.startsWith("tx-") ? id : generateUniqueId("tx"),
            type,
            modelName,
            brand,
            color,
            packaging,
            qty,
            date,
            notes
          };

          if (type === "buy") {
            tx.unitCost = price;
          } else if (type === "sell") {
            tx.unitPrice = price;
            tx.channel = ["Facebook", "Shopee", "Trực tiếp"].includes(channel) ? channel : "Trực tiếp";
          } else if (type === "return_buy") {
            tx.relatedTxId = relatedTxId;
            tx.unitCost = price;
            tx.returnLoss = Number(returnLossRaw) || 0;
            tx.restockToInventory = restockToInventory;
          } else if (type === "return_sell") {
            tx.relatedTxId = relatedTxId;
            tx.unitPrice = price;
            tx.channel = ["Facebook", "Shopee", "Trực tiếp"].includes(channel) ? channel : "Trực tiếp";
            tx.returnLoss = Number(returnLossRaw) || 0;
            tx.restockToInventory = restockToInventory;
          }

          newTxs.push(tx);
          importCount++;
        }

        if (importCount > 0) {
          if (!state.transactions[state.activePortfolioId]) {
            state.transactions[state.activePortfolioId] = [];
          }
          
          // Thêm các giao dịch mới nhập vào danh mục
          state.transactions[state.activePortfolioId].push(...newTxs);
          dbReplaceTransactions(state.activePortfolioId, state.transactions[state.activePortfolioId]);
          refreshApplicationData();
          
          alert(`Đã nhập thành công ${importCount} giao dịch từ file Excel!${errorCount > 0 ? ` (Bỏ qua ${errorCount} dòng lỗi)` : ""}`);
        } else {
          alert("Không tìm thấy dữ liệu giao dịch hợp lệ trong file CSV!");
        }

      } catch (err) {
        console.error(err);
        alert("Lỗi khi đọc file CSV. Vui lòng kiểm tra lại định dạng file!");
      }
      
      // Reset input file để có thể chọn lại cùng 1 file
      fileInput.value = "";
    };

    reader.readAsText(file, "UTF-8");
  });
}

// --- THIẾT LẬP CÁC NÚT HỆ THỐNG TRONG CÀI ĐẶT ---
function setupSystemSettings() {
  const loadMockBtn = document.getElementById("loadMockDataBtn");
  const clearDataBtn = document.getElementById("clearAllDataBtn");
  const currencySelect = document.getElementById("currencySelect");

  // Nạp dữ liệu mô phỏng từ mock_db.js
  loadMockBtn.addEventListener("click", () => {
    if (!confirm("Bạn có muốn ghi đè dữ liệu mô phỏng (2024-2026) vào danh mục này để dùng thử phần mềm?")) {
      return;
    }

    // Copy toàn bộ dữ liệu mẫu
    state.transactions[state.activePortfolioId] = JSON.parse(JSON.stringify(MOCK_TRANSACTIONS));
    dbReplaceTransactions(state.activePortfolioId, state.transactions[state.activePortfolioId]);
    refreshApplicationData();
    alert("Đã tải dữ liệu mô phỏng thành công! Hãy xem biểu đồ ở phần Tổng Quan và Báo Cáo Năm.");
    
    // Tự chuyển sang tab Dashboard để coi biểu đồ luôn
    const dbLink = document.querySelector('.nav-link[data-tab="dashboard"]');
    if (dbLink) dbLink.click();
  });

  // Xóa toàn bộ dữ liệu
  clearDataBtn.addEventListener("click", () => {
    if (!confirm("CẢNH BÁO NGUY HIỂM: Bạn có chắc muốn XÓA VĨNH VIỄN toàn bộ danh mục và tất cả lịch sử giao dịch? Hành động này không thể hoàn tác!")) {
      return;
    }

    state = {
      portfolios: [{ id: "p-default", name: "Bộ sưu tập cá nhân" }],
      activePortfolioId: "p-default",
      transactions: { "p-default": [] },
      currency: "VND",
      feeSettings: state.feeSettings || { fee: 25, extra: 4620, operation: 5000 }
    };

    dbDeletePortfolio("__ALL__"); // signal xóa tất cả — Apps Script xử lý
    dbSavePortfolio({ id: "p-default", name: "Bộ sưu tập cá nhân" });
    dbSaveSettings();
    saveStateToLocalStorage();
    renderPortfolioSelectors();
    refreshApplicationData();
    
    alert("Đã xóa sạch toàn bộ cơ sở dữ liệu về trạng thái trống ban đầu.");
  });

  // Thay đổi loại tiền tệ hiển thị
  currencySelect.addEventListener("change", () => {
    state.currency = currencySelect.value;
    dbSaveSettings();
    
    // Cập nhật text đơn vị trong Form nhập
    const symbol = state.currency === "VND" ? "vnd" : (state.currency === "USD" ? "$" : "€");
    document.getElementById("buyCurrencyAddon").innerText = symbol;
    document.getElementById("sellCurrencyAddon").innerText = symbol;
    const returnLossAddon = document.getElementById("returnLossCurrencyAddon");
    if (returnLossAddon) returnLossAddon.innerText = symbol;
    refreshApplicationData();
  });
}

// --- KHỞI CHẠY MOBILE TOGGLE ---
function setupMobileSidebarToggle() {
  const menuToggle = document.getElementById("menuToggleBtn");
  const closeSidebar = document.getElementById("closeSidebarBtn");
  const sidebar = document.getElementById("sidebar");

  menuToggle.addEventListener("click", () => {
    sidebar.classList.add("mobile-open");
  });

  closeSidebar.addEventListener("click", () => {
    sidebar.classList.remove("mobile-open");
  });
}

// --- QUẢN LÝ HÌNH ẢNH SẢN PHẨM ---
function buildCarImageKey(modelName, brand, color = "", packaging = "") {
  return `${(modelName || "").trim()}||${(brand || "").trim()}||${(color || "").trim()}||${(packaging || "").trim()}`;
}

function migrateCarImageKey(oldKey, newKey) {
  if (oldKey === newKey) return;
  const imgs = getCarImages();
  if (imgs[oldKey] && !imgs[newKey]) {
    imgs[newKey] = imgs[oldKey];
    localStorage.setItem("car_images", JSON.stringify(imgs));
  }
}
function getCarImages() {
  try { return JSON.parse(localStorage.getItem("car_images") || "{}"); } catch { return {}; }
}
// Trả về URL ảnh — tương thích cả format cũ (string) và mới ({url, fileId})
function getCarImage(key) {
  const val = getCarImages()[key];
  if (val) {
    if (typeof val === "string") return val; // format cũ: "images/file.jpg"
    return val.url || "";                    // format mới: { url, fileId }
  }
  // Fallback: nếu key có dạng Name||Brand||Color||Packaging, thử tìm ảnh theo Name||Brand
  const parts = key.split("||");
  if (parts.length > 2) {
    const fallbackKey = `${parts[0]}||${parts[1]}`;
    const fallbackVal = getCarImages()[fallbackKey];
    if (fallbackVal) {
      if (typeof fallbackVal === "string") return fallbackVal;
      return fallbackVal.url || "";
    }
  }
  return "";
}
function setCarImage(key, value) {
  const imgs = getCarImages();
  if (value) imgs[key] = value; else delete imgs[key];
  localStorage.setItem("car_images", JSON.stringify(imgs));
}
function openImgLightbox(src, caption) {
  document.getElementById("imgLightboxImg").src = src;
  document.getElementById("imgLightboxCaption").innerText = caption || "";
  document.getElementById("imgLightbox").classList.remove("hidden");
}
function closeImgLightbox() {
  document.getElementById("imgLightbox").classList.add("hidden");
  document.getElementById("imgLightboxImg").src = "";
}
async function changeCarImage(event, imgKey) {
  const file = event.target.files[0];
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["jpg","jpeg","png","webp"].includes(ext)) { alert("Chỉ hỗ trợ JPG, JPEG, PNG, WEBP."); return; }

  // Lấy fileId cũ nếu có để xóa trên Drive
  const oldData = getCarImages()[imgKey] || {};
  const oldFileId = typeof oldData === "object" ? oldData.fileId || "" : "";

  if (isCloudConfigured()) {
    const result = await dbUploadImage(file, oldFileId);
    if (result && result.ok) {
      setCarImage(imgKey, { url: result.imageUrl, fileId: result.fileId });
      refreshApplicationData();
    }
  } else {
    // Fallback: lưu local path
    const safeName = imgKey.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 60);
    const fileName = `${safeName}.${ext}`;
    setCarImage(imgKey, { url: `images/${fileName}`, fileId: "" });
    alert(`Chưa cấu hình Cloud.\nVui lòng copy ảnh vào thư mục 📁 images/ với tên: ${fileName}`);
    refreshApplicationData();
  }
}

function setupBuyImageUpload() {
  const fileInput = document.getElementById("buyImgFile");
  const preview = document.getElementById("buyImgPreview");
  const clearBtn = document.getElementById("buyImgClear");
  if (!fileInput) return;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["jpg","jpeg","png","webp"].includes(ext)) { alert("Chỉ hỗ trợ JPG, JPEG, PNG, WEBP."); fileInput.value = ""; return; }
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="preview" style="width:100%;height:100%;object-fit:cover;">`;
    fileInput._selectedFile = file;
  });
  clearBtn.addEventListener("click", () => {
    fileInput.value = ""; fileInput._selectedFile = null;
    preview.innerHTML = `<i data-lucide="image" style="width:28px;height:28px;color:var(--text-muted);"></i><span style="font-size:11px;color:var(--text-muted);margin-top:4px;">Chưa chọn ảnh</span>`;
    lucide.createIcons();
  });
}

async function saveBuyFormImage(modelName, brand, color = "", packaging = "") {
  const fileInput = document.getElementById("buyImgFile");
  if (!fileInput || !fileInput._selectedFile) return;
  const file = fileInput._selectedFile;
  const ext = file.name.split(".").pop().toLowerCase();
  const imgKey = buildCarImageKey(modelName, brand, color, packaging);

  const resetInput = () => {
    fileInput.value = ""; fileInput._selectedFile = null;
    const preview = document.getElementById("buyImgPreview");
    if (preview) { preview.innerHTML = `<i data-lucide="image" style="width:28px;height:28px;color:var(--text-muted);"></i><span style="font-size:11px;color:var(--text-muted);margin-top:4px;">Chưa chọn ảnh</span>`; lucide.createIcons(); }
  };

  if (isCloudConfigured()) {
    // Lấy fileId cũ nếu có
    const oldData = getCarImages()[imgKey] || {};
    const oldFileId = typeof oldData === "object" ? oldData.fileId || "" : "";

    const result = await dbUploadImage(file, oldFileId);
    if (result && result.ok) {
      setCarImage(imgKey, { url: result.imageUrl, fileId: result.fileId });
    }
  } else {
    const safeName = `${modelName}_${brand}_${color}_${packaging}`.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 60);
    const fileName = `${safeName}.${ext}`;
    setCarImage(imgKey, { url: `images/${fileName}`, fileId: "" });
    alert(`Chưa cấu hình Cloud.\nVui lòng copy ảnh vào 📁 images/ tên: ${fileName}`);
  }

  resetInput();
}

// --- HÀM TỔNG HỢP LÀM TƯƠI DỮ LIỆU TOÀN ỨNG DỤNG ---
function refreshApplicationData() {
  const activeId = state.activePortfolioId;

  // 1. Phân tích tính toán số liệu gốc
  const inventory = calculateInventory(activeId);
  const kpis = calculateKPIs(inventory, activeId);
  const yearlyStats = calculateYearlyStats(activeId, inventory);
  const periodProfits = calculatePeriodProfits(activeId, inventory);

  // 2. Render các bảng dữ liệu tĩnh
  renderKPIs(kpis);
  renderPeriodProfits(periodProfits);
  renderTopModelsTable(inventory);
  renderSlowModelsTable(inventory);
  renderInventoryTable(inventory);
  // Chỉ render bảng lịch sử giao dịch khi đang ở tab Giao dịch Mua/Bán
  const txPanel = document.getElementById("panel-transactions");
  if (txPanel && txPanel.classList.contains("active")) {
    renderTransactionHistoryTable(activeId, inventory);
  }
  renderYearlyReportTable(yearlyStats);
  renderFinancialInsights(activeId, yearlyStats, inventory);
  
  // 3. Cập nhật các danh sách chọn động
  renderSellFormModelSelect(inventory);
  renderBrandFilterSelect(inventory);
  // (Đã chuyển sang autocomplete tùy chỉnh cho hãng sản xuất, không cần nạp datalist nữa)

  // 4. Vẽ lại các biểu đồ đồ họa
  drawYoYChart("yoyChart", yearlyStats);
  drawYoYChart("yoyReportChart", yearlyStats);
  drawChannelChart(activeId);
  drawBrandChart(inventory);
  drawProfitTrendChart(activeId, inventory);

  // 5. Cập nhật các bộ lắng nghe khi chọn các mục trên Form (chống bug mất tham chiếu)
  setupSellFormWatcher(inventory);
}

// Kích hoạt vẽ lại biểu đồ khi chuyển tab tránh bug lỗi kích thước (do canvas ẩn)
function triggerChartsRefresh() {
  const activeId = state.activePortfolioId;
  const inventory = calculateInventory(activeId);
  const yearlyStats = calculateYearlyStats(activeId, inventory);

  // Vẽ lại đồng loạt
  drawYoYChart("yoyChart", yearlyStats);
  drawYoYChart("yoyReportChart", yearlyStats);
  drawChannelChart(activeId);
  drawBrandChart(inventory);
  drawProfitTrendChart(activeId, inventory);
}

// Thiết lập các bộ lọc tương tác trực tiếp ở màn hình Kho hàng & Lịch sử
function setupInteractiveFilters() {
  // Bộ lọc ở kho hàng
  document.getElementById("inventorySearchInput").addEventListener("input", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderInventoryTable(inventory);
  });
  
  document.getElementById("filterBrandSelect").addEventListener("change", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderInventoryTable(inventory);
  });

  document.getElementById("filterStockSelect").addEventListener("change", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderInventoryTable(inventory);
  });

  document.getElementById("sortSelect").addEventListener("change", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderInventoryTable(inventory);
  });

  // Bộ lọc ở bảng lịch sử giao dịch
  document.getElementById("historyFilterType").addEventListener("change", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderTransactionHistoryTable(state.activePortfolioId, inventory);
  });

  document.getElementById("historyFilterYear").addEventListener("change", () => {
    const inventory = calculateInventory(state.activePortfolioId);
    renderTransactionHistoryTable(state.activePortfolioId, inventory);
  });

  const historyFilterChannelEl = document.getElementById("historyFilterChannel");
  if (historyFilterChannelEl) {
    historyFilterChannelEl.addEventListener("change", () => {
      const inventory = calculateInventory(state.activePortfolioId);
      renderTransactionHistoryTable(state.activePortfolioId, inventory);
    });
  }

  const historySortEl = document.getElementById("historySort");
  if (historySortEl) {
    historySortEl.addEventListener("change", () => {
      const inventory = calculateInventory(state.activePortfolioId);
      renderTransactionHistoryTable(state.activePortfolioId, inventory);
    });
  }
}

// --- BIỂU ĐỒ LỢI NHUẬN THỜI GIAN & MODAL CHỈNH SỬA ---

// Tính toán lợi nhuận theo Ngày, Tuần, Tháng
function calculatePeriodProfits(portfolioId, inventoryList) {
  const txs = state.transactions[portfolioId] || [];

  // Tạo map giá vốn FIFO cho từng giao dịch bán
  const carMap = {};
  txs.forEach(tx => {
    const key = `${tx.modelName.trim().toLowerCase()}||${tx.brand.trim().toLowerCase()}||${(tx.color || "").trim().toLowerCase()}||${(tx.packaging || "").trim().toLowerCase()}`;
    if (!carMap[key]) carMap[key] = { buys: [], sells: [] };
    if (tx.type === "buy")  carMap[key].buys.push({ ...tx, qty: Number(tx.qty), unitCost: Number(tx.unitCost) });
    if (tx.type === "sell") carMap[key].sells.push({ ...tx, qty: Number(tx.qty), unitPrice: Number(tx.unitPrice) });
  });

  const fifoSellCostMap = {};
  for (const key in carMap) {
    const { buys, sells } = carMap[key];
    const lots = buys.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map(b => ({ unitCost: b.unitCost, remaining: b.qty }));
    const sellsSorted = sells.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    for (const sell of sellsSorted) {
      let qtyLeft = sell.qty;
      let totalCost = 0;
      let lotIdx = 0;
      while (qtyLeft > 0 && lotIdx < lots.length) {
        const lot = lots[lotIdx];
        const take = Math.min(lot.remaining, qtyLeft);
        totalCost += take * lot.unitCost;
        lot.remaining -= take;
        qtyLeft -= take;
        if (lot.remaining === 0) lotIdx++;
      }
      fifoSellCostMap[sell.id] = sell.qty > 0 ? totalCost / sell.qty : 0;
    }
  }

  // Sử dụng ngày hiện tại động
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Lấy Thứ Hai của tuần hiện tại làm mốc bắt đầu tuần
  const dayOfWeek = today.getDay(); // 0 là Chủ Nhật, 1 là Thứ Hai...
  const diffToMonday = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(diffToMonday);
  startOfWeek.setHours(0, 0, 0, 0);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Mốc đầu tháng
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  endOfMonth.setHours(23, 59, 59, 999);

  let profitToday = 0;
  let profitThisWeek = 0;
  let profitThisMonth = 0;

  txs.filter(tx => tx.type === "sell").forEach(tx => {
    if (!tx.date) return;
    
    // Cắt chuỗi ngày để tránh bị timezone shift
    const parts = tx.date.split("-");
    const txDate = new Date(parts[0], parts[1] - 1, parts[2]);
    txDate.setHours(0, 0, 0, 0);

    const fifoUnitCost = fifoSellCostMap[tx.id] || 0;
    const profit = Number(tx.qty) * (Number(tx.unitPrice) - fifoUnitCost);

    const timeTx = txDate.getTime();

    // So sánh khớp ngày
    if (timeTx === today.getTime()) {
      profitToday += profit;
    }
    // So sánh khớp tuần
    if (timeTx >= startOfWeek.getTime() && timeTx <= endOfWeek.getTime()) {
      profitThisWeek += profit;
    }
    // So sánh khớp tháng
    if (timeTx >= startOfMonth.getTime() && timeTx <= endOfMonth.getTime()) {
      profitThisMonth += profit;
    }
  });

  return {
    today: profitToday,
    week: profitThisWeek,
    month: profitThisMonth
  };
}

// Cập nhật giá trị lợi nhuận Ngày/Tuần/Tháng lên giao diện
function renderPeriodProfits(profits) {
  const formatWithColor = (val, elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerText = formatCurrency(val);
    if (val > 0) {
      el.className = "text-green";
      el.innerText = "+" + formatCurrency(val);
    } else if (val < 0) {
      el.className = "text-danger";
    } else {
      el.className = "";
    }
  };

  formatWithColor(profits.today, "val-profit-today");
  formatWithColor(profits.week, "val-profit-week");
  formatWithColor(profits.month, "val-profit-month");
}

let currentProfitPeriod = "day"; // "day", "week", "month"

// Helper: Parse chuỗi ngày an toàn (hỗ trợ cả YYYY-MM-DD và DD/MM/YYYY)
function parseDMYToLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const parts = dateStr.includes('/') ? dateStr.split('/') : dateStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // Định dạng YYYY-MM-DD
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    } else {
      // Định dạng DD/MM/YYYY
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  return new Date(dateStr); // Fallback
}

// Helper: Tìm ngày Thứ Hai của tuần chứa date
function getStartOfWeek(dateObj) {
  const d = new Date(dateObj);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// Vẽ biểu đồ xu hướng lợi nhuận ròng
function drawProfitTrendChart(portfolioId, inventoryList) {
  const ctx = document.getElementById("profitTrendChart").getContext("2d");
  if (charts.profitTrendChart) charts.profitTrendChart.destroy();

  const txs = state.transactions[portfolioId] || [];
  
  // TÍNH FIFO CHO CÁC GIAO DỊCH BÁN
  const carMap = {};
  txs.forEach(tx => {
    const key = `${tx.modelName.trim().toLowerCase()}||${tx.brand.trim().toLowerCase()}||${(tx.color || "").trim().toLowerCase()}||${(tx.packaging || "").trim().toLowerCase()}`;
    if (!carMap[key]) carMap[key] = { buys: [], sells: [] };
    if (tx.type === "buy")  carMap[key].buys.push({ ...tx, qty: Number(tx.qty), unitCost: Number(tx.unitCost) });
    if (tx.type === "sell") carMap[key].sells.push({ ...tx, qty: Number(tx.qty), unitPrice: Number(tx.unitPrice) });
  });

  const fifoSellCostMap = {};
  for (const key in carMap) {
    const { buys, sells: carSells } = carMap[key];
    const lots = buys.slice().sort((a, b) => parseDMYToLocalDate(a.date).getTime() - parseDMYToLocalDate(b.date).getTime()).map(b => ({ unitCost: b.unitCost, remaining: b.qty }));
    const sellsSorted = carSells.slice().sort((a, b) => parseDMYToLocalDate(a.date).getTime() - parseDMYToLocalDate(b.date).getTime());

    for (const sell of sellsSorted) {
      let qtyLeft = sell.qty;
      let totalCost = 0;
      let lotIdx = 0;
      while (qtyLeft > 0 && lotIdx < lots.length) {
        const lot = lots[lotIdx];
        const take = Math.min(lot.remaining, qtyLeft);
        totalCost += take * lot.unitCost;
        lot.remaining -= take;
        qtyLeft -= take;
        if (lot.remaining === 0) lotIdx++;
      }
      fifoSellCostMap[sell.id] = sell.qty > 0 ? totalCost / sell.qty : 0;
    }
  }

  // Lọc lấy các đơn bán
  const sells = txs.filter(tx => tx.type === "sell" && tx.date);

  // Kiểm tra dữ liệu có nhiều năm không để quyết định format tháng
  const sellYears = new Set(sells.map(tx => parseDMYToLocalDate(tx.date).getFullYear()));
  const hasMultipleYears = sellYears.size > 1;

  // Group profits
  const profitGroups = {};

  sells.forEach(tx => {
    const fifoUnitCost = fifoSellCostMap[tx.id] || 0;
    const profit = Number(tx.qty) * (Number(tx.unitPrice) - fifoUnitCost);
    const dateObj = parseDMYToLocalDate(tx.date);
    dateObj.setHours(0, 0, 0, 0);

    let internalKey = 0; // Dùng timestamp làm key chuẩn
    let displayLabel = "";

    if (currentProfitPeriod === "day") {
      internalKey = dateObj.getTime();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      displayLabel = `${dd}/${mm}`;
    } else if (currentProfitPeriod === "week") {
      const start = getStartOfWeek(dateObj);
      internalKey = start.getTime();

      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      
      const sMm = String(start.getMonth() + 1).padStart(2, '0');
      const sDd = String(start.getDate()).padStart(2, '0');
      const eMm = String(end.getMonth() + 1).padStart(2, '0');
      const eDd = String(end.getDate()).padStart(2, '0');
      
      displayLabel = `${sDd}/${sMm} - ${eDd}/${eMm}`;
    } else if (currentProfitPeriod === "month") {
      const yyyy = dateObj.getFullYear();
      const mm = dateObj.getMonth();
      const firstDayOfMonth = new Date(yyyy, mm, 1);
      internalKey = firstDayOfMonth.getTime();

      const mmStr = String(mm + 1).padStart(2, '0');
      displayLabel = hasMultipleYears ? `${mmStr}/${yyyy}` : `Tháng ${mm + 1}`;
    }

    if (!profitGroups[internalKey]) {
      profitGroups[internalKey] = { label: displayLabel, profit: 0, sortKey: internalKey };
    }
    profitGroups[internalKey].profit += profit;
  });

  // Chuyển object thành mảng để sort theo timestamp (sortKey) TĂNG DẦN
  let sortedGroups = Object.values(profitGroups).sort((a, b) => a.sortKey - b.sortKey);

  // Giới hạn 10 mốc gần nhất
  if (sortedGroups.length > 10) {
    sortedGroups = sortedGroups.slice(-10);
  }

  const sortedLabels = sortedGroups.map(g => g.label);
  const sortedValues = sortedGroups.map(g => g.profit);

  const hasData = sortedLabels.length > 0;

  charts.profitTrendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: hasData ? sortedLabels : ["Chưa có dữ liệu"],
      datasets: [{
        label: "Lợi nhuận (VND)",
        data: hasData ? sortedValues : [0],
        borderColor: "#f97316", // Orange
        backgroundColor: "rgba(249, 115, 22, 0.05)",
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointBackgroundColor: "#f97316",
        pointBorderColor: "#fff",
        pointHoverBackgroundColor: "#fff",
        pointHoverBorderColor: "#f97316"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          titleFont: { family: "Outfit" },
          bodyFont: { family: "Outfit" },
          callbacks: {
            label: function(context) {
              return " Lợi nhuận: " + formatCurrency(context.raw);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#9ca3af", font: { family: "Outfit" } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: {
            color: "#9ca3af",
            font: { family: "Outfit" },
            callback: function(value) {
              return formatCurrency(value);
            }
          }
        }
      }
    }
  });
}

// Bắng lắng nghe đổi chu kỳ biểu đồ lợi nhuận
function setupProfitChartPeriodToggle() {
  const periods = [
    { id: "profitPeriodDay", value: "day" },
    { id: "profitPeriodWeek", value: "week" },
    { id: "profitPeriodMonth", value: "month" }
  ];

  periods.forEach(p => {
    const btn = document.getElementById(p.id);
    if (!btn) return;
    btn.addEventListener("click", () => {
      periods.forEach(x => document.getElementById(x.id)?.classList.remove("active"));
      btn.classList.add("active");
      currentProfitPeriod = p.value;
      
      const activeId = state.activePortfolioId;
      const inventory = calculateInventory(activeId);
      drawProfitTrendChart(activeId, inventory);
    });
  });
}

// --- MODAL CHỈNH SỬA GIAO DỊCH ---

// Mở Modal và nạp thông tin
function openEditTxModal(txId) {
  const txs = state.transactions[state.activePortfolioId] || [];
  const tx = txs.find(t => t.id === txId);
  if (!tx) return;

  const isReturn = tx.type === "return_buy" || tx.type === "return_sell";

  document.getElementById("editTxId").value = tx.id;
  document.getElementById("editTxType").value = tx.type;
  document.getElementById("editTxModelName").value = tx.modelName;
  document.getElementById("editTxBrand").value = tx.brand;
  document.getElementById("editTxColor").value = tx.color || "";
  document.getElementById("editTxPackaging").value = tx.packaging || "";
  window.datePickers.editTxDate.setValue(tx.date);
  document.getElementById("editTxQty").value = tx.qty;

  const priceInput = document.getElementById("editTxPrice");
  const priceVal = (tx.type === "buy" || tx.type === "return_buy") ? Number(tx.unitCost) : Number(tx.unitPrice);
  priceInput.value = formatNumberInput(priceVal.toString());

  const channelGroup = document.getElementById("editTxChannelGroup");
  const channelSelect = document.getElementById("editTxChannel");
  const taxGroup = document.getElementById("editTxTaxUnitPriceGroup");
  const taxInput = document.getElementById("editTxTaxUnitPrice");
  const modelNameInput = document.getElementById("editTxModelName");
  const brandInput = document.getElementById("editTxBrand");
  const colorInput = document.getElementById("editTxColor");
  const packagingInput = document.getElementById("editTxPackaging");
  const returnInfoGroup = document.getElementById("editTxReturnInfoGroup");
  const returnInfoBox = document.getElementById("editTxReturnInfo");
  const returnLossGroup = document.getElementById("editTxReturnLossGroup");
  const returnLossInput = document.getElementById("editTxReturnLoss");
  const returnRestockGroup = document.getElementById("editTxReturnRestockGroup");
  const returnRestockSelect = document.getElementById("editTxReturnRestock");

  if (isReturn) {
    // Trả hàng: khóa các trường mẫu xe / giá / kênh vì chúng phải khớp với giao dịch gốc để
    // FIFO (computeReturnedQtyMap) tính đúng — chỉ cho sửa Số lượng, Ngày, Ghi chú, Khoản lỗ, Hoàn kho.
    modelNameInput.readOnly = true;
    brandInput.readOnly = true;
    colorInput.readOnly = true;
    packagingInput.readOnly = true;
    priceInput.readOnly = true;
    channelGroup.style.display = "none";
    channelSelect.required = false;
    taxGroup.style.display = "none";
    taxInput.value = "";
    document.getElementById("editTxPriceLabel").innerHTML =
      (tx.type === "return_buy" ? "Giá nhập gốc / chiếc" : "Giá bán gốc / chiếc") + " (không thể sửa)";

    const originalTx = txs.find(t => t.id === tx.relatedTxId);
    const returnableQty = getReturnableQty(state.activePortfolioId, originalTx || { id: tx.relatedTxId, qty: 0 }) + Number(tx.qty || 0);
    document.getElementById("editTxQty").max = returnableQty;
    returnInfoBox.innerHTML = `Liên kết giao dịch gốc: <strong>#${String(tx.relatedTxId || "").slice(-6)}</strong>${originalTx ? ` (${originalTx.modelName})` : ""} · Số lượng tối đa có thể sửa tới: <strong>${returnableQty}</strong>`;
    returnInfoGroup.classList.remove("hidden");
    returnLossGroup.classList.remove("hidden");
    returnLossInput.value = formatNumberInput(String(Number(tx.returnLoss || 0)));
    returnRestockGroup.classList.remove("hidden");
    returnRestockSelect.value = tx.restockToInventory === false ? "no" : "yes"; // mặc định Có nếu chưa từng set
  } else {
    modelNameInput.readOnly = false;
    brandInput.readOnly = false;
    colorInput.readOnly = false;
    packagingInput.readOnly = false;
    priceInput.readOnly = false;
    returnInfoGroup.classList.add("hidden");
    returnLossGroup.classList.add("hidden");
    returnRestockGroup.classList.add("hidden");
  }

  if (!isReturn && tx.type === "sell") {
    channelGroup.style.display = "block";
    channelSelect.value = tx.channel || "Facebook";
    channelSelect.required = true;
    document.getElementById("editTxPriceLabel").innerHTML = "Giá bán / chiếc <span class='required'>*</span>";

    // Hiện ô "Giá đăng bán Shopee" nếu kênh là Shopee, đồng thời nạp giá trị đã lưu (nếu có)
    if (tx.channel === "Shopee") {
      taxGroup.style.display = "block";
      taxInput.value = tx.taxUnitPrice ? formatNumberInput(tx.taxUnitPrice.toString()) : "";
    } else {
      taxGroup.style.display = "none";
      taxInput.value = "";
    }

    // Tự động hiện/ẩn ô này khi người dùng đổi kênh bán ngay trong modal
    channelSelect.onchange = () => {
      if (channelSelect.value === "Shopee") {
        taxGroup.style.display = "block";
      } else {
        taxGroup.style.display = "none";
        taxInput.value = "";
      }
    };
  } else if (!isReturn) {
    channelGroup.style.display = "none";
    channelSelect.required = false;
    document.getElementById("editTxPriceLabel").innerHTML = "Giá mua / chiếc <span class='required'>*</span>";
    taxGroup.style.display = "none";
    taxInput.value = "";
  }

  document.getElementById("editTxNotes").value = tx.notes || "";

  // Hiện Modal
  document.getElementById("editTxModal").classList.remove("hidden");
  lucide.createIcons();
}

function closeEditTxModal() {
  document.getElementById("editTxModal").classList.add("hidden");
}

function setupEditTxModalHandlers() {
  const form = document.getElementById("editTxForm");
  const closeBtn = document.getElementById("closeEditModalBtn");
  const cancelBtn = document.getElementById("cancelEditModalBtn");
  const priceInput = document.getElementById("editTxPrice");

  if (!form) return;

  closeBtn.onclick = () => closeEditTxModal();
  cancelBtn.onclick = () => closeEditTxModal();

  document.getElementById("editTxModal").onclick = (e) => {
    if (e.target.id === "editTxModal") closeEditTxModal();
  };

  priceInput.addEventListener("input", (e) => {
    const selectionStart = e.target.selectionStart;
    const originalLength = e.target.value.length;
    
    const formatted = formatNumberInput(e.target.value);
    e.target.value = formatted;
    
    const newLength = formatted.length;
    const newCursorPos = selectionStart + (newLength - originalLength);
    e.target.setSelectionRange(newCursorPos, newCursorPos);
  });

  form.onsubmit = (e) => {
    e.preventDefault();

    const txId = document.getElementById("editTxId").value;
    const txType = document.getElementById("editTxType").value;
    const isReturn = txType === "return_buy" || txType === "return_sell";
    const date = window.datePickers.editTxDate.getValue();
    const qty = Number(document.getElementById("editTxQty").value);
    const notes = document.getElementById("editTxNotes").value.trim();

    const txs = state.transactions[state.activePortfolioId] || [];
    const txIndex = txs.findIndex(t => t.id === txId);
    if (txIndex === -1) return;

    if (isReturn) {
      // Trả hàng: chỉ cho sửa Số lượng, Ngày, Ghi chú, Khoản lỗ — giữ nguyên mẫu xe/giá/kênh
      // để không phá vỡ liên kết relatedTxId dùng trong FIFO (computeReturnedQtyMap).
      if (!date || qty <= 0) {
        alert("Vui lòng nhập đầy đủ thông tin hợp lệ!");
        return;
      }

      const originalTx = txs.find(t => t.id === txs[txIndex].relatedTxId);
      if (originalTx) {
        // Giới hạn = số lượng còn có thể trả (chưa tính lần trả này) + số lượng hiện tại của chính nó
        const returnableExcludingSelf = getReturnableQty(state.activePortfolioId, originalTx) + Number(txs[txIndex].qty);
        if (qty > returnableExcludingSelf) {
          alert(`Số lượng trả không hợp lệ! Chỉ có thể sửa tối đa ${returnableExcludingSelf} chiếc cho giao dịch này.`);
          return;
        }
      }

      const returnLoss = getNumericValue(document.getElementById("editTxReturnLoss").value) || 0;
      const restockToInventory = document.getElementById("editTxReturnRestock").value !== "no";

      txs[txIndex].date = date;
      txs[txIndex].qty = qty;
      txs[txIndex].notes = notes;
      txs[txIndex].returnLoss = returnLoss;
      txs[txIndex].restockToInventory = restockToInventory;

      dbUpdateTransaction(txs[txIndex]);
      closeEditTxModal();
      alert("Đã cập nhật giao dịch trả hàng thành công!");
      refreshApplicationData();
      return;
    }

    const price = getNumericValue(document.getElementById("editTxPrice").value);
    const modelName = document.getElementById("editTxModelName").value.trim();
    const brand = document.getElementById("editTxBrand").value.trim();
    const color = document.getElementById("editTxColor").value.trim();
    const packaging = document.getElementById("editTxPackaging").value.trim();

    if (!date || qty <= 0 || price < 0 || !modelName) {
      alert("Vui lòng nhập đầy đủ thông tin hợp lệ!");
      return;
    }

    const oldKey = buildCarImageKey(txs[txIndex].modelName, txs[txIndex].brand, txs[txIndex].color, txs[txIndex].packaging);
    const newKey = buildCarImageKey(modelName, brand, color, packaging);
    migrateCarImageKey(oldKey, newKey);

    txs[txIndex].modelName = modelName;
    txs[txIndex].brand = brand;
    txs[txIndex].color = color;
    txs[txIndex].packaging = packaging;
    txs[txIndex].date = date;
    txs[txIndex].qty = qty;

    if (txType === "buy") {
      txs[txIndex].unitCost = price;
    } else {
      txs[txIndex].unitPrice = price;
      const newChannel = document.getElementById("editTxChannel").value;
      txs[txIndex].channel = newChannel;

      // Cập nhật giá đăng bán Shopee nếu kênh là Shopee, ngược lại xóa trường này
      if (newChannel === "Shopee") {
        const taxVal = getNumericValue(document.getElementById("editTxTaxUnitPrice").value);
        txs[txIndex].taxUnitPrice = taxVal > 0 ? taxVal : null;
      } else {
        txs[txIndex].taxUnitPrice = null;
      }
    }
    txs[txIndex].notes = notes;
    txs[txIndex].sku = generateSKU(brand, modelName, color, packaging);

    dbUpdateTransaction(txs[txIndex]);
    closeEditTxModal();
    alert("Đã cập nhật giao dịch thành công!");
    refreshApplicationData();
  };
}

// --- CÔNG CỤ TÍNH LỢI NHUẬN SHOPEE ---

function getCalcNum(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  return getNumericValue(el.value) || 0;
}

function runShopeeCalc() {
  const price = getCalcNum("calcPrice");
  const cogs = getCalcNum("calcCogs");
  const fee = getCalcNum("calcFee");
  const extra = getCalcNum("calcExtra");
  const operation = getCalcNum("calcOperation");
  const targetMargin = getCalcNum("calcTargetMargin");

  const fmt = (n) => {
    const rounded = Math.round(n);
    return rounded.toLocaleString("vi-VN") + " đ";
  };

  const revEl = document.getElementById("calcRevenue");
  const profEl = document.getElementById("calcProfit");
  const marEl = document.getElementById("calcMargin");
  const targetPriceEl = document.getElementById("calcTargetPrice");

  if (!price) {
    revEl.innerText = "—";
    profEl.innerText = "—";
    marEl.innerText = "—";
  } else {
    const feeAmount = (price * fee) / 100;
    const revenue = price - feeAmount - extra - operation;
    const profit = revenue - cogs;
    const margin = price > 0 ? (profit / price) * 100 : 0;

    revEl.innerText = fmt(revenue);
    revEl.className = revenue >= 0 ? "text-green" : "text-danger";

    profEl.innerText = fmt(profit);
    profEl.className = profit >= 0 ? "text-green" : "text-danger";

    marEl.innerText = margin.toFixed(2) + "%";
    marEl.className = margin >= 0 ? "text-green" : "text-danger";
  }

  if (!cogs || targetPriceEl == null) return;

  const denominator = 1 - (fee / 100) - (targetMargin / 100);
  if (denominator <= 0) {
    targetPriceEl.innerText = "—";
  } else {
    const targetPrice = (cogs + extra + operation) / denominator;
    targetPriceEl.innerText = fmt(targetPrice);
  }
}

// Đồng bộ phí sàn/phí kèm/vận hành sang state và cập nhật lại kho
function syncFeeSettings() {
  const fee = getCalcNum("calcFee");
  const extra = getCalcNum("calcExtra");
  const operation = getCalcNum("calcOperation");
  const targetMargin = getCalcNum("calcTargetMargin");

  state.feeSettings = { fee, extra, operation, targetMargin };
  dbSaveSettings();

  // Cập nhật lại bảng kho để hiển thị giá hòa vốn mới
  const inventory = calculateInventory(state.activePortfolioId);
  renderInventoryTable(inventory);
}

// Khởi tạo bộ tính Shopee: nạp giá trị đã lưu vào các ô
function initShopeeCalc() {
  const s = state.feeSettings || { fee: 25, extra: 4620, operation: 5000, targetMargin: 10 };
  document.getElementById("calcFee").value = s.fee;
  const tmEl = document.getElementById("calcTargetMargin");
  if (tmEl) tmEl.value = s.targetMargin !== undefined ? s.targetMargin : 10;

  const fmtInput = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = formatNumberInput(String(Math.round(val)));
  };
  fmtInput("calcExtra", s.extra);
  fmtInput("calcOperation", s.operation);

  // Nạp formatting cho calcPrice, calcCogs, calcExtra, calcOperation
  ["calcPrice", "calcCogs", "calcExtra", "calcOperation"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      const oldLen = el.value.length;
      el.value = formatNumberInput(el.value);
      const newLen = el.value.length;
      el.setSelectionRange(pos + (newLen - oldLen), pos + (newLen - oldLen));
    });
  });

  runShopeeCalc();
}

// --- BỘ CHỌN NGÀY TÙY CHỈNH (LỊCH TIẾNG VIỆT, ĐỊNH DẠNG dd/mm/yyyy) ---

const VN_MONTH_NAMES = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
  "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
];
const VN_WEEKDAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// Chuyển đối tượng Date -> chuỗi yyyy-mm-dd (dùng nội bộ để lưu trữ, đồng bộ với hệ thống cũ)
function dateToISO(d) {
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - (offset * 60 * 1000));
  return local.toISOString().split('T')[0];
}

// Chuyển chuỗi yyyy-mm-dd -> chuỗi hiển thị dd/mm/yyyy
function isoToDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Khởi tạo một bộ chọn ngày tùy chỉnh trên một input cụ thể
// wrapperId: id của thẻ div bọc ngoài input + icon
// inputId: id của input hiển thị (readonly, dd/mm/yyyy)
// Trả về object có hàm setValue(iso) và getValue() -> trả về chuỗi yyyy-mm-dd
// Icon SVG mũi tên dùng nội bộ cho lịch (tránh phụ thuộc vào lucide.createIcons khi vẽ lại nhiều lần)
const DP_ICON_CHEVRON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const DP_ICON_CHEVRON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="9 18 15 12 9 6"></polyline></svg>';
const DP_ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="6 9 12 15 18 9"></polyline></svg>';

// Cố gắng phân tích chuỗi nhập tay dd/mm/yyyy (hoặc d/m/yyyy) -> chuỗi yyyy-mm-dd. Trả về "" nếu không hợp lệ.
function parseDisplayToISO(str) {
  if (!str) return "";
  const cleaned = str.trim().replace(/[.\-]/g, "/");
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (month < 1 || month > 12) return "";
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return "";

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function initDatePicker(wrapperId) {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return null;

  const input = wrapper.querySelector(".datepicker-input");

  let viewYear, viewMonth; // Tháng hiển thị trên lịch (0-11)
  let viewMode = "days"; // "days" | "monthyear"

  // Tạo khung lịch
  const calendar = document.createElement("div");
  calendar.className = "datepicker-calendar hidden";
  wrapper.appendChild(calendar);

  // Đọc giá trị hiện tại của ô nhập (dd/mm/yyyy) -> chuỗi ISO yyyy-mm-dd (trả về "" nếu chưa đủ/không hợp lệ)
  function getSelectedISO() {
    return parseDisplayToISO(input.value);
  }

  // Gán giá trị ISO yyyy-mm-dd vào ô nhập (hiển thị dd/mm/yyyy)
  function setSelectedISO(iso) {
    input.value = isoToDisplay(iso);
  }

  function notifyChange() {
    wrapper.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function render() {
    calendar.innerHTML = "";

    if (viewMode === "monthyear") {
      renderMonthYearPicker();
    } else {
      renderDaysView();
    }
  }

  function renderDaysView() {
    const header = document.createElement("div");
    header.className = "datepicker-header";

    const monthLabel = document.createElement("div");
    monthLabel.className = "dp-month-label";
    monthLabel.innerHTML = `<span>${VN_MONTH_NAMES[viewMonth]} ${viewYear}</span>${DP_ICON_CHEVRON_DOWN}`;
    monthLabel.addEventListener("click", (e) => {
      e.stopPropagation();
      viewMode = "monthyear";
      render();
    });

    const nav = document.createElement("div");
    nav.className = "datepicker-nav";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "dp-nav-btn";
    prevBtn.innerHTML = DP_ICON_CHEVRON_LEFT;
    prevBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "dp-nav-btn";
    nextBtn.innerHTML = DP_ICON_CHEVRON_RIGHT;
    nextBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    header.appendChild(monthLabel);
    header.appendChild(nav);
    calendar.appendChild(header);

    // Hàng tên các ngày trong tuần
    const weekdaysRow = document.createElement("div");
    weekdaysRow.className = "datepicker-weekdays";
    VN_WEEKDAY_NAMES.forEach(w => {
      const span = document.createElement("span");
      span.innerText = w;
      weekdaysRow.appendChild(span);
    });
    calendar.appendChild(weekdaysRow);

    // Lưới các ngày trong tháng
    const daysGrid = document.createElement("div");
    daysGrid.className = "datepicker-days";

    const firstDay = new Date(viewYear, viewMonth, 1);
    const startWeekday = firstDay.getDay(); // 0 = CN
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const todayISO = dateToISO(new Date());
    const selectedISO = getSelectedISO();

    // Ngày của tháng trước (mờ)
    for (let i = startWeekday - 1; i >= 0; i--) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-muted";
      btn.innerText = daysInPrevMonth - i;
      btn.disabled = true;
      daysGrid.appendChild(btn);
    }

    // Ngày của tháng hiện tại
    for (let day = 1; day <= daysInMonth; day++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerText = day;

      const cellDate = new Date(viewYear, viewMonth, day);
      const cellISO = dateToISO(cellDate);

      if (cellISO === todayISO) btn.classList.add("dp-today");
      if (cellISO === selectedISO) btn.classList.add("dp-selected");

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedISO(cellISO);
        notifyChange();
        closeCalendar();
      });
      daysGrid.appendChild(btn);
    }

    // Ngày của tháng sau (mờ) để lấp đầy hàng cuối
    const totalCells = startWeekday + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-muted";
      btn.innerText = i;
      btn.disabled = true;
      daysGrid.appendChild(btn);
    }

    calendar.appendChild(daysGrid);

    // Chân lịch: Xóa / Hôm nay
    const footer = document.createElement("div");
    footer.className = "datepicker-footer";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "dp-footer-btn";
    clearBtn.innerText = "Xóa";
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSelectedISO("");
      notifyChange();
      closeCalendar();
    });

    const todayBtn = document.createElement("button");
    todayBtn.type = "button";
    todayBtn.className = "dp-footer-btn";
    todayBtn.innerText = "Hôm nay";
    todayBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const now = new Date();
      setSelectedISO(dateToISO(now));
      viewYear = now.getFullYear();
      viewMonth = now.getMonth();
      notifyChange();
      closeCalendar();
    });

    footer.appendChild(clearBtn);
    footer.appendChild(todayBtn);
    calendar.appendChild(footer);
  }

  // Bộ chọn nhanh Tháng / Năm (khi bấm vào tên tháng)
  function renderMonthYearPicker() {
    const header = document.createElement("div");
    header.className = "datepicker-header";

    const label = document.createElement("div");
    label.className = "dp-month-label";
    label.innerHTML = `<span>Chọn tháng &amp; năm</span>`;
    header.appendChild(label);
    calendar.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "datepicker-monthyear";

    // Cột tháng
    const monthCol = document.createElement("div");
    monthCol.className = "dp-my-col";
    VN_MONTH_NAMES.forEach((name, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerText = name;
      if (idx === viewMonth) btn.classList.add("dp-active");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewMonth = idx;
        viewMode = "days";
        render();
      });
      monthCol.appendChild(btn);
    });

    // Cột năm (hiển thị khoảng 12 năm xung quanh năm hiện tại)
    const yearCol = document.createElement("div");
    yearCol.className = "dp-my-col";
    const startYear = viewYear - 6;
    for (let y = startYear; y <= startYear + 11; y++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerText = y;
      if (y === viewYear) btn.classList.add("dp-active");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        viewYear = y;
        viewMode = "days";
        render();
      });
      yearCol.appendChild(btn);
    }

    grid.appendChild(monthCol);
    grid.appendChild(yearCol);
    calendar.appendChild(grid);

    // Cuộn cột năm để năm đang chọn hiển thị giữa khung
    const activeYearBtn = yearCol.querySelector(".dp-active");
    if (activeYearBtn) {
      activeYearBtn.scrollIntoView({ block: "center" });
    }
  }

  function openCalendar() {
    const iso = getSelectedISO();
    const refDate = iso ? new Date(iso) : new Date();
    viewYear = refDate.getFullYear();
    viewMonth = refDate.getMonth();
    viewMode = "days";
    render();
    calendar.classList.remove("hidden");
    wrapper.classList.add("dp-open");
  }

  function closeCalendar() {
    calendar.classList.add("hidden");
    wrapper.classList.remove("dp-open");
  }

  function toggleCalendar() {
    if (calendar.classList.contains("hidden")) {
      document.querySelectorAll(".datepicker-calendar").forEach(c => c.classList.add("hidden"));
      document.querySelectorAll(".datepicker-wrapper.dp-open").forEach(w => w.classList.remove("dp-open"));
      openCalendar();
    } else {
      closeCalendar();
    }
  }

  // Bấm icon lịch -> mở/đóng khung lịch
  const icon = wrapper.querySelector(".datepicker-icon");
  icon.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleCalendar();
  });

  // Bấm/focus vào ô nhập -> quét (bôi đen) toàn bộ ngày tháng năm để gõ đè nhanh, và mở khung lịch
  input.addEventListener("focus", () => {
    input.select();
    if (calendar.classList.contains("hidden")) {
      document.querySelectorAll(".datepicker-calendar").forEach(c => c.classList.add("hidden"));
      document.querySelectorAll(".datepicker-wrapper.dp-open").forEach(w => w.classList.remove("dp-open"));
      openCalendar();
    }
  });

  input.addEventListener("click", (e) => {
    e.stopPropagation();
    input.select();
    if (calendar.classList.contains("hidden")) {
      document.querySelectorAll(".datepicker-calendar").forEach(c => c.classList.add("hidden"));
      document.querySelectorAll(".datepicker-wrapper.dp-open").forEach(w => w.classList.remove("dp-open"));
      openCalendar();
    }
  });

  // Tự động chèn dấu "/" khi gõ số (dd/mm/yyyy) và cập nhật khung lịch theo ngày đang gõ
  input.addEventListener("input", () => {
    let digits = input.value.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    input.value = formatted;

    // Nếu đã gõ đủ dd/mm/yyyy hợp lệ, nhảy đến tháng/năm tương ứng trên lịch
    const iso = getSelectedISO();
    if (iso) {
      const refDate = new Date(iso);
      viewYear = refDate.getFullYear();
      viewMonth = refDate.getMonth();
      viewMode = "days";
      if (!calendar.classList.contains("hidden")) render();
      notifyChange();
    }
  });

  // Khi rời khỏi ô nhập, chuẩn hóa lại định dạng hiển thị nếu hợp lệ, ngược lại phục hồi giá trị cũ
  input.addEventListener("blur", () => {
    const val = input.value.trim();
    if (val === "") return;
    const iso = parseDisplayToISO(val);
    if (iso) {
      setSelectedISO(iso);
      notifyChange();
    } else {
      // Giá trị nhập chưa hoàn chỉnh/không hợp lệ -> giữ nguyên, không xóa để người dùng tiếp tục gõ
    }
  });

  // Đóng lịch khi click ra ngoài
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) {
      closeCalendar();
    }
  });

  // Ngăn click trong khung lịch làm đóng lịch ngoài ý muốn
  calendar.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  return {
    setValue: (iso) => { setSelectedISO(iso || ""); },
    getValue: () => getSelectedISO()
  };
}


// ============================================================
// MODULE THUẼ — Hàm tiện ích và tất cả logic kê khai thuế
// ============================================================

// Trạng thái tax mặc định
function getDefaultTaxState() {
  return {
    info: { taxCode: '', businessName: '', address: '' },
    config: { declarationTemplateName: '', declarationTemplateLastUpdated: '' },
    declarations: [
      {
        id: 'S1a-HKD',
        title: 'Sổ chi tiết doanh thu bán hàng hóa, dịch vụ',
        subtitle: 'Doanh thu ít hơn 500 triệu/năm',
        note: '', reportPeriod: { from: '', to: '' }, salesChannel: 'all', available: true
      },
      {
        id: 'S2a-HKD',
        title: 'Sổ doanh thu bán hàng hóa, dịch vụ',
        subtitle: 'Doanh thu nhiều hơn 500 triệu/năm và ít hơn 3 tỷ/năm',
        note: '', reportPeriod: { from: '', to: '' }, salesChannel: 'all', available: true
      }
    ]
  };
}

// --- Render: Thông Tin ---
function renderTaxInfo() {
  const info = (state.tax && state.tax.info) || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('taxCodeInput', info.taxCode);
  setVal('taxBusinessNameInput', info.businessName);
  setVal('taxAddressInput', info.address);
  lucide.createIcons();
}

// --- Save: Thông Tin ---
function saveTaxInfo() {
  if (!state.tax) state.tax = getDefaultTaxState();
  state.tax.info.taxCode      = (document.getElementById('taxCodeInput') || {}).value.trim();
  state.tax.info.businessName = (document.getElementById('taxBusinessNameInput') || {}).value.trim();
  state.tax.info.address      = (document.getElementById('taxAddressInput') || {}).value.trim();
  saveStateToLocalStorage();
  alert('Đã lưu thông tin thuế thành công!');
}

// --- Render: Tờ Khai List ---
function renderTaxDeclarations() {
  const declarations = (state.tax && state.tax.declarations) || [];
  const grid = document.getElementById('taxDeclarationGrid');
  if (!grid) return;

  // Hiển thị thông tin file mẫu nếu có
  const statusBadge = document.getElementById('taxTemplateStatusBadge');
  if (statusBadge) {
    const tplName = state.tax && state.tax.config && state.tax.config.declarationTemplateName;
    statusBadge.innerHTML = tplName
      ? `<span style="background:rgba(16,185,129,0.1);color:var(--green);padding:3px 10px;border-radius:99px;font-weight:600;">&#x2714; Đang dùng file mẫu: ${tplName}</span>`
      : `<span style="color:var(--text-muted);">Chưa cấu hình file mẫu &mdash; vào <b>Cấu hình</b> để tải lên</span>`;
  }

  const icons = [
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:48px;height:48px;color:#6366f1"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:48px;height:48px;color:#6366f1"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:48px;height:48px;color:#94a3b8"><rect x="14" y="2" width="7" height="7" rx="1"/><rect x="3" y="2" width="7" height="7" rx="1"/><rect x="14" y="15" width="7" height="7" rx="1"/><rect x="3" y="15" width="7" height="7" rx="1"/></svg>`
  ];

  grid.innerHTML = declarations.map((decl, idx) => {
    const period = decl.reportPeriod;
    const hasPeriod = period && period.from && period.to;
    const statusHtml = hasPeriod
      ? `<span class="badge badge-in-stock" style="font-size:10px;margin-top:8px;">Kỳ: ${period.from} → ${period.to}</span>`
      : '';
    const lockedOverlay = !decl.available
      ? `<div class="tax-card-locked"><span> Sắp ra mắt </span></div>`
      : '';
    const clickAttr = decl.available ? `onclick="openTaxDeclarationDetail('${decl.id}')"` : '';
    return `
      <div class="tax-declaration-card ${decl.available ? 'tax-card-available' : 'tax-card-locked-wrap'}" ${clickAttr}>
        ${lockedOverlay}
        <div class="tax-card-badge">${decl.id}</div>
        <div class="tax-card-icon">${icons[idx] || ''}</div>
        <div class="tax-card-title">${decl.title}</div>
        <div class="tax-card-subtitle">${decl.subtitle}</div>
        ${statusHtml}
        ${decl.note ? `<div class="tax-card-note">${decl.note}</div>` : ''}
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// --- Mở chi tiết tờ khai ---
let _activeTaxDeclarationId = null;

function openTaxDeclarationDetail(id) {
  const declarations = (state.tax && state.tax.declarations) || [];
  const decl = declarations.find(d => d.id === id);
  if (!decl) return;

  _activeTaxDeclarationId = id;

  document.getElementById('taxDeclarationsListView').classList.add('hidden');
  document.getElementById('taxDeclarationDetailView').classList.remove('hidden');

  document.getElementById('taxDetailTitle').innerText = `${decl.id}: ${decl.title}`;
  document.getElementById('taxDetailSubtitle').innerText = decl.subtitle;
  document.getElementById('taxDetailBadge').innerHTML =
    `<span class="badge" style="background:rgba(99,102,241,0.15);color:#a5b4fc;font-size:12px;padding:4px 12px;">${decl.id}</span>`;
  document.getElementById('taxDetailNote').value = decl.note || '';
  document.getElementById('taxDetailChannel').value = decl.salesChannel || 'all';
  document.getElementById('taxDetailPeriodError').style.display = 'none';

  // Init datepickers cho detail view nếu chưa được init
  if (!window.taxDatePickers) {
    window.taxDatePickers = {
      from: initDatePicker('taxDetailFromWrapper'),
      to:   initDatePicker('taxDetailToWrapper')
    };
  }
  window.taxDatePickers.from.setValue(decl.reportPeriod.from || '');
  window.taxDatePickers.to.setValue(decl.reportPeriod.to || '');

  lucide.createIcons();
}

// --- Đóng chi tiết tờ khai ---
function closeTaxDeclarationDetail() {
  _activeTaxDeclarationId = null;
  document.getElementById('taxDeclarationsListView').classList.remove('hidden');
  document.getElementById('taxDeclarationDetailView').classList.add('hidden');
  renderTaxDeclarations();
}

// --- Logic Lấy Dữ Liệu Bán Hàng ---
// Trả hàng: doanh thu khai thuế phải phản ánh doanh thu THỰC NHẬN sau khi trừ hàng bị trả lại.
// Đơn hoàn (return_sell) được tính là 1 khoản GIẢM TRỪ doanh thu, ghi nhận vào KỲ XẢY RA TRẢ HÀNG
// (không lùi về sửa kỳ đã khai của đơn bán gốc — vì kỳ đó có thể đã nộp tờ khai rồi).
// Trả hàng nhập (return_buy) không liên quan tới doanh thu bán ra nên KHÔNG đưa vào tờ khai này.
function getFilteredSalesTransactions(reportFrom, reportTo, salesChannel) {
  const txs = state.transactions[state.activePortfolioId] || [];
  return txs.filter(tx => {
    if (tx.type !== 'sell' && tx.type !== 'return_sell') return false;
    
    if (reportFrom && reportTo) {
      if (tx.date < reportFrom || tx.date > reportTo) return false;
    }
    
    if (salesChannel && salesChannel !== 'all') {
      if (tx.channel !== salesChannel) return false;
    }
    
    return true;
  }).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

// --- Tạo Payload S1a-HKD ---
function buildS1aExportPayload(taxInfo, decl, txs) {
  const rows = txs.map(tx => {
    let finalPrice = tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null ? tx.taxUnitPrice : tx.unitPrice;
    const isReturn = tx.type === 'return_sell';
    return {
      date: tx.date,
      description: isReturn
        ? `Hoàn trả ${tx.qty} xe ${tx.modelName} ${tx.brand} (giảm trừ doanh thu, đơn gốc #${String(tx.relatedTxId || '').slice(-6)})`
        : `Bán ${tx.qty} xe ${tx.modelName} ${tx.brand}`,
      amount: (isReturn ? -1 : 1) * Number(finalPrice) * Number(tx.qty)
    };
  });
  
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  return {
    templateId: 'S1a-HKD',
    taxInfo: taxInfo,
    period: decl.reportPeriod,
    rows: rows,
    totalAmount: totalAmount
  };
}

// --- Tạo Payload S2a-HKD ---
function buildS2aExportPayload(taxInfo, decl, txs) {
  const rows = txs.map(tx => {
    let finalPrice = tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null ? tx.taxUnitPrice : tx.unitPrice;
    const isReturn = tx.type === 'return_sell';
    return {
      refId: tx.id || `TX-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      date: tx.date,
      description: isReturn
        ? `Hoàn trả ${tx.qty} xe ${tx.modelName} ${tx.brand} (giảm trừ doanh thu, đơn gốc #${String(tx.relatedTxId || '').slice(-6)})`
        : `Bán ${tx.qty} xe ${tx.modelName} ${tx.brand}`,
      amount: (isReturn ? -1 : 1) * Number(finalPrice) * Number(tx.qty)
    };
  });
  
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

  return {
    templateId: 'S2a-HKD',
    taxInfo: taxInfo,
    period: decl.reportPeriod,
    rows: rows,
    totalAmount: totalAmount
  };
}

// --- Xem trước tờ khai ---
function previewTaxDeclaration() {
  const targetId = _activeTaxDeclarationId;
  if (!targetId || !state.tax) return;
  const declarations = state.tax.declarations || [];
  const decl = declarations.find(d => d.id === targetId);
  if (!decl) return;

  const fromVal = window.taxDatePickers ? window.taxDatePickers.from.getValue() : '';
  const toVal   = window.taxDatePickers ? window.taxDatePickers.to.getValue()   : '';

  // Kiểm tra kỳ báo cáo tối đa 1 năm
  const errEl = document.getElementById('taxDetailPeriodError');
  if (fromVal && toVal) {
    const parseDate = (iso) => {
      if (!iso) return null;
      const p = iso.split('-');
      if (p.length === 3) return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      return null;
    };
    const dFrom = parseDate(fromVal), dTo = parseDate(toVal);
    if (dFrom && dTo) {
      const diffMs = dTo - dFrom;
      const oneYearMs = 366 * 24 * 60 * 60 * 1000;
      if (diffMs < 0) {
        errEl.innerText = '⚠ Ngày kết thúc phải sau ngày bắt đầu.';
        errEl.style.display = 'block';
        return;
      }
      if (diffMs > oneYearMs) {
        errEl.innerText = '⚠ Kỳ báo cáo không được vượt quá 1 năm.';
        errEl.style.display = 'block';
        return;
      }
    }
  }
  errEl.style.display = 'none';

  // Lưu lại các thông số cấu hình đã nhập vào state
  decl.reportPeriod.from = fromVal || '';
  decl.reportPeriod.to   = toVal   || '';
  decl.salesChannel = document.getElementById('taxDetailChannel').value;
  decl.note         = document.getElementById('taxDetailNote').value.trim();
  saveStateToLocalStorage();

  // Bắt đầu trích xuất dữ liệu để build preview
  const txs = getFilteredSalesTransactions(decl.reportPeriod.from, decl.reportPeriod.to, decl.salesChannel);
  const taxInfo = state.tax.info;
  
  const printArea = document.getElementById('taxPrintArea');
  if (printArea) {
    printArea.innerHTML = generateTaxPreviewHtml(decl, taxInfo, txs);
  }

  // Hiển thị modal
  document.getElementById('taxPreviewModal').classList.remove('hidden');
}

function closeTaxPreview() {
  document.getElementById('taxPreviewModal').classList.add('hidden');
}

function generateTaxPreviewHtml(decl, info, txs) {
  const formatDate = (iso) => {
    if (!iso) return '...';
    const p = iso.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return iso;
  };

  let periodStr = `Kỳ kê khai: .......................................`;
  if (decl.reportPeriod.from && decl.reportPeriod.to) {
    const fromParts = decl.reportPeriod.from.split('-');
    const toParts = decl.reportPeriod.to.split('-');
    if (fromParts.length === 3 && toParts.length === 3 &&
        fromParts[0] === toParts[0] &&
        fromParts[1] === '01' && fromParts[2] === '01' &&
        toParts[1] === '12' && toParts[2] === '31') {
      periodStr = `Kỳ kê khai: Năm ${fromParts[0]}`;
    } else {
      periodStr = `Kỳ kê khai: ${formatDate(decl.reportPeriod.from)} đến ${formatDate(decl.reportPeriod.to)}`;
    }
  }

  const dateNow = new Date();
  
  let rowsHtml = '';
  let totalAmt = 0;
  
  // Gom nhóm giao dịch theo ngày — trả hàng bán (return_sell) tính là khoản ÂM (giảm trừ doanh thu)
  const txsByDate = {};
  txs.forEach(tx => {
    let finalPriceSource = tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null ? tx.taxUnitPrice : tx.unitPrice;
    let priceStr = String(finalPriceSource || '0').replace(/[^0-9.-]+/g, "");
    let price = parseFloat(priceStr) || 0;
    let qty = Number(tx.qty) || 1;
    let amt = price * qty * (tx.type === 'return_sell' ? -1 : 1);
    
    if (!txsByDate[tx.date]) {
      txsByDate[tx.date] = 0;
    }
    txsByDate[tx.date] += amt;
  });
  
  const groupedDates = Object.keys(txsByDate).sort();
  groupedDates.forEach(date => {
    const amt = txsByDate[date];
    totalAmt += amt;
    rowsHtml += `
      <tr>
        <td style="text-align:center;">${formatDate(date)}</td>
        <td>Doanh thu bán hàng</td>
        <td class="num-col">${amt.toLocaleString('vi-VN')}</td>
      </tr>
    `;
  });

  return `
    <div class="header-section">
      <div class="header-left">
        HỘ, CÁ NHÂN KINH DOANH: <strong>${info.businessName || '..............................'}</strong><br>
        Mã số thuế: ${info.taxCode || '..............................'}<br>
        Địa chỉ: ${info.address || '..............................'}
      </div>
      <div class="header-right">
        <strong>Mẫu số ${decl.id}</strong><br>
        (Kèm theo Thông tư số 152/2025/TT-BTC<br>
        ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)
      </div>
    </div>
    <div class="title-section">
      <h2>${decl.title}</h2>
      <p>Địa điểm kinh doanh: ${info.address || '..............................'}</p>
      <p>${periodStr}</p>
    </div>
    <div class="unit-right">Đơn vị tính: đồng Việt Nam</div>
    <table>
      <thead>
        <tr>
          <th style="width:20%">Ngày, tháng<br>A</th>
          <th style="width:55%">Giao dịch<br>B</th>
          <th style="width:25%">Số tiền<br>1</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr>
          <td colspan="2" style="text-align:center; font-weight:bold;">Tổng cộng</td>
          <td class="num-col" style="font-weight:bold;">${totalAmt.toLocaleString('vi-VN')}</td>
        </tr>
      </tbody>
    </table>
    <div class="footer-section">
      <div class="signature">
        Ngày ${dateNow.getDate()} tháng ${dateNow.getMonth() + 1} năm ${dateNow.getFullYear()}<br>
        <strong>NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/<br>CÁ NHÂN KINH DOANH</strong><br>
        (Ký, họ tên, đóng dấu)
      </div>
    </div>
  `;
}


// ─── Nút In: mở hộp thoại in của trình duyệt ─────────────────────────
function downloadTaxPdf() {
  const printArea = document.getElementById('taxPrintArea');
  if (!printArea || !printArea.innerHTML.trim()) {
    alert('Vui lòng xem trước tờ khai trước khi in!');
    return;
  }

  document.body.classList.add('printing-tax');
  const modal = document.getElementById('taxPreviewModal');
  if (modal) modal.style.display = 'none';

  window.print();

  document.body.classList.remove('printing-tax');
  if (modal) modal.style.display = '';
}


// ─── Tải tờ khai ra file Excel ───────────────────────────────────────────
async function downloadTaxExcel() {
  const targetId = _activeTaxDeclarationId;
  if (!targetId || !state.tax) return;
  const declarations = state.tax.declarations || [];
  const decl = declarations.find(d => d.id === targetId);
  if (!decl) return;
  const info = state.tax.info;

  const btn = document.getElementById('exportExcelBtn');
  const oldHTML = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-2" class="lucide-spin"></i> Đang tạo file...`;
  btn.disabled = true;
  if (window.lucide) lucide.createIcons();

  try {
    const txs = getFilteredSalesTransactions(decl.reportPeriod.from, decl.reportPeriod.to, decl.salesChannel);

    const fmtDate = (iso) => {
      if (!iso) return '';
      const p = iso.split('-');
      return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
    };

    let periodStr = '';
    if (decl.reportPeriod.from && decl.reportPeriod.to) {
      const fp = decl.reportPeriod.from.split('-');
      const tp = decl.reportPeriod.to.split('-');
      if (fp.length === 3 && tp.length === 3 && fp[0] === tp[0] && fp[1] === '01' && fp[2] === '01' && tp[1] === '12' && tp[2] === '31') {
        periodStr = `Năm ${fp[0]}`;
      } else {
        periodStr = `${fmtDate(decl.reportPeriod.from)} đến ${fmtDate(decl.reportPeriod.to)}`;
      }
    }

    const txsByDate = {};
    txs.forEach(tx => {
      let finalPriceSource = tx.taxUnitPrice !== undefined && tx.taxUnitPrice !== null ? tx.taxUnitPrice : tx.unitPrice;
      const price = parseFloat(String(finalPriceSource || '0').replace(/[^0-9.-]+/g, '')) || 0;
      const qty = Number(tx.qty) || 1;
      // Trả hàng bán (return_sell): giảm trừ doanh thu, tính là khoản âm trong kỳ xảy ra trả hàng
      const amt = price * qty * (tx.type === 'return_sell' ? -1 : 1);
      if (!txsByDate[tx.date]) txsByDate[tx.date] = 0;
      txsByDate[tx.date] += amt;
    });

    const rows = Object.keys(txsByDate).sort().map(date => ({
      date: fmtDate(date),
      amount: txsByDate[date]
    }));
    const total = rows.reduce((s, r) => s + r.amount, 0);

    const dateNow = new Date();
    const signDate = `Ngày ${dateNow.getDate()} tháng ${dateNow.getMonth() + 1} năm ${dateNow.getFullYear()}`;
    
    // Kiểm tra xem có file mẫu trong localStorage không
    const b64Template = localStorage.getItem('model_car_tax_template');
    
    const workbook = new ExcelJS.Workbook();
    let worksheet;

    if (b64Template) {
      // 1. DÙNG TEMPLATE CỦA USER
      const binaryString = window.atob(b64Template);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await workbook.xlsx.load(bytes.buffer);
      
      // Tìm tab phù hợp (ưu tiên tên sheet có chứa ID hoặc ngược lại ID chứa tên sheet)
      let targetSheetName = null;
      const normalizedDeclId = decl.id.replace(/\s|-|\//g,'').toLowerCase(); // s1ahkd

      for (const ws of workbook.worksheets) {
        const wsName = ws.name.replace(/\s|-|\//g,'').toLowerCase();
        // Bỏ qua các sheet có tên rỗng hoặc quá ngắn (dưới 2 ký tự) nếu không khớp hoàn toàn
        if (wsName.length < 2) continue; 
        
        if (wsName.includes(normalizedDeclId) || normalizedDeclId.includes(wsName)) {
          targetSheetName = ws.name;
          break;
        }
      }
      
      if (!targetSheetName) targetSheetName = workbook.worksheets[0].name;
      worksheet = workbook.getWorksheet(targetSheetName);

      // Xóa các sheet không liên quan để file xuất ra chỉ chứa đúng 1 sheet
      const sheetsToRemove = [];
      workbook.eachSheet((ws) => {
        if (ws.name !== targetSheetName) {
          sheetsToRemove.push(ws.id);
        }
      });
      sheetsToRemove.forEach(id => workbook.removeWorksheet(id));


      // Điền thông tin tĩnh
      const getSafeText = (c) => {
        if (!c) return '';
        try {
          if (c.value && c.value.richText) return c.value.richText.map(t => t.text).join('');
          if (c.value && c.value.result !== undefined) return String(c.value.result || '');
          return String(c.text || c.value || '');
        } catch(e) {
          return '';
        }
      };
      const normalize = (v) => String(v || '').toLowerCase().trim();
      let rowHeader = -1;
      let colNgay = 1;
      let colDienGiai = 2;
      let colSoTien = 3;

      worksheet.eachRow((row, rowNumber) => {
        let hasNgay = false;
        let hasThang = false;
        let hasGiao = false;

        row.eachCell((cell, colNumber) => {
          if (cell.isMerged && cell.master !== cell) return; // Bỏ qua các ô phụ trong cụm merge
          const v = normalize(getSafeText(cell));
          
          let modified = false;
          let newText = getSafeText(cell);
          
          if (v.includes('hộ, cá nhân kinh doanh')) {
             if (v.includes('mã số thuế') || v.includes('địa chỉ')) {
                // Cùng nằm trong 1 ô (Alt+Enter)
                newText = `HỌ, CÁ NHÂN KINH DOANH: ${info.businessName || ''}\nMã số thuế: ${info.taxCode || ''}\nĐịa chỉ: ${info.address || ''}`;
                modified = true;
             } else {
                newText = 'HỌ, CÁ NHÂN KINH DOANH: ' + (info.businessName || '');
                modified = true;
             }
          }
          if (!modified && v.includes('mã số thuế')) {
             newText = 'Mã số thuế: ' + (info.taxCode || '');
             modified = true;
          }
          if (!modified && v.includes('địa chỉ') && !v.includes('điểm')) {
             newText = 'Địa chỉ: ' + (info.address || '');
             modified = true;
          }
          if (!modified && (v.includes('kỳ kê khai') || v.includes('kỳ khai thuế'))) {
             newText = 'Kỳ khai thuế: ' + periodStr;
             modified = true;
          }
          if (!modified && v.includes('địa điểm kinh doanh')) {
             newText = 'Địa điểm kinh doanh: ' + (info.address || '');
             modified = true;
          }
          if (!modified && v.includes('đơn vị tính')) {
             newText = 'Đơn vị tính: VNĐ';
             modified = true;
          }
          if (!modified && v.includes('ngày') && v.includes('tháng') && v.includes('năm') && v.includes('...')) {
             newText = signDate;
             modified = true;
          }

          if (modified) {
             cell.value = newText;
             cell.alignment = cell.alignment || {};
             cell.alignment.wrapText = true;
          }

          if (v.includes('ngày') || v.includes('ng ')) hasNgay = true;
          if (v.includes('tháng')) hasThang = true;
          if (v.includes('giao') || v.includes('diễn giải') || v.includes('dien giai')) hasGiao = true;
        });

        if (hasGiao && (hasNgay || hasThang) && rowHeader === -1) {
          rowHeader = rowNumber;
          row.eachCell((cell, colNumber) => {
            if (cell.isMerged && cell.master !== cell) return;
            const v = normalize(getSafeText(cell));
            if (v.includes('ngày') || v.includes('ng ')) colNgay = colNumber;
            if (v.includes('giao') || v.includes('diễn giải') || v.includes('dien giai')) colDienGiai = colNumber;
            if (v.includes('số tiền') || v.includes('so tien')) colSoTien = colNumber;
          });
        }
      });

      if (rowHeader !== -1) {
        let dataStartRow = rowHeader + 1;
        const subRow = worksheet.getRow(dataStartRow);
        let isSub = false;
        subRow.eachCell(cell => { 
            const v = normalize(getSafeText(cell));
            if (v === 'a' || v === '1') isSub = true; 
        });
        if (isSub) dataStartRow++;

        let rowTongCong = -1;
        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber >= dataStartRow) {
            row.eachCell(cell => {
              const v = normalize(getSafeText(cell));
              if (v.includes('tổng cộng') || v.includes('tong cong')) rowTongCong = rowNumber;
            });
          }
        });

        if (rowTongCong !== -1) {
          const availableRows = rowTongCong - dataStartRow;
          const neededRows = rows.length;

          // Nếu thiếu dòng, insert thêm ngay trên Tổng cộng
          if (neededRows > availableRows) {
            const extra = neededRows - availableRows;
            worksheet.spliceRows(rowTongCong, 0, ...Array(extra).fill([]));
            
            // Tìm các cột được merge ở dòng dataStartRow để áp dụng cho các dòng mới
            const mergesToCopy = [];
            for (let c = 1; c <= 30; c++) {
               const cell = worksheet.getRow(dataStartRow).getCell(c);
               if (cell.isMerged && cell.master === cell) {
                  let right = c;
                  while (worksheet.getRow(dataStartRow).getCell(right+1).isMerged && worksheet.getRow(dataStartRow).getCell(right+1).master === cell) {
                     right++;
                  }
                  if (right > c) mergesToCopy.push({left: c, right: right});
                  c = right;
               }
            }

            // Copy style và merge
            for (let i = 0; i < extra; i++) {
               const srcRow = worksheet.getRow(dataStartRow);
               const dstRow = worksheet.getRow(rowTongCong + i);
               dstRow.height = srcRow.height;
               for (let c = 1; c <= 30; c++) {
                 dstRow.getCell(c).style = srcRow.getCell(c).style;
               }
               mergesToCopy.forEach(m => {
                 worksheet.mergeCells(rowTongCong + i, m.left, rowTongCong + i, m.right);
               });
            }
            rowTongCong += extra;
          } else if (availableRows > neededRows) {
            // Nếu thừa dòng, xóa bớt
            const extra = availableRows - neededRows;
            if (neededRows === 0 && availableRows > 0) {
              // Nếu không có data, chừa lại 1 dòng trống để không phá vỡ template
              if (extra > 1) {
                worksheet.spliceRows(dataStartRow + 1, extra - 1);
                rowTongCong -= (extra - 1);
              }
            } else if (extra > 0) {
              worksheet.spliceRows(dataStartRow + neededRows, extra);
              rowTongCong -= extra;
            }
          }

          // Điền data vào các dòng có sẵn
          for (let i = 0; i < neededRows; i++) {
             const rData = worksheet.getRow(dataStartRow + i);
             rData.getCell(colNgay).value = rows[i].date;
             rData.getCell(colDienGiai).value = "Doanh thu bán hàng";
             rData.getCell(colSoTien).value = rows[i].amount;
             rData.getCell(colSoTien).numFmt = '#,##0'; // Đảm bảo format số
          }

          // Ghi tổng
          worksheet.getRow(rowTongCong).getCell(colSoTien).value = total;
          worksheet.getRow(rowTongCong).getCell(colSoTien).numFmt = '#,##0';
        }
      }
    } else {
      // 2. TẠO TỪ SCRATCH NẾU KHÔNG CÓ TEMPLATE
      worksheet = workbook.addWorksheet(`Mẫu số ${decl.id}`);
      
      worksheet.getColumn(1).width = 25;
      worksheet.getColumn(2).width = 45;
      worksheet.getColumn(3).width = 25;

      const setStyle = (cell, options) => {
        cell.font = { name: 'Times New Roman', size: options.size || 12, bold: options.bold || false, italic: options.italic || false };
        cell.alignment = { vertical: 'middle', horizontal: options.align || 'left', wrapText: true };
      };
      const setBrd = (cell) => {
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
      };

      let r1 = worksheet.getRow(1);
      r1.getCell(1).value = `HỌ, CÁ NHÂN KINH DOANH: ${info.businessName || ''}`;
      r1.getCell(3).value = `Mẫu số S1a-HKD`;
      setStyle(r1.getCell(1), {bold: true, size: 12});
      setStyle(r1.getCell(3), {bold: true, size: 12, align: 'center'});

      let r2 = worksheet.getRow(2);
      r2.getCell(1).value = `Mã số thuế: ${info.taxCode || ''}`;
      r2.getCell(3).value = `(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)`;
      setStyle(r2.getCell(1), {bold: true, size: 12});
      setStyle(r2.getCell(3), {size: 11, italic: true, align: 'center'});
      r2.height = 35;

      let r3 = worksheet.getRow(3);
      r3.getCell(1).value = `Địa chỉ: ${info.address || ''}`;
      setStyle(r3.getCell(1), {bold: true, size: 12});

      let r6 = worksheet.getRow(6);
      worksheet.mergeCells('A6:C6');
      r6.getCell(1).value = `SỔ CHI TIẾT DOANH THU BÁN HÀNG HÓA, DỊCH VỤ`;
      setStyle(r6.getCell(1), {bold: true, size: 14, align: 'center'});

      let r7 = worksheet.getRow(7);
      worksheet.mergeCells('A7:C7');
      r7.getCell(1).value = `Địa điểm kinh doanh: ${info.address || ''}`;
      setStyle(r7.getCell(1), {size: 12, align: 'center'});
      
      let r8 = worksheet.getRow(8);
      worksheet.mergeCells('A8:C8');
      r8.getCell(1).value = `Kỳ kê khai: ${periodStr}`;
      setStyle(r8.getCell(1), {size: 12, align: 'center'});

      let r9 = worksheet.getRow(9);
      worksheet.mergeCells('A9:C9');
      r9.getCell(1).value = `Đơn vị tính: VNĐ`;
      setStyle(r9.getCell(1), {size: 12, italic: true, align: 'right'});

      let r10 = worksheet.getRow(10);
      r10.getCell(1).value = 'Ngày\ntháng';
      r10.getCell(2).value = 'Giao dịch';
      r10.getCell(3).value = 'Số tiền';
      [1,2,3].forEach(c => { setStyle(r10.getCell(c), {bold: true, align: 'center'}); setBrd(r10.getCell(c)); });
      r10.height = 30;

      let r11 = worksheet.getRow(11);
      r11.getCell(1).value = 'A';
      r11.getCell(2).value = 'B';
      r11.getCell(3).value = '1';
      [1,2,3].forEach(c => { setStyle(r11.getCell(c), {bold: true, align: 'center'}); setBrd(r11.getCell(c)); });

      let currentRow = 12;
      rows.forEach(r => {
         let rData = worksheet.getRow(currentRow);
         rData.getCell(1).value = r.date;
         rData.getCell(2).value = 'Doanh thu bán hàng';
         rData.getCell(3).value = r.amount;
         setStyle(rData.getCell(1), {align: 'center'});
         setStyle(rData.getCell(2), {align: 'left'});
         setStyle(rData.getCell(3), {align: 'right'});
         rData.getCell(3).numFmt = '#,##0';
         [1,2,3].forEach(c => setBrd(rData.getCell(c)));
         currentRow++;
      });

      let rTotal = worksheet.getRow(currentRow);
      worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
      rTotal.getCell(1).value = 'Tổng cộng';
      rTotal.getCell(3).value = total;
      setStyle(rTotal.getCell(1), {bold: true, align: 'center'});
      setStyle(rTotal.getCell(3), {bold: true, align: 'right'});
      rTotal.getCell(3).numFmt = '#,##0';
      setBrd(rTotal.getCell(1));
      setBrd(rTotal.getCell(3)); // cell 2 is merged

      let rSign = worksheet.getRow(currentRow + 2);
      worksheet.mergeCells(`B${currentRow+2}:C${currentRow+2}`);
      rSign.getCell(2).value = signDate;
      setStyle(rSign.getCell(2), {italic: true, align: 'center'});

      let rSign2 = worksheet.getRow(currentRow + 3);
      worksheet.mergeCells(`B${currentRow+3}:C${currentRow+3}`);
      rSign2.getCell(2).value = `NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/\nCÁ NHÂN KINH DOANH\n(Ký, họ tên, đóng dấu)`;
      setStyle(rSign2.getCell(2), {bold: true, align: 'center'});
      rSign2.height = 60;
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Tạo PDF từ vùng preview HTML
    const printArea = document.getElementById('taxPrintArea');
    let pdfBlob = null;
    if (printArea && printArea.innerHTML.trim() && typeof html2pdf !== 'undefined') {
      pdfBlob = await html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `To_Khai_${decl.id}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      }).from(printArea).outputPdf('blob');
    }

    // Đóng gói vào ZIP
    const zip = new JSZip();
    const fileName = `To_Khai_${decl.id}_${new Date().toISOString().slice(0,10)}`;
    zip.file(`${fileName}.xlsx`, excelBuffer);
    if (pdfBlob) zip.file(`${fileName}.pdf`, pdfBlob);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error(err);
    alert('❌ Lỗi khi xuất Excel: ' + err.message);
  } finally {
    btn.innerHTML = oldHTML;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }
}

async function downloadTaxZip() {
  const targetId = _activeTaxDeclarationId;
  if (!targetId || !state.tax) return;
  const declarations = state.tax.declarations || [];
  const decl = declarations.find(d => d.id === targetId);
  if (!decl) return;
  const info = state.tax.info;

  const btn = document.getElementById('exportZipBtn');
  const oldHTML = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-2" class="lucide-spin"></i> Đang nén...`;
  btn.disabled = true;

  try {
    const printArea = document.getElementById('taxPrintArea');
    if (!printArea) throw new Error("Không tìm thấy dữ liệu.");

    // 1. Tạo file Excel (SheetJS)
    const txs = getFilteredSalesTransactions(decl.reportPeriod.from, decl.reportPeriod.to, decl.salesChannel);
    const formatDate = (iso) => {
      if (!iso) return '...';
      const p = iso.split('-');
      if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
      return iso;
    };
    
    let periodStr = `Kỳ kê khai: .......................................`;
    if (decl.reportPeriod.from && decl.reportPeriod.to) {
      const fromParts = decl.reportPeriod.from.split('-');
      const toParts = decl.reportPeriod.to.split('-');
      if (fromParts.length === 3 && toParts.length === 3 && fromParts[0] === toParts[0] && fromParts[1] === '01' && fromParts[2] === '01' && toParts[1] === '12' && toParts[2] === '31') {
        periodStr = `Kỳ kê khai: Năm ${fromParts[0]}`;
      } else {
        periodStr = `Kỳ kê khai: ${formatDate(decl.reportPeriod.from)} đến ${formatDate(decl.reportPeriod.to)}`;
      }
    }

    const txsByDate = {};
    txs.forEach(tx => {
      let priceStr = String(tx.unitPrice || '0').replace(/[^0-9.-]+/g, "");
      let price = parseFloat(priceStr) || 0;
      let qty = Number(tx.qty) || 1;
      // Trả hàng bán (return_sell): giảm trừ doanh thu, tính là khoản âm trong kỳ xảy ra trả hàng
      const amt = price * qty * (tx.type === 'return_sell' ? -1 : 1);
      if (!txsByDate[tx.date]) txsByDate[tx.date] = 0;
      txsByDate[tx.date] += amt;
    });

    function base64ToArrayBuffer(base64) {
      var binary_string = window.atob(base64);
      var len = binary_string.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
          bytes[i] = binary_string.charCodeAt(i);
      }
      return bytes.buffer;
    }

    const workbook = new ExcelJS.Workbook();
    let templateData = localStorage.getItem('model_car_tax_template');
    if (!templateData && state.tax.config && state.tax.config.declarationTemplateData) {
      templateData = state.tax.config.declarationTemplateData;
    }

    if (templateData) {
      const buffer = base64ToArrayBuffer(templateData);
      await workbook.xlsx.load(buffer);
      const ws = workbook.worksheets[0];

      const setVal = (cell, val) => {
        const c = ws.getCell(cell);
        if (c) c.value = val;
      };

      setVal('A1', `HỘ, CÁ NHÂN KINH DOANH: ${info.businessName || '..............................'}`);
      setVal('A2', `Mã số thuế: ${info.taxCode || '..............................'}`);
      setVal('A3', `Địa chỉ: ${info.address || '..............................'}`);
      setVal('C1', `Mẫu số ${decl.id}`);
      setVal('A5', decl.title);
      setVal('A6', `Địa điểm kinh doanh: ${info.address || '..............................'}`);
      setVal('A7', periodStr);

      let startRow = 8;
      ws.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          if (cell.value && String(cell.value).toLowerCase().includes("ngày, tháng")) {
            startRow = rowNumber + 1;
          }
        });
      });
      
      let totalAmt = 0;
      let currRow = startRow;
      const groupedDates = Object.keys(txsByDate).sort();
      const styleRow = ws.getRow(startRow); // Copy style từ hàng trống đầu tiên
      
      groupedDates.forEach(date => {
        const amt = txsByDate[date];
        totalAmt += amt;
        
        let row = ws.getRow(currRow);
        row.getCell(1).value = formatDate(date);
        row.getCell(2).value = "Doanh thu bán hàng";
        row.getCell(3).value = amt;
        
        // Copy styles
        for(let i=1; i<=3; i++) {
           row.getCell(i).style = styleRow.getCell(i).style;
        }
        currRow++;
      });

      // Tổng cộng
      let totalRow = ws.getRow(currRow);
      totalRow.getCell(1).value = "Tổng cộng";
      totalRow.getCell(3).value = totalAmt;
      for(let i=1; i<=3; i++) {
           totalRow.getCell(i).style = styleRow.getCell(i).style;
      }
      totalRow.getCell(1).font = { bold: true };
      totalRow.getCell(3).font = { bold: true };

      currRow += 2;
      const dateNow = new Date();
      ws.getCell(`C${currRow}`).value = `Ngày ${dateNow.getDate()} tháng ${dateNow.getMonth() + 1} năm ${dateNow.getFullYear()}`;
      ws.getCell(`C${currRow}`).alignment = { horizontal: 'center' };
      ws.getCell(`C${currRow+1}`).value = "NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/\nCÁ NHÂN KINH DOANH";
      ws.getCell(`C${currRow+1}`).alignment = { horizontal: 'center', wrapText: true };
      ws.getCell(`C${currRow+1}`).font = { bold: true };
      ws.getCell(`C${currRow+2}`).value = "(Ký, họ tên, đóng dấu)";
      ws.getCell(`C${currRow+2}`).alignment = { horizontal: 'center' };
    } else {
      const ws = workbook.addWorksheet("ToKhai");
      ws.columns = [
         { header: '', key: 'col1', width: 15 },
         { header: '', key: 'col2', width: 45 },
         { header: '', key: 'col3', width: 18 }
      ];
      ws.getCell('A1').value = `HỘ, CÁ NHÂN KINH DOANH: ${info.businessName || '..............................'}`;
      ws.getCell('C1').value = `Mẫu số ${decl.id}`;
      ws.getCell('A2').value = `Mã số thuế: ${info.taxCode || '..............................'}`;
      ws.getCell('C2').value = `(Kèm theo Thông tư số 152/2025/TT-BTC`;
      ws.getCell('A3').value = `Địa chỉ: ${info.address || '..............................'}`;
      ws.getCell('C3').value = `ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)`;
      
      ws.getCell('A5').value = decl.title;
      ws.getCell('A5').font = { bold: true, size: 12 };
      ws.getCell('A5').alignment = { horizontal: 'center' };
      ws.mergeCells('A5:C5');
      
      ws.getCell('A6').value = `Địa điểm kinh doanh: ${info.address || '..............................'}`;
      ws.mergeCells('A6:C6');
      ws.getCell('A7').value = periodStr;
      ws.mergeCells('A7:C7');
      
      ws.getCell('C8').value = "Đơn vị tính: đồng Việt Nam";
      ws.getCell('C8').alignment = { horizontal: 'right' };
      
      const headerRow = ws.getRow(9);
      headerRow.values = ["Ngày, tháng\nA", "Giao dịch\nB", "Số tiền\n1"];
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      
      let currRow = 10;
      let totalAmt = 0;
      const groupedDates = Object.keys(txsByDate).sort();
      groupedDates.forEach(date => {
        const amt = txsByDate[date];
        totalAmt += amt;
        let row = ws.getRow(currRow);
        row.values = [formatDate(date), "Doanh thu bán hàng", amt];
        currRow++;
      });
      
      let totalRow = ws.getRow(currRow);
      totalRow.values = ["Tổng cộng", "", totalAmt];
      totalRow.font = { bold: true };
      
      // Khung viền
      for(let r = 9; r <= currRow; r++) {
         let rObj = ws.getRow(r);
         for(let c = 1; c <= 3; c++) {
            rObj.getCell(c).border = {
               top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
            };
         }
      }
      
      currRow += 2;
      const dateNow = new Date();
      ws.getCell(`C${currRow}`).value = `Ngày ${dateNow.getDate()} tháng ${dateNow.getMonth() + 1} năm ${dateNow.getFullYear()}`;
      ws.getCell(`C${currRow}`).alignment = { horizontal: 'center' };
      ws.getCell(`C${currRow+1}`).value = "NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/\nCÁ NHÂN KINH DOANH";
      ws.getCell(`C${currRow+1}`).alignment = { horizontal: 'center', wrapText: true };
      ws.getCell(`C${currRow+1}`).font = { bold: true };
      ws.getCell(`C${currRow+2}`).value = "(Ký, họ tên, đóng dấu)";
      ws.getCell(`C${currRow+2}`).alignment = { horizontal: 'center' };
    }

    const excelBuffer = await workbook.xlsx.writeBuffer();
    const excelBlob = new Blob([excelBuffer], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

    // 2. Tạo file PDF (html2pdf)
    const opt = {
      margin:       10,
      filename:     `ToKhai.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    const pdfBlob = await html2pdf().set(opt).from(printArea).output('blob');

    // 3. Nén ZIP (JSZip)
    const zip = new JSZip();
    const baseName = `ToKhai_${targetId}_${Date.now()}`;
    zip.file(`${baseName}.xlsx`, excelBlob);
    zip.file(`${baseName}.pdf`, pdfBlob);

    const zipBlob = await zip.generateAsync({type:"blob"});
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error(err);
    alert("Đã xảy ra lỗi khi tạo file ZIP: " + err.message);
  } finally {
    if(btn) {
        btn.innerHTML = oldHTML;
        btn.disabled = false;
        if(window.lucide) lucide.createIcons();
    }
  }
}

// --- Render: Cấu Hình ---
function renderTaxConfig() {
  const cfg = (state.tax && state.tax.config) || {};
  const infoEl = document.getElementById('taxTemplateCurrentInfo');
  const fileNameEl = document.getElementById('taxTemplateFileName');
  if (cfg.declarationTemplateName) {
    if (infoEl) infoEl.innerHTML = `
      <b>Đang dùng file mẫu:</b> ${cfg.declarationTemplateName}<br>
      <span style="font-size:12px;color:var(--text-muted);">Cập nhật lúc: ${cfg.declarationTemplateLastUpdated || 'Chưa rõ'}</span>
    `;
    if (fileNameEl) fileNameEl.innerText = cfg.declarationTemplateName;
  } else {
    if (infoEl) infoEl.innerHTML = `<span style="color:var(--text-muted);">Chưa có file mẫu nào được chọn. File mặc định: <b>SO_SACH_KE-TOAN_THEO_TT_152-1.xlsx</b></span>`;
    if (fileNameEl) fileNameEl.innerText = 'Chưa chọn file';
  }
  lucide.createIcons();
}

// --- Upload file mẫu ---
function handleTaxTemplateUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!state.tax) state.tax = getDefaultTaxState();

  const reader = new FileReader();
  reader.onload = function(e) {
    const data = e.target.result;
    const base64 = data.split(',')[1];
    
    // Lưu base64 vào key riêng biệt để chống lag
    localStorage.setItem('model_car_tax_template', base64);
    
    state.tax.config.declarationTemplateName = file.name;
    state.tax.config.declarationTemplateLastUpdated = new Date().toLocaleString('vi-VN');
    delete state.tax.config.declarationTemplateData; // đảm bảo không có
    saveStateToLocalStorage();

    const fileNameEl = document.getElementById('taxTemplateFileName');
    if (fileNameEl) fileNameEl.innerText = file.name;
    renderTaxConfig();
    alert(`Đã lưu file mẫu: ${file.name}`);
  };
  reader.readAsDataURL(file);

  // Reset input để có thể chọn lại cùng file nếu muốn
  event.target.value = '';
}

// --- Xóa file mẫu ---
function removeTaxTemplate() {
  if (!state.tax) return;
  if (!confirm('Xóa file mẫu kê khai?')) return;
  
  localStorage.removeItem('model_car_tax_template');
  
  state.tax.config.declarationTemplateName = '';
  state.tax.config.declarationTemplateLastUpdated = '';
  delete state.tax.config.declarationTemplateData;
  saveStateToLocalStorage();
  renderTaxConfig();
}

window.addEventListener("DOMContentLoaded", async () => {
  // Khởi tạo các bộ chọn ngày tùy chỉnh (lịch tiếng Việt, định dạng dd/mm/yyyy)
  window.datePickers = {
    buyDate: initDatePicker("buyDateWrapper"),
    sellDate: initDatePicker("sellDateWrapper"),
    editTxDate: initDatePicker("editTxDateWrapper"),
    returnDate: initDatePicker("returnDateWrapper") // Trả hàng: dùng lại datepicker sẵn có
  };

  // Thiết lập mặc định ngày nhập/bán trong Form là ngày hôm nay theo múi giờ địa phương Việt Nam
  const setLocalToday = (pickerKey) => {
    const picker = window.datePickers[pickerKey];
    if (picker) picker.setValue(dateToISO(new Date()));
  };
  setLocalToday("buyDate");
  setLocalToday("sellDate");
  setLocalToday("returnDate");

  // 1. Tải dữ liệu (Cloud nếu đã cấu hình, fallback LocalStorage)
  await loadData();
  
  // Đồng bộ giá trị tiền tệ đã lưu lên dropdown chọn
  document.getElementById("currencySelect").value = state.currency;
  const symbol = state.currency === "VND" ? "vnd" : (state.currency === "USD" ? "$" : "€");
  document.getElementById("buyCurrencyAddon").innerText = symbol;
  document.getElementById("sellCurrencyAddon").innerText = symbol;
  const returnLossAddonInit = document.getElementById("returnLossCurrencyAddon");
  if (returnLossAddonInit) returnLossAddonInit.innerText = symbol;
  setupInputFormatting(); // Kích hoạt tự động định dạng khi gõ tiền

  // 2. Chạy render giao diện ban đầu
  renderPortfolioSelectors();
  setupTabNavigation();
  setupInventoryViewToggle();
  setupAutocomplete();
  setupBrandAutocomplete();
  setupColorAutocomplete();
  setupPackagingAutocomplete();
  setupSellAutocomplete();
  setupEditTxAutocomplete();
  setupReturnAutocomplete();     // Trả hàng: autocomplete tìm giao dịch gốc
  initShopeeCalc();
  setupBuyImageUpload();
  setupFormSubmissions();
  setupReturnFormSubmission();   // Trả hàng: xử lý submit form trả hàng
  setupPortfolioActions();
  setupInteractiveFilters();
  setupCsvExport();
  setupCsvImport();
  setupSystemSettings();
  setupMobileSidebarToggle();
  
  setupProfitChartPeriodToggle(); // Kích hoạt bộ lọc biểu đồ lợi nhuận
  setupEditTxModalHandlers();    // Kích hoạt bộ chỉnh sửa Modal

  // 3. Tính toán và làm tươi dữ liệu ban đầu
  refreshApplicationData();
});
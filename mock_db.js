// Cấu trúc dữ liệu mẫu cho xe mô hình 1:64
// Bao gồm danh sách các hãng xe phổ biến và lịch sử giao dịch mẫu qua các năm (2024 - 2026)

const MOCK_BRANDS = [
  "Mini GT",
  "Hot Wheels Premium",
  "Inno64",
  "Tarmac Works",
  "Pop Race",
  "Tomica Limited Vintage",
  "Matchbox Collector",
  "Kaido House"
];

// Danh sách các mẫu xe gợi ý để hiển thị khi người dùng nhập tìm kiếm
const MOCK_SUGGESTED_CARS = [
  { name: "Nissan Skyline GT-R R34 V-Spec II", brand: "Mini GT", defaultPrice: 280000 },
  { name: "Porsche 911 GT3 RS (992) Guards Red", brand: "Mini GT", defaultPrice: 290000 },
  { name: "Honda Civic Type R FL5 Sonic Gray", brand: "Mini GT", defaultPrice: 270000 },
  { name: "Toyota AE86 Trueno Carbon Hood White/Black", brand: "Pop Race", defaultPrice: 320000 },
  { name: "Ferrari F40 Red", brand: "Tomica Limited Vintage", defaultPrice: 1650000 },
  { name: "Nissan Skyline GT-R R32 HKS Livery", brand: "Inno64", defaultPrice: 420000 },
  { name: "Toyota Land Cruiser Prado White", brand: "Tarmac Works", defaultPrice: 380000 },
  { name: "Datsun 510 Pro Street OG Green", brand: "Kaido House", defaultPrice: 390000 },
  { name: "Chevrolet Corvette C8.R Yellow", brand: "Mini GT", defaultPrice: 260000 },
  { name: "LB-Silhouette WORKS GT Nissan 35GT-RR Blue", brand: "Mini GT", defaultPrice: 280000 },
  { name: "Ford Mustang Shelby GT500 Dragon Snake", brand: "Mini GT", defaultPrice: 270000 },
  { name: "Audi RS6 Avant Nardo Gray", brand: "Mini GT", defaultPrice: 280000 },
  { name: "Land Rover Defender 110 Camel Trophy", brand: "Mini GT", defaultPrice: 320000 },
  { name: "Koenigsegg Jesko White", brand: "Mini GT", defaultPrice: 290000 },
  { name: "Porsche 911 Carrera RS 2.7 White/Blue", brand: "Hot Wheels Premium", defaultPrice: 150000 },
  { name: "Toyota Supra (A90) Pandem Yellow", brand: "Hot Wheels Premium", defaultPrice: 140000 }
];

// Lịch sử giao dịch mẫu để hiển thị ngay doanh thu & chi phí qua các năm
const MOCK_TRANSACTIONS = [
  // --- NĂM 2024 ---
  // Mua hàng 2024
  {
    id: "tx-2024-001",
    type: "buy",
    modelName: "Nissan Skyline GT-R R34 V-Spec II",
    brand: "Mini GT",
    qty: 5,
    unitCost: 220000,
    date: "2024-02-10",
    notes: "Nhập sỉ đợt đầu năm, hộp đẹp"
  },
  {
    id: "tx-2024-002",
    type: "buy",
    modelName: "Porsche 911 GT3 RS (992) Guards Red",
    brand: "Mini GT",
    qty: 3,
    unitCost: 230000,
    date: "2024-03-15",
    notes: "Mini GT hot, hàng về ít"
  },
  {
    id: "tx-2024-003",
    type: "buy",
    modelName: "Porsche 911 Carrera RS 2.7 White/Blue",
    brand: "Hot Wheels Premium",
    qty: 10,
    unitCost: 95000,
    date: "2024-04-05",
    notes: "Hàng vỉ siêu thị, card lướt nhẹ"
  },
  // Bán hàng 2024
  {
    id: "tx-2024-004",
    type: "sell",
    modelName: "Nissan Skyline GT-R R34 V-Spec II",
    brand: "Mini GT",
    qty: 3,
    unitPrice: 290000,
    date: "2024-03-20",
    channel: "Facebook",
    notes: "Khách lẻ chuyển khoản trước"
  },
  {
    id: "tx-2024-005",
    type: "sell",
    modelName: "Porsche 911 Carrera RS 2.7 White/Blue",
    brand: "Hot Wheels Premium",
    qty: 6,
    unitPrice: 140000,
    date: "2024-05-12",
    channel: "Shopee",
    notes: "Đơn hàng Shopee, đóng gói kỹ"
  },
  {
    id: "tx-2024-006",
    type: "sell",
    modelName: "Porsche 911 GT3 RS (992) Guards Red",
    brand: "Mini GT",
    qty: 2,
    unitPrice: 320000,
    date: "2024-06-25",
    channel: "Trực tiếp",
    notes: "Bán cho bạn cùng đam mê"
  },

  // --- NĂM 2025 ---
  // Mua hàng 2025 (Mua thêm Nissan Skyline R34 với giá khác để test giá trung bình)
  {
    id: "tx-2025-001",
    type: "buy",
    modelName: "Nissan Skyline GT-R R34 V-Spec II",
    brand: "Mini GT",
    qty: 3,
    unitCost: 250000, // Giá tăng so với năm ngoái (220k) -> Giá trung bình mới sẽ thay đổi
    date: "2025-01-20",
    notes: "Nhập thêm đợt 2 giá cao hơn chút"
  },
  {
    id: "tx-2025-002",
    type: "buy",
    modelName: "Toyota AE86 Trueno Carbon Hood White/Black",
    brand: "Pop Race",
    qty: 4,
    unitCost: 260000,
    date: "2025-02-14",
    notes: "Xe Pop Race nắp capo carbon rất hot"
  },
  {
    id: "tx-2025-003",
    type: "buy",
    modelName: "Ferrari F40 Red",
    brand: "Tomica Limited Vintage",
    qty: 2,
    unitCost: 1350000,
    date: "2025-05-10",
    notes: "Hàng TLV cao cấp, chi phí cao"
  },
  {
    id: "tx-2025-004",
    type: "buy",
    modelName: "Datsun 510 Pro Street OG Green",
    brand: "Kaido House",
    qty: 3,
    unitCost: 310000,
    date: "2025-08-05",
    notes: "Kaido House mở được nắp máy"
  },
  // Bán hàng 2025
  {
    id: "tx-2025-005",
    type: "sell",
    modelName: "Nissan Skyline GT-R R34 V-Spec II",
    brand: "Mini GT",
    qty: 3,
    unitPrice: 320000, // Giá bán tốt hơn
    date: "2025-03-01",
    channel: "Facebook",
    notes: "Bán trên group Hot Wheels/Mini GT Việt Nam"
  },
  {
    id: "tx-2025-006",
    type: "sell",
    modelName: "Toyota AE86 Trueno Carbon Hood White/Black",
    brand: "Pop Race",
    qty: 3,
    unitPrice: 350000,
    date: "2025-04-18",
    channel: "Shopee",
    notes: "Shopee trừ phí sàn còn thu về khoảng 330k"
  },
  {
    id: "tx-2025-007",
    type: "sell",
    modelName: "Ferrari F40 Red",
    brand: "Tomica Limited Vintage",
    qty: 1,
    unitPrice: 1750000,
    date: "2025-11-20",
    channel: "Trực tiếp",
    notes: "Giao dịch trực tiếp, khách quen"
  },

  // --- NĂM 2026 ---
  // Mua hàng 2026
  {
    id: "tx-2026-001",
    type: "buy",
    modelName: "Land Rover Defender 110 Camel Trophy",
    brand: "Mini GT",
    qty: 5,
    unitCost: 260000,
    date: "2026-01-10",
    notes: "Mẫu Defender Camel Trophy chi tiết siêu đẹp"
  },
  {
    id: "tx-2026-002",
    type: "buy",
    modelName: "Toyota Supra (A90) Pandem Yellow",
    brand: "Hot Wheels Premium",
    qty: 8,
    unitCost: 90000,
    date: "2026-02-05",
    notes: "Săn deal sỉ rẻ"
  },
  // Bán hàng 2026
  {
    id: "tx-2026-003",
    type: "sell",
    modelName: "Land Rover Defender 110 Camel Trophy",
    brand: "Mini GT",
    qty: 3,
    unitPrice: 350000,
    date: "2026-06-10",
    channel: "Facebook",
    notes: "Khách chốt cọc nhanh gọn"
  },
  {
    id: "tx-2026-004",
    type: "sell",
    modelName: "Toyota Supra (A90) Pandem Yellow",
    brand: "Hot Wheels Premium",
    qty: 5,
    unitPrice: 150000,
    date: "2026-06-12",
    channel: "Shopee",
    notes: "Đơn Shopee đi tỉnh"
  },
  {
    id: "tx-2026-005",
    type: "sell",
    modelName: "Datsun 510 Pro Street OG Green",
    brand: "Kaido House",
    qty: 2,
    unitPrice: 420000,
    date: "2026-06-05",
    channel: "Facebook",
    notes: "Bán lẻ trên FB cá nhân"
  }
];

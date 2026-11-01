# PRODUCT TRUTH — MÔ HÌNH 64 (1:64 Portfolio Tracker)

## 1. Product Summary
- **Name:** Mô Hình 64 (MH64)
- **Tagline:** Trình Quản Lý Kho & Mua Bán Xe 1:64 (1:64 Model Car Portfolio & Inventory Tracker)
- **Platform:** Web App, Progressive Web App (PWA), Mobile & Desktop Responsive.
- **Data Architecture:** Client-side SPA with LocalStorage cache + Google Sheets backend (Google Apps Script) + Firebase Auth & Multi-device Sync.

## 2. Target Audience & Users
- **Collectors (Nhà sưu tầm):** Need precise valuation of their personal collection, purchase history, cost basis, model/brand/color specs, and photos.
- **Traders / Resellers (Người kinh doanh xe mô hình):** Sell across multiple channels (Shopee, Facebook, Direct, TikTok, Instagram). Need real-time profit tracking after platform transaction fees, FIFO / weighted average cost calculations, tax declaration generation, and SPX package delivery tracking.
- **Sub-account Members:** Staff or partners invited to view or update inventory with permission boundaries.

## 3. Core Problems Solved
1. **Accurate Cost & Margin Tracking:** Prevents miscalculating profit on platforms like Shopee where seller fees, vouchers, and packaging costs eat into margins.
2. **Real-time Inventory Valuation:** Tracks total capital invested, current stock value, and realized cash flow.
3. **SPX Tracking Automation:** Automatically monitors order tracking codes with real-time status dots (🟡 In transit, 🟢 Delivered today, 🔴 Returned/Failed).
4. **Zero-Setup Cross-Device Sync:** Log in with Google or Email on any device, and all data syncs automatically from cloud without copying configuration files.

## 4. Platform Constraints & Principles
- **Speed & Density:** Immediate data display from local cache first, background sync with cloud. High information density without visual clutter.
- **Touch & Mobile Optimization:** Clean bottom navigation on mobile, swipe-friendly card views, large touch targets (>= 44px).
- **Zero Data Loss:** All operations queue offline in `pendingOps` and replay when online. Cloud sync reconciles safely without overwriting local uncommitted changes.
- **Financial Precision:** Currency formatted strictly to locale conventions (`vi-VN`, `USD`, `EUR`), right-aligned numeric columns.

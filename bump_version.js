const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pad = (n) => n.toString().padStart(2, '0');

// Lấy ngày hiện tại theo giờ địa phương
const today = new Date();
const yyyy = today.getFullYear();
const mm = pad(today.getMonth() + 1);
const dd = pad(today.getDate());
const todayStr = `${yyyy}.${mm}.${dd}`;

const versionFilePath = path.join(__dirname, 'version.js');
const swFilePath = path.join(__dirname, 'service-worker.js');

try {
  let versionContent = fs.readFileSync(versionFilePath, 'utf8');
  
  // Tìm version hiện tại
  const match = versionContent.match(/window\.APP_VERSION\s*=\s*"(\d{4}\.\d{2}\.\d{2})-(\d{2})"/);
  let newVersionStr = `${todayStr}-01`;

  if (match) {
    const currentDayStr = match[1];
    const currentRev = parseInt(match[2], 10);
    
    if (currentDayStr === todayStr) {
      // Nếu cùng ngày thì tăng đuôi
      newVersionStr = `${todayStr}-${pad(currentRev + 1)}`;
    }
  }

  console.log(`[Version Auto-Bump] Dang cap nhat phien ban len ${newVersionStr}...`);

  // Ghi đè vào version.js
  versionContent = versionContent.replace(
    /window\.APP_VERSION\s*=\s*"[^"]+"/, 
    `window.APP_VERSION = "${newVersionStr}"`
  );
  fs.writeFileSync(versionFilePath, versionContent, 'utf8');

  // Ghi đè vào service-worker.js
  if (fs.existsSync(swFilePath)) {
    let swContent = fs.readFileSync(swFilePath, 'utf8');
    swContent = swContent.replace(
      /const CACHE_VERSION\s*=\s*'[^']+'/, 
      `const CACHE_VERSION = 'v-${newVersionStr}'`
    );
    fs.writeFileSync(swFilePath, swContent, 'utf8');
  }

  // Tự động add vào git
  execSync('git add version.js service-worker.js');
  console.log('[Version Auto-Bump] Thanh cong!');

} catch (err) {
  console.error("[Version Auto-Bump] Loi:", err);
  process.exit(1);
}

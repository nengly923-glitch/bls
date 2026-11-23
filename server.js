const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      const family = typeof net.family === 'string' ? net.family : (net.family === 4 ? 'IPv4' : 'IPv6');
      if (family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = 3000;

// ================= ENVIRONMENT & LOCAL DIRECTORIES SETUP =================
const IS_VERCEL = Boolean(process.env.VERCEL);
const WRITE_DIR = IS_VERCEL ? '/tmp/ihmong_data' : __dirname;

const DIRS = {
  database: path.join(WRITE_DIR, 'Database'),
  products: path.join(WRITE_DIR, 'รูปสินค้า'),
  repairs: path.join(WRITE_DIR, 'รูปงานซ่อม'),
  receipts: path.join(WRITE_DIR, 'ใบเสร็จ'),
  slips: path.join(WRITE_DIR, 'สลิปโอน'),
  backups: path.join(WRITE_DIR, 'สำรองข้อมูล'),
  settings: path.join(WRITE_DIR, 'ตั้งค่า')
};

for (const d of Object.values(DIRS)) {
  if (!fs.existsSync(d)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  }
}

// Ensure database in Database/ folder
const DB_PATH = path.join(DIRS.database, 'database.sqlite');
const SEED_DB = fs.existsSync(path.join(__dirname, 'Database', 'database.sqlite'))
  ? path.join(__dirname, 'Database', 'database.sqlite')
  : path.join(__dirname, 'database.sqlite');

if (!fs.existsSync(DB_PATH) && fs.existsSync(SEED_DB)) {
  try { fs.copyFileSync(SEED_DB, DB_PATH); } catch (e) {}
}

// Initialize SQLite Database
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high performance & concurrent phone reads
try { db.exec('PRAGMA journal_mode = WAL;'); } catch (e) {}

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    barcode TEXT,
    name TEXT NOT NULL,
    category TEXT,
    cost REAL DEFAULT 0,
    price REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    warranty TEXT DEFAULT '30 ວັນ',
    imei TEXT DEFAULT '',
    image TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS repairs (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    customerName TEXT NOT NULL,
    customerPhone TEXT NOT NULL,
    deviceModel TEXT NOT NULL,
    imei TEXT DEFAULT '',
    passcode TEXT DEFAULT '',
    issue TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    estimatedPrice REAL DEFAULT 0,
    actualPrice REAL DEFAULT 0,
    warranty TEXT DEFAULT '30 ວັນ',
    images TEXT DEFAULT '[]',
    technicianNote TEXT DEFAULT '',
    finishedDate TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    cashier TEXT DEFAULT 'Admin',
    paymentMethod TEXT DEFAULT 'cash',
    items TEXT NOT NULL,
    subtotal REAL DEFAULT 0,
    discountPercent REAL DEFAULT 0,
    discountAmount REAL DEFAULT 0,
    grandTotal REAL DEFAULT 0,
    cashReceived REAL DEFAULT 0,
    changeDue REAL DEFAULT 0,
    bankName TEXT DEFAULT '',
    slipImage TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS stock_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId TEXT,
    productName TEXT,
    qtyDeducted INTEGER,
    remainingStock INTEGER,
    reason TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    bankName TEXT NOT NULL,
    accountNumber TEXT DEFAULT '',
    accountName TEXT DEFAULT '',
    qrCode TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrations: ensure columns exist
try { db.exec("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE repairs ADD COLUMN actualPrice REAL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE repairs ADD COLUMN images TEXT DEFAULT '[]'"); } catch (e) {}
try { db.exec("ALTER TABLE repairs ADD COLUMN technicianNote TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE repairs ADD COLUMN finishedDate TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN bankName TEXT DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN slipImage TEXT DEFAULT ''"); } catch (e) {}

// Seed Default Categories
const defaultCategories = [
  'ໂທລະສັບມືຖື',
  'ໜ້າຈໍ & ແພຣ',
  'ແບັດເຕີຣີ',
  'ອາໄຫຼ່ສ້ອມ',
  'ອຸປະກອນເສີມ',
  'ຄ່າບໍລິການສ້ອມ'
];
for (const cat of defaultCategories) {
  try {
    db.prepare('INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)').run('cat_' + Buffer.from(cat).toString('hex').slice(0, 8), cat);
  } catch (e) {}
}

// Seed Default Bank Accounts
const defaultBanks = [
  { id: 'bank_bcel', bankName: 'BCEL Bank (ທະນາຄານການຄ້າຕ່າງປະເທດລາວ)', accountNumber: '010-12-00-01234567-001', accountName: 'I&hmong Mobile Shop' },
  { id: 'bank_ldb', bankName: 'LDB Bank (ທະນາຄານພັດທະນາລາວ)', accountNumber: '030-20-00-98765432-001', accountName: 'I&hmong Mobile Shop' },
  { id: 'bank_psb', bankName: 'Phongsavanh Bank (ທະນາຄານພົງສະຫວັນ)', accountNumber: '040-10-00-55443322-001', accountName: 'I&hmong Mobile Shop' }
];
for (const b of defaultBanks) {
  try {
    db.prepare('INSERT OR IGNORE INTO bank_accounts (id, bankName, accountNumber, accountName, qrCode, active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(b.id, b.bankName, b.accountNumber, b.accountName, '');
  } catch (e) {}
}

// Seed default products ONLY on first-ever install (never re-seed if user deleted items)
const isSeeded = db.prepare("SELECT value FROM settings WHERE key = 'seeded_initial_products'").get();
if (!isSeeded) {
  const countProd = db.prepare('SELECT COUNT(*) as count FROM products').get();
  if (countProd.count === 0) {
    const insertProd = db.prepare(`
      INSERT INTO products (id, barcode, name, category, cost, price, stock, warranty, imei, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    `);

    const initialProducts = [
      ["m1", "8859001001", "iPhone 13 128GB (ສີມ່ວງ / ມືສອງ 98%)", "ໂທລະສັບມືຖື", 11000000, 13500000, 2, "30 ວັນ", "359123456789012"],
      ["m2", "8859001002", "Samsung Galaxy A54 5G (ຂອງໃໝ່)", "ໂທລະສັບມືຖື", 7500000, 9200000, 4, "1 ປີ ສູນ", "358765432109876"],
      ["s1", "8859002001", "ຈໍແທ້ iPhone 11 Pro Max (Original Display)", "ໜ້າຈໍ & ແພຣ", 1200000, 1850000, 5, "30 ວັນ", ""],
      ["s2", "8859002002", "ຈໍ OLED iPhone 12 / 12 Pro (Grade A)", "ໜ້າຈໍ & ແພຣ", 950000, 1500000, 3, "30 ວັນ", ""],
      ["s3", "8859002003", "ຈໍແທ້ Samsung S21 Ultra 5G", "ໜ້າຈໍ & ແພຣ", 2800000, 3600000, 2, "30 ວັນ", ""],
      ["b1", "8859003001", "ແບັດເຕີຣີແທ້ iPhone 11 (ມອກ. ແທ້ 100%)", "ແບັດເຕີຣີ", 350000, 650000, 12, "6 ເດືອນ", ""],
      ["b2", "8859003002", "ແບັດເຕີຣີ iPhone 13 Pro Max ເພີ່ມຄວາມຈຸ", "ແບັດເຕີຣີ", 450000, 850000, 8, "6 ເດືອນ", ""],
      ["p1", "8859004001", "ແພຣຕູດຊາດ iPhone 12 Pro Max", "ອາໄຫຼ່ສ້ອມ", 200000, 450000, 6, "30 ວັນ", ""],
      ["a1", "8859005001", "ຟິล์ມກະຈົກເຕັມຈໍ 9D (iPhone ທຸກລຸ້ນ)", "ອຸປະກອນເສີມ", 25000, 65000, 45, "ບໍ່ມີ", ""],
      ["a2", "8859005002", "ຫົວຊາດໄວ 20W USB-C Fast Charger", "ອຸປະກອນເສີມ", 85000, 180000, 20, "3 ເດືອນ", ""],
      ["srv1", "8859006001", "ຄ່າບໍລິການປ່ຽນຈໍ / ປ່ຽນແບັດເຕີຣີ", "ຄ່າບໍລິການສ້ອມ", 0, 150000, 999, "30 ວັນ", ""]
    ];

    for (const p of initialProducts) {
      insertProd.run(...p);
    }
  }
  try {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded_initial_products', 'true')").run();
  } catch (e) {}
}

// Seed default settings if empty
const countSettings = db.prepare('SELECT COUNT(*) as count FROM settings').get();
if (countSettings.count === 0) {
  const insertSet = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSet.run('storeName', 'I&hmong-mobile');
  insertSet.run('storePhone', '+856 20 5555 9999');
  insertSet.run('storeAddress', 'ຕະຫຼາດເຊົ້າ, ນະຄອນຫຼວງວຽງຈັນ (Vientiane Capital)');
  insertSet.run('receiptFooter', 'ຮັບປະກັນງານສ້ອມຕາມເງື່ອນໄຂ • ຂອບໃຈທີ່ໄວ້ວາງໃຈ!');
  insertSet.run('currency', '₭');
}

// MIME Types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.sqlite': 'application/octet-stream'
};

function sendJSON(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Allow up to 20MB for image base64 uploads
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// SSE Clients for Live Push from Phone to Mac
const sseClients = new Set();
function broadcastEvent(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ================= REST API ROUTES =================
  if (pathname.startsWith('/api/')) {
    try {
      // Global HEAD for health checks
      if (method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }

      // 0. SERVER INFO (Dynamic Local IP for QR Code & Mobile Scanner)
      if (pathname === '/api/info' && method === 'GET') {
        const ip = getLocalIp();
        sendJSON(res, {
          ip,
          port: PORT,
          scannerUrl: `http://${ip}:${PORT}/scanner`,
          directories: Object.keys(DIRS)
        });
        return;
      }

      // 0.1 LIVE REAL-TIME SSE (Push events from Phone to Mac)
      if (pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', time: Date.now() })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // 0.2 IMAGE UPLOAD API (Supports Products, Repairs, Slips)
      if (pathname === '/api/upload' && method === 'POST') {
        const body = await parseBody(req);
        const { type, base64, filename } = body;
        if (!base64) {
          sendJSON(res, { success: false, message: 'No image data provided' }, 400);
          return;
        }

        // Determine destination folder
        let targetDir = DIRS.products;
        let prefix = 'prod';
        let urlDir = 'รูปสินค้า';
        if (type === 'repair') {
          targetDir = DIRS.repairs;
          prefix = 'rep';
          urlDir = 'รูปงานซ่อม';
        } else if (type === 'slip') {
          targetDir = DIRS.slips;
          prefix = 'slip';
          urlDir = 'สลิปโอน';
        }

        // Strip data:image/...;base64, header
        const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let ext = '.jpg';
        let buffer;
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          if (mimeType.includes('png')) ext = '.png';
          else if (mimeType.includes('webp')) ext = '.webp';
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(base64, 'base64');
        }

        const cleanName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`;
        const savePath = path.join(targetDir, cleanName);
        fs.writeFileSync(savePath, buffer);

        const fileUrl = `/${urlDir}/${cleanName}`;
        sendJSON(res, { success: true, url: fileUrl, filename: cleanName });
        return;
      }

      // 0.3 DELETE UPLOADED FILE
      if (pathname === '/api/upload' && method === 'DELETE') {
        const filePathParam = parsedUrl.searchParams.get('path') || '';
        if (filePathParam) {
          const safeRel = path.normalize(filePathParam).replace(/^(\.\.[\/\\])+/, '');
          const absPath = path.join(__dirname, safeRel);
          if (fs.existsSync(absPath)) {
            try { fs.unlinkSync(absPath); } catch (e) {}
          }
        }
        sendJSON(res, { success: true });
        return;
      }

      // 0.4 SCANNER LOOKUP API
      if (pathname === '/api/scanner/lookup' && method === 'GET') {
        const query = (parsedUrl.searchParams.get('code') || '').trim();
        if (!query) {
          sendJSON(res, { success: false, message: 'ກະລຸນາລະບຸບາໂຄດ / IMEI' }, 400);
          return;
        }
        let prod = db.prepare('SELECT * FROM products WHERE barcode = ? OR imei = ? OR id = ?').get(query, query, query);
        if (!prod) {
          prod = db.prepare('SELECT * FROM products WHERE name LIKE ? LIMIT 1').get(`%${query}%`);
        }
        if (!prod) {
          sendJSON(res, { success: false, message: 'ບໍ່ພົບສິນຄ້າ ຫຼື ອາໄຫຼ່ລະຫັດ: ' + query }, 404);
          return;
        }
        sendJSON(res, { success: true, product: prod });
        return;
      }

      // 0.5 SCANNER ACTIONS API (Push item to Mac Cart or Deduct stock)
      if (pathname === '/api/scanner/action' && method === 'POST') {
        const body = await parseBody(req);
        const { action, productId, barcode, qty, reason } = body;

        let prod = null;
        if (productId) {
          prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        } else if (barcode) {
          prod = db.prepare('SELECT * FROM products WHERE barcode = ? OR imei = ?').get(barcode, barcode);
        }

        if (action === 'add_to_cart') {
          if (!prod) {
            sendJSON(res, { success: false, message: 'ບໍ່ພົບສິນຄ້າ' }, 404);
            return;
          }
          broadcastEvent({
            type: 'phone_scan_cart',
            productId: prod.id,
            productName: prod.name,
            price: prod.price,
            stock: prod.stock
          });
          sendJSON(res, {
            success: true,
            product: prod,
            message: `ຍິງ "${prod.name}" ເຂົ້າກະຕ່າໜ້າຈໍ Mac ສຳເລັດແລ້ວ!`
          });
          return;
        }

        if (action === 'deduct_stock') {
          if (!prod) {
            sendJSON(res, { success: false, message: 'ບໍ່ພົບສິນຄ້າ' }, 404);
            return;
          }
          const deductQty = parseInt(qty || 1, 10);
          const newStock = Math.max(0, (prod.stock || 0) - deductQty);

          db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, prod.id);
          db.prepare(`
            INSERT INTO stock_logs (productId, productName, qtyDeducted, remainingStock, reason, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(prod.id, prod.name, deductQty, newStock, reason || 'ຕັດສະຕັອກຈາກມືຖື', new Date().toISOString());

          broadcastEvent({
            type: 'stock_updated',
            productId: prod.id,
            productName: prod.name,
            deducted: deductQty,
            remainingStock: newStock,
            reason: reason || 'ຕັດສະຕັອກຈາກມືຖື'
          });

          sendJSON(res, {
            success: true,
            product: { ...prod, stock: newStock },
            message: `ຕັດສະຕັອກ "${prod.name}" ອອກ ${deductQty} ອັນ ຮຽບຮ້ອຍແລ້ວ (ເຫຼືອ ${newStock})`
          });
          return;
        }

        sendJSON(res, { success: false, message: 'Invalid scanner action' }, 400);
        return;
      }

      // 1. PRODUCTS API
      if (pathname === '/api/products') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM products ORDER BY name ASC').all();
          sendJSON(res, rows);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          const id = body.id || ('m_' + Date.now());
          db.prepare(`
            INSERT INTO products (id, barcode, name, category, cost, price, stock, warranty, imei, image)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, body.barcode || '', body.name, body.category || '', body.cost || 0, body.price || 0, body.stock || 0, body.warranty || '30 ວັນ', body.imei || '', body.image || '');
          broadcastEvent({ type: 'product_saved', id });
          sendJSON(res, { success: true, id }, 201);
          return;
        }
      }

      const prodMatch = pathname.match(/^\/api\/products\/([^\/]+)$/);
      if (prodMatch) {
        const prodId = decodeURIComponent(prodMatch[1]);
        if (method === 'PUT') {
          const body = await parseBody(req);
          db.prepare(`
            UPDATE products SET barcode = ?, name = ?, category = ?, cost = ?, price = ?, stock = ?, warranty = ?, imei = ?, image = ?
            WHERE id = ?
          `).run(body.barcode || '', body.name, body.category || '', body.cost || 0, body.price || 0, body.stock || 0, body.warranty || '30 ວັນ', body.imei || '', body.image || '', prodId);
          broadcastEvent({ type: 'product_saved', id: prodId });
          sendJSON(res, { success: true });
          return;
        }
        if (method === 'DELETE') {
          db.prepare('DELETE FROM products WHERE id = ?').run(prodId);
          broadcastEvent({ type: 'product_deleted', id: prodId });
          sendJSON(res, { success: true, deleted: prodId });
          return;
        }
      }

      // 1.1 STOCK ADJUSTMENT API
      if (pathname === '/api/stock/adjust' && method === 'POST') {
        const body = await parseBody(req);
        const { productId, barcode, qty, reason } = body;
        let prod = null;
        if (productId) {
          prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        } else if (barcode) {
          prod = db.prepare('SELECT * FROM products WHERE barcode = ? OR imei = ?').get(barcode, barcode);
        }
        if (!prod) {
          sendJSON(res, { success: false, message: 'ບໍ່ພົບສິນຄ້າ' }, 404);
          return;
        }
        const deductQty = parseInt(qty || 1, 10);
        const newStock = Math.max(0, (prod.stock || 0) - deductQty);
        db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(newStock, prod.id);
        db.prepare(`
          INSERT INTO stock_logs (productId, productName, qtyDeducted, remainingStock, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(prod.id, prod.name, deductQty, newStock, reason || 'ປັບປຸງສະຕັອກ', new Date().toISOString());

        broadcastEvent({
          type: 'stock_updated',
          productId: prod.id,
          productName: prod.name,
          deducted: deductQty,
          remainingStock: newStock,
          reason: reason || 'ປັບປຸງສະຕັອກ'
        });

        sendJSON(res, { success: true, remainingStock: newStock });
        return;
      }

      // 1.2 STOCK LOGS API
      if (pathname === '/api/stock/logs' && method === 'GET') {
        const rows = db.prepare('SELECT * FROM stock_logs ORDER BY id DESC LIMIT 100').all();
        sendJSON(res, rows);
        return;
      }

      // 2. CATEGORIES API
      if (pathname === '/api/categories') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
          sendJSON(res, rows);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          if (!body.name) {
            sendJSON(res, { success: false, message: 'Name required' }, 400);
            return;
          }
          const id = body.id || ('cat_' + Date.now());
          db.prepare('INSERT OR REPLACE INTO categories (id, name) VALUES (?, ?)').run(id, body.name.trim());
          // Sync backup to settings/categories.json
          try {
            const all = db.prepare('SELECT * FROM categories').all();
            fs.writeFileSync(path.join(DIRS.settings, 'categories.json'), JSON.stringify(all, null, 2));
          } catch (e) {}
          sendJSON(res, { success: true, id }, 201);
          return;
        }
      }

      const catMatch = pathname.match(/^\/api\/categories\/([^\/]+)$/);
      if (catMatch && method === 'DELETE') {
        db.prepare('DELETE FROM categories WHERE id = ?').run(catMatch[1]);
        sendJSON(res, { success: true });
        return;
      }

      // 2.1 BANK ACCOUNTS API
      if (pathname === '/api/banks') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM bank_accounts WHERE active = 1 ORDER BY id ASC').all();
          sendJSON(res, rows);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          const id = body.id || ('bank_' + Date.now());
          db.prepare(`
            INSERT OR REPLACE INTO bank_accounts (id, bankName, accountNumber, accountName, qrCode, active)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(id, body.bankName, body.accountNumber || '', body.accountName || '', body.qrCode || '', body.active ?? 1);
          sendJSON(res, { success: true, id });
          return;
        }
      }

      const bankMatch = pathname.match(/^\/api\/banks\/([^\/]+)$/);
      if (bankMatch && method === 'DELETE') {
        db.prepare('UPDATE bank_accounts SET active = 0 WHERE id = ?').run(bankMatch[1]);
        sendJSON(res, { success: true });
        return;
      }

      // 3. REPAIRS API
      if (pathname === '/api/repairs') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM repairs ORDER BY date DESC').all();
          const parsed = rows.map(r => ({
            ...r,
            images: JSON.parse(r.images || '[]')
          }));
          sendJSON(res, parsed);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          const id = body.id || ('REP-' + Date.now().toString().slice(-4));
          const imagesJson = JSON.stringify(body.images || []);
          db.prepare(`
            INSERT INTO repairs (id, date, customerName, customerPhone, deviceModel, imei, passcode, issue, status, estimatedPrice, actualPrice, warranty, images, technicianNote, finishedDate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            body.date || new Date().toISOString(),
            body.customerName || '',
            body.customerPhone || '',
            body.deviceModel || '',
            body.imei || '',
            body.passcode || '',
            body.issue || '',
            body.status || 'pending',
            body.estimatedPrice || 0,
            body.actualPrice || body.estimatedPrice || 0,
            body.warranty || '30 ວັນ',
            imagesJson,
            body.technicianNote || '',
            body.finishedDate || ''
          );
          sendJSON(res, { success: true, id }, 201);
          return;
        }
      }

      const repMatch = pathname.match(/^\/api\/repairs\/([^\/]+)$/);
      if (repMatch) {
        const repId = repMatch[1];
        if (method === 'PUT') {
          const body = await parseBody(req);
          const imagesJson = JSON.stringify(body.images || []);
          db.prepare(`
            UPDATE repairs SET 
              customerName = ?, customerPhone = ?, deviceModel = ?, imei = ?, passcode = ?, 
              issue = ?, status = ?, estimatedPrice = ?, actualPrice = ?, warranty = ?, 
              images = ?, technicianNote = ?, finishedDate = ?
            WHERE id = ?
          `).run(
            body.customerName,
            body.customerPhone,
            body.deviceModel,
            body.imei || '',
            body.passcode || '',
            body.issue,
            body.status,
            body.estimatedPrice || 0,
            body.actualPrice || 0,
            body.warranty || '',
            imagesJson,
            body.technicianNote || '',
            body.finishedDate || '',
            repId
          );
          sendJSON(res, { success: true });
          return;
        }
        if (method === 'DELETE') {
          db.prepare('DELETE FROM repairs WHERE id = ?').run(repId);
          sendJSON(res, { success: true });
          return;
        }
      }

      // 4. ORDERS & SALES API
      if (pathname === '/api/orders') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM orders ORDER BY date DESC').all();
          const parsed = rows.map(r => ({ ...r, items: JSON.parse(r.items || '[]') }));
          sendJSON(res, parsed);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          const id = body.id || ('INV-' + Date.now().toString().slice(-6));

          // Guard against duplicate order processing
          const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
          if (existing) {
            sendJSON(res, { success: true, id, message: 'Already processed' });
            return;
          }

          const itemsJson = JSON.stringify(body.items || []);

          // Transactionally deduct stock for ordered items
          if (Array.isArray(body.items)) {
            for (const item of body.items) {
              const qty = parseInt(item.qty || 1, 10);
              db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(qty, item.id);
              
              const updatedProd = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.id);
              db.prepare(`
                INSERT INTO stock_logs (productId, productName, qtyDeducted, remainingStock, reason, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(item.id, item.name || '', qty, updatedProd ? updatedProd.stock : 0, `ຂາຍໜ້າຮ້ານ (ບິນ ${id})`, new Date().toISOString());
            }
          }

          db.prepare(`
            INSERT INTO orders (id, date, cashier, paymentMethod, items, subtotal, discountPercent, discountAmount, grandTotal, cashReceived, changeDue, bankName, slipImage)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            body.date || new Date().toISOString(),
            body.cashier || 'Admin',
            body.paymentMethod || 'cash',
            itemsJson,
            body.subtotal || 0,
            body.discountPercent || 0,
            body.discountAmount || 0,
            body.grandTotal || 0,
            body.cashReceived || 0,
            body.changeDue || 0,
            body.bankName || '',
            body.slipImage || ''
          );

          // Save receipt copy to ใบเสร็จ/ folder
          try {
            const receiptPath = path.join(DIRS.receipts, `${id}.json`);
            fs.writeFileSync(receiptPath, JSON.stringify(body, null, 2));
          } catch (e) {}

          broadcastEvent({
            type: 'order_created',
            orderId: id,
            grandTotal: body.grandTotal
          });

          sendJSON(res, { success: true, id }, 201);
          return;
        }
      }

      // 4.1 CLEAR SALES HISTORY
      if (pathname === '/api/orders/clear' && method === 'POST') {
        const body = await parseBody(req);
        if (body.confirm === true) {
          db.prepare('DELETE FROM orders').run();
          db.prepare('DELETE FROM stock_logs').run();
          sendJSON(res, { success: true, message: 'Sales history cleared' });
          return;
        }
        sendJSON(res, { success: false, message: 'Confirmation required' }, 400);
        return;
      }

      // 4.2 REPORTS & ANALYTICS API (Aggregates sales & repairs by day, month, year, or custom range)
      if (pathname === '/api/reports' && method === 'GET') {
        const from = parsedUrl.searchParams.get('from') || '';
        const to = parsedUrl.searchParams.get('to') || '';

        let ordersQuery = 'SELECT * FROM orders';
        let repairsQuery = 'SELECT * FROM repairs';
        const params = [];

        if (from && to) {
          ordersQuery += ' WHERE date >= ? AND date <= ?';
          repairsQuery += ' WHERE date >= ? AND date <= ?';
          params.push(from, to + 'T23:59:59.999Z');
        }

        const orders = db.prepare(ordersQuery).all(...params);
        const repairs = db.prepare(repairsQuery).all(...params);

        let totalPosSales = 0;
        let totalCost = 0;
        const productSalesMap = {}; // productId -> { id, name, qtySold, totalRevenue }

        for (const o of orders) {
          totalPosSales += (o.grandTotal || 0);
          try {
            const items = JSON.parse(o.items || '[]');
            for (const item of items) {
              const qty = item.qty || 1;
              const cost = item.cost || 0;
              totalCost += cost * qty;

              if (!productSalesMap[item.id]) {
                productSalesMap[item.id] = {
                  id: item.id,
                  name: item.name,
                  category: item.category || '',
                  qtySold: 0,
                  totalRevenue: 0
                };
              }
              productSalesMap[item.id].qtySold += qty;
              productSalesMap[item.id].totalRevenue += (item.price || 0) * qty;
            }
          } catch (e) {}
        }

        let totalRepairRevenue = 0;
        let pendingRepairs = 0;
        let completedRepairs = 0;
        for (const r of repairs) {
          if (r.status === 'completed' || r.status === 'delivered') {
            totalRepairRevenue += (r.actualPrice || r.estimatedPrice || 0);
            completedRepairs++;
          } else if (r.status === 'pending' || r.status === 'in_progress' || r.status === 'waiting_parts') {
            pendingRepairs++;
          }
        }

        const totalRevenue = totalPosSales + totalRepairRevenue;
        const totalProfit = (totalPosSales - totalCost) + totalRepairRevenue;

        // Top 100 Best Sellers
        const topSellers = Object.values(productSalesMap)
          .sort((a, b) => b.qtySold - a.qtySold)
          .slice(0, 100);

        // Dead stock calculation (products with stock > 0, sorted by lowest sales)
        const allProducts = db.prepare('SELECT * FROM products WHERE stock > 0').all();
        const deadStock = allProducts.map(p => {
          const sold = productSalesMap[p.id] ? productSalesMap[p.id].qtySold : 0;
          return {
            ...p,
            qtySold: sold,
            stuckValue: (p.cost || p.price) * p.stock
          };
        }).sort((a, b) => {
          if (a.qtySold !== b.qtySold) return a.qtySold - b.qtySold;
          return b.stuckValue - a.stuckValue;
        });

        // Inventory valuation
        const stockStats = db.prepare(`
          SELECT 
            COUNT(*) as totalProducts,
            SUM(stock) as totalStockUnits,
            SUM(cost * stock) as totalStockCostValue,
            SUM(price * stock) as totalStockRetailValue,
            SUM(CASE WHEN stock = 0 THEN 1 ELSE 0 END) as outOfStockCount,
            SUM(CASE WHEN stock > 0 AND stock <= 3 THEN 1 ELSE 0 END) as lowStockCount
          FROM products
        `).get();

        sendJSON(res, {
          period: { from, to },
          summary: {
            totalRevenue,
            totalPosSales,
            totalRepairRevenue,
            totalCost,
            totalProfit,
            ordersCount: orders.length,
            repairsCount: repairs.length,
            completedRepairs,
            pendingRepairs
          },
          stockStats,
          topSellers,
          deadStock: deadStock.slice(0, 100)
        });
        return;
      }

      // 5. DATABASE BACKUP & RESTORE API
      if (pathname === '/api/backups') {
        if (method === 'GET') {
          const files = fs.readdirSync(DIRS.backups)
            .filter(f => f.endsWith('.sqlite'))
            .map(f => {
              const stat = fs.statSync(path.join(DIRS.backups, f));
              return {
                filename: f,
                size: stat.size,
                createdAt: stat.mtime.toISOString()
              };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          sendJSON(res, files);
          return;
        }
        if (method === 'POST') {
          const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const backupFileName = `backup_${nowStr}.sqlite`;
          const backupPath = path.join(DIRS.backups, backupFileName);
          fs.copyFileSync(DB_PATH, backupPath);

          // Also export full JSON settings
          const allSettings = db.prepare('SELECT * FROM settings').all();
          fs.writeFileSync(path.join(DIRS.settings, 'settings.json'), JSON.stringify(allSettings, null, 2));

          sendJSON(res, { success: true, filename: backupFileName });
          return;
        }
      }

      if (pathname === '/api/restore' && method === 'POST') {
        const body = await parseBody(req);
        const { filename } = body;
        if (!filename) {
          sendJSON(res, { success: false, message: 'Filename required' }, 400);
          return;
        }
        const sourcePath = path.join(DIRS.backups, path.basename(filename));
        if (!fs.existsSync(sourcePath)) {
          sendJSON(res, { success: false, message: 'Backup file not found' }, 404);
          return;
        }
        // Create a safety backup of current state first
        fs.copyFileSync(DB_PATH, path.join(DIRS.backups, `pre_restore_${Date.now()}.sqlite`));
        fs.copyFileSync(sourcePath, DB_PATH);
        sendJSON(res, { success: true, message: 'Database restored successfully' });
        return;
      }

      // 6. SETTINGS API
      if (pathname === '/api/settings') {
        if (method === 'GET') {
          const rows = db.prepare('SELECT * FROM settings').all();
          const obj = {};
          rows.forEach(r => obj[r.key] = r.value);
          sendJSON(res, obj);
          return;
        }
        if (method === 'POST') {
          const body = await parseBody(req);
          const insertOrUpdate = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
          for (const [k, v] of Object.entries(body)) {
            insertOrUpdate.run(k, String(v));
          }
          try {
            fs.writeFileSync(path.join(DIRS.settings, 'settings.json'), JSON.stringify(body, null, 2));
          } catch (e) {}
          sendJSON(res, { success: true });
          return;
        }
      }

      sendJSON(res, { error: 'Not Found' }, 404);
      return;
    } catch (apiErr) {
      console.error('API Error:', apiErr);
      sendJSON(res, { error: apiErr.message }, 500);
      return;
    }
  }

  // ================= STATIC FILES & LOCAL FOLDERS =================
  let cleanPath = pathname.replace(/\/+$/, '');
  let reqFile = pathname;

  if (cleanPath === '/scanner' || cleanPath === '/mobile' || cleanPath === '/scan') {
    reqFile = '/scanner.html';
  } else if (cleanPath === '/qr') {
    reqFile = '/สแกน QR Code เข้าเครื่องสแกนมือถือ.html';
  } else if (!cleanPath || cleanPath === '/' || cleanPath === '/index.html' || cleanPath === '/desktop' || cleanPath === '/I&hmong-mobile.html') {
    reqFile = '/index.html';
  }

  // Safe file serving
  const safeRel = path.normalize(reqFile).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(__dirname, safeRel);
  if (IS_VERCEL && !fs.existsSync(filePath)) {
    const tmpPath = path.join(WRITE_DIR, safeRel);
    if (fs.existsSync(tmpPath)) filePath = tmpPath;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(data);
  });
});

if (require.main === module || !IS_VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[I&hmong-mobile Server] Running on http://0.0.0.0:${PORT}`);
    console.log(`[Storage] SQLite: ${DB_PATH}`);
    console.log(`[Storage] Folders: Database, รูปสินค้า, รูปงานซ่อม, ใบเสร็จ, สลิปโอน, สำรองข้อมูล, ตั้งค่า`);
  });
}

module.exports = server;

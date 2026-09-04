// เซิร์ฟเวอร์พัฒนาในเครื่องล้วน (ไม่ใช้ตอน deploy จริง — Vercel จะรัน api/*.js เป็น serverless function เอง)
// เสิร์ฟไฟล์ static จาก public/ และ mount api/*.js handler ไว้ที่ /api/<name>
// ใช้: node dev-server.js  แล้วเปิด http://localhost:3210/sign.html หรือ /cs-review.html
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3210;
const PUBLIC_DIR = path.join(__dirname, 'public');
const API_DIR = path.join(__dirname, 'api');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ttf': 'font/ttf', '.mjs': 'text/javascript; charset=utf-8',
};

function serveStatic(reqPath, res) {
  const filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not found: ' + reqPath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function serveApi(apiName, parsed, req, res) {
  const modPath = path.join(API_DIR, apiName + '.js');
  if (!fs.existsSync(modPath)) { res.writeHead(404); res.end('API not found: ' + apiName); return; }
  // hot-reload ทุก request ระหว่าง dev — เดิมลบ cache แค่ไฟล์ api/<name>.js ตัวเดียว ทำให้ไฟล์ที่มันไป require
  // ต่อ (เช่น api/_lib/*.js) ค้าง cache เก่าไว้ตลอดอายุ process นี้ ไม่ reload ตามจนกว่าจะรีสตาร์ท dev-server
  // เอง (บั๊กจริงที่เจอ 2026-09-03: แก้ pdf-text-layout.js ไปแล้วแต่ preview ที่ได้ยังว่างเปล่าเพราะโค้ดเก่า
  // ค้าง cache) — เลยเปลี่ยนเป็นล้าง cache ทุกไฟล์ในโปรเจกต์ (ไม่แตะ node_modules) ก่อนทุก request แทน
  Object.keys(require.cache).forEach(function (key) {
    if (key.indexOf('node_modules') === -1) delete require.cache[key];
  });
  const handler = require(modPath);

  let body = '';
  req.on('data', function (chunk) { body += chunk; });
  req.on('end', async function () {
    let parsedBody = {};
    if (body) { try { parsedBody = JSON.parse(body); } catch (e) { /* ignore */ } }
    const fakeReq = { method: req.method, query: parsed.query, body: parsedBody };
    const fakeRes = {
      _status: 200,
      _headers: {},
      status: function (c) { this._status = c; return this; },
      // เพิ่มรองรับ setHeader (2026-09-04) — บาง endpoint (เช่น staff-signature.js) ตั้ง Cache-Control: no-store
      // เอง กันเจอ edge cache ของ Vercel จริงเสิร์ฟข้อมูลเก่า (บั๊กจริงที่เจอ: บันทึกลายเซ็นใหม่แล้ว GET กลับมา
      // ได้ค่าเก่าเพราะ Vercel cache ไว้) — จำลองพฤติกรรมเดียวกันในเครื่องด้วยเพื่อไม่ให้พลาดจุดนี้อีก
      setHeader: function (k, v) { this._headers[k] = v; },
      json: function (obj) {
        res.writeHead(this._status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, this._headers));
        res.end(JSON.stringify(obj));
      },
    };
    try {
      await handler(fakeReq, fakeRes);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname.startsWith('/api/')) {
    serveApi(parsed.pathname.slice('/api/'.length), parsed, req, res);
    return;
  }
  serveStatic(parsed.pathname, res);
});

server.listen(PORT, function () {
  console.log('Dev server: http://localhost:' + PORT + '/sign.html');
  console.log('            http://localhost:' + PORT + '/cs-review.html');
});

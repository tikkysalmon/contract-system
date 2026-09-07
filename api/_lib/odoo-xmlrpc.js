// ไคลเอนต์ XML-RPC สำหรับ Odoo เขียนเองล้วนๆ (ไม่พึ่ง library ภายนอก) — เดิมเขียนไว้สำหรับ Cloudflare Workers
// (19_Odoo_Audit_WebApp) ที่ไม่มี Node.js net/http module ใช้ library xmlrpc ทั่วไปไม่ได้ ยกมาใช้ในระบบทำสัญญา
// ตรงๆ (2026-09-07) เพราะใช้แค่ fetch() ธรรมดา ทำงานบน Vercel serverless function (Node) ได้เหมือนกัน — แก้แค่
// export ท้ายไฟล์จาก ES module (`export function`) เป็น CommonJS (`module.exports`) ให้ตรงกับไฟล์อื่นในโปรเจกต์
// นี้ทั้งหมด ไม่ได้แตะ logic การเรียก XML-RPC เลย
//
// พอร์ตมาจาก scripts/odoo_client.py ในโปรเจกต์ 17_Agent_ตรวจสอบ_Odoo ให้ logic การเรียกตรงกัน
// **สำคัญ**: ต้องส่ง context ภาษาเสมอ (lang: th_TH) ไม่งั้นชื่อบัญชี/ชื่ออื่นๆ ที่แปลได้จะได้ค่าเก่า/ผิด —
// เจอบั๊กจริงเรื่องนี้มาแล้วในสคริปต์ Python (ดู 17_Agent_ตรวจสอบ_Odoo/README.md)
//
// ต้องตั้งค่าใน Vercel project settings: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toXmlValue(v) {
  if (v === null || v === undefined) return "<value><nil/></value>";
  if (typeof v === "boolean") return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? `<value><int>${v}</int></value>`
      : `<value><double>${v}</double></value>`;
  }
  if (typeof v === "string") return `<value><string>${xmlEscape(v)}</string></value>`;
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(toXmlValue).join("")}</data></array></value>`;
  }
  if (typeof v === "object") {
    const members = Object.entries(v)
      .map(([k, val]) => `<member><name>${xmlEscape(k)}</name>${toXmlValue(val)}</member>`)
      .join("");
    return `<value><struct>${members}</struct></value>`;
  }
  throw new Error(`ไม่รองรับชนิดข้อมูลนี้ใน XML-RPC: ${typeof v}`);
}

function buildRequest(methodName, params) {
  return (
    `<?xml version="1.0"?><methodCall><methodName>${xmlEscape(methodName)}</methodName>` +
    `<params>${params.map((p) => `<param>${toXmlValue(p)}</param>`).join("")}</params></methodCall>`
  );
}

// ---- ตัวแยกวิเคราะห์ XML-RPC response (มือเขียนเอง ไม่พึ่ง DOMParser เพราะ Workers ไม่มีให้) ----
class XmlCursor {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }
  skipWhitespace() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
  }
  // อ่านจนเจอ tag เปิด/ปิดถัดไป คืน {name, closing, selfClosing}
  peekTag() {
    const m = /<\/?([\w.:-]+)\s*\/?>/.exec(this.text.slice(this.pos));
    if (!m) return null;
    return { name: m[1], closing: this.text[this.pos + 1] === "/", selfClosing: m[0].endsWith("/>"), raw: m[0] };
  }
  consumeOpenTag(expected) {
    this.skipWhitespace();
    const rest = this.text.slice(this.pos);
    const m = new RegExp(`^<${expected}(?:\\s[^>]*)?>`).exec(rest);
    if (!m) throw new Error(`คาดว่าจะเจอ <${expected}> แต่เจอ: ${rest.slice(0, 60)}`);
    this.pos += m[0].length;
  }
  consumeCloseTag(expected) {
    this.skipWhitespace();
    const rest = this.text.slice(this.pos);
    const m = new RegExp(`^<\\/${expected}\\s*>`).exec(rest);
    if (!m) throw new Error(`คาดว่าจะเจอ </${expected}> แต่เจอ: ${rest.slice(0, 60)}`);
    this.pos += m[0].length;
  }
  readTextUntil(closeTag) {
    const idx = this.text.indexOf(`</${closeTag}>`, this.pos);
    if (idx === -1) throw new Error(`หา </${closeTag}> ไม่เจอ`);
    const text = this.text.slice(this.pos, idx);
    this.pos = idx;
    return text;
  }
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseValue(cur) {
  cur.skipWhitespace();
  cur.consumeOpenTag("value");
  cur.skipWhitespace();
  const tag = cur.peekTag();
  let result;
  if (!tag || tag.name === "value" || (tag.closing && tag.name === "value")) {
    // <value>ข้อความเปล่า ไม่มี type tag ครอบ = string โดย implicit ตามสเปก
    result = decodeEntities(cur.readTextUntil("value"));
  } else if (tag.name === "nil" && tag.selfClosing) {
    cur.pos += tag.raw.length;
    result = null;
  } else if (["string", "int", "i4", "double", "boolean"].includes(tag.name)) {
    cur.consumeOpenTag(tag.name);
    const text = decodeEntities(cur.readTextUntil(tag.name));
    cur.consumeCloseTag(tag.name);
    if (tag.name === "string") result = text;
    else if (tag.name === "boolean") result = text.trim() === "1";
    else if (tag.name === "double") result = parseFloat(text);
    else result = parseInt(text, 10);
  } else if (tag.name === "dateTime.iso8601") {
    cur.consumeOpenTag(tag.name);
    result = decodeEntities(cur.readTextUntil(tag.name));
    cur.consumeCloseTag(tag.name);
  } else if (tag.name === "array") {
    cur.consumeOpenTag("array");
    cur.consumeOpenTag("data");
    const items = [];
    cur.skipWhitespace();
    while (!cur.peekTag()?.closing || cur.peekTag()?.name !== "data") {
      cur.skipWhitespace();
      if (cur.text.slice(cur.pos).startsWith("</data>")) break;
      items.push(parseValue(cur));
      cur.skipWhitespace();
    }
    cur.consumeCloseTag("data");
    cur.consumeCloseTag("array");
    result = items;
  } else if (tag.name === "struct") {
    cur.consumeOpenTag("struct");
    const obj = {};
    cur.skipWhitespace();
    while (!cur.text.slice(cur.pos).startsWith("</struct>")) {
      cur.consumeOpenTag("member");
      cur.consumeOpenTag("name");
      const name = decodeEntities(cur.readTextUntil("name"));
      cur.consumeCloseTag("name");
      const val = parseValue(cur);
      cur.skipWhitespace();
      cur.consumeCloseTag("member");
      obj[name] = val;
      cur.skipWhitespace();
    }
    cur.consumeCloseTag("struct");
    result = obj;
  } else {
    throw new Error(`ไม่รู้จัก XML-RPC type: ${tag.name}`);
  }
  cur.skipWhitespace();
  cur.consumeCloseTag("value");
  return result;
}

function parseResponse(xmlText) {
  // ตัด XML declaration (<?xml version="1.0"?>) ทิ้งก่อน ไม่งั้น parser จะงงว่าไม่ใช่ <methodResponse>
  const cleaned = xmlText.replace(/^\s*<\?xml[^?]*\?>\s*/, "");
  const cur = new XmlCursor(cleaned);
  cur.consumeOpenTag("methodResponse");
  cur.skipWhitespace();
  if (cur.text.slice(cur.pos).startsWith("<fault>")) {
    cur.consumeOpenTag("fault");
    const faultValue = parseValue(cur);
    cur.consumeCloseTag("fault");
    const err = new Error(faultValue.faultString || "Odoo XML-RPC fault");
    err.faultCode = faultValue.faultCode;
    throw err;
  }
  cur.consumeOpenTag("params");
  cur.consumeOpenTag("param");
  const value = parseValue(cur);
  cur.consumeCloseTag("param");
  cur.consumeCloseTag("params");
  return value;
}

async function xmlRpcCall(endpointUrl, methodName, params) {
  const body = buildRequest(methodName, params);
  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Odoo XML-RPC HTTP ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  return parseResponse(text);
}

// ---- ระดับสูง: ทำหน้าที่เหมือน scripts/odoo_client.py ----
const LANG_CONTEXT = { lang: "th_TH" }; // ห้ามลบ — ดูหมายเหตุด้านบนไฟล์

function createOdooClient({ url, db, username, password }) {
  const baseUrl = url.replace(/\/$/, "");
  const commonUrl = `${baseUrl}/xmlrpc/2/common`;
  const objectUrl = `${baseUrl}/xmlrpc/2/object`;

  let cachedUid = null;

  async function authenticate() {
    if (cachedUid) return cachedUid;
    const uid = await xmlRpcCall(commonUrl, "authenticate", [db, username, password, {}]);
    if (!uid) throw new Error("เข้า Odoo ไม่สำเร็จ ตรวจสอบ ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_PASSWORD");
    cachedUid = uid;
    return uid;
  }

  async function executeKw(model, method, args, kwargs = {}) {
    const uid = await authenticate();
    return xmlRpcCall(objectUrl, "execute_kw", [db, uid, password, model, method, args, kwargs]);
  }

  return {
    async searchRead(model, domain = [], fields = null, opts = {}) {
      const kwargs = { context: LANG_CONTEXT, ...opts };
      if (fields) kwargs.fields = fields;
      return executeKw(model, "search_read", [domain], kwargs);
    },
    async searchCount(model, domain = []) {
      return executeKw(model, "search_count", [domain]);
    },
    async readGroup(model, domain, fields, groupby, lazy = false) {
      return executeKw(model, "read_group", [domain, fields, groupby], { lazy, context: LANG_CONTEXT });
    },
  };
}

// สร้าง client จาก environment variable ตรงๆ (แพทเทิร์นเดียวกับ scripts/odoo_client.py's connect()) — ให้
// caller เรียก getOdooClientFromEnv() เฉยๆ ไม่ต้องเขียน process.env.ODOO_* ซ้ำทุกที่ที่ใช้
function getOdooClientFromEnv() {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const password = process.env.ODOO_PASSWORD;
  if (!url || !db || !username || !password) {
    throw new Error('ยังไม่ได้ตั้งค่า ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_PASSWORD บน server');
  }
  return createOdooClient({ url, db, username, password });
}

module.exports = { createOdooClient, getOdooClientFromEnv };

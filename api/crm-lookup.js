// Vercel serverless function — ดึงข้อมูลคำสั่งขาย (sale order) จาก CRM จริงให้ CS ตรวจสอบก่อนสร้างลิงก์
//
// ยืนยันแล้ว (2026-09-03) ว่า crm.salmonphone.com เรียก REST API จริงที่ https://api.salmonphone.com
// ดู CRM-API-NOTES.md สำหรับรายละเอียด endpoint/field ทั้งหมดที่ตรวจสอบแล้ว
//
// ต้องตั้งค่าใน Vercel project settings ก่อนใช้งานจริง (ห้าม commit ค่าจริงลงไฟล์นี้เด็ดขาด):
//   CRM_USERNAME, CRM_PASSWORD  (จาก /crm/login)
//
// ยอดดาวน์/ยอดผ่อนสะสม (ข้อ 4 ของสเปก CS) — ยืนยันแล้ว 2 รอบจากตัวอย่างจริงของ user:
// (1) initAmount ไม่ใช่ยอดดาวน์จริง (เป็นค่าธรรมเนียมสมัครคงที่)
// (2) accumulatedAmount ของ CRM ก็ไม่ใช่ "ยอดวางดาวน์" ตรงๆ เช่นกัน (แก้ไข 2026-09-03 จากตัวอย่างจริง
//     SO-2026053100203) — มันคือยอดสะสม "ทั้งชีวิตออเดอร์" รวมทั้งยอดวางดาวน์เดิมและงวดที่ผ่อนไปแล้วหลัง
//     อนุมัติเครดิตด้วย เช่น accumulatedAmount=10,690 แต่ยอดวางดาวน์จริงคือ 1,990 ส่วนอีก 8,700 คือ 3 งวด
//     ที่ผ่อนไปแล้วหลังสัญญาเดิมเริ่มแล้ว (ดูฟิลด์ `no` ใน payment-transaction: null=ก่อนอนุมัติเครดิต,
//     "N/total"=งวดทางการหลังอนุมัติแล้ว) โค้ดด้านล่างแยก downPayment ออกจาก installmentsPaidSoFar ให้แล้ว
//     — remainingBalance (= netPrice - accumulatedAmount ทั้งก้อน) ยังคำนวณถูกต้องเหมือนเดิม ไม่กระทบ

const CRM_API_BASE = 'https://api.salmonphone.com';

let cachedToken = null; // อยู่ได้แค่ระหว่าง warm invocation เดียวกันของ Vercel function เท่านั้น ไม่ persist ข้าม request จริง

async function crmLogin() {
  const username = process.env.CRM_USERNAME;
  const password = process.env.CRM_PASSWORD;
  if (!username || !password) {
    throw new Error('ยังไม่ได้ตั้งค่า CRM_USERNAME/CRM_PASSWORD บน server');
  }
  const loginRes = await fetch(CRM_API_BASE + '/crm/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const rawText = await loginRes.text();
  let data = null;
  try { data = JSON.parse(rawText); } catch (e) { /* ไม่ใช่ JSON — เก็บ rawText ไว้โชว์แทน */ }
  if (!loginRes.ok || !data || !data.token) {
    // เดิมโชว์แค่ loginRes.status (เช่น "200") ไม่พอวินิจฉัย เพิ่ม snippet ของ response จริงด้วย
    // (2026-09-03 เจอเคสจริง: ส่ง username/password เป็น placeholder ตรงๆ ทำให้ CRM ตอบ 200 แต่ไม่มี token)
    const bodySnippet = data ? JSON.stringify(data).slice(0, 200) : rawText.slice(0, 200);
    throw new Error('ล็อกอิน CRM ไม่สำเร็จ (HTTP ' + loginRes.status + '): ' + (bodySnippet || '(response ว่างเปล่า)'));
  }
  return data.token;
}

async function crmGet(path, token) {
  const res = await fetch(CRM_API_BASE + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok) {
    const err = new Error('CRM API error: ' + res.status);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  // API นี้บางกรณี (เช่น ไม่พบเลข SO) ตอบ HTTP 200 พร้อม error envelope ในตัว ไม่ใช่ 4xx/5xx จริง
  // (ยืนยันจากการทดสอบเรียกจริง 2026-09-03) ต้องเช็คแยกต่างหาก ไม่พึ่ง res.ok อย่างเดียว
  if (data && data.errorCode) {
    const err = new Error(data.errorMessage || ('CRM error: ' + data.abbr));
    err.status = data.errorCode === 4001 ? 404 : 400;
    err.detail = data;
    throw err;
  }
  return data;
}

// installmentType จาก CRM -> plan_type ของระบบนี้ (ยืนยันค่าจริงแล้ว ดู CRM-API-NOTES.md)
function mapPlanType(installmentType) {
  if (installmentType === 'DOWN_PAYMENT') return 'downpayment';
  if (installmentType === 'PARTIAL_PAY_THEN_RECEIVE') return 'installment';
  if (installmentType === 'FULL_PAYMENT') return null; // ซื้อสด ไม่ต้องทำสัญญาผ่อน
  return null;
}

// productName จาก CRM เป็นสตริงเดียว เช่น "Apple iPhone 15 128GB (color Black)"
function splitProductName(productName) {
  const m = /^(.*?)\s*\(color\s+(.+)\)\s*$/i.exec(String(productName || ''));
  if (m) return { product: m[1].trim(), color: m[2].trim() };
  return { product: String(productName || ''), color: '' };
}

// ดึงประวัติการชำระทั้งหมด (วน page จนหมด) — ใช้โชว์ให้ CS เห็นในตัวเดียว ไม่ต้องสลับไปเช็คหน้า CRM จริงแยกต่างหาก
// ยืนยันจากตัวอย่างจริง (SO-2026053100203, 2026-09-03): งวดที่ยังไม่เข้ารอบเลขที่เป็นทางการ (เช่น เงินดาวน์ก้อนแรก)
// จะมี no: null, พองวดที่นับเป็นทางการแล้วจะเป็นสตริง "N/total" เช่น "3/12" — ใช้เลข total ตัวหลังนี้เป็น
// "จำนวนงวดทั้งหมดเดิม" ได้ (คนละความหมายกับ saleOrder.installmentCount ซึ่งเป็น "จำนวนงวดที่เหลือ")
async function fetchAllPaymentTransactions(soNumber, token) {
  const all = [];
  let page = 1;
  for (;;) {
    const data = await crmGet('/crm/sale-order/' + encodeURIComponent(soNumber) + '/payment-transaction?page=' + page, token);
    all.push.apply(all, data.paymentTransactions || []);
    if (!data.pagination || !data.pagination.hasNextPage) break;
    page++;
    if (page > 50) break; // กันวนไม่จบถ้า API ตอบ hasNextPage ผิดพลาด
  }
  return all;
}

var TYPE_LABELS = {
  INSTALLMENT: 'ค่าผ่อน',
  CHANGE_INSTALLMENT_TYPE: 'ค่าธรรมเนียมเปลี่ยนการผ่อน', // ยืนยันตรงกับป้ายที่ CRM แสดงจริง
};

// ดึง+แปลง SO หนึ่งใบให้เป็นรูปแบบข้อมูลที่หน้า CS ใช้ได้ตรงๆ (ราคา/ยอดผ่อน/ประวัติชำระ) — แยกเป็นฟังก์ชันเดียว
// ให้ทั้ง SO หลักที่ CS ค้นหา และ SO อื่นของลูกค้าคนเดียวกัน (2026-09-04, ดูหมายเหตุข้อจำกัด CRM ด้านล่าง
// ในตัว handler) เรียกใช้ร่วมกันได้ ไม่ต้องเขียนตรรกะแปลงข้อมูลซ้ำ 2 ที่
async function buildSoData(soNumber, token) {
  const saleOrder = await crmGet('/crm/sale-order/' + encodeURIComponent(soNumber), token);
  const planType = mapPlanType(saleOrder.installmentType);
  if (!planType) {
    return {
      soNumber: saleOrder.saleOrderId,
      unsupported: 'ออเดอร์นี้เป็น ' + saleOrder.installmentType + ' — ไม่ต้องทำสัญญาผ่อน (ซื้อสดหรือประเภทที่ไม่รองรับ)',
    };
  }

  const { product, color } = splitProductName(saleOrder.productName);
  const totalDiscount = (saleOrder.discounts || []).reduce(function (sum, d) { return sum + (Number(d.amount) || 0); }, 0);
  const netPrice = Number(saleOrder.productPrice) - totalDiscount;

  const nextDueDate = saleOrder.currentInvoice && saleOrder.currentInvoice.dueDate
    ? saleOrder.currentInvoice.dueDate.slice(0, 10)
    : null;

  const moneyTx = (await fetchAllPaymentTransactions(soNumber, token))
    .filter(function (tx) { return tx.paymentStatus === 'SUCCESSFUL' && Number(tx.amount) !== 0; });

  const paymentHistory = moneyTx.map(function (tx) {
    return {
      date: tx.paymentDate ? tx.paymentDate.slice(0, 10) : null,
      amount: tx.amount,
      no: tx.no,
      type: TYPE_LABELS[tx.type] || tx.type,
      status: tx.paymentStatus,
    };
  });

  const downPayment = moneyTx.filter(function (tx) { return tx.no === null; })
    .reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);
  const installmentsPaidSoFar = moneyTx.filter(function (tx) { return tx.no !== null; })
    .reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);
  const installmentsPaidCount = moneyTx.filter(function (tx) { return tx.no !== null && tx.type === 'INSTALLMENT'; }).length;
  const accumulatedAmount = downPayment + installmentsPaidSoFar;
  const remainingBalance = netPrice - accumulatedAmount;

  return {
    soNumber: saleOrder.saleOrderId,
    customerId: saleOrder.customerId,
    product: product,
    color: color,
    planType: planType,
    productPrice: saleOrder.productPrice,
    totalDiscount: totalDiscount,
    netPrice: netPrice,
    downPayment: downPayment,
    installmentsPaidSoFar: installmentsPaidSoFar,
    installmentsPaidCount: installmentsPaidCount,
    accumulatedAmount: accumulatedAmount,
    remainingBalance: remainingBalance,
    installmentCountFromCrm: saleOrder.installmentCount,
    nextDueDateFromCrm: nextDueDate,
    paymentHistory: paymentHistory,
    customer: {
      // วันเกิด/เบอร์โทร ไม่ดึงจาก CRM แล้ว (user แจ้ง 2026-09-03) ให้ลูกค้ากรอกเองในฟอร์มทั้งหมด
      firstLastName: (saleOrder.customerFirstName + ' ' + saleOrder.customerLastName).trim(),
      dob: '',
      phone: '',
      nationality: '',
    },
  };
}

// ค้นหาลูกค้าด้วยชื่อ (2026-09-04) — endpoint จริงที่ user เจอผ่าน Network tab ของ CRM เอง (ผมเดาไม่ถูกอยู่
// นาน ลอง query param ไปหลายชื่อ ไม่มีตัวไหนกรองได้จริงจนกว่าจะได้ URL จริงจากเบราว์เซอร์ user):
// GET /crm/customer?page=1&pageSize=10&mode=quick&searchBy=name&searchValue=<ชื่อ>
async function searchCustomersByName(name, token) {
  const data = await crmGet(
    '/crm/customer?page=1&pageSize=20&mode=quick&searchBy=name&searchValue=' + encodeURIComponent(name),
    token
  );
  return (data.customers || []).map(function (c) {
    return {
      customerId: c.customerId,
      firstLastName: (c.firstName + ' ' + c.lastName).trim(),
      telNo: c.telNo,
      productAmount: c.productAmount, // จำนวน SO ทั้งหมดของลูกค้าคนนี้ (จาก CRM ตรงๆ)
    };
  });
}

// ดึง SO ทั้งหมดของลูกค้าคนหนึ่ง (จาก customerId) แล้ว resolve แต่ละ SO ให้เต็ม (ราคา/ตารางผ่อน) ด้วย
// buildSoData() — ใช้หา "SO อื่นของลูกค้าคนเดียวกัน" ตอนค้นหาด้วยเลข SO (ปกติมีแค่ 1-2 รายการ ค่า resolve
// ทั้งหมดไปเลยไม่แพงมาก)
async function resolveCustomerSoItems(customerId, token) {
  const customerDetail = await crmGet('/crm/customer/' + encodeURIComponent(customerId), token);
  const soNumbers = (customerDetail.saleOrders || []).map(function (so) { return so.saleOrderId; }).filter(Boolean);
  const resolved = await Promise.all(soNumbers.map(function (id) {
    return buildSoData(id, token).catch(function () { return null; }); // ข้ามตัวที่ดึงพังไปทีละตัว ไม่ให้ทั้งชุดพัง
  }));
  return resolved.filter(function (item) { return item && !item.unsupported; });
}

// ป้ายภาษาไทยเท่าที่ยืนยันตรงกับหน้า CRM จริงแล้ว (จากภาพตัวอย่างที่ user ส่งมา 2026-09-04) — ค่าอื่นที่ยังไม่
// รู้จักโชว์ค่าดิบแทนการเดา (เหมือนแพทเทิร์น TYPE_LABELS ด้านบน)
var SO_STATUS_LABELS = {
  INSTALLMENT_AFTER_CREDIT_APPROVAL: 'ผ่อนหลังเครดิตผ่าน',
};
var SO_PAYMENT_STATUS_LABELS = {
  PENDING_PAYMENT: 'รอชำระเงิน',
};

// ดึงลิสต์ SO ของลูกค้าคนหนึ่งแบบ "เบา" (ไม่เรียก buildSoData ทีละใบ ไม่ต้องรอนาน) ใช้ตอนค้นหาด้วยชื่อลูกค้า
// เพราะลูกค้าอาจมี SO เก่าที่ไม่เกี่ยวข้องปนอยู่เยอะ — โชว์ตารางให้ CS ติ๊กเลือกก่อน (เหมือนหน้า CRM จริงที่
// user ส่งภาพมา) ค่อย resolve เต็มเฉพาะรายการที่ติ๊กทีหลัง (ผ่าน endpoint เดิม ?so=) ไม่ resolve ทุกใบล่วงหน้า
async function fetchCustomerSoListLight(customerId, token) {
  const customerDetail = await crmGet('/crm/customer/' + encodeURIComponent(customerId), token);
  return (customerDetail.saleOrders || []).map(function (so) {
    return {
      soNumber: so.saleOrderId,
      status: so.status,
      statusLabel: SO_STATUS_LABELS[so.status] || so.status,
      percentCredit: so.percentCredit,
      paymentStatus: so.paymentStatus,
      paymentStatusLabel: SO_PAYMENT_STATUS_LABELS[so.paymentStatus] || so.paymentStatus,
      overDueDateCount: so.overDueDateCount,
      createdAt: so.createdAt,
      productPrice: so.productPrice,
    };
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const soNumber = String((req.query && req.query.so) || '').trim();
  const customerName = String((req.query && req.query.name) || '').trim();
  const customerId = String((req.query && req.query.customerId) || '').trim();
  if (!soNumber && !customerName && !customerId) {
    res.status(400).json({ error: 'ต้องระบุเลขที่คำสั่งขาย (so) หรือชื่อลูกค้า (name)' });
    return;
  }

  try {
    let token = cachedToken || (cachedToken = await crmLogin());
    async function withRetryOn401(fn) {
      try {
        return await fn(token);
      } catch (err) {
        if (err.status === 401) { token = cachedToken = await crmLogin(); return fn(token); } // token หมดอายุ ลอง login ใหม่ 1 ครั้ง
        throw err;
      }
    }

    // โหมดค้นหาด้วยชื่อลูกค้า — ถ้าเจอลูกค้าตรงชื่อมากกว่า 1 คน คืนลิสต์ให้ CS เลือกก่อน (แล้วค่อยเรียกซ้ำด้วย
    // customerId) ถ้าเจอพอดี 1 คน ดึงลิสต์ SO แบบเบาให้ CS ติ๊กเลือกต่อเลย (ยังไม่ resolve ราคา/ตารางผ่อนเต็ม
    // — รอ CS ยืนยันว่าจะรวม SO ไหนก่อน ค่อยเรียก ?so= ต่อ SO ที่เลือกจริงเท่านั้น กันดึงข้อมูล SO เก่าที่ไม่
    // เกี่ยวข้องทิ้งเปล่าๆ ถ้าลูกค้ามีประวัติซื้อเยอะ)
    if (customerName) {
      const customers = await withRetryOn401(function (t) { return searchCustomersByName(customerName, t); });
      if (!customers.length) { res.status(200).json({ error: 'ไม่พบลูกค้าชื่อนี้ในระบบ' }); return; }
      if (customers.length > 1) { res.status(200).json({ customers: customers }); return; }
      const soList = await withRetryOn401(function (t) { return fetchCustomerSoListLight(customers[0].customerId, t); });
      res.status(200).json({ customer: customers[0], soList: soList });
      return;
    }

    if (customerId) {
      const soList = await withRetryOn401(function (t) { return fetchCustomerSoListLight(customerId, t); });
      res.status(200).json({ soList: soList });
      return;
    }

    // โหมดเดิม — ค้นหาด้วยเลข SO ตรงๆ
    const data = await withRetryOn401(function (t) { return buildSoData(soNumber, t); });
    if (data.unsupported) {
      res.status(200).json({ error: data.unsupported });
      return;
    }

    // ข้อจำกัดของ CRM (2026-09-04 user แจ้ง): ถ้าลูกค้าซื้อวางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกัน CRM บังคับ
    // เปิดแยกเป็นคนละ SO — ดึง SO อื่นๆ ของลูกค้าคนเดียวกันมาด้วย ให้ CS เห็นพอตัดสินใจว่าจะรวมเข้าลิงก์เดียวกัน
    // ไหม ถ้าขั้นตอนนี้ล้มเหลว (เช่น SO อื่นดึงไม่สำเร็จ) ไม่ทำให้การค้นหา SO หลักพังไปด้วย แค่ไม่มีลิสต์ให้เลือกเพิ่ม
    let otherItems = [];
    if (data.customerId) {
      try {
        const allItems = await resolveCustomerSoItems(data.customerId, token);
        otherItems = allItems.filter(function (item) { return item.soNumber !== data.soNumber; });
      } catch (e) { /* ข้ามไป ไม่ critical */ }
    }

    res.status(200).json({
      mock: false,
      data: data,
      otherItems: otherItems, // SO อื่นของลูกค้าคนเดียวกัน (เช่น อุปกรณ์เสริมที่แยก SO) ให้ CS เลือกรวมเข้าลิงก์เดียวกันได้
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

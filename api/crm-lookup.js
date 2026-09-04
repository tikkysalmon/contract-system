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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const soNumber = String((req.query && req.query.so) || '').trim();
  if (!soNumber) {
    res.status(400).json({ error: 'ต้องระบุเลขที่คำสั่งขาย (so)' });
    return;
  }

  try {
    let token = cachedToken || (cachedToken = await crmLogin());
    let data;
    try {
      data = await buildSoData(soNumber, token);
    } catch (err) {
      if (err.status === 401) {
        // token หมดอายุ/ไม่ถูกต้อง ลอง login ใหม่ 1 ครั้ง
        token = cachedToken = await crmLogin();
        data = await buildSoData(soNumber, token);
      } else {
        throw err;
      }
    }

    if (data.unsupported) {
      res.status(200).json({ error: data.unsupported });
      return;
    }

    // ข้อจำกัดของ CRM (2026-09-04 user แจ้ง): ถ้าลูกค้าซื้อวางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกัน CRM บังคับ
    // เปิดแยกเป็นคนละ SO — ดึง SO อื่นๆ ของลูกค้าคนเดียวกันมาด้วย (แค่เลข SO จาก /crm/customer/{id} ก่อน แล้ว
    // เรียก buildSoData() ซ้ำต่อ SO เพื่อได้ราคา/ชื่อสินค้าเต็มๆ ให้ CS เห็นพอตัดสินใจว่าจะรวมเข้าลิงก์เดียวกัน
    // ไหม) ถ้าขั้นตอนนี้ล้มเหลว (เช่น SO อื่นดึงไม่สำเร็จ) ไม่ทำให้การค้นหา SO หลักพังไปด้วย แค่ไม่มีลิสต์ให้เลือกเพิ่ม
    let otherItems = [];
    if (data.customerId) {
      try {
        const customerDetail = await crmGet('/crm/customer/' + encodeURIComponent(data.customerId), token);
        const otherSoNumbers = (customerDetail.saleOrders || [])
          .map(function (so) { return so.saleOrderId; })
          .filter(function (id) { return id && id !== data.soNumber; });
        const resolved = await Promise.all(otherSoNumbers.map(function (id) {
          return buildSoData(id, token).catch(function () { return null; }); // ข้ามตัวที่ดึงพังไปทีละตัว
        }));
        otherItems = resolved.filter(function (item) { return item && !item.unsupported; });
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

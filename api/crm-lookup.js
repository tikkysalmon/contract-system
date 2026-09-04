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
    let saleOrder;
    try {
      saleOrder = await crmGet('/crm/sale-order/' + encodeURIComponent(soNumber), token);
    } catch (err) {
      if (err.status === 401) {
        // token หมดอายุ/ไม่ถูกต้อง ลอง login ใหม่ 1 ครั้ง
        token = cachedToken = await crmLogin();
        saleOrder = await crmGet('/crm/sale-order/' + encodeURIComponent(soNumber), token);
      } else {
        throw err;
      }
    }

    const planType = mapPlanType(saleOrder.installmentType);
    if (!planType) {
      res.status(200).json({
        so: saleOrder,
        error: 'ออเดอร์นี้เป็น ' + saleOrder.installmentType + ' — ไม่ต้องทำสัญญาผ่อน (ซื้อสดหรือประเภทที่ไม่รองรับ)',
      });
      return;
    }

    // หมายเหตุ (2026-09-03): เดิมเคยเรียก GET /crm/customer/{id} เพิ่มเพื่อดึงวันเกิด/เบอร์โทรมาพรีฟิล
    // user แจ้งว่าไม่ต้องดึงข้อมูลนี้จาก CRM (ให้ลูกค้ากรอกเองในฟอร์มแทน) — เอาการเรียกนี้ออกแล้ว
    const { product, color } = splitProductName(saleOrder.productName);
    const totalDiscount = (saleOrder.discounts || []).reduce(function (sum, d) { return sum + (Number(d.amount) || 0); }, 0);
    const netPrice = Number(saleOrder.productPrice) - totalDiscount;

    // วันครบกำหนดงวดถัดไปจริง (ไม่ใช่ค่าเดา) — ยืนยันจากตัวอย่างจริง 2026-09-03 ว่า currentInvoice.dueDate
    // ของ CRM คือวันครบกำหนดงวดที่ยังไม่จ่ายถัดไปพอดี ใช้เป็นค่าเริ่มต้น "วันเริ่มผ่อนงวดแรก" ของสัญญาใหม่ได้เลย
    const nextDueDate = saleOrder.currentInvoice && saleOrder.currentInvoice.dueDate
      ? saleOrder.currentInvoice.dueDate.slice(0, 10)
      : null;

    // แก้ไข 2026-09-03 (ตัวอย่างจริง SO-2026083100130): เดิมกรองเอาแต่ type==='INSTALLMENT' ทำให้รายการ
    // ค่าธรรมเนียม/ส่วนปรับที่มีจริง (type: CHANGE_INSTALLMENT_TYPE, amount ติดลบ เช่น -2,980 "ค่าหักเปลี่ยน")
    // หายไปจากยอดสะสมทั้งที่เป็นเงินจริงที่ต้องหักออก — user ยืนยันว่ามีค่าธรรมเนียมทั้งเปลี่ยนสินค้าและ
    // เปลี่ยนวิธีการผ่อน (type ที่พบจริงตอนนี้มีแค่ CHANGE_INSTALLMENT_TYPE, ยังไม่เจอ type ของ "เปลี่ยนสินค้า"
    // จริงๆ ถ้าเจอให้เพิ่มใน TYPE_LABELS ด้านล่าง) หลักการใหม่: นับทุกรายการที่ paymentStatus=SUCCESSFUL และ
    // amount ≠ 0 เข้าเป็นเงินจริงเสมอ ไม่สนใจ type — ตัดออกเฉพาะรายการ amount=0 (เป็น log เหตุการณ์ล้วนๆ
    // เช่น APPROVE_CREDIT หรือ CHANGE_INSTALLMENT_TYPE ที่ไม่มีค่าธรรมเนียมจริง)
    var TYPE_LABELS = {
      INSTALLMENT: 'ค่าผ่อน',
      CHANGE_INSTALLMENT_TYPE: 'ค่าธรรมเนียมเปลี่ยนการผ่อน', // ยืนยันตรงกับป้ายที่ CRM แสดงจริง
    };
    const moneyTx = (await fetchAllPaymentTransactions(soNumber, token))
      .filter(function (tx) { return tx.paymentStatus === 'SUCCESSFUL' && Number(tx.amount) !== 0; });

    const paymentHistory = moneyTx.map(function (tx) {
      return {
        date: tx.paymentDate ? tx.paymentDate.slice(0, 10) : null,
        amount: tx.amount,
        no: tx.no, // "3/12" แบบนี้ = งวดที่ 3 จาก 12 งวดเดิม, null = ยังไม่เข้ารอบเลขทางการ (เช่น เงินดาวน์/ค่าธรรมเนียม)
        type: TYPE_LABELS[tx.type] || tx.type, // ถ้าเจอ type ใหม่ที่ไม่รู้จัก โชว์ค่าดิบแทนการเดาป้ายไทย
        status: tx.paymentStatus,
      };
    });

    // ยอดวางดาวน์ที่แท้จริง vs ยอดที่ผ่อนไปแล้วหลังอนุมัติเครดิต (แก้ไข 2026-09-03 ตามที่ user ยืนยันจากตัวอย่างจริง
    // SO-2026053100203): accumulatedAmount ของ CRM (10,690) เป็นยอดรวมสะสม "ทั้งชีวิตออเดอร์" ไม่ใช่ยอดวางดาวน์
    // ตอนทำสัญญาเดิม — ยอดวางดาวน์จริงคือยอดที่จ่ายก่อนขั้นตอน "อนุมัติเครดิต" ของ CRM เท่านั้น (no: null = จ่ายก่อน
    // เข้ารอบเลขงวดทางการ, no: "N/total" = งวดที่จ่ายไปแล้วหลังอนุมัติเครดิตแล้ว) ตัวอย่างจริง: 500+1,490 = 1,990
    // (ยอดวางดาวน์จริง) ไม่ใช่ 10,690 ที่รวมงวด 1/12-3/12 (8,700) ที่จ่ายไปแล้วหลังสัญญาเดิมเริ่มผ่อนแล้วด้วย
    const downPayment = moneyTx.filter(function (tx) { return tx.no === null; })
      .reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);
    const installmentsPaidSoFar = moneyTx.filter(function (tx) { return tx.no !== null; })
      .reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);
    const installmentsPaidCount = moneyTx.filter(function (tx) { return tx.no !== null && tx.type === 'INSTALLMENT'; }).length;
    const accumulatedAmount = downPayment + installmentsPaidSoFar; // รวมทั้งหมดที่จ่ายมา (ควรตรงกับ saleOrder.accumulatedAmount ของ CRM)
    const remainingBalance = netPrice - accumulatedAmount;

    // ข้อจำกัดของ CRM (2026-09-04 user แจ้ง): ถ้าลูกค้าซื้อวางดาวน์เครื่อง + อุปกรณ์เสริมพร้อมกัน CRM บังคับ
    // เปิดแยกเป็นคนละ SO — ดึง SO อื่นๆ ของลูกค้าคนเดียวกันมาด้วย (ไม่ใช้ dob/phone จาก endpoint นี้ตามที่
    // เคยตัดออกไปแล้ว 2026-09-03 ใช้แค่ field saleOrders[] เพื่อให้ CS เลือกรวม SO อื่นเข้าลิงก์เดียวกันได้)
    // ถ้าเรียกไม่สำเร็จ (เช่น customerId ไม่มี) ไม่ทำให้การค้นหา SO หลักพังไปด้วย แค่ไม่มีลิสต์ให้เลือกเพิ่ม
    let otherSaleOrders = [];
    if (saleOrder.customerId) {
      try {
        const customerDetail = await crmGet('/crm/customer/' + encodeURIComponent(saleOrder.customerId), token);
        otherSaleOrders = (customerDetail.saleOrders || []).filter(function (so) {
          return so.saleOrderId !== saleOrder.saleOrderId;
        });
      } catch (e) { /* ข้ามไป ไม่ critical */ }
    }

    res.status(200).json({
      mock: false,
      raw: { saleOrder: saleOrder, otherSaleOrders: otherSaleOrders }, // เก็บดิบไว้ให้ CS ตรวจสอบ/debug ได้ ไม่ใช่แค่ค่าที่ map แล้ว
      data: {
        soNumber: saleOrder.saleOrderId,
        product: product,
        color: color,
        planType: planType,
        productPrice: saleOrder.productPrice,
        totalDiscount: totalDiscount,
        netPrice: netPrice,
        downPayment: downPayment, // ยอดวางดาวน์ที่แท้จริง (จ่ายก่อนอนุมัติเครดิต) — ใช้ค่านี้แทน accumulatedAmount เดิม
        installmentsPaidSoFar: installmentsPaidSoFar, // ยอดงวดที่ผ่อนไปแล้วหลังอนุมัติเครดิต (นับแยกจากยอดวางดาวน์)
        installmentsPaidCount: installmentsPaidCount, // จำนวนงวดที่ผ่อนไปแล้ว (เช่น 3 จาก "1/12","2/12","3/12")
        accumulatedAmount: accumulatedAmount, // ยอดรวมทั้งหมดที่จ่ายมา (ดาวน์ + งวดที่ผ่อนแล้ว) ไว้เช็ค/debug เทียบกับ CRM
        remainingBalance: remainingBalance,
        // จำนวนงวด/วันครบกำหนดงวดแรก: ค่าที่ CRM มีให้เป็นแค่ค่าเริ่มต้น — CS ต้องกรอกยืนยัน/แก้ไขเองในหน้า
        // ตรวจสอบก่อนสร้างลิงก์เสมอ (ตามที่ user ยืนยัน 2026-09-03) ไม่ใช้ค่านี้ตรงๆ โดยไม่ให้ CS เห็นก่อน
        installmentCountFromCrm: saleOrder.installmentCount, // = จำนวนงวดที่ "เหลือ" ไม่ใช่จำนวนงวดเดิมทั้งหมด (ยืนยันแล้ว)
        nextDueDateFromCrm: nextDueDate, // ค่าเริ่มต้นของ "วันเริ่มผ่อนงวดแรก" — มาจาก currentInvoice.dueDate จริง
        paymentHistory: paymentHistory, // ให้ CS เห็นในตัวเดียว ไม่ต้องสลับไปเปิดหน้า CRM จริงแยก
        customer: {
          // วันเกิด/เบอร์โทร ไม่ดึงจาก CRM แล้ว (user แจ้ง 2026-09-03) ให้ลูกค้ากรอกเองในฟอร์มทั้งหมด
          firstLastName: (saleOrder.customerFirstName + ' ' + saleOrder.customerLastName).trim(),
          dob: '',
          phone: '',
          nationality: '', // ไม่มีใน CRM ต้องให้ลูกค้าเลือกเองในฟอร์ม
        },
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// "สำหรับสต๊อค" (2026-09-06, ยุบรวมกับแท็บ "ตรวจสอบสินค้าพร้อมส่ง" เดิมเข้าเป็นแท็บเดียว + เพิ่มฟอร์ม PDF
// 2 แบบ 2026-09-09 ตามที่ user ยืนยัน) — แทนที่ระบบเดิมที่ดึงจาก Lark Base (ดู ระบบจัดการออเดอร์.tsx ที่ user
// ส่งมาอ้างอิง UI/PDF เดิม) ดึงข้อมูลสด 2 แหล่ง: เครดิตผ่าน/วางดาวน์ (จากเมนู "ข้อมูลลูกค้าทำสัญญา" สถานะ
// "สัญญาลูกค้าเรียบร้อย") + ซื้อสด/ปิดยอด (จาก crm_orders_cache) แล้วจับคู่กับสต๊อก Odoo ต่อแถวเลย (คอลัมน์
// "สต๊อกคงเหลือ"/"สถานะ" ในตาราง — ตรรกะจัดคิวอยู่ที่ api/_lib/stock-reservation.js) ให้สต๊อคกำหนด "รอบการเบิก"
// ต่อแถว (dropdown) แล้วพิมพ์ได้ 2 แบบ:
//   1. "ใบเบิกสินค้า ราย SO" (ปุ่ม 🖨️ ใบเบิกรายบิล ต่อแถว) — พิมพ์ทีละบิล รวมอุปกรณ์เสริม (SO อื่นใน session
//      เดียวกัน — ดู contracts-tab.js's DELIVERY_CHANNEL_OPTIONS) เข้าใบเดียวกันด้วย
//   2. "ใบสรุปเบิกสินค้าประจำวัน" (ปุ่ม 📄 พิมพ์ใบเบิกประจำวัน) — กรุ๊ป SO ที่ session เดียวกันเป็นแถวเดียว
//      (คอลัมน์ Accessory แยกจากสินค้าหลัก) ตามตัวอย่างจริงที่ user ส่งมา (โฟลเดอร์ 15_ระบบทำสัญญา)
// ใช้: initStockTab('containerElementId', currentUser)
function initStockTab(containerId, currentUser) {
  'use strict';

  var ROUND_OPTIONS = ['เช้ารอบ 1', 'เช้ารอบ 2', 'เช้ารอบ 3', 'บ่ายรอบ 1', 'บ่ายรอบ 2', 'บ่ายรอบ 3'];
  // เหมือนกับ DELIVERY_CHANNEL_OPTIONS ใน contracts-tab.js (ที่ CS เป็นคนเลือกตอนตรวจสอบก่อนสร้างลิงก์) —
  // ใช้กรองรายการ/โชว์หัวใบสรุปเบิกประจำวันฝั่งนี้
  var DELIVERY_CHANNEL_OPTIONS = ['ส่งไปรษณีย์', 'ส่งแมส', 'นัดรับสาขาอ่อนนุช', 'นัดรับสาขาพัทยา'];
  var CUSTOMER_TYPE_LABELS = { all: 'ทั้งหมด', credit: 'เครดิตผ่าน/วางดาวน์', cash: 'ซื้อสด/ปิดยอด' };

  var state = {
    loading: true,
    error: null,
    orders: [],
    cashSourceReady: true,
    cashOrdersLookbackDays: null,
    cashTruncated: false,
    cashMatchedCount: 0,
    stockLastSyncedAt: null,
    crmLastSyncedAt: null,
    selected: {}, // { soNumber: true }
    filterCustomerType: 'all',
    filterQuery: '',
    filterRound: 'all',
    filterChannel: 'all', // ฝั่ง client ล้วน (ยังไม่ได้ส่งไป server เหมือน filter อื่น — ข้อมูลทั้งหมดโหลดมาแล้ว)
    filterPrintStatus: 'all',
    showCancelled: false,
    assignRound: '', // เลือกไว้แค่ตอนพิมพ์ใบสรุปเบิกประจำวัน (label บนใบ) ไม่ใช่ตัวกำหนดรอบต่อรายการแล้ว
    printing: false,
    printingBillSo: null, // SO ที่กำลังพิมพ์ใบเบิกรายบิลอยู่ (กันกดซ้ำ)
    printingCombined: false, // กำลังพิมพ์ใบเบิกรวมหลายบิลอยู่ (กันกดซ้ำ)
    cancelingSo: null, // SO ที่กำลังเปิดกล่องกรอกเหตุผลยกเลิกอยู่
    cancelReason: '',
    pageSize: 20, // 2026-09-09 user ขอแบ่งหน้าตาราง "รายการออเดอร์" — ทำฝั่ง client (ข้อมูลทั้งหมดโหลดมาแล้ว)
    currentPage: 1, // เริ่มที่ 1 เสมอ
    sortBy: 'latest', // 'latest' | 'customerName' | 'soNumber' | 'customerId' | 'installmentType'
  };
  var PAGE_SIZE_OPTIONS = [20, 50, 100];

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtMoney(n) {
    return n == null ? '-' : Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtAddress(addr) {
    if (!addr) return '-';
    var parts = [addr.detail, addr.subdistrictName, addr.districtName, addr.provinceName, addr.zip].filter(Boolean);
    return parts.length ? parts.join(' ') : '-';
  }

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var params = new URLSearchParams({
        customerType: state.filterCustomerType,
        q: state.filterQuery,
        round: state.filterRound,
        printStatus: state.filterPrintStatus,
        showCancelled: String(state.showCancelled),
      });
      var res = await fetch('/api/stock-orders?' + params.toString());
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.orders = body.orders || [];
      state.cashSourceReady = !!body.cashSourceReady;
      state.cashOrdersLookbackDays = body.cashOrdersLookbackDays || null;
      state.cashTruncated = !!body.cashTruncated;
      state.cashMatchedCount = body.cashMatchedCount || 0;
      state.stockLastSyncedAt = body.stockLastSyncedAt || null;
      state.crmLastSyncedAt = body.crmLastSyncedAt || null;
      // ล้าง selection ของ SO ที่หลุดจากรายการปัจจุบันไปแล้ว (เช่น กรองใหม่)
      var stillThere = {};
      state.orders.forEach(function (o) { if (state.selected[o.soNumber]) stillThere[o.soNumber] = true; });
      state.selected = stillThere;
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้รัน supabase-stock-orders.sql ต้องรันก่อน)';
    }
    state.loading = false;
    render();
  }

  function selectedOrders() {
    return state.orders.filter(function (o) { return state.selected[o.soNumber]; });
  }

  // ตั้งรอบการเบิกทีละรายการทันทีที่เปลี่ยน dropdown ในแถว (2026-09-09 user ขอแทนปุ่มกำหนดแบบเลือกหลายรายการเดิม)
  async function setRoundForOrder(soNumber, round) {
    if (!round) return; // ยังไม่รองรับ "ล้างค่ากลับเป็นว่าง" — API ปัจจุบันบังคับต้องมี round เสมอ
    try {
      var res = await fetch('/api/stock-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setRound', soNumbers: [soNumber], round: round, staffName: currentUser.username }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      await load();
    } catch (err) {
      window.alert('กำหนดรอบการเบิกไม่สำเร็จ: ' + err.message);
      render();
    }
  }

  async function markPrintedAndReload(soNumbers) {
    var res = await fetch('/api/stock-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'markPrinted', soNumbers: soNumbers, staffName: currentUser.username }),
    });
    var body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || 'อัปเดตสถานะพิมพ์ไม่สำเร็จ');
  }

  function openCancelBox(soNumber) {
    state.cancelingSo = soNumber;
    state.cancelReason = '';
    render();
  }
  function closeCancelBox() {
    state.cancelingSo = null;
    render();
  }
  async function confirmCancel() {
    var soNumber = state.cancelingSo;
    try {
      var res = await fetch('/api/stock-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', soNumber: soNumber, staffName: currentUser.username, reason: state.cancelReason }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ยกเลิกไม่สำเร็จ');
      state.cancelingSo = null;
      await load();
    } catch (err) {
      window.alert('ยกเลิกไม่สำเร็จ: ' + err.message);
      render();
    }
  }

  // ---------- พิมพ์ใบเบิกประจำวัน (PDF) — เค้าโครงเดียวกับระบบเดิม (ระบบจัดการออเดอร์.tsx): หัวบริษัท/ชื่อฟอร์ม/
  // วันที่/ประเภทลูกค้า/รอบการเบิก + ตาราง ลำดับที่/รหัส SO/รหัสลูกค้า/ชื่อลูกค้า/ผู้รับสินค้า/รายการสินค้า/จำนวน
  // + ช่องเซ็น 3 จุด (ผู้ขอเบิก/ผู้ตรวจสอบสินค้า/ผู้รับสินค้า) — สร้างด้วย html2canvas+jsPDF เหมือนสัญญา
  // (contract-html-renderer.js) ไม่ใช้ jspdf-autotable ของระบบเดิม กันต้องโหลดไลบรารีเพิ่ม ----------
  // กรุ๊ปแถวที่มี sessionToken เดียวกัน (ลูกค้าคนเดียวกันเซ็นรวมลิงก์เดียว เช่น วางดาวน์เครื่อง+อุปกรณ์เสริม
  // ที่ CRM บังคับแยก SO — ดู contracts-tab.js) ให้เหลือแถวเดียวต่อการจัดส่ง 1 ครั้ง ตามตัวอย่างใบสรุปเบิก
  // ประจำวันจริงที่ user ส่งมา (คอลัมน์ Accessory แยกจากรายการสินค้าหลัก ไม่ใช่คนละแถว) — sessionToken เป็น
  // null ได้ (ฝั่งซื้อสด/ปิดยอดไม่มี session) แต่ละแถวก็แสดงเดี่ยวไปตามปกติ ไม่กรุ๊ปกับใคร
  function groupForDailySummary(orders) {
    var bySession = {};
    var result = [];
    orders.forEach(function (o) {
      if (!o.sessionToken) { result.push({ main: o, accessories: [] }); return; }
      if (!bySession[o.sessionToken]) {
        var group = { main: o, accessories: [] };
        bySession[o.sessionToken] = group;
        result.push(group);
      } else {
        bySession[o.sessionToken].accessories.push(o);
      }
    });
    return result;
  }

  function productLabel(o) { return o.product + (o.color ? ' (' + o.color + ')' : ''); }

  // เค้าโครงตรงตามตัวอย่างจริง "ใบสรุปเบิกสินค้าประจำวัน" ที่ user ส่งมา (โฟลเดอร์ 15_ระบบทำสัญญา) — เพิ่ม
  // คอลัมน์ Accessory/ของแถม จากของเดิมที่มีแค่ ลำดับ/SO/รหัสลูกค้า/ชื่อ/ผู้รับ/สินค้า/จำนวน
  function requisitionPageHtml(groups, startIndex, roundLabel, pageNo, totalPages) {
    var td = 'border:1px solid #999;padding:5px;';
    var rowsHtml = groups.map(function (g, i) {
      var r = g.main;
      var accessoryLabel = g.accessories.length ? g.accessories.map(productLabel).join(', ') : '-';
      return '<tr>' +
        '<td style="' + td + 'text-align:center;">' + (startIndex + i + 1) + '</td>' +
        '<td style="' + td + '">' + r.soNumber + '</td>' +
        '<td style="' + td + '">' + (r.customerId || '-') + '</td>' +
        '<td style="' + td + '">' + r.customerName + '</td>' +
        '<td style="' + td + '">' + (r.recipientName || r.customerName || '-') + '</td>' +
        '<td style="' + td + '">' + productLabel(r) + '</td>' +
        '<td style="' + td + '">' + accessoryLabel + '</td>' +
        '<td style="' + td + 'text-align:center;">1</td>' +
        '<td style="' + td + '">' + (r.giftItem || '-') + '</td>' +
        '</tr>';
    }).join('');
    var channelLabel = state.filterChannel === 'all' ? 'ทุกช่องทาง' : state.filterChannel;
    var customerTypeLabel = CUSTOMER_TYPE_LABELS[state.filterCustomerType] || 'ทั้งหมด';
    return '<div style="width:794px;min-height:1123px;box-sizing:border-box;padding:36px 32px;font-family:\'Sarabun\',\'Noto Sans Thai\',sans-serif;color:#1c1b19;">' +
      '<div style="text-align:center;font-weight:700;font-size:15px;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด</div>' +
      '<div style="text-align:center;font-weight:700;font-size:14px;margin-top:2px;">ใบสรุปเบิกสินค้าประจำวัน</div>' +
      '<div style="text-align:center;font-size:12px;color:#555;margin-top:8px;">' +
      'วันที่จัดส่ง: ' + isoToDDMMYYYY(new Date().toISOString().slice(0, 10)) + ' &nbsp;|&nbsp; ช่องทางการจัดส่ง: ' + channelLabel + '<br/>' +
      'ประเภทลูกค้า: ' + customerTypeLabel + ' &nbsp;|&nbsp; รอบการเบิก: ' + (roundLabel || '-') + ' &nbsp;|&nbsp; หน้า ' + pageNo + '/' + totalPages +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:10px;">' +
      '<thead><tr style="background:#f2f2f2;">' +
      '<th style="' + td + '">ลำดับ</th>' +
      '<th style="' + td + '">เลขที่ SO</th>' +
      '<th style="' + td + '">รหัสลูกค้า</th>' +
      '<th style="' + td + '">ชื่อลูกค้า</th>' +
      '<th style="' + td + '">ผู้รับสินค้า</th>' +
      '<th style="' + td + '">รายการสินค้า</th>' +
      '<th style="' + td + '">Accessory</th>' +
      '<th style="' + td + '">จำนวน</th>' +
      '<th style="' + td + '">ของแถม</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<div style="display:flex;justify-content:space-around;margin-top:60px;">' +
      ['ผู้ขอเบิก / วันที่', 'ผู้ตรวจสอบสินค้า / วันที่', 'ผู้รับสินค้า / วันที่'].map(function (label) {
        return '<div style="text-align:center;font-size:11px;">' +
          '<div style="border-top:1px solid #333;width:160px;padding-top:4px;">' + label + '</div>' +
          '</div>';
      }).join('') +
      '</div>' +
      '</div>';
  }

  async function printRequisition() {
    var orders = selectedOrders().length ? selectedOrders() : filtered();
    if (!orders.length) { window.alert('ไม่มีรายการให้พิมพ์'); return; }
    if (!state.assignRound) { window.alert('กรุณาเลือกรอบการเบิกก่อนพิมพ์'); return; }
    state.printing = true;
    render();
    try {
      var groups = groupForDailySummary(orders);
      var ITEMS_PER_PAGE = 25;
      var totalPages = Math.ceil(groups.length / ITEMS_PER_PAGE);
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      for (var p = 0; p < totalPages; p++) {
        var chunk = groups.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-99999px;top:0;';
        wrap.innerHTML = requisitionPageHtml(chunk, p * ITEMS_PER_PAGE, state.assignRound, p + 1, totalPages);
        document.body.appendChild(wrap);
        var canvas = await window.html2canvas(wrap.firstChild, { scale: 2, backgroundColor: '#ffffff' });
        wrap.remove();
        if (p > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      pdf.save('ใบเบิกสินค้า_' + state.assignRound.replace(/\s+/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
      await markPrintedAndReload(orders.map(function (o) { return o.soNumber; }));
      await load();
    } catch (err) {
      window.alert('พิมพ์ใบเบิกไม่สำเร็จ: ' + err.message);
    }
    state.printing = false;
    render();
  }

  // ---------- พิมพ์ "ใบเบิกสินค้า ราย SO" (2026-09-09 user ขอเพิ่ม) — เค้าโครงตรงตามตัวอย่างจริงที่ user
  // ส่งมา (โฟลเดอร์ 15_ระบบทำสัญญา) — พิมพ์ทีละบิล รวมอุปกรณ์เสริม (SO อื่นใน session เดียวกัน) เป็นรายการ
  // ที่ 2 เข้าไปในใบเดียวกันด้วยเลย (แพ็ค/ส่งพร้อมกัน) ราคา/ยอดโอนจริง/ยอดคงเหลือใช้ค่าที่ CS กรอกไว้ตอนสร้าง
  // ลิงก์ (session.items[]) ไม่ใช่ยอดสดจาก CRM — เพราะเป็นยอดที่ตกลงกับลูกค้าไว้ในสัญญาแล้ว (เหมือนที่หน้า CS
  // ใช้แสดง ไม่ใช่ยอดที่ขยับตามการผ่อนจริงที่เกิดขึ้นทีหลัง) ----------
  function billItemDetailHtml(o, label) {
    return '<p style="margin:4px 0;">' + label + ' : ' + productLabel(o) + '</p>' +
      '<p style="margin:4px 0;">ราคาขาย : ' + fmtMoney(o.productPrice) + '</p>' +
      '<p style="margin:4px 0;">ยอดโอนจริง : ' + fmtMoney(o.downPayment) + '</p>' +
      '<p style="margin:4px 0;">ยอดคงเหลือที่ต้องผ่อน : ' + fmtMoney(o.remainingBalance) + '</p>';
  }

  function perBillPageHtml(main, accessories) {
    var itemRowsHtml = [main].concat(accessories).map(function (o, i) {
      return '<tr>' +
        '<td style="border:1px solid #999;padding:6px;text-align:center;">' + (i + 1) + '</td>' +
        '<td style="border:1px solid #999;padding:6px;">' + (i === 0 ? productLabel(o) : 'อุปกรณ์เสริม : ' + productLabel(o)) + '</td>' +
        '<td style="border:1px solid #999;padding:6px;text-align:center;">1</td>' +
        '<td style="border:1px solid #999;padding:6px;"></td>' + // ดีลเปลี่ยนสินค้า — ไม่มีข้อมูลให้ดึงอัตโนมัติ พนักงานกรอกเอง
        '</tr>';
    }).join('');
    var detailHtml = billItemDetailHtml(main, 'รายการสินค้า') +
      accessories.map(function (a) { return billItemDetailHtml(a, 'รายการสินค้าอุปกรณ์เสริม'); }).join('');
    return '<div style="width:794px;min-height:1123px;box-sizing:border-box;padding:36px 32px;font-family:\'Sarabun\',\'Noto Sans Thai\',sans-serif;color:#1c1b19;font-size:13px;">' +
      '<div style="font-weight:700;font-size:14px;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด</div>' +
      '<div style="font-size:11px;color:#555;">ที่อยู่ 64/19 หมู่บ้าน เดอะมาสเตอร์อ่อนนุช-พัฒนาการ ถนนอ่อนนุช แขวงประเวศ เขตประเวศ กรุงเทพมหานคร 10250</div>' +
      '<div style="font-size:11px;color:#555;">เลขประจำตัวผู้เสียภาษี 0115564013831</div>' +
      '<hr style="margin:12px 0;border:none;border-top:1px solid #999;" />' +
      '<div style="text-align:center;font-weight:700;font-size:16px;text-decoration:underline;margin-bottom:14px;">ใบเบิกสินค้า</div>' +
      '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
      '<tr><td style="padding:3px 0;"><b>ลูกค้า :</b> ' + main.customerName + '</td><td style="padding:3px 0;"><b>วันที่จัดส่ง :</b> ' + isoToDDMMYYYY(new Date().toISOString().slice(0, 10)) + '</td></tr>' +
      '<tr><td style="padding:3px 0;"><b>รหัสลูกค้า :</b> ' + (main.customerId || '-') + '</td><td style="padding:3px 0;"><b>เลขใบสั่งขาย :</b> ' + main.soNumber + '</td></tr>' +
      '</table>' +
      '<hr style="margin:12px 0;border:none;border-top:1px solid #999;" />' +
      '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
      '<tr><td style="padding:3px 0;"><b>ชื่อผู้รับสินค้า :</b> ' + (main.recipientName || main.customerName || '-') + '</td><td style="padding:3px 0;"><b>เบอร์ติดต่อผู้รับสินค้า :</b> ' + (main.recipientPhone || '-') + '</td></tr>' +
      '</table>' +
      '<p style="margin:8px 0 2px;"><b>ที่อยู่จัดส่ง :</b> ' + fmtAddress(main.shippingAddress) + '</p>' +
      '<p style="margin:2px 0 12px;"><b>ช่องทางการจัดส่ง :</b> ' + (main.deliveryChannel || '-') + '</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
      '<thead><tr style="background:#f2f2f2;">' +
      '<th style="border:1px solid #999;padding:6px;">ลำดับที่</th><th style="border:1px solid #999;padding:6px;">รายการสินค้า</th>' +
      '<th style="border:1px solid #999;padding:6px;">จำนวน</th><th style="border:1px solid #999;padding:6px;">ดีลเปลี่ยนสินค้า</th>' +
      '</tr></thead><tbody>' + itemRowsHtml + '</tbody></table>' +
      '<div style="margin-top:14px;">' + detailHtml + '</div>' +
      '<hr style="margin:14px 0;border:none;border-top:1px solid #999;" />' +
      '<p style="margin:4px 0;"><b>ของแถม :</b> ' + (main.giftItem || '-') + '</p>' +
      '<p style="margin:4px 0;"><b>วิธีการผ่อน :</b> ' + (main.installmentTypeLabel || '-') + '</p>' +
      '<p style="margin:4px 0;"><b>รายละเอียดอื่นๆ :</b> </p>' +
      '</div>';
  }

  async function printSingleBill(soNumber) {
    var main = state.orders.find(function (o) { return o.soNumber === soNumber; });
    if (!main) return;
    var accessories = main.sessionToken
      ? state.orders.filter(function (o) { return o.sessionToken === main.sessionToken && o.soNumber !== main.soNumber; })
      : [];
    state.printingBillSo = soNumber;
    render();
    try {
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;left:-99999px;top:0;';
      wrap.innerHTML = perBillPageHtml(main, accessories);
      document.body.appendChild(wrap);
      var canvas = await window.html2canvas(wrap.firstChild, { scale: 2, backgroundColor: '#ffffff' });
      wrap.remove();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      pdf.save('ใบเบิกสินค้า_' + soNumber + '.pdf');
    } catch (err) {
      window.alert('พิมพ์ใบเบิกรายบิลไม่สำเร็จ: ' + err.message);
    }
    state.printingBillSo = null;
    render();
  }

  // เติมอุปกรณ์เสริม (SO อื่นใน session เดียวกัน) ที่ยังไม่ได้ติ๊กเข้ามาด้วย — ให้พฤติกรรมตรงกับปุ่ม
  // "ใบเบิกรายบิล" ต่อแถวเดี่ยว (ติ๊กแค่เครื่องหลัก ก็ได้หน้าอุปกรณ์เสริมมาด้วยอัตโนมัติ ไม่ต้องไปหาติ๊กเพิ่ม)
  function expandWithSessionAccessories(orders) {
    var result = orders.slice();
    var seen = {};
    orders.forEach(function (o) { seen[o.soNumber] = true; });
    orders.forEach(function (o) {
      if (!o.sessionToken) return;
      state.orders.forEach(function (candidate) {
        if (candidate.sessionToken === o.sessionToken && !seen[candidate.soNumber]) {
          seen[candidate.soNumber] = true;
          result.push(candidate);
        }
      });
    });
    return result;
  }

  // ---------- "ใบเบิกรวม" (2026-09-09 user ขอ) — ลูกค้าคนเดียวกันมีหลายบิลที่ไม่ได้อยู่ session เดียวกัน
  // (เกินขอบเขตที่จับกลุ่มอัตโนมัติด้วย sessionToken ได้) พนักงานติ๊กเลือกเองแล้วกดปุ่มเดียว ได้ PDF ไฟล์เดียว
  // หน้าเบิกรายบิลต่อกันหลายหน้า (กรุ๊ปด้วย groupForDailySummary ตัวเดียวกับใบสรุปประจำวัน — ตรรกะเดียวกันเป๊ะ
  // แค่คนละ layout ต่อหน้า) ----------
  async function printCombinedBills() {
    var orders = selectedOrders();
    if (!orders.length) { window.alert('กรุณาติ๊กเลือกอย่างน้อย 1 รายการก่อนพิมพ์ใบเบิกรวม'); return; }
    state.printingCombined = true;
    render();
    try {
      var groups = groupForDailySummary(expandWithSessionAccessories(orders));
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      for (var i = 0; i < groups.length; i++) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-99999px;top:0;';
        wrap.innerHTML = perBillPageHtml(groups[i].main, groups[i].accessories);
        document.body.appendChild(wrap);
        var canvas = await window.html2canvas(wrap.firstChild, { scale: 2, backgroundColor: '#ffffff' });
        wrap.remove();
        if (i > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      pdf.save('ใบเบิกสินค้ารวม_' + new Date().toISOString().slice(0, 10) + '.pdf');
    } catch (err) {
      window.alert('พิมพ์ใบเบิกรวมไม่สำเร็จ: ' + err.message);
    }
    state.printingCombined = false;
    render();
  }

  // 2026-09-09 user ขอเพิ่มตัวเลือกเรียงลำดับจริง (เดิม dropdown มีแค่ "ล่าสุด" ตัวเดียวและไม่มี logic จริงเลย
  // เป็นแค่ป้ายตกแต่งของ listToolbarHtml) — เรียงฝั่ง client ทั้งหมด (ข้อมูลโหลด/กรองไว้ครบอยู่แล้ว)
  function sortOrders(orders) {
    var sorted = orders.slice();
    switch (state.sortBy) {
      case 'customerName':
        sorted.sort(function (a, b) { return (a.customerName || '').localeCompare(b.customerName || '', 'th'); });
        break;
      case 'soNumber':
        sorted.sort(function (a, b) { return (a.soNumber || '').localeCompare(b.soNumber || ''); });
        break;
      case 'customerId':
        sorted.sort(function (a, b) { return (a.customerId || '').localeCompare(b.customerId || ''); });
        break;
      case 'installmentType':
        sorted.sort(function (a, b) { return (a.installmentTypeLabel || '').localeCompare(b.installmentTypeLabel || '', 'th'); });
        break;
      default: // 'latest'
        sorted.sort(function (a, b) { return new Date(b.orderDate || 0) - new Date(a.orderDate || 0); });
    }
    return sorted;
  }

  // กรองส่วนใหญ่ทำฝั่ง server ผ่าน query params ไปแล้วตอน load() — filterChannel กรองฝั่ง client เพิ่ม (ข้อมูล
  // ทั้งหมดโหลดมาอยู่แล้ว ไม่ต้อง round-trip ใหม่)
  function filtered() {
    var result = state.filterChannel === 'all' ? state.orders : state.orders.filter(function (o) { return o.deliveryChannel === state.filterChannel; });
    return sortOrders(result);
  }

  // 2026-09-09 user ขอเปลี่ยนคอลัมน์ "ประเภท" (เดิมแยกแค่ 2 กลุ่มตามแหล่งข้อมูล credit/cash) เป็น "วิธีการผ่อน"
  // จริงตามที่ CRM ระบุ (4 ค่า: ซื้อสด/วางดาวน์/เครดิตผ่าน/ผ่อนครบรับของ — ดู installmentTypeLabel ที่คำนวณมา
  // จาก _lib/stock-reservation.js's INSTALLMENT_TYPE_LABELS แล้วในทั้ง 2 ฝั่งอยู่แล้ว ไม่ต้องคำนวณใหม่)
  var INSTALLMENT_TYPE_BADGE_STYLE = {
    FULL_PAYMENT: 'background:#fef3c7;color:#92400e;',
    FULL_PAY_THEN_RECEIVE: 'background:#fde68a;color:#92400e;',
    DOWN_PAYMENT: 'background:#e0f2fe;color:#075985;',
    PARTIAL_PAY_THEN_RECEIVE: 'background:#ede9fe;color:#6d28d9;',
  };
  function installmentTypeBadge(o) {
    var style = INSTALLMENT_TYPE_BADGE_STYLE[o.installmentType] || 'background:#f3f4f6;color:#374151;';
    return '<span class="badge badge-info" style="' + style + '">' + (o.installmentTypeLabel || '-') + '</span>';
  }
  function printBadge(o) {
    if (o.cancelledAt) return '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">ยกเลิก</span>';
    return o.printedAt
      ? '<span class="badge badge-info" style="background:#dcfce7;color:#15803d;">พิมพ์ใบเบิกประจำวันแล้ว</span>'
      : '<span class="badge badge-info" style="background:#fff3e0;color:#b06a00;">รอพิมพ์</span>';
  }

  function stockStatusBadge(o) {
    return o.stockReady
      ? '<span class="badge badge-info" style="background:#dcfce7;color:#15803d;">พร้อมส่ง</span>'
      : '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">รอสต๊อก (คิวที่ ' + o.queuePosition + ')</span>';
  }

  // สีเดียวกับ initCsStatusView ใน staff-sign-tab.js (เมนู "ข้อมูลลูกค้าทำสัญญา") เพื่อให้พนักงานเห็นสถานะ
  // เดียวกันแล้วรู้ทันทีว่าตรงกัน ไม่ใช่ระบบนับสถานะแยกกัน
  var CONTRACT_STATUS_BADGE_STYLE = {
    awaiting_customer: 'background:#fff3e0;color:#b06a00;',
    pending_review: 'background:#e0f2fe;color:#075985;',
    needs_correction: 'background:#fee2e2;color:#b91c1c;',
    customer_ok: 'background:#e3f5ec;color:#1f7a4d;',
    awaiting_staff_sign: 'background:#ede9fe;color:#6d28d9;',
    complete: 'background:#dcfce7;color:#15803d;',
  };
  function contractStatusBadge(o) {
    if (!o.contractStatus) return '<span style="color:var(--muted);">-</span>'; // ฝั่งซื้อสด/ปิดยอดไม่ผ่านระบบทำสัญญา ไม่มีสถานะนี้
    var style = CONTRACT_STATUS_BADGE_STYLE[o.contractStatus.key] || 'background:#f3f4f6;color:#374151;';
    return '<span class="badge badge-info" style="' + style + '">' + o.contractStatus.label + '</span>';
  }

  // รอบการเบิกเป็น dropdown ต่อแถวโดยตรง (2026-09-09 user ขอ — เดิมต้องติ๊กเลือกหลายแถวแล้วกดปุ่มแยกต่างหาก)
  // เลือกแล้วบันทึกทันที ไม่ต้องกดปุ่มยืนยันอีกชั้น
  function roundSelectHtml(o) {
    return '<select class="stkRowRound" data-so="' + o.soNumber + '" style="padding:4px 6px;border:1px solid var(--border);border-radius:6px;">' +
      '<option value=""' + (!o.withdrawalRound ? ' selected' : '') + '>ยังไม่กำหนด</option>' +
      ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (o.withdrawalRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select>';
  }

  function syncFreshnessNoticesHtml() {
    var h = '';
    var stockAgeMs = state.stockLastSyncedAt ? (Date.now() - new Date(state.stockLastSyncedAt).getTime()) : null;
    var stockStale = stockAgeMs === null || stockAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (stockStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (state.stockLastSyncedAt
        ? (stockStale ? '⚠️ ' : '✅ ') + 'ข้อมูลสต๊อก Odoo ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(state.stockLastSyncedAt) + (stockStale ? ' (นานเกิน 1 ชม. — เช็คว่าพีซีที่รัน sync เปิด/ต่อเน็ตอยู่ไหม)' : '')
        : '⚠️ ยังไม่เคย sync สต๊อกจาก Odoo เข้ามาเลย — รัน scripts/sync-stock-readiness.js ที่พีซีก่อน (ดู README)') +
      '</div>';

    var crmAgeMs = state.crmLastSyncedAt ? (Date.now() - new Date(state.crmLastSyncedAt).getTime()) : null;
    var crmStale = crmAgeMs === null || crmAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (crmStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (state.crmLastSyncedAt
        ? (crmStale ? '⚠️ ' : '✅ ') + 'ข้อมูลคำสั่งขาย CRM (ฝั่งซื้อสด/ปิดยอด) ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(state.crmLastSyncedAt) + (crmStale ? ' (นานเกิน 1 ชม. — เช็คว่าพีซีที่รัน sync เปิด/ต่อเน็ตอยู่ไหม)' : '')
        : '⚠️ ยังไม่เคย sync คำสั่งขาย CRM เข้ามาเลย — รัน scripts/sync-stock-readiness.js ที่พีซีก่อน (ดู README)') +
      '</div>';

    if (state.cashTruncated) {
      h += '<div class="notice" style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;">⚠️ ฝั่งซื้อสด/ปิดยอดย้อนหลัง ' + state.cashOrdersLookbackDays + ' วัน พบ ' + state.cashMatchedCount + ' รายการ เกินขีดจำกัดที่ดึงได้ต่อครั้ง — แจ้งผู้ดูแลระบบ (อาจต้องลดช่วงย้อนหลังหรือปรับ cap)</div>';
    }
    return h;
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    html += '<div class="card"><h2>รายการออเดอร์</h2>' +
      listToolbarHtml({
        sortId: 'stkSortOrder',
        sortOptions: [
          { value: 'latest', label: 'เรียงลำดับ: ล่าสุด' },
          { value: 'customerName', label: 'เรียงตามลูกค้า' },
          { value: 'soNumber', label: 'เรียงตามเลขคำสั่งซื้อ' },
          { value: 'customerId', label: 'เรียงตามรหัสลูกค้า' },
          { value: 'installmentType', label: 'เรียงตามวิธีการผ่อน' },
        ],
        sortValue: state.sortBy,
        searchIconId: 'stkFilterIcon',
        searchInputId: 'stkFilterQuery',
        searchValue: state.filterQuery,
        searchPlaceholder: 'ค้นหาชื่อลูกค้า / เลข SO / รหัสลูกค้า',
      }) +
      '<div class="so-search-filter-row" style="flex-wrap:wrap;">' +
      '<select id="stkFilterType" class="filter-select">' +
      '<option value="all"' + (state.filterCustomerType === 'all' ? ' selected' : '') + '>ประเภทลูกค้า: ทั้งหมด</option>' +
      '<option value="credit"' + (state.filterCustomerType === 'credit' ? ' selected' : '') + '>เครดิตผ่าน/วางดาวน์</option>' +
      '<option value="cash"' + (state.filterCustomerType === 'cash' ? ' selected' : '') + '>ซื้อสด/ปิดยอด</option>' +
      '</select>' +
      '<select id="stkFilterRound" class="filter-select">' +
      '<option value="all"' + (state.filterRound === 'all' ? ' selected' : '') + '>รอบการเบิก: ทุกรอบ</option>' +
      ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (state.filterRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
      '</select>' +
      '<select id="stkFilterPrintStatus" class="filter-select">' +
      '<option value="all"' + (state.filterPrintStatus === 'all' ? ' selected' : '') + '>สถานะการพิมพ์: ทั้งหมด</option>' +
      '<option value="printed"' + (state.filterPrintStatus === 'printed' ? ' selected' : '') + '>พิมพ์ใบเบิกแล้ว</option>' +
      '<option value="unprinted"' + (state.filterPrintStatus === 'unprinted' ? ' selected' : '') + '>รอพิมพ์</option>' +
      '</select>' +
      '<select id="stkFilterChannel" class="filter-select">' +
      '<option value="all"' + (state.filterChannel === 'all' ? ' selected' : '') + '>ช่องทางการจัดส่ง: ทุกช่องทาง</option>' +
      DELIVERY_CHANNEL_OPTIONS.map(function (c) { return '<option value="' + c + '"' + (state.filterChannel === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
      '</select>' +
      '<label class="filter-checkbox-chip"><input type="checkbox" id="stkShowCancelled"' + (state.showCancelled ? ' checked' : '') + ' /> แสดงรายการที่ยกเลิกแล้วด้วย</label>' +
      '</div>' +
      '</div>';

    if (!state.loading && !state.error) html += syncFreshnessNoticesHtml();

    if (state.loading) {
      html += '<div class="card">กำลังโหลดข้อมูล...</div>';
    } else if (state.error) {
      html += '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else {
      var orders = filtered();
      // แบ่งหน้าฝั่ง client (2026-09-09 user ขอ) — ข้อมูลทั้งหมดโหลด/กรองไว้แล้ว แค่ตัดโชว์เป็นหน้าๆ ไม่กระทบ
      // selection/print (ยังอิงจาก orders/filtered() เต็มทุกรายการเหมือนเดิม ไม่ใช่แค่หน้าที่กำลังโชว์)
      var totalPages = Math.max(1, Math.ceil(orders.length / state.pageSize));
      if (state.currentPage > totalPages) state.currentPage = totalPages;
      if (state.currentPage < 1) state.currentPage = 1;
      var pageStart = (state.currentPage - 1) * state.pageSize;
      var pagedOrders = orders.slice(pageStart, pageStart + state.pageSize);
      html += '<div class="card"><h2>รายการออเดอร์ (' + orders.length + ' รายการ)</h2>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">' +
        '<select id="stkAssignRound" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;">' +
        '<option value="">เลือกรอบการเบิก (สำหรับพิมพ์)...</option>' +
        ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (state.assignRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn-primary" id="stkBtnPrint"' + (state.printing ? ' disabled' : '') + '>' + (state.printing ? 'กำลังสร้าง PDF...' : '📄 พิมพ์ใบเบิกประจำวัน (PDF)') + '</button>' +
        (selectedOrders().length > 0
          ? '<button class="btn btn-secondary" id="stkBtnPrintCombined"' + (state.printingCombined ? ' disabled' : '') + '>' + (state.printingCombined ? 'กำลังสร้าง PDF...' : '🖨️ พิมพ์ใบเบิกรวม (' + selectedOrders().length + ' รายการที่เลือก)') + '</button>'
          : '') +
        '<span style="color:var(--muted);font-size:13px;">' + (selectedOrders().length > 0 ? 'เลือกไว้ ' + selectedOrders().length + ' รายการ (ติ๊กหลาย SO ของลูกค้าคนเดียวกันแล้วกด "พิมพ์ใบเบิกรวม" เพื่อรวมเป็น PDF เดียว)' : 'ไม่ได้เลือก = ใช้ทุกรายการที่กรองอยู่ (ตอนพิมพ์ใบเบิกประจำวัน)') + '</span>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:10px;">' +
        '<label style="font-size:13px;color:var(--muted);">แสดง ' +
        '<select id="stkPageSize" class="filter-select" style="display:inline-block;width:auto;">' +
        PAGE_SIZE_OPTIONS.map(function (n) { return '<option value="' + n + '"' + (state.pageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
        '</select> รายการต่อหน้า</label>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-left:auto;">' +
        '<button type="button" class="btn btn-ghost" id="stkBtnPrevPage"' + (state.currentPage <= 1 ? ' disabled' : '') + '>‹ ก่อนหน้า</button>' +
        '<span style="font-size:13px;color:var(--muted);">หน้า ' + state.currentPage + ' / ' + totalPages + '</span>' +
        '<button type="button" class="btn btn-ghost" id="stkBtnNextPage"' + (state.currentPage >= totalPages ? ' disabled' : '') + '>ถัดไป ›</button>' +
        '</div>' +
        '</div>' +
        '<div style="overflow-x:auto;"><table class="installment-table">' +
        '<thead><tr><th></th><th>วิธีการผ่อน</th><th style="text-align:left;">เลขที่ SO</th><th>รหัสลูกค้า</th><th style="text-align:left;">ชื่อลูกค้า</th><th style="text-align:left;">สินค้า</th><th>สต๊อกคงเหลือ (Odoo)</th><th>สถานะสต๊อก</th><th>สถานะการทำสัญญา</th><th>สถานะพิมพ์</th><th>รอบการเบิก</th><th></th><th></th></tr></thead>' +
        '<tbody>' + pagedOrders.map(function (o) {
          var checked = !!state.selected[o.soNumber];
          return '<tr' + (o.cancelledAt ? ' style="opacity:0.55;"' : '') + '>' +
            '<td><input type="checkbox" class="stkRowCheck" data-so="' + o.soNumber + '"' + (checked ? ' checked' : '') + (o.cancelledAt ? ' disabled' : '') + ' /></td>' +
            '<td>' + installmentTypeBadge(o) + '</td>' +
            '<td style="text-align:left;">' + o.soNumber + '</td>' +
            '<td>' + (o.customerId || '-') + '</td>' +
            '<td style="text-align:left;">' + o.customerName + '</td>' +
            '<td style="text-align:left;">' + o.product + (o.color ? ' (' + o.color + ')' : '') + '</td>' +
            '<td>' + (o.odooAvailableQty != null ? o.odooAvailableQty : '-') + '</td>' +
            '<td>' + stockStatusBadge(o) + '</td>' +
            '<td>' + contractStatusBadge(o) + '</td>' +
            '<td>' + printBadge(o) + '</td>' +
            '<td>' + roundSelectHtml(o) + '</td>' +
            '<td><button type="button" class="btn btn-ghost stkBtnPrintBill" data-so="' + o.soNumber + '"' + (state.printingBillSo === o.soNumber ? ' disabled' : '') + '>' + (state.printingBillSo === o.soNumber ? 'กำลังสร้าง...' : '🖨️ ใบเบิกรายบิล') + '</button></td>' +
            '<td>' + (o.source === 'cash' && !o.cancelledAt ? '<button type="button" class="btn btn-ghost stkBtnCancel" data-so="' + o.soNumber + '" style="color:var(--danger);">ยกเลิกออเดอร์</button>' : '') + '</td>' +
            '</tr>';
        }).join('') + (pagedOrders.length === 0 ? '<tr><td colspan="13" style="color:var(--muted);">ไม่พบรายการ</td></tr>' : '') +
        '</tbody></table></div>' +
        '</div>';
    }

    if (state.cancelingSo) {
      html += '<div class="card"><h2>ยกเลิกออเดอร์ ' + state.cancelingSo + '</h2>' +
        '<p class="hint">ใช้เฉพาะกรณี CRM ยกเลิกออเดอร์นี้เองไม่ได้ (ลูกค้ายกเลิก/เปิดบิลผิด) — ยกเลิกที่นี่จะไม่กระทบสถานะใน CRM จริง</p>' +
        '<div class="field"><label>เหตุผล</label><input type="text" id="stkCancelReason" value="' + state.cancelReason.replace(/"/g, '&quot;') + '" /></div>' +
        '<button class="btn btn-primary" id="stkBtnConfirmCancel">ยืนยันยกเลิก</button> ' +
        '<button class="btn btn-ghost" id="stkBtnCancelCancel">ปิด</button>' +
        '</div>';
    }

    app.innerHTML = html;

    document.getElementById('stkSortOrder').addEventListener('change', function (e) { state.sortBy = e.target.value; state.currentPage = 1; render(); });
    document.getElementById('stkFilterType').addEventListener('change', function (e) { state.filterCustomerType = e.target.value; state.currentPage = 1; load(); });
    document.getElementById('stkFilterQuery').addEventListener('input', function (e) { state.filterQuery = e.target.value; });
    document.getElementById('stkFilterQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') { state.currentPage = 1; load(); } });
    document.getElementById('stkFilterRound').addEventListener('change', function (e) { state.filterRound = e.target.value; state.currentPage = 1; load(); });
    document.getElementById('stkFilterPrintStatus').addEventListener('change', function (e) { state.filterPrintStatus = e.target.value; state.currentPage = 1; load(); });
    document.getElementById('stkFilterChannel').addEventListener('change', function (e) { state.filterChannel = e.target.value; state.currentPage = 1; render(); });
    document.getElementById('stkShowCancelled').addEventListener('change', function (e) { state.showCancelled = e.target.checked; state.currentPage = 1; load(); });

    if (!state.loading && !state.error) {
      Array.prototype.forEach.call(document.querySelectorAll('.stkRowCheck'), function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) state.selected[cb.getAttribute('data-so')] = true; else delete state.selected[cb.getAttribute('data-so')];
          render();
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.stkBtnCancel'), function (btn) {
        btn.addEventListener('click', function () { openCancelBox(btn.getAttribute('data-so')); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.stkRowRound'), function (sel) {
        sel.addEventListener('change', function () { setRoundForOrder(sel.getAttribute('data-so'), sel.value); });
      });
      Array.prototype.forEach.call(document.querySelectorAll('.stkBtnPrintBill'), function (btn) {
        btn.addEventListener('click', function () { printSingleBill(btn.getAttribute('data-so')); });
      });
      var pageSizeSel = document.getElementById('stkPageSize');
      if (pageSizeSel) pageSizeSel.addEventListener('change', function (e) { state.pageSize = Number(e.target.value) || 20; state.currentPage = 1; render(); });
      var btnPrevPage = document.getElementById('stkBtnPrevPage');
      if (btnPrevPage) btnPrevPage.addEventListener('click', function () { state.currentPage--; render(); });
      var btnNextPage = document.getElementById('stkBtnNextPage');
      if (btnNextPage) btnNextPage.addEventListener('click', function () { state.currentPage++; render(); });
      var assignRoundSel = document.getElementById('stkAssignRound');
      if (assignRoundSel) assignRoundSel.addEventListener('change', function (e) { state.assignRound = e.target.value; });
      var btnPrint = document.getElementById('stkBtnPrint');
      if (btnPrint) btnPrint.addEventListener('click', printRequisition);
      var btnPrintCombined = document.getElementById('stkBtnPrintCombined');
      if (btnPrintCombined) btnPrintCombined.addEventListener('click', printCombinedBills);
    }

    if (state.cancelingSo) {
      document.getElementById('stkCancelReason').addEventListener('input', function (e) { state.cancelReason = e.target.value; });
      document.getElementById('stkBtnConfirmCancel').addEventListener('click', confirmCancel);
      document.getElementById('stkBtnCancelCancel').addEventListener('click', closeCancelBox);
    }
  }

  load();
}

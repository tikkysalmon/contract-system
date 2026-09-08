// "สำหรับสต๊อค" (2026-09-06) — แทนที่ระบบเดิมที่ดึงจาก Lark Base (ดู ระบบจัดการออเดอร์.tsx ที่ user ส่งมา
// อ้างอิง UI/PDF เดิม) ระบบใหม่ดึงข้อมูลสด 2 แหล่ง: เครดิตผ่าน/วางดาวน์ (จากเมนู "ข้อมูลลูกค้าทำสัญญา" สถานะ
// "สัญญาลูกค้าเรียบร้อย") + ซื้อสด/ปิดยอด (จาก CRM ตรงๆ — ยังไม่ได้ต่อจริง รอ endpoint list/กรองออเดอร์จาก CRM
// ดู TODO ใน api/stock-orders.js) ให้สต๊อคกำหนด "รอบการเบิก" แล้วพิมพ์ใบเบิกประจำวันเป็น PDF ก่อนพิมพ์จริง
// ใช้: initStockTab('containerElementId', currentUser)
function initStockTab(containerId, currentUser) {
  'use strict';

  var ROUND_OPTIONS = ['เช้ารอบ 1', 'เช้ารอบ 2', 'เช้ารอบ 3', 'บ่ายรอบ 1', 'บ่ายรอบ 2', 'บ่ายรอบ 3'];

  var state = {
    loading: true,
    error: null,
    orders: [],
    cashSourceReady: true,
    selected: {}, // { soNumber: true }
    filterCustomerType: 'all',
    filterQuery: '',
    filterRound: 'all',
    filterPrintStatus: 'all',
    showCancelled: false,
    assignRound: '',
    assigning: false,
    printing: false,
    cancelingSo: null, // SO ที่กำลังเปิดกล่องกรอกเหตุผลยกเลิกอยู่
    cancelReason: '',
    // "ตรวจสอบสินค้าพร้อมส่ง" (2026-09-07, ปรับใหม่ 2026-09-08) — มุมมองที่ 2 ของหน้านี้ อ่านจากแคช Supabase
    // ของคำสั่งขาย CRM + สต๊อก Odoo (ดู _lib/stock-reservation.js) คนละแหล่งข้อมูลกับตาราง "รายการออเดอร์"
    // ด้านบน — **ต้องเลือกตัวกรองช่วงวันที่คำสั่งซื้อก่อนเสมอถึงจะค้นหาได้** (CRM มีคำสั่งขายสะสม 89,031
    // รายการ ดึงทั้งหมดมาแสดงทีเดียวไม่ได้ ต้องให้พนักงานแคบขอบเขตลงก่อนตามที่ user ยืนยัน 2026-09-08)
    activeView: 'orders', // 'orders' | 'readiness'
    readinessStatuses: [], // โหลดครั้งแรกตอนสลับมาดูมุมมองนี้ (สำหรับ dropdown ตัวกรองสถานะ)
    readinessMaxFilteredOrders: null,
    readinessMetaLoading: false,
    readinessMetaError: null,
    readinessFilters: { orderDateFrom: '', orderDateTo: '', statuses: [] }, // statuses: [] ว่าง = "ทั้งหมด" (2026-09-08 user ขอเลือกได้หลายสถานะพร้อมกัน — เดิมเลือกได้ทีละสถานะ)
    readinessSearching: false,
    readinessSearchError: null,
    readinessSearched: false, // เคยกดค้นหาอย่างน้อย 1 ครั้งหรือยัง
    readinessResult: null, // { orders, shortages, matchedCount, relevantCount, truncated, stockLastSyncedAt, crmLastSyncedAt }
  };

  var STATUS_LABELS = {
    CANCELLED: 'ยกเลิก',
    PENDING_CANCELLATION: 'รอยกเลิก',
    MISSED_INSTALLMENTS: 'ขาดผ่อน',
    INSTALLMENT_BEFORE_CREDIT_APPROVAL: 'รอนุมัติเครดิต (ยังไม่อนุมัติ)',
    COMPLETED: 'ปิดจบ/จ่ายครบแล้ว',
    INSTALLMENT_AFTER_CREDIT_APPROVAL: 'อนุมัติเครดิตแล้ว (กำลังผ่อน)',
    INSTALLMENT_PAUSED_BEFORE_APPROVED: 'พักชั่วคราว (ก่อนอนุมัติ)',
  };

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

  async function assignRoundToSelected() {
    var orders = selectedOrders();
    if (!orders.length) { window.alert('กรุณาติ๊กเลือกอย่างน้อย 1 รายการ'); return; }
    if (!state.assignRound) { window.alert('กรุณาเลือกรอบการเบิก'); return; }
    state.assigning = true;
    render();
    try {
      var res = await fetch('/api/stock-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setRound',
          soNumbers: orders.map(function (o) { return o.soNumber; }),
          round: state.assignRound,
          staffName: currentUser.username,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      await load();
    } catch (err) {
      window.alert('กำหนดรอบการเบิกไม่สำเร็จ: ' + err.message);
    }
    state.assigning = false;
    render();
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
  function requisitionPageHtml(rows, roundLabel, pageNo, totalPages) {
    var td = 'border:1px solid #999;padding:5px;';
    var rowsHtml = rows.map(function (r, i) {
      return '<tr>' +
        '<td style="' + td + 'text-align:center;">' + (i + 1) + '</td>' +
        '<td style="' + td + '">' + r.soNumber + '</td>' +
        '<td style="' + td + '">' + (r.customerId || '-') + '</td>' +
        '<td style="' + td + '">' + r.customerName + '</td>' +
        '<td style="' + td + '">' + (r.recipientName || '-') + '</td>' +
        '<td style="' + td + '">' + r.product + (r.color ? ' (' + r.color + ')' : '') + '</td>' +
        '<td style="' + td + 'text-align:center;">1</td>' +
        '</tr>';
    }).join('');
    return '<div style="width:794px;min-height:1123px;box-sizing:border-box;padding:36px 32px;font-family:\'Sarabun\',\'Noto Sans Thai\',sans-serif;color:#1c1b19;">' +
      '<div style="text-align:center;font-weight:700;font-size:15px;">บริษัท แซลม่อน เอ็นเตอร์ไพรส์ จำกัด</div>' +
      '<div style="text-align:center;font-weight:700;font-size:14px;margin-top:2px;">ใบสรุปเบิกสินค้าประจำวัน</div>' +
      '<div style="text-align:center;font-size:12px;color:#555;margin-top:8px;">วันที่พิมพ์: ' + isoToDDMMYYYY(new Date().toISOString().slice(0, 10)) + ' &nbsp;|&nbsp; รอบการเบิก: ' + (roundLabel || '-') + ' &nbsp;|&nbsp; หน้า ' + pageNo + '/' + totalPages + '</div>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:11px;">' +
      '<thead><tr style="background:#f2f2f2;">' +
      '<th style="' + td + '">ลำดับ</th>' +
      '<th style="' + td + '">เลขที่ SO</th>' +
      '<th style="' + td + '">รหัสลูกค้า</th>' +
      '<th style="' + td + '">ชื่อลูกค้า</th>' +
      '<th style="' + td + '">ผู้รับสินค้า</th>' +
      '<th style="' + td + '">รายการสินค้า</th>' +
      '<th style="' + td + '">จำนวน</th>' +
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
      var ITEMS_PER_PAGE = 25;
      var totalPages = Math.ceil(orders.length / ITEMS_PER_PAGE);
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      for (var p = 0; p < totalPages; p++) {
        var chunk = orders.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-99999px;top:0;';
        wrap.innerHTML = requisitionPageHtml(chunk, state.assignRound, p + 1, totalPages);
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

  function filtered() { return state.orders; } // กรองฝั่ง server ผ่าน query params ไปแล้วตอน load()

  function sourceBadge(o) {
    return o.source === 'credit'
      ? '<span class="badge badge-info" style="background:#e0f2fe;color:#075985;">เครดิตผ่าน/วางดาวน์</span>'
      : '<span class="badge badge-info" style="background:#fef3c7;color:#92400e;">ซื้อสด/ปิดยอด</span>';
  }
  function printBadge(o) {
    if (o.cancelledAt) return '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">ยกเลิก</span>';
    return o.printedAt
      ? '<span class="badge badge-info" style="background:#dcfce7;color:#15803d;">พิมพ์ใบเบิกประจำวันแล้ว</span>'
      : '<span class="badge badge-info" style="background:#fff3e0;color:#b06a00;">รอพิมพ์</span>';
  }

  // ---------- "ตรวจสอบสินค้าพร้อมส่ง" (2026-09-07, ปรับใหม่ 2026-09-08 — ต้องเลือกตัวกรองก่อนค้นหาเสมอ) ----------
  async function loadReadinessMeta() {
    state.readinessMetaLoading = true;
    state.readinessMetaError = null;
    render();
    try {
      var res = await fetch('/api/stock-orders?view=readiness');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.readinessStatuses = body.statuses || [];
      state.readinessMaxFilteredOrders = body.maxFilteredOrders || null;
      // ตั้งค่าเริ่มต้นให้ช่วงวันที่ = 30 วันล่าสุด กันพนักงานลืมกรอกแล้วกดค้นหาทั้งหมดโดยไม่ตั้งใจ
      var today = new Date();
      var from = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
      state.readinessFilters.orderDateTo = today.toISOString().slice(0, 10);
      state.readinessFilters.orderDateFrom = from.toISOString().slice(0, 10);
    } catch (err) {
      state.readinessMetaError = 'โหลดตัวเลือกตัวกรองไม่สำเร็จ: ' + err.message;
    }
    state.readinessMetaLoading = false;
    render();
  }

  async function searchReadiness() {
    if (!state.readinessFilters.orderDateFrom || !state.readinessFilters.orderDateTo) {
      window.alert('กรุณาเลือกช่วงวันที่คำสั่งซื้อก่อนค้นหา');
      return;
    }
    state.readinessSearching = true;
    state.readinessSearchError = null;
    state.readinessSearched = true;
    render();
    try {
      var params = new URLSearchParams({
        view: 'readiness',
        orderDateFrom: state.readinessFilters.orderDateFrom,
        orderDateTo: state.readinessFilters.orderDateTo,
      });
      if (state.readinessFilters.statuses.length) params.set('status', state.readinessFilters.statuses.join(','));
      var res = await fetch('/api/stock-orders?' + params.toString());
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'ค้นหาไม่สำเร็จ');
      state.readinessResult = body;
    } catch (err) {
      state.readinessSearchError = 'ค้นหาไม่สำเร็จ: ' + err.message + ' (ต้องตั้งค่า CRM_USERNAME/CRM_PASSWORD และรัน scripts/sync-stock-readiness.js อย่างน้อย 1 ครั้งก่อน)';
    }
    state.readinessSearching = false;
    render();
  }

  function switchView(view) {
    state.activeView = view;
    if (view === 'readiness' && !state.readinessStatuses.length && !state.readinessMetaLoading) loadReadinessMeta();
    render();
  }

  function readinessStockBadge(o) {
    return o.stockReady
      ? '<span class="badge badge-info" style="background:#dcfce7;color:#15803d;">พร้อมส่ง</span>'
      : '<span class="badge badge-info" style="background:#fee2e2;color:#b91c1c;">รอสต๊อก (คิวที่ ' + o.queuePosition + ')</span>';
  }

  function readinessFilterFormHtml() {
    return '<div class="card"><h2>ตัวกรอง (บังคับเลือกช่วงวันที่คำสั่งซื้อก่อนค้นหาเสมอ)</h2>' +
      '<p class="hint">CRM มีคำสั่งขายสะสมกว่า 89,000 รายการ ดึงมาแสดงทั้งหมดพร้อมกันไม่ได้ กรุณาเลือกช่วงวันที่ให้แคบพอ (แนะนำไม่เกิน 1-2 เดือน) — ถ้าผลลัพธ์เกิน ' + (state.readinessMaxFilteredOrders || 300) + ' รายการ ระบบจะขอให้แคบช่วงลงอีก</p>' +
      '<div class="so-search-filter-row" style="flex-wrap:wrap;align-items:flex-end;">' +
      '<div class="field"><label>วันที่คำสั่งซื้อ ตั้งแต่</label><input type="date" id="rdFilterFrom" value="' + state.readinessFilters.orderDateFrom + '" /></div>' +
      '<div class="field"><label>ถึงวันที่</label><input type="date" id="rdFilterTo" value="' + state.readinessFilters.orderDateTo + '" /></div>' +
      '<button type="button" class="btn btn-primary" id="rdBtnSearch"' + (state.readinessSearching ? ' disabled' : '') + '>' + (state.readinessSearching ? 'กำลังค้นหา...' : '🔍 ค้นหา') + '</button>' +
      '</div>' +
      // 2026-09-08 user ขอเลือกได้หลายสถานะพร้อมกัน — เดิมเป็น <select> เลือกได้ทีละสถานะ เปลี่ยนมาเป็นติ๊ก
      // checkbox หลายอันได้ (ไม่ติ๊กเลย = ทั้งหมด เหมือนเดิม)
      '<div class="field" style="margin-top:10px;"><label>สถานะ (เลือกได้หลายรายการ — ไม่เลือกเลย = ทั้งหมด ยกเว้นสถานะที่ปิดจบ/ยกเลิกอัตโนมัติ)</label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;padding:6px 0;">' +
      state.readinessStatuses.map(function (s) {
        var checked = state.readinessFilters.statuses.indexOf(s) !== -1;
        return '<label style="display:flex;align-items:center;gap:5px;font-size:13px;white-space:nowrap;">' +
          '<input type="checkbox" class="rdStatusCheck" data-status="' + s + '"' + (checked ? ' checked' : '') + ' />' +
          (STATUS_LABELS[s] || s) + '</label>';
      }).join('') +
      '</div></div>' +
      '<p class="hint" style="margin-top:10px;">⚠️ ยังไม่มีตัวกรอง "วันที่อนุมัติเครดิต" (CRM ไม่มีฟิลด์นี้ตรงๆ — อยู่ระหว่างหาวิธี) ตอนนี้กรองได้แค่วันที่คำสั่งซื้อกับสถานะ</p>' +
      '</div>';
  }

  function readinessSectionHtml() {
    var h = '';
    if (state.readinessMetaLoading) { return '<div class="card">กำลังโหลดตัวเลือกตัวกรอง...</div>'; }
    if (state.readinessMetaError) { return '<div class="card"><p style="color:var(--danger);">' + state.readinessMetaError + '</p></div>'; }

    h += readinessFilterFormHtml();

    if (state.readinessSearching) { h += '<div class="card">กำลังค้นหา...</div>'; return h; }
    if (state.readinessSearchError) { h += '<div class="card"><p style="color:var(--danger);">' + state.readinessSearchError + '</p></div>'; return h; }
    if (!state.readinessSearched || !state.readinessResult) { h += '<div class="card"><p class="hint">เลือกตัวกรองแล้วกดค้นหาเพื่อดูผลลัพธ์</p></div>'; return h; }

    var data = state.readinessResult;

    if (data.truncated) {
      h += '<div class="card"><p style="color:var(--danger);">⚠️ พบ ' + data.matchedCount + ' รายการ เกินขีดจำกัด ' + data.maxFilteredOrders + ' รายการต่อการค้นหา — กรุณาแคบช่วงวันที่หรือเลือกสถานะให้เจาะจงมากขึ้นแล้วค้นหาใหม่</p></div>';
      return h;
    }

    h += '<div class="notice">⚠️ ฟีเจอร์นี้ใหม่ — ถ้าเห็นสถานะที่ดูผิดปกติ (เช่น รายการที่ควรพร้อมส่งแต่ขึ้นรอสต๊อก) แจ้งได้เลย มีจุดที่ยังไม่ยืนยัน 100% กับข้อมูลจริง (การจับคู่ชื่อสินค้า)</div>';

    var stockAgeMs = data.stockLastSyncedAt ? (Date.now() - new Date(data.stockLastSyncedAt).getTime()) : null;
    var stockStale = stockAgeMs === null || stockAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (stockStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (data.stockLastSyncedAt
        ? (stockStale ? '⚠️ ' : '✅ ') + 'ข้อมูลสต๊อก Odoo ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(data.stockLastSyncedAt) + (stockStale ? ' (นานเกิน 1 ชม. — เช็คว่าพีซีที่รัน sync เปิด/ต่อเน็ตอยู่ไหม)' : '')
        : '⚠️ ยังไม่เคย sync สต๊อกจาก Odoo เข้ามาเลย — รัน scripts/sync-stock-readiness.js ที่พีซีก่อน (ดู README)') +
      '</div>';

    var crmAgeMs = data.crmLastSyncedAt ? (Date.now() - new Date(data.crmLastSyncedAt).getTime()) : null;
    var crmStale = crmAgeMs === null || crmAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (crmStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (data.crmLastSyncedAt
        ? (crmStale ? '⚠️ ' : '✅ ') + 'ข้อมูลคำสั่งขาย CRM ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(data.crmLastSyncedAt) + (crmStale ? ' (นานเกิน 1 ชม. — เช็คว่าพีซีที่รัน sync เปิด/ต่อเน็ตอยู่ไหม)' : '')
        : '⚠️ ยังไม่เคย sync คำสั่งขาย CRM เข้ามาเลย — รัน scripts/sync-stock-readiness.js ที่พีซีก่อน (ดู README)') +
      '</div>';

    if (data.shortages.length) {
      h += '<div class="card"><h2>🛒 สินค้าที่ขาด ต้องสั่งเพิ่ม (' + data.shortages.length + ' รายการ)</h2>' +
        '<table class="installment-table"><thead><tr><th style="text-align:left;">สินค้า</th><th>จำนวนที่ขาด (ออเดอร์)</th></tr></thead><tbody>' +
        data.shortages.map(function (s) {
          return '<tr><td style="text-align:left;">' + s.productName + '</td><td>' + s.shortCount + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<p class="hint" style="margin-top:10px;">ยังไม่มีเมนู "สำหรับจัดซื้อ" แยกต่างหาก (รอข้อมูลเพิ่มเติม) — ใช้ตารางนี้แจ้งจัดซื้อไปก่อนตอนนี้</p>' +
        '</div>';
    } else {
      h += '<div class="card"><p class="hint">✅ ไม่มีสินค้าขาดสต๊อกในรายการที่ตรวจสอบตอนนี้</p></div>';
    }

    h += '<div class="card"><h2>รายการที่ตรวจสอบ (' + data.matchedCount + ' รายการตามตัวกรอง)</h2>' +
      '<p class="hint">จัดคิวจองสต๊อกตามลำดับ: ซื้อสด/ผ่อนครบรับของ → วางดาวน์ → เครดิตผ่าน (เรียงตามวันที่สั่งซื้อภายในลำดับเดียวกัน)</p>' +
      '<div style="overflow-x:auto;"><table class="installment-table">' +
      '<thead><tr><th style="text-align:left;">เลขที่ SO</th><th style="text-align:left;">สินค้า</th><th>วิธีการผ่อน</th><th>วันที่สั่งซื้อ</th><th>สต๊อกคงเหลือ (Odoo)</th><th>สถานะ</th></tr></thead>' +
      '<tbody>' + data.orders.map(function (o) {
        return '<tr>' +
          '<td style="text-align:left;">' + o.saleOrderId + '</td>' +
          '<td style="text-align:left;">' + (o.productName || '-') + '</td>' +
          '<td>' + (o.installmentTypeLabel || o.installmentType) + '</td>' +
          '<td>' + fmtDateTime(o.orderDate) + '</td>' +
          '<td>' + o.odooAvailableQty + '</td>' +
          '<td>' + readinessStockBadge(o) + '</td>' +
          '</tr>';
      }).join('') + (data.orders.length === 0 ? '<tr><td colspan="6" style="color:var(--muted);">ไม่พบรายการ</td></tr>' : '') +
      '</tbody></table></div>' +
      '</div>';
    return h;
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    html += '<div style="display:flex;gap:8px;margin-bottom:4px;">' +
      '<button type="button" class="btn ' + (state.activeView === 'orders' ? 'btn-primary' : 'btn-secondary') + '" id="stkViewOrders">รายการออเดอร์</button>' +
      '<button type="button" class="btn ' + (state.activeView === 'readiness' ? 'btn-primary' : 'btn-secondary') + '" id="stkViewReadiness">ตรวจสอบสินค้าพร้อมส่ง</button>' +
      '</div>';

    if (state.activeView === 'readiness') {
      html += readinessSectionHtml();
      app.innerHTML = html;
      document.getElementById('stkViewOrders').addEventListener('click', function () { switchView('orders'); });
      document.getElementById('stkViewReadiness').addEventListener('click', function () { switchView('readiness'); });
      var rdFrom = document.getElementById('rdFilterFrom');
      var rdTo = document.getElementById('rdFilterTo');
      var rdBtn = document.getElementById('rdBtnSearch');
      if (rdFrom) rdFrom.addEventListener('change', function (e) { state.readinessFilters.orderDateFrom = e.target.value; });
      if (rdTo) rdTo.addEventListener('change', function (e) { state.readinessFilters.orderDateTo = e.target.value; });
      Array.prototype.forEach.call(document.querySelectorAll('.rdStatusCheck'), function (cb) {
        cb.addEventListener('change', function () {
          var s = cb.getAttribute('data-status');
          var idx = state.readinessFilters.statuses.indexOf(s);
          if (cb.checked && idx === -1) state.readinessFilters.statuses.push(s);
          else if (!cb.checked && idx !== -1) state.readinessFilters.statuses.splice(idx, 1);
        });
      });
      if (rdBtn) rdBtn.addEventListener('click', searchReadiness);
      return;
    }

    html += '<div class="card"><h2>รายการออเดอร์</h2>' +
      listToolbarHtml({
        sortId: 'stkSortOrder',
        sortOptions: [{ value: 'latest', label: 'เรียงลำดับ: ล่าสุด' }],
        sortValue: 'latest',
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
      '<label class="filter-checkbox-chip"><input type="checkbox" id="stkShowCancelled"' + (state.showCancelled ? ' checked' : '') + ' /> แสดงรายการที่ยกเลิกแล้วด้วย</label>' +
      '</div>' +
      '</div>';

    if (!state.cashSourceReady) {
      html += '<div class="notice">ฝั่ง "ซื้อสด/ปิดยอด" ยังไม่ได้เชื่อมกับ CRM จริง (รอ endpoint list/กรองออเดอร์จาก CRM) — ตอนนี้แสดงได้เฉพาะฝั่งเครดิตผ่าน/วางดาวน์เท่านั้น</div>';
    }

    if (state.loading) {
      html += '<div class="card">กำลังโหลดข้อมูล...</div>';
    } else if (state.error) {
      html += '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else {
      var orders = filtered();
      html += '<div class="card"><h2>รายการออเดอร์ (' + orders.length + ' รายการ)</h2>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px;">' +
        '<select id="stkAssignRound" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;">' +
        '<option value="">เลือกรอบการเบิก...</option>' +
        ROUND_OPTIONS.map(function (r) { return '<option value="' + r + '"' + (state.assignRound === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn-secondary" id="stkBtnAssignRound"' + (state.assigning ? ' disabled' : '') + '>' + (state.assigning ? 'กำลังบันทึก...' : 'กำหนดรอบการเบิกให้ที่เลือก') + '</button>' +
        '<button class="btn btn-primary" id="stkBtnPrint"' + (state.printing ? ' disabled' : '') + '>' + (state.printing ? 'กำลังสร้าง PDF...' : '📄 พิมพ์ใบเบิกประจำวัน (PDF)') + '</button>' +
        '<span style="color:var(--muted);font-size:13px;">' + (selectedOrders().length > 0 ? 'เลือกไว้ ' + selectedOrders().length + ' รายการ' : 'ไม่ได้เลือก = ใช้ทุกรายการที่กรองอยู่') + '</span>' +
        '</div>' +
        '<div style="overflow-x:auto;"><table class="installment-table">' +
        '<thead><tr><th></th><th>ประเภท</th><th style="text-align:left;">เลขที่ SO</th><th>รหัสลูกค้า</th><th style="text-align:left;">ชื่อลูกค้า</th><th style="text-align:left;">สินค้า</th><th>สถานะพิมพ์</th><th>รอบการเบิก</th><th></th></tr></thead>' +
        '<tbody>' + orders.map(function (o) {
          var checked = !!state.selected[o.soNumber];
          return '<tr' + (o.cancelledAt ? ' style="opacity:0.55;"' : '') + '>' +
            '<td><input type="checkbox" class="stkRowCheck" data-so="' + o.soNumber + '"' + (checked ? ' checked' : '') + (o.cancelledAt ? ' disabled' : '') + ' /></td>' +
            '<td>' + sourceBadge(o) + '</td>' +
            '<td style="text-align:left;">' + o.soNumber + '</td>' +
            '<td>' + (o.customerId || '-') + '</td>' +
            '<td style="text-align:left;">' + o.customerName + '</td>' +
            '<td style="text-align:left;">' + o.product + (o.color ? ' (' + o.color + ')' : '') + '</td>' +
            '<td>' + printBadge(o) + '</td>' +
            '<td>' + (o.withdrawalRound || '-') + '</td>' +
            '<td>' + (o.source === 'cash' && !o.cancelledAt ? '<button type="button" class="btn btn-ghost stkBtnCancel" data-so="' + o.soNumber + '" style="color:var(--danger);">ยกเลิกออเดอร์</button>' : '') + '</td>' +
            '</tr>';
        }).join('') + (orders.length === 0 ? '<tr><td colspan="9" style="color:var(--muted);">ไม่พบรายการ</td></tr>' : '') +
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

    document.getElementById('stkViewOrders').addEventListener('click', function () { switchView('orders'); });
    document.getElementById('stkViewReadiness').addEventListener('click', function () { switchView('readiness'); });
    document.getElementById('stkFilterType').addEventListener('change', function (e) { state.filterCustomerType = e.target.value; load(); });
    document.getElementById('stkFilterQuery').addEventListener('input', function (e) { state.filterQuery = e.target.value; });
    document.getElementById('stkFilterQuery').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
    document.getElementById('stkFilterRound').addEventListener('change', function (e) { state.filterRound = e.target.value; load(); });
    document.getElementById('stkFilterPrintStatus').addEventListener('change', function (e) { state.filterPrintStatus = e.target.value; load(); });
    document.getElementById('stkShowCancelled').addEventListener('change', function (e) { state.showCancelled = e.target.checked; load(); });

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
      var assignRoundSel = document.getElementById('stkAssignRound');
      if (assignRoundSel) assignRoundSel.addEventListener('change', function (e) { state.assignRound = e.target.value; });
      var btnAssign = document.getElementById('stkBtnAssignRound');
      if (btnAssign) btnAssign.addEventListener('click', assignRoundToSelected);
      var btnPrint = document.getElementById('stkBtnPrint');
      if (btnPrint) btnPrint.addEventListener('click', printRequisition);
    }

    if (state.cancelingSo) {
      document.getElementById('stkCancelReason').addEventListener('input', function (e) { state.cancelReason = e.target.value; });
      document.getElementById('stkBtnConfirmCancel').addEventListener('click', confirmCancel);
      document.getElementById('stkBtnCancelCancel').addEventListener('click', closeCancelBox);
    }
  }

  load();
}

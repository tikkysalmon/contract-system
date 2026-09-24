// "สำหรับจัดซื้อ" (2026-09-24 user ขอ) — สรุปรายการสินค้าที่ "รอสต๊อก" (ยังไม่มีของพอส่งให้ลูกค้าที่รออยู่)
// ทั้งหมด แยกยอดตามประเภทลูกค้า "ซื้อสด/ปิดยอด" กับ "เครดิตผ่าน/วางดาวน์" ให้ทีมจัดซื้อดูว่าต้องสั่งซื้อสินค้า
// ไหนเพิ่มกี่ชิ้น — ใช้ข้อมูลชุดเดียวกับเมนู "สำหรับสต๊อค" (/api/stock-orders คำนวณคิว/สถานะสต๊อกต่อออเดอร์ไว้
// ให้แล้ว ไม่ต้องคำนวณซ้ำ) แค่มาสรุปรวมเป็นรายสินค้าแทนที่จะแสดงทีละออเดอร์
//
// 2026-09-24 รอบ 2 — "ดีลเปลี่ยนสินค้า": ถ้าสินค้ารายการไหนหาซื้อไม่ได้จริงๆ จัดซื้อกดขยายดูรายชื่อ SO ที่รอ
// สินค้านั้นอยู่ แล้วกด "ทำเรื่องดีลเปลี่ยนสินค้า" ทีละ SO (กรอกชื่อสินค้าทดแทนที่เช็คราคา/สต๊อกจากระบบเทียบ
// ราคาแยกต่างหากมาแล้ว) บันทึกผ่าน /api/staff-actions action=createDealChange (status='pending') — รายการนี้
// จะไปโผล่เป็นคอลัมน์ "ดีลเปลี่ยนสินค้า" ในเมนู "สำหรับสต๊อค" ให้ทีมสต๊อคติดต่อลูกค้าต่อ (ดู stock-tab.js)
// ต้องรัน supabase-product-deal-changes.sql ก่อนใช้งานฟีเจอร์นี้
//
// ใช้: initPurchasingTab('containerElementId', currentUser)
function initPurchasingTab(containerId, currentUser) {
  'use strict';

  // TODO (2026-09-24): รอ user ส่ง URL ระบบเทียบราคาสินค้าจริงมาใส่ตรงนี้ (บอกไว้ว่า "จะส่งให้ภายหลัง") —
  // ตอนนี้ปุ่มจะแสดงเป็นสถานะ "ยังไม่ได้ตั้งค่าลิงก์" ไปก่อน ไม่ได้เดา URL มั่วๆ ใส่ไว้
  var PRICE_COMPARE_URL = '';

  var state = {
    loading: true,
    error: null,
    orders: [],
    stockLastSyncedAt: null,
    crmLastSyncedAt: null,
    filterQuery: '',
    expandedKey: null, // key ของแถวสินค้าที่กำลังกางดูรายการ SO อยู่ (product||color)
    dealFormSo: null, // soNumber ที่กำลังเปิดฟอร์ม "ทำเรื่องดีลเปลี่ยนสินค้า" อยู่
    dealFormData: { replacementProduct: '', note: '' },
    dealSubmitting: false,
    dealError: null,
  };

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  var DEAL_STATUS_LABEL = {
    pending: 'รอสต๊อคติดต่อลูกค้า',
    deal_success: 'ดีลสำเร็จ',
    cancelled_refund: 'ยกเลิกสัญญาคืนเงิน',
  };

  async function load() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var res = await fetch('/api/stock-orders');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.orders = body.orders || [];
      state.stockLastSyncedAt = body.stockLastSyncedAt || null;
      state.crmLastSyncedAt = body.crmLastSyncedAt || null;
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  // จัดกลุ่มออเดอร์ที่ "รอสต๊อก" จริง (stockReady === false — ไม่เอาแถว "ยกเลิกหลังพิมพ์ใบเบิก" ที่ stockReady
  // เป็น null เพราะไม่ต้องรอสต๊อกอีกแล้ว) เป็นรายสินค้า นับแยกจำนวนที่รอตามประเภทลูกค้า
  function groupWaitingByProduct() {
    var byKey = {};
    state.orders.forEach(function (o) {
      if (o.stockReady !== false) return;
      var key = o.product + '||' + (o.color || '');
      if (!byKey[key]) {
        byKey[key] = { key: key, product: o.product, color: o.color || '', odooAvailableQty: o.odooAvailableQty, cashWaiting: 0, creditWaiting: 0, orders: [] };
      }
      byKey[key].orders.push(o);
      if (o.source === 'cash') byKey[key].cashWaiting++;
      else if (o.source === 'credit') byKey[key].creditWaiting++;
    });
    var rows = Object.keys(byKey).map(function (k) {
      var r = byKey[k];
      r.totalWaiting = r.cashWaiting + r.creditWaiting;
      return r;
    });
    var q = state.filterQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) { return (r.product + ' ' + r.color).toLowerCase().indexOf(q) !== -1; });
    }
    rows.sort(function (a, b) { return b.totalWaiting - a.totalWaiting; }); // เร่งด่วนที่สุด (รอเยอะสุด) ก่อน
    return rows;
  }

  function syncNoticeHtml() {
    var h = '';
    var stockAgeMs = state.stockLastSyncedAt ? (Date.now() - new Date(state.stockLastSyncedAt).getTime()) : null;
    var stockStale = stockAgeMs === null || stockAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (stockStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (state.stockLastSyncedAt
        ? (stockStale ? '⚠️ ' : '✅ ') + 'ข้อมูลสต๊อก Odoo ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(state.stockLastSyncedAt) + (stockStale ? ' (นานเกิน 1 ชม. — เช็คว่าพีซีที่รัน sync เปิด/ต่อเน็ตอยู่ไหม)' : '')
        : '⚠️ ยังไม่เคย sync สต๊อกจาก Odoo เข้ามาเลย') +
      '</div>';
    var crmAgeMs = state.crmLastSyncedAt ? (Date.now() - new Date(state.crmLastSyncedAt).getTime()) : null;
    var crmStale = crmAgeMs === null || crmAgeMs > 60 * 60 * 1000;
    h += '<div class="notice"' + (crmStale ? ' style="background:#fee2e2;border-color:#fecaca;color:#b91c1c;"' : ' style="background:#e3f5ec;border-color:#bbf7d0;color:#1f7a4d;"') + '>' +
      (state.crmLastSyncedAt
        ? (crmStale ? '⚠️ ' : '✅ ') + 'ข้อมูลคำสั่งขาย CRM ล่าสุด sync จากพีซีเมื่อ ' + fmtDateTime(state.crmLastSyncedAt) + (crmStale ? ' (นานเกิน 1 ชม.)' : '')
        : '⚠️ ยังไม่เคย sync คำสั่งขาย CRM เข้ามาเลย') +
      '</div>';
    return h;
  }

  async function submitDealChange(o) {
    var replacementProduct = state.dealFormData.replacementProduct.trim();
    if (!replacementProduct) { state.dealError = 'กรุณากรอกชื่อสินค้าทดแทน'; render(); return; }
    state.dealSubmitting = true;
    state.dealError = null;
    render();
    try {
      var res = await fetch('/api/staff-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createDealChange', staffName: currentUser.username,
          soNumber: o.soNumber, originalProduct: o.product, originalColor: o.color || null,
          replacementProduct: replacementProduct, note: state.dealFormData.note.trim() || null,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
      state.dealFormSo = null;
      state.dealFormData = { replacementProduct: '', note: '' };
      await load(); // โหลดใหม่ให้เห็นสถานะ "รอสต๊อคติดต่อลูกค้า" ที่เพิ่งสร้างทันที
    } catch (err) {
      state.dealError = 'บันทึกไม่สำเร็จ: ' + err.message + ' (ตรวจว่ารัน supabase-product-deal-changes.sql แล้วหรือยัง)';
      state.dealSubmitting = false;
      render();
    }
  }

  function dealChangeCellHtml(o) {
    if (o.dealChange) {
      var d = o.dealChange;
      var color = d.status === 'deal_success' ? 'var(--ok)' : (d.status === 'cancelled_refund' ? 'var(--danger)' : 'var(--muted)');
      return '<div style="font-size:12.5px;">' +
        '<span style="color:' + color + ';font-weight:700;">' + (DEAL_STATUS_LABEL[d.status] || d.status) + '</span><br>' +
        'สินค้าทดแทน: ' + d.replacementProduct +
        (d.note ? '<br>หมายเหตุ: ' + d.note : '') +
        '</div>';
    }
    if (state.dealFormSo === o.soNumber) {
      return '<div style="min-width:220px;">' +
        '<input type="text" id="dealReplacementInput" placeholder="ชื่อสินค้าทดแทน" style="width:100%;padding:6px 8px;margin-bottom:4px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;" value="' + state.dealFormData.replacementProduct.replace(/"/g, '&quot;') + '" />' +
        '<input type="text" id="dealNoteInput" placeholder="หมายเหตุ (ถ้ามี)" style="width:100%;padding:6px 8px;margin-bottom:4px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;" value="' + state.dealFormData.note.replace(/"/g, '&quot;') + '" />' +
        (state.dealError ? '<p style="color:var(--danger);font-size:12px;margin:2px 0 6px;">' + state.dealError + '</p>' : '') +
        '<button type="button" class="btn btn-primary btn-sm dealSubmitBtn" data-so="' + o.soNumber + '"' + (state.dealSubmitting ? ' disabled' : '') + '>' + (state.dealSubmitting ? 'กำลังบันทึก...' : 'บันทึก') + '</button> ' +
        '<button type="button" class="btn btn-ghost btn-sm dealCancelBtn"' + (state.dealSubmitting ? ' disabled' : '') + '>ยกเลิก</button>' +
        '</div>';
    }
    return '<button type="button" class="btn btn-ghost btn-sm dealStartBtn" data-so="' + o.soNumber + '" style="color:var(--danger);">ทำเรื่องดีลเปลี่ยนสินค้า</button>';
  }

  function priceCompareButtonHtml() {
    if (!PRICE_COMPARE_URL) {
      return '<button type="button" class="btn btn-ghost" disabled title="ยังไม่ได้ตั้งค่าลิงก์ระบบเทียบราคา">🔗 ระบบเทียบราคาสินค้า (ยังไม่ได้ตั้งค่าลิงก์)</button>';
    }
    return '<a class="btn btn-secondary" href="' + PRICE_COMPARE_URL + '" target="_blank" rel="noopener">🔗 เปิดระบบเทียบราคาสินค้า</a>';
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '<div class="card"><h2>สินค้าที่รอสต๊อก (สำหรับสั่งซื้อ)</h2>' +
      '<p class="hint">รวมออเดอร์ทุกประเภทที่ยังไม่มีสต๊อกพอส่ง แยกเป็นรายสินค้า ให้ดูจำนวนที่ต้องสั่งซื้อเพิ่ม — กดที่แถวสินค้าเพื่อดูรายชื่อ SO ที่รออยู่ และทำเรื่องดีลเปลี่ยนสินค้าถ้าหาซื้อไม่ได้</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
      '<div class="so-search-pill" style="max-width:420px;flex:1;">' +
      '<div class="so-search-input-wrap">' +
      '<span class="so-search-icon">' + LIST_TOOLBAR_SEARCH_ICON + '</span>' +
      '<input type="text" id="pchFilterQuery" placeholder="ค้นหาชื่อสินค้า (กด Enter เพื่อค้นหา)" value="' + state.filterQuery.replace(/"/g, '&quot;') + '" />' +
      '</div></div>' +
      priceCompareButtonHtml() +
      '</div>' +
      '</div>';

    if (!state.loading && !state.error) html += syncNoticeHtml();

    if (state.loading) {
      html += '<div class="card">กำลังโหลดข้อมูล...</div>';
    } else if (state.error) {
      html += '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else {
      var rows = groupWaitingByProduct();
      var totalCash = rows.reduce(function (s, r) { return s + r.cashWaiting; }, 0);
      var totalCredit = rows.reduce(function (s, r) { return s + r.creditWaiting; }, 0);
      html += '<div class="card"><h2>รายการที่ต้องสั่งซื้อ (' + rows.length + ' รายการสินค้า — รวม ' + (totalCash + totalCredit) + ' ชิ้นที่รออยู่)</h2>' +
        '<div style="overflow-x:auto;"><table class="installment-table">' +
        '<thead><tr>' +
        '<th></th>' +
        '<th style="text-align:left;">สินค้า</th>' +
        '<th>สต๊อกคงเหลือ (Odoo)</th>' +
        '<th>รอสต๊อก — ซื้อสด/ปิดยอด</th>' +
        '<th>รอสต๊อก — เครดิตผ่าน/วางดาวน์</th>' +
        '<th>รวมที่ต้องสั่งซื้อ</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          var expanded = state.expandedKey === r.key;
          var mainRow = '<tr class="pchGroupRow" data-key="' + r.key + '" style="cursor:pointer;">' +
            '<td>' + (expanded ? '▾' : '▸') + '</td>' +
            '<td style="text-align:left;">' + r.product + (r.color ? ' (' + r.color + ')' : '') + '</td>' +
            '<td>' + (r.odooAvailableQty != null ? r.odooAvailableQty : '-') + '</td>' +
            '<td>' + (r.cashWaiting > 0 ? r.cashWaiting : '-') + '</td>' +
            '<td>' + (r.creditWaiting > 0 ? r.creditWaiting : '-') + '</td>' +
            '<td><b>' + r.totalWaiting + '</b></td>' +
            '</tr>';
          if (!expanded) return mainRow;
          var detailRow = '<tr><td></td><td colspan="5" style="background:#faf5ef;padding:10px 12px;">' +
            '<table class="installment-table" style="margin:0;"><thead><tr>' +
            '<th style="text-align:left;">เลขที่ SO</th><th style="text-align:left;">ชื่อลูกค้า</th><th>ประเภทลูกค้า</th><th style="text-align:left;">ดีลเปลี่ยนสินค้า</th>' +
            '</tr></thead><tbody>' +
            r.orders.map(function (o) {
              return '<tr>' +
                '<td style="text-align:left;">' + o.soNumber + '</td>' +
                '<td style="text-align:left;">' + o.customerName + '</td>' +
                '<td>' + (o.source === 'cash' ? 'ซื้อสด/ปิดยอด' : 'เครดิตผ่าน/วางดาวน์') + '</td>' +
                '<td style="text-align:left;">' + dealChangeCellHtml(o) + '</td>' +
                '</tr>';
            }).join('') +
            '</tbody></table></td></tr>';
          return mainRow + detailRow;
        }).join('') + (rows.length === 0 ? '<tr><td colspan="6" style="color:var(--muted);">ไม่มีสินค้าที่รอสต๊อกตอนนี้</td></tr>' : '') +
        '</tbody></table></div>' +
        '</div>';
    }

    app.innerHTML = html;

    // เก็บค่าตอนพิมพ์เฉยๆ ไม่ render ทุกตัวอักษร (render() ใหม่ทั้งก้อนจะทำให้ช่องพิมพ์เสีย focus/ตำแหน่ง cursor
    // ทุกครั้ง — แพทเทิร์นเดียวกับช่องค้นหาในเมนู "สำหรับสต๊อค") กรองจริงตอนกด Enter
    var qInput = document.getElementById('pchFilterQuery');
    if (qInput) {
      qInput.addEventListener('input', function (e) { state.filterQuery = e.target.value; });
      qInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') render(); });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.pchGroupRow'), function (tr) {
      tr.addEventListener('click', function () {
        var key = tr.getAttribute('data-key');
        state.expandedKey = state.expandedKey === key ? null : key;
        state.dealFormSo = null;
        state.dealError = null;
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dealStartBtn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.dealFormSo = btn.getAttribute('data-so');
        state.dealFormData = { replacementProduct: '', note: '' };
        state.dealError = null;
        render();
      });
    });
    var cancelBtn = document.querySelector('.dealCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); state.dealFormSo = null; state.dealError = null; render(); });
    var submitBtn = document.querySelector('.dealSubmitBtn');
    if (submitBtn) {
      submitBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var rows = groupWaitingByProduct();
        var o = null;
        rows.forEach(function (r) { r.orders.forEach(function (ord) { if (ord.soNumber === submitBtn.getAttribute('data-so')) o = ord; }); });
        if (o) submitDealChange(o);
      });
    }
    var repInput = document.getElementById('dealReplacementInput');
    if (repInput) { repInput.addEventListener('click', function (e) { e.stopPropagation(); }); repInput.addEventListener('input', function (e) { state.dealFormData.replacementProduct = e.target.value; }); }
    var noteInput = document.getElementById('dealNoteInput');
    if (noteInput) { noteInput.addEventListener('click', function (e) { e.stopPropagation(); }); noteInput.addEventListener('input', function (e) { state.dealFormData.note = e.target.value; }); }
  }

  load();
}

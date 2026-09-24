// "สำหรับจัดซื้อ" (2026-09-24 user ขอ) — สรุปรายการสินค้าที่ "รอสต๊อก" (ยังไม่มีของพอส่งให้ลูกค้าที่รออยู่)
// ทั้งหมด แยกยอดตามประเภทลูกค้า "ซื้อสด/ปิดยอด" กับ "เครดิตผ่าน/วางดาวน์" ให้ทีมจัดซื้อดูว่าต้องสั่งซื้อสินค้า
// ไหนเพิ่มกี่ชิ้น — ใช้ข้อมูลชุดเดียวกับเมนู "สำหรับสต๊อค" (/api/stock-orders คำนวณคิว/สถานะสต๊อกต่อออเดอร์ไว้
// ให้แล้ว ไม่ต้องคำนวณซ้ำ) แค่มาสรุปรวมเป็นรายสินค้าแทนที่จะแสดงทีละออเดอร์
// ใช้: initPurchasingTab('containerElementId', currentUser)
function initPurchasingTab(containerId, currentUser) {
  'use strict';

  var state = {
    loading: true,
    error: null,
    orders: [],
    stockLastSyncedAt: null,
    crmLastSyncedAt: null,
    filterQuery: '',
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
        byKey[key] = { product: o.product, color: o.color || '', odooAvailableQty: o.odooAvailableQty, cashWaiting: 0, creditWaiting: 0 };
      }
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

  function render() {
    var app = document.getElementById(containerId);
    var html = '<div class="card"><h2>สินค้าที่รอสต๊อก (สำหรับสั่งซื้อ)</h2>' +
      '<p class="hint">รวมออเดอร์ทุกประเภทที่ยังไม่มีสต๊อกพอส่ง แยกเป็นรายสินค้า ให้ดูจำนวนที่ต้องสั่งซื้อเพิ่ม</p>' +
      '<div class="so-search-pill" style="max-width:420px;">' +
      '<div class="so-search-input-wrap">' +
      '<span class="so-search-icon">' + LIST_TOOLBAR_SEARCH_ICON + '</span>' +
      '<input type="text" id="pchFilterQuery" placeholder="ค้นหาชื่อสินค้า (กด Enter เพื่อค้นหา)" value="' + state.filterQuery.replace(/"/g, '&quot;') + '" />' +
      '</div></div>' +
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
        '<th style="text-align:left;">สินค้า</th>' +
        '<th>สต๊อกคงเหลือ (Odoo)</th>' +
        '<th>รอสต๊อก — ซื้อสด/ปิดยอด</th>' +
        '<th>รอสต๊อก — เครดิตผ่าน/วางดาวน์</th>' +
        '<th>รวมที่ต้องสั่งซื้อ</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr>' +
            '<td style="text-align:left;">' + r.product + (r.color ? ' (' + r.color + ')' : '') + '</td>' +
            '<td>' + (r.odooAvailableQty != null ? r.odooAvailableQty : '-') + '</td>' +
            '<td>' + (r.cashWaiting > 0 ? r.cashWaiting : '-') + '</td>' +
            '<td>' + (r.creditWaiting > 0 ? r.creditWaiting : '-') + '</td>' +
            '<td><b>' + r.totalWaiting + '</b></td>' +
            '</tr>';
        }).join('') + (rows.length === 0 ? '<tr><td colspan="5" style="color:var(--muted);">ไม่มีสินค้าที่รอสต๊อกตอนนี้</td></tr>' : '') +
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
  }

  load();
}

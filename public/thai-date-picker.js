// ปฏิทินเลือกวันที่แบบกำหนดเอง (เดือน/ปี พ.ศ. ภาษาไทย) แทน picker เนทีฟของเบราว์เซอร์ที่คุมหน้าตาไม่ได้และแต่ละ
// เครื่อง/เบราว์เซอร์แสดงไม่เหมือนกัน (2026-09-03 ตามภาพตัวอย่างที่ user ส่งมา) ใช้ร่วมกันได้กับทุกช่องวันที่
// ในเว็บที่มีโครงสร้าง <div class="date-field-wrap"><div class="date-display">...</div></div> (ไม่ต้องมี
// native <input type="date"> ซ้อนอยู่ข้างในอีกต่อไป — คอมโพเนนต์นี้จัดการ popup + การเลือกวันเองทั้งหมด)
//
// ใช้: attachThaiDatePicker(wrapEl, { value: 'YYYY-MM-DD' หรือ '', onChange: function(isoValue) {} })
(function () {
  'use strict';

  var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  var THAI_WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function toIso(y, m, d) { return y + '-' + pad2(m + 1) + '-' + pad2(d); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function todayParts() { var t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; }

  window.attachThaiDatePicker = function (wrapEl, opts) {
    opts = opts || {};
    var displayEl = wrapEl.querySelector('.date-display');
    var value = opts.value || '';
    var today = todayParts();
    var panel = null;

    function parseValueOrToday() {
      if (!value) return { y: today.y, m: today.m };
      var p = value.split('-');
      return { y: Number(p[0]), m: Number(p[1]) - 1 };
    }
    var view = parseValueOrToday(); // เดือน/ปีที่ "กำลังดู" ในปฏิทิน ไม่ใช่ค่าที่เลือกแล้วเสมอไป (เลื่อนเดือนได้โดยยังไม่กดเลือก)

    function updateDisplay() {
      displayEl.textContent = value ? isoToDDMMYYYY(value) : 'เลือกวันที่';
    }

    function onOutsideMouseDown(e) {
      if (panel && !panel.contains(e.target) && e.target !== displayEl) closePanel();
    }

    // เลื่อนตาราง (เช่น scroll แนวนอนในตาราง "รายการออเดอร์") หรือ resize หน้าจอระหว่างเปิดปฏิทินอยู่ ต้อง
    // คำนวณตำแหน่งใหม่ตาม (เพราะย้ายไปแปะที่ <body> แล้ว ไม่ได้ขยับตามช่องอัตโนมัติเหมือนตอนอยู่ใต้ wrapEl เดิม)
    function onScrollOrResize() { if (panel) positionPanel(); }

    function closePanel() {
      if (!panel) return;
      panel.remove();
      panel = null;
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    }

    function selectDay(y, m, d) {
      value = toIso(y, m, d);
      updateDisplay();
      closePanel();
      if (typeof opts.onChange === 'function') opts.onChange(value);
    }

    function buildCells() {
      var y = view.y, m = view.m;
      var firstWeekday = new Date(y, m, 1).getDay();
      var totalDays = daysInMonth(y, m);
      var prevM = m - 1 < 0 ? 11 : m - 1;
      var prevY = m - 1 < 0 ? y - 1 : y;
      var prevTotalDays = daysInMonth(prevY, prevM);
      var nextM = m + 1 > 11 ? 0 : m + 1;
      var nextY = m + 1 > 11 ? y + 1 : y;

      var rows = Math.ceil((firstWeekday + totalDays) / 7);
      var gridSize = rows * 7;
      var cells = [];
      for (var i = 0; i < firstWeekday; i++) {
        cells.push({ y: prevY, m: prevM, d: prevTotalDays - firstWeekday + 1 + i, outside: true });
      }
      for (var d = 1; d <= totalDays; d++) cells.push({ y: y, m: m, d: d, outside: false });
      var nextD = 1;
      while (cells.length < gridSize) cells.push({ y: nextY, m: nextM, d: nextD++, outside: true });
      return cells;
    }

    function renderPanel() {
      if (!panel) return;
      var cells = buildCells();
      var selectedParts = value ? value.split('-').map(Number) : null;

      var html = '<div class="tdp-header">' +
        '<button type="button" class="tdp-nav" data-nav="-1" aria-label="เดือนก่อนหน้า">‹</button>' +
        '<div class="tdp-title">' + THAI_MONTHS[view.m] + ' ' + (view.y + 543) + '</div>' +
        '<button type="button" class="tdp-nav" data-nav="1" aria-label="เดือนถัดไป">›</button>' +
        '</div>' +
        '<div class="tdp-weekdays">' + THAI_WEEKDAYS.map(function (w) { return '<div>' + w + '</div>'; }).join('') + '</div>' +
        '<div class="tdp-grid">' + cells.map(function (c) {
          var isToday = c.y === today.y && c.m === today.m && c.d === today.d;
          var isSelected = selectedParts && c.y === selectedParts[0] && c.m === selectedParts[1] - 1 && c.d === selectedParts[2];
          var cls = 'tdp-cell' + (c.outside ? ' outside' : '') + (isToday ? ' today' : '') + (isSelected ? ' selected' : '');
          return '<button type="button" class="' + cls + '" data-y="' + c.y + '" data-m="' + c.m + '" data-d="' + c.d + '">' + c.d + '</button>';
        }).join('') + '</div>';

      panel.innerHTML = html;

      panel.querySelectorAll('.tdp-nav').forEach(function (btn) {
        btn.addEventListener('click', function () {
          view.m += Number(btn.getAttribute('data-nav'));
          if (view.m < 0) { view.m = 11; view.y -= 1; }
          if (view.m > 11) { view.m = 0; view.y += 1; }
          renderPanel();
        });
      });
      panel.querySelectorAll('.tdp-cell').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectDay(Number(btn.getAttribute('data-y')), Number(btn.getAttribute('data-m')), Number(btn.getAttribute('data-d')));
        });
      });

      // 2026-09-24 ต้องคำนวณตำแหน่งใหม่ทุกครั้งที่ render เนื้อหาใหม่ (ไม่ใช่แค่ตอนเปิด panel ครั้งแรก) เพราะ
      // ความสูงปฏิทินเปลี่ยนได้ตามจำนวนแถวของเดือนนั้น (5 หรือ 6 แถว) — เลื่อนเดือนแล้วความสูงเปลี่ยนไปโดยไม่จัด
      // ตำแหน่งใหม่จะทำให้ปฏิทินเลื่อนหลุดจอได้เหมือนกัน
      positionPanel();
    }

    // 2026-09-24 (รอบแรก) user เจอปฏิทินแสดงผลเพี้ยน/โดนตัดในเมนู "สำหรับสต๊อค" — ต้นเหตุคือ .tdp-panel เดิม
    // position:absolute อ้างอิงกับ .date-field-wrap ที่อยู่ในตาราง "รายการออเดอร์" ซึ่งอยู่ใน div ที่มี
    // overflow-x:auto (ให้เลื่อนตารางแนวนอนได้) — popup ที่ลอยออกนอกกรอบเซลล์เลยถูก container นั้นบัง/ตัดทิ้ง
    // แก้โดยย้าย panel ไปแปะที่ <body> ตรงๆ แล้วคำนวณตำแหน่ง fixed จาก getBoundingClientRect() ของช่องแทน
    // (ไม่ผูกกับ container ที่ตัด overflow อีกต่อไป) ใช้ได้กับทุกที่ที่เรียก attachThaiDatePicker ในเว็บ ไม่ใช่
    // แค่หน้าสต๊อค
    //
    // 2026-09-24 (รอบสอง) user เจอปฏิทินโดนตัดอีกจุดหนึ่ง — คราวนี้เป็นแนวตั้ง: ช่อง "วันที่เบิกสินค้า" อยู่ค่อน
    // ไปทางล่างสุดของตารางที่แสดงอยู่ พอเปิดปฏิทินแล้วเปิดลงด้านล่างเสมอ (top: rect.bottom) ทำให้ปฏิทินยื่นเลย
    // ขอบล่างของหน้าจอ (viewport) ไป มองไม่เห็นครึ่งล่างของปฏิทิน (แถวที่ 3 ของวันที่เป็นต้นไป) — เดิมคำนวณ
    // ตำแหน่งก่อน renderPanel() เติมเนื้อหา (panel ยังว่างเปล่า วัดความสูงไม่ได้เลย) แก้โดยย้ายมาเรียกหลัง
    // renderPanel() เสมอ แล้วเช็คว่าถ้าเปิดลงล่างแล้วจะล้นจอ ให้เปิดขึ้นบนช่องแทน (แพทเทิร์น dropdown/popover
    // ทั่วไป) ถ้าเปิดขึ้นบนแล้วยังไม่พออีก (ปฏิทินสูงกว่าทั้งจอ) ให้ชิดขอบบนสุดที่พอมองเห็นได้แทน
    function positionPanel() {
      var rect = wrapEl.getBoundingClientRect();
      var panelWidth = 264; // ต้องตรงกับ width ของ .tdp-panel ใน style.css
      var panelHeight = panel.offsetHeight || 340; // เผื่อกรณีวัดไม่ได้ (เช่นซ่อนอยู่) ใช้ค่าประมาณสูงสุดไปก่อน
      var left = rect.left;
      if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
      if (left < 8) left = 8;

      var top = rect.bottom + 6; // ค่าเริ่มต้น: เปิดลงล่าง
      var overflowsBottom = top + panelHeight > window.innerHeight - 8;
      if (overflowsBottom) {
        var topIfAbove = rect.top - panelHeight - 6; // ลองเปิดขึ้นบนช่องแทน
        top = topIfAbove >= 8 ? topIfAbove : Math.max(8, window.innerHeight - panelHeight - 8);
      }

      panel.style.position = 'fixed';
      panel.style.top = top + 'px';
      panel.style.left = left + 'px';
    }

    function openPanel() {
      if (panel) { closePanel(); return; }
      view = parseValueOrToday();
      panel = document.createElement('div');
      panel.className = 'tdp-panel';
      // ซ่อนไว้ก่อนระหว่างวัดขนาด/จัดตำแหน่ง กัน panel โผล่วาบที่มุมบนซ้ายจอ (ตำแหน่งเริ่มต้นก่อนคำนวณจริง)
      // ให้เห็นแวบก่อนย้ายไปตำแหน่งที่ถูกต้อง
      panel.style.visibility = 'hidden';
      document.body.appendChild(panel);
      renderPanel(); // ต้อง render เนื้อหาก่อน ถึงจะวัดความสูงจริงเพื่อจัดตำแหน่ง (positionPanel) ได้ถูกต้อง
      panel.style.visibility = 'visible';
      // setTimeout กันคลิกที่เปิด panel ตัวเดียวกันนี้ไปโดน listener ปิดทันทีใน mousedown เดียวกัน
      setTimeout(function () { document.addEventListener('mousedown', onOutsideMouseDown, true); }, 0);
      window.addEventListener('scroll', onScrollOrResize, true);
      window.addEventListener('resize', onScrollOrResize);
    }

    updateDisplay();
    displayEl.addEventListener('click', openPanel);
  };
})();

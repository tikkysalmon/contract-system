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

    function closePanel() {
      if (!panel) return;
      panel.remove();
      panel = null;
      document.removeEventListener('mousedown', onOutsideMouseDown, true);
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
    }

    function openPanel() {
      if (panel) { closePanel(); return; }
      view = parseValueOrToday();
      panel = document.createElement('div');
      panel.className = 'tdp-panel';
      wrapEl.appendChild(panel);
      renderPanel();
      // setTimeout กันคลิกที่เปิด panel ตัวเดียวกันนี้ไปโดน listener ปิดทันทีใน mousedown เดียวกัน
      setTimeout(function () { document.addEventListener('mousedown', onOutsideMouseDown, true); }, 0);
    }

    updateDisplay();
    displayEl.addEventListener('click', openPanel);
  };
})();

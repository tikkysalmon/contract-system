// "ตั้งค่าหัวจดหมาย" — แยกออกมาจาก contracts-tab.js (2026-09-03) ตามที่ user ขอให้ย้ายมาอยู่ที่เมนู
// "อัพโหลดข้อมูล" ใน app.html แทนที่จะอยู่บนสุดของแท็บ "ข้อมูลลูกค้าทำสัญญา"
// เก็บ/อ่านค่าจาก localStorage คีย์เดียวกับเดิม (LETTERHEAD_KEY) ที่ contracts-tab.js ยังอ่านไปใช้ตอนสร้างลิงก์
// ใช้: initLetterheadSettings('containerElementId')
function initLetterheadSettings(containerId) {
  'use strict';

  var LETTERHEAD_KEY = 'contractLetterheadDataUrl';

  var state = {
    letterheadDataUrl: localStorage.getItem(LETTERHEAD_KEY) || null,
  };

  function render() {
    var app = document.getElementById(containerId);
    var html = '<div class="card"><h2>ตั้งค่าหัวจดหมาย</h2>' +
      '<p class="hint">อัปโหลดโลโก้/หัวกระดาษบริษัทไว้ครั้งเดียว ระบบจะแปะบนสัญญา PDF ตัวอย่างที่ลูกค้าเปิดอ่านก่อนเซ็นทุกฉบับ (แนะนำไฟล์ PNG พื้นหลังโปร่งใส กว้างไม่เกิน ~1000px)</p>' +
      (state.letterheadDataUrl
        ? '<img src="' + state.letterheadDataUrl + '" style="max-width:100%;max-height:120px;border:1px solid var(--border);border-radius:8px;padding:4px;" />' +
          '<div style="margin-top:8px;"><button class="btn btn-ghost" id="btnClearLetterhead">ลบหัวจดหมาย</button></div>'
        : '<div class="upload-box" id="letterheadBox"><input type="file" id="letterheadInput" accept="image/*" />' +
          '<div class="upload-msg">แตะเพื่อเลือกไฟล์โลโก้/หัวกระดาษ</div></div>') +
      '<div class="err" id="letterheadErr"></div>' +
      '</div>';

    app.innerHTML = html;

    if (state.letterheadDataUrl) {
      document.getElementById('btnClearLetterhead').addEventListener('click', function () {
        state.letterheadDataUrl = null;
        localStorage.removeItem(LETTERHEAD_KEY);
        render();
      });
    } else {
      var lhBox = document.getElementById('letterheadBox');
      var lhInput = document.getElementById('letterheadInput');
      lhBox.addEventListener('click', function () { lhInput.click(); });
      lhInput.addEventListener('change', function () {
        var file = lhInput.files && lhInput.files[0];
        var errEl = document.getElementById('letterheadErr');
        errEl.textContent = '';
        if (!file) return;
        if (!/^image\//.test(file.type)) { errEl.textContent = 'กรุณาเลือกไฟล์รูปภาพเท่านั้น'; return; }
        if (file.size > 3 * 1024 * 1024) { errEl.textContent = 'ไฟล์ใหญ่เกิน 3MB'; return; }
        var reader = new FileReader();
        reader.onload = function () {
          var testImg = new Image();
          testImg.onload = function () {
            state.letterheadDataUrl = reader.result;
            localStorage.setItem(LETTERHEAD_KEY, reader.result);
            render();
          };
          testImg.onerror = function () {
            document.getElementById('letterheadErr').textContent = 'ไฟล์รูปเสียหรือเปิดไม่ได้ กรุณาลองไฟล์อื่น';
          };
          testImg.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }
  }

  render();
}

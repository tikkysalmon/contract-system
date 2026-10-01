// หน้าแก้ไขข้อมูลของเมนู "ข้อมูลลูกค้า" (2026-10-01 user ขอให้เปิดเป็นแท็บใหม่แทนแสดงต่อท้ายหน้ารายละเอียด) —
// เปิดจาก customer-info-tab.js ด้วย window.open ผ่าน URL: customer-info-edit.html?mode=...&token=...&so=...&user=...
//   mode = channel (ช่องทางการจัดส่ง + วัน/เวลานัดรับ) | gift (ของแถม) | note (หมายเหตุ) | reschedule (เลื่อนนัดรับ)
// ส่ง username ผ่าน query string ตรงๆ เหมือน contract-detail.html (ระบบ login ยังเป็น mock ไม่ใช่ auth จริง)
// ข้อมูลโหลดจาก /api/cs-session-list?view=customer-info แล้วบันทึกผ่าน /api/staff-actions เหมือนเดิมทุกประการ
// บันทึกสำเร็จแล้วแจ้งหน้าเดิมให้รีเฟรช (postMessage) และปิดแท็บนี้เอง
function initCustomerInfoEdit(containerId) {
  'use strict';
  var params = new URLSearchParams(location.search);
  var mode = params.get('mode') || '';
  var token = params.get('token') || '';
  var so = params.get('so') || '';
  var username = params.get('user') || '';
  var root = document.getElementById(containerId);
  var state = { row: null, saving: false, done: false, form: {} };

  // รายการช่องทางจัดส่ง/ของแถม คัดลอกจาก staff-sign-tab.js / sign.js (โปรเจกต์นี้ไม่มีธรรมเนียม share constant ข้ามไฟล์)
  var DELIVERY_CHANNEL_OPTIONS = ['ส่งไปรษณีย์', 'ส่งแมส', 'นัดรับสาขาอ่อนนุช', 'นัดรับสาขาพัทยา'];
  var GIFT_OPTIONS = [
      { value: 'Set iPhone (พาวเวอร์แบงค์, หูฟัง, เคส, ฟิล์ม, ที่ตั้งโทรศัพท์)', planTag: 'installment' },
      { value: 'Set iPad (เมาส์ไร้สาย, แป้นพิมพ์, กระเป๋า, ฟิล์ม, เคส, หูฟัง)', planTag: 'installment' },
      { value: 'Set Android (พาวเวอร์แบงค์, อะแดปเตอร์, สายชาร์จ Type C, ที่ตั้งโทรศัพท์, หูฟัง Type C)', planTag: 'installment' },
      { value: 'Set iPhone 1 (เคส, ฟิล์ม, ที่ตั้งโทรศัพท์, หูฟัง)', planTag: 'downpayment' },
      { value: 'Set iPhone 2 (เคส, ฟิล์ม, ที่ตั้งโทรศัพท์, พาวเวอร์แบงค์)', planTag: 'downpayment' },
      { value: 'Set iPad (เคส, ฟิล์ม, แป้นพิมพ์, เมาส์)', planTag: 'downpayment' },
      { value: 'Set Android 1 (ที่ตั้งโทรศัพท์, อะแดปเตอร์, หูฟัง)', planTag: 'downpayment' },
      { value: 'Set Android 2 (ที่ตั้งโทรศัพท์, อะแดปเตอร์, พาวเวอร์แบงค์)', planTag: 'downpayment' },
      { value: 'Set ของแถมน่ารักๆ โทนฟ้า', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ โทนม่วง', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ โทนชมพู', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ โทนดำ-เทา', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ โทนเหลือง', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ โทนเขียว', planTag: 'both' },
      { value: 'Set ของแถมน่ารักๆ คละสี', planTag: 'both' },
      { value: 'ไม่รับของแถม', planTag: 'both' },
    ];
  function giftOptionsForPlan(planType) {
    if (planType !== 'downpayment' && planType !== 'installment') return GIFT_OPTIONS.map(function (o) { return o.value; });
    return GIFT_OPTIONS.filter(function (o) { return o.planTag === 'both' || o.planTag === planType; }).map(function (o) { return o.value; });
  }
  function isPickupChannel(ch) { return String(ch || '').indexOf('นัดรับสาขา') === 0; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtPickup(date, time) {
    var d = date ? (isoToDDMMYYYY(date) || date) : '';
    return (d + ' ' + (time ? time + ' น.' : '')).trim() || '-';
  }
  function opts(list, cur) {
    return '<option value=""' + (!cur ? ' selected' : '') + '>-- ยังไม่ได้เลือก --</option>' +
      list.map(function (v) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
  }

  var TITLES = { channel: 'แก้ไขช่องทางการจัดส่ง', gift: 'แก้ไขของแถม', note: 'แก้ไขหมายเหตุ', reschedule: 'เลื่อนนัดรับสินค้า' };

  function showMsg(html) { root.innerHTML = '<div class="card">' + html + '</div>'; }

  function formHtml(r) {
    var f = state.form, body = '', hint = '';
    if (mode === 'channel') {
      hint = 'ไม่กระทบสถานะเซ็น/ตรวจสอบสัญญา ไม่ต้องให้ลูกค้าเซ็นใหม่ — ถ้าเปลี่ยนจากนัดรับสาขาไปช่องทางอื่น ระบบจะล้างวัน/เวลานัดรับให้';
      var channels = DELIVERY_CHANNEL_OPTIONS.slice();
      if (f.deliveryChannel && channels.indexOf(f.deliveryChannel) === -1) channels.unshift(f.deliveryChannel);
      body = '<div class="field"><label>ช่องทางการจัดส่ง</label><select id="ciChannel">' + opts(channels, f.deliveryChannel) + '</select></div>' +
        '<div class="row2" id="ciPickupWrap" style="' + (isPickupChannel(f.deliveryChannel) ? '' : 'display:none;') + '">' +
        '<div class="field"><label>วันที่นัดรับ</label><div class="date-field-wrap" id="ciPickupDateWrap"><div class="date-display">' + (isoToDDMMYYYY(f.pickupDate) || 'เลือกวันที่') + '</div></div></div>' +
        '<div class="field"><label>เวลาที่นัดรับ</label><input type="time" id="ciPickupTime" value="' + esc(f.pickupTime) + '" /></div>' +
        '</div>';
    } else if (mode === 'gift') {
      hint = 'ของแถมเป็นข้อมูลระดับลิงก์ (ใช้ร่วมกับทุก SO ในลิงก์เดียวกัน) ไม่กระทบสถานะเซ็น/ตรวจสอบสัญญา ไม่ต้องให้ลูกค้าเซ็นใหม่';
      var gifts = giftOptionsForPlan(r.planType);
      if (f.giftItem && gifts.indexOf(f.giftItem) === -1) gifts = [f.giftItem].concat(gifts); // ค่าเดิมที่ไม่อยู่ในลิสต์ปัจจุบัน ต้องไม่หายเงียบๆ
      body = '<div class="field"><label>ของแถม</label><select id="ciGift">' + opts(gifts, f.giftItem) + '</select></div>';
    } else if (mode === 'note') {
      hint = 'พิมพ์ข้อมูลอื่นๆ ที่ต้องการบันทึกเพิ่มเติม — ใช้ร่วมกับทุก SO ในลิงก์เดียวกัน และจะไปแสดงที่ใบเบิกสินค้า/ไฟล์นำเข้า MyOrder ด้วย';
      body = '<div class="field"><label>หมายเหตุ</label><input type="text" id="ciNote" value="' + esc(f.note) + '" /></div>';
    } else if (mode === 'reschedule') {
      hint = 'นัดรับเดิม: ' + esc(fmtPickup(r.pickupDate, r.pickupTime)) + ' — กรอกวัน/เวลานัดรับใหม่ตามที่ลูกค้าแจ้ง ระบบจะบันทึกประวัติการเลื่อนนัดไว้ และข้อมูลนี้จะไปแสดงที่ใบเบิกสินค้าของเมนู "สำหรับสต๊อค" ด้วย';
      body = '<div class="row2">' +
        '<div class="field"><label>วันที่นัดรับใหม่</label><div class="date-field-wrap" id="ciPickupDateWrap"><div class="date-display">' + (isoToDDMMYYYY(f.pickupDate) || 'เลือกวันที่') + '</div></div></div>' +
        '<div class="field"><label>เวลานัดรับใหม่</label><input type="time" id="ciPickupTime" value="' + esc(f.pickupTime) + '" /></div>' +
        '</div>' +
        '<div class="field"><label>เหตุผลที่เลื่อน (ไม่บังคับ)</label><input type="text" id="ciReason" value="' + esc(f.reason) + '" /></div>';
    }
    return '<div class="card"><h2>' + TITLES[mode] + ' — ' + esc(r.soNumber) + ' (' + esc(r.customerName) + ')</h2>' +
      '<p class="hint">' + hint + '</p>' + body +
      '<button class="btn btn-primary" id="ciBtnSave"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? 'กำลังบันทึก...' : 'บันทึก') + '</button> ' +
      '<button class="btn btn-ghost" id="ciBtnClose">ยกเลิก (ปิดหน้านี้)</button></div>';
  }

  function render() {
    var r = state.row;
    root.innerHTML = formHtml(r);
    var f = state.form;
    document.getElementById('ciBtnClose').addEventListener('click', function () { window.close(); });
    document.getElementById('ciBtnSave').addEventListener('click', save);
    if (mode === 'channel') {
      document.getElementById('ciChannel').addEventListener('change', function (e) {
        f.deliveryChannel = e.target.value;
        document.getElementById('ciPickupWrap').style.display = isPickupChannel(f.deliveryChannel) ? '' : 'none';
      });
    }
    if (mode === 'gift') document.getElementById('ciGift').addEventListener('change', function (e) { f.giftItem = e.target.value; });
    if (mode === 'note') document.getElementById('ciNote').addEventListener('input', function (e) { f.note = e.target.value; });
    if (mode === 'channel' || mode === 'reschedule') {
      attachThaiDatePicker(document.getElementById('ciPickupDateWrap'), { value: f.pickupDate, onChange: function (iso) { f.pickupDate = iso; } });
      document.getElementById('ciPickupTime').addEventListener('input', function (e) { f.pickupTime = e.target.value; });
    }
    if (mode === 'reschedule') document.getElementById('ciReason').addEventListener('input', function (e) { f.reason = e.target.value; });
  }

  async function post(payload) {
    var res = await fetch('/api/staff-actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var body = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || 'บันทึกไม่สำเร็จ');
  }

  async function save() {
    var r = state.row, f = state.form;
    var base = { staffName: username, sessionToken: token, soNumber: so };
    var payload;
    if (mode === 'channel') {
      payload = Object.assign({ action: 'updateLogistics', submissionId: r.submissionId },
        base, { deliveryChannel: f.deliveryChannel, pickupDate: f.pickupDate || null, pickupTime: f.pickupTime || null });
    } else if (mode === 'gift') {
      payload = Object.assign({ action: 'updateLogistics', submissionId: r.submissionId }, base, { giftItem: f.giftItem });
    } else if (mode === 'note') {
      // ส่งเฉพาะ note — ชื่อ/เบอร์ผู้รับมาจากฟอร์มลูกค้า ไม่ให้พนักงานแก้ตรงนี้
      payload = Object.assign({ action: 'updateShippingRecipient' }, base, { note: f.note });
    } else {
      if (!f.pickupDate || !f.pickupTime) { window.alert('กรุณาระบุวันที่และเวลานัดรับใหม่ให้ครบ'); return; }
      payload = Object.assign({ action: 'reschedulePickup' }, base, { pickupDate: f.pickupDate, pickupTime: f.pickupTime, reason: f.reason });
    }
    state.saving = true;
    render();
    try {
      await post(payload);
      try { if (window.opener) window.opener.postMessage({ type: 'customer-info-saved' }, location.origin); } catch (e) { /* ไม่มีหน้าเดิมก็ไม่เป็นไร */ }
      showMsg('<h2>บันทึกสำเร็จ</h2><p class="hint">ข้อมูลถูกอัปเดตแล้ว หน้ารายละเอียดเดิมจะรีเฟรชให้อัตโนมัติ — ปิดแท็บนี้ได้เลย</p>' +
        '<button class="btn btn-primary" id="ciBtnDone">ปิดหน้านี้</button>');
      document.getElementById('ciBtnDone').addEventListener('click', function () { window.close(); });
      setTimeout(function () { window.close(); }, 1200);
      return;
    } catch (err) {
      window.alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
    state.saving = false;
    render();
  }

  async function init() {
    if (!TITLES[mode] || !token || !so || !username) { showMsg('<p style="color:var(--danger);">ลิงก์ไม่ถูกต้อง กรุณาเปิดจากเมนู "ข้อมูลลูกค้า" ในระบบ</p>'); return; }
    showMsg('กำลังโหลดข้อมูล...');
    try {
      var res = await fetch('/api/cs-session-list?view=customer-info');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      var row = (body.rows || []).filter(function (x) { return x.sessionToken === token && x.soNumber === so; })[0];
      if (!row) throw new Error('ไม่พบรายการนี้');
      if (mode !== 'reschedule' && !row.submissionId) throw new Error('ลูกค้ายังไม่ได้ส่งข้อมูลมา จึงยังแก้ไขไม่ได้');
      if (mode === 'reschedule' && (!row.isPickup || row.pickedUpAt)) throw new Error('SO นี้ไม่ได้นัดรับสาขา หรือลูกค้ารับสินค้าไปแล้ว');
      state.row = row;
      state.form = {
        deliveryChannel: row.deliveryChannel || '', giftItem: row.giftItem || '', note: row.shippingNote || '',
        pickupDate: mode === 'reschedule' ? '' : (row.pickupDate || ''), pickupTime: mode === 'reschedule' ? '' : (row.pickupTime || ''), reason: '',
      };
      render();
    } catch (err) {
      showMsg('<p style="color:var(--danger);">' + esc(err.message) + '</p>');
    }
  }

  init();
}

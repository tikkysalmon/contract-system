// หน้าแสดง "ดูข้อมูลลูกค้า" แบบเต็ม เปิดเป็นแท็บใหม่แยกจากตาราง (2026-09-08 user ขอ — เดิมกางแถวขยายอยู่ใน
// ตารางเดียวกับตารางกว้างที่เลื่อนแนวนอนได้ ทำให้ต้องเลื่อนหน้าเว็บไปมาเพื่อดูข้อมูล) เปิดจากปุ่ม "ดูข้อมูลลูกค้า"
// ในตาราง "ข้อมูลลูกค้าทำสัญญา" (staff-sign-tab.js) — หน้านี้อ่านอย่างเดียว (ไม่มีปุ่มดาวน์โหลดสัญญา/เปลี่ยน SO/
// ปฏิเสธ เพราะย้ายปุ่มเหล่านั้นไปอยู่ในแถวตารางโดยตรงแล้ว ไม่ต้องกางดูก่อนถึงจะกดได้) ใช้ /api/staff-sign-queue
// เดิม (ไม่เพิ่ม endpoint ใหม่ กันเกินโควต้า 12 ฟังก์ชันของ Vercel Hobby plan) แล้วกรองหา submissionId ที่ต้องการเอง
//
// ⚠️ บั๊กจริงที่เจอ (2026-09-08): ตอนแรกอ่าน user/department จาก sessionStorage เดียวกับ app.js เอง โดยหวังพึ่ง
// พฤติกรรม browser ที่ "ควร" copy sessionStorage ให้แท็บใหม่อัตโนมัติเวลาเปิดด้วย target="_blank" — ทดสอบจริงบน
// production แล้วไม่ทำงาน (พฤติกรรมนี้ implement ไม่ตรงกันระหว่างเบราว์เซอร์ มักใช้ได้จริงแค่ตอนเปิดด้วย
// window.open() ที่เรียกจาก JS โดยตรง ไม่ใช่จาก href ธรรมดา) ทำให้ต้องล็อกอินซ้ำทุกครั้งทั้งที่ล็อกอินอยู่แล้ว
// — เปลี่ยนมาให้ staff-sign-tab.js ส่ง username/department มาทาง URL query string ตรงๆ แทน (?user=...&dept=...)
// ชัดเจนแน่นอน ไม่พึ่งพฤติกรรม browser ที่ไม่แน่นอน (ระบบนี้เป็น mock login ยังไม่ใช่ auth จริงอยู่แล้ว ไม่กระทบ
// ความปลอดภัยเพิ่มจากเดิม) — ยังอ่าน sessionStorage เป็น fallback ไว้เผื่อเปิดหน้านี้ตรงๆ โดยไม่ผ่านลิงก์
// ใช้: initContractDetailView('containerElementId')
function initContractDetailView(containerId) {
  'use strict';

  var SESSION_KEY = 'staffLoginSession';
  var FULL_ACCESS_DEPARTMENTS = ['บัญชี', 'ผู้จัดการ'];

  var state = { loading: true, error: null, item: null, user: null };

  var urlParams = new URLSearchParams(location.search);
  if (urlParams.get('user') && urlParams.get('dept')) {
    state.user = { username: urlParams.get('user'), department: urlParams.get('dept') };
  } else {
    try {
      var stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) state.user = JSON.parse(stored);
    } catch (e) { /* ไม่มี session ก็แค่แสดงข้อความให้กลับไปล็อกอิน */ }
  }

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatAddress(addr) {
    if (!addr) return '-';
    var parts = [];
    if (addr.detail) parts.push(addr.detail);
    if (addr.subdistrictName) parts.push('ต./แขวง' + addr.subdistrictName);
    if (addr.districtName) parts.push('อ./เขต' + addr.districtName);
    if (addr.provinceName) parts.push('จ.' + addr.provinceName);
    if (addr.zip) parts.push(addr.zip);
    return parts.length ? parts.join(' ') : '-';
  }

  function infoRow(label, value) {
    return '<tr><td style="text-align:left;color:var(--muted);width:170px;">' + label + '</td><td>' + (value || '-') + '</td></tr>';
  }

  function fileThumbHtml(url, label) {
    if (!url) return '';
    return '<a href="' + url + '" target="_blank" style="display:inline-block;text-align:center;margin:0 10px 10px 0;">' +
      '<img src="' + url + '" style="width:150px;height:110px;object-fit:cover;border:1px solid var(--border);border-radius:8px;display:block;" />' +
      '<span style="font-size:12px;color:var(--muted);">' + label + '</span></a>';
  }

  function hasGuardianGuarantor(item) {
    var c = item.customer || {};
    return {
      hasGuardian: !!(c.guardian && c.guardian.firstLastName && c.guardian.firstLastName.trim()),
      hasGuarantor: !!(c.guarantor && c.guarantor.firstLastName && c.guarantor.firstLastName.trim()),
    };
  }

  async function load() {
    var params = new URLSearchParams(location.search);
    var submissionId = params.get('id');
    if (!submissionId) { state.error = 'ไม่พบ id ของรายการ (เปิดหน้านี้ตรงๆ ไม่ได้ ต้องกดปุ่ม "ดูข้อมูลลูกค้า" จากตาราง)'; state.loading = false; render(); return; }
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/staff-sign-queue');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดข้อมูลไม่สำเร็จ');
      state.item = (body.queue || []).filter(function (q) { return String(q.submissionId) === submissionId; })[0] || null;
      if (!state.item) state.error = 'ไม่พบรายการนี้ (อาจถูกลบ หรือลิงก์หมดอายุ)';
    } catch (err) {
      state.error = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
    }
    state.loading = false;
    render();
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    if (!state.user) {
      html = '<div class="card"><p style="color:var(--danger);">กรุณาเข้าสู่ระบบที่หน้าเว็บหลักก่อน (<a href="app.html">ไปหน้าเข้าสู่ระบบ</a>)</p></div>';
      app.innerHTML = html;
      return;
    }
    if (FULL_ACCESS_DEPARTMENTS.indexOf(state.user.department) === -1) {
      html = '<div class="card"><p style="color:var(--danger);">แผนกของคุณไม่มีสิทธิ์ดูข้อมูลส่วนตัวลูกค้าเต็มรูปแบบ</p></div>';
      app.innerHTML = html;
      return;
    }
    if (state.loading) { app.innerHTML = '<div class="card">กำลังโหลดข้อมูล...</div>'; return; }
    if (state.error) { app.innerHTML = '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>'; return; }

    var item = state.item;
    var c = item.customer || {};
    var addr = c.address || {};
    var ship = c.shippingAddress || {};
    var ref = c.reference || {};
    var guardian = c.guardian || {};
    var guarantor = c.guarantor || {};
    var hg = hasGuardianGuarantor(item);

    html = '<div class="card">' +
      '<h2>ข้อมูลลูกค้า — ' + item.customerName + '</h2>' +
      '<p class="hint">' + (item.items || []).map(function (it) { return it.soNumber + ' (' + it.product + ')'; }).join(', ') + ' — ลูกค้าส่งฟอร์มเมื่อ ' + fmtDateTime(item.submittedAt) + '</p>' +
      '<table class="installment-table" style="margin-bottom:12px;">' +
      infoRow('ชื่อ-นามสกุล', (c.title || '') + (c.firstLastName || '-')) +
      infoRow('อายุ', c.age ? (c.age + ' ปี') : '-') +
      infoRow('เลขบัตรประชาชน', c.citizenId) +
      infoRow('เบอร์โทร', c.phone) +
      infoRow('สัญชาติ', c.nationality) +
      infoRow('ที่อยู่ปัจจุบัน', formatAddress(addr)) +
      infoRow('ที่อยู่จัดส่งสินค้า', ship.sameAsCurrent ? 'ใช้ที่อยู่เดียวกับที่อยู่ปัจจุบัน' : formatAddress(ship)) +
      infoRow('บุคคลอ้างอิง', ref.firstLastName ? (ref.firstLastName + ' (' + (ref.relation || '-') + ') โทร ' + (ref.phone || '-')) : '-') +
      (hg.hasGuardian ? infoRow('ผู้ปกครอง', (guardian.title || '') + guardian.firstLastName + ' โทร ' + (guardian.phone || '-') + ' บัตร ' + (guardian.citizenId || '-')) : '') +
      (hg.hasGuarantor ? infoRow('ผู้ค้ำประกัน', (guarantor.title || '') + guarantor.firstLastName + ' อายุ ' + (guarantor.age || '-') + ' ปี โทร ' + (guarantor.phone || '-') + ' บัตร ' + (guarantor.citizenId || '-')) : '') +
      '</table>' +
      '<div style="margin-bottom:4px;color:var(--muted);font-size:13px;">เอกสารแนบ (คลิกเพื่อดูเต็ม)</div>' +
      fileThumbHtml(item.files.idCard, 'บัตร ปชช. ลูกค้า') +
      fileThumbHtml(item.files.selfieWithId, 'คู่บัตร ลูกค้า') +
      fileThumbHtml(item.files.signature, 'ลายเซ็นลูกค้า') +
      (hg.hasGuardian ? fileThumbHtml(item.files.guardianId, 'บัตร ปชช. ผู้ปกครอง') : '') +
      (hg.hasGuardian ? fileThumbHtml(item.files.guardianSignature, 'ลายเซ็นผู้ปกครอง') : '') +
      (hg.hasGuarantor ? fileThumbHtml(item.files.guarantorId, 'บัตร ปชช. ผู้ค้ำ') : '') +
      (hg.hasGuarantor ? fileThumbHtml(item.files.guarantorSignature, 'ลายเซ็นผู้ค้ำ') : '') +
      (item.files.staffSignature ? fileThumbHtml(item.files.staffSignature, 'ลายเซ็นพนักงาน') : '') +
      '<p class="hint" style="margin-top:16px;">ปุ่มดาวน์โหลดสัญญา/เปลี่ยน SO/ปฏิเสธ-ขอแก้ไขข้อมูล ย้ายไปอยู่ในแถวตารางโดยตรงแล้ว ปิดแท็บนี้แล้วกลับไปที่ตารางเพื่อใช้งาน</p>' +
      '</div>';

    app.innerHTML = html;
  }

  load();
}

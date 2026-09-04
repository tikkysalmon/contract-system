// "ข้อมูลลูกค้าทำสัญญา" (คิวเซ็นเอกสาร) — เดิมเป็นหน้าว่างรอสเปก ตอนนี้เป็นคิวเอกสารที่ลูกค้าเซ็น/ส่งฟอร์ม
// แล้ว รอพนักงานเซ็นทีหลัง (2026-09-04 ตามที่ user ขอ "นำการเซ็นออนไลน์ของระบบขออนุมัติเอกสารมาใช้" — ยืนยัน
// ลำดับ: ลูกค้าเซ็นก่อน พนักงาน 1 คนเซ็นทีหลัง ผ่านการล็อกอินเข้า app.html เดิม เห็นคิวรอเซ็น ไม่ใช่ token link
// แบบผู้เซ็นภายนอกของ esign-approval)
// ใช้: initStaffSignTab('containerElementId', currentUser)  — currentUser: { username, department }
function initStaffSignTab(containerId, currentUser) {
  'use strict';

  var sigPad = null; // { canvas, ctx, drawing, hasStroke }

  var state = {
    loading: true,
    error: null,
    queue: [],
    signingId: null, // submissionId ที่กำลังเปิดเซ็นอยู่ (null = ยังไม่เปิด)
    submitting: false,
    submitError: null,
  };

  function fmtDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return '-';
    return (isoToDDMMYYYY(iso.slice(0, 10)) || '-') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  async function loadQueue() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var res = await fetch('/api/staff-sign-queue');
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'โหลดคิวไม่สำเร็จ');
      state.queue = body.queue || [];
    } catch (err) {
      state.error = 'โหลดคิวไม่สำเร็จ: ' + err.message + ' (ถ้ายังไม่ได้รัน supabase-staff-signature.sql ต้องรันก่อน)';
    }
    state.loading = false;
    render();
  }

  function openSignPanel(submissionId) {
    state.signingId = submissionId;
    state.submitError = null;
    state.submitting = false;
    render();
  }

  function closeSignPanel() {
    state.signingId = null;
    render();
  }

  async function submitSignature() {
    if (!sigPad || !sigPad.hasStroke) {
      state.submitError = 'กรุณาลงลายมือชื่อก่อนกดยืนยัน';
      render();
      return;
    }
    var signatureDataUrl = sigPad.canvas.toDataURL('image/png');
    state.submitting = true;
    state.submitError = null;
    render();
    try {
      var res = await fetch('/api/staff-sign-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: state.signingId,
          staffName: currentUser.username,
          signatureDataUrl: signatureDataUrl,
        }),
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || 'เซ็นไม่สำเร็จ');
      state.signingId = null;
      await loadQueue(); // โหลดคิวใหม่ (รายการที่เพิ่งเซ็นจะหายไปจากคิว)
      return;
    } catch (err) {
      state.submitError = 'เซ็นไม่สำเร็จ: ' + err.message;
    }
    state.submitting = false;
    render();
  }

  function setupSignaturePad() {
    var canvas = document.getElementById('staffSigCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1f2430';
    sigPad = { canvas: canvas, ctx: ctx, drawing: false, hasStroke: false };

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    }
    function start(e) { e.preventDefault(); sigPad.drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) {
      if (!sigPad.drawing) return;
      e.preventDefault();
      var p = pos(e);
      ctx.lineTo(p.x, p.y); ctx.stroke();
      sigPad.hasStroke = true;
    }
    function end() { sigPad.drawing = false; }
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    document.getElementById('staffSigClear').addEventListener('click', function () {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sigPad.hasStroke = false;
    });
  }

  function render() {
    var app = document.getElementById(containerId);
    var html = '';

    if (state.loading) {
      html = '<div class="card">กำลังโหลดคิว...</div>';
    } else if (state.error) {
      html = '<div class="card"><p style="color:var(--danger);">' + state.error + '</p></div>';
    } else if (state.signingId) {
      var item = state.queue.filter(function (q) { return q.submissionId === state.signingId; })[0];
      html = '<div class="card">' +
        '<h2>เซ็นเอกสาร — ' + (item ? item.customerName : '') + '</h2>' +
        '<p class="hint">รายการ: ' + (item ? item.products.join(', ') : '') + ' (' + (item ? item.soNumbers.join(', ') : '') + ')</p>' +
        '<p class="hint">ลูกค้าส่งฟอร์ม/เซ็นชื่อแล้วเมื่อ ' + (item ? fmtDateTime(item.submittedAt) : '') + ' — ลงลายมือชื่อพนักงาน (' + currentUser.username + ') เพื่อยืนยันอนุมัติสัญญานี้</p>' +
        '<div class="sig-pad-wrap"><canvas id="staffSigCanvas"></canvas></div>' +
        '<div class="sig-tools"><button type="button" class="btn btn-ghost" id="staffSigClear">ล้างลายเซ็น</button></div>' +
        (state.submitError ? '<p style="color:var(--danger);margin-top:10px;">' + state.submitError + '</p>' : '') +
        '<div style="margin-top:14px;">' +
        '<button class="btn btn-primary" id="btnSubmitSign"' + (state.submitting ? ' disabled' : '') + '>' + (state.submitting ? 'กำลังบันทึก...' : 'ยืนยันเซ็น') + '</button> ' +
        '<button class="btn btn-ghost" id="btnCancelSign">ยกเลิก</button>' +
        '</div>' +
        '</div>';
    } else if (state.queue.length === 0) {
      html = '<div class="card"><h2>คิวเอกสารรอเซ็น</h2><p class="hint">ไม่มีเอกสารรอเซ็นตอนนี้ — ลูกค้ายังไม่ส่งฟอร์ม หรือเซ็นครบแล้วทั้งหมด</p></div>';
    } else {
      html = '<div class="card"><h2>คิวเอกสารรอเซ็น (' + state.queue.length + ' รายการ)</h2>' +
        '<p class="hint">ลูกค้ากรอกฟอร์ม/เซ็นชื่อแล้ว รอพนักงานเซ็นยืนยันอนุมัติ</p>' +
        state.queue.map(function (q) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-top:1px solid var(--border);">' +
            '<div style="flex:1;">' +
            '<b>' + q.customerName + '</b><br>' +
            '<span style="color:var(--muted);font-size:13px;">' + q.products.join(', ') + ' (' + q.soNumbers.join(', ') + ')</span><br>' +
            '<span style="color:var(--muted);font-size:12px;">ส่งฟอร์มเมื่อ ' + fmtDateTime(q.submittedAt) + '</span>' +
            '</div>' +
            '<button class="btn btn-primary btnOpenSign" data-id="' + q.submissionId + '">เซ็นเอกสาร</button>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    app.innerHTML = html;

    if (state.signingId) {
      setupSignaturePad();
      document.getElementById('btnSubmitSign').addEventListener('click', submitSignature);
      document.getElementById('btnCancelSign').addEventListener('click', closeSignPanel);
    } else if (!state.loading && !state.error) {
      Array.prototype.forEach.call(document.querySelectorAll('.btnOpenSign'), function (btn) {
        btn.addEventListener('click', function () { openSignPanel(btn.getAttribute('data-id')); });
      });
    }
  }

  loadQueue();
}

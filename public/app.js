(function () {
  'use strict';

  // TODO (2026-09-03): นี่คือ mock login เท่านั้น ยังไม่เช็คกับฐานข้อมูลพนักงานจริง — ใช้ลิสต์ MOCK_USERS
  // ด้านล่างแทนไปก่อน (แผนกผูกกับ "ผู้ใช้งาน" ไม่ให้เลือกเองตอนล็อกอินแล้ว ตามที่ user ขอ 2026-09-03) ต้องต่อ
  // ระบบ auth จริง (เหมือน 12_esign-approval's auth.js) พร้อมตาราง staff_users ที่มีคอลัมน์แผนกจริงจาก
  // Supabase ทีหลัง — ตอนนั้นค่อยย้าย "ตั้งค่าแผนกของผู้ใช้งาน" ไปอยู่ในเมนู Admin Management/การตั้งค่าจริง
  var SESSION_KEY = 'staffLoginSession';

  // username/password ทดสอบ (ไม่ใช่ระบบความปลอดภัยจริง) — แต่ละบัญชีผูกแผนกไว้ตายตัว ไม่ให้ผู้ใช้เลือกเอง
  var MOCK_USERS = [
    { username: 'cs1', password: '1234', department: 'CS' },
    { username: 'acc1', password: '1234', department: 'บัญชี' },
    { username: 'stock1', password: '1234', department: 'สต๊อค' },
    { username: 'pack1', password: '1234', department: 'แพ็คกิ้ง' },
    { username: 'admin', password: '1234', department: 'ผู้จัดการ' },
  ];

  // ไอคอนเมนู — เส้น outline โทนสีเทาเข้ม (var(--icon-gray) ใน style.css) แทนอิโมจิสีเดิม (2026-09-03
  // ตามที่ user ขอ) รูปทรงอิงจาก Feather Icons (MIT license) วาดเป็น inline SVG เอง ไม่โหลดไลบรารีนอก
  function svgIcon(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var ICONS = {
    contracts: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>'),
    for_cs: svgIcon('<path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>'),
    stock: svgIcon('<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"></line><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>'),
    packing: svgIcon('<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>'),
    report_en: svgIcon('<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>'),
    upload: svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>'),
    settings: svgIcon('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'),
    logout: svgIcon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>'),
  };

  // เมนูฝั่งซ้าย + แผนกที่มีสิทธิ์เห็นเมนูนั้น (ตามที่ user ระบุ 2026-09-03) — "ผู้จัดการ" เห็นได้ทุกเมนูเสมอ
  // "ค้นหาคำสั่งขาย/สร้างลิงก์" ย้ายไปอยู่ที่ key 'for_cs' แล้ว (เดิมอยู่ที่ 'contracts') ตามที่ user ขอ
  // 2026-09-03 — 'contracts' ("ข้อมูลลูกค้าทำสัญญา") จึงเหลือเป็นหน้าว่างรอสเปกใหม่ (เช่น หน้าดูรายการสัญญาที่
  // สร้างไปแล้ว) ยังไม่ได้ระบุจาก user
  var MENU_ITEMS = [
    { key: 'contracts', icon: 'contracts', label: 'ข้อมูลลูกค้าทำสัญญา', departments: ['CS', 'บัญชี'] },
    { key: 'for_cs', icon: 'for_cs', label: 'สำหรับ CS', departments: ['CS'] },
    { key: 'stock', icon: 'stock', label: 'สำหรับสต๊อค', departments: ['สต๊อค'] },
    { key: 'packing', icon: 'packing', label: 'สำหรับแพ็คกิ้ง', departments: ['แพ็คกิ้ง'] },
    { key: 'report_en', icon: 'report_en', label: 'Report', departments: ['บัญชี'] },
    { key: 'upload', icon: 'upload', label: 'อัพโหลดข้อมูล', departments: ['บัญชี'] },
    { key: 'settings', icon: 'settings', label: 'การตั้งค่า', departments: [] }, // departments ว่าง = ผู้จัดการเท่านั้น
  ];

  // user ขอ 2026-09-03: โชว์ทุกเมนูไปก่อนจนกว่าจะตั้งค่า User ใช้จริง (ยังไม่มีระบบ auth/แผนกจริง ไม่อยาก
  // ให้การกรองเมนู mock ๆ บังการทดสอบ/ดูหน้าตาของเมนูอื่น) — ตั้ง false เพื่อเปิดการกรองตามแผนกกลับมาใช้ตอน
  // มี Supabase + staff_users จริงแล้ว โครงสร้าง departments ใน MENU_ITEMS ด้านบนยังเก็บไว้ครบ ไม่ได้ลบทิ้ง
  var SHOW_ALL_MENUS = true;

  function menuVisibleFor(item, department) {
    if (SHOW_ALL_MENUS) return true;
    if (department === 'ผู้จัดการ') return true;
    return item.departments.indexOf(department) !== -1;
  }

  var state = {
    user: null, // { username, department }
    activeTab: 'contracts',
    loginError: '',
  };

  try {
    var stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) state.user = JSON.parse(stored);
  } catch (e) { /* เริ่มใหม่ถ้าอ่านไม่ได้ */ }

  function renderLogin() {
    var root = document.getElementById('root');
    root.innerHTML =
      '<div class="login-wrap"><div class="card login-card">' +
      '<img class="login-mascot" src="assets/mascot.png" alt="น้องม่อน" />' +
      '<div class="login-title">สวัสดี!</div>' +
      '<div class="login-subtitle">พนักงาน Salmon Phone</div>' +
      '<div class="field"><label>Username</label><input type="text" id="loginUsername" placeholder="กรอกข้อมูล Username" autocomplete="username" /></div>' +
      '<div class="field"><label>รหัสผ่าน</label><div class="pwd-wrap">' +
      '<input type="password" id="loginPassword" placeholder="กรอกรหัสผ่าน" autocomplete="current-password" />' +
      '<button type="button" id="togglePwd" aria-label="แสดง/ซ่อนรหัสผ่าน">👁</button>' +
      '</div></div>' +
      (state.loginError ? '<p class="err" style="display:block;">' + state.loginError + '</p>' : '') +
      '<button class="btn btn-primary" id="btnLogin">เข้าสู่ระบบ</button>' +
      '<p style="font-size:12px;color:var(--muted);margin-top:14px;">* เวอร์ชันทดสอบ — ดู username/password ทดสอบได้ที่ README ข้อ 4</p>' +
      '</div></div>';

    document.getElementById('togglePwd').addEventListener('click', function () {
      var pwd = document.getElementById('loginPassword');
      pwd.type = pwd.type === 'password' ? 'text' : 'password';
    });
    document.getElementById('loginPassword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    document.getElementById('btnLogin').addEventListener('click', doLogin);
  }

  function doLogin() {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value.trim();
    if (!username || !password) {
      state.loginError = 'กรุณากรอก Username และรหัสผ่าน';
      renderLogin();
      return;
    }
    var matched = MOCK_USERS.filter(function (u) { return u.username === username && u.password === password; })[0];
    if (!matched) {
      state.loginError = 'Username หรือรหัสผ่านไม่ถูกต้อง';
      renderLogin();
      return;
    }
    state.user = { username: matched.username, department: matched.department };
    state.loginError = '';
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.user));
    var firstVisible = MENU_ITEMS.filter(function (m) { return menuVisibleFor(m, matched.department); })[0];
    state.activeTab = firstVisible ? firstVisible.key : 'contracts';
    renderApp();
  }

  function doLogout() {
    state.user = null;
    sessionStorage.removeItem(SESSION_KEY);
    renderLogin();
  }

  function renderApp() {
    var root = document.getElementById('root');
    var visibleMenus = MENU_ITEMS.filter(function (m) { return menuVisibleFor(m, state.user.department); });

    root.innerHTML =
      '<div class="app-shell">' +
      '<div class="sidebar">' +
      '<div class="sidebar-brand"><img src="assets/mascot.png" alt="" /><div class="name">Salmon Phone<small>ระบบทำสัญญา</small></div></div>' +
      visibleMenus.map(function (m) {
        return '<button class="menu-item' + (m.key === state.activeTab ? ' active' : '') + '" data-key="' + m.key + '">' +
          '<span class="icon">' + ICONS[m.icon] + '</span>' + m.label + '</button>';
      }).join('') +
      '<div class="sidebar-footer">' +
      '<div class="who">' + state.user.username + ' · ' + state.user.department + '</div>' +
      '<button class="menu-item" id="btnLogout"><span class="icon">' + ICONS.logout + '</span>ออกจากระบบ</button>' +
      '</div>' +
      '</div>' +
      '<div class="main-content"><div class="wrap"><div id="tabContent"></div></div></div>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.menu-item[data-key]'), function (btn) {
      btn.addEventListener('click', function () {
        state.activeTab = btn.getAttribute('data-key');
        renderApp();
      });
    });
    document.getElementById('btnLogout').addEventListener('click', doLogout);

    renderTabContent();
  }

  function renderTabContent() {
    var container = document.getElementById('tabContent');
    if (state.activeTab === 'for_cs') {
      // contracts-tab.js ต้องการ id ของ container ที่จะ render ใส่ ไม่ใช่ id ตายตัวว่า "app" เหมือน cs-review.html
      // ย้ายมาจาก key 'contracts' มาไว้ที่นี่ (2026-09-03 ตามที่ user ขอ) — นี่คือเครื่องมือหลักที่ CS ใช้ทำงาน
      // ทุกวัน (ค้นหา SO → ตรวจสอบ → สร้างลิงก์) จึงย้ายมาอยู่ใต้เมนู "สำหรับ CS" แทน
      container.innerHTML = '<div id="contractsTabRoot"></div>';
      initContractsTab('contractsTabRoot');
      return;
    }
    if (state.activeTab === 'upload') {
      // ตั้งค่าหัวจดหมาย ย้ายมาอยู่ที่นี่ (เดิมอยู่บนสุดของแท็บ "ข้อมูลลูกค้าทำสัญญา") — user ขอ 2026-09-03
      container.innerHTML = '<div id="letterheadSettingsRoot"></div>';
      initLetterheadSettings('letterheadSettingsRoot');
      return;
    }
    var menu = MENU_ITEMS.filter(function (m) { return m.key === state.activeTab; })[0];
    container.innerHTML =
      '<div class="placeholder-panel">' +
      '<div style="font-size:40px;margin-bottom:10px;">🚧</div>' +
      '<div style="font-weight:700;color:var(--ink);margin-bottom:4px;">' + (menu ? menu.label : '') + '</div>' +
      'ส่วนนี้ยังอยู่ระหว่างการพัฒนา ยังไม่มีขอบเขตงานที่ระบุไว้' +
      '</div>';
  }

  if (state.user) {
    renderApp();
  } else {
    renderLogin();
  }
})();

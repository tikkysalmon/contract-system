// เปิดจากลิงก์ "ดูข้อมูล CRM" ในตารางค้นหาด้วยชื่อ/รหัสลูกค้าของ contracts-tab.js (แสดงแท็บใหม่ 2026-09-08
// user ขอ) — แสดงข้อมูล SO เดียวแบบเต็ม (การ์ด "ข้อมูลจาก CRM" + ยืนยันก่อนสร้างลิงก์ + สร้างลิงก์) ใช้
// contracts-tab.js เดิมทั้งหมดผ่าน options.initialSoNumber (ดู initContractsTab) ไม่ต้องเขียนซ้ำ
var params = new URLSearchParams(location.search);
initContractsTab('app', null, { initialSoNumber: params.get('so') || '' });

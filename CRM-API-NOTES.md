# CRM API — สิ่งที่ยืนยันแล้วจริง (2026-09-03)

CRM (`crm.salmonphone.com`, "SMP | Backoffice") เป็น Next.js frontend บน Cloudflare Pages เรียก
REST/JSON API จริงที่ **`https://api.salmonphone.com`** (axios + Bearer token) — ไม่ใช่แค่หน้าเว็บ HTML
ยืนยันด้วยการล็อกอินจริงและเรียก endpoint จริงสำเร็จ (2026-09-03) โดยใช้ username/password ที่ผู้ใช้ให้มา

**อย่า commit username/password จริงลงไฟล์ใดๆ ในโปรเจกต์นี้เด็ดขาด — เก็บเป็น environment variable
(`CRM_USERNAME`, `CRM_PASSWORD`) ใน Vercel project settings เท่านั้น**

## Endpoints ที่ยืนยันแล้ว

- `POST /crm/login` — body `{"username": "...", "password": "..."}` → คืน `{"token": "<JWT>"}`
  (JWT อายุยาวประมาณ 1 ปีจาก `iat`/`exp` claim — cache ไว้ได้ ไม่ต้อง login ทุก request)
- ใช้ token: header `Authorization: Bearer <token>`
- `GET /crm/sale-order/{soNumber}` — รายละเอียดคำสั่งขาย 1 รายการ ฟิลด์ที่มี:
  `saleOrderId, initAmount, status, orderDate, productPrice, percentCredit, installmentCount,
  installmentType, paymentFrequency, paymentType[], currentInvoice{dueDate, invoiceItems[]},
  accumulatedAmount, productName ("Apple X (color Y)" รวมสีในสตริงเดียว), discounts[],
  customerId, customerFirstName, customerLastName, customerStatus, ohoUrl, saleCrmUser{...}`
- `GET /crm/customer/{customerId}` — ข้อมูลลูกค้า มี **`dateOfBirth`** ด้วย! (ที่อื่นไม่มี) รวมถึง
  `telNo, address, subDistrict, district, province, customerGroup, socialMedia, saleOrders[]`
  **ไม่มี**: เลขบัตรประชาชน, สัญชาติ — สองอย่างนี้ต้องเก็บจากลูกค้าเองผ่านฟอร์มใหม่เท่านั้น (ตามที่ออกแบบไว้)
- `GET /crm/sale-order/{soNumber}/payment-transaction?page=N` — ประวัติการจ่ายจริงทีละงวด (ไม่ใช่ตารางผ่อนที่วางแผนไว้ล่วงหน้า)
- endpoints อื่นที่เห็นในโค้ดแต่ยังไม่ได้ทดสอบเรียกจริง: `POST /crm/sale-order`, `PUT /crm/sale-order/{id}`,
  `GET /crm/sale-order/{id}/current-invoice`, `GET /crm/sale-order/{id}/transaction/re...` (ชื่อถูกตัด)

## field mapping ที่ยืนยันแล้ว — ตอบคำถาม "ดึงวิธีการผ่อนจาก CRM ได้ไหม"

**ได้ ยืนยันแล้ว** — ฟิลด์ `installmentType` คือคำตอบตรงตัว:
| ค่าจาก CRM | ความหมาย | plan_type ในระบบใหม่ |
|---|---|---|
| `FULL_PAYMENT` | ซื้อสด | **ไม่ต้องทำสัญญาผ่อน** (ตรงกับที่เคยพบใน [[project-debt-tracker-site]] ว่า "ซื้อสด" ไม่เข้าระบบติดตามหนี้) |
| `DOWN_PAYMENT` | มีวางดาวน์ | `downpayment` |
| `PARTIAL_PAY_THEN_RECEIVE` | ผ่อนก่อนรับเครื่อง (ไม่มีดาวน์) | `installment` |

## ช่องว่างที่ยังต้องยืนยันกับ user ก่อนใช้จริง

- **initAmount ไม่ใช่ยอดดาวน์จริง** — ตัวอย่างที่ดึงมาทั้ง DOWN_PAYMENT และ PARTIAL_PAY_THEN_RECEIVE
  ต่างก็มี `initAmount: 100` เท่ากันหมด (น่าจะเป็นค่าธรรมเนียมสมัครคงที่ ไม่ใช่ยอดดาวน์) —
  ยอดดาวน์จริงต้องหาฟิลด์ที่ถูกต้องอีกที (อาจต้องดูจาก payment-transaction แรกของออเดอร์ หรือถาม user
  ว่าฟิลด์ไหนคือยอดดาวน์ที่แท้จริงในหน้าเว็บ CRM) — **ห้ามเดาแล้วพิมพ์ลงสัญญาโดยไม่ตรวจสอบ** เพราะเป็นตัวเลขทางกฎหมาย
  ตอนนี้ CS ยังมีขั้นตอนตรวจทานก่อนส่งลิงก์อยู่แล้ว (โจทย์ข้อ 7) จึงพอกันพลาดได้ระดับหนึ่งในระหว่างที่ยังไม่ยืนยัน 100%
- ไม่มีฟิลด์ตารางผ่อนล่วงหน้า (12 งวด) สำเร็จรูป — ต้องคำนวณเองจาก productPrice/downPayment/installmentCount
  ด้วย `buildInstallmentSchedule()` ใน `validation.js` (ทำไว้แล้ว)
- ยังไม่ได้ทดสอบ `POST /crm/sale-order` หรือ `PUT` (ไม่จำเป็นสำหรับงานนี้ เพราะระบบใหม่แค่ "อ่าน" ข้อมูลจาก CRM ไม่เขียนกลับ)

# payment-qr

TypeScript / pnpm workspace สำหรับ PromptPay QR แบบกำหนดยอดจาก merchant backend พร้อม Lit Web Component, React wrapper และ server SDK

## เริ่มใน 5 นาที (Mock ไม่มีเงินจริง)

ต้องใช้ Node.js 24.13+ และ pnpm 11.25.0 (Node SQLite เป็น experimental API)

```powershell
pnpm install
Copy-Item .env.example .env
pnpm start
```

เปิด http://localhost:5173 กรอกยอด → สร้าง QR → แสดงเวลาถอยหลัง 2 นาที → เมื่อครบเวลา QR ถูกลบจาก Shadow DOM และแสดงหมดอายุ หน้า HTML ไม่มีปุ่มจำลองการจ่ายแล้ว ส่วน backend mock endpoint ยังใช้ใน automated tests เพื่อทดสอบ success ได้

อายุ QR ของหน้า HTML ตั้งฝั่ง backend เป็น 120 วินาที ตัวนับบนหน้าจอใช้ `payment.expiresAt` เดียวกัน ตั้ง `DEMO_EXPIRY_SECONDS` เพื่อย่นเวลาใน automated tests ได้ (Playwright ใช้ 4 วินาที)

`pnpm start` build เฉพาะ package ที่ demo ใช้ แล้วโหลด `.env` และรัน API listener (4000) กับ UI (5173) พร้อมกันใน terminal เดียว กด Ctrl+C เพื่อหยุดทั้งคู่ หากฝั่งใดหยุดหรือ port ถูกใช้อยู่ จะหยุดอีกฝั่งด้วย บน Windows สามารถดับเบิลคลิก `start-payment.cmd` ได้เช่นกัน ต้องหยุด server เดิมที่เปิดแยก terminal ก่อน

สำหรับ automated tests ติดตั้ง browser ครั้งแรกด้วย `pnpm exec playwright install chromium`

```sh
pnpm test
```

คำสั่งนี้ build ทุก package รวม Next example, typecheck, core/server tests และ Playwright Chromium (ต้องติดตั้ง browser ก่อน) browser tests ใช้ port 14000/15173 แยกจาก demo ปรับได้ด้วย E2E_API_PORT/E2E_UI_PORT

Docker: คัดลอก `.env.example` เป็น `.env` แล้ว `docker compose up --build` เปิด demo ที่ localhost:5173 ใช้ Postgres พร้อม volume ถาวร ตั้ง secret ใหม่ก่อนนำไปใช้จริง

## โครงสร้าง

| Path | หน้าที่ |
| --- | --- |
| packages/core | Payment types, state machine, integer satang, EMV TLV และ CRC |
| packages/server | Fastify, auth, SSE, repositories, providers, jobs |
| packages/web-component | Lit + Shadow DOM, client QR renderer, SSE/polling |
| packages/react | SSR-safe client wrapper และ callbacks |
| packages/sdk-js | SDK สำหรับ backend เท่านั้น |
| examples/plain-html | HTML + merchant backend ตัวอย่าง |
| examples/next-app | Next App Router + React + backend routes |

## Integrate

1. Merchant backend ใช้ `PaymentQR` พร้อม secret API key เรียก `createPayment({amountSatang: 12345}, orderId)` และคืน `{payment,clientToken}` ให้ browser หลังตรวจสิทธิ์ order ยอดเงินของสินค้าต้องอ่านจากฐานข้อมูล order ฝั่ง backend เสมอ ตัวอย่าง input เป็นการบริจาค/ยอดอิสระที่ backend ตรวจ min/max ซ้ำ
2. ให้บริการไฟล์ `packages/web-component/dist/pay-qr.js` จาก CDN/static host ของคุณ เป็น bundled ES module ที่ไม่มี external imports
3. ใส่ tag และโหลด module เพียงหนึ่งบรรทัด:

```html
<pay-qr api-base="https://payments.example.com"
  payment-id="PAYMENT_ID" client-token="SHORT_LIVED_CLIENT_TOKEN"></pay-qr>
<script type="module" src="/assets/pay-qr.js"></script>
```

สำหรับยอดอิสระใช้ `mode="input" create-payment-url="/api/create-payment" min="1" max="100000"` โดย min/max เป็นข้อความบาท (ไม่ใช้ floating point แปลงเงิน) รองรับ `theme="light|dark"`, `locale="th|en"` ค่าเริ่มต้น th

```tsx
import {PayQR} from '@payment-qr/react';
<PayQR apiBase="https://payments.example.com" paymentId={id} clientToken={token}
  onSuccess={({payment}) => console.log(payment.id)} />
```

Events: `pay:created`, `pay:success`, `pay:expired`, `pay:cancelled` มี `event.detail.payment`; `pay:error` มี `event.detail.message` ทุก event bubbles/composed จึงฟังจาก parent ได้ callbacks ของ React ได้แก่ onCreated/onSuccess/onExpired/onCancelled/onError

Next example: ตั้ง `.env.local` ใน `examples/next-app` ตาม `.env.example` (API key ห้ามใช้ NEXT_PUBLIC_) แล้ว `pnpm --filter payment-qr-next-example dev` เปิด localhost:3000 เปิด API อีก terminal ก่อน

## API / security

| Endpoint | Authorization |
| --- | --- |
| POST /v1/payments | Bearer merchant key + Idempotency-Key |
| POST /v1/payments/:id/qr | Bearer clientToken หรือ merchant key; ไม่รับ body overrides |
| GET /v1/payments/:id | Bearer clientToken หรือ merchant key |
| GET /v1/payments/:id/events | Bearer clientToken หรือ merchant key (fetch SSE) |
| POST /v1/payments/:id/cancel | Bearer clientToken หรือ merchant key |
| POST /v1/webhooks/:provider | x-signature ตรวจจาก raw JSON bytes |
| POST /dev/mock/:id/pay | Bearer merchant key; เฉพาะ ENABLE_MOCK=true |

Create body: `{ "amountSatang": 12345, "provider": "mock", "expiresInSeconds": 300 }` จำนวนเงินต้องเป็น positive safe integer สูงสุด 99999999999 สตางค์ อายุ 1–900 วินาที API ไม่รับการเปลี่ยนยอดหลัง create การใช้ idempotency key ซ้ำกับ request ต่างกันได้ 409; key เดิมคืน payment เดิมและ token ใหม่ที่มีอายุจำกัด

เก็บ SHA-256 ของ merchant API key ใน DB (ใช้ key สุ่ม entropy สูง) clientToken เป็น HMAC-signed capability ผูก paymentId/merchantId อายุสูงสุด 15 นาทีและไม่เกิน expiry+60s; token ไม่มีใน query string SSE ใช้ fetch stream โดยส่ง Authorization header เป็นหลัก หาก stream ล้มเหลวใช้ polling ทุก 2 วินาที local expiry ยังลบ QR แม้ network ขาด การเปลี่ยนสถานะ paid ต้องรอข้อมูลจาก server

ทุก browser request ตรวจ Origin allowlist ของ merchant; CORS ไม่ใช้แทน auth. Rate limit 120 requests/min/IP ต่อ instance อย่าวาง API key ใน browser. Production ต้องใช้ HTTPS, shared edge rate limiting เมื่อ scale หลาย instance, provisioning merchant และ secrets ผ่านระบบของคุณ ปัจจุบัน main.ts bootstrap merchant demo หนึ่งราย แต่ repository รองรับหลาย merchant

`pending → qr_ready → paid` และ pending/qr_ready → expired/cancelled; terminal เปลี่ยนกลับไม่ได้ optimistic version CAS ป้องกัน race พร้อม transaction บันทึก webhook event และสถานะ atomically ตรวจ signature ก่อน parse แล้วเทียบ provider/ref/amount/currency ก่อน paid webhook ซ้ำไม่เปลี่ยนผล QR payload ถูกล้างจาก DB เมื่อ terminal

Expire/reconcile ทำงานทุก 30 วินาที (read API และ SSE ตรวจ expiry ด้วย) reconcile อ่านสถานะจาก provider server-to-server และผ่านการเทียบยอดเหมือน webhook SSE ส่ง snapshot ทันที และตรวจ DB ทุกวินาทีเพื่อเห็นการเปลี่ยนแปลงจาก instance อื่น

SQLite dev ใช้ built-in node:sqlite; `DATABASE_URL` สลับเป็น Postgres สร้างตารางแบบ idempotent ตอนเริ่มระบบ schema อยู่ใน repository.ts ไม่มี migration framework สำหรับ schema upgrades

## ขอบเขตของ PromptPay / provider

Payload ใช้ 00=01, 01=12 (dynamic), 29 (AID A000000677010111 + phone/ID), 53=764, 54=ยอดบาททศนิยมสองตำแหน่ง, 58=TH, 63=CRC16-CCITT-FALSE ดู [EMVCo QR specifications](https://www.emvco.com/emv-technologies/qr-codes/) การเก็บ raw body ใช้ [Fastify buffer parser](https://fastify.dev/docs/latest/Reference/ContentTypeParser/)

MockProvider สร้าง PromptPay payload สำหรับทดสอบเท่านั้น ไม่สามารถตรวจยอดรับเงินจริงได้ รหัส dynamic และยอดใน QR ไม่รับประกันว่าทุก banking app ห้ามผู้จ่ายแก้ยอด และลบ DOM ไม่สามารถเพิกถอนภาพ QR ที่ถ่ายไว้แล้วได้ ระบบจะไม่ mark paid หากยอดไม่ตรงหรือ payment หมดอายุ การ enforce charge/expiry ที่ธนาคารจริงต้องใช้ provider ที่รองรับ

OmiseProvider เป็นโครง TODO ที่ fail closed และยังไม่พร้อมรับเงินจริง ต้อง implement create charge/QR, verification ตามกลไกของบัญชี Omise จริง และ retrieve charge/status ก่อนใช้งาน อย่าเปิด production จนผ่าน sandbox/UAT ของ provider และกำหนดขั้นตอนจัดการ late/under/over payments และ refund แล้ว

การทดสอบอัตโนมัติครอบคลุม Mock + SQLite และ browser; Postgres ใช้ integration contract เพิ่มได้เมื่อมีฐานทดสอบ (ดู `TEST_DATABASE_URL`) Docker/เงินจริงต้องทดสอบใน environment ที่จะ deploy แยกต่างหาก

import { PaymentQR } from '@payment-qr/sdk-js';
export async function POST(request: Request) { const { amountSatang } = await request.json(); if (!Number.isSafeInteger(amountSatang) || amountSatang < 100 || amountSatang > 10000000)
    return Response.json({ error: 'Invalid amount' }, { status: 400 }); const apiKey = process.env.MERCHANT_API_KEY; if (!apiKey)
    throw new Error('MERCHANT_API_KEY required'); const sdk = new PaymentQR({ apiBase: process.env.API_BASE ?? 'http://localhost:4000', apiKey }); return Response.json(await sdk.createPayment({ amountSatang }, request.headers.get('Idempotency-Key') ?? crypto.randomUUID())); }

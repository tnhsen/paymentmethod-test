import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PaymentQR } from '@payment-qr/sdk-js';
const app = Fastify();
const base = process.env.API_BASE ?? 'http://localhost:4000';
const apiKey = process.env.MERCHANT_API_KEY;
if (!apiKey)
    throw new Error('MERCHANT_API_KEY required');
const sdk = new PaymentQR({ apiBase: base, apiKey });
const files: Record<string, [
    URL,
    string
]> = { '/': [new URL('./index.html', import.meta.url), 'text/html'], '/checkout.js': [new URL('./checkout.js', import.meta.url), 'application/javascript'], '/pay-qr.js': [new URL('../../packages/web-component/dist/pay-qr.js', import.meta.url), 'application/javascript'] };
for (const [path, [file, type]] of Object.entries(files))
    app.get(path, async (_req, reply) => {
        let content = await readFile(fileURLToPath(file));
        if (path === '/' && process.env.PUBLIC_API_BASE) {
            const url = new URL(process.env.PUBLIC_API_BASE);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid PUBLIC_API_BASE');
            content = Buffer.from(content.toString().replace('api-base="http://localhost:4000"', `api-base="${url.origin}"`));
        }
        return reply.type(type).send(content);
    });
app.post('/api/create-payment', async (req, reply) => { const b = req.body as {
    amountSatang?: number;
}; if (!Number.isSafeInteger(b.amountSatang) || b.amountSatang! < 100 || b.amountSatang! > 10000000)
    return reply.code(400).send({ error: 'Amount out of range' }); return sdk.createPayment({ amountSatang: b.amountSatang!, expiresInSeconds: Number(process.env.DEMO_EXPIRY_SECONDS ?? 120) }, String(req.headers['idempotency-key'] ?? crypto.randomUUID())); });
// Demo backend only. A real checkout must look up its order price server-side,
// authorize the customer and add CSRF protection for cookie-authenticated routes.
app.post<{
    Params: {
        id: string;
    };
}>('/api/mock-pay/:id', async (req, reply) => { const r = await fetch(base + '/dev/mock/' + encodeURIComponent(req.params.id) + '/pay', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` } }); return reply.code(r.status).type('application/json').send(await r.text()); });
await app.listen({ port: Number(process.env.DEMO_PORT ?? 5173), host: process.env.HOST ?? '127.0.0.1' });

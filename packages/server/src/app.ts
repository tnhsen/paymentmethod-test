import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertAmount, isTerminal, transition, type Payment } from '@payment-qr/core';
import type { PaymentRepository, Merchant } from './repository.js';
import { MockProvider, type PaymentProvider, type ProviderEvent } from './providers.js';
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export interface AppOptions {
    repo: PaymentRepository;
    providers: PaymentProvider[];
    tokenSecret: string;
    enableMock?: boolean;
    jobs?: boolean;
    now?: () => number;
}
const fail = (code: number, message: string) => Object.assign(new Error(message), { statusCode: code });
export async function buildApp(options: AppOptions) {
    const { repo, tokenSecret } = options;
    const now = options.now ?? Date.now;
    if (tokenSecret.length < 32)
        throw new Error('TOKEN_SECRET must have at least 32 characters');
    await repo.init();
    const app = Fastify({ logger: false, bodyLimit: 65536 });
    const providers = new Map(options.providers.map(p => [p.name, p]));
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
    app.get('/health', async () => ({ ok: true }));
    const queues = new Map<string, Promise<unknown>>();
    async function locked<T>(id: string, work: () => Promise<T>): Promise<T> { const old = queues.get(id) ?? Promise.resolve(); const task = old.catch(() => { }).then(work); queues.set(id, task); try {
        return await task;
    }
    finally {
        if (queues.get(id) === task)
            queues.delete(id);
    } }
    function body(req: any) { try {
        return JSON.parse((req.body as Buffer)?.toString() ?? '{}');
    }
    catch {
        throw fail(400, 'Invalid JSON');
    } }
    const sign = (value: string) => createHmac('sha256', tokenSecret).update(value).digest('base64url');
    function token(p: Payment) { const value = Buffer.from(JSON.stringify({ paymentId: p.id, merchantId: p.merchantId, exp: Math.min(p.expiresAt + 60000, now() + 900000) })).toString('base64url'); return value + '.' + sign(value); }
    function validToken(value: string, p: Payment) { try {
        const [data, sig, ...rest] = value.split('.');
        if (rest.length || !sig || sig.length !== sign(data).length || !timingSafeEqual(Buffer.from(sig), Buffer.from(sign(data))))
            return false;
        const c = JSON.parse(Buffer.from(data, 'base64url').toString());
        return c.paymentId === p.id && c.merchantId === p.merchantId && c.exp > now();
    }
    catch {
        return false;
    } }
    const view = (p: Payment) => ({ ...p, qrPayload: p.status === 'qr_ready' ? p.qrPayload : null });
    const listeners = new Map<string, Set<(p: Payment) => void>>();
    function publish(p: Payment) { for (const listener of listeners.get(p.id) ?? [])
        listener(view(p)); }
    async function expire(p: Payment) { if (!isTerminal(p.status) && p.expiresAt <= now()) {
        const next = transition(p, 'expired');
        if (await repo.save(next, p.version)) {
            publish(next);
            return next;
        }
        return (await repo.get(p.id))!;
    } return p; }
    async function get(id: string) { const p = await repo.get(id); if (!p)
        throw fail(404, 'Payment not found'); return p; }
    async function merchantAuth(req: any) { const auth = req.headers.authorization ?? ''; if (!auth.startsWith('Bearer '))
        throw fail(401, 'Merchant API key required'); const m = await repo.merchantByHash(hashKey(auth.slice(7))); if (!m)
        throw fail(401, 'Invalid API key'); return m; }
    function checkOrigin(req: any, reply: any, m: Merchant) { const origin = req.headers.origin; if (origin) {
        if (!m.origins.includes(origin))
            throw fail(403, 'Origin not allowed');
        reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    } }
    async function paymentAuth(req: any, reply: any, p: Payment) { const auth = req.headers.authorization ?? ''; const m = (await repo.merchant(p.merchantId))!; if (!m)
        throw fail(401, 'Unknown merchant'); if (!validToken(auth.replace(/^Bearer /, ''), p)) {
        const owner = await merchantAuth(req);
        if (owner.id !== p.merchantId)
            throw fail(403, 'Wrong merchant');
    } checkOrigin(req, reply, m); }
    app.options('/v1/*', async (req, reply) => { const origin = req.headers.origin; if (!origin)
        throw fail(403, 'Origin required'); const match = req.url.match(/^\/v1\/payments\/([^/?]+)/); if (match) {
        const p = await get(decodeURIComponent(match[1]));
        const m = (await repo.merchant(p.merchantId))!;
        checkOrigin(req, reply, m);
    }
    else if (!await repo.originAllowed(origin))
        throw fail(403, 'Origin not allowed'); reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin').header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').header('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key').header('Access-Control-Max-Age', '300'); return reply.code(204).send(); });
    app.post('/v1/payments', async (req, reply) => {
        const m = await merchantAuth(req);
        checkOrigin(req, reply, m);
        const b = body(req);
        if (Object.keys(b).some(k => !['amountSatang', 'provider', 'expiresInSeconds'].includes(k)))
            throw fail(400, 'Unknown payment fields');
        try {
            assertAmount(b.amountSatang);
        }
        catch {
            throw fail(400, 'amountSatang must be a positive integer');
        }
        const provider = b.provider ?? 'mock';
        if (!providers.has(provider) || (provider === 'mock' && !options.enableMock))
            throw fail(400, 'Provider unavailable');
        const ttl = b.expiresInSeconds ?? 300;
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 900)
            throw fail(400, 'Expiry must be 1..900 seconds');
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !key || key.length > 128)
            throw fail(400, 'Idempotency-Key required (1..128 characters)');
        const fingerprint = hashKey(JSON.stringify([b.amountSatang, provider, ttl]));
        const p: Payment = { id: randomUUID(), merchantId: m.id, amountSatang: b.amountSatang, currency: 'THB', provider, status: 'pending', providerRef: null, qrPayload: null, createdAt: now(), expiresAt: now() + ttl * 1000, version: 0 };
        const result = await repo.create(p, key, fingerprint);
        if (result.fingerprint !== fingerprint)
            throw fail(409, 'Idempotency key reused with different request');
        return reply.code(result.payment.id === p.id ? 201 : 200).send({ payment: view(await expire(result.payment)), clientToken: token(result.payment) });
    });
    app.get<{
        Params: {
            id: string;
        };
    }>('/v1/payments/:id', async (req, reply) => { const p = await get(req.params.id); await paymentAuth(req, reply, p); return view(await locked(p.id, async () => expire(await get(p.id)))); });
    app.post<{
        Params: {
            id: string;
        };
    }>('/v1/payments/:id/qr', async (req, reply) => {
        const original = await get(req.params.id);
        await paymentAuth(req, reply, original);
        if (req.body && Object.keys(body(req)).length)
            throw fail(400, 'QR endpoint accepts no amount or overrides');
        return locked(original.id, async () => { const p = await expire(await get(original.id)); if (isTerminal(p.status))
            throw fail(409, 'Payment is terminal'); if (p.status === 'qr_ready')
            return view(p); const qr = await providers.get(p.provider)!.createQr(p); if (!qr.qrPayload || !qr.providerRef)
            throw fail(502, 'Invalid provider QR'); const next = { ...transition(p, 'qr_ready'), ...qr }; if (next.expiresAt <= now()) {
            await expire(p);
            throw fail(409, 'Payment expired');
        } if (!await repo.save(next, p.version))
            throw fail(409, 'Concurrent update; retry'); publish(next); return view(next); });
    });
    app.post<{
        Params: {
            id: string;
        };
    }>('/v1/payments/:id/cancel', async (req, reply) => { const original = await get(req.params.id); await paymentAuth(req, reply, original); return locked(original.id, async () => { const p = await expire(await get(original.id)); if (isTerminal(p.status))
        return view(p); const next = transition(p, 'cancelled'); if (!await repo.save(next, p.version))
        throw fail(409, 'Concurrent update'); publish(next); return view(next); }); });
    app.get<{
        Params: {
            id: string;
        };
    }>('/v1/payments/:id/events', async (req, reply) => {
        const p = await get(req.params.id);
        await paymentAuth(req, reply, p);
        const usesClientToken = validToken((req.headers.authorization ?? '').replace(/^Bearer /, ''), p);
        // Authorization stays in a header: tokens never enter URLs or access logs.
        const headers: Record<string, string> = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' };
        if (req.headers.origin) {
            headers['Access-Control-Allow-Origin'] = req.headers.origin;
            headers.Vary = 'Origin';
        }
        reply.hijack();
        reply.raw.writeHead(200, headers);
        let version = -1;
        let timer: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => { clearInterval(timer); listeners.get(p.id)?.delete(send); if (!listeners.get(p.id)?.size)
            listeners.delete(p.id); };
        const send = (next: Payment) => { if (reply.raw.destroyed)
            return; if (next.version !== version) {
            version = next.version;
            reply.raw.write(`id: ${next.version}\nevent: payment\ndata: ${JSON.stringify(view(next))}\n\n`);
        } if (isTerminal(next.status)) {
            cleanup();
            reply.raw.end();
        } };
        const set = listeners.get(p.id) ?? new Set();
        set.add(send);
        listeners.set(p.id, set);
        req.raw.on('close', cleanup);
        reply.raw.on('close', cleanup);
        timer = setInterval(() => { void locked(p.id, async () => { if (usesClientToken && !validToken((req.headers.authorization ?? '').replace(/^Bearer /, ''), p)) {
            cleanup();
            reply.raw.end();
            return;
        } const current = await expire(await get(p.id)); send(current); if (!reply.raw.writableEnded)
            reply.raw.write(': heartbeat\n\n'); }).catch(() => { cleanup(); reply.raw.end(); }); }, 1000);
        send(await locked(p.id, async () => expire(await get(p.id))));
    });
    async function apply(provider: string, event: ProviderEvent) {
        return locked(event.paymentId, async () => {
            const p = await expire(await get(event.paymentId));
            if (p.provider !== provider || p.providerRef !== event.providerRef || p.amountSatang !== event.amountSatang || event.currency !== 'THB')
                throw fail(409, 'Webhook payment, reference, currency or amount mismatch');
            if (isTerminal(p.status))
                return view(p);
            if (event.status !== 'paid')
                return view(p);
            if (p.status !== 'qr_ready')
                throw fail(409, 'QR not ready');
            const next = transition(p, 'paid');
            const result = await repo.applyEvent(provider, event.eventId, next, p.version);
            if (result === 'conflict')
                throw fail(409, 'Concurrent update; retry webhook');
            if (result === 'applied')
                publish(next);
            return view((await repo.get(p.id))!);
        });
    }
    app.post<{
        Params: {
            provider: string;
        };
    }>('/v1/webhooks/:provider', async (req) => { const provider = providers.get(req.params.provider); if (!provider)
        throw fail(404, 'Unknown provider'); const raw = req.body as Buffer; if (!Buffer.isBuffer(raw) || !await provider.verifyWebhook(raw, String(req.headers['x-signature'] ?? '')))
        throw fail(401, 'Invalid signature'); let event: ProviderEvent; try {
        event = provider.parseWebhook(raw);
    }
    catch {
        throw fail(400, 'Invalid webhook');
    } return apply(provider.name, event); });
    if (options.enableMock)
        app.post<{
            Params: {
                id: string;
            };
        }>('/dev/mock/:id/pay', async (req, reply) => { const p = await get(req.params.id); const m = await merchantAuth(req); if (m.id !== p.merchantId)
            throw fail(403, 'Wrong merchant'); checkOrigin(req, reply, m); const provider = providers.get('mock'); if (!(provider instanceof MockProvider) || p.provider !== 'mock')
            throw fail(400, 'Not mock'); const event: ProviderEvent = { eventId: 'mock-paid-' + p.id, paymentId: p.id, providerRef: p.id, amountSatang: p.amountSatang, currency: 'THB', status: 'paid' }; provider.record(event); const raw = Buffer.from(JSON.stringify(event)); const response = await app.inject({ method: 'POST', url: '/v1/webhooks/mock', headers: { 'content-type': 'application/json', 'x-signature': provider.sign(raw) }, payload: raw }); return reply.code(response.statusCode).type('application/json').send(response.body); });
    async function expireJob() { for (const p of await repo.active())
        await locked(p.id, async () => expire(await get(p.id))); }
    async function reconcile() { for (const p of await repo.active())
        try {
            if (p.status !== 'qr_ready')
                continue;
            const event = await providers.get(p.provider)!.getStatus(p);
            if (event)
                await apply(p.provider, event);
        }
        catch (e) {
            app.log.error(e, 'Reconcile failed');
        } }
    let busy = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    if (options.jobs !== false) {
        timers.push(setInterval(() => { if (busy)
            return; busy = true; void expireJob().then(reconcile).catch(e => app.log.error(e)).finally(() => { busy = false; }); }, 30000));
        timers.forEach(t => t.unref());
    }
    app.addHook('onClose', async () => { timers.forEach(clearInterval); await repo.close(); });
    return { app, expireJob, reconcile };
}

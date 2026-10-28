import { it, expect } from 'vitest';
import { PostgresRepository } from './repository.js';
import { transition, type Payment } from '@payment-qr/core';
// Explicit opt-in: supply a disposable test DB. Does not truncate shared data.
it.skipIf(!process.env.TEST_DATABASE_URL)('Postgres repository persists idempotency and atomic webhook CAS', async () => {
    const repo = new PostgresRepository(process.env.TEST_DATABASE_URL!);
    await repo.init();
    const id = crypto.randomUUID();
    const p: Payment = { id, merchantId: id, amountSatang: 12345, currency: 'THB', status: 'pending', provider: 'mock', providerRef: id, qrPayload: 'payload', createdAt: Date.now(), expiresAt: Date.now() + 300000, version: 0 };
    try {
        await repo.putMerchant({ id, keyHash: id, origins: ['http://test'] });
        expect((await repo.create(p, 'order', 'fingerprint')).payment.id).toBe(id);
        expect((await repo.create({ ...p, id: crypto.randomUUID() }, 'order', 'fingerprint')).payment.id).toBe(id);
        const ready = transition(p, 'qr_ready');
        expect(await repo.save(ready, 0)).toBe(true);
        expect(await repo.save(ready, 0)).toBe(false);
        const paid = transition(ready, 'paid');
        expect(await repo.applyEvent('mock', id, paid, 1)).toBe('applied');
        expect(await repo.applyEvent('mock', id, paid, 1)).toBe('duplicate');
        expect((await repo.get(id))!.qrPayload).toBeNull();
    }
    finally {
        await repo.pool.query('DELETE FROM webhook_events WHERE event_id=$1', [id]);
        await repo.pool.query('DELETE FROM payments WHERE merchant_id=$1', [id]);
        await repo.pool.query('DELETE FROM merchants WHERE id=$1', [id]);
        await repo.close();
    }
});

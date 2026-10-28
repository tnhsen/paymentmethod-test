import { describe, it, expect } from 'vitest';
import { assertAmount, parseBaht, crc16, buildPromptPayPayload, transition, type Payment } from './index.js';
const payment: Payment = { id: 'p', merchantId: 'm', amountSatang: 12345, currency: 'THB', status: 'pending', provider: 'mock', providerRef: null, qrPayload: 'secret', createdAt: 0, expiresAt: 1000, version: 0 };
describe('core', () => {
    it('stores exact integer satang', () => { expect(parseBaht('0.29')).toBe(29); expect(parseBaht('123.45')).toBe(12345); for (const n of [0, -1, NaN, 1.1, Number.MAX_SAFE_INTEGER])
        expect(() => assertAmount(n)).toThrow(); for (const s of ['1e3', '1.234', '-1', '0'])
        expect(() => parseBaht(s)).toThrow(); });
    it('has a known CRC-CCITT-FALSE vector', () => expect(crc16('123456789')).toBe('29B1'));
    it('encodes dynamic phone payload, currency, amount and CRC', () => { const qr = buildPromptPayPayload('0812345678', 12345); expect(qr).toBe('00020101021229370016A0000006770101110113006681234567853037645406123.455802TH6304' + crc16('00020101021229370016A0000006770101110113006681234567853037645406123.455802TH6304')); expect(buildPromptPayPayload('1234567890123', 1)).toContain('02131234567890123530376454040.01'); expect(() => buildPromptPayPayload('x', 100)).toThrow(); });
    it('rejects terminal transitions and erases payload', () => { const ready = transition(payment, 'qr_ready'); const paid = transition(ready, 'paid'); expect(paid.qrPayload).toBeNull(); for (const terminal of ['paid', 'expired', 'cancelled'] as const)
        for (const target of ['pending', 'qr_ready', 'paid', 'expired', 'cancelled'] as const)
            expect(() => transition({ ...payment, status: terminal }, target)).toThrow(); expect(() => transition(payment, 'paid')).toThrow(); });
});

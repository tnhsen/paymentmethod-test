import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildPromptPayPayload, type Payment } from '@payment-qr/core';
export interface ProviderEvent {
    eventId: string;
    paymentId: string;
    providerRef: string;
    amountSatang: number;
    currency: string;
    status: 'paid' | 'pending';
}
export interface PaymentProvider {
    name: string;
    createQr(payment: Payment): Promise<{
        providerRef: string;
        qrPayload: string;
    }>;
    verifyWebhook(raw: Buffer, signature: string): Promise<boolean>;
    parseWebhook(raw: Buffer): ProviderEvent;
    getStatus(payment: Payment): Promise<ProviderEvent | null>;
}
export class MockProvider implements PaymentProvider {
    name = 'mock';
    private statuses = new Map<string, ProviderEvent>();
    constructor(private secret: string, private target = '0812345678') { }
    async createQr(p: Payment) { return { providerRef: p.id, qrPayload: buildPromptPayPayload(this.target, p.amountSatang) }; }
    sign(raw: Buffer) { return createHmac('sha256', this.secret).update(raw).digest('hex'); }
    async verifyWebhook(raw: Buffer, signature: string) { if (!/^[a-f0-9]{64}$/.test(signature))
        return false; return timingSafeEqual(Buffer.from(this.sign(raw), 'hex'), Buffer.from(signature, 'hex')); }
    parseWebhook(raw: Buffer): ProviderEvent { const e = JSON.parse(raw.toString()); if (typeof e.eventId !== 'string' || !e.eventId || typeof e.paymentId !== 'string' || typeof e.providerRef !== 'string' || !Number.isSafeInteger(e.amountSatang) || !['paid', 'pending'].includes(e.status) || typeof e.currency !== 'string')
        throw new Error('Invalid webhook'); return e; }
    record(event: ProviderEvent) { this.statuses.set(event.paymentId, event); }
    async getStatus(p: Payment) { return this.statuses.get(p.id) ?? null; }
}
/** Generates a real transfer QR, but has no automatic bank confirmation. */
export class DirectPromptPayProvider implements PaymentProvider {
    name = 'promptpay';
    constructor(private target: string) { buildPromptPayPayload(target, 100); }
    async createQr(p: Payment) { return { providerRef: p.id, qrPayload: buildPromptPayPayload(this.target, p.amountSatang) }; }
    async verifyWebhook(_raw: Buffer, _signature: string) { return false; }
    parseWebhook(_raw: Buffer): ProviderEvent { throw new Error('Direct PromptPay has no verified webhook'); }
    async getStatus(_p: Payment): Promise<ProviderEvent | null> { return null; }
}
export class OmiseProvider implements PaymentProvider {
    name = 'omise';
    // TODO: create PromptPay source + charge using server secret; bind charge ID,
    // amount and expiry. Store provider charge ID and decode provider QR payload.
    async createQr(_p: Payment): Promise<{
        providerRef: string;
        qrPayload: string;
    }> { throw new Error('TODO: Omise createQr'); }
    // TODO: implement the authentication mechanism documented for your Omise
    // account. Do not assume HMAC support. Retrieve and verify the event/charge
    // from Omise server-to-server before accepting an event. Fail closed meanwhile.
    async verifyWebhook(_raw: Buffer, _signature: string) { return false; }
    parseWebhook(_raw: Buffer): ProviderEvent { throw new Error('TODO: Omise event normalization'); }
    async getStatus(_p: Payment): Promise<ProviderEvent | null> { throw new Error('TODO: Omise charge retrieval'); }
}

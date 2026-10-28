export type PaymentStatus = 'pending' | 'qr_ready' | 'paid' | 'expired' | 'cancelled';
export interface Payment {
    id: string;
    merchantId: string;
    amountSatang: number;
    currency: 'THB';
    status: PaymentStatus;
    provider: string;
    providerRef: string | null;
    qrPayload: string | null;
    createdAt: number;
    expiresAt: number;
    version: number;
}
export const isTerminal = (status: PaymentStatus) => ['paid', 'expired', 'cancelled'].includes(status);
export function transition(payment: Payment, status: PaymentStatus): Payment {
    if (isTerminal(payment.status))
        throw new Error('Terminal payment is immutable');
    const allowed: Record<string, string[]> = { pending: ['qr_ready', 'expired', 'cancelled'], qr_ready: ['paid', 'expired', 'cancelled'] };
    if (!allowed[payment.status]?.includes(status))
        throw new Error('Invalid transition');
    return { ...payment, status, qrPayload: isTerminal(status) ? null : payment.qrPayload, version: payment.version + 1 };
}
export function assertAmount(value: unknown): asserts value is number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 99999999999)
        throw new Error('Invalid amountSatang');
}
export function parseBaht(value: string): number {
    if (!/^\d+(\.\d{1,2})?$/.test(value))
        throw new Error('Use at most 2 decimal places');
    const [baht, fraction = ''] = value.split('.');
    const amount = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
    assertAmount(amount);
    return amount;
}
export function crc16(value: string): string {
    let crc = 0xffff;
    for (const byte of new TextEncoder().encode(value)) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++)
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (tag: string, value: string) => { if (value.length > 99)
    throw new Error('TLV too long'); return tag + String(value.length).padStart(2, '0') + value; };
export function buildPromptPayPayload(target: string, amountSatang: number): string {
    assertAmount(amountSatang);
    const digits = target.replace(/[ -]/g, '');
    let account: string;
    if (/^0\d{9}$/.test(digits))
        account = tlv('01', '0066' + digits.slice(1));
    else if (/^\d{13}$/.test(digits))
        account = tlv('02', digits);
    else
        throw new Error('PromptPay ID must be a Thai phone or 13 digit ID');
    const amount = Math.floor(amountSatang / 100) + '.' + String(amountSatang % 100).padStart(2, '0');
    const data = tlv('00', '01') + tlv('01', '12') + tlv('29', tlv('00', 'A000000677010111') + account) + tlv('53', '764') + tlv('54', amount) + tlv('58', 'TH') + '6304';
    return data + crc16(data);
}

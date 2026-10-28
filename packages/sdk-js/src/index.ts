import { assertAmount, type Payment } from '@payment-qr/core';
export interface CreatePayment {
    amountSatang: number;
    provider?: string;
    expiresInSeconds?: number;
}
/** Server only. Never put a merchant key in a browser bundle. */
export class PaymentQR {
    constructor(private options: {
        apiBase: string;
        apiKey: string;
    }) { }
    async createPayment(input: CreatePayment, idempotencyKey: string): Promise<{
        payment: Payment;
        clientToken: string;
    }> {
        assertAmount(input.amountSatang);
        const response = await fetch(this.options.apiBase.replace(/\/$/, '') + '/v1/payments', { method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) });
        if (!response.ok)
            throw new Error(`Payment API ${response.status}: ${await response.text()}`);
        return response.json();
    }
}

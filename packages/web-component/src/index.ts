import { LitElement, html, css, nothing } from 'lit';
import QRCode from 'qrcode';
import { parseBaht, isTerminal, type Payment } from '@payment-qr/core';
type UIState = 'input' | 'loading' | 'qr' | 'success' | 'expired' | 'error' | 'cancelled';
export class PayQRElement extends LitElement {
    static properties = { apiBase: { attribute: 'api-base' }, paymentId: { attribute: 'payment-id' }, clientToken: { attribute: 'client-token' }, mode: {}, createPaymentUrl: { attribute: 'create-payment-url' }, min: {}, max: {}, theme: { reflect: true }, locale: {} };
    apiBase = '';
    paymentId = '';
    clientToken = '';
    mode = 'fixed';
    createPaymentUrl = '';
    min = '1';
    max = '100000';
    theme = 'light';
    locale = 'th';
    private state: UIState = 'loading';
    private error = '';
    private payload: string | null = null;
    private image: string | null = null;
    private amount = '';
    private payment: Payment | null = null;
    private abort?: AbortController;
    private expiry?: ReturnType<typeof setTimeout>;
    private poll?: ReturnType<typeof setTimeout>;
    private epoch = 0;
    private creating = false;
    static styles = css `:host{display:block;font:16px system-ui;color:#162235;max-width:360px}:host([theme=dark]){color:#edf2ff}.box{border:1px solid #acb9ca;border-radius:16px;padding:24px;text-align:center}img{display:block;width:256px;height:256px;max-width:100%;margin:12px auto}input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #8797ab;max-width:100%;box-sizing:border-box}button{cursor:pointer;margin-top:12px;background:#195bd7;color:white}button.save{background:#15803d;border-color:#15803d}button.save:hover{background:#166534}button.cancel{background:#dc2626;border-color:#dc2626}button.cancel:hover{background:#b91c1c}button:focus-visible{outline:3px solid #162235;outline-offset:3px}label{display:grid;gap:8px}p{overflow-wrap:anywhere}[role=alert]{color:#c33}`;
    connectedCallback() { super.connectedCallback(); queueMicrotask(() => { if (this.isConnected)
        this.reset(); }); }
    disconnectedCallback() { this.stop(); this.clearQr(); super.disconnectedCallback(); }
    protected updated(changed: Map<PropertyKey, unknown>) { if (['apiBase', 'paymentId', 'clientToken', 'mode', 'createPaymentUrl'].some(k => changed.has(k)) && !this.creating)
        this.reset(); }
    private emit(name: string, detail: unknown) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }
    private clearQr() { this.payload = null; this.image = null; this.shadowRoot?.querySelector('[data-qr]')?.remove(); if (this.payment)
        this.payment = { ...this.payment, qrPayload: null }; }
    private stop() { this.epoch++; this.abort?.abort(); clearTimeout(this.expiry); clearTimeout(this.poll); }
    private reset() { this.stop(); this.clearQr(); this.payment = null; this.error = ''; if (this.paymentId && this.clientToken && this.apiBase) {
        void this.load();
    }
    else {
        this.state = this.mode === 'input' ? 'input' : 'loading';
        this.requestUpdate();
    } }
    private headers() { return { Authorization: `Bearer ${this.clientToken}` }; }
    private url(suffix = '') { return this.apiBase.replace(/\/$/, '') + '/v1/payments/' + encodeURIComponent(this.paymentId) + suffix; }
    private async json(url: string, init: RequestInit = {}) { const r = await fetch(url, { ...init, headers: { ...this.headers(), ...init.headers }, signal: this.abort?.signal }); if (!r.ok)
        throw new Error(`Payment API (${r.status})`); return r.json(); }
    private failure(error: unknown) { this.stop(); this.clearQr(); this.state = 'error'; this.error = error instanceof Error ? error.message : 'Payment error'; this.emit('pay:error', { message: this.error }); this.requestUpdate(); }
    private async load() { this.stop(); const epoch = this.epoch; this.abort = new AbortController(); this.state = 'loading'; this.requestUpdate(); try {
        const existing: Payment = await this.json(this.url());
        if (epoch !== this.epoch)
            return;
        if (isTerminal(existing.status)) {
            await this.accept(existing, epoch);
            return;
        }
        const p: Payment = await this.json(this.url('/qr'), { method: 'POST' });
        await this.accept(p, epoch);
        if (epoch === this.epoch && !isTerminal(p.status))
            void this.stream(epoch);
    }
    catch (e) {
        if (epoch === this.epoch)
            this.failure(e);
    } }
    private async accept(p: Payment, epoch: number) {
        if (epoch !== this.epoch || p.id !== this.paymentId)
            return;
        if (this.payment?.id === p.id && (isTerminal(this.payment.status) || p.version < this.payment.version))
            return;
        this.payment = p;
        if (isTerminal(p.status)) {
            this.clearQr();
            this.stop();
            this.state = p.status === 'paid' ? 'success' : p.status === 'expired' ? 'expired' : 'cancelled';
            this.requestUpdate();
            this.emit(p.status === 'paid' ? 'pay:success' : p.status === 'expired' ? 'pay:expired' : 'pay:cancelled', { payment: { ...p, qrPayload: null } });
            return;
        }
        clearTimeout(this.expiry);
        const remaining = p.expiresAt - Date.now();
        if (remaining <= 0) {
            this.localExpiry();
            return;
        }
        this.expiry = setTimeout(() => this.localExpiry(), remaining);
        if (p.qrPayload && p.status === 'qr_ready') {
            this.payload = p.qrPayload;
            const image = await QRCode.toDataURL(p.qrPayload, { width: 256, margin: 2, errorCorrectionLevel: 'M' });
            if (epoch !== this.epoch || !this.payload || this.payment?.status !== 'qr_ready')
                return;
            this.image = image;
            this.state = 'qr';
            this.requestUpdate();
        }
    }
    private localExpiry() { this.clearQr(); this.stop(); this.state = 'expired'; this.requestUpdate(); this.emit('pay:expired', { payment: this.payment }); }
    private async stream(epoch: number) {
        try {
            const r = await fetch(this.url('/events'), { headers: this.headers(), signal: this.abort?.signal });
            if (!r.ok || !r.body)
                throw new Error('SSE unavailable');
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
                while (epoch === this.epoch) {
                    const chunk = await reader.read();
                    if (chunk.done)
                        break;
                    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
                    let index;
                    while ((index = buffer.indexOf('\n\n')) >= 0) {
                        const frame = buffer.slice(0, index);
                        buffer = buffer.slice(index + 2);
                        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
                        if (data)
                            await this.accept(JSON.parse(data), epoch);
                    }
                }
            }
            finally {
                await reader.cancel().catch(() => { });
            }
        }
        catch { /* Network/proxy failures use authenticated polling. */ }
        finally {
            if (epoch === this.epoch)
                this.schedulePoll(epoch);
        }
    }
    private schedulePoll(epoch: number) { this.poll = setTimeout(async () => { if (epoch !== this.epoch)
        return; try {
        await this.accept(await this.json(this.url()), epoch);
    }
    catch { /* Keep expiry timer active during network failure. */ } if (epoch === this.epoch)
        this.schedulePoll(epoch); }, 2000); }
    private async create(event: Event) {
        event.preventDefault();
        if (this.creating)
            return;
        try {
            const amountSatang = parseBaht(this.amount);
            if (amountSatang < parseBaht(this.min) || amountSatang > parseBaht(this.max))
                throw new Error(this.locale === 'th' ? 'ยอดเงินอยู่นอกช่วงที่กำหนด' : 'Amount out of range');
            if (!this.createPaymentUrl)
                throw new Error('create-payment-url required');
            this.stop();
            this.clearQr();
            this.payment = null;
            this.creating = true;
            this.state = 'loading';
            this.requestUpdate();
            this.abort = new AbortController();
            const epoch = this.epoch;
            const response = await fetch(this.createPaymentUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ amountSatang }), signal: this.abort.signal });
            if (!response.ok)
                throw new Error(`Create payment (${response.status})`);
            const result = await response.json();
            if (epoch !== this.epoch)
                return;
            if (!result.payment?.id || !result.clientToken)
                throw new Error('Invalid create payment response');
            this.paymentId = result.payment.id;
            this.clientToken = result.clientToken;
            this.emit('pay:created', { payment: result.payment });
            await this.updateComplete;
            this.creating = false;
            await this.load();
        }
        catch (e) {
            this.creating = false;
            this.failure(e);
        }
    }
    private async newPayment() {
        this.stop();
        this.clearQr();
        this.payment = null;
        this.error = '';
        // Suppress attribute-driven loading until old credentials are cleared.
        this.creating = true;
        this.paymentId = '';
        this.clientToken = '';
        this.state = 'input';
        this.requestUpdate();
        await this.updateComplete;
        this.creating = false;
    }
    private async cancelPayment() {
        const epoch = this.epoch;
        try {
            const payment = await this.json(this.url('/cancel'), { method: 'POST' });
            await this.accept(payment, epoch);
        } catch (e) {
            // SSE may already have delivered cancellation and aborted this request.
            if (epoch === this.epoch) this.failure(e);
        }
    }
    private saveQr() {
        if (this.state !== 'qr' || !this.image || this.payment?.status !== 'qr_ready') return;
        if (this.payment.expiresAt <= Date.now()) { this.localExpiry(); return; }
        const link = document.createElement('a');
        link.href = this.image;
        link.download = `promptpay-${this.payment.id}.png`;
        link.hidden = true;
        this.shadowRoot?.append(link);
        link.click();
        link.remove();
    }
    private text(th: string, en: string) { return this.locale === 'en' ? en : th; }
    render() {
        return html `<section class="box" aria-live="polite">
    ${this.state === 'input' ? html `<form @submit=${this.create}><label>${this.text('จำนวนเงิน (บาท)', 'Amount (THB)')}<input name="amount" inputmode="decimal" required .value=${this.amount} @input=${(e: Event) => { this.amount = (e.target as HTMLInputElement).value; }}></label><button type="submit">${this.text('สร้าง QR', 'Create QR')}</button></form>` : nothing}
    ${this.state === 'loading' ? html `<p>${this.text('กำลังโหลด…', 'Loading…')}</p>` : nothing}
    ${this.state === 'qr' && this.image ? html `<p>${this.text('สแกนเพื่อชำระ', 'Scan to pay')} ${((this.payment?.amountSatang ?? 0) / 100).toFixed(2)} THB</p><img data-qr src=${this.image} alt="PromptPay QR"><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="save" @click=${this.saveQr}>${this.text('บันทึก QR Code', 'Save QR Code')}</button><button type="button" class="cancel" @click=${this.cancelPayment}>${this.text('ยกเลิก', 'Cancel')}</button></div>` : nothing}
    ${this.state === 'success' ? html `<p data-status="success">${this.text('ชำระเงินสำเร็จ', 'Payment successful')}</p>` : nothing}
    ${this.state === 'expired' ? html `<p data-status="expired">${this.text('QR หมดอายุ', 'QR expired')}</p>` : nothing}
    ${this.state === 'cancelled' ? html `<p>${this.text('ยกเลิกแล้ว', 'Cancelled')}</p>` : nothing}
    ${this.mode === 'input' && ['cancelled', 'expired'].includes(this.state) ? html `<button @click=${this.newPayment}>${this.text('สร้างรายการใหม่', 'New payment')}</button>` : nothing}
    ${this.state === 'error' ? html `<p role="alert">${this.error}</p>${this.mode === 'input' ? html `<button @click=${this.newPayment}>${this.text('ลองใหม่', 'Try again')}</button>` : nothing}` : nothing}
  </section>`;
    }
}
if (!customElements.get('pay-qr'))
    customElements.define('pay-qr', PayQRElement);
declare global {
    interface HTMLElementTagNameMap {
        'pay-qr': PayQRElement;
    }
}

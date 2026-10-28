'use client';
import { createElement, useEffect, useRef } from 'react';
import type { Payment } from '@payment-qr/core';
export interface PayQRProps {
    apiBase: string;
    paymentId?: string;
    clientToken?: string;
    mode?: 'fixed' | 'input';
    createPaymentUrl?: string;
    min?: string;
    max?: string;
    theme?: string;
    locale?: 'th' | 'en';
    onCreated?: (e: {
        payment: Payment;
    }) => void;
    onSuccess?: (e: {
        payment: Payment;
    }) => void;
    onExpired?: (e: {
        payment: Payment;
    }) => void;
    onCancelled?: (e: {
        payment: Payment;
    }) => void;
    onError?: (e: {
        message: string;
    }) => void;
}
export function PayQR(props: PayQRProps) {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => { void import('@payment-qr/web-component'); }, []);
    useEffect(() => { const el = ref.current; if (!el)
        return; const events: Record<string, Function | undefined> = { 'pay:created': props.onCreated, 'pay:success': props.onSuccess, 'pay:expired': props.onExpired, 'pay:cancelled': props.onCancelled, 'pay:error': props.onError }; const handlers = Object.entries(events).map(([name, callback]) => { const handler = (e: Event) => callback?.((e as CustomEvent).detail); el.addEventListener(name, handler); return { name, handler }; }); return () => handlers.forEach(({ name, handler }) => el.removeEventListener(name, handler)); }, [props.onCreated, props.onSuccess, props.onExpired, props.onCancelled, props.onError]);
    return createElement('pay-qr', { ref, 'api-base': props.apiBase, 'payment-id': props.paymentId, 'client-token': props.clientToken, mode: props.mode ?? 'fixed', 'create-payment-url': props.createPaymentUrl, min: props.min, max: props.max, theme: props.theme, locale: props.locale });
}

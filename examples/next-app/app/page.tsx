'use client';
import { useEffect, useState } from 'react';
import { PayQR } from '@payment-qr/react';

export default function Page() {
    const [deadline, setDeadline] = useState<number | null>(null);
    const [seconds, setSeconds] = useState(0);
    const [result, setResult] = useState('');
    const [showTimer, setShowTimer] = useState(false);

    useEffect(() => {
        if (deadline === null) return;
        const update = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
        update();
        const interval = window.setInterval(update, 250);
        return () => window.clearInterval(interval);
    }, [deadline]);

    return <main style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>
        <PayQR apiBase={process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'}
            mode="input" createPaymentUrl="/api/create-payment" locale="th"
            min="1" max="100000"
            onCreated={({ payment }) => {
                setDeadline(payment.expiresAt);
                setSeconds(Math.max(0, Math.ceil((payment.expiresAt - Date.now()) / 1000)));
                setShowTimer(true);
                setResult('');
            }}
            onSuccess={() => {
                setDeadline(null); setShowTimer(false); setResult('ชำระเงินสำเร็จ');
            }}
            onExpired={() => {
                setDeadline(null); setSeconds(0); setResult('QR หมดอายุแล้ว');
            }}
            onCancelled={() => {
                setDeadline(null); setShowTimer(false); setResult('ยกเลิกการชำระเงินแล้ว');
            }}
            onError={({ message }) => {
                setDeadline(null); setShowTimer(false); setResult(message);
            }} />
        {showTimer && <p role="timer" style={{ margin: '16px 0 0' }}>
            เวลาชำระเงินคงเหลือ <strong>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</strong>
        </p>}
        {result && <p role="status" style={{ margin: '12px 0 0' }}>{result}</p>}
    </main>;
}

'use client';
import { useState } from 'react';
import { PayQR } from '@payment-qr/react';
export default function Page() { const [id, setId] = useState(''); const [result, setResult] = useState(''); return <main><h1>Next.js Mock checkout</h1><PayQR apiBase={process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'} mode="input" createPaymentUrl="/api/create-payment" onCreated={({ payment }) => setId(payment.id)} onSuccess={() => { setResult('Payment successful'); setId(''); }} onExpired={() => setId('')} onCancelled={() => setId('')} onError={({ message }) => setResult(message)}/><button disabled={!id} onClick={async () => { const r = await fetch('/api/mock-pay/' + id, { method: 'POST' }); if (!r.ok)
    setResult('Mock pay failed'); }}>Mock pay</button><p>{result}</p></main>; }

export async function POST(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) { if (process.env.ENABLE_MOCK !== 'true')
    return new Response(null, { status: 404 }); const { id } = await params; const r = await fetch((process.env.API_BASE ?? 'http://localhost:4000') + '/dev/mock/' + encodeURIComponent(id) + '/pay', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MERCHANT_API_KEY}` } }); return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } }); }

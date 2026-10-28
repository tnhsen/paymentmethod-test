import type { ReactNode } from 'react';
export default function Layout({ children }: {
    children: ReactNode;
}) { return <html lang="th"><body style={{ fontFamily: 'system-ui', maxWidth: 500, margin: '48px auto' }}>{children}</body></html>; }

import { buildApp, hashKey } from './app.js';
import { SQLiteRepository, PostgresRepository } from './repository.js';
import { MockProvider, OmiseProvider } from './providers.js';
const required = (name: string) => { const v = process.env[name]; if (!v)
    throw new Error(`${name} is required`); return v; };
const repo = process.env.DATABASE_URL ? new PostgresRepository(process.env.DATABASE_URL) : new SQLiteRepository(process.env.SQLITE_PATH ?? 'payment.db');
await repo.init();
await repo.putMerchant({ id: 'demo', keyHash: hashKey(required('MERCHANT_API_KEY')), origins: (process.env.MERCHANT_ORIGINS ?? 'http://localhost:5173,http://localhost:3000').split(',') });
const enableMock = process.env.ENABLE_MOCK === 'true';
if (enableMock && process.env.NODE_ENV === 'production')
    throw new Error('Mock must not be enabled in production');
const providers = enableMock ? [new MockProvider(required('MOCK_WEBHOOK_SECRET'), process.env.PROMPTPAY_ID)] : [new OmiseProvider()];
const { app } = await buildApp({ repo, providers, tokenSecret: required('TOKEN_SECRET'), enableMock });
await app.listen({ port: Number(process.env.PORT ?? 4000), host: process.env.HOST ?? '127.0.0.1' });
console.log('Payment API listening on ' + app.server.address());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => { void app.close().then(() => process.exit(0)); });

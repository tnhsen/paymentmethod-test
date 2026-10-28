import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import type { Payment, PaymentStatus } from '@payment-qr/core';
export interface Merchant {
    id: string;
    keyHash: string;
    origins: string[];
}
export interface PaymentRepository {
    init(): Promise<void>;
    close(): Promise<void>;
    putMerchant(merchant: Merchant): Promise<void>;
    merchantByHash(hash: string): Promise<Merchant | null>;
    merchant(id: string): Promise<Merchant | null>;
    originAllowed(origin: string): Promise<boolean>;
    create(payment: Payment, key: string, fingerprint: string): Promise<{
        payment: Payment;
        fingerprint: string;
    }>;
    get(id: string): Promise<Payment | null>;
    active(): Promise<Payment[]>;
    save(payment: Payment, expectedVersion: number): Promise<boolean>;
    applyEvent(provider: string, eventId: string, payment: Payment, expectedVersion: number): Promise<'applied' | 'duplicate' | 'conflict'>;
}
type Row = {
    data: string;
};
const decode = (row: Row | undefined | null): Payment | null => row ? JSON.parse(row.data) : null;
const schema = `CREATE TABLE IF NOT EXISTS merchants (id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, origins TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, idem_key TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(merchant_id,idem_key));
CREATE TABLE IF NOT EXISTS webhook_events (provider TEXT NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(provider,event_id));`;
export class SQLiteRepository implements PaymentRepository {
    db: DatabaseSync;
    constructor(path = 'payment.db') { this.db = new DatabaseSync(path); this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;'); }
    async init() { this.db.exec(schema); }
    async close() { this.db.close(); }
    async putMerchant(m: Merchant) { this.db.prepare('INSERT INTO merchants VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,origins=excluded.origins').run(m.id, m.keyHash, JSON.stringify(m.origins)); }
    private readMerchant(row: any): Merchant | null { return row ? { id: row.id, keyHash: row.key_hash, origins: JSON.parse(row.origins) } : null; }
    async merchantByHash(hash: string) { return this.readMerchant(this.db.prepare('SELECT * FROM merchants WHERE key_hash=?').get(hash)); }
    async merchant(id: string) { return this.readMerchant(this.db.prepare('SELECT * FROM merchants WHERE id=?').get(id)); }
    async originAllowed(origin: string) { return this.db.prepare('SELECT origins FROM merchants').all().some(row => JSON.parse(String(row.origins)).includes(origin)); }
    async create(p: Payment, key: string, fingerprint: string) {
        this.db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?) ON CONFLICT(merchant_id,idem_key) DO NOTHING').run(p.id, p.merchantId, key, fingerprint, p.status, p.version, JSON.stringify(p));
        const row = this.db.prepare('SELECT data,fingerprint FROM payments WHERE merchant_id=? AND idem_key=?').get(p.merchantId, key) as unknown as Row & {
            fingerprint: string;
        };
        return { payment: decode(row)!, fingerprint: row.fingerprint };
    }
    async get(id: string) { return decode(this.db.prepare('SELECT data FROM payments WHERE id=?').get(id) as Row | undefined); }
    async active() { return (this.db.prepare("SELECT data FROM payments WHERE status IN ('pending','qr_ready')").all() as unknown as Row[]).map(r => decode(r)!); }
    async save(p: Payment, v: number) { return this.db.prepare('UPDATE payments SET data=?,status=?,version=? WHERE id=? AND version=?').run(JSON.stringify(p), p.status, p.version, p.id, v).changes === 1; }
    async applyEvent(provider: string, eventId: string, p: Payment, v: number): Promise<'applied' | 'duplicate' | 'conflict'> {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            if (this.db.prepare('SELECT 1 FROM webhook_events WHERE provider=? AND event_id=?').get(provider, eventId)) {
                this.db.exec('COMMIT');
                return 'duplicate';
            }
            if (this.db.prepare('UPDATE payments SET data=?,status=?,version=? WHERE id=? AND version=?').run(JSON.stringify(p), p.status, p.version, p.id, v).changes !== 1) {
                this.db.exec('ROLLBACK');
                return 'conflict';
            }
            this.db.prepare('INSERT INTO webhook_events VALUES(?,?)').run(provider, eventId);
            this.db.exec('COMMIT');
            return 'applied';
        }
        catch (e) {
            this.db.exec('ROLLBACK');
            throw e;
        }
    }
}
export class PostgresRepository implements PaymentRepository {
    pool: pg.Pool;
    constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }
    async init() { await this.pool.query(schema); }
    async close() { await this.pool.end(); }
    async putMerchant(m: Merchant) { await this.pool.query('INSERT INTO merchants VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,origins=excluded.origins', [m.id, m.keyHash, JSON.stringify(m.origins)]); }
    private readMerchant(row: any): Merchant | null { return row ? { id: row.id, keyHash: row.key_hash, origins: JSON.parse(row.origins) } : null; }
    async merchantByHash(hash: string) { return this.readMerchant((await this.pool.query('SELECT * FROM merchants WHERE key_hash=$1', [hash])).rows[0]); }
    async merchant(id: string) { return this.readMerchant((await this.pool.query('SELECT * FROM merchants WHERE id=$1', [id])).rows[0]); }
    async originAllowed(origin: string) { return (await this.pool.query('SELECT origins FROM merchants')).rows.some(row => JSON.parse(row.origins).includes(origin)); }
    async create(p: Payment, key: string, fingerprint: string) { await this.pool.query('INSERT INTO payments VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(merchant_id,idem_key) DO NOTHING', [p.id, p.merchantId, key, fingerprint, p.status, p.version, JSON.stringify(p)]); const row = (await this.pool.query('SELECT data,fingerprint FROM payments WHERE merchant_id=$1 AND idem_key=$2', [p.merchantId, key])).rows[0]; return { payment: decode(row)!, fingerprint: row.fingerprint }; }
    async get(id: string) { return decode((await this.pool.query('SELECT data FROM payments WHERE id=$1', [id])).rows[0]); }
    async active() { return (await this.pool.query("SELECT data FROM payments WHERE status IN ('pending','qr_ready')")).rows.map(r => decode(r)!); }
    async save(p: Payment, v: number) { return (await this.pool.query('UPDATE payments SET data=$1,status=$2,version=$3 WHERE id=$4 AND version=$5', [JSON.stringify(p), p.status, p.version, p.id, v])).rowCount === 1; }
    async applyEvent(provider: string, eventId: string, p: Payment, v: number): Promise<'applied' | 'duplicate' | 'conflict'> {
        const c = await this.pool.connect();
        try {
            await c.query('BEGIN');
            const inserted = await c.query('INSERT INTO webhook_events VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id', [provider, eventId]);
            if (!inserted.rowCount) {
                await c.query('COMMIT');
                return 'duplicate';
            }
            const changed = await c.query('UPDATE payments SET data=$1,status=$2,version=$3 WHERE id=$4 AND version=$5', [JSON.stringify(p), p.status, p.version, p.id, v]);
            if (!changed.rowCount) {
                await c.query('ROLLBACK');
                return 'conflict';
            }
            await c.query('COMMIT');
            return 'applied';
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    }
}

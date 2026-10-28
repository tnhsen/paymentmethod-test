import {it,expect} from 'vitest';
import {buildApp,hashKey} from './app.js';
import {SQLiteRepository} from './repository.js';
import {DirectPromptPayProvider} from './providers.js';
it('creates direct QR without mock and rejects payment confirmation',async()=>{
 const repo=new SQLiteRepository(':memory:');let now=Date.now();
 const service=await buildApp({repo,providers:[new DirectPromptPayProvider('0812345678')],tokenSecret:'s'.repeat(32),jobs:false,now:()=>now});
 await repo.putMerchant({id:'m',keyHash:hashKey('key'),origins:[]});
 try{
  const r=await service.app.inject({method:'POST',url:'/v1/payments',headers:{authorization:'Bearer key','idempotency-key':'direct'},payload:{amountSatang:12345,expiresInSeconds:120}});
  expect(r.statusCode).toBe(201);const {payment,clientToken}=r.json();expect(payment.provider).toBe('promptpay');
  const qr=await service.app.inject({method:'POST',url:`/v1/payments/${payment.id}/qr`,headers:{authorization:`Bearer ${clientToken}`}});
  expect(qr.statusCode).toBe(200);expect(qr.json().qrPayload).toContain('5406123.45');
  expect((await service.app.inject({method:'POST',url:'/v1/webhooks/promptpay',payload:{status:'paid'}})).statusCode).toBe(401);
  await service.reconcile();expect((await repo.get(payment.id))!.status).toBe('qr_ready');
  now+=120001;await service.expireJob();expect((await repo.get(payment.id))!.qrPayload).toBeNull();expect((await repo.get(payment.id))!.status).toBe('expired');
 }finally{await service.app.close();}
});

import {defineConfig} from '@playwright/test';
const apiPort=process.env.E2E_API_PORT??'14000';
const uiPort=process.env.E2E_UI_PORT??'15173';
const apiBase=`http://localhost:${apiPort}`;
const uiBase=`http://localhost:${uiPort}`;
const env={MERCHANT_API_KEY:'e2e-test-key',TOKEN_SECRET:'e2e-token-secret-at-least-32-characters',MOCK_WEBHOOK_SECRET:'e2e-webhook-secret',ENABLE_MOCK:'true',SQLITE_PATH:':memory:',PORT:apiPort,DEMO_PORT:uiPort,API_BASE:apiBase,PUBLIC_API_BASE:apiBase,MERCHANT_ORIGINS:uiBase,DEMO_EXPIRY_SECONDS:'4'};
export default defineConfig({testDir:'tests',workers:1,use:{baseURL:uiBase,browserName:'chromium'},webServer:[{command:'pnpm dev',url:`${apiBase}/health`,env,reuseExistingServer:false},{command:'pnpm exec tsx examples/plain-html/server.ts',url:uiBase,env,reuseExistingServer:false}]});

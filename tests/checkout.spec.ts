import { test, expect, type Page } from '@playwright/test';
test('cancel and recreate twice without refreshing resets QR and countdown', async ({ page }) => {
  await create(page, '10');
  for (const amount of ['20', '30']) {
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(page.locator('[data-qr]')).toHaveCount(0);
    await expect(page.locator('#payment-timer')).toBeHidden();
    await page.getByRole('button', { name: 'สร้างรายการใหม่', exact: true }).click();
    await page.getByRole('textbox').fill(amount);
    await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();
    await expect(page.locator('[data-qr]')).toBeVisible();
    await expect(page.locator('pay-qr')).toContainText(`${amount}.00 THB`);
    await expect(page.locator('#payment-timer')).toBeVisible();
  }
});
test('can recreate after expiry without refreshing', async ({ page }) => {
  await create(page, '5');
  await expect(page.locator('[data-status=expired]')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'สร้างรายการใหม่', exact: true }).click();
  await page.getByRole('textbox').fill('6');
  await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();
  await expect(page.locator('[data-qr]')).toBeVisible();
  await expect(page.locator('#time-left')).toHaveText(/00:0[1-4]/);
});
async function create(page: Page, amount: string) {
  await page.goto('/');
  await page.getByRole('textbox').fill(amount);
  const response = page.waitForResponse(r => r.url().endsWith('/api/create-payment') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'สร้าง QR', exact: true }).click();
  const { payment } = await (await response).json();
  await expect(page.locator('[data-qr]')).toBeVisible();
  return payment;
}
test('input → QR → webhook → success removes QR from DOM', async ({ page }) => {
  const payment = await create(page, '123.45');
  expect((await page.request.post('/api/mock-pay/' + payment.id)).ok()).toBe(true);
  await expect(page.locator('[data-status=success]')).toBeVisible();
  await expect(page.locator('[data-qr]')).toHaveCount(0);
  expect(await page.locator('pay-qr').evaluate((el: any) => ({ payload: el.payload, image: el.image, stored: el.payment.qrPayload }))).toEqual({ payload: null, image: null, stored: null });
});
test('countdown replaces pay button and expiry removes QR', async ({ page }) => {
  const payment = await create(page, '1');
  expect(payment.expiresAt - payment.createdAt).toBe(4000);
  await expect(page.locator('#payment-timer')).toBeVisible();
  await expect(page.locator('#time-left')).toHaveText(/00:0[1-4]/);
  await expect(page.locator('#mock-pay')).toHaveCount(0);
  await expect(page.locator('[data-status=expired]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#time-left')).toHaveText('00:00');
  await expect(page.locator('[data-qr]')).toHaveCount(0);
  expect(await page.locator('pay-qr').evaluate((el: any) => el.payload)).toBeNull();
});
test('falls back to polling if SSE fails', async ({ page }) => {
  await page.route('**/events', route => route.abort());
  const payment = await create(page, '2');
  expect((await page.request.post('/api/mock-pay/' + payment.id)).ok()).toBe(true);
  await expect(page.locator('[data-status=success]')).toBeVisible();
  await expect(page.locator('[data-qr]')).toHaveCount(0);
});

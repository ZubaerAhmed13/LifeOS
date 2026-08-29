const { test, expect } = require('playwright/test');
const { resetApp, createTask, waitForApp, freshData } = require('./helpers');

test.beforeEach(async ({ page, request }) => {
  await request.post('/__test/sw-build', { data: 'pwa1' });
  await resetApp(page);
});

test('manifest, icons, service worker and application shell are valid and cacheable', async ({ page, browserName }) => {
  const resources = ['/index.html', '/app.js', '/app.css', '/manifest.webmanifest', '/service-worker.js', '/planning-worker.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];
  for (const resource of resources) expect((await page.request.get(resource)).status(), resource).toBe(200);
  const registration = await page.evaluate(async () => {
    const value = await navigator.serviceWorker.ready;
    return { scope: value.scope, active: value.active?.state, scriptURL: value.active?.scriptURL };
  });
  expect(registration.active).toBe('activated');
  expect(registration.scriptURL).toMatch(/service-worker\.js$/);
  const cacheKeys = await page.evaluate(() => caches.keys());
  expect(cacheKeys).toContain('lifeos-shell-4.4.0-pwa1');
  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    const manifest = await session.send('Page.getAppManifest');
    expect(manifest.errors || []).toEqual([]);
    const installability = await session.send('Page.getInstallabilityErrors');
    expect(installability.installabilityErrors || []).toEqual([]);
  }
});

test('offline reload starts LifeOS and preserves IndexedDB data', async ({ page, context }) => {
  const task = await createTask(page, 'Offline retained task');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await expect(page.getByText('Offline retained task', { exact: true })).toBeVisible();
  expect((await freshData(page)).tasks.some(item => item.id === task.id)).toBe(true);
  await context.setOffline(false);
});

test('new cache build announces update, snapshots, activates, reloads and keeps IndexedDB', async ({ page, request }) => {
  const task = await createTask(page, 'PWA update retained task');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await request.post('/__test/sw-build', { data: 'pwa2' });
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state || '')).toBe('installed');
  await expect.poll(async () => (await page.evaluate(() => globalThis.LifeOS.app.notifications.list())).some(item => item.title === 'Application update available')).toBe(true);
  await page.getByRole('button', { name: 'Open notifications' }).click();
  const updateRow = page.locator('.notification-row').filter({ hasText: 'Application update available' });
  await updateRow.getByRole('button', { name: 'Open' }).click();
  await expect.poll(async () => (await page.evaluate(() => caches.keys())).includes('lifeos-shell-4.4.0-pwa2'), { timeout: 20_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await waitForApp(page);
  expect((await freshData(page)).tasks.some(item => item.id === task.id)).toBe(true);
  const snapshots = await page.evaluate(() => globalThis.LifeOS.app.repo.all('snapshots', { fresh: true }));
  expect(snapshots.some(item => item.kind === 'pre-update' && item.protected)).toBe(true);
});

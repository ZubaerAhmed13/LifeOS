const { expect } = require('playwright/test');

async function waitForApp(page) {
  await page.waitForFunction(() => globalThis.LifeOS?.app?.repo && document.querySelector('#view:not(.loading)'), null, { timeout: 20_000 });
  await expect(page.locator('#pageTitle')).not.toHaveText('');
}

async function resetApp(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => globalThis.LifeOS?.app?.db, null, { timeout: 20_000 });
  await page.evaluate(async () => {
    await globalThis.LifeOS.app.db.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('LifeOSDB');
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
      request.onblocked = resolve;
    });
    localStorage.clear();
  });
  await page.reload();
  await waitForApp(page);
  // A newly installed service worker may take control and trigger the app's safe
  // controllerchange reload. Let that transition settle before the test starts
  // mutating IndexedDB so Firefox/WebKit do not lose an execution context mid-step.
  try {
    await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return;
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 2500);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    });
  } catch {}
  await page.waitForTimeout(300);
  await waitForApp(page);
  const skip = page.getByRole('button', { name: 'Skip setup' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.locator('#appDialog')).not.toBeVisible();
}

async function navigate(page, label) {
  const desktop = page.locator('#sideNav').getByRole('button', { name: label, exact: true });
  const viewport = page.viewportSize();
  let target = desktop;
  if (viewport && viewport.width <= 820) {
    const mobile = page.locator('#mobileNav').getByRole('button', { name: label, exact: true });
    if (await mobile.count()) target = mobile;
    else {
      await page.locator('#mobileNav').getByRole('button', { name: 'More', exact: true }).click();
      await expect(page.locator('#moreMenu')).toHaveClass(/open/);
      target = page.locator('#moreMenu').getByRole('button', { name: label, exact: true });
    }
  }
  const view = await target.getAttribute('data-view');
  await target.click();
  await page.waitForFunction(expected => globalThis.LifeOS?.app?.router?.current() === expected, view);
  await page.evaluate(() => globalThis.LifeOS.app.render());
  await expect(page.locator('#pageTitle')).toHaveText(label);
}

async function createTask(page, title = 'SAP FI Study') {
  await navigate(page, 'Tasks');
  await page.getByRole('button', { name: 'Create task' }).first().click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Expected duration (minutes)').fill('120');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.locator('#appDialog')).not.toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  return page.evaluate(async name => (await globalThis.LifeOS.app.repo.all('tasks', { fresh: true })).find(item => item.title === name), title);
}

async function freshData(page) {
  return page.evaluate(() => globalThis.LifeOS.app.repo.dataset({ fresh: true }));
}

async function saveRecord(page, store, record, validate = false) {
  return page.evaluate(({ store, record, validate }) => globalThis.LifeOS.app.repo.save(store, record, { validate }), { store, record, validate });
}

async function renderView(page, view, params = {}) {
  await page.evaluate(async ({ view, params }) => {
    globalThis.LifeOS.app.setView(view, params);
    await globalThis.LifeOS.app.render();
  }, { view, params });
}

module.exports = { waitForApp, resetApp, navigate, createTask, freshData, saveRecord, renderView };

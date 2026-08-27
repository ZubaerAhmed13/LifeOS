const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');

const browserName = process.env.BROWSER || 'chromium';
const baseURL = process.env.BASE_URL;
const resultPath = process.env.RESULT_PATH || `result-${browserName}.json`;
const engines = { chromium, firefox, webkit };
if (!baseURL || !engines[browserName]) throw new Error('Missing BASE_URL or unsupported BROWSER');

const result = {
  version: 'LifeOS 4.3.0',
  browser: browserName,
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  gates: [],
  errors: []
};
let currentGate = 'startup';
let browser;

function log(msg) { console.log(`[lifeos-430:${browserName}] ${msg}`); }
function timeoutError(label, ms) { return new Error(`${label} timed out after ${ms}ms`); }
async function bounded(label, fn, ms = 15000) {
  currentGate = label;
  log(`START ${label}`);
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(label, ms)), ms); })
    ]);
    clearTimeout(timer);
    result.gates.push({ label, status: 'PASS', durationMs: Date.now() - started });
    log(`PASS ${label}`);
    return value;
  } catch (error) {
    clearTimeout(timer);
    result.gates.push({ label, status: 'FAIL', durationMs: Date.now() - started, error: error.message });
    throw error;
  }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitLifeOS(page) {
  await page.waitForFunction(() => Boolean(window.LifeOS?.app?.repo && window.LifeOS?.app?.calendarInteraction), null, { timeout: 10000 });
  await page.evaluate(async () => {
    const app = LifeOS.app;
    const settings = await app.repo.settings();
    if (!settings.onboardingComplete) await app.repo.setting('onboardingComplete', true);
    try { app.modal?.close(); } catch {}
  });
}

(async () => {
  try {
    browser = await bounded('browser launch', () => engines[browserName].launch({ headless: true }), 15000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));

    await bounded('application load', async () => {
      await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await waitLifeOS(page);
    }, 15000);

    await bounded('release identity and calendar primitives', async () => {
      const data = await page.evaluate(() => ({
        version: LifeOS.version,
        schema: LifeOS.schemaVersion,
        calendar: LifeOS.calendarEngineVersion,
        scheduler: LifeOS.schedulerVersion,
        forecast: LifeOS.forecastModelVersion,
        snap: LifeOS.CalendarSnapEngine.clock('10:07', 15),
        cross: LifeOS.CalendarSnapEngine.shift('2031-01-20', '23:55', { minutes: 15, snap: 15 }),
        overlap: LifeOS.CalendarOverlapEngine.layout([
          { id: 'a', start: 600, end: 660 },
          { id: 'b', start: 615, end: 675 },
          { id: 'c', start: 630, end: 690 }
        ]).map(x => ({ id: x.id, lane: x.lane, lanes: x.lanes }))
      }));
      assert(data.version === '4.3.0', `APP_VERSION ${data.version}`);
      assert(data.schema === 16, `schema ${data.schema}`);
      assert(data.calendar === '4.3.0', `calendar engine ${data.calendar}`);
      assert(data.scheduler === '4.1.0', `scheduler ${data.scheduler}`);
      assert(data.forecast === '4.2.0', `forecast ${data.forecast}`);
      assert(data.snap === '10:00', `15m snap ${data.snap}`);
      assert(data.cross.date === '2031-01-21' && data.cross.startTime === '00:15', `cross-date ${JSON.stringify(data.cross)}`);
      assert(new Set(data.overlap.map(x => x.lane)).size === 3, `overlap lanes ${JSON.stringify(data.overlap)}`);
    });

    const ids = {
      core: `ci-core-${browserName}`,
      sleep: `ci-sleep-${browserName}`,
      ui: `ci-ui-${browserName}`,
      offline: `ci-offline-${browserName}`
    };

    await bounded('same-day move, invalid drop, undo and stale protection', async () => {
      const out = await page.evaluate(async ({ ids }) => {
        const app = LifeOS.app;
        for (const id of Object.values(ids)) { try { await app.repo.remove('timeBlocks', id); } catch {} }
        const core = await app.repo.save('timeBlocks', {
          id: ids.core, title: 'CI Core Move', date: '2031-01-20', startTime: '10:00', endTime: '11:00', duration: 60,
          locked: false, protected: false, manuallyPlaced: true, sourceType: 'user', sourceId: ids.core
        });
        await app.repo.save('timeBlocks', {
          id: ids.sleep, title: 'Protected Sleep', date: '2031-01-20', startTime: '21:00', endTime: '23:00', duration: 120,
          locked: true, protected: true, type: 'sleep', sleepGenerated: true, sourceType: 'sleep-engine', sourceId: ids.sleep
        });
        const preview = await app.calendarInteraction.preview({ id: ids.core, kind: 'block', date: '2031-01-20', startTime: '11:00', duration: 60 });
        if (!preview.validation.valid) throw new Error(`valid move rejected: ${preview.validation.hardConflicts?.[0]?.message || ''}`);
        await app.calendarInteraction.commit({ id: ids.core, kind: 'block', date: '2031-01-20', startTime: '11:00', duration: 60, expectedRevision: core.revision });
        const moved = await app.repo.get('timeBlocks', ids.core);
        await app.undo.undo();
        const undone = await app.repo.get('timeBlocks', ids.core);
        const sleepPreview = await app.calendarInteraction.preview({ id: ids.sleep, kind: 'block', date: '2031-01-20', startTime: '20:00', duration: 120 });
        const beforeExternal = await app.repo.get('timeBlocks', ids.core);
        const externallyChanged = await app.repo.save('timeBlocks', { ...beforeExternal, title: 'Externally Changed' });
        let staleCode = '';
        try {
          await app.calendarInteraction.commit({ id: ids.core, kind: 'block', date: '2031-01-20', startTime: '12:00', duration: 60, expectedRevision: beforeExternal.revision });
        } catch (error) { staleCode = error.code || ''; }
        return {
          movedStart: moved.startTime,
          undoneStart: undone.startTime,
          sleepValid: sleepPreview.validation.valid,
          sleepCode: sleepPreview.validation.hardConflicts?.[0]?.code || '',
          staleCode,
          externalRevision: externallyChanged.revision
        };
      }, { ids });
      assert(out.movedStart === '11:00', `move did not persist: ${out.movedStart}`);
      assert(out.undoneStart === '10:00', `undo did not restore: ${out.undoneStart}`);
      assert(out.sleepValid === false, 'protected sleep move was accepted');
      assert(out.staleCode === 'DATA-REVISION-CONFLICT', `stale code ${out.staleCode}`);
    }, 15000);

    await bounded('actual calendar UI and non-drag Move control', async () => {
      await page.evaluate(async ({ id }) => {
        const app = LifeOS.app;
        try { await app.repo.remove('timeBlocks', id); } catch {}
        await app.repo.save('timeBlocks', {
          id, title: 'CI UI Move', date: '2031-01-20', startTime: '14:00', endTime: '15:00', duration: 60,
          locked: false, protected: false, manuallyPlaced: true, sourceType: 'user', sourceId: id
        });
        app.state.set({ calendarDate: '2031-01-20', calendarMode: 'day', calendarScenarioId: '', calendarSelection: new Set() });
        app.router.go('calendar');
        void app.render();
      }, { id: ids.ui });
      await page.waitForSelector(`[data-calendar-item="${ids.ui}"]`, { timeout: 8000 });
      const moveButton = page.locator(`[data-action="calendar-move"][data-id="${ids.ui}"]`).first();
      await moveButton.waitFor({ state: 'visible', timeout: 5000 });
      await moveButton.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-form="calendar-move"]', { state: 'visible', timeout: 5000 });
      const formState = await page.evaluate(() => {
        const form = document.querySelector('[data-form="calendar-move"]');
        return {
          date: form?.elements?.date?.value || '',
          start: form?.elements?.startTime?.value || '',
          duration: form?.elements?.duration?.value || '',
          hasCancel: Boolean(form?.querySelector('[data-action="close-dialog"]')),
          hasSubmit: Boolean(form?.querySelector('button:not([type="button"])'))
        };
      });
      assert(formState.date === '2031-01-20', `Move date ${formState.date}`);
      assert(formState.start === '14:00', `Move start ${formState.start}`);
      assert(formState.duration === '60', `Move duration ${formState.duration}`);
      assert(formState.hasCancel && formState.hasSubmit, 'Move dialog controls missing');
      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();
    }, 15000);

    await bounded('mobile and tablet calendar layouts', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { LifeOS.app.state.set({ calendarDate: '2031-01-20', calendarMode: 'day' }); LifeOS.app.router.go('calendar'); void LifeOS.app.render(); });
      await page.waitForSelector('[data-calendar-scroll]', { timeout: 6000 });
      const mobile = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        actions: Boolean(document.querySelector('[data-action="calendar-actions"], [data-action="calendar-move"]'))
      }));
      assert(mobile.scrollWidth <= mobile.clientWidth + 8, `mobile horizontal overflow ${mobile.scrollWidth}/${mobile.clientWidth}`);
      assert(mobile.actions, 'mobile calendar action missing');
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.evaluate(() => { void LifeOS.app.render(); });
      await page.waitForSelector('[data-calendar-scroll]', { timeout: 6000 });
      const tablet = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      assert(tablet.scrollWidth <= tablet.clientWidth + 8, `tablet horizontal overflow ${tablet.scrollWidth}/${tablet.clientWidth}`);
      await page.setViewportSize({ width: 1440, height: 900 });
    }, 15000);

    await bounded('offline PWA calendar operation and bounded compute', async () => {
      const sw = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator) || !('caches' in window)) return { supported: false, cacheCount: 0, cachedApp: false };
        const ready = await Promise.race([
          navigator.serviceWorker.ready.then(() => true),
          new Promise(resolve => setTimeout(() => resolve(false), 5000))
        ]);
        const keys = await caches.keys();
        let cachedApp = false;
        for (const key of keys) {
          const cache = await caches.open(key);
          if (await cache.match(new URL('./app.js', location.href).href)) { cachedApp = true; break; }
        }
        return { supported: true, ready, cacheCount: keys.length, cachedApp };
      });
      assert(sw.supported && sw.cacheCount > 0 && sw.cachedApp, `PWA cache unavailable ${JSON.stringify(sw)}`);
      await context.setOffline(true);
      const offline = await page.evaluate(async ({ id }) => {
        const app = LifeOS.app;
        try { await app.repo.remove('timeBlocks', id); } catch {}
        const block = await app.repo.save('timeBlocks', {
          id, title: 'CI Offline Move', date: '2031-01-22', startTime: '09:00', endTime: '10:00', duration: 60,
          locked: false, protected: false, manuallyPlaced: true, sourceType: 'user', sourceId: id
        });
        const preview = await app.calendarInteraction.preview({ id, kind: 'block', date: '2031-01-22', startTime: '10:00', duration: 60 });
        if (!preview.validation.valid) throw new Error('offline preview invalid');
        await app.calendarInteraction.commit({ id, kind: 'block', date: '2031-01-22', startTime: '10:00', duration: 60, expectedRevision: block.revision });
        const moved = await app.repo.get('timeBlocks', id);
        await app.undo.undo();
        const restored = await app.repo.get('timeBlocks', id);
        try { app.compute.worker?.terminate(); } catch {}
        app.compute.worker = null;
        const compute = await app.compute.run('aggregate', { values: [1, 2, 3] }, { dataGeneration: 1, timeoutMs: 4000 });
        return { moved: moved.startTime, restored: restored.startTime, sum: compute.result?.sum, mode: compute.mode || app.compute.mode };
      }, { id: ids.offline });
      assert(offline.moved === '10:00' && offline.restored === '09:00', `offline move/undo ${JSON.stringify(offline)}`);
      assert(offline.sum === 6, `offline compute ${JSON.stringify(offline)}`);
      await context.setOffline(false);
    }, 15000);

    await bounded('console and page error gate', async () => {
      const filteredConsole = consoleErrors.filter(x => !/ResizeObserver loop/i.test(x));
      assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
      assert(filteredConsole.length === 0, `console errors: ${filteredConsole.join(' | ')}`);
    }, 5000);

    result.status = 'PASS';
    result.completedAt = new Date().toISOString();
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    log(`CERTIFICATION PASS (${result.gates.length} gates)`);
    await context.close();
    await browser.close();
    process.exit(0);
  } catch (error) {
    result.status = 'FAIL';
    result.failedGate = currentGate;
    result.errors.push({ message: error.message, stack: error.stack || '' });
    result.completedAt = new Date().toISOString();
    try { fs.writeFileSync(resultPath, JSON.stringify(result, null, 2)); } catch {}
    log(`CERTIFICATION FAIL at ${currentGate}: ${error.stack || error.message}`);
    try { await browser?.close(); } catch {}
    process.exit(1);
  }
})();

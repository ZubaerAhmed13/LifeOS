const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');

const engines = { chromium, firefox, webkit };
const browserName = process.env.BROWSER || 'chromium';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173/verify-420/pwa/index.html';
const launch = engines[browserName];
if (!launch) throw new Error(`Unknown browser ${browserName}`);

async function waitForApp(page) {
  await page.waitForFunction(() => globalThis.LifeOS?.app?.repo?.db?.db, null, { timeout: 60000 });
}

(async () => {
  const browser = await launch.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });

  const bootstrap = await context.newPage();
  await bootstrap.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForApp(bootstrap);
  const swSupported = await bootstrap.evaluate(() => 'serviceWorker' in navigator);
  if (swSupported) {
    await bootstrap.waitForTimeout(3500);
    await waitForApp(bootstrap);
    try { await bootstrap.evaluate(() => navigator.serviceWorker.ready.then(() => true)); } catch {}
    await bootstrap.waitForTimeout(500);
  }
  await bootstrap.close();

  const pageErrors = [];
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForApp(page);
  if (swSupported) {
    await page.waitForTimeout(500);
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Primary page is not service-worker controlled');
  }

  await page.evaluate(async () => {
    const app = LifeOS.app;
    app.modal?.close?.();
    const s = await app.repo.settings();
    if (!s.onboardingComplete) await app.repo.save('settings', { ...s, onboardingComplete: true });
  });

  const identity = await page.evaluate(() => ({
    version: LifeOS.version,
    schema: LifeOS.schemaVersion,
    scheduler: LifeOS.schedulerVersion,
    forecast: LifeOS.forecastModelVersion,
    stores: Array.from(LifeOS.app.repo.db.db.objectStoreNames)
  }));
  assert.equal(identity.version, '4.2.0');
  assert.equal(identity.schema, 16);
  assert.equal(identity.scheduler, '4.1.0');
  assert.equal(identity.forecast, '4.2.0');
  assert(identity.stores.includes('scenarios'));

  await page.evaluate(async () => { LifeOS.app.router.go('scenario'); await LifeOS.app.render(); });
  await page.getByRole('heading', { name: 'Scenario Lab' }).waitFor({ timeout: 15000 });

  const core = await page.evaluate(async () => {
    const L = LifeOS, app = L.app;
    const current = await app.scenarioEngine.currentState();
    const date = L.CoreUtil.addDays(L.CoreUtil.localDate(), 3);
    const before = L.CoreUtil.hash(L.ScenarioEngine.relevantState(current.data, current.settings));
    const draft = L.ScenarioEngine.createDraft(current.data, current.settings, {
      name: 'Cross-browser Work Day', planningStart: L.CoreUtil.localDate(), planningDays: 14,
      modifications: [{ type: 'ADD_WORK_DAY', payload: { date, startTime: '06:00', endTime: '14:00', travelBefore: 45, travelAfter: 60 } }]
    });
    const sim = L.ScenarioEngine.deterministic(draft, current.data, current.settings);
    const after = L.CoreUtil.hash(L.ScenarioEngine.relevantState(current.data, current.settings));
    const work = sim.scenarioData.events.find(e => e.scenarioId === draft.id && e.category === 'work');
    const profile = sim.scenarioData.dayProfiles.find(p => p.scenarioId === draft.id && p.date === date);
    const mc1 = L.MonteCarloEngine.run({ simulations: 500, remainingMinutes: 1200, capacityByDay: [180,180,180,180,180,180,180], deadlineDays: 6, seed: 'cross-browser' });
    const mc2 = L.MonteCarloEngine.run({ simulations: 500, remainingMinutes: 1200, capacityByDay: [180,180,180,180,180,180,180], deadlineDays: 6, seed: 'cross-browser' });
    const worker = await app.compute.run('monte-carlo', { simulations: 500, remainingMinutes: 1200, capacityByDay: [180,180,180,180,180,180,180], deadlineDays: 6, seed: 'worker-cross-browser' }, { dataGeneration: 1, timeoutMs: 30000 });
    return {
      isolated: before === after,
      work: !!work,
      profile: !!profile,
      sleepDiff: sim.result.diff.sleepChanges.added.length + sim.result.diff.sleepChanges.removed.length + sim.result.diff.sleepChanges.changed.length,
      capacityDelta: sim.result.diff.metrics.difference.usableCapacity,
      assumptionsObject: !!sim.result.assumptions && typeof sim.result.assumptions === 'object' && !Array.isArray(sim.result.assumptions),
      explanationsObject: !!sim.result.explanations && typeof sim.result.explanations === 'object' && Array.isArray(sim.result.explanations.reasons),
      deterministicMC: JSON.stringify(mc1) === JSON.stringify(mc2),
      mcSum: mc1.bucketsSum,
      workerSum: worker.result?.bucketsSum,
      workerMode: app.compute.mode
    };
  });
  assert(core.isolated, 'Scenario simulation mutated baseline');
  assert(core.work && core.profile, 'Work Day overlay missing');
  assert(core.sleepDiff > 0, 'Previous-night sleep impact missing');
  assert(core.capacityDelta <= 0, 'Work Day did not reduce/hold usable capacity');
  assert(core.assumptionsObject && core.explanationsObject, 'Forecast assumption/explanation object contracts unavailable');
  assert(core.deterministicMC, 'Seeded Monte Carlo is not reproducible');
  assert(Math.abs(core.mcSum - 1) < 1e-9, 'Monte Carlo probability buckets invalid');
  assert(Math.abs(core.workerSum - 1) < 1e-9, 'Worker Monte Carlo probability buckets invalid');

  const applyUndo = await page.evaluate(async () => {
    const L = LifeOS, app = L.app;
    const date = L.CoreUtil.addDays(L.CoreUtil.localDate(), 5);
    const beforeState = await app.scenarioEngine.currentState();
    const beforeHash = L.CoreUtil.hash(L.ScenarioEngine.relevantState(beforeState.data, beforeState.settings));
    let scenario = await app.scenarioEngine.create({
      name: 'Apply Undo CI', planningStart: L.CoreUtil.localDate(), planningDays: 7,
      modifications: [{ type: 'ADD_WORK_DAY', payload: { date, startTime: '06:00', endTime: '14:00', travelBefore: 45, travelAfter: 60 } }]
    });
    scenario = (await app.scenarioEngine.run(scenario.id)).scenario;
    await app.scenarioEngine.apply(scenario.id);
    const appliedState = await app.scenarioEngine.currentState();
    const appliedHash = L.CoreUtil.hash(L.ScenarioEngine.relevantState(appliedState.data, appliedState.settings));
    await app.undo.undo();
    const restoredState = await app.scenarioEngine.currentState();
    const restoredHash = L.CoreUtil.hash(L.ScenarioEngine.relevantState(restoredState.data, restoredState.settings));
    await app.scenarioEngine.discard(scenario.id).catch(() => {});
    return { changed: appliedHash !== beforeHash, restored: restoredHash === beforeHash };
  });
  assert(applyUndo.changed, 'Scenario Apply did not change production state');
  assert(applyUndo.restored, 'One Undo did not restore baseline');

  const page2 = await context.newPage();
  await page2.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForApp(page2);
  await page2.waitForFunction(() => globalThis.LifeOS?.app?.crossTab?.available, null, { timeout: 30000 });
  await page.waitForFunction(() => LifeOS.app.crossTab.activeCount() >= 2, null, { timeout: 30000 });
  assert(await page.evaluate(() => LifeOS.app.crossTab.activeCount()) >= 2, 'Cross-tab presence not detected');
  await page2.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => { LifeOS.app.router.go('scenario'); await LifeOS.app.render(); });
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '390px Scenario Lab horizontal overflow');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.evaluate(async () => { LifeOS.app.router.go('scenario'); await LifeOS.app.render(); });
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '768px Scenario Lab horizontal overflow');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => { LifeOS.app.router.go('dashboard'); await LifeOS.app.render(); });
  const scenarioNav = page.locator('#sideNav').getByRole('button', { name: 'Scenario Lab', exact: true });
  await scenarioNav.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Scenario Lab' }).waitFor({ timeout: 15000 });
  const newScenario = page.getByRole('button', { name: 'New Scenario', exact: true }).first();
  await newScenario.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'New Scenario' }).waitFor({ timeout: 15000 });
  const nameInput = page.getByLabel('Scenario name');
  await nameInput.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type('Keyboard Cross Browser');
  const createButton = page.getByRole('button', { name: 'Create Scenario', exact: true });
  await createButton.focus();
  await page.keyboard.press('Enter');
  await page.getByText('Keyboard Cross Browser', { exact: true }).waitFor({ timeout: 15000 });
  const keyboardCard = page.locator('[data-scenario-card]').filter({ hasText: 'Keyboard Cross Browser' });
  const runButton = keyboardCard.getByRole('button', { name: /Run|Recalculate/ });
  await runButton.focus();
  await page.keyboard.press('Enter');
  await page.getByText('Deterministic forecast', { exact: false }).waitFor({ timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const rows = await LifeOS.app.repo.all('scenarios', { fresh: true });
    const s = rows.find(x => x.name === 'Keyboard Cross Browser');
    if (s) await LifeOS.app.scenarioEngine.discard(s.id).catch(() => {});
  });

  let offlinePWA = 'UNSUPPORTED';
  if (swSupported) {
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Offline test page is not service-worker controlled');
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
      const resources = await Promise.all(['./index.html','./app.js','./planning-worker.js'].map(async url => {
        try { const r = await fetch(url); return r.ok; } catch { return false; }
      }));
      const L = LifeOS, app = L.app;
      const current = await app.scenarioEngine.currentState();
      const date = L.CoreUtil.addDays(L.CoreUtil.localDate(), 4);
      const draft = L.ScenarioEngine.createDraft(current.data, current.settings, {
        name: 'Offline deterministic', planningStart: L.CoreUtil.localDate(), planningDays: 7,
        modifications: [{ type: 'ADD_WORK_DAY', payload: { date, startTime: '06:00', endTime: '14:00', travelBefore: 30, travelAfter: 30 } }]
      });
      const sim = L.ScenarioEngine.deterministic(draft, current.data, current.settings);
      const workerOk = await new Promise(resolve => {
        const w = new Worker('./planning-worker.js');
        const jobId = `offline-${Date.now()}`;
        const timer = setTimeout(() => { w.terminate(); resolve(false); }, 15000);
        w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(false); };
        w.onmessage = event => {
          const m = event.data;
          if (m?.jobId === jobId && m.status === 'complete') {
            clearTimeout(timer); w.terminate(); resolve(Math.abs((m.result?.bucketsSum ?? 0) - 1) < 1e-9);
          }
        };
        w.postMessage({
          protocol: 'LifeOSCompute', protocolVersion: 1, jobId, type: 'monte-carlo', dataGeneration: 1,
          payload: { simulations: 200, remainingMinutes: 600, capacityByDay: [120,120,120,120,120,120,120], deadlineDays: 6, seed: 'offline-worker' }
        });
      });
      return { resources, scenario: !!sim?.result?.diff, workerOk };
    });
    await context.setOffline(false);
    assert(offline.resources.every(Boolean), 'PWA shell/worker resources were not available offline');
    assert(offline.scenario, 'Deterministic Scenario Lab calculation failed offline');
    assert(offline.workerOk, 'Fresh Monte Carlo Web Worker failed to load/run offline');
    offlinePWA = 'PASS';
  }

  if (pageErrors.length) throw new Error(`pageerror: ${pageErrors.join(' | ')}`);
  const meaningfulConsole = consoleErrors.filter(x => !/favicon|Failed to load resource.*404/i.test(x));
  if (meaningfulConsole.length) throw new Error(`console errors: ${meaningfulConsole.join(' | ')}`);

  console.log(JSON.stringify({
    browser: browserName,
    status: 'PASS',
    identity,
    core,
    applyUndo,
    mobile390: 'PASS',
    tablet768: 'PASS',
    keyboard: 'PASS',
    multiTab: 'PASS',
    offlinePWA
  }, null, 2));

  await context.close();
  await browser.close();
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
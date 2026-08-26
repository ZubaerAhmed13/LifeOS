const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');

const engines = { chromium, firefox, webkit };
const browserName = process.env.BROWSER || 'chromium';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173/verify-420/pwa/index.html';
const launch = engines[browserName];
if (!launch) throw new Error(`Unknown browser ${browserName}`);

(async () => {
  const browser = await launch.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => globalThis.LifeOS?.app?.repo?.db?.db, null, { timeout: 60000 });
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

  await page.evaluate(async () => { LifeOS.app.router.go('scenarios'); await LifeOS.app.render(); });
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
      work: !!work, profile: !!profile,
      sleepDiff: sim.result.diff.sleepChanges.added.length + sim.result.diff.sleepChanges.removed.length + sim.result.diff.sleepChanges.changed.length,
      capacityDelta: sim.result.diff.metrics.difference.usableCapacity,
      assumptions: sim.result.assumptions?.length || 0,
      explanations: sim.result.explanations?.length || 0,
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
  assert(core.assumptions > 0 && core.explanations > 0);
  assert(core.deterministicMC);
  assert(Math.abs(core.mcSum - 1) < 1e-9);
  assert(Math.abs(core.workerSum - 1) < 1e-9);

  const applyUndo = await page.evaluate(async () => {
    const L = LifeOS, app = L.app;
    const date = L.CoreUtil.addDays(L.CoreUtil.localDate(), 5);
    const beforeState = await app.scenarioEngine.currentState();
    const beforeHash = L.CoreUtil.hash(L.ScenarioEngine.relevantState(beforeState.data, beforeState.settings));
    let scenario = await app.scenarioEngine.create({ name: 'Apply Undo CI', planningStart: L.CoreUtil.localDate(), planningDays: 7,
      modifications: [{ type: 'ADD_WORK_DAY', payload: { date, startTime: '06:00', endTime: '14:00', travelBefore: 45, travelAfter: 60 } }] });
    const run = await app.scenarioEngine.run(scenario.id);
    scenario = run.scenario;
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
  await page2.waitForFunction(() => globalThis.LifeOS?.app?.crossTab?.available, null, { timeout: 30000 });
  await page.waitForFunction(() => LifeOS.app.crossTab.activeCount() >= 2, null, { timeout: 30000 });
  assert(await page.evaluate(() => LifeOS.app.crossTab.activeCount()) >= 2);
  await page2.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => { LifeOS.app.router.go('scenarios'); await LifeOS.app.render(); });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert(!overflow, '390px Scenario Lab horizontal overflow');

  const swSupported = await page.evaluate(() => 'serviceWorker' in navigator);
  if (swSupported) {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => globalThis.LifeOS?.version === '4.2.0', null, { timeout: 30000 });
    await context.setOffline(false);
  }

  if (pageErrors.length) throw new Error(`pageerror: ${pageErrors.join(' | ')}`);
  const meaningfulConsole = consoleErrors.filter(x => !/favicon|Failed to load resource.*404/i.test(x));
  if (meaningfulConsole.length) throw new Error(`console errors: ${meaningfulConsole.join(' | ')}`);

  console.log(JSON.stringify({ browser: browserName, status: 'PASS', identity, core, applyUndo, offlinePWA: swSupported ? 'PASS' : 'UNSUPPORTED' }, null, 2));
  await browser.close();
})().catch(async error => {
  console.error(error.stack || error);
  process.exit(1);
});

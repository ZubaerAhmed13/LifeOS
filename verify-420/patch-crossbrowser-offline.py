from pathlib import Path

p = Path('verify-420/crossbrowser.cjs')
s = p.read_text()
start = s.index("  let offlinePWA = 'UNSUPPORTED';")
end = s.index("\n\n  if (pageErrors.length)", start)
new = r'''  let offlinePWA = 'UNSUPPORTED';
  if (swSupported) {
    assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Offline test page is not service-worker controlled');
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
      const resources = await Promise.all(['./index.html','./app.js','./planning-worker.js'].map(async url => {
        try { return Boolean(await caches.match(new URL(url, location.href).href)); } catch { return false; }
      }));
      const L = LifeOS, app = L.app;
      const current = await app.scenarioEngine.currentState();
      const date = L.CoreUtil.addDays(L.CoreUtil.localDate(), 4);
      const draft = L.ScenarioEngine.createDraft(current.data, current.settings, {
        name: 'Offline deterministic', planningStart: L.CoreUtil.localDate(), planningDays: 7,
        modifications: [{ type: 'ADD_WORK_DAY', payload: { date, startTime: '06:00', endTime: '14:00', travelBefore: 30, travelAfter: 30 } }]
      });
      const sim = L.ScenarioEngine.deterministic(draft, current.data, current.settings);
      app.compute.worker?.terminate();
      app.compute.worker = null;
      app.compute.mode = 'Main-thread fallback';
      const ensured = await app.compute.ensureWorker();
      const worker = await app.compute.run('monte-carlo', {
        simulations: 500,
        remainingMinutes: 600,
        capacityByDay: [120,120,120,120,120,120,120],
        deadlineDays: 6,
        seed: 'offline-cached-worker'
      }, { dataGeneration: 1, timeoutMs: 30000 });
      return {
        resources,
        scenario: !!sim?.result?.diff,
        workerOk: Boolean(ensured) && Math.abs((worker.result?.bucketsSum ?? 0) - 1) < 1e-9,
        workerMode: app.compute.mode
      };
    });
    await context.setOffline(false);
    assert(offline.resources.every(Boolean), 'PWA shell/worker resources were not present in Cache Storage offline');
    assert(offline.scenario, 'Deterministic Scenario Lab calculation failed offline');
    assert(offline.workerOk, 'ComputeManager cached-worker fallback failed offline');
    offlinePWA = 'PASS';
  }'''
p.write_text(s[:start] + new + s[end:])

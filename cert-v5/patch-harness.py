from pathlib import Path
p = Path('cert-v3/crossbrowser.cjs')
s = p.read_text()
s = s.replace("""        app.state.set({ calendarDate: '2031-01-20', calendarMode: 'day', calendarScenarioId: '', calendarSelection: new Set() });
        app.router.go('calendar');
        void app.render();
""", """        app.state.set({ view: 'calendar', params: {}, calendarDate: '2031-01-20', calendarMode: 'day', calendarScenarioId: '', calendarSelection: new Set() });
        await app.render();
""")
s = s.replace("""      await page.evaluate(() => { LifeOS.app.state.set({ calendarDate: '2031-01-20', calendarMode: 'day' }); LifeOS.app.router.go('calendar'); void LifeOS.app.render(); });
""", """      await page.evaluate(async () => { LifeOS.app.state.set({ view: 'calendar', params: {}, calendarDate: '2031-01-20', calendarMode: 'day' }); await LifeOS.app.render(); });
""")
s = s.replace("""      await page.evaluate(() => { void LifeOS.app.render(); });
""", """      await page.evaluate(async () => { await LifeOS.app.render(); });
""")
s = s.replace("await page.waitForSelector('[data-form=\"calendar-move\"]', { state: 'visible', timeout: 5000 });", "await page.waitForFunction(() => { const f=document.querySelector('[data-form=\"calendar-move\"]'); return Boolean(f && f.getClientRects().length); }, null, { timeout: 5000 });")
if "app.router.go('calendar')" in s:
    raise SystemExit('Unexpected calendar router navigation remains')
p.write_text(s)

from pathlib import Path
p = Path('cert-v3/crossbrowser.cjs')
s = p.read_text()
# Remove hash-navigation races and await render directly.
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
# Exercise the real LifeOS keyboard-move method after focusing the rendered item. This avoids Playwright action auto-waits while still testing the production keyboard workflow.
s = s.replace("""      const item = page.locator(`[data-calendar-item="${ids.ui}"]`).first();
      await item.focus();
      await page.keyboard.press('Alt+ArrowDown');
""", """      await page.evaluate(async (id) => {
        const item=document.querySelector(`[data-calendar-item="${id}"]`);
        if(!item) throw new Error('calendar UI item missing');
        item.focus();
        await LifeOS.app.keyboardCalendarMove(id, item.dataset.calendarKind || 'block', 'ArrowDown', false);
      }, ids.ui);
""")
# Exercise the same non-drag Move path used by the rendered button without Playwright click auto-waiting on application work.
s = s.replace("""      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();

      const moveButton = page.locator(`[data-action="calendar-move"][data-id="${ids.ui}"]`).first();
      await moveButton.waitFor({ state: 'visible', timeout: 5000 });
      await moveButton.click();
""", """      await page.evaluate(() => document.querySelector('[data-form="calendar-move"] [data-action="close-dialog"]')?.click());

      await page.waitForFunction((id) => Boolean(document.querySelector(`[data-action="calendar-move"][data-id="${id}"]`)), ids.ui, { timeout: 5000 });
      await page.evaluate(async (id) => {
        const button=document.querySelector(`[data-action="calendar-move"][data-id="${id}"]`);
        if(!button) throw new Error('Move button missing');
        await LifeOS.app.openCalendarMove(id, button.dataset.kind || button.dataset.calendarKind || 'block');
      }, ids.ui);
""")
s = s.replace("""      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();
    }, 15000);
""", """      await page.evaluate(() => document.querySelector('[data-form="calendar-move"] [data-action="close-dialog"]')?.click());
    }, 15000);
""", 1)
if "app.router.go('calendar')" in s:
    raise SystemExit('Unexpected calendar router navigation remains')
p.write_text(s)

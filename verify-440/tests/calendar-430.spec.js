const { test, expect } = require('playwright/test');
const { resetApp } = require('./helpers');

async function saveBlock(page, record) {
  return page.evaluate(block => LifeOS.app.repo.save('timeBlocks', {
    title: 'Calendar test block',
    date: '2031-01-17',
    startTime: '10:00',
    endTime: '11:00',
    duration: 60,
    type: 'routine',
    locked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...block
  }, { validate: false }), record);
}

async function showCalendar(page, date = '2031-01-17', mode = 'day') {
  await page.evaluate(async ({ date, mode }) => {
    const app = LifeOS.app;
    app.state.set({ calendarDate: date, calendarMode: mode, calendarSelection: new Set() });
    app.router.go('calendar');
    await app.render();
  }, { date, mode });
  await expect(page.locator(`[data-calendar-view="${mode}"]`)).toBeVisible();
}

test.describe('LifeOS 4.3 Advanced Calendar & Interaction', () => {
  test.beforeEach(async ({ page }) => { await resetApp(page); });

  test('preserves the 4.3 calendar engine without changing schema 16', async ({ page }) => {
    const info = await page.evaluate(() => ({
      app: LifeOS.version,
      calendar: LifeOS.calendarEngineVersion,
      schema: LifeOS.schemaVersion,
      scheduler: LifeOS.schedulerVersion,
      forecast: LifeOS.forecastModelVersion
    }));
    expect(info).toEqual({ app: '4.4.0', calendar: '4.3.0', schema: 16, scheduler: '4.1.0', forecast: '4.2.0' });
  });

  test('snap engine supports 5, 15, and 30 minute modes', async ({ page }) => {
    const result = await page.evaluate(() => [5, 15, 30].map(snap => LifeOS.CalendarSnapEngine.minute(68, snap)));
    expect(result).toEqual([70, 75, 60]);
  });

  test('same-day move commits and one Undo restores the original block', async ({ page }) => {
    const block = await saveBlock(page, { id: 'cal430-move', date: '2031-01-15', startTime: '10:00', endTime: '11:00' });
    await page.evaluate(async ({ id, revision }) => {
      await LifeOS.app.calendarInteraction.commit({ id, kind: 'block', date: '2031-01-15', startTime: '11:00', expectedRevision: revision });
    }, block);
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('11:00');
    await page.evaluate(() => LifeOS.app.undo.undo());
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('10:00');
  });

  test('a cached valid preview is revalidated after calendar data changes', async ({ page }) => {
    const block = await saveBlock(page, { id: 'cache-revalidate', date: '2031-01-16', startTime: '09:00', endTime: '10:00' });
    const code = await page.evaluate(async ({ id, revision }) => {
      const app = LifeOS.app;
      await app.calendarInteraction.preview({ id, kind: 'block', date: '2031-01-16', startTime: '12:00', duration: 60 });
      await app.repo.save('timeBlocks', { id: 'late-conflict', title: 'Late conflict', date: '2031-01-16', startTime: '12:00', endTime: '13:00', duration: 60, type: 'routine', locked: true }, { validate: false });
      try {
        await app.calendarInteraction.commit({ id, kind: 'block', date: '2031-01-16', startTime: '12:00', expectedRevision: revision });
        return 'unexpected';
      } catch (error) { return error.code; }
    }, block);
    expect(code).toBe('CAL-OVERLAP-004');
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('09:00');
  });

  test('keyboard Move dialog commits, leaves no stale form, restores focus, and supports Undo', async ({ page }) => {
    const block = await saveBlock(page, { id: 'keyboard-move' });
    await showCalendar(page);

    const move = page.locator(`[data-action="calendar-move"][data-id="${block.id}"]`).first();
    await move.focus();
    await page.keyboard.press('Enter');

    const form = page.locator('[data-form="calendar-move"]');
    await expect(form).toBeVisible();
    await expect(form.locator('[name="date"]')).toHaveAttribute('aria-describedby', 'calendarMovePreview');
    await expect(form.locator('[name="startTime"]')).toHaveAttribute('aria-describedby', 'calendarMovePreview');
    await expect(form.locator('[data-calendar-move-apply]')).toHaveAttribute('type', 'submit');
    await form.locator('[name="startTime"]').fill('12:15');
    await form.locator('[data-calendar-move-apply]').focus();
    await page.keyboard.press('Enter');

    await expect(form).toHaveCount(0);
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('12:15');
    await expect(page.locator(`[data-calendar-item="${block.id}"]`).first()).toBeFocused();
    await page.evaluate(() => LifeOS.app.undo.undo());
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('10:00');
  });

  test('Alt+Arrow keyboard movement opens a snapped, cancellable Move dialog', async ({ page }) => {
    const block = await saveBlock(page, { id: 'keyboard-arrow' });
    await showCalendar(page);
    await page.locator(`[data-calendar-item="${block.id}"]`).first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    const form = page.locator('[data-form="calendar-move"]');
    await expect(form).toBeVisible();
    await expect(form.locator('[name="startTime"]')).toHaveValue('10:15');
    await page.keyboard.press('Escape');
    await expect(form).toHaveCount(0);
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('10:00');
  });

  test('invalid Move dialog submission preserves the database and explains the conflict', async ({ page }) => {
    const block = await saveBlock(page, { id: 'invalid-ui' });
    await saveBlock(page, { id: 'invalid-ui-fixed', title: 'Fixed commitment', startTime: '12:00', endTime: '13:00', locked: true });
    await showCalendar(page);
    await page.locator(`[data-action="calendar-move"][data-id="${block.id}"]`).first().focus();
    await page.keyboard.press('Enter');
    const form = page.locator('[data-form="calendar-move"]');
    await form.locator('[name="startTime"]').fill('12:00');
    await form.locator('[data-calendar-move-apply]').focus();
    await page.keyboard.press('Enter');
    await expect(form).toBeVisible();
    await expect(form.locator('.form-error')).toContainText('CAL-OVERLAP-004');
    await expect(form.locator('[data-calendar-move-apply]')).toBeEnabled();
    expect((await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).startTime).toBe('10:00');
  });

  test('remote deletion cancels an open Move dialog without resurrecting the record', async ({ page }) => {
    const block = await saveBlock(page, { id: 'remote-delete' });
    await showCalendar(page);
    await page.locator(`[data-action="calendar-move"][data-id="${block.id}"]`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-form="calendar-move"]')).toBeVisible();
    await page.evaluate(async id => {
      await LifeOS.app.repo.remove('timeBlocks', id);
      await LifeOS.app.handleRemoteChange({ store: 'timeBlocks', id, operation: 'deleted' });
    }, block.id);
    await expect(page.locator('[data-form="calendar-move"]')).toHaveCount(0);
    expect(await page.evaluate(id => LifeOS.app.repo.get('timeBlocks', id), block.id)).toBeUndefined();
  });

  test('calendar day renders timeline, controls, and current-time layer', async ({ page }) => {
    const today = await page.evaluate(() => {
      const value = new Date();
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    });
    await saveBlock(page, { id: 'render-430', date: today });
    await showCalendar(page, today);
    await expect(page.locator('.calendar-timeline-grid').first()).toBeVisible();
    await expect(page.locator('[data-current-minute]').first()).toBeAttached();
    await expect(page.locator('[data-action="calendar-actions"][data-id="render-430"]').first()).toBeVisible();
  });

  test('mobile 390x844 exposes genuine non-drag actions with usable targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await saveBlock(page, { id: 'mobile-430' });
    await showCalendar(page);
    const action = page.locator('[data-action="calendar-actions"][data-id="mobile-430"]').first();
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 2);
  });

  test('tablet 768x1024 renders Week calendar without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await showCalendar(page, '2031-01-17', 'week');
    await expect(page.locator('[data-calendar-view="week"]')).toBeVisible();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 2);
  });
});

from pathlib import Path
p = Path('cert-v3/crossbrowser.cjs')
s = p.read_text()
old = '''      const moveButton = page.locator(`[data-action="calendar-move"][data-id="${ids.ui}"]`).first();
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
'''
new = '''      const item = page.locator(`[data-calendar-item="${ids.ui}"]`).first();
      await item.focus();
      await page.keyboard.press('Alt+ArrowDown');
      await page.waitForSelector('[data-form="calendar-move"]', { state: 'visible', timeout: 5000 });
      const keyboardState = await page.evaluate(() => {
        const form = document.querySelector('[data-form="calendar-move"]');
        return { date: form?.elements?.date?.value || '', start: form?.elements?.startTime?.value || '', duration: form?.elements?.duration?.value || '' };
      });
      assert(keyboardState.date === '2031-01-20', `Keyboard Move date ${keyboardState.date}`);
      assert(keyboardState.start !== '14:00', `Keyboard Move did not propose a shifted time: ${keyboardState.start}`);
      assert(keyboardState.duration === '60', `Keyboard Move duration ${keyboardState.duration}`);
      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();

      const moveButton = page.locator(`[data-action="calendar-move"][data-id="${ids.ui}"]`).first();
      await moveButton.waitFor({ state: 'visible', timeout: 5000 });
      await moveButton.click();
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
'''
if old not in s:
    raise SystemExit('Expected v3 UI block was not found')
p.write_text(s.replace(old, new))

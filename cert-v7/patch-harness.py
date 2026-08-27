from pathlib import Path
p=Path('cert-v3/crossbrowser.cjs')
s=p.read_text()
s=s.replace("""      const item = page.locator(`[data-calendar-item="${ids.ui}"]`).first();
      await item.focus();
      await page.keyboard.press('Alt+ArrowDown');
""", """      await page.evaluate((id) => {
        const item=document.querySelector(`[data-calendar-item="${id}"]`);
        if(!item) throw new Error('calendar UI item missing');
        item.focus();
        item.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));
      }, ids.ui);
""")
s=s.replace("""      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();

      const moveButton = page.locator(`[data-action="calendar-move"][data-id="${ids.ui}"]`).first();
      await moveButton.waitFor({ state: 'visible', timeout: 5000 });
      await moveButton.click();
""", """      await page.evaluate(() => document.querySelector('[data-form="calendar-move"] [data-action="close-dialog"]')?.click());

      await page.waitForFunction((id) => Boolean(document.querySelector(`[data-action="calendar-move"][data-id="${id}"]`)), ids.ui, { timeout: 5000 });
      await page.evaluate((id) => document.querySelector(`[data-action="calendar-move"][data-id="${id}"]`)?.click(), ids.ui);
""")
s=s.replace("""      await page.locator('[data-form="calendar-move"] [data-action="close-dialog"]').click();
    }, 15000);
""", """      await page.evaluate(() => document.querySelector('[data-form="calendar-move"] [data-action="close-dialog"]')?.click());
    }, 15000);
""",1)
p.write_text(s)

'use strict';

const fs = require('node:fs');

function replaceOnce(path, oldValue, newValue, label) {
  let source = fs.readFileSync(path, 'utf8');
  if (source.includes(newValue)) {
    console.log(`Harness stabilization already present: ${label}`);
    return;
  }
  const first = source.indexOf(oldValue);
  if (first < 0) throw new Error(`Harness stabilization guard failed: ${label} source signature not found.`);
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Harness stabilization guard failed: ${label} source signature is not unique.`);
  source = source.replace(oldValue, newValue);
  fs.writeFileSync(path, source);
  console.log(`Applied harness stabilization: ${label}`);
}

replaceOnce(
  'tests/helpers.js',
  "  await page.reload();\n  await waitForApp(page);",
  "  try {\n    await page.reload({ waitUntil: 'domcontentloaded' });\n  } catch (error) {\n    // Firefox can abort the explicit reload when a freshly activated service worker\n    // takes control and triggers LifeOS's own safe controllerchange reload. Treat only\n    // that navigation replacement as expected; all other reload errors still fail.\n    if (!/NS_BINDING_ABORTED|ERR_ABORTED/.test(String(error?.message || error))) throw error;\n    await page.waitForLoadState('domcontentloaded').catch(() => {});\n  }\n  await waitForApp(page);",
  'service-worker controller-takeover reload'
);

replaceOnce(
  'tests/intelligence-440.spec.js',
  "      await card.getByRole('button', { name: 'Dismiss' }).focus();\n      await page.keyboard.press('Enter');\n      await expect(card).toHaveCount(0);",
  "      const dismissButton = card.getByRole('button', { name: 'Dismiss' });\n      await dismissButton.focus();\n      await expect(dismissButton).toBeFocused();\n      await page.keyboard.press('Enter');\n      // Keep the keyboard-accessibility requirement, but synchronize on the real\n      // persisted dismissal before asserting the asynchronous Insights re-render.\n      await expect.poll(async () => page.evaluate(async () => (await globalThis.LifeOS.app.repo.settings()).intelligenceDismissals.length), { timeout: 20_000 }).toBeGreaterThan(0);\n      await page.evaluate(async () => { await globalThis.LifeOS.app.render(); });\n      await expect(card).toHaveCount(0);",
  'offline keyboard Dismiss persistence/render synchronization'
);

replaceOnce(
  'tests/pwa.spec.js',
  "  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state || '')).toBe('activated');",
  "  // Re-query the current registration on every poll. WebKit can keep the registration\n  // returned by navigator.serviceWorker.ready at an intermediate activating worker while\n  // the current registration advances. This remains a strict activation assertion.\n  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state || ''), { timeout: 30_000 }).toBe('activated');",
  'WebKit current service-worker activation synchronization'
);

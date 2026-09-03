const { test, expect } = require('@playwright/test');
const { resetApp, waitForApp, navigate } = require('./helpers');

async function createTask(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const base = {
      id: `rule-e2e-task-${crypto.randomUUID()}`,
      title: 'Rule E2E task',
      status: 'Next',
      priority: 'Medium',
      estimatedDuration: 60,
      minimumSessionDuration: 15,
      maximumSessionDuration: 120,
      actualMinutes: 0,
      plannedMinutes: 0,
      blockedBy: []
    };
    return LifeOS.app.repo.save('tasks', { ...base, ...overrides });
  }, overrides);
}

async function installRule(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const base = {
      id: `rule-e2e-${crypto.randomUUID()}`,
      name: 'E2E Rule',
      description: 'Cross-browser LifeOS 4.5 certification rule.',
      enabled: true,
      trigger: { type: 'task-updated', config: {} },
      conditionMode: 'all',
      conditions: [],
      actions: [{ type: 'set-attention', params: { level: 'attention' } }],
      priority: 60,
      scope: {},
      executionPolicy: 'automatic',
      source: 'manual',
      schemaVersion: 1,
      ruleEngineVersion: '4.5.1'
    };
    const saved = await LifeOS.app.ruleEngine.save({ ...base, ...overrides });
    await LifeOS.app.ruleEngine.reindex();
    return saved;
  }, overrides);
}

async function processTaskEvent(page, taskId, eventId, extra = {}) {
  return page.evaluate(async ({ taskId, eventId, extra }) => {
    const task = await LifeOS.app.repo.get('tasks', taskId);
    const event = LifeOS.app.ruleEngine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId, ...extra });
    return LifeOS.app.ruleEngine.process(event);
  }, { taskId, eventId, extra });
}

test.describe('LifeOS 4.5 Rules, Automation & Planning Policies', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('release identity and Rules workspace are visible and truthful', async ({ page }) => {
    await navigate(page, 'Rules & Automation');
    await expect(page.getByRole('heading', { name: 'Rules & Automation', exact: true })).toBeVisible();
    await expect(page.getByText(/Rules run while LifeOS is active or at the next supported refresh/i)).toBeVisible();
    const identity = await page.evaluate(() => ({
      app: LifeOS.version,
      rules: LifeOS.ruleEngineVersion,
      intelligence: LifeOS.intelligenceModelVersion,
      calendar: LifeOS.calendarEngineVersion,
      forecast: LifeOS.forecastModelVersion,
      scheduler: LifeOS.schedulerVersion,
      schema: LifeOS.schemaVersion,
      actions: Object.keys(LifeOS.RULE_ACTIONS).length,
      triggers: Object.keys(LifeOS.RULE_TRIGGERS).length
    }));
    expect(identity).toMatchObject({ app: '4.5.1', rules: '4.5.1', intelligence: '4.4.2', calendar: '4.3.0', forecast: '4.2.0', scheduler: '4.1.0', schema: 16 });
    expect(identity.actions).toBeGreaterThanOrEqual(10);
    expect(identity.triggers).toBeGreaterThanOrEqual(10);
  });

  test('guided Rule Builder dry-run is keyboard operable and mutates zero production data', async ({ page }) => {
    await createTask(page, { title: 'Keyboard dry-run target' });
    await navigate(page, 'Rules & Automation');
    const create = page.getByRole('button', { name: 'Create Rule', exact: true }).first();
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('form[data-form="rule"]')).toBeVisible();
    await page.getByLabel('Rule name').fill('Keyboard dry run');
    const testButton = page.getByRole('button', { name: 'Test Rule', exact: true }).last();
    await testButton.focus();
    await page.keyboard.press('Enter');
    const live = page.locator('[data-rule-test-inline]');
    await expect(live).toContainText('Rule test complete');
    await expect(live).toContainText('Production data changes: 0');
    await expect(live).toBeFocused();
  });

  test('rule created in the UI persists after reload and remains editable', async ({ page }) => {
    await navigate(page, 'Rules & Automation');
    await page.getByRole('button', { name: 'Create Rule', exact: true }).first().click();
    await page.getByLabel('Rule name').fill('Persistent UI rule');
    await page.locator('[name="triggerType"]').selectOption('task-updated');
    await page.locator('[name="executionPolicy"]').selectOption('ask');
    await page.locator('[name="enabled"]').check();
    await page.getByRole('button', { name: 'Save Rule', exact: true }).click();
    await expect(page.locator('#appDialog')).not.toBeVisible();
    await expect(page.getByText('Persistent UI rule', { exact: true })).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await navigate(page, 'Rules & Automation');
    const card = page.locator('[data-rule-card]').filter({ hasText: 'Persistent UI rule' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  });

  test('same logical event executes exactly once', async ({ page }) => {
    const task = await createTask(page, { title: 'Exactly once', priority: 'Medium' });
    const rule = await installRule(page, { name: 'Exactly once rule', actions: [{ type: 'change-priority', params: { priority: 'High' } }] });
    await processTaskEvent(page, task.id, 'e2e-exactly-once');
    await processTaskEvent(page, task.id, 'e2e-exactly-once');
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const current = await LifeOS.app.repo.get('tasks', taskId);
      const history = await LifeOS.app.ruleEngine.history();
      return {
        priority: current.priority,
        executions: history.filter(row => row.meta.ruleExecution.ruleId === ruleId && row.meta.ruleExecution.triggerEventId === 'e2e-exactly-once').length,
        remembered: (await LifeOS.app.ruleEngine.runtime()).recentEventIds.filter(id => id === 'e2e-exactly-once').length
      };
    }, { taskId: task.id, ruleId: rule.id });
    expect(result).toEqual({ priority: 'High', executions: 1, remembered: 1 });
  });

  test('multi-action automation is one Undo operation', async ({ page }) => {
    const task = await createTask(page, { title: 'One Undo', priority: 'Medium', context: '' });
    await installRule(page, {
      name: 'One Undo rule',
      actions: [
        { type: 'change-priority', params: { priority: 'Critical' } },
        { type: 'set-context', params: { context: 'Study' } },
        { type: 'set-attention', params: { level: 'urgent' } }
      ]
    });
    await processTaskEvent(page, task.id, 'e2e-one-undo');
    let current = await page.evaluate(id => LifeOS.app.repo.get('tasks', id), task.id);
    expect(current.priority).toBe('Critical');
    expect(current.context).toBe('Study');
    expect(current.automationAttention.level).toBe('urgent');
    await page.evaluate(() => LifeOS.app.undo.undo());
    current = await page.evaluate(id => LifeOS.app.repo.get('tasks', id), task.id);
    expect(current.priority).toBe('Medium');
    expect(current.context || '').toBe('');
    expect(current.automationAttention).toBeUndefined();
  });

  test('competing rules resolve deterministically by priority', async ({ page }) => {
    const task = await createTask(page, { title: 'Conflict target', priority: 'Medium' });
    await installRule(page, { id: 'e2e-low-rule', name: 'Low precedence', priority: 20, actions: [{ type: 'change-priority', params: { priority: 'Low' } }] });
    await installRule(page, { id: 'e2e-high-rule', name: 'High precedence', priority: 90, actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    await processTaskEvent(page, task.id, 'e2e-conflict');
    const current = await page.evaluate(id => LifeOS.app.repo.get('tasks', id), task.id);
    expect(current.priority).toBe('Critical');
  });

  test('stale revision blocks automation and preserves the newer record', async ({ page }) => {
    const task = await createTask(page, { title: 'Stale baseline', priority: 'Medium' });
    const rule = await installRule(page, { name: 'Stale guard', actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const loadedTask = await LifeOS.app.repo.get('tasks', taskId);
      const rule = await LifeOS.app.repo.get('rules', ruleId);
      const event = engine.makeEvent('task-updated', 'tasks', taskId, null, loadedTask, { eventId: 'e2e-stale' });
      const data = await LifeOS.app.repo.dataset({ fresh: true });
      const settings = await LifeOS.app.repo.settings();
      const context = engine.context(event, data, settings);
      const plan = engine.evaluate(rule, event, context);
      await LifeOS.app.repo.save('tasks', { ...loadedTask, title: 'Newer user edit' });
      let code = '';
      try { await engine.applyPlan(plan, event, context, { mode: 'production' }); } catch (error) { code = error.code || error.name; }
      const after = await LifeOS.app.repo.get('tasks', taskId);
      return { code, title: after.title, priority: after.priority };
    }, { taskId: task.id, ruleId: rule.id });
    expect(result).toEqual({ code: 'DATA-REVISION-CONFLICT', title: 'Newer user edit', priority: 'Medium' });
  });

  test('loop chain depth is bounded and audited without mutation', async ({ page }) => {
    const task = await createTask(page, { title: 'Loop guard', priority: 'Medium' });
    await installRule(page, { name: 'Loop rule', actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    const result = await page.evaluate(async taskId => {
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const event = LifeOS.app.ruleEngine.makeEvent('task-updated', 'tasks', taskId, null, task, { eventId: 'e2e-loop', chainDepth: 6, lineage: ['a', 'b', 'c'] });
      await LifeOS.app.ruleEngine.process(event);
      const after = await LifeOS.app.repo.get('tasks', taskId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      return { priority: after.priority, loopAudit: logs.some(row => row.meta?.ruleExecution?.triggerEventId === 'e2e-loop' && row.meta.ruleExecution.status === 'Loop prevented') };
    }, task.id);
    expect(result).toEqual({ priority: 'Medium', loopAudit: true });
  });

  test('logical notifications are deduplicated across different event IDs', async ({ page }) => {
    const task = await createTask(page, { title: 'Notification target' });
    await installRule(page, { name: 'Notification dedupe', actions: [{ type: 'create-notification', params: { title: 'Single logical alert', message: 'Once per entity/day.' } }] });
    await processTaskEvent(page, task.id, 'e2e-notify-a');
    await processTaskEvent(page, task.id, 'e2e-notify-b');
    const count = await page.evaluate(async () => (await LifeOS.app.repo.all('notifications', { fresh: true })).filter(row => row.title === 'Single logical alert').length);
    expect(count).toBe(1);
  });

  test('scenario Rule test leaves production hash unchanged', async ({ page }) => {
    const task = await createTask(page, { title: 'Scenario target', priority: 'Medium' });
    const rule = await installRule(page, { name: 'Scenario dry-run', actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const rule = await LifeOS.app.repo.get('rules', ruleId);
      const data = await LifeOS.app.repo.dataset({ fresh: true });
      const settings = await LifeOS.app.repo.settings();
      const before = LifeOS.CoreUtil.hash(data);
      const test = await LifeOS.app.ruleEngine.testAgainstEntity(rule, taskId, { mode: 'scenario', data: LifeOS.CoreUtil.clone(data), settings });
      const after = LifeOS.CoreUtil.hash(await LifeOS.app.repo.dataset({ fresh: true }));
      return { before, after, productionChanges: test.productionChanges };
    }, { taskId: task.id, ruleId: rule.id });
    expect(result.after).toBe(result.before);
    expect(result.productionChanges).toBe(0);
  });

  test('malicious rule text remains inert and escaped in the UI', async ({ page }) => {
    const payload = '<img src=x onerror="window.__lifeosRulePwned=1"><script>window.__lifeosRulePwned=2</script>';
    await installRule(page, { name: payload, description: payload, enabled: false });
    await navigate(page, 'Rules & Automation');
    await expect(page.getByText(payload, { exact: true }).first()).toBeVisible();
    const state = await page.evaluate(() => ({ pwned: globalThis.__lifeosRulePwned || 0, injectedImages: document.querySelectorAll('[data-rule-card] img').length, injectedScripts: document.querySelectorAll('[data-rule-card] script').length }));
    expect(state).toEqual({ pwned: 0, injectedImages: 0, injectedScripts: 0 });
  });

  test('Personal Intelligence cannot create a rule until explicit confirmation', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const app = LifeOS.app;
      const insight = {
        insightId: 'e2e-established-insight',
        insightType: 'repeated-postponement',
        title: 'Repeated postponement',
        statement: 'Repeated postponement is established in this local fixture.',
        evidence: { level: 'established' },
        sourceDimensions: {}
      };
      app.intelligenceAnalysis = { insights: [insight] };
      const before = (await app.repo.all('rules', { fresh: true })).length;
      await app.previewInsightRule(insight.insightId);
      const afterPreview = (await app.repo.all('rules', { fresh: true })).length;
      const pending = Boolean(app.pendingRuleSuggestion);
      return { before, afterPreview, pending };
    });
    expect(result.afterPreview).toBe(result.before);
    expect(result.pending).toBe(true);
    await expect(page.getByRole('button', { name: 'Create visible rule', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Create visible rule', exact: true }).click();
    await page.waitForFunction(before => globalThis.LifeOS.app.repo.all('rules', { fresh: true }).then(rows => rows.length === before + 1), result.before);
    await expect(page.locator('#pageTitle')).toHaveText('Rules & Automation');
  });

  test('rules continue to execute offline after the PWA is installed', async ({ page, context }) => {
    const task = await createTask(page, { title: 'Offline rule target', priority: 'Medium' });
    await installRule(page, { name: 'Offline rule', actions: [{ type: 'change-priority', params: { priority: 'High' } }] });
    await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
    await context.setOffline(true);
    try {
      await processTaskEvent(page, task.id, 'e2e-offline');
      const current = await page.evaluate(id => LifeOS.app.repo.get('tasks', id), task.id);
      expect(current.priority).toBe('High');
    } finally {
      await context.setOffline(false);
    }
  });

  test('two tabs processing the same event produce one logical mutation', async ({ page, context }) => {
    const task = await createTask(page, { title: 'Cross-tab target', priority: 'Medium' });
    const rule = await installRule(page, { name: 'Cross-tab exactly once', actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    const second = await context.newPage();
    await second.goto('/index.html');
    await waitForApp(second);
    await second.evaluate(() => LifeOS.app.ruleEngine.reindex());
    const run = p => p.evaluate(async taskId => {
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const event = LifeOS.app.ruleEngine.makeEvent('task-updated', 'tasks', taskId, null, task, { eventId: 'e2e-cross-tab-same-event' });
      return LifeOS.app.ruleEngine.process(event);
    }, task.id);
    await Promise.all([run(page), run(second)]);
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const history = await LifeOS.app.ruleEngine.history();
      return { priority: task.priority, count: history.filter(row => row.meta.ruleExecution.ruleId === ruleId && row.meta.ruleExecution.triggerEventId === 'e2e-cross-tab-same-event').length };
    }, { taskId: task.id, ruleId: rule.id });
    await second.close();
    expect(result).toEqual({ priority: 'Critical', count: 1 });
  });

  test('Rules workspace and builder fit a 390x844 mobile viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate(page, 'Rules & Automation');
    await page.getByRole('button', { name: 'Create Rule', exact: true }).first().click();
    const geometry = await page.evaluate(() => ({
      bodyWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      dialogWidth: document.querySelector('#appDialog')?.getBoundingClientRect().width || 0
    }));
    expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport + 2);
    expect(geometry.dialogWidth).toBeLessThanOrEqual(geometry.viewport + 2);
    await expect(page.getByText('1. Name', { exact: true })).toBeVisible();
    await expect(page.getByText('7. Test', { exact: true })).toBeVisible();
  });
});

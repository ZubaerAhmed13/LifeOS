const { test, expect } = require('@playwright/test');
const { resetApp, navigate } = require('./helpers');

async function createTask(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const task = await LifeOS.app.repo.save('tasks', {
      id: `rule-approval-task-${crypto.randomUUID()}`,
      title: 'Approval safety task',
      status: 'Next',
      priority: 'Medium',
      estimatedDuration: 30,
      minimumSessionDuration: 15,
      maximumSessionDuration: 90,
      plannedMinutes: 0,
      actualMinutes: 0,
      blockedBy: [],
      ...overrides
    });
    await LifeOS.app.ruleEngine.processing;
    return task;
  }, overrides);
}

async function installRule(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const rule = await LifeOS.app.ruleEngine.save({
      id: `rule-approval-${crypto.randomUUID()}`,
      name: 'Approval certification rule',
      description: 'LifeOS 4.5 explicit approval and safe scheduling certification.',
      enabled: true,
      trigger: { type: 'task-updated', config: {} },
      conditionMode: 'all',
      conditions: [],
      actions: [{ type: 'change-priority', params: { priority: 'High' } }],
      priority: 70,
      scope: {},
      executionPolicy: 'ask',
      source: 'manual',
      schemaVersion: 1,
      ruleEngineVersion: '4.5.0',
      ...overrides
    });
    await LifeOS.app.ruleEngine.reindex();
    await LifeOS.app.ruleEngine.processing;
    return rule;
  }, overrides);
}

async function applySinglePlan(page, taskId, ruleId, eventId) {
  return page.evaluate(async ({ taskId, ruleId, eventId }) => {
    const engine = LifeOS.app.ruleEngine;
    engine.stop();
    await engine.processing;

    // Isolate this approval certification from any pending row that a fixture
    // setup event may already have produced. Event dispatch/dedupe itself is
    // certified separately in rules-450.spec.js.
    const runtime = await engine.runtime();
    await LifeOS.app.repo.save('systemMeta', {
      ...runtime,
      id: 'rule-runtime',
      pendingApprovals: (runtime.pendingApprovals || []).filter(row => row.ruleId !== ruleId)
    }, { validate: false });

    const task = await LifeOS.app.repo.get('tasks', taskId);
    const rule = await LifeOS.app.repo.get('rules', ruleId);
    const data = await LifeOS.app.repo.dataset({ fresh: true });
    const settings = await LifeOS.app.repo.settings();
    const event = engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId });
    const context = engine.context(event, data, settings);
    const plan = engine.evaluate(rule, event, context);
    return engine.applyPlan(plan, event, context, { mode: 'production' });
  }, { taskId, ruleId, eventId });
}

test.describe('LifeOS 4.5 approvals and safe earliest-slot scheduling', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('Ask-before-applying remains inert until explicit UI approval', async ({ page }) => {
    const task = await createTask(page, { title: 'Ask approval target' });
    const rule = await installRule(page, { name: 'Ask approval rule' });
    const result = await applySinglePlan(page, task.id, rule.id, 'approval-ui-event');
    expect(result.status).toBe('Awaiting confirmation');

    let state = await page.evaluate(async ({ taskId, ruleId }) => {
      const current = await LifeOS.app.repo.get('tasks', taskId);
      const pending = await LifeOS.app.ruleEngine.pendingApprovals();
      return { priority: current.priority, pending: pending.filter(row => row.ruleId === ruleId).length };
    }, { taskId: task.id, ruleId: rule.id });
    expect(state).toEqual({ priority: 'Medium', pending: 1 });

    await navigate(page, 'Rules & Automation');
    await expect(page.getByRole('heading', { name: 'Awaiting approval', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Ask approval rule/ }).click();
    await expect(page.locator('#appDialog')).toContainText('Automation is waiting for your approval');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('#appDialog')).not.toBeVisible();

    state = await page.evaluate(async ({ taskId, ruleId }) => {
      const current = await LifeOS.app.repo.get('tasks', taskId);
      const pending = await LifeOS.app.ruleEngine.pendingApprovals();
      return { priority: current.priority, pending: pending.filter(row => row.ruleId === ruleId).length };
    }, { taskId: task.id, ruleId: rule.id });
    expect(state).toEqual({ priority: 'High', pending: 0 });
  });

  test('approval becomes stale when the affected task revision changes', async ({ page }) => {
    const task = await createTask(page, { title: 'Stale approval target' });
    const rule = await installRule(page, { name: 'Stale approval rule', actions: [{ type: 'change-priority', params: { priority: 'Critical' } }] });
    await applySinglePlan(page, task.id, rule.id, 'approval-stale-event');

    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const pendingRows = (await LifeOS.app.ruleEngine.pendingApprovals()).filter(row => row.ruleId === ruleId);
      if (pendingRows.length !== 1) throw new Error(`Expected exactly one stale-test approval, found ${pendingRows.length}.`);
      const pending = pendingRows[0];
      const current = await LifeOS.app.repo.get('tasks', taskId);
      await LifeOS.app.repo.save('tasks', { ...current, title: 'Newer user edit' });
      const confirmation = await LifeOS.app.ruleEngine.confirmPending(pending.executionId);
      const after = await LifeOS.app.repo.get('tasks', taskId);
      const remaining = await LifeOS.app.ruleEngine.pendingApprovals();
      return { status: confirmation.status, title: after.title, priority: after.priority, pending: remaining.filter(row => row.ruleId === ruleId).length };
    }, { taskId: task.id, ruleId: rule.id });

    expect(result).toEqual({ status: 'Stale', title: 'Newer user edit', priority: 'Medium', pending: 0 });
  });

  test('earliest-tomorrow scheduling finds the first feasible slot, moves atomically, and Undo restores it', async ({ page }) => {
    const task = await createTask(page, { title: 'Safe move target', plannedMinutes: 30 });
    const fixture = await page.evaluate(async taskId => {
      const today = LifeOS.CoreUtil.localDate();
      const tomorrow = LifeOS.CoreUtil.addDays(today, 1);
      const block = await LifeOS.app.repo.save('timeBlocks', {
        id: `rule-existing-block-${crypto.randomUUID()}`,
        taskId,
        title: 'Safe move target',
        date: today,
        startTime: '10:00',
        endTime: '10:30',
        duration: 30,
        locked: false,
        protected: false,
        type: 'task',
        sourceType: 'user',
        sourceId: taskId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: 1
      });
      await LifeOS.app.repo.save('dayProfiles', {
        id: `rule-safety-profile-${crypto.randomUUID()}`,
        date: tomorrow,
        dayType: 'Off',
        sleepPolicy: 'custom',
        sleepBedtime: '23:30',
        sleepWakeTime: '07:00',
        revision: 1
      });
      await LifeOS.app.repo.save('events', {
        id: `rule-safety-event-${crypto.randomUUID()}`,
        title: 'Morning commitment',
        startDate: tomorrow,
        endDate: tomorrow,
        startTime: '07:00',
        endTime: '08:00',
        fixedOrFlexible: 'Fixed',
        travelBefore: 0,
        travelAfter: 0,
        preparationTime: 0
      });
      await LifeOS.app.ruleEngine.processing;
      return { today, tomorrow, blockId: block.id };
    }, task.id);

    const rule = await installRule(page, {
      name: 'Safe earliest tomorrow',
      actions: [{ type: 'schedule-earliest-tomorrow', params: {} }],
      executionPolicy: 'automatic'
    });
    const result = await applySinglePlan(page, task.id, rule.id, 'safe-earliest-event');
    expect(result.status).toBe('Awaiting confirmation');

    const preview = await page.evaluate(async ruleId => {
      const pendingRows = (await LifeOS.app.ruleEngine.pendingApprovals()).filter(row => row.ruleId === ruleId);
      if (pendingRows.length !== 1) throw new Error(`Expected exactly one safe-scheduling approval, found ${pendingRows.length}.`);
      const pending = pendingRows[0];
      const action = pending.proposedActions.find(row => row.type === 'schedule-earliest-tomorrow');
      if (!action) throw new Error('Safe-scheduling approval is missing its resolved action.');
      return { executionId: pending.executionId, date: action.params.resolvedDate, time: action.params.resolvedTime, duration: action.params.duration, existingBlockId: action.params.existingBlockId };
    }, rule.id);
    expect(preview).toMatchObject({ date: fixture.tomorrow, time: '08:00', duration: 30, existingBlockId: fixture.blockId });

    const applied = await page.evaluate(async ({ executionId, taskId, blockId }) => {
      const confirmation = await LifeOS.app.ruleEngine.confirmPending(executionId);
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      return { status: confirmation.status, task: { status: task.status, preferredDate: task.preferredDate, anchorTime: task.anchorTime }, block: { date: block.date, startTime: block.startTime, endTime: block.endTime } };
    }, { executionId: preview.executionId, taskId: task.id, blockId: fixture.blockId });
    expect(applied).toEqual({ status: 'Applied', task: { status: 'Scheduled', preferredDate: fixture.tomorrow, anchorTime: '08:00' }, block: { date: fixture.tomorrow, startTime: '08:00', endTime: '08:30' } });

    await page.evaluate(() => LifeOS.app.undo.undo());
    const restored = await page.evaluate(async ({ taskId, blockId }) => {
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      return { task: { status: task.status, preferredDate: task.preferredDate || '', anchorTime: task.anchorTime || '' }, block: { date: block.date, startTime: block.startTime, endTime: block.endTime } };
    }, { taskId: task.id, blockId: fixture.blockId });
    expect(restored).toEqual({ task: { status: 'Next', preferredDate: '', anchorTime: '' }, block: { date: fixture.today, startTime: '10:00', endTime: '10:30' } });
  });
});

const { test, expect } = require('@playwright/test');
const { resetApp, waitForApp } = require('./helpers');

async function installRule(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const base = {
      id: `r451-${crypto.randomUUID()}`,
      name: 'LifeOS 4.5.1 completion rule',
      description: 'Final automation completion browser fixture.',
      enabled: true,
      trigger: { type: 'task-updated', config: {} },
      conditionMode: 'all',
      conditions: [],
      actions: [{ type: 'create-notification', params: { title: '4.5.1 rule fired' } }],
      priority: 70,
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

async function createTask(page, overrides = {}) {
  return page.evaluate(async overrides => LifeOS.app.repo.save('tasks', {
    id: `r451-task-${crypto.randomUUID()}`,
    title: 'LifeOS 4.5.1 task', status: 'Next', priority: 'Medium', estimatedDuration: 60,
    minimumSessionDuration: 15, maximumSessionDuration: 120, actualMinutes: 0, plannedMinutes: 0, blockedBy: [],
    ...overrides
  }), overrides);
}

async function waitForNotification(page, title) {
  await page.waitForFunction(async title => (await LifeOS.app.repo.all('notifications', { fresh: true })).some(row => row.title === title), title);
}

test.describe('LifeOS 4.5.1 Final Automation Completion', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('registered trigger and action surfaces have complete certified runtime mappings', async ({ page }) => {
    const coverage = await page.evaluate(() => ({
      triggerKeys: Object.keys(LifeOS.RULE_TRIGGERS).sort(),
      producerKeys: Object.keys(LifeOS.RULE_TRIGGER_PRODUCERS).sort(),
      actionKeys: Object.keys(LifeOS.RULE_ACTIONS).sort(),
      executorKeys: Object.keys(LifeOS.RULE_ACTION_EXECUTORS).sort(),
      preferences: Object.keys(LifeOS.RULE_PLANNING_PREFERENCES).sort(),
      version: LifeOS.version,
      ruleEngineVersion: LifeOS.ruleEngineVersion
    }));
    expect(coverage.version).toBe('4.5.1');
    expect(coverage.ruleEngineVersion).toBe('4.5.1');
    expect(coverage.producerKeys).toEqual(coverage.triggerKeys);
    expect(coverage.executorKeys).toEqual(coverage.actionKeys);
    expect(coverage.preferences).toEqual(['deep-work-before', 'preferred-before', 'recovery-after-work']);
  });

  test('planning-preference is a real atomic settings mutation and changes scheduler scoring', async ({ page }) => {
    const task = await createTask(page, { title: 'Deep preference target', workMode: 'Deep' });
    const rule = await installRule(page, {
      name: 'Deep work before preference',
      actions: [{ type: 'planning-preference', params: { kind: 'deep-work-before', time: '17:00' } }]
    });
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const rule = await LifeOS.app.repo.get('rules', ruleId);
      const data = await LifeOS.app.repo.dataset({ fresh: true });
      const beforeSettings = await LifeOS.app.repo.settings();
      const beforePenalty = new LifeOS.DayScheduler(data, beforeSettings, LifeOS.PersonalPlanningModel.build(data)).slotPenalty(task, LifeOS.CoreUtil.localDate(), 15 * 60, 90).total;
      const event = engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId: 'r451-preference-action' });
      const context = engine.context(event, data, beforeSettings);
      const plan = engine.evaluate(rule, event, context);
      const applied = await engine.applyPlan(plan, event, context, { mode: 'production' });
      const afterSettings = await LifeOS.app.repo.settings();
      const afterData = await LifeOS.app.repo.dataset({ fresh: true });
      const afterPenalty = new LifeOS.DayScheduler(afterData, afterSettings, LifeOS.PersonalPlanningModel.build(afterData)).slotPenalty(task, LifeOS.CoreUtil.localDate(), 15 * 60, 90).total;
      return { status: applied.status, before: beforeSettings.deepWorkBefore, after: afterSettings.deepWorkBefore, beforePenalty, afterPenalty };
    }, { taskId: task.id, ruleId: rule.id });
    expect(result.status).toBe('Applied');
    expect(result.before).not.toBe('17:00');
    expect(result.after).toBe('17:00');
    expect(result.afterPenalty).toBeLessThan(result.beforePenalty);
    await page.evaluate(() => LifeOS.app.undo.undo());
    const restored = await page.evaluate(() => LifeOS.app.repo.settings());
    expect(restored.deepWorkBefore).toBe(result.before);
  });

  test('create-suggested-task produces a provenance-bearing task and deduplicates the same logical event', async ({ page }) => {
    const source = await createTask(page, { title: 'Source for suggested follow-up' });
    const rule = await installRule(page, {
      name: 'Create a real suggested task',
      actions: [{ type: 'create-suggested-task', params: { title: 'Review follow-up', priority: 'High', estimatedDuration: 30 } }]
    });
    const result = await page.evaluate(async ({ taskId, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const fire = async () => {
        const task = await LifeOS.app.repo.get('tasks', taskId);
        return engine.process(engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId: 'r451-suggested-task-event' }));
      };
      await fire();
      await fire();
      const tasks = await LifeOS.app.repo.all('tasks', { fresh: true });
      const created = tasks.filter(row => row.title === 'Review follow-up');
      return { count: created.length, created: created[0], ruleId };
    }, { taskId: source.id, ruleId: rule.id });
    expect(result.count).toBe(1);
    expect(result.created.sourceType).toBe('automation-rule');
    expect(result.created.sourceRuleId).toBe(rule.id);
    expect(result.created.automationProvenance.ruleId).toBe(rule.id);
    expect(result.created.automationProvenance.triggerEventId).toBe('r451-suggested-task-event');
  });

  test('real settings change produces planning-refresh and capacity-recalculated lifecycle events', async ({ page }) => {
    await installRule(page, { id: 'r451-planning-refresh-rule', name: 'Planning refresh producer', trigger: { type: 'planning-refresh', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Planning refresh lifecycle fired' } }] });
    await installRule(page, { id: 'r451-capacity-rule', name: 'Capacity producer', trigger: { type: 'capacity-recalculated', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Capacity lifecycle fired' } }] });
    await page.evaluate(async () => {
      const settings = await LifeOS.app.repo.settings();
      await LifeOS.app.repo.setting('bufferPercent', settings.bufferPercent === 18 ? 27 : 18);
    });
    await waitForNotification(page, 'Planning refresh lifecycle fired');
    await waitForNotification(page, 'Capacity lifecycle fired');
    const runtime = await page.evaluate(() => LifeOS.app.ruleEngine.runtime());
    expect(Object.keys(runtime.capacitySignatures || {}).length).toBeGreaterThan(0);
  });

  test('real active-project mutation produces project-weekly-shortfall through ProjectAllocator', async ({ page }) => {
    await installRule(page, { id: 'r451-shortfall-rule', name: 'Project shortfall producer', trigger: { type: 'project-weekly-shortfall', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Project shortfall lifecycle fired' } }] });
    await page.evaluate(async () => {
      await LifeOS.app.service.saveProject({
        title: 'R451 constrained project', status: 'Active', priority: 'High', planningMode: 'Weekly Flexible',
        minimumWeeklyHours: 0, weeklyTargetHours: 20, stretchWeeklyHours: 24,
        minimumSessionMinutes: 30, maximumSessionMinutes: 120,
        workDayMaxHours: 0.25, offDayMaxHours: 0.25, universityDayMaxHours: 0.25, mixedDayMaxHours: 0.25, recoveryDayMaxHours: 0.25, customDayMaxHours: 0.25,
        targetDate: '', preferredDayTypes: [], avoidDayTypes: []
      });
    });
    await waitForNotification(page, 'Project shortfall lifecycle fired');
    const runtime = await page.evaluate(() => LifeOS.app.ruleEngine.runtime());
    expect(Object.keys(runtime.projectShortfallSignatures || {}).length).toBeGreaterThan(0);
  });

  test('civil day lifecycle honors configured IANA timezone and DST edge semantics', async ({ page }) => {
    await installRule(page, { id: 'r451-day-change-rule', name: 'Civil day producer', trigger: { type: 'day-changed', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Civil day lifecycle fired' } }] });
    const result = await page.evaluate(async () => {
      await LifeOS.app.repo.setting('timeZoneId', 'Europe/Berlin');
      const state = await LifeOS.app.ruleEngine.runtime();
      await LifeOS.app.repo.save('systemMeta', { ...state, id: 'rule-runtime', lastCivilDate: '2026-03-29', lastCivilTimeZoneId: 'Europe/Berlin' }, { validate: false });
      const changed = await LifeOS.app.ruleEngine.evaluateCivilDay('certification', Date.parse('2026-03-29T22:30:00Z'));
      const spring = LifeOS.CivilTimeEngine.analyzeLocalTime({ date: '2026-03-29', time: '02:30', timeZoneId: 'Europe/Berlin' });
      const autumn = LifeOS.CivilTimeEngine.analyzeLocalTime({ date: '2026-10-25', time: '02:30', timeZoneId: 'Europe/Berlin' });
      return { changed, spring: spring.status, autumn: autumn.status };
    });
    expect(result.changed.status).toBe('changed');
    expect(result.changed.date).toBe('2026-03-30');
    expect(result.spring).toBe('nonexistent');
    expect(result.autumn).toBe('ambiguous');
    await waitForNotification(page, 'Civil day lifecycle fired');
  });

  test('authoritative day-plan commit produces schedule-generated with an operation identity', async ({ page }) => {
    await installRule(page, { id: 'r451-schedule-generated-rule', name: 'Schedule generated producer', trigger: { type: 'schedule-generated', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Schedule generated lifecycle fired' } }] });
    const result = await page.evaluate(async () => {
      const date = LifeOS.CoreUtil.localDate();
      LifeOS.app.state.set({ pending: { type: 'day', plan: { date, rescue: false, minimum: false, planned: [], remove: [], skipped: [], summary: { created: 0, moved: 0, removed: 0, deadlinesImproved: 0 } } } });
      await LifeOS.app.applyPendingDay();
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const schedule = [...logs].reverse().find(row => row.type === 'schedule');
      return { operationId: schedule?.meta?.operationId || '' };
    });
    expect(result.operationId).not.toBe('');
    await waitForNotification(page, 'Schedule generated lifecycle fired');
  });
});

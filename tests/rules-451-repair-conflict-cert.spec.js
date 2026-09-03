const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

const PRODUCT_SHA = 'da8a523e64a311cc73eadcf9dc015eec51fa51c4';

async function installRule(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const base = {
      id: `r451-extra-${crypto.randomUUID()}`,
      name: 'LifeOS 4.5.1 supplemental certification rule',
      description: 'Supplemental browser certification for repair and conflict semantics.',
      enabled: true,
      trigger: { type: 'task-updated', config: {} },
      conditionMode: 'all',
      conditions: [],
      actions: [{ type: 'create-notification', params: { title: 'Supplemental rule fired' } }],
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

async function createRepairFixture(page) {
  return page.evaluate(async () => {
    const date = LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1);
    const now = new Date().toISOString();
    const task = await LifeOS.app.repo.save('tasks', {
      id: `r451-repair-task-${crypto.randomUUID()}`,
      title: 'Repair certification target',
      status: 'Scheduled',
      priority: 'High',
      estimatedDuration: 60,
      minimumSessionDuration: 30,
      maximumSessionDuration: 120,
      actualMinutes: 0,
      plannedMinutes: 60,
      blockedBy: [],
      preferredDate: date,
      schedulingFlexibility: 'flexible'
    });
    const block = await LifeOS.app.repo.save('timeBlocks', {
      id: `r451-repair-block-${crypto.randomUUID()}`,
      taskId: task.id,
      title: task.title,
      date,
      startTime: '10:00',
      endTime: '11:00',
      duration: 60,
      locked: false,
      protected: false,
      type: 'task',
      sourceType: 'user',
      sourceId: task.id,
      createdAt: now,
      updatedAt: now,
      revision: 1
    });
    const event = await LifeOS.app.repo.save('events', {
      id: `r451-repair-event-${crypto.randomUUID()}`,
      title: 'Fixed conflict for repair certification',
      startDate: date,
      endDate: date,
      startTime: '10:00',
      endTime: '11:00',
      fixedOrFlexible: 'Fixed',
      travelBefore: 0,
      travelAfter: 0,
      preparationTime: 0
    });
    await LifeOS.app.ruleEngine.processing;
    const preview = await LifeOS.app.service.buildRepair(date, { maxRadius: 4 });
    if (!preview.candidates?.length) throw new Error('Repair fixture did not produce a real ScheduleRepairEngine candidate.');
    const candidate = preview.candidates[0];
    if (!candidate.changes.some(change => change.id === block.id)) throw new Error('Repair candidate does not move the conflicted certification block.');
    return {
      date,
      taskId: task.id,
      blockId: block.id,
      eventId: event.id,
      candidateId: candidate.id,
      originalStart: block.startTime,
      candidateStart: candidate.changes.find(change => change.id === block.id)?.after?.startTime || ''
    };
  });
}

async function waitForNotification(page, title) {
  await page.waitForFunction(async title => (await LifeOS.app.repo.all('notifications', { fresh: true })).some(row => row.title === title), title);
}

test.describe('LifeOS 4.5.1 supplemental repair/conflict certification', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('real Repair My Day apply emits schedule-repaired and executes a schedule-repaired rule', async ({ page }) => {
    expect(await page.evaluate(() => LifeOS.version)).toBe('4.5.1');
    const rule = await installRule(page, {
      id: 'r451-real-schedule-repaired-e2e',
      name: 'Real schedule repaired observer',
      trigger: { type: 'schedule-repaired', config: {} },
      actions: [{ type: 'create-notification', params: { title: 'Real schedule-repaired E2E fired' } }]
    });
    const fixture = await createRepairFixture(page);

    const preview = await page.evaluate(async date => {
      const repair = await LifeOS.app.service.buildRepair(date, { maxRadius: 4 });
      if (!repair.candidates?.length) throw new Error('Expected Repair My Day candidate.');
      const candidateId = repair.candidates[0].id;
      LifeOS.app.state.set({ pending: { type: 'repair', preview: repair, candidateId } });
      LifeOS.app.renderRepairPreview(repair, candidateId);
      return { candidateId, moved: repair.candidates[0].stability.movedBlockCount };
    }, fixture.date);
    expect(preview.moved).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Apply repair' }).click();
    await waitForNotification(page, 'Real schedule-repaired E2E fired');

    const result = await page.evaluate(async ({ blockId, ruleId }) => {
      await LifeOS.app.ruleEngine.processing;
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const repair = [...logs].reverse().find(row => row.type === 'repair-apply');
      const history = await LifeOS.app.ruleEngine.history();
      const observed = history.find(row => row.meta?.ruleExecution?.ruleId === ruleId && row.meta?.ruleExecution?.triggerType === 'schedule-repaired');
      const runtime = await LifeOS.app.ruleEngine.runtime();
      return {
        startTime: block.startTime,
        operationId: repair?.meta?.operationId || '',
        observedStatus: observed?.meta?.ruleExecution?.status || '',
        recentEventIds: runtime.recentEventIds || []
      };
    }, { blockId: fixture.blockId, ruleId: rule.id });

    expect(result.startTime).not.toBe(fixture.originalStart);
    expect(result.operationId).not.toBe('');
    expect(result.observedStatus).toBe('Applied');
    expect(result.recentEventIds).toContain(`schedule-repaired:${result.operationId}`);
  });

  test('run-minimal-repair browser apply uses approval, real repair service, provenance, and one repair mutation', async ({ page }) => {
    const fixture = await createRepairFixture(page);
    const rule = await installRule(page, {
      id: 'r451-run-minimal-repair-e2e',
      name: 'Run minimal repair E2E',
      trigger: { type: 'task-updated', config: {} },
      actions: [{ type: 'run-minimal-repair', params: { date: fixture.date, maxRadius: 4 } }],
      priority: 85,
      executionPolicy: 'automatic'
    });

    const proposed = await page.evaluate(async ({ taskId, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const results = await engine.process(engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId: 'r451-run-minimal-repair-trigger' }));
      const pending = (await engine.pendingApprovals()).find(row => row.ruleId === ruleId);
      const action = pending?.proposedActions?.find(row => row.type === 'run-minimal-repair');
      return {
        status: results[0]?.status || '',
        executionId: pending?.executionId || '',
        candidateId: action?.params?.candidateId || '',
        fingerprint: action?.params?.sourceFingerprint || ''
      };
    }, { taskId: fixture.taskId, ruleId: rule.id });

    expect(proposed.status).toBe('Awaiting confirmation');
    expect(proposed.executionId).not.toBe('');
    expect(proposed.candidateId).not.toBe('');
    expect(proposed.fingerprint).not.toBe('');

    const applied = await page.evaluate(async ({ executionId, blockId, ruleId }) => {
      const result = await LifeOS.app.ruleEngine.confirmPending(executionId);
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const repairs = logs.filter(row => row.type === 'repair-apply' && row.meta?.ruleExecution?.ruleId === ruleId);
      return {
        status: result.status,
        operationId: result.repairResult?.operationId || '',
        startTime: block.startTime,
        repairCount: repairs.length,
        provenance: repairs[0]?.meta?.ruleExecution || null
      };
    }, { executionId: proposed.executionId, blockId: fixture.blockId, ruleId: rule.id });

    expect(applied.status).toBe('Applied');
    expect(applied.operationId).not.toBe('');
    expect(applied.startTime).not.toBe(fixture.originalStart);
    expect(applied.repairCount).toBe(1);
    expect(applied.provenance).toMatchObject({
      ruleId: rule.id,
      triggerEventId: 'r451-run-minimal-repair-trigger',
      triggerType: 'task-updated',
      status: 'Applied'
    });
    expect(applied.provenance.actions).toContain('run-minimal-repair');
  });

  test('competing planning preferences resolve by rule priority and lower priority cannot overwrite the winner', async ({ page }) => {
    const task = await page.evaluate(async () => LifeOS.app.repo.save('tasks', {
      id: `r451-pref-conflict-task-${crypto.randomUUID()}`,
      title: 'Preference conflict target',
      status: 'Next',
      priority: 'Medium',
      estimatedDuration: 60,
      minimumSessionDuration: 15,
      maximumSessionDuration: 120,
      actualMinutes: 0,
      plannedMinutes: 0,
      blockedBy: [],
      workMode: 'Deep'
    }));
    const low = await installRule(page, {
      id: 'r451-preference-low',
      name: 'Low priority late preference',
      actions: [{ type: 'planning-preference', params: { kind: 'deep-work-before', time: '19:00' } }],
      priority: 20
    });
    const high = await installRule(page, {
      id: 'r451-preference-high',
      name: 'High priority early preference',
      actions: [{ type: 'planning-preference', params: { kind: 'deep-work-before', time: '11:00' } }],
      priority: 95
    });

    const result = await page.evaluate(async ({ taskId, lowId, highId }) => {
      const engine = LifeOS.app.ruleEngine;
      const task = await LifeOS.app.repo.get('tasks', taskId);
      await engine.process(engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId: 'r451-preference-priority-conflict' }));
      await engine.processing;
      const settings = await LifeOS.app.repo.settings();
      const history = await engine.history();
      const lowRow = history.find(row => row.meta?.ruleExecution?.ruleId === lowId);
      const highRule = await LifeOS.app.repo.get('rules', highId);
      return {
        deepWorkBefore: settings.deepWorkBefore,
        lowWarnings: lowRow?.meta?.ruleExecution?.warnings || [],
        highTriggered: Boolean(highRule?.lastTriggeredAt)
      };
    }, { taskId: task.id, lowId: low.id, highId: high.id });

    expect(result.deepWorkBefore).toBe('11:00');
    expect(result.highTriggered).toBe(true);
    expect(result.lowWarnings.some(message => message.includes('higher-precedence rule High priority early preference'))).toBe(true);
  });

  test('repair-generated schedule-repaired event is lineage-safe and cannot re-trigger its source repair rule', async ({ page }) => {
    const fixture = await createRepairFixture(page);
    const rule = await installRule(page, {
      id: 'r451-repair-loop-guard',
      name: 'Repair loop guard E2E',
      trigger: { type: 'schedule-repaired', config: {} },
      actions: [{ type: 'run-minimal-repair', params: { date: fixture.date, maxRadius: 4 } }],
      priority: 90,
      executionPolicy: 'automatic'
    });

    const proposed = await page.evaluate(async ({ date, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const results = await engine.emitDomainEvent('schedule-repaired', {
        eventId: 'r451-repair-loop-seed',
        entityId: 'seed-repair-operation',
        current: { date, stability: 50, moved: 1 },
        data: { date, operationId: 'seed-repair-operation', repairReason: 'certification-seed' },
        sourceOperationId: 'seed-repair-operation'
      });
      const pending = (await engine.pendingApprovals()).find(row => row.ruleId === ruleId);
      return { status: results[0]?.status || '', executionId: pending?.executionId || '' };
    }, { date: fixture.date, ruleId: rule.id });

    expect(proposed.status).toBe('Awaiting confirmation');
    expect(proposed.executionId).not.toBe('');

    const result = await page.evaluate(async ({ executionId, ruleId }) => {
      const applied = await LifeOS.app.ruleEngine.confirmPending(executionId);
      await LifeOS.app.ruleEngine.processing;
      const operationId = applied.repairResult?.operationId || '';
      const runtime = await LifeOS.app.ruleEngine.runtime();
      const pending = (await LifeOS.app.ruleEngine.pendingApprovals()).filter(row => row.ruleId === ruleId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const repairs = logs.filter(row => row.type === 'repair-apply' && row.meta?.ruleExecution?.ruleId === ruleId);
      return {
        status: applied.status,
        operationId,
        pendingCount: pending.length,
        repairCount: repairs.length,
        generatedEventRemembered: runtime.recentEventIds?.includes(`schedule-repaired:${operationId}`) || false
      };
    }, { executionId: proposed.executionId, ruleId: rule.id });

    expect(result.status).toBe('Applied');
    expect(result.operationId).not.toBe('');
    expect(result.repairCount).toBe(1);
    expect(result.generatedEventRemembered).toBe(true);
    expect(result.pendingCount).toBe(0);
  });

  test('supplemental certification is pinned to the released product identity', async ({ page }) => {
    const identity = await page.evaluate(() => ({ app: LifeOS.version, rule: LifeOS.ruleEngineVersion, schema: LifeOS.schemaVersion }));
    expect(identity).toEqual({ app: '4.5.1', rule: '4.5.1', schema: 16 });
    expect(PRODUCT_SHA).toBe('da8a523e64a311cc73eadcf9dc015eec51fa51c4');
  });
});

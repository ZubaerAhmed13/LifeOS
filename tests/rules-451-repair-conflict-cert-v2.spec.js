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

async function createRepairFixture(page, { sameDay = false } = {}) {
  return page.evaluate(async sameDay => {
    let date = LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1);
    let startTime = '10:00';
    let duration = 60;
    if (sameDay) {
      date = LifeOS.CoreUtil.localDate();
      duration = 30;
      await LifeOS.app.repo.setting('dayEnd', '23:59');
      const now = new Date();
      const nowMinute = now.getHours() * 60 + now.getMinutes();
      const start = Math.ceil((nowMinute + 75) / 15) * 15;
      if (start + duration >= 23 * 60 + 45) throw new Error('Same-day Repair My Day fixture requires a future window before 23:45.');
      startTime = LifeOS.CoreUtil.time(start);
    }
    const startMinute = LifeOS.CoreUtil.clock(startTime);
    const endTime = LifeOS.CoreUtil.time(startMinute + duration);
    const nowIso = new Date().toISOString();
    const task = await LifeOS.app.repo.save('tasks', {
      id: `r451-repair-task-${crypto.randomUUID()}`,
      title: 'Repair certification target',
      status: 'Scheduled',
      priority: 'High',
      estimatedDuration: duration,
      minimumSessionDuration: Math.min(30, duration),
      maximumSessionDuration: Math.max(60, duration),
      actualMinutes: 0,
      plannedMinutes: duration,
      blockedBy: [],
      preferredDate: date,
      schedulingFlexibility: 'flexible'
    });
    const block = await LifeOS.app.repo.save('timeBlocks', {
      id: `r451-repair-block-${crypto.randomUUID()}`,
      taskId: task.id,
      title: task.title,
      date,
      startTime,
      endTime,
      duration,
      locked: false,
      protected: false,
      type: 'task',
      sourceType: 'user',
      sourceId: task.id,
      createdAt: nowIso,
      updatedAt: nowIso,
      revision: 1
    });
    const event = await LifeOS.app.repo.save('events', {
      id: `r451-repair-event-${crypto.randomUUID()}`,
      title: 'Fixed conflict for repair certification',
      startDate: date,
      endDate: date,
      startTime,
      endTime,
      fixedOrFlexible: 'Fixed',
      travelBefore: 0,
      travelAfter: 0,
      preparationTime: 0
    });
    await LifeOS.app.ruleEngine.processing;
    const preview = await LifeOS.app.service.buildRepair(date, { maxRadius: 4 });
    if (!preview.candidates?.length) throw new Error('Repair fixture did not produce a real ScheduleRepairEngine candidate.');
    const candidate = preview.candidates[0];
    const change = candidate.changes.find(row => row.id === block.id);
    if (!change) throw new Error('Repair candidate does not move the conflicted certification block.');
    return {
      date,
      taskId: task.id,
      blockId: block.id,
      eventId: event.id,
      original: { date: block.date, startTime: block.startTime, endTime: block.endTime },
      expected: { date: change.after.date, startTime: change.after.startTime, endTime: change.after.endTime }
    };
  }, sameDay);
}

async function repairState(page, { blockId, ruleId, expected, clickStartedAt }) {
  return page.evaluate(async ({ blockId, ruleId, expected, clickStartedAt }) => {
    await LifeOS.app.ruleEngine.processing;
    const block = await LifeOS.app.repo.get('timeBlocks', blockId);
    const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
    const repair = [...logs].reverse().find(row => row.type === 'repair-apply' && row.meta?.operationId);
    const history = await LifeOS.app.ruleEngine.history();
    const observed = history.find(row => row.meta?.ruleExecution?.ruleId === ruleId && row.meta?.ruleExecution?.triggerType === 'schedule-repaired');
    const runtime = await LifeOS.app.ruleEngine.runtime();
    const notifications = await LifeOS.app.repo.all('notifications', { fresh: true });
    const actionErrors = notifications.filter(row => ['ERROR', 'CRITICAL'].includes(row.type) && String(row.createdAt || '') >= clickStartedAt)
      .map(row => ({ type: row.type, title: row.title, message: row.message || '', errorCode: row.errorCode || '' }));
    const diagnostics = (await LifeOS.app.repo.all('diagnosticLog', { fresh: true }))
      .filter(row => row.component === 'Action:apply-repair' && String(row.timestamp || '') >= clickStartedAt)
      .map(row => ({ severity: row.severity, code: row.code, message: row.message }));
    const moved = Boolean(block && block.date === expected.date && block.startTime === expected.startTime && block.endTime === expected.endTime);
    const eventRemembered = Boolean(repair && (runtime.recentEventIds || []).includes(`schedule-repaired:${repair.meta.operationId}`));
    return {
      complete: moved && Boolean(repair) && observed?.meta?.ruleExecution?.status === 'Applied' && eventRemembered,
      block: block ? { date: block.date, startTime: block.startTime, endTime: block.endTime } : null,
      operationId: repair?.meta?.operationId || '',
      observedStatus: observed?.meta?.ruleExecution?.status || '',
      eventRemembered,
      actionErrors,
      diagnostics,
      pendingType: LifeOS.app.state.get('pending')?.type || '',
      dialogOpen: Boolean(document.getElementById('appDialog')?.open)
    };
  }, { blockId, ruleId, expected, clickStartedAt });
}

async function waitForRepairCompletion(page, input) {
  let last = null;
  for (let attempt = 0; attempt < 75; attempt++) {
    last = await repairState(page, input);
    if (last.complete) return last;
    if (last.actionErrors.length || last.diagnostics.length) throw new Error(`Repair My Day product error: ${JSON.stringify(last)}`);
    await page.waitForTimeout(200);
  }
  throw new Error(`Repair My Day did not complete after Apply: ${JSON.stringify(last)}`);
}

test.describe('LifeOS 4.5.1 supplemental repair/conflict certification v2', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('real Repair My Day browser E2E applies its stored candidate, emits schedule-repaired, and executes the observer rule', async ({ page }) => {
    expect(await page.evaluate(() => LifeOS.version)).toBe('4.5.1');
    const rule = await installRule(page, {
      id: 'r451-real-schedule-repaired-e2e',
      name: 'Real schedule repaired observer',
      trigger: { type: 'schedule-repaired', config: {} },
      actions: [{ type: 'create-notification', params: { title: 'Real schedule-repaired E2E fired' } }]
    });
    const fixture = await createRepairFixture(page, { sameDay: true });

    await page.locator('[data-view="today"]').first().click();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const repairMyDay = page.locator('button[data-action="rescue-day"]');
    await expect(repairMyDay).toBeVisible();
    await repairMyDay.click();
    await expect(page.getByRole('heading', { name: 'Repair My Day' })).toBeVisible();

    const uiPreview = await page.evaluate(blockId => {
      const pending = LifeOS.app.state.get('pending');
      if (pending?.type !== 'repair') throw new Error('Real Repair My Day UI did not establish pending repair state.');
      const candidate = pending.preview.candidates.find(row => row.id === pending.candidateId);
      const change = candidate?.changes?.find(row => row.id === blockId);
      if (!candidate || !change) throw new Error('Repair My Day UI candidate does not contain the conflicted block.');
      return {
        candidateId: candidate.id,
        moved: candidate.stability.movedBlockCount,
        expected: { date: change.after.date, startTime: change.after.startTime, endTime: change.after.endTime },
        sourceFingerprint: pending.preview.sourceFingerprint
      };
    }, fixture.blockId);
    expect(uiPreview.moved).toBeGreaterThan(0);
    expect(uiPreview.expected).not.toEqual(fixture.original);

    const apply = page.locator('button[data-action="apply-repair"]');
    await expect(apply).toBeVisible();
    const clickStartedAt = await page.evaluate(() => new Date().toISOString());
    await apply.click();
    const completed = await waitForRepairCompletion(page, {
      blockId: fixture.blockId,
      ruleId: rule.id,
      expected: uiPreview.expected,
      clickStartedAt
    });

    const result = await page.evaluate(async ({ blockId, ruleId }) => {
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const repair = [...logs].reverse().find(row => row.type === 'repair-apply' && row.meta?.operationId);
      const history = await LifeOS.app.ruleEngine.history();
      const observed = history.find(row => row.meta?.ruleExecution?.ruleId === ruleId && row.meta?.ruleExecution?.triggerType === 'schedule-repaired');
      const runtime = await LifeOS.app.ruleEngine.runtime();
      const undoState = await LifeOS.app.repo.get('systemMeta', 'undo-history');
      const repairUndo = [...(undoState?.undoStack || [])].reverse().find(row => row.label?.startsWith('Repaired '));
      const undoChange = repairUndo?.changes?.find(row => row.id === blockId);
      const notification = (await LifeOS.app.repo.all('notifications', { fresh: true })).find(row => row.title === 'Real schedule-repaired E2E fired');
      return {
        block: { date: block.date, startTime: block.startTime, endTime: block.endTime },
        operationId: repair?.meta?.operationId || '',
        observedStatus: observed?.meta?.ruleExecution?.status || '',
        recentEventIds: runtime.recentEventIds || [],
        undoAfter: undoChange?.after ? { date: undoChange.after.date, startTime: undoChange.after.startTime, endTime: undoChange.after.endTime } : null,
        observerNotificationPresent: Boolean(notification)
      };
    }, { blockId: fixture.blockId, ruleId: rule.id });

    console.log('LIFEOS_REPAIR_MY_DAY_E2E', JSON.stringify({ fixture, uiPreview, completed, result }));
    expect(result.undoAfter).toEqual(uiPreview.expected);
    expect(result.block).toEqual(uiPreview.expected);
    expect(result.operationId).not.toBe('');
    expect(result.observedStatus).toBe('Applied');
    expect(result.observerNotificationPresent).toBe(true);
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

    const proposed = await page.evaluate(async ({ taskId, blockId, ruleId }) => {
      const engine = LifeOS.app.ruleEngine;
      const task = await LifeOS.app.repo.get('tasks', taskId);
      const results = await engine.process(engine.makeEvent('task-updated', 'tasks', task.id, null, task, { eventId: 'r451-run-minimal-repair-trigger' }));
      const pending = (await engine.pendingApprovals()).find(row => row.ruleId === ruleId);
      const action = pending?.proposedActions?.find(row => row.type === 'run-minimal-repair');
      let expected = null;
      if (action?.params?.candidateId) {
        const repair = await LifeOS.app.service.buildRepair(action.params.resolvedDate || action.params.date, { maxRadius: action.params.maxRadius || 4 });
        const candidate = repair.candidates.find(row => row.id === action.params.candidateId);
        const change = candidate?.changes?.find(row => row.id === blockId);
        if (change) expected = { date: change.after.date, startTime: change.after.startTime, endTime: change.after.endTime };
      }
      return {
        status: results[0]?.status || '',
        executionId: pending?.executionId || '',
        candidateId: action?.params?.candidateId || '',
        fingerprint: action?.params?.sourceFingerprint || '',
        expected
      };
    }, { taskId: fixture.taskId, blockId: fixture.blockId, ruleId: rule.id });

    expect(proposed.status).toBe('Awaiting confirmation');
    expect(proposed.executionId).not.toBe('');
    expect(proposed.candidateId).not.toBe('');
    expect(proposed.fingerprint).not.toBe('');
    expect(proposed.expected).not.toBeNull();

    const applied = await page.evaluate(async ({ executionId, blockId, ruleId }) => {
      const result = await LifeOS.app.ruleEngine.confirmPending(executionId);
      const block = await LifeOS.app.repo.get('timeBlocks', blockId);
      const logs = await LifeOS.app.repo.all('activityLog', { fresh: true });
      const repairs = logs.filter(row => row.type === 'repair-apply' && row.meta?.ruleExecution?.ruleId === ruleId);
      return {
        status: result.status,
        operationId: result.repairResult?.operationId || '',
        block: { date: block.date, startTime: block.startTime, endTime: block.endTime },
        repairCount: repairs.length,
        provenance: repairs[0]?.meta?.ruleExecution || null
      };
    }, { executionId: proposed.executionId, blockId: fixture.blockId, ruleId: rule.id });

    expect(applied.status).toBe('Applied');
    expect(applied.operationId).not.toBe('');
    expect(applied.block).toEqual(proposed.expected);
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
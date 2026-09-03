const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

async function waitForDecision(page) {
  await page.waitForFunction(() => globalThis.LifeOS?.app?.decisionEngine && globalThis.LifeOS?.DecisionEngine, null, { timeout: 20_000 });
}
async function seedTask(page, overrides = {}) {
  return page.evaluate(async overrides => {
    const task = {
      id: `d460-task-${crypto.randomUUID()}`,
      title: 'Decision fixture task', status: 'Next', priority: 'Medium', estimatedDuration: 60,
      minimumSessionDuration: 15, maximumSessionDuration: 120, actualMinutes: 0, plannedMinutes: 0,
      blockedBy: [], schedulingFlexibility: 'flexible', workMode: 'Normal', context: 'General',
      ...overrides
    };
    return LifeOS.app.repo.save('tasks', task, { validate: false });
  }, overrides);
}
async function planningStateHash(page) {
  return page.evaluate(async () => {
    const data = await LifeOS.app.repo.dataset({ fresh: true });
    const settings = await LifeOS.app.repo.settings();
    const planningState = {
      tasks: data.tasks || [], projects: data.projects || [], events: data.events || [], timeBlocks: data.timeBlocks || [],
      dayProfiles: data.dayProfiles || [], lifeAreas: data.lifeAreas || [], settings
    };
    return LifeOS.CoreUtil.hash(planningState);
  });
}
async function makeApplicableDecision(page, taskId) {
  return page.evaluate(async taskId => {
    const date = LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1);
    const request = { id: `manual-${crypto.randomUUID()}`, type: LifeOS.DECISION_TYPES.TODAY_PLAN, date, mode: 'production', source: 'certification' };
    const context = await new LifeOS.DecisionContextBuilder().build(request);
    const task = context.tasks.find(row => row.id === taskId);
    const candidate = { id: `manual-candidate-${taskId}`, kind: 'task-session', taskId, projectId: task.projectId || '', title: task.title, duration: 30, date, startMinute: 12 * 60, changes: [], metadata: {} };
    const feasibility = new LifeOS.DecisionFeasibilityGate().evaluate(candidate, context);
    if (!feasibility.feasible) throw new Error(`Fixture candidate unexpectedly infeasible: ${feasibility.blockers.join(' | ')}`);
    const tradeoffs = new LifeOS.DecisionTradeoffEngine().evaluate(candidate, context, feasibility);
    const row = { candidate, feasibility, tradeoffs, rank: 1, label: 'Recommended', explanation: new LifeOS.DecisionExplanationEngine().explain({ candidate, feasibility, tradeoffs }, null, context) };
    return { decisionId: `decision-manual-${crypto.randomUUID()}`, request, contextFingerprint: context.contextFingerprint, dataGeneration: context.dataGeneration, engineVersion: LifeOS.decisionEngineVersion, generatedAt: new Date().toISOString(), alternatives: [row], recommended: row, dataQuality: context.dataQuality };
  }, taskId);
}

test.describe('LifeOS 4.6 Decision Engine', () => {
  test.beforeEach(async ({ page }) => { await resetApp(page); await waitForDecision(page); });

  test('exports exact 4.6 identity and all required decision components', async ({ page }) => {
    const result = await page.evaluate(() => ({
      app: LifeOS.version,
      decision: LifeOS.decisionEngineVersion,
      rule: LifeOS.ruleEngineVersion,
      db: LifeOS.schemaVersion,
      components: ['DecisionEngine','DecisionContextBuilder','DecisionCandidateGenerator','DecisionFeasibilityGate','DecisionTradeoffEngine','DecisionRankingEngine','DecisionAlternativeGenerator','DecisionExplanationEngine','DecisionPreviewManager','DecisionApplyCoordinator','DecisionHistory'].map(name => typeof LifeOS[name])
    }));
    expect(result.app).toBe('4.6.0');
    expect(result.decision).toBe('4.6.0');
    expect(result.rule).toBe('4.5.1');
    expect(result.db).toBe(16);
    expect(result.components.every(type => type === 'function')).toBeTruthy();
  });

  test('same relevant state produces deterministic recommendation and ranking 20 times', async ({ page }) => {
    await seedTask(page, { title: 'Deadline task', priority: 'Critical', deadline: await page.evaluate(() => LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1)) });
    await seedTask(page, { title: 'Secondary task', priority: 'Medium', deadline: await page.evaluate(() => LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 5)) });
    const result = await page.evaluate(async () => {
      const date = LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1), outputs = [];
      for (let i = 0; i < 20; i++) {
        const decision = await LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.TODAY_PLAN, date, mode: 'production', source: 'determinism-test' });
        outputs.push({ recommendation: decision.recommended?.candidate?.id || '', order: decision.alternatives.map(x => x.candidate.id), fingerprint: decision.contextFingerprint });
      }
      return outputs;
    });
    expect(new Set(result.map(x => x.recommendation)).size).toBe(1);
    expect(new Set(result.map(x => JSON.stringify(x.order))).size).toBe(1);
    expect(new Set(result.map(x => x.fingerprint)).size).toBe(1);
  });

  test('dependency-blocked highest-priority task is never an immediate recommendation', async ({ page }) => {
    const blocker = await seedTask(page, { title: 'Dependency', priority: 'Low', status: 'Next' });
    const blocked = await seedTask(page, { title: 'Blocked critical', priority: 'Critical', blockedBy: [blocker.id], deadline: await page.evaluate(() => LifeOS.CoreUtil.localDate()) });
    await seedTask(page, { title: 'Ready alternative', priority: 'High' });
    const result = await page.evaluate(async blockedId => {
      const decision = await LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.NEXT_ACTION, mode: 'production' });
      return { ids: decision.alternatives.map(x => x.candidate.taskId).filter(Boolean), blocked: decision.rejected.find(x => x.candidate.taskId === blockedId) || null };
    }, blocked.id);
    expect(result.ids).not.toContain(blocked.id);
  });

  test('fixed commitment overlap is hard-rejected before ranking', async ({ page }) => {
    const task = await seedTask(page, { title: 'Overlap target', priority: 'Critical' });
    const result = await page.evaluate(async taskId => {
      const date = LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1);
      await LifeOS.app.repo.save('events', { id: `fixed-${crypto.randomUUID()}`, title: 'Fixed commitment', startDate: date, startTime: '10:00', endDate: date, endTime: '11:00', fixedOrFlexible: 'fixed', locked: true, travelBefore: 0, travelAfter: 0, preparationTime: 0 }, { validate: false });
      const request = { type: LifeOS.DECISION_TYPES.TODAY_PLAN, date, mode: 'production' };
      const context = await new LifeOS.DecisionContextBuilder().build(request);
      const candidate = { id: 'overlap', kind: 'task-session', taskId, title: 'Overlap target', duration: 30, date, startMinute: 10 * 60 + 15, changes: [], metadata: {} };
      return new LifeOS.DecisionFeasibilityGate().evaluate(candidate, context);
    }, task.id);
    expect(result.feasible).toBeFalsy();
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  test('capacity overload reports the real minute shortfall instead of pretending all demand fits', async ({ page }) => {
    await seedTask(page, { title: 'Large A', priority: 'Critical', estimatedDuration: 900, maximumSessionDuration: 120 });
    await seedTask(page, { title: 'Large B', priority: 'High', estimatedDuration: 900, maximumSessionDuration: 120 });
    const result = await page.evaluate(async () => LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.DEADLINE_TRIAGE, date: LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1), mode: 'production' }));
    expect(result.capacityShortfall.requiredMinutes).toBe(1800);
    expect(result.capacityShortfall.shortfallMinutes).toBeGreaterThan(0);
    expect(result.capacityShortfall.shortfallMinutes).toBe(result.capacityShortfall.requiredMinutes - result.capacityShortfall.availableMinutes);
  });

  test('keep current plan wins when there is no meaningful evidence-backed improvement', async ({ page }) => {
    const result = await page.evaluate(async () => LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.NEXT_ACTION, mode: 'production' }));
    expect(result.recommended.candidate.kind).toBe('keep-current-plan');
    expect(result.recommended.explanation.summary).toContain('Keep the current plan');
  });

  test('preview is non-mutating and exposes exact source fingerprint', async ({ page }) => {
    await seedTask(page, { title: 'Preview task', priority: 'Critical', deadline: await page.evaluate(() => LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1)) });
    const decision = await page.evaluate(async () => LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.TODAY_PLAN, date: LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1), mode: 'preview' }));
    const before = await planningStateHash(page);
    const preview = await page.evaluate(decision => LifeOS.app.decisionEngine.preview(decision, decision.recommended.candidate.id), decision);
    const after = await planningStateHash(page);
    expect(after).toBe(before);
    expect(preview.immutable).toBeTruthy();
    expect(preview.productionFingerprintBefore).toBe(decision.contextFingerprint);
  });

  test('stale recommendation cannot overwrite a newer task revision', async ({ page }) => {
    const task = await seedTask(page, { title: 'Stale target', priority: 'Critical' });
    const decision = await makeApplicableDecision(page, task.id);
    const result = await page.evaluate(async ({ decision, taskId }) => {
      const task = await LifeOS.app.repo.get('tasks', taskId);
      await LifeOS.app.repo.saveIfRevisionMatches('tasks', { ...task, title: 'Changed after preview' }, task.revision);
      try { await LifeOS.app.decisionEngine.apply(decision, decision.recommended.candidate.id); return { code: '', applied: true }; }
      catch (error) { return { code: error.code || '', message: error.message, applied: false }; }
    }, { decision, taskId: task.id });
    expect(result.applied).toBeFalsy();
    expect(result.code).toBe('DECISION-STALE-460');
  });

  test('accepted decision applies as one logical time block and one Undo restores production state', async ({ page }) => {
    const task = await seedTask(page, { title: 'Atomic apply target', priority: 'Critical' });
    const decision = await makeApplicableDecision(page, task.id);
    const beforeHash = await planningStateHash(page);
    const beforeBlocks = await page.evaluate(async () => (await LifeOS.app.repo.dataset({ fresh: true })).timeBlocks.length);
    const applied = await page.evaluate(async decision => LifeOS.app.decisionEngine.apply(decision, decision.recommended.candidate.id), decision);
    const after = await page.evaluate(async decision => {
      const data = await LifeOS.app.repo.dataset({ fresh: true });
      return { blocks: data.timeBlocks.length, created: data.timeBlocks.find(row => row.decisionId === decision.decisionId) };
    }, decision);
    await page.evaluate(async () => LifeOS.app.undo.undo());
    const restoredHash = await planningStateHash(page);
    expect(after.blocks).toBe(beforeBlocks + 1);
    expect(after.created.type).toBe('task');
    expect(after.created.sourceType).toBe('decision');
    expect(restoredHash).toBe(beforeHash);
    expect(applied.record.status).toBe('Applied');
  });

  test('RuleEngine planning-policy outputs and accepted intelligence remain soft reason signals', async ({ page }) => {
    const task = await seedTask(page, { title: 'Deep task', priority: 'High', workMode: 'Deep', taskType: 'Career', context: 'Career' });
    const result = await page.evaluate(async taskId => {
      await LifeOS.app.repo.setting('deepWorkBefore', '14:00');
      const request = { type: LifeOS.DECISION_TYPES.TODAY_PLAN, date: LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1), mode: 'production' };
      const context = await new LifeOS.DecisionContextBuilder().build(request), task = context.tasks.find(t => t.id === taskId);
      const candidate = { id: 'soft-signal', kind: 'task-session', taskId, title: task.title, duration: 30, date: request.date, startMinute: 9 * 60, changes: [], metadata: {} };
      const feasibility = new LifeOS.DecisionFeasibilityGate().evaluate(candidate, context), tradeoffs = new LifeOS.DecisionTradeoffEngine().evaluate(candidate, context, feasibility);
      return { feasible: feasibility.feasible, reasons: tradeoffs.reasons.map(r => r.reasonCode), ruleAlignment: tradeoffs.ruleAlignment || 0, intelligenceAlignment: tradeoffs.intelligenceAlignment || 0 };
    }, task.id);
    expect(result.feasible).toBeTruthy();
    expect(result.ruleAlignment).toBeGreaterThan(0);
    expect(result.reasons).toContain('RULEENGINE-ALIGNMENT');
    expect(result.intelligenceAlignment).toBeGreaterThanOrEqual(0);
  });

  test('scenario decision analysis leaves production planning state unchanged', async ({ page }) => {
    await seedTask(page, { title: 'Scenario target', priority: 'High' });
    const scenarioId = await page.evaluate(async () => {
      const scenario = await LifeOS.app.scenarioEngine.create({ name: 'Decision isolation', planningStart: LifeOS.CoreUtil.localDate(), planningDays: 2, modifications: [] });
      return scenario.id;
    });
    const before = await planningStateHash(page);
    const mode = await page.evaluate(async scenarioId => {
      const decision = await LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.TODAY_PLAN, mode: 'scenario', scenarioId, date: LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(), 1) });
      return decision.request.mode;
    }, scenarioId);
    const after = await planningStateHash(page);
    expect(after).toBe(before);
    expect(mode).toBe('scenario');
  });

  test('Decision Center and Decision-backed What Now are keyboard-accessible and usable at 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const button = page.getByRole('button', { name: 'Decision Center' });
    await expect(button).toBeVisible();
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#decisionCenterDialog')).toBeVisible();
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.locator('[data-decision-status]')).toContainText('Decision analysis complete');
    await expect(page.locator('.decision-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close Decision Center' }).click();
    await page.evaluate(async () => LifeOS.app.whatNow());
    const whatNow = page.locator('[data-decision-what-now]');
    await expect(whatNow).toBeVisible();
    await expect(whatNow).toContainText('DECISION ENGINE RECOMMENDATION');
    await expect(whatNow).toContainText('What this protects');
    await expect(whatNow).toContainText('Opportunity cost');
    await expect(whatNow).toContainText('Best alternative');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('core decision analysis continues locally after network is disabled', async ({ page, context }) => {
    await seedTask(page, { title: 'Offline task', priority: 'High' });
    await context.setOffline(true);
    const result = await page.evaluate(async () => {
      const decision = await LifeOS.app.decisionEngine.analyze({ type: LifeOS.DECISION_TYPES.NEXT_ACTION, mode: 'production' });
      return { version: decision.engineVersion, alternatives: decision.alternatives.length };
    });
    expect(result.version).toBe('4.6.0');
    expect(result.alternatives).toBeGreaterThan(0);
  });
});

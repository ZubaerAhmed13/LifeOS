const { test, expect } = require('playwright/test');
const { resetApp, navigate } = require('./helpers');

async function seedIntelligenceHistory(page, { count = 24, activeTask = false } = {}) {
  await page.evaluate(async ({ count, activeTask }) => {
    const { app, CoreUtil, PersonalIntelligenceEngine } = globalThis.LifeOS;
    const settings = await app.repo.settings();
    await app.repo.save('settings', {
      ...settings,
      onboardingComplete: true,
      timeZoneId: 'UTC',
      intelligenceDismissals: [],
      intelligencePreferences: {}
    });
    const task = await app.repo.save('tasks', {
      id: 'intel-ui-task',
      title: 'Intelligence Study',
      status: activeTask ? 'Next' : 'Completed',
      priority: 'High',
      estimatedDuration: 60,
      plannedMinutes: 60,
      actualMinutes: activeTask ? 0 : 75,
      minimumSessionDuration: 15,
      maximumSessionDuration: 120,
      blockedBy: [],
      projectId: '',
      taskType: 'Study',
      context: 'Desk',
      workMode: 'Normal',
      completedAt: activeTask ? '' : CoreUtil.nowISO()
    });
    for (let index = 0; index < count; index += 1) {
      const date = CoreUtil.addDays(CoreUtil.localDate(), -index);
      const morning = index % 2 === 0;
      const localStartTime = morning ? '10:00' : '19:00';
      await app.repo.save('focusSessions', {
        id: `intel-ui-session-${index}`,
        taskId: task.id,
        projectId: '',
        date,
        localStartTime,
        startedAt: `${date}T${localStartTime}:00.000Z`,
        endedAt: `${date}T${morning ? '11:00' : '20:30'}:00.000Z`,
        plannedMinutes: 60,
        actualMinutes: morning ? 60 : 90,
        completionStatus: 'Completed',
        context: 'Desk',
        workMode: 'Normal',
        timeZoneId: 'UTC'
      }, { validate: false });
      await app.repo.save('dailyCheckins', {
        id: `intel-ui-checkin-${index}`,
        date,
        energy: morning ? 8 : 3,
        context: 'Desk'
      }, { validate: false });
      await app.repo.save('dayProfiles', {
        id: `intel-ui-profile-${index}`,
        date,
        dayType: index % 3 ? 'Off' : 'Work'
      }, { validate: false });
    }
    PersonalIntelligenceEngine.cache.clear();
  }, { count, activeTask });
}

async function seedPostponementHistory(page) {
  await page.evaluate(async () => {
    const { app, CoreUtil, PersonalIntelligenceEngine } = LifeOS;
    const settings = await app.repo.settings();
    await app.repo.save('settings', { ...settings, onboardingComplete: true, timeZoneId: 'UTC', intelligenceDismissals: [], intelligencePreferences: {} });
    const definitions = [
      { id: 'postpone-career', title: 'Career task', taskType: 'Career', context: 'Desk', attempts: 18, postponed: 7 },
      { id: 'postpone-other', title: 'Other task', taskType: 'Other', context: 'Elsewhere', attempts: 52, postponed: 9 }
    ];
    const date = CoreUtil.localDate();
    for (const definition of definitions) {
      await app.repo.save('tasks', { id: definition.id, title: definition.title, status: 'Next', priority: 'Medium', estimatedDuration: 60, plannedMinutes: 0, actualMinutes: 0, minimumSessionDuration: 15, maximumSessionDuration: 120, blockedBy: [], taskType: definition.taskType, context: definition.context, workMode: 'Normal' });
      for (let index = 0; index < definition.attempts; index += 1) {
        const attemptId = `${definition.id}-attempt-${index}`;
        const meta = { taskId: definition.id, attemptId, taskType: definition.taskType, context: definition.context, scheduledDate: date, startTime: '10:00', previousPostponements: 0, flexible: true };
        await app.repo.save('activityLog', { id: `${attemptId}-scheduled`, type: 'task-schedule', at: `${date}T09:00:00.000Z`, text: 'Scheduled attempt', meta }, { validate: false });
        if (index < definition.postponed) await app.repo.save('activityLog', { id: `${attemptId}-postponed`, type: 'task-postpone', at: `${date}T09:30:00.000Z`, text: 'Postponed attempt', meta }, { validate: false });
      }
    }
    PersonalIntelligenceEngine.cache.clear();
  });
}

async function seedDayProfileHistory(page) {
  await page.evaluate(async () => {
    const { app, CoreUtil, PersonalIntelligenceEngine } = LifeOS;
    const settings = await app.repo.settings();
    await app.repo.save('settings', { ...settings, onboardingComplete: true, timeZoneId: 'UTC', intelligenceDismissals: [], intelligencePreferences: {}, mealMinutesPerDay: 0, essentialPersonalMinutesPerDay: 0, minBufferMinutes: 0, bufferPercent: 0 });
    await app.repo.save('tasks', { id: 'profile-study', title: 'Profile Study', status: 'Completed', priority: 'High', estimatedDuration: 120, plannedMinutes: 0, actualMinutes: 0, minimumSessionDuration: 15, maximumSessionDuration: 240, blockedBy: [], taskType: 'Study', context: 'Desk', workMode: 'Normal', completedAt: CoreUtil.nowISO() });
    await app.repo.save('dayTemplates', { id: 'profile-work-template', name: 'Work Day', dayType: 'Work', sleepPolicy: 'none', projectBudgetMinutes: 240, items: [] }, { validate: false });
    for (let index = 0; index < 24; index += 1) {
      const date = CoreUtil.addDays(CoreUtil.localDate(), -index), heavy = index < 12, planned = heavy ? 180 : 120, actual = heavy ? 110 : 98;
      await app.repo.save('dayProfiles', { id: `profile-work-${index}`, date, templateId: 'profile-work-template', dayType: 'Work', projectBudgetMinutes: 240 }, { validate: false });
      await app.repo.save('timeBlocks', { id: `profile-block-${index}`, taskId: 'profile-study', title: 'Profile Study', date, startTime: '10:00', endTime: heavy ? '13:00' : '12:00', duration: planned, type: 'task', locked: false }, { validate: false });
      await app.repo.save('focusSessions', { id: `profile-session-${index}`, taskId: 'profile-study', date, localStartTime: '10:00', startedAt: `${date}T10:00:00.000Z`, endedAt: `${date}T12:00:00.000Z`, plannedMinutes: planned, actualMinutes: actual, completionStatus: 'Completed', context: 'Desk', workMode: 'Normal', timeZoneId: 'UTC' }, { validate: false });
    }
    PersonalIntelligenceEngine.cache.clear();
  });
}

async function seedHeterogeneousCohort(page) {
  await page.evaluate(async () => {
    const { app, CoreUtil, PersonalIntelligenceEngine } = LifeOS;
    const settings = await app.repo.settings();
    await app.repo.save('settings', { ...settings, onboardingComplete: true, timeZoneId: 'UTC', intelligenceDismissals: [], intelligencePreferences: {} });
    const unrelatedTypes = ['Finance', 'Career', 'Admin', 'Work', 'Personal', 'Health', 'Creative'];
    await app.repo.save('tasks', { id: 'cohort-study', title: 'Study cohort', status: 'Completed', priority: 'High', estimatedDuration: 60, minimumSessionDuration: 15, maximumSessionDuration: 120, blockedBy: [], taskType: 'Study', context: 'Desk', completedAt: CoreUtil.nowISO() });
    for (const type of unrelatedTypes) await app.repo.save('tasks', { id: `cohort-${type.toLowerCase()}`, title: `${type} cohort`, status: 'Completed', priority: 'Medium', estimatedDuration: 60, minimumSessionDuration: 15, maximumSessionDuration: 120, blockedBy: [], taskType: type, context: type, completedAt: CoreUtil.nowISO() });
    for (let index = 0; index < 16; index += 1) {
      const date = CoreUtil.addDays(CoreUtil.localDate(), -(index % 28)), valid = index < 14;
      await app.repo.save('focusSessions', { id: `cohort-study-session-${index}`, taskId: 'cohort-study', date, localStartTime: '10:00', startedAt: `${date}T10:00:00.000Z`, endedAt: `${date}T11:18:00.000Z`, plannedMinutes: valid ? 60 : 0, actualMinutes: 78, completionStatus: 'Completed', context: 'Desk', workMode: 'Normal', timeZoneId: 'UTC' }, { validate: false });
    }
    for (let index = 0; index < 84; index += 1) {
      const type = unrelatedTypes[index % unrelatedTypes.length], date = CoreUtil.addDays(CoreUtil.localDate(), -(index % 28));
      await app.repo.save('focusSessions', { id: `cohort-unrelated-session-${index}`, taskId: `cohort-${type.toLowerCase()}`, date, localStartTime: '14:00', startedAt: `${date}T14:00:00.000Z`, endedAt: `${date}T15:00:00.000Z`, plannedMinutes: 60, actualMinutes: 60, completionStatus: 'Completed', context: type, workMode: 'Normal', timeZoneId: 'UTC' }, { validate: false });
    }
    PersonalIntelligenceEngine.cache.clear();
  });
}

async function seedSimpsonEnergyHistory(page) {
  await page.evaluate(async () => {
    const { app, CoreUtil, PersonalIntelligenceEngine } = LifeOS;
    const settings = await app.repo.settings();
    await app.repo.save('settings', { ...settings, onboardingComplete: true, timeZoneId: 'UTC', intelligenceDismissals: [], intelligencePreferences: {} });
    for (const type of ['Study', 'Admin']) await app.repo.save('tasks', { id: `simpson-${type.toLowerCase()}`, title: `${type} energy`, status: 'Completed', priority: 'Medium', estimatedDuration: 60, minimumSessionDuration: 15, maximumSessionDuration: 180, blockedBy: [], taskType: type, context: type, completedAt: CoreUtil.nowISO() });
    const groups = [
      { type: 'Study', energy: 8, count: 9, ratio: .9 }, { type: 'Study', energy: 3, count: 3, ratio: .8 },
      { type: 'Admin', energy: 8, count: 3, ratio: 2 }, { type: 'Admin', energy: 3, count: 9, ratio: 1.9 }
    ];
    let index = 0;
    for (const group of groups) for (let offset = 0; offset < group.count; offset += 1) {
      const date = CoreUtil.addDays(CoreUtil.localDate(), -index), actual = Math.round(60 * group.ratio);
      await app.repo.save('focusSessions', { id: `simpson-session-${index}`, taskId: `simpson-${group.type.toLowerCase()}`, date, localStartTime: '10:00', startedAt: `${date}T10:00:00.000Z`, endedAt: `${date}T11:00:00.000Z`, plannedMinutes: 60, actualMinutes: actual, completionStatus: 'Completed', context: group.type, workMode: 'Normal', timeZoneId: 'UTC' }, { validate: false });
      await app.repo.save('dailyCheckins', { id: `simpson-checkin-${index}`, date, energy: group.energy, context: group.type }, { validate: false });
      index += 1;
    }
    PersonalIntelligenceEngine.cache.clear();
  });
}

test.describe('LifeOS 4.4 Personal Intelligence', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('exports preserved engines and the 4.4 intelligence model', async ({ page }) => {
    const versions = await page.evaluate(() => ({
      app: LifeOS.version,
      schema: LifeOS.schemaVersion,
      scheduler: LifeOS.schedulerVersion,
      forecast: LifeOS.forecastModelVersion,
      calendar: LifeOS.calendarEngineVersion,
      intelligence: LifeOS.intelligenceModelVersion
    }));
    expect(versions).toEqual({ app: '4.4.0', schema: 16, scheduler: '4.1.0', forecast: '4.2.0', calendar: '4.3.0', intelligence: '4.4.1' });
  });

  test('cold start is honest and local-only', async ({ page }) => {
    await navigate(page, 'Insights');
    await expect(page.getByRole('heading', { name: 'Insights 3.0' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Not enough history yet for a reliable duration pattern.' })).toBeVisible();
    await expect(page.getByText('No telemetry, remote analytics, cloud inference')).toBeVisible();
  });

  test('established evidence renders with magnitude, sample and date range', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    const card = page.locator('.intelligence-card').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.pill')).toContainText(/Established pattern|Strong pattern/);
    await expect(card.getByText(/^\d+ samples?$/).first()).toBeVisible();
    await expect(card.getByText('Why this matters')).toBeVisible();
  });

  test('range and dimension filters recalculate the visible cohort', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.locator('[data-insights-range]').selectOption('7');
    await expect(page.locator('[data-insights-range]')).toHaveValue('7');
    await page.locator('[data-insights-filter="context"]').selectOption('Desk');
    await expect(page.locator('[data-insights-filter="context"]')).toHaveValue('Desk');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('[data-insights-range]')).toHaveValue('28');
  });

  test('evidence drill-down explains method, comparison and limitations', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.locator('[data-action="insight-evidence"]').first().click();
    await expect(page.locator('#appDialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Evidence —/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Method' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Comparison' })).toBeVisible();
    await expect(page.getByText(/model 4\.4\.1/)).toBeVisible();
  });

  test('Pattern Explorer exposes the normalized local dataset', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.getByRole('button', { name: 'Pattern Explorer' }).click();
    await expect(page.getByRole('heading', { name: 'Pattern Explorer' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Planned' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Study', exact: true }).first()).toBeVisible();
    await expect(page.getByText('24 execution rows')).toBeVisible();
  });

  test('Data Quality explains coverage, authority and exclusions', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.getByRole('button', { name: 'Data Quality' }).click();
    await expect(page.getByRole('heading', { name: 'Data quality and provenance' })).toBeVisible();
    await expect(page.getByRole('row', { name: /Execution authority/ })).toContainText('Focus sessions first');
    await expect(page.getByRole('row', { name: /Postponement authority/ })).toContainText('Dated activity log');
  });

  test('recommendation requires preview and explicit confirmation, then is reversible', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.locator('[data-action="preview-intelligence-preference"]').first().click();
    await expect(page.getByRole('heading', { name: 'Preview preference change' })).toBeVisible();
    await expect(page.getByText('never applied without this confirmation')).toBeVisible();
    await page.getByRole('button', { name: 'Apply preference' }).click();
    await navigate(page, 'Settings');
    const section = page.locator('#settings-personal-intelligence');
    await expect(section).toContainText('Accepted preferences');
    await expect(section.locator('[data-action="remove-intelligence-preference"]')).toHaveCount(1);
    await section.locator('[data-action="remove-intelligence-preference"]').click();
    await expect(section.locator('[data-action="remove-intelligence-preference"]')).toHaveCount(0);
  });

  test('dismissed insight stays hidden for its stable signature', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    const before = await page.locator('.intelligence-card').count();
    await page.locator('[data-action="dismiss-insight"]').first().click();
    await expect(page.locator('.intelligence-card')).toHaveCount(before - 1);
    await page.reload();
    await expect(page.locator('.intelligence-card')).toHaveCount(before - 1);
  });

  test('What Now exposes evidence without overriding feasibility', async ({ page }) => {
    const today = await page.evaluate(() => LifeOS.CoreUtil.localDate());
    await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
    await seedIntelligenceHistory(page, { activeTask: true });
    await page.evaluate(async () => {
      const { app } = LifeOS;
      const settings = await app.repo.settings();
      await app.repo.save('settings', {
        ...settings,
        intelligencePreferences: {
          accepted: [{ id: 'accepted-study', kind: 'duration-factor', label: 'Study duration', acceptedAt: new Date().toISOString(), modelVersion: '4.4.1' }],
          durationFactors: { Study: { factor: 1.25, acceptedAt: new Date().toISOString(), signature: 'test' } }
        }
      });
    });
    await navigate(page, 'Today');
    await page.locator('[data-action="what-now"]').click();
    await expect(page.locator('#appDialog')).toBeVisible();
    await expect(page.getByText(/Historical duration evidence|Limited historical evidence/)).toBeVisible();
    await expect(page.getByText('No calendar changes required')).toBeVisible();
  });

  test('dated Postponement insight is correct, mobile, keyboard accessible and offline', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPostponementHistory(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state || '')).toBe('activated');
    await request.post('/__test/origin-mode', { data: 'offline' });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await navigate(page, 'Insights');
      const card = page.locator('.intelligence-card').filter({ hasText: 'Career postponement pattern' });
      await expect(card).toBeVisible();
      await expect(card.locator('.intelligence-magnitude')).toHaveText('+21.6 pp');
      await expect(card.locator('.pill')).toContainText(/Established pattern|Strong pattern/);
      expect(await card.textContent()).not.toMatch(/lazy|procrastinator|unmotivated|discipline problem/i);
      const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
      const evidenceButton = card.getByRole('button', { name: 'View evidence' });
      await evidenceButton.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Evidence — Career postponement pattern' })).toBeVisible();
      const comparison = JSON.parse(await page.locator('.evidence-json').textContent());
      expect(comparison.selected).toMatchObject({ postponed: 7, attempts: 18 });
      expect(comparison.comparable).toMatchObject({ postponed: 9, attempts: 52 });
      await page.locator('#appDialog').getByRole('button', { name: 'Close' }).last().focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#appDialog')).not.toBeVisible();
      await card.getByRole('button', { name: 'Dismiss' }).focus();
      await page.keyboard.press('Enter');
      await expect(card).toHaveCount(0);
    } finally {
      await request.post('/__test/origin-mode', { data: 'online' });
    }
  });

  test('Day Profile insight compares heavy and lighter Work Days within profile', async ({ page }) => {
    await seedDayProfileHistory(page);
    await navigate(page, 'Insights');
    const card = page.locator('.intelligence-card').filter({ hasText: 'Work Day load pattern' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Within recorded Work Day profiles');
    await card.getByRole('button', { name: 'View evidence' }).click();
    const comparison = JSON.parse(await page.locator('.evidence-json').textContent());
    expect(comparison.heavy).toMatchObject({ days: 12, thresholdMinutes: 150 });
    expect(comparison.lighter).toMatchObject({ days: 12 });
    expect(comparison.lighter.medianPlanRealization - comparison.heavy.medianPlanRealization).toBeGreaterThan(.19);
    await expect(page.locator('#appDialog').getByText(/comparison stays within the stable Work Day profile identity/i)).toBeVisible();
  });

  test('heterogeneous evidence remains scoped to 14 of 16 Study observations', async ({ page }) => {
    await seedHeterogeneousCohort(page);
    await navigate(page, 'Insights');
    const card = page.locator('.intelligence-card').filter({ hasText: 'Study estimation' });
    await expect(card).toBeVisible();
    await expect(card.locator('.pill')).toContainText('Established pattern');
    await expect(card.locator('.insight-evidence').getByText('14 samples')).toBeVisible();
    await expect(card.locator('.insight-evidence').getByText('16 eligible')).toBeVisible();
    await card.getByRole('button', { name: 'View evidence' }).click();
    await expect(page.locator('#appDialog').getByText('88%', { exact: true })).toBeVisible();
    await expect(page.locator('#appDialog').getByText(/84 unrelated observations were excluded from coverage/)).toBeVisible();
  });

  test('Simpson-style Energy reversal is labelled Mixed, never Established', async ({ page }) => {
    await seedSimpsonEnergyHistory(page);
    await navigate(page, 'Insights');
    const card = page.locator('.intelligence-card').filter({ hasText: 'Energy and workload pattern' });
    await expect(card).toBeVisible();
    await expect(card.locator('.pill')).toHaveText('Mixed evidence');
    await expect(card).toContainText('not stable within comparable task types');
    await card.getByRole('button', { name: 'View evidence' }).click();
    const comparison = JSON.parse(await page.locator('.evidence-json').textContent());
    expect(comparison.simpsonReversal).toBe(true);
    await expect(page.locator('#appDialog').getByText(/did not treat it as established/i)).toBeVisible();
  });

  test('mobile Insights remains usable without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    await expect(page.getByRole('button', { name: 'Pattern Explorer' })).toBeVisible();
  });
});

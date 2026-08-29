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
    expect(versions).toEqual({ app: '4.4.0', schema: 16, scheduler: '4.1.0', forecast: '4.2.0', calendar: '4.3.0', intelligence: '4.4.0' });
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
    await expect(card.getByText(/^\d+ observations?$/).first()).toBeVisible();
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
    await expect(page.getByText(/model 4\.4\.0/)).toBeVisible();
  });

  test('Pattern Explorer exposes the normalized local dataset', async ({ page }) => {
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    await page.getByRole('button', { name: 'Pattern Explorer' }).click();
    await expect(page.getByRole('heading', { name: 'Pattern Explorer' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Planned' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Study', exact: true }).first()).toBeVisible();
    await expect(page.getByText('24 rows')).toBeVisible();
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
          accepted: [{ id: 'accepted-study', kind: 'duration-factor', label: 'Study duration', acceptedAt: new Date().toISOString(), modelVersion: '4.4.0' }],
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

  test('mobile Insights remains usable without document overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedIntelligenceHistory(page);
    await navigate(page, 'Insights');
    const geometry = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    await expect(page.getByRole('button', { name: 'Pattern Explorer' })).toBeVisible();
  });
});

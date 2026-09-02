const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('LifeOS 4.4.1 final evidence correctness', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('Energy 3/3/14 reports six comparison participants', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { PersonalIntelligenceEngine, CoreUtil } = LifeOS;
      const date = CoreUtil.localDate();
      const base = { date, taskType: 'Study', validEstimation: true, completed: true };
      const rows = [
        ...Array.from({ length: 3 }, (_, i) => ({ ...base, observationId: `high-${i}`, estimateRatio: 1, energyBefore: 8 })),
        ...Array.from({ length: 3 }, (_, i) => ({ ...base, observationId: `low-${i}`, estimateRatio: 1.4, energyBefore: 3 })),
        ...Array.from({ length: 14 }, (_, i) => ({ ...base, observationId: `medium-${i}`, estimateRatio: 1.2, energyBefore: i % 2 ? 5 : 6 }))
      ];
      const insight = PersonalIntelligenceEngine.energy({ observations: rows, range: { start: date, end: date } })[0];
      return {
        appVersion: LifeOS.version,
        intelligenceVersion: LifeOS.intelligenceModelVersion,
        sampleSize: insight.evidence.sampleSize,
        eligibleCount: insight.evidence.eligibleCount,
        coverage: insight.evidence.coverage,
        fieldAvailable: insight.comparison.fieldAvailable,
        comparedSamples: insight.comparison.comparedSamples,
        excludedFromComparison: insight.comparison.excludedFromComparison
      };
    });
    expect(result).toEqual({
      appVersion: '4.4.1',
      intelligenceVersion: '4.4.2',
      sampleSize: 6,
      eligibleCount: 6,
      coverage: 1,
      fieldAvailable: 20,
      comparedSamples: 6,
      excludedFromComparison: 14
    });
  });

  test('Career time-window evidence is invariant to unrelated Admin attempts', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { PersonalIntelligenceEngine, CoreUtil } = LifeOS;
      const date = CoreUtil.localDate();
      const career = Array.from({ length: 10 }, (_, i) => ({
        attemptId: `career-${i}`, taskType: 'Career', scheduledDate: date,
        scheduledLocalHour: i < 5 ? 10 : 20, flexible: true,
        postponed: i >= 5 && i < 9, completed: !(i >= 5 && i < 9), previousPostponements: 0, plannedLoadRatio: .6
      }));
      const control = Array.from({ length: 6 }, (_, i) => ({
        attemptId: `control-${i}`, taskType: 'Control', scheduledDate: date,
        scheduledLocalHour: 12, flexible: true, postponed: i === 0, completed: i !== 0,
        previousPostponements: 0, plannedLoadRatio: .6
      }));
      const admin = Array.from({ length: 100 }, (_, i) => ({
        attemptId: `admin-${i}`, taskType: 'Admin', scheduledDate: date,
        scheduledLocalHour: 13, flexible: true, postponed: i % 6 === 0, completed: i % 6 !== 0,
        previousPostponements: 0, plannedLoadRatio: .6
      }));
      const find = rows => PersonalIntelligenceEngine.postponement({ postponementAttempts: rows })
        .find(row => row.insightType === 'postponement-time-window' && row.sourceDimensions.taskType === 'Career');
      const before = find([...career, ...control]);
      const after = find([...career, ...control, ...admin]);
      const snapshot = insight => ({
        sampleSize: insight.evidence.sampleSize,
        eligibleCount: insight.evidence.eligibleCount,
        coverage: insight.evidence.coverage,
        level: insight.evidence.level,
        effect: insight.metric.value,
        magnitude: insight.magnitude
      });
      return { before: snapshot(before), after: snapshot(after) };
    });
    expect(result.after).toEqual(result.before);
    expect(result.after.sampleSize).toBe(10);
    expect(result.after.eligibleCount).toBe(10);
    expect(result.after.coverage).toBe(1);
  });

  test('10k evidence analyses remain bounded and comparison-correct', async ({ page }) => {
    const result = await page.evaluate(() => {
      const { PersonalIntelligenceEngine, CoreUtil } = LifeOS;
      const date = CoreUtil.localDate();
      const rows = Array.from({ length: 10000 }, (_, i) => ({
        observationId: `perf-${i}`, date, taskType: `Type-${i % 20}`,
        validEstimation: true, completed: true, estimateRatio: i % 3 === 0 ? 1 : 1.25,
        energyBefore: i % 10 < 3 ? 8 : i % 10 < 6 ? 3 : 5
      }));
      const start = performance.now();
      const insight = PersonalIntelligenceEngine.energy({ observations: rows, range: { start: date, end: date } })[0];
      return { durationMs: performance.now() - start, sampleSize: insight.evidence.sampleSize, fieldAvailable: insight.comparison.fieldAvailable };
    });
    expect(result.fieldAvailable).toBe(10000);
    expect(result.sampleSize).toBe(6000);
    expect(result.durationMs).toBeLessThan(5000);
  });
});

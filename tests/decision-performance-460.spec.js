const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

async function waitForDecision(page) {
  await page.waitForFunction(() => globalThis.LifeOS?.app?.decisionEngine && globalThis.LifeOS?.DecisionCandidateGenerator, null, { timeout: 20_000 });
}

test.describe('LifeOS 4.6 Decision Performance', () => {
  test.beforeEach(async ({ page }) => { await resetApp(page); await waitForDecision(page); });

  for (const count of [100, 500, 1000]) {
    test(`bounded NEXT_ACTION pipeline remains responsive with ${count} tasks`, async ({ page }) => {
      const result = await page.evaluate(count => {
        const date = LifeOS.CoreUtil.localDate();
        const tasks = Array.from({ length: count }, (_, index) => ({
          id: `perf-${String(index).padStart(4,'0')}`, title: `Performance ${index}`, status: 'Next', priority: index % 11 === 0 ? 'High' : 'Medium',
          estimatedDuration: 30 + (index % 4) * 15, minimumSessionDuration: 15, maximumSessionDuration: 90,
          actualMinutes: 0, plannedMinutes: 0, blockedBy: [], projectId: '', deadline: index % 17 === 0 ? LifeOS.CoreUtil.addDays(date, 2) : '',
          schedulingFlexibility: 'flexible', workMode: 'Normal', context: index % 2 ? 'Study' : 'Admin'
        }));
        const context = {
          decisionDate: date, currentDate: date, currentLocalTime: '09:00', settings: { dayStart: '07:00', minBufferMinutes: 30, bufferPercent: 15 },
          readyTasks: tasks, tasks, projects: [], projectForecasts: [], deadlineForecasts: [], timeBlocks: [],
          capacity: { focusRemaining: 480, physicalLeft: 600 }, data: { tasks, events: [], projects: [], timeBlocks: [], dayProfiles: [] }, dataQuality: { completeness: 1, missingInputs: [], unavailableSignals: [], warnings: [] }, intelligence: null
        };
        const generator = new LifeOS.DecisionCandidateGenerator(), tradeoff = new LifeOS.DecisionTradeoffEngine(), ranking = new LifeOS.DecisionRankingEngine();
        const started = performance.now();
        const candidates = generator.generate({ type: LifeOS.DECISION_TYPES.NEXT_ACTION }, context);
        const evaluated = candidates.map(candidate => { const feasibility = { feasible: true, blockers: [], warnings: [], evidence: [] }; return { candidate, feasibility, tradeoffs: tradeoff.evaluate(candidate, context, feasibility) }; });
        const ranked = ranking.rank(evaluated);
        const durationMs = performance.now() - started;
        return { count, generated: candidates.length, ranked: ranked.length, durationMs };
      }, count);
      console.log(`LIFEOS_DECISION_PERF count=${result.count} generated=${result.generated} ranked=${result.ranked} duration_ms=${result.durationMs.toFixed(3)}`);
      expect(result.generated).toBeLessThanOrEqual(31);
      expect(result.ranked).toBeGreaterThan(0);
      expect(result.durationMs).toBeLessThan(100);
    });
  }
});

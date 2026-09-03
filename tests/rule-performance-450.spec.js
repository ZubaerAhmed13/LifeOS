const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

test.describe('LifeOS 4.5 RuleEngine performance', () => {
  test.beforeEach(async ({ page }) => resetApp(page));

  test('100, 500 and 1000 rule indexes remain bounded and trigger lookup is fast', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const output = [];
      for (const count of [100, 500, 1000]) {
        const rules = Array.from({ length: count }, (_, index) => ({
          id: `perf-rule-${count}-${index}`,
          name: `Performance ${count}-${index}`,
          description: 'Deterministic performance fixture',
          enabled: true,
          trigger: { type: index % 2 ? 'task-updated' : 'planning-refresh', config: {} },
          conditionMode: 'all',
          conditions: [],
          actions: [{ type: 'create-notification', params: { title: 'Performance fixture' } }],
          priority: index % 101,
          scope: {},
          executionPolicy: 'suggestion',
          source: 'manual',
          schemaVersion: 1,
          ruleEngineVersion: '4.5.1',
          createdAt: `2030-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
          updatedAt: '2030-01-01T00:00:00.000Z',
          revision: 1
        }));
        const engine = new LifeOS.RuleEngine({ all: async () => rules });
        const started = performance.now();
        await engine.reindex();
        const indexMs = performance.now() - started;
        const lookupStarted = performance.now();
        const candidates = engine.index.get('task-updated') || [];
        const lookupMs = performance.now() - lookupStarted;
        output.push({ count, indexMs, lookupMs, candidates: candidates.length });
      }
      return output;
    });
    for (const row of results) {
      console.log(`LIFEOS_RULE_PERF count=${row.count} indexMs=${row.indexMs.toFixed(3)} lookupMs=${row.lookupMs.toFixed(3)} candidates=${row.candidates}`);
      expect(row.indexMs, `index ${row.count}`).toBeLessThan(1000);
      expect(row.lookupMs, `lookup ${row.count}`).toBeLessThan(50);
      expect(row.candidates).toBe(Math.floor(row.count / 2));
    }
  });
});

import fs from 'node:fs';

let changed=false;
function patch(path,oldValue,newValue,marker,label){
  let source=fs.readFileSync(path,'utf8');
  if(source.includes(marker))return;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`4.5.1 test correction guard failed: ${label} signature missing in ${path}.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`4.5.1 test correction guard failed: ${label} signature not unique in ${path}.`);
  source=source.replace(oldValue,newValue);
  fs.writeFileSync(path,source);
  changed=true;
}

patch(
  'tests/evidence-correctness.spec.js',
  "        'Rule Accessibility', 'Rule Privacy'\n      ];",
  "        'Rule Accessibility', 'Rule Privacy', 'Rule Registry Coverage', 'Rule Trigger Wiring', 'Rule Action Coverage'\n      ];",
  "'Rule Action Coverage'\n      ];",
  '4.5.1 Rule group evidence list'
);

patch(
  'tests/rules-451-completion.spec.js',
  "    const runtime = await page.evaluate(() => LifeOS.app.ruleEngine.runtime());\n    expect(Object.keys(runtime.projectShortfallSignatures || {}).length).toBeGreaterThan(0);",
  "    await page.evaluate(() => LifeOS.app.ruleEngine.processing);\n    const execution = await page.evaluate(async () => (await LifeOS.app.ruleEngine.history()).some(row => row.meta?.ruleExecution?.ruleId === 'r451-shortfall-rule' && row.meta.ruleExecution.triggerType === 'project-weekly-shortfall' && row.meta.ruleExecution.status === 'Applied'));\n    expect(execution).toBe(true);",
  "triggerType === 'project-weekly-shortfall' && row.meta.ruleExecution.status === 'Applied'",
  'project shortfall semantic execution evidence'
);

patch(
  '.github/workflows/lifeos-451-final-certification.yml',
  "          node scripts/repair-lifeos-451-patcher.mjs\n          node scripts/apply-lifeos-451-final-automation.mjs\n          git diff --exit-code",
  "          node scripts/repair-lifeos-451-patcher.mjs\n          node scripts/apply-lifeos-451-final-automation.mjs\n          node scripts/apply-lifeos-451-race-corrections.mjs\n          node scripts/apply-lifeos-451-test-corrections.mjs\n          git diff --exit-code",
  "node scripts/apply-lifeos-451-test-corrections.mjs\n          git diff --exit-code",
  'exact-source guarded correction chain'
);

patch(
  '.github/workflows/lifeos-451-final-certification.yml',
  "          node --check scripts/apply-lifeos-451-final-automation.mjs\n          node --check scripts/build-release-451.mjs",
  "          node --check scripts/apply-lifeos-451-final-automation.mjs\n          node --check scripts/apply-lifeos-451-race-corrections.mjs\n          node --check scripts/apply-lifeos-451-test-corrections.mjs\n          node --check scripts/build-release-451.mjs",
  "node --check scripts/apply-lifeos-451-test-corrections.mjs",
  'correction script parse gates'
);

patch(
  '.github/workflows/lifeos-451-final-certification.yml',
  "          grep -F \"Rule Registry Coverage\" app.js\n          ! grep -E",
  "          grep -F \"Rule Registry Coverage\" app.js\n          grep -F \"async save(rule){const saved=await this.repo.save('rules',DataValidator.rule(rule));await this.processing;return saved}\" app.js\n          grep -F \"async testRule(rule,event,{data=null,settings=null,mode='dry-run'}={}){await this.processing;\" app.js\n          ! grep -E",
  "await this.processing;return saved}\" app.js",
  'queue settlement freeze invariants'
);

console.log(changed?'Applied LifeOS 4.5.1 certification test corrections.':'LifeOS 4.5.1 certification test corrections already applied.');

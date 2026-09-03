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

console.log(changed?'Applied LifeOS 4.5.1 certification test corrections.':'LifeOS 4.5.1 certification test corrections already applied.');

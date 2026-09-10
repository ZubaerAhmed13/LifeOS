const { test, expect } = require('@playwright/test');
const { resetApp } = require('./helpers');

async function waitForDecision(page){
  await page.waitForFunction(()=>globalThis.LifeOS?.app?.decisionEngine&&globalThis.LifeOS?.DecisionBriefEngine&&globalThis.LifeOS?.DecisionOutcomeEngine,null,{timeout:20_000});
}
async function seedTask(page,overrides={}){
  return page.evaluate(async overrides=>LifeOS.app.repo.save('tasks',{
    id:`d462-${crypto.randomUUID()}`,title:'Master-spec decision task',status:'Next',priority:'Critical',
    estimatedDuration:30,remainingDuration:30,minimumSessionDuration:15,maximumSessionDuration:60,
    actualMinutes:0,plannedMinutes:0,blockedBy:[],schedulingFlexibility:'flexible',context:'General',workMode:'Normal',
    postponeCount:0,...overrides
  },{validate:false}),overrides);
}
async function planningHash(page){
  return page.evaluate(async()=>{const data=await LifeOS.app.repo.dataset({fresh:true}),settings=await LifeOS.app.repo.settings();return LifeOS.CoreUtil.hash({tasks:data.tasks||[],projects:data.projects||[],events:data.events||[],timeBlocks:data.timeBlocks||[],dayProfiles:data.dayProfiles||[],settings})});
}
async function openAndAnalyze(page){
  await page.locator('#decisionCenterButton').click();
  await page.getByRole('button',{name:'Analyze'}).click();
  await expect(page.locator('[data-decision-status]')).toContainText('Decision analysis complete');
}
async function firstActionableId(page){
  return page.evaluate(()=>LifeOS.app.decisionCenter.current?.alternatives.find(x=>x.candidate.kind!=='keep-current-plan')?.candidate.id||'');
}

test.describe('LifeOS 4.6.2 Master-Spec Certification Completion',()=>{
  test.beforeEach(async({page})=>{await resetApp(page);await waitForDecision(page)});

  test('internal deterministic SelfTestRunner exposes all dedicated Decision groups green',async({page})=>{
    await page.addInitScript(()=>{
      try{Object.defineProperty(Navigator.prototype,'storage',{configurable:true,get:()=>undefined})}catch{}
      try{Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:undefined})}catch{}
    });
    await page.reload({waitUntil:'domcontentloaded'});await waitForDecision(page);
    const result=await page.evaluate(async()=>{
      const report=await new LifeOS.SelfTestRunner(LifeOS.app.repo).run();
      const names=['Decision Context','Decision Fingerprint','Decision Candidate Generation','Decision Feasibility','Decision Trade-offs','Decision Ranking','Decision Preview','Decision Atomicity','Decision Concurrency','Decision Scenario','Decision Data Quality','Decision Privacy','Decision Brief','Decision Outcome'];
      const groups=Object.fromEntries(names.map(name=>[name,report.groups[name]||null]));
      return{version:report.decisionEngineVersion,total:report.total,groups,failed:report.results.filter(x=>names.includes(x.group)&&!x.pass).map(x=>`${x.group}: ${x.name} — ${x.error||'failed'}`)};
    });
    console.log(`LIFEOS_DECISION_GROUPS ${JSON.stringify(result.groups)}`);
    expect(result.version).toBe('4.6.2');expect(result.total).toBeGreaterThan(492);expect(result.failed).toEqual([]);
    for(const [name,group] of Object.entries(result.groups)){expect(group,`${name} missing`).not.toBeNull();expect(group.total,`${name} empty`).toBeGreaterThan(0);expect(group.passed,`${name} not green`).toBe(group.total)}
  });

  test('Preview UI shows explicit CURRENT vs PROPOSED plus forecast and opportunity panels',async({page})=>{
    await seedTask(page);await openAndAnalyze(page);const id=await firstActionableId(page);expect(id).not.toBe('');
    await page.locator(`[data-preview="${id}"]`).click();
    await expect(page.locator('[data-decision-preview]')).toBeVisible();
    await expect(page.locator('[data-preview-current] h4')).toHaveText('CURRENT');
    await expect(page.locator('[data-preview-proposed] h4')).toHaveText('PROPOSED');
    await expect(page.locator('[data-preview-forecast]')).toContainText('Forecast effect');
    await expect(page.locator('[data-preview-opportunity]')).toContainText('Opportunity cost');
    const model=await page.evaluate(()=>LifeOS.app.decisionCenter.preview);
    expect(model.current).toBeTruthy();expect(model.proposed).toBeTruthy();expect(model.forecastEffect).toBeTruthy();expect(model.opportunity).toBeTruthy();expect(model.immutable).toBeTruthy()
  });

  test('keyboard only chooses a different alternative then Preview → Apply → Undo',async({page})=>{
    await seedTask(page,{title:'Keyboard master-spec task'});const before=await planningHash(page);
    await page.keyboard.press('Control+Alt+D');await expect(page.locator('#decisionCenterDialog')).toBeVisible();
    await expect(page.getByRole('button',{name:'Analyze'})).toBeFocused();await page.keyboard.press('Enter');
    await expect(page.locator('[data-decision-status]')).toContainText('Decision analysis complete');
    const selected=page.locator('input[data-decision-choice]:checked');await expect(selected).toBeFocused();
    const originalId=await page.evaluate(()=>document.activeElement?.value||'');
    const optionCount=await page.locator('input[data-decision-choice]').count();expect(optionCount).toBeGreaterThan(1);
    await page.keyboard.press('ArrowDown');
    const selectedId=await page.evaluate(()=>document.activeElement?.matches?.('input[data-decision-choice]')?document.activeElement.value:'');
    expect(selectedId).not.toBe('');expect(selectedId).not.toBe(originalId);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-decision-preview]')).toBeVisible();
    expect(await page.evaluate(()=>LifeOS.app.decisionCenter.preview?.alternativeId||'')).toBe(selectedId);
    await expect(page.getByRole('button',{name:'Apply this alternative'})).toBeFocused();await page.keyboard.press('Enter');
    await expect(page.locator('[data-decision-status]')).toContainText('Decision applied as one logical operation');
    await expect(page.getByRole('button',{name:'Undo Decision'})).toBeFocused();await page.keyboard.press('Enter');
    await expect(page.locator('[data-decision-status]')).toContainText('Decision undone');
    expect(await planningHash(page)).toBe(before)
  });

  test('offline Analyze → Preview → Apply → Undo remains fully local',async({page,context})=>{
    await seedTask(page,{title:'Offline master-spec task'});const before=await planningHash(page);
    await context.setOffline(true);
    try{
      expect(await page.evaluate(()=>navigator.onLine)).toBeFalsy();
      await openAndAnalyze(page);const id=await firstActionableId(page);expect(id).not.toBe('');
      await page.locator(`[data-preview="${id}"]`).click();await expect(page.locator('[data-preview-proposed]')).toBeVisible();
      await page.getByRole('button',{name:'Apply this alternative'}).click();
      await expect(page.locator('[data-decision-status]')).toContainText('Decision applied as one logical operation');
      await page.getByRole('button',{name:'Undo Decision'}).click();
      await expect(page.locator('[data-decision-status]')).toContainText('Decision undone');
      expect(await planningHash(page)).toBe(before);expect(await page.evaluate(()=>navigator.onLine)).toBeFalsy()
    }finally{await context.setOffline(false)}
  });

  test('two tabs applying the same Decision create exactly one logical mutation',async({page,context})=>{
    const task=await seedTask(page,{title:'Two-tab Decision Apply'}),date=await page.evaluate(()=>LifeOS.CoreUtil.addDays(LifeOS.CoreUtil.localDate(),1)),before=await planningHash(page);
    const second=await context.newPage();await second.goto(page.url(),{waitUntil:'domcontentloaded'});await waitForDecision(second);
    const prepare=async target=>target.evaluate(async({taskId,date})=>{const d=await LifeOS.app.decisionEngine.analyze({type:LifeOS.DECISION_TYPES.NEXT_ACTION,date,mode:'production',source:'two-tab-462'}),choice=d.alternatives.find(x=>x.candidate.kind==='task-session'&&x.candidate.taskId===taskId);if(!choice)throw new Error('No actionable candidate');globalThis.__decision462=d;globalThis.__alternative462=choice.candidate.id;return choice.candidate.id},{taskId:task.id,date});
    const [a,b]=await Promise.all([prepare(page),prepare(second)]);expect(a).toBe(b);
    const apply=target=>target.evaluate(async()=>{try{const r=await LifeOS.app.decisionEngine.apply(globalThis.__decision462,globalThis.__alternative462);return{ok:true,operationId:r.operationId||''}}catch(error){return{ok:false,code:error.code||'',message:error.message}}});
    const [one,two]=await Promise.all([apply(page),apply(second)]),successes=[one,two].filter(x=>x.ok),failures=[one,two].filter(x=>!x.ok);
    expect(successes).toHaveLength(1);expect(failures).toHaveLength(1);expect(['DECISION-STALE-461','DECISION-REVALIDATION-461']).toContain(failures[0].code);
    const state=await page.evaluate(async taskId=>{const data=await LifeOS.app.repo.dataset({fresh:true}),log=await LifeOS.app.repo.all('activityLog',{fresh:true});return{blocks:data.timeBlocks.filter(x=>x.taskId===taskId&&x.sourceType==='decision').length,histories:log.filter(x=>x.type==='decision-history'&&x.status==='Applied'&&x.affectedEntityIds?.includes(taskId)).length}},task.id);
    expect(state.blocks).toBe(1);expect(state.histories).toBe(1);
    const winner=one.ok?page:second;await winner.evaluate(()=>LifeOS.app.undo.undo());expect(await planningHash(page)).toBe(before);await second.close()
  });

  test('Morning Decision Brief is structured, local, and surfaces capacity plus deadline decision',async({page})=>{
    const today=await page.evaluate(()=>LifeOS.CoreUtil.localDate());await seedTask(page,{title:'Morning brief deadline',deadline:today});
    await page.locator('#decisionCenterButton').click();await page.getByRole('button',{name:'Morning Decision Brief'}).click();
    const brief=page.locator('[data-morning-decision-brief]');await expect(brief).toBeVisible();await expect(brief).toContainText('Today');await expect(brief).toContainText('Deadlines');await expect(brief).toContainText('Focus capacity');
    const model=await page.evaluate(()=>LifeOS.app.decisionBrief.morning(LifeOS.CoreUtil.localDate()));expect(model.localOnly).toBeTruthy();expect(model.todayRecommendation).toBeTruthy();expect(model.deadlineRecommendation).toBeTruthy()
  });

  test('End-of-Day Decision Review exposes pending outcome and records follow-up',async({page})=>{
    const task=await seedTask(page,{title:'Outcome follow-up task'}),applied=await page.evaluate(async taskId=>{const date=LifeOS.CoreUtil.localDate(),d=await LifeOS.app.decisionEngine.analyze({type:LifeOS.DECISION_TYPES.NEXT_ACTION,date,mode:'production',source:'outcome-462'}),choice=d.alternatives.find(x=>x.candidate.kind==='task-session'&&x.candidate.taskId===taskId);if(!choice)throw new Error('No actionable candidate');const r=await LifeOS.app.decisionEngine.apply(d,choice.candidate.id);return{decisionId:d.decisionId,operationId:r.operationId}},task.id);
    await page.locator('#decisionCenterButton').click();await page.getByRole('button',{name:'End-of-Day Decision Review'}).click();
    await expect(page.locator('[data-end-of-day-decision-review]')).toBeVisible();const follow=page.locator(`[data-decision-follow-up="${applied.decisionId}"]`);await expect(follow).toBeVisible();
    await follow.getByRole('button',{name:'Worked'}).click();
    await expect(page.locator('[data-decision-status]')).toContainText('Decision outcome recorded: Worked.');
    await expect(page.locator(`[data-decision-follow-up="${applied.decisionId}"]`)).toHaveCount(0);
    const outcome=await page.evaluate(async id=>LifeOS.app.repo.get('activityLog',`decision-outcome:${id}`),applied.decisionId);
    expect(outcome.status).toBe('Recorded');expect(outcome.outcome).toBe('Worked');expect(outcome.operationId).toBe(applied.operationId)
  });
});

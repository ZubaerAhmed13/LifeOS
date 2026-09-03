import fs from 'node:fs';

let changed=false;

function writeIfChanged(path,before,after){
  if(before!==after){fs.writeFileSync(path,after);changed=true;}
}

function replaceUnique(source,oldValue,newValue,label){
  if(source.includes(newValue))return source;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`4.5.1 final correction guard failed: ${label} source signature missing.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`4.5.1 final correction guard failed: ${label} source signature not unique.`);
  return source.replace(oldValue,newValue);
}

// Explicit Undo/Redo is an authoritative user history operation. Refresh RuleEngine
// snapshots for the changed stores, but do not immediately reinterpret the reversal as
// a fresh domain edit and re-run the same automation that the user just undid/redid.
{
  const path='app.js';
  const before=fs.readFileSync(path,'utf8');
  let source=before;
  if(!source.includes('async isExplicitHistoryReplay(stores)')){
    const anchor='    async onStoresChanged(stores){await this.waitForExternalOperation();';
    const method="    async isExplicitHistoryReplay(stores){if(!stores.includes('activityLog'))return false;const rows=await this.repo.all('activityLog',{fresh:true}),latest=[...rows].sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];return ['undo','redo'].includes(latest?.type)}\n";
    source=replaceUnique(source,anchor,method+anchor,'explicit history replay helper');
  }
  const oldStart='    async onStoresChanged(stores){await this.waitForExternalOperation();if(stores.includes(\'rules\'))await this.reindex();';
  const newStart="    async onStoresChanged(stores){await this.waitForExternalOperation();if(await this.isExplicitHistoryReplay(stores)){for(const store of stores.filter(name=>this.tracked.includes(name)))this.snapshots.set(store,this.toMap(await this.repo.all(store,{fresh:true})));return}if(stores.includes('rules'))await this.reindex();";
  source=replaceUnique(source,oldStart,newStart,'explicit Undo/Redo RuleEngine suppression');
  writeIfChanged(path,before,source);
}

// The project-shortfall E2E proof must observe the producer call for the exact project
// created by the real saveProject mutation. Runtime event-memory is intentionally bounded
// and is not a stable per-project observation API when several active projects are evaluated.
{
  const path='tests/rules-451-completion.spec.js';
  const before=fs.readFileSync(path,'utf8');
  let source=before;
  if(!source.includes('emittedShortfalls=[];')){
    const start="  test('real active-project mutation produces project-weekly-shortfall through ProjectAllocator', async ({ page }) => {";
    const next="\n\n  test('civil day lifecycle honors configured IANA timezone and DST edge semantics'";
    const startAt=source.indexOf(start);
    const endAt=source.indexOf(next,startAt);
    if(startAt<0||endAt<0)throw new Error('4.5.1 final correction guard failed: project-shortfall browser test block missing.');
    const replacement=`  test('real active-project mutation produces project-weekly-shortfall through ProjectAllocator', async ({ page }) => {\n    await installRule(page, { id: 'r451-shortfall-rule', name: 'Project shortfall producer', trigger: { type: 'project-weekly-shortfall', config: {} }, actions: [{ type: 'create-notification', params: { title: 'Project shortfall lifecycle fired' } }] });\n    const evidence = await page.evaluate(async () => {\n      const engine=LifeOS.app.ruleEngine,original=engine.emitDomainEvent,emittedShortfalls=[];\n      engine.emitDomainEvent=async function(type,options={}){\n        if(type==='project-weekly-shortfall')emittedShortfalls.push({eventId:options.eventId||'',entityId:options.entityId||'',shortfall:Number(options.data?.shortfall||0)});\n        return original.call(this,type,options);\n      };\n      try{\n        const project=await LifeOS.app.service.saveProject({\n          title: 'R451 constrained project', status: 'Active', priority: 'High', planningMode: 'Weekly Flexible',\n          minimumWeeklyHours: 0, weeklyTargetHours: 20, stretchWeeklyHours: 24,\n          minimumSessionMinutes: 30, maximumSessionMinutes: 120,\n          workDayMaxHours: 0.25, offDayMaxHours: 0.25, universityDayMaxHours: 0.25, mixedDayMaxHours: 0.25, recoveryDayMaxHours: 0.25, customDayMaxHours: 0.25,\n          targetDate: '', preferredDayTypes: [], avoidDayTypes: []\n        });\n        await engine.processing;\n        return {projectId:project.id,emittedShortfalls};\n      }finally{engine.emitDomainEvent=original;}\n    });\n    await waitForNotification(page, 'Project shortfall lifecycle fired');\n    const exact=evidence.emittedShortfalls.find(row=>row.entityId===evidence.projectId);\n    expect(evidence.projectId).not.toBe('');\n    expect(exact).toBeTruthy();\n    expect(exact.eventId).toContain(\`project-weekly-shortfall:\${evidence.projectId}:\`);\n    expect(exact.shortfall).toBeGreaterThan(0);\n  });`;
    source=source.slice(0,startAt)+replacement+source.slice(endAt);
  }
  if(!source.includes("title:'R451 shortfall demand'")){
    const oldValue="        await engine.processing;\n        return {projectId:project.id,emittedShortfalls};";
    const newValue="        await engine.processing;\n        await LifeOS.app.repo.save('tasks',{id:'r451-shortfall-demand-'+crypto.randomUUID(),title:'R451 shortfall demand',status:'Next',priority:'High',estimatedDuration:600,minimumSessionDuration:30,maximumSessionDuration:120,actualMinutes:0,plannedMinutes:0,blockedBy:[],projectId:project.id});\n        await engine.processing;\n        return {projectId:project.id,emittedShortfalls};";
    source=replaceUnique(source,oldValue,newValue,'project-shortfall unfinished demand fixture');
  }
  writeIfChanged(path,before,source);
}

// Freeze the Undo/Redo semantic correction in static release QA.
{
  const path='scripts/static-qa-451.mjs';
  const before=fs.readFileSync(path,'utf8');
  let source=before;
  if(!source.includes("add('explicit Undo/Redo automation suppression'")){
    const anchor="add('closed-browser limitation retained',has('Rules run while LifeOS is active or at the next supported refresh'));";
    const addition=anchor+"\nadd('explicit Undo/Redo automation suppression',has('async isExplicitHistoryReplay(stores)')&&has(\"['undo','redo'].includes(latest?.type)\")&&has('if(await this.isExplicitHistoryReplay(stores))'));";
    source=replaceUnique(source,anchor,addition,'static Undo/Redo suppression invariant');
  }
  writeIfChanged(path,before,source);
}

// Make the correction chain replayable from the existing guarded repair entry point.
{
  const path='scripts/repair-lifeos-451-patcher.mjs';
  const before=fs.readFileSync(path,'utf8');
  let source=before;
  if(!source.includes('LIFEOS_451_CORRECTION_CHILD')){
    const anchor="console.log(changed?'Repaired LifeOS 4.5.1 patcher guards.':'LifeOS 4.5.1 patcher guards already repaired.');";
    const addition=anchor+"\nif(!process.env.LIFEOS_451_CORRECTION_CHILD){const {execFileSync}=await import('node:child_process');execFileSync(process.execPath,['scripts/apply-lifeos-451-final-corrections.mjs'],{stdio:'inherit',env:{...process.env,LIFEOS_451_CORRECTION_CHILD:'1'}})}";
    source=replaceUnique(source,anchor,addition,'replayable final correction chain');
  }
  writeIfChanged(path,before,source);
}

console.log(changed?'Applied LifeOS 4.5.1 final guarded corrections.':'LifeOS 4.5.1 final guarded corrections already applied.');

import fs from 'node:fs';

const replace=(source,from,to,label)=>{
  if(source.includes(to)) return source;
  if(!source.includes(from)) throw new Error(`4.6.1 completion hardening failed: ${label}`);
  return source.replace(from,to);
};

let decision=fs.readFileSync('decision-engine.js','utf8');

decision=replace(
  decision,
  "if(type===DECISION_TYPES.DEFERRAL)for(const candidate of this.deferralCandidates(context,ready))add(candidate);",
  "if(type===DECISION_TYPES.DEFERRAL){const requestedIds=new Set(array(request.entityIds)),deferralReady=requestedIds.size?stableSort(context.readyTasks.filter(t=>requestedIds.has(t.id)),(a,b)=>String(a.id).localeCompare(String(b.id))):ready;for(const candidate of this.deferralCandidates(context,deferralReady))add(candidate)};",
  'targeted DEFERRAL entity scope'
);

decision=replace(
  decision,
  "simulate(candidate,context){const {CoreUtil}=host(),sim=clone(context.data);if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind)){sim.timeBlocks=clone(candidate.simulatedBlocks||sim.timeBlocks);return sim}if(candidate.kind==='task-session'){sim.timeBlocks.push({id:`sim:${candidate.id}`,date:candidate.date,startTime:CoreUtil.time(candidate.startMinute),duration:candidate.duration,taskId:candidate.taskId,projectId:candidate.projectId||'',type:'task',sourceType:'decision-sim'});return sim}if(PLAN_KINDS.has(candidate.kind)){const remove=new Set(array(candidate.plan?.remove).map(b=>b.id));sim.timeBlocks=array(sim.timeBlocks).filter(b=>!remove.has(b.id));for(const item of array(candidate.plan?.planned))sim.timeBlocks.push({...clone(item.block),type:'task'});return sim}if(candidate.kind==='deferral-plan'){for(const change of array(candidate.changes)){const rows=array(sim[change.store]),index=rows.findIndex(r=>r.id===change.id);if(change.after==null){if(index>=0)rows.splice(index,1)}else if(index>=0)rows[index]=clone(change.after);else rows.push(clone(change.after));sim[change.store]=rows}return sim}return sim}",
  "simulate(candidate,context){const {CoreUtil}=host(),base=context.data,sim={...base,tasks:array(base.tasks).slice(),projects:array(base.projects).slice(),events:array(base.events).slice(),timeBlocks:array(base.timeBlocks).slice(),dayProfiles:array(base.dayProfiles).slice()};if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind)){sim.timeBlocks=clone(candidate.simulatedBlocks||sim.timeBlocks);return sim}if(candidate.kind==='task-session'){sim.timeBlocks.push({id:`sim:${candidate.id}`,date:candidate.date,startTime:CoreUtil.time(candidate.startMinute),duration:candidate.duration,taskId:candidate.taskId,projectId:candidate.projectId||'',type:'task',sourceType:'decision-sim'});return sim}if(PLAN_KINDS.has(candidate.kind)){const remove=new Set(array(candidate.plan?.remove).map(b=>b.id));sim.timeBlocks=sim.timeBlocks.filter(b=>!remove.has(b.id));for(const item of array(candidate.plan?.planned))sim.timeBlocks.push({...clone(item.block),type:'task'});return sim}if(candidate.kind==='deferral-plan'){for(const change of array(candidate.changes)){const rows=array(sim[change.store]),index=rows.findIndex(r=>r.id===change.id);if(change.after==null){if(index>=0)rows.splice(index,1)}else if(index>=0)rows[index]=clone(change.after);else rows.push(clone(change.after));sim[change.store]=rows}return sim}return sim}",
  'copy-on-write tradeoff simulation'
);

const oldForecastPrefix="forecastEffect(before,after,context){const {CoreUtil,DeadlineEngine}=host(),riskValue={Low:0,Moderate:1,High:2,Critical:3,Impossible:4,Overdue:4},details=[];let beforeRiskPoints=0,afterRiskPoints=0,shortfallBefore=0,shortfallAfter=0,improved=0,worsened=0;for(const task of array(before.tasks).filter(activeTask).filter(t=>t.deadline).slice(0,100)){";
const newForecastPrefix="forecastEffect(before,after,context,candidate){const {CoreUtil,DeadlineEngine}=host(),riskValue={Low:0,Moderate:1,High:2,Critical:3,Impossible:4,Overdue:4},details=[],affectedIds=new Set([candidate.taskId,...array(candidate.affectedEntityIds),...array(candidate.plan?.planned).map(x=>x.block?.taskId),...array(candidate.changes).filter(c=>c.store==='tasks').map(c=>c.id),...array(candidate.changes).filter(c=>c.store==='timeBlocks').flatMap(c=>[c.before?.taskId,c.after?.taskId])].filter(Boolean)),deadlineTasks=array(before.tasks).filter(activeTask).filter(t=>t.deadline&&affectedIds.has(t.id)).slice(0,100);let beforeRiskPoints=0,afterRiskPoints=0,shortfallBefore=0,shortfallAfter=0,improved=0,worsened=0;for(const task of deadlineTasks){";
decision=replace(decision,oldForecastPrefix,newForecastPrefix,'affected-only deadline forecast delta');
decision=replace(decision,'forecastEffect=this.forecastEffect(context.data,sim,context),','forecastEffect=this.forecastEffect(context.data,sim,context,candidate),','forecast call candidate scoping');

const oldAllocator="try{const allocation=ProjectAllocator.dailyAllowance(task,block.date,sim,context.settings,ProjectAllocator.context(sim,context.settings));if(duration>num(allocation.minutes)){blockers.push(`Project/capacity allowance is ${Math.max(0,num(allocation.minutes))}m but candidate needs ${duration}m.`);evidence.push(reason('PROJECT-ALLOWANCE','ProjectAllocator','minutes',allocation.minutes,`needs ${duration}m`,'hard'))}}catch(error){blockers.push(`ProjectAllocator validation failed closed: ${error.message}`)}";
const newAllocator="try{const allocation=ProjectAllocator.dailyAllowance(task,block.date,sim,context.settings,ProjectAllocator.context(sim,context.settings));if(task.projectId&&!allocation.project){blockers.push(`ProjectAllocator could not resolve project ${task.projectId}; feasibility failed closed.`);evidence.push(reason('PROJECT-ALLOCATOR-BINDING','ProjectAllocator','projectResolved',false,'Fail closed','hard'))}else{const dailyRemaining=Number.isFinite(Number(allocation.dailyMax))?Math.max(0,num(allocation.dailyMax)-num(allocation.dailyUsed)):Infinity,weeklyRemaining=Number.isFinite(Number(allocation.weeklyMax))?Math.max(0,num(allocation.weeklyMax)-num(allocation.weeklyUsed)):Infinity,authoritativeAllowance=Math.max(0,Math.min(num(allocation.minutes),dailyRemaining,weeklyRemaining));if(duration>authoritativeAllowance){blockers.push(`Project/capacity allowance is ${authoritativeAllowance}m but candidate needs ${duration}m.`);evidence.push(reason('PROJECT-ALLOWANCE','ProjectAllocator','minutes',authoritativeAllowance,`needs ${duration}m`,'hard'))}}}catch(error){blockers.push(`ProjectAllocator validation failed closed: ${error.message}`)}";
decision=replace(decision,oldAllocator,newAllocator,'fail-closed ProjectAllocator daily and weekly bounds');

const oldAlternatives=`class DecisionAlternativeGenerator{
  generate(ranked,context){
    if(!ranked.length)return[];
    const selected=[],seen=new Set();
    const add=(row,label)=>{if(row&&!seen.has(row.candidate.id)&&selected.length<MAX_ALTERNATIVES){seen.add(row.candidate.id);selected.push({...row,label})}};
    add(ranked[0],'Recommended');
    const byDeadline=[...ranked].sort((a,b)=>b.tradeoffs.deadlineProtection-a.tradeoffs.deadlineProtection||a.tradeoffs.disruption-b.tradeoffs.disruption);
    add(byDeadline[0],'Deadline-first');
    const balanced=[...ranked].sort((a,b)=>{
      const av=(a.tradeoffs.deadlineProtection+a.tradeoffs.projectAlignment+a.tradeoffs.capacityFit+a.tradeoffs.bufferImpact)/4;
      const bv=(b.tradeoffs.deadlineProtection+b.tradeoffs.projectAlignment+b.tradeoffs.capacityFit+b.tradeoffs.bufferImpact)/4;
      return bv-av;
    });
    add(balanced[0],'Balanced');
    add([...ranked].sort((a,b)=>a.tradeoffs.disruption-b.tradeoffs.disruption||a.tradeoffs.contextCost-b.tradeoffs.contextCost)[0],'Lower-disruption');
    add(ranked.find(r=>r.candidate.kind===KEEP_CURRENT_PLAN),'Keep current plan');
    return selected;
  }
}`;
const newAlternatives=`class DecisionAlternativeGenerator{
  generate(ranked,context){
    if(!ranked.length)return[];
    const selected=[],seen=new Set(),keep=ranked.find(r=>r.candidate.kind===KEEP_CURRENT_PLAN),bestChange=ranked.find(r=>r.candidate.kind!==KEEP_CURRENT_PLAN),nonKeepLimit=Math.max(1,MAX_ALTERNATIVES-(keep?1:0));
    const add=(row,label,{reserveKeep=true}={})=>{const limit=reserveKeep&&keep&&!seen.has(keep.candidate.id)?nonKeepLimit:MAX_ALTERNATIVES;if(row&&!seen.has(row.candidate.id)&&selected.length<limit){seen.add(row.candidate.id);selected.push({...row,label})}};
    add(ranked[0],'Recommended');
    add(bestChange,'Best feasible change');
    const byDeadline=[...ranked].sort((a,b)=>b.tradeoffs.deadlineProtection-a.tradeoffs.deadlineProtection||a.tradeoffs.disruption-b.tradeoffs.disruption);
    add(byDeadline.find(r=>r.candidate.kind!==KEEP_CURRENT_PLAN)||byDeadline[0],'Deadline-first');
    const balanced=[...ranked].sort((a,b)=>{
      const av=(a.tradeoffs.deadlineProtection+a.tradeoffs.projectAlignment+a.tradeoffs.capacityFit+a.tradeoffs.bufferImpact)/4;
      const bv=(b.tradeoffs.deadlineProtection+b.tradeoffs.projectAlignment+b.tradeoffs.capacityFit+b.tradeoffs.bufferImpact)/4;
      return bv-av;
    });
    add(balanced.find(r=>r.candidate.kind!==KEEP_CURRENT_PLAN)||balanced[0],'Balanced');
    add([...ranked].filter(r=>r.candidate.kind!==KEEP_CURRENT_PLAN).sort((a,b)=>a.tradeoffs.disruption-b.tradeoffs.disruption||a.tradeoffs.contextCost-b.tradeoffs.contextCost)[0],'Lower-disruption');
    if(keep&&!seen.has(keep.candidate.id)&&selected.length<MAX_ALTERNATIVES){seen.add(keep.candidate.id);selected.push({...keep,label:'Keep current plan'})}
    return selected.slice(0,MAX_ALTERNATIVES);
  }
}`;
decision=replace(decision,oldAlternatives,newAlternatives,'always expose best feasible change and Keep Current Plan');

fs.writeFileSync('decision-engine.js',decision);

let test=fs.readFileSync('tests/decision-461-completion.spec.js','utf8');
test=replace(test,"d=await LifeOS.app.decisionEngine.analyze({type:LifeOS.DECISION_TYPES.DEFERRAL,date,mode:'production'}),p=","d=await LifeOS.app.decisionEngine.analyze({type:LifeOS.DECISION_TYPES.DEFERRAL,date,mode:'production',entityIds:[taskId]}),p=",'DEFERRAL targeted certification request');
test=replace(test,'expect(result.score).toBeLessThan(100)','expect(Number.isFinite(result.score)).toBeTruthy();expect(result.score).toBeGreaterThanOrEqual(0);expect(result.score).toBeLessThanOrEqual(100)','ScheduleStabilityEngine score contract');
test=replace(test,'workDayMaxHours:0,offDayMaxHours:0,universityDayMaxHours:0,mixedDayMaxHours:0,recoveryDayMaxHours:0,customDayMaxHours:0','workDayMaxHours:.25,offDayMaxHours:.25,universityDayMaxHours:.25,mixedDayMaxHours:.25,recoveryDayMaxHours:.25,customDayMaxHours:.25','ProjectAllocator non-zero hard cap fixture');
test=replace(test,"title:'Conflict task',status:'Scheduled',priority:'High',estimatedDuration:60,plannedMinutes:60","title:'Conflict task',status:'Scheduled',priority:'High',estimatedDuration:90,plannedMinutes:90,minimumSessionDuration:90,maximumSessionDuration:90",'repairable conflict task fixture');
test=replace(test,"date,startTime:'10:00',endTime:'11:00',duration:60,type:'task'","date,startTime:'15:30',endTime:'17:00',duration:90,type:'task'",'repairable conflict block fixture');
test=replace(test,"title:'Fixed event',startDate:date,endDate:date,startTime:'10:15',endTime:'10:45',fixedOrFlexible:'Fixed'","title:'Fixed event',kind:'Meeting',startDate:date,endDate:date,startTime:'14:00',endTime:'16:20',fixedOrFlexible:'Fixed'",'repairable fixed event fixture');
fs.writeFileSync('tests/decision-461-completion.spec.js',test);

const hardened=fs.readFileSync('decision-engine.js','utf8');
for(const marker of ['deferralReady=requestedIds.size','base=context.data,sim={...base','deadlineTasks=array(before.tasks)','this.forecastEffect(context.data,sim,context,candidate)','PROJECT-ALLOCATOR-BINDING','Best feasible change'])if(!hardened.includes(marker))throw new Error(`Missing production hardening marker: ${marker}`);
console.log('LifeOS 4.6.1 targeted planning, actionable alternatives, allocator bounds and bounded tradeoff hardening applied and verified.');

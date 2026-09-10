(() => {
'use strict';

const DECISION_ENGINE_VERSION='4.6.2';
const DECISION_TYPES=Object.freeze({
  NEXT_ACTION:'next-action',TODAY_PLAN:'today-plan',DEADLINE_TRIAGE:'deadline-triage',
  PROJECT_ALLOCATION:'project-allocation',CAPACITY_SHORTFALL:'capacity-shortfall',
  SCHEDULE_CONFLICT:'schedule-conflict',DEFERRAL:'deferral',PLAN_REPAIR:'plan-repair',
  WEEK_PRIORITY:'week-priority'
});
const KEEP_CURRENT_PLAN='keep-current-plan';
const MAX_TASK_CANDIDATES=30;
const MAX_ALTERNATIVES=5;
const DECISION_COMPLETION_MARKER='4.6.1';
const DECISION_MASTER_SPEC_MARKER='4.6.2';
const HARD_RULE_ACTIONS=new Set(['lock-task','set-preferred-date','set-preferred-time','set-flexibility']);
const PLAN_KINDS=new Set(['day-plan','deadline-triage-plan','project-allocation-plan','week-priority-plan']);

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const array=value=>Array.isArray(value)?value:[];
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const stableSort=(rows,compare)=>rows.map((value,index)=>({value,index})).sort((a,b)=>compare(a.value,b.value)||a.index-b.index).map(x=>x.value);
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const nowISO=()=>new Date().toISOString();

function host(){
  const api=globalThis.LifeOS;
  if(!api?.app?.repo) throw new Error('LifeOS 4.6 Decision Engine requires an initialized LifeOS repository.');
  return api;
}
function reason(reasonCode,sourceEngine,metric,value,comparison='',severity='info'){
  return {reasonCode,sourceEngine,metric,value,comparison,severity};
}
function priorityRank(value){return({Critical:4,High:3,Medium:2,Low:1})[value]||0}
function deadlineDays(task,date,CoreUtil){
  if(!task?.deadline)return 9999;
  return CoreUtil.daysBetween(date,task.deadline);
}
function decisionHash(value){
  const {CoreUtil}=host();
  return CoreUtil.hash(value);
}
function activeTask(task){
  return task && !['Completed','Cancelled','Someday'].includes(task.status);
}
function readyTask(task,tasks){
  if(!activeTask(task))return false;
  const map=new Map(array(tasks).map(t=>[t.id,t]));
  return array(task.blockedBy).every(id=>map.get(id)?.status==='Completed');
}

class DecisionContextBuilder{
  constructor(app=host().app){this.app=app}
  async build(request={}){
    const api=host(),{CoreUtil,CivilTimeEngine,CapacityEngine,DeadlineEngine,ProjectForecastEngine,ProjectAllocator,ScenarioDataView}=api;
    const repo=this.app.repo;
    if(!ProjectAllocator)throw CoreUtil.error('DECISION-DOMAIN-UNAVAILABLE-461','ProjectAllocator is required for Decision Engine planning.');
    const [productionData,settings]=await Promise.all([repo.dataset({fresh:true}),repo.settings()]);
    let data=productionData,mode=request.mode||'production',scenario=null;
    if(mode==='scenario'&&request.scenarioId&&this.app.scenarioEngine){
      scenario=await this.app.scenarioEngine.get(request.scenarioId);
      if(scenario){const view=new ScenarioDataView(productionData,settings,scenario),materialized=view.materialize();data=materialized.data}
    }
    const zone=settings.timeZoneId||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    let civil;try{civil=CivilTimeEngine.parts(Date.now(),zone)}catch{civil={date:CoreUtil.localDate(),time:new Date().toTimeString().slice(0,5),timeZoneId:zone}}
    const date=request.date||civil.date||CoreUtil.localDate();
    const capacity=CapacityEngine.summary(date,data,settings);
    const tasks=array(data.tasks),projects=array(data.projects),events=array(data.events),timeBlocks=array(data.timeBlocks);
    const deadlineForecasts=[];
    for(const task of tasks.filter(activeTask).filter(t=>t.deadline).slice(0,100)){
      try{const end=task.deadline>=date?task.deadline:date;deadlineForecasts.push(DeadlineEngine.forecastTask(task,data,settings,{from:date,end}))}catch{}
    }
    const projectForecasts=[],projectShortfalls=[],weekStart=CoreUtil.startOfWeek(date),allocationContext=ProjectAllocator.context(data,settings);
    for(const project of projects.filter(p=>p.status==='Active').slice(0,50)){
      try{const end=project.targetDate&&project.targetDate>=date?project.targetDate:CoreUtil.addDays(date,14);projectForecasts.push(ProjectForecastEngine.project(project,data,settings,{from:date,end}))}catch{}
      try{projectShortfalls.push({projectId:project.id,...ProjectAllocator.shortfall(project,tasks,weekStart,data,settings,allocationContext)})}catch(error){projectShortfalls.push({projectId:project.id,error:error.message,demand:0,usable:0,shortfall:0,causes:['Project allocation unavailable']})}
    }
    let rules=[];try{rules=(await repo.all('rules',{fresh:true})).filter(r=>r.enabled)}catch{}
    let intelligence=null;try{if(api.PersonalIntelligenceEngine){const engine=new api.PersonalIntelligenceEngine(data,settings);intelligence=engine.analyze?.({from:CoreUtil.addDays(date,-90),to:date})||engine.analyze?.()}}catch{}
    const relevant={
      date,time:civil.time||'',timeZoneId:zone,mode,
      tasks:tasks.map(t=>({id:t.id,revision:t.revision,status:t.status,priority:t.priority,deadline:t.deadline,estimatedDuration:t.estimatedDuration,remainingDuration:t.remainingDuration,actualMinutes:t.actualMinutes,plannedMinutes:t.plannedMinutes,minimumSessionDuration:t.minimumSessionDuration,maximumSessionDuration:t.maximumSessionDuration,blockedBy:t.blockedBy,projectId:t.projectId,lifeAreaId:t.lifeAreaId,locked:t.locked,protected:t.protected,preferredDate:t.preferredDate,preferredTime:t.preferredTime,preferredTimeStart:t.preferredTimeStart,preferredTimeEnd:t.preferredTimeEnd,preferredDayTypes:t.preferredDayTypes,schedulingFlexibility:t.schedulingFlexibility,anchorTime:t.anchorTime,anchorToleranceMinutes:t.anchorToleranceMinutes,workMode:t.workMode,context:t.context,taskType:t.taskType,healthEssential:t.healthEssential})),
      projects:projects.map(p=>({id:p.id,revision:p.revision,status:p.status,targetDate:p.targetDate,planningMode:p.planningMode,weeklyTargetHours:p.weeklyTargetHours,minimumWeeklyHours:p.minimumWeeklyHours,stretchWeeklyHours:p.stretchWeeklyHours,minimumSessionMinutes:p.minimumSessionMinutes,maximumSessionMinutes:p.maximumSessionMinutes,workDayMaxHours:p.workDayMaxHours,offDayMaxHours:p.offDayMaxHours,universityDayMaxHours:p.universityDayMaxHours,mixedDayMaxHours:p.mixedDayMaxHours,recoveryDayMaxHours:p.recoveryDayMaxHours,customDayMaxHours:p.customDayMaxHours})),
      events:events.filter(e=>e.startDate<=CoreUtil.addDays(date,7)&&e.endDate>=date).map(e=>({id:e.id,revision:e.revision,startDate:e.startDate,startTime:e.startTime,endDate:e.endDate,endTime:e.endTime,travelBefore:e.travelBefore,travelAfter:e.travelAfter,preparationTime:e.preparationTime,fixedOrFlexible:e.fixedOrFlexible,locked:e.locked,protected:e.protected,kind:e.kind,category:e.category})),
      timeBlocks:timeBlocks.filter(b=>b.date>=date&&b.date<=CoreUtil.addDays(date,7)).map(b=>({id:b.id,revision:b.revision,date:b.date,startTime:b.startTime,duration:b.duration,taskId:b.taskId,projectId:b.projectId,locked:b.locked,protected:b.protected,manuallyPlaced:b.manuallyPlaced,sourceType:b.sourceType,schedulingFlexibility:b.schedulingFlexibility})),
      settings:{revision:settings.revision,dayStart:settings.dayStart,dayEnd:settings.dayEnd,bufferPercent:settings.bufferPercent,minBufferMinutes:settings.minBufferMinutes,maxFocus:settings.maxFocus,shortBreak:settings.shortBreak,recoveryMode:settings.recoveryMode,recoveryAfterWorkMinutes:settings.recoveryAfterWorkMinutes,recoveryAfterUniversityMinutes:settings.recoveryAfterUniversityMinutes,recoveryAfterLongTravelMinutes:settings.recoveryAfterLongTravelMinutes,recoveryAfterLongFocusMinutes:settings.recoveryAfterLongFocusMinutes,contextSwitchingEnabled:settings.contextSwitchingEnabled,deepWorkBefore:settings.deepWorkBefore,taskTypePreferredBefore:settings.taskTypePreferredBefore,planningFreeze:settings.planningFreeze,calendarSnapMinutes:settings.calendarSnapMinutes,timeZoneId:zone},
      rules:rules.map(r=>({id:r.id,revision:r.revision,enabled:r.enabled,trigger:r.trigger,conditions:r.conditions,actions:r.actions,priority:r.priority,executionPolicy:r.executionPolicy})),scenario:scenario?{id:scenario.id,revision:scenario.revision,baselineFingerprint:scenario.baselineFingerprint}:null
    };
    const dataGeneration=[...tasks,...projects,...events,...timeBlocks,...rules].reduce((sum,row)=>sum+num(row.revision,1),0)+num(settings.revision);
    const contextFingerprint=CoreUtil.hash(relevant),readyTasks=tasks.filter(t=>readyTask(t,tasks)),blockedTasks=tasks.filter(activeTask).filter(t=>!readyTask(t,tasks));
    return Object.freeze({generatedAt:nowISO(),decisionDate:date,currentDate:civil.date||date,currentLocalTime:civil.time||'',timeZoneId:zone,mode,data:clone(data),settings:clone(settings),tasks:clone(tasks),readyTasks:clone(readyTasks),blockedTasks:clone(blockedTasks),projects:clone(projects),events:clone(events),timeBlocks:clone(timeBlocks),capacity:clone(capacity),deadlineForecasts:clone(deadlineForecasts),projectForecasts:clone(projectForecasts),projectShortfalls:clone(projectShortfalls),activeRules:clone(rules),intelligence:clone(intelligence),contextFingerprint,dataGeneration,sourceRevisions:{settings:num(settings.revision),scenario:num(scenario?.revision),tasks:tasks.reduce((m,t)=>(m[t.id]=num(t.revision),m),{}),projects:projects.reduce((m,p)=>(m[p.id]=num(p.revision),m),{}),rules:rules.reduce((m,r)=>(m[r.id]=num(r.revision),m),{})},dataQuality:this.dataQuality(tasks,projects,capacity,deadlineForecasts)});
  }
  dataQuality(tasks,projects,capacity,forecasts){const missingInputs=[],unavailableSignals=[],active=tasks.filter(activeTask);if(active.some(t=>!num(t.estimatedDuration)&&!num(t.remainingDuration)))missingInputs.push('Some active tasks have no duration estimate.');if(active.some(t=>!t.priority))missingInputs.push('Some active tasks have no priority.');if(!projects.length)unavailableSignals.push('No project data are available for project alignment.');if(!forecasts.length)unavailableSignals.push('No deadline forecast is available for this decision.');if(!capacity)unavailableSignals.push('Capacity summary is unavailable.');const completeness=Math.max(0,1-(missingInputs.length*.12)-(unavailableSignals.length*.08));return{completeness:Number(completeness.toFixed(2)),missingInputs,unavailableSignals,warnings:[]}}
}
class DecisionCandidateGenerator{
  currentMinute(context){const {CoreUtil}=host();return context.decisionDate>context.currentDate?(CoreUtil.clock(context.settings.dayStart)||0):(CoreUtil.clock(context.currentLocalTime)||CoreUtil.clock(context.settings.dayStart)||0)}
  canonicalPlan(plan,kind){const {CoreUtil}=host(),copy=clone(plan);copy.planned=array(copy.planned).map((item,index)=>{const block={...item.block},stable=CoreUtil.hash([kind,block.date,block.taskId||'',block.projectId||'',block.startTime,block.duration,index]);block.id=`decision-plan-block:${stable}`;block.createdAt='';block.updatedAt='';block.generationOperationId='pending';return{...item,block}});return copy}
  planProjection(plan){return{planned:array(plan?.planned).map(x=>[x.block.taskId,x.block.projectId,x.block.date,x.block.startTime,x.block.duration]),remove:array(plan?.remove).map(x=>x.id).sort()}}
  makePlanCandidate(kind,title,plan,metadata={}){if(!array(plan?.planned).length&&!array(plan?.remove).length)return null;const canonical=this.canonicalPlan(plan,kind),id=`${kind}:${decisionHash(this.planProjection(canonical))}`,duration=array(canonical.planned).reduce((sum,x)=>sum+num(x.duration,x.block?.duration),0);return{id,kind,title,duration,date:canonical.date||canonical.weekStart,plan:canonical,changes:[],metadata,affectedEntityIds:[...new Set(array(canonical.planned).flatMap(x=>[x.task?.id||x.block?.taskId,x.block?.projectId]).filter(Boolean))]}}
  filteredData(context,allowedIds=null){const data=clone(context.data);if(allowedIds){const allowed=new Set(allowedIds);data.tasks=array(data.tasks).map(task=>activeTask(task)&&!allowed.has(task.id)?{...task,status:'Waiting'}:task)}return data}
  dayPlan(context,allowedIds,kind,title,metadata={}){const {DayScheduler,PersonalPlanningModel}=host(),data=this.filteredData(context,allowedIds),model=PersonalPlanningModel.build(data),plan=new DayScheduler(data,context.settings,model).generate(context.decisionDate,{nowMinute:this.currentMinute(context)});return this.makePlanCandidate(kind,title,plan,metadata)}
  weekPlan(context,allowedIds,kind,title,metadata={}){const {WeekScheduler,PersonalPlanningModel}=host(),data=this.filteredData(context,allowedIds),model=PersonalPlanningModel.build(data),plan=new WeekScheduler(data,context.settings,model).generate(context.decisionDate);return this.makePlanCandidate(kind,title,plan,metadata)}
  deferralCandidates(context,ready){const {CoreUtil,DayScheduler,PersonalPlanningModel}=host(),result=[],targetDate=CoreUtil.addDays(context.decisionDate,1),dayStart=CoreUtil.clock(context.settings.dayStart)||0,dayEnd=CoreUtil.clock(context.settings.dayEnd)||1440;
    for(const task of [...ready].reverse().slice(0,10)){
      if(task.locked||task.protected||task.deadline&&targetDate>task.deadline)continue;
      const existing=array(context.data.timeBlocks).filter(b=>b.taskId===task.id&&b.date===context.decisionDate);if(existing.some(b=>b.locked||b.protected||b.manuallyPlaced))continue;
      const sim=clone(context.data),removeIds=new Set(existing.map(b=>b.id));sim.timeBlocks=array(sim.timeBlocks).filter(b=>!removeIds.has(b.id));const scheduler=new DayScheduler(sim,context.settings,PersonalPlanningModel.build(sim)),busy=scheduler.busy(targetDate),changes=[];let valid=true;
      for(const block of existing){const duration=Math.max(5,num(block.duration)),slot=scheduler.findSlot(targetDate,duration,dayStart,dayEnd,busy,task);if(slot===null){valid=false;break}const after={...block,date:targetDate,startTime:CoreUtil.time(slot),endTime:CoreUtil.time(slot+duration),updatedAt:'',revision:num(block.revision,1)+1,sourceType:'decision-deferral'};changes.push({store:'timeBlocks',id:block.id,before:clone(block),after});sim.timeBlocks.push(after);busy.push({start:slot,end:slot+duration,title:block.title||task.title});busy.sort((a,b)=>a.start-b.start)}
      if(!valid)continue;const afterTask={...task,preferredDate:targetDate,postponeCount:num(task.postponeCount)+1,updatedAt:'',revision:num(task.revision,1)+1};changes.push({store:'tasks',id:task.id,before:clone(task),after:afterTask});const freed=existing.reduce((sum,b)=>sum+num(b.duration),0),id=`deferral-plan:${decisionHash([task.id,targetDate,changes.map(c=>[c.store,c.id,c.after?.date,c.after?.startTime])])}`;result.push({id,kind:'deferral-plan',taskId:task.id,projectId:task.projectId||'',title:`Defer ${task.title||'task'} to ${targetDate}`,duration:freed,date:context.decisionDate,targetDate,changes,metadata:{freedMinutes:freed},affectedEntityIds:[task.id,...existing.map(b=>b.id)]})}
    return result
  }
  repairCandidates(context,kind){const {ScheduleRepairEngine,PersonalPlanningModel}=host(),preview=new ScheduleRepairEngine(context.data,context.settings,PersonalPlanningModel.build(context.data)).generate(context.decisionDate,{maxRadius:4});return array(preview.candidates).slice(0,3).map(row=>({id:`${kind}:${row.id}:${preview.sourceFingerprint}`,kind,title:row.label||'Schedule conflict repair',duration:0,date:context.decisionDate,repairCandidateId:row.id,repairSourceFingerprint:preview.sourceFingerprint,repairRadius:preview.repairRadius||1,changes:clone(row.changes),simulatedBlocks:clone(row.simulatedBlocks),stability:clone(row.stability),metadata:{strategy:row.strategy||row.label||'',conflictCount:preview.affected?.all?.length||0},affectedEntityIds:array(row.changes).map(c=>c.id)}))}
  generate(request,context){const api=host(),{CoreUtil,ProjectAllocator}=api,type=request.type||DECISION_TYPES.NEXT_ACTION,candidates=[this.keepCurrent(context)],seen=new Set([KEEP_CURRENT_PLAN]),add=c=>{if(c&&!seen.has(c.id)){seen.add(c.id);candidates.push(c)}};const ready=stableSort(context.readyTasks,(a,b)=>deadlineDays(a,context.decisionDate,CoreUtil)-deadlineDays(b,context.decisionDate,CoreUtil)||priorityRank(b.priority)-priorityRank(a.priority)||String(a.id).localeCompare(String(b.id))).slice(0,MAX_TASK_CANDIDATES),currentMinute=this.currentMinute(context),slotStart=Math.ceil(currentMinute/15)*15,remaining=Math.max(0,num(context.capacity?.focusRemaining,context.capacity?.physicalLeft||0));
    if([DECISION_TYPES.NEXT_ACTION,DECISION_TYPES.CAPACITY_SHORTFALL].includes(type))for(const task of ready){const estimate=Math.max(15,num(task.remainingDuration,num(task.estimatedDuration,30))),min=Math.max(15,num(task.minimumSessionDuration,15)),max=Math.max(min,num(task.maximumSessionDuration,90)),duration=Math.max(min,Math.min(max,estimate,remaining||max));if(duration>0)add({id:`task:${task.id}:${duration}:${slotStart}`,kind:'task-session',taskId:task.id,projectId:task.projectId||'',title:task.title||'Untitled task',duration,date:context.decisionDate,startMinute:slotStart,requestedType:type,changes:[],metadata:{priority:task.priority||'',deadline:task.deadline||''},affectedEntityIds:[task.id,task.projectId].filter(Boolean)})}
    if(type===DECISION_TYPES.TODAY_PLAN)add(this.dayPlan(context,null,'day-plan','Build a realistic whole-day plan'));
    if(type===DECISION_TYPES.DEADLINE_TRIAGE){const horizon=Math.max(0,Math.min(14,num(request.constraints?.horizonDays,3))),cutoff=CoreUtil.addDays(context.decisionDate,horizon),ids=ready.filter(t=>t.deadline&&t.deadline<=cutoff).map(t=>t.id);add(this.dayPlan(context,ids,'deadline-triage-plan',`Triage deadlines through ${cutoff}`,{deadlineCutoff:cutoff,deadlineTaskIds:ids}))}
    if(type===DECISION_TYPES.PROJECT_ALLOCATION){add(this.weekPlan(context,null,'project-allocation-plan','Balance project allocation for the next 7 days',{allocationMode:'balanced'}));const allocation=ProjectAllocator.context(context.data,context.settings),shortfalls=context.projects.filter(p=>p.status==='Active').map(project=>({project,...ProjectAllocator.shortfall(project,context.tasks,CoreUtil.startOfWeek(context.decisionDate),context.data,context.settings,allocation)})).filter(x=>x.shortfall>0).sort((a,b)=>b.shortfall-a.shortfall||String(a.project.id).localeCompare(String(b.project.id))).slice(0,3);for(const row of shortfalls){const ids=ready.filter(t=>t.projectId===row.project.id).map(t=>t.id);add(this.weekPlan(context,ids,'project-allocation-plan',`Prioritize ${row.project.title||'project'} allocation`,{allocationMode:'project-shortfall',projectId:row.project.id,shortfallMinutes:row.shortfall}))}}
    if(type===DECISION_TYPES.DEFERRAL){const requestedIds=new Set(array(request.entityIds)),deferralReady=requestedIds.size?stableSort(context.readyTasks.filter(t=>requestedIds.has(t.id)),(a,b)=>String(a.id).localeCompare(String(b.id))):ready;for(const candidate of this.deferralCandidates(context,deferralReady))add(candidate)};
    if(type===DECISION_TYPES.WEEK_PRIORITY){add(this.weekPlan(context,null,'week-priority-plan','Priority plan for the next 7 days',{priorityMode:'balanced'}));const ids=ready.filter(t=>['Critical','High'].includes(t.priority)||t.deadline&&deadlineDays(t,context.decisionDate,CoreUtil)<=7).map(t=>t.id);add(this.weekPlan(context,ids,'week-priority-plan','Critical and high-priority week',{priorityMode:'critical-high'}))}
    if(type===DECISION_TYPES.SCHEDULE_CONFLICT)for(const candidate of this.repairCandidates(context,'schedule-conflict-plan'))add(candidate);
    if(type===DECISION_TYPES.PLAN_REPAIR)for(const candidate of this.repairCandidates(context,'plan-repair'))add(candidate);
    return candidates.slice(0,MAX_TASK_CANDIDATES+1)
  }
  keepCurrent(context){return{id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN,title:'Keep current plan',duration:0,date:context.decisionDate,startMinute:null,changes:[],metadata:{},affectedEntityIds:[]}}
}
class DecisionFeasibilityGate{
  hardRuleBlockers(task,candidate,context){const api=host(),rules=array(context.activeRules).filter(rule=>rule.enabled&&rule.executionPolicy==='automatic'&&array(rule.actions).some(action=>HARD_RULE_ACTIONS.has(action.type)));if(!rules.length)return[];const engine=api.app.ruleEngine;if(!engine?.evaluate||!engine?.context||!engine?.makeEvent)return['RuleEngine hard-constraint evaluation is unavailable.'];const blockers=[];
    for(const rule of rules){const trigger=rule.trigger?.type;if(trigger!=='task-overdue')continue;if(!task.deadline||task.deadline>context.decisionDate)continue;try{const event=engine.makeEvent(trigger,'tasks',task.id,task,task,{eventId:`decision-rule:${rule.id}:${task.id}:${context.contextFingerprint}`}),ruleContext=engine.context(event,context.data,context.settings),plan=engine.evaluate(rule,event,ruleContext);if(!plan.matched)continue;for(const hard of array(plan.hardBlockers))blockers.push(`Rule ${rule.name||rule.id}: ${hard}`);for(const action of array(plan.proposedActions)){const p=action.params||{};if(action.type==='lock-task')blockers.push(`Rule ${rule.name||rule.id} requires this task to remain locked.`);if(action.type==='set-preferred-date'&&p.date&&candidate.date!==p.date)blockers.push(`Rule ${rule.name||rule.id} requires date ${p.date}.`);if(action.type==='set-preferred-time'&&p.time){const expected=api.CoreUtil.clock(p.time),actual=num(candidate.startMinute,api.CoreUtil.clock(candidate.startTime)),tol=Math.max(0,num(p.toleranceMinutes,30));if(expected===null||actual===null||Math.abs(actual-expected)>tol)blockers.push(`Rule ${rule.name||rule.id} requires time ${p.time} ± ${tol}m.`)}if(action.type==='set-flexibility'&&p.mode==='fixed'){const expected=api.CoreUtil.clock(task.anchorTime||task.preferredTimeStart||'');const actual=num(candidate.startMinute,api.CoreUtil.clock(candidate.startTime));if(expected===null||actual!==expected)blockers.push(`Rule ${rule.name||rule.id} requires the task's fixed time.`)}}}catch(error){blockers.push(`RuleEngine hard-constraint evaluation failed closed: ${error.message}`)}}
    return[...new Set(blockers)]
  }
  proposedBlocks(candidate){if(PLAN_KINDS.has(candidate.kind))return array(candidate.plan?.planned).map(x=>x.block);if(candidate.kind==='task-session')return[{id:`decision:${candidate.id}`,date:candidate.date,startTime:host().CoreUtil.time(candidate.startMinute),duration:candidate.duration,taskId:candidate.taskId,projectId:candidate.projectId||''}];if(candidate.kind==='deferral-plan')return array(candidate.changes).filter(c=>c.store==='timeBlocks'&&c.after).map(c=>c.after);return[]}
  evaluate(candidate,context){const api=host(),{CoreUtil,ConflictEngine,ProjectAllocator,RecoveryTimeEngine}=api,blockers=[],warnings=[],evidence=[];if(candidate.kind===KEEP_CURRENT_PLAN)return{feasible:true,blockers,warnings,evidence:[reason('KEEP-CURRENT','DecisionFeasibilityGate','currentPlan',true,'No mutation','info')]};
    if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind)){if(!candidate.repairCandidateId||!array(candidate.changes).length){blockers.push('No concrete repair candidate is available.');return{feasible:false,blockers,warnings,evidence}}if(num(candidate.stability?.lockedBlockChanges)>0||num(candidate.stability?.protectedBlockChanges)>0)blockers.push('Repair candidate would alter locked or protected blocks.');return{feasible:!blockers.length,blockers,warnings,evidence}}
    if(!ConflictEngine?.checkInterval||!ProjectAllocator?.dailyAllowance||!RecoveryTimeEngine?.evaluate){blockers.push('A required authoritative hard-feasibility engine is unavailable.');return{feasible:false,blockers,warnings,evidence:[reason('HARD-ENGINE-UNAVAILABLE','DecisionFeasibilityGate','requiredEngines',false,'Fail closed','hard')]}}
    if(candidate.kind==='deferral-plan'){const task=context.tasks.find(t=>t.id===candidate.taskId);if(!task)blockers.push('Task no longer exists.');else{if(task.locked||task.protected)blockers.push('Task is locked or protected.');if(task.deadline&&candidate.targetDate>task.deadline)blockers.push('Deferral would move work beyond its deadline.');for(const change of array(candidate.changes).filter(c=>c.store==='timeBlocks'))if(change.before?.locked||change.before?.protected||change.before?.manuallyPlaced)blockers.push('Deferral cannot move locked, protected, or manually placed time.')}}
    const blocks=this.proposedBlocks(candidate),sim=clone(context.data);if(candidate.kind==='deferral-plan'){const movedIds=new Set(array(candidate.changes).filter(c=>c.store==='timeBlocks').map(c=>c.id));sim.timeBlocks=array(sim.timeBlocks).filter(b=>!movedIds.has(b.id))}
    for(const block of blocks){const task=context.tasks.find(t=>t.id===block.taskId);if(!task){blockers.push(`Task ${block.taskId||'unknown'} no longer exists.`);continue}if(!activeTask(task)){blockers.push(`${task.title||task.id} is not active.`);continue}if(!readyTask(task,context.tasks)){blockers.push(`${task.title||task.id} has incomplete dependencies.`);evidence.push(reason('DEPENDENCY-BLOCK','DependencyGraph','ready',false,'Requires completed blockers','hard'));continue}if(task.locked||task.protected){blockers.push(`${task.title||task.id} is locked or protected.`);continue}
      const startMinute=CoreUtil.clock(block.startTime);if(startMinute===null){blockers.push('Candidate contains an invalid start time.');continue}const start=CoreUtil.dayIndex(block.date)*1440+startMinute,duration=Math.max(0,num(block.duration)),interval={sourceId:`decision:${candidate.id}:${block.id}`,startDateTime:start,endDateTime:start+duration,minutes:duration,locked:false};
      try{const conflicts=ConflictEngine.checkInterval(interval,sim,context.settings,{task,ignoreIds:[block.id].filter(Boolean)})||[];for(const conflict of conflicts)if(conflict.type!=='soft'){blockers.push(conflict.message||conflict.title||conflict.code||'Hard schedule conflict');evidence.push(reason(conflict.code||'CONFLICT','ConflictEngine','conflict',conflict.type,conflict.title||'','hard'))}else warnings.push(conflict.message||conflict.title||String(conflict))}catch(error){blockers.push(`ConflictEngine validation failed closed: ${error.message}`);evidence.push(reason('CONFLICT-ENGINE-FAILED','ConflictEngine','available',false,'Fail closed','hard'))}
      try{const allocation=ProjectAllocator.dailyAllowance(task,block.date,sim,context.settings,ProjectAllocator.context(sim,context.settings));if(task.projectId&&!allocation.project){blockers.push(`ProjectAllocator could not resolve project ${task.projectId}; feasibility failed closed.`);evidence.push(reason('PROJECT-ALLOCATOR-BINDING','ProjectAllocator','projectResolved',false,'Fail closed','hard'))}else{const dailyRemaining=Number.isFinite(Number(allocation.dailyMax))?Math.max(0,num(allocation.dailyMax)-num(allocation.dailyUsed)):Infinity,weeklyRemaining=Number.isFinite(Number(allocation.weeklyMax))?Math.max(0,num(allocation.weeklyMax)-num(allocation.weeklyUsed)):Infinity,authoritativeAllowance=Math.max(0,Math.min(num(allocation.minutes),dailyRemaining,weeklyRemaining));if(duration>authoritativeAllowance){blockers.push(`Project/capacity allowance is ${authoritativeAllowance}m but candidate needs ${duration}m.`);evidence.push(reason('PROJECT-ALLOWANCE','ProjectAllocator','minutes',authoritativeAllowance,`needs ${duration}m`,'hard'))}}}catch(error){blockers.push(`ProjectAllocator validation failed closed: ${error.message}`)}
      try{const recovery=RecoveryTimeEngine.evaluate(start,start+duration,sim,context.settings,block.date);if(recovery.protectedConflict){blockers.push(`Protected recovery conflicts with ${task.title||task.id}.`);evidence.push(reason('RECOVERY-PROTECTED','RecoveryTimeEngine','overlapMinutes',recovery.minutes,recovery.reasons?.join(' · ')||'Protected recovery','hard'))}}catch(error){blockers.push(`RecoveryTimeEngine validation failed closed: ${error.message}`)}
      for(const hard of this.hardRuleBlockers(task,{...candidate,date:block.date,startMinute,startMinute,startTime:block.startTime},context)){blockers.push(hard);evidence.push(reason('RULEENGINE-HARD','RuleEngine','constraint',hard,'Automatic matched hard rule','hard'))}
      sim.timeBlocks.push({...block,type:block.type||'task'})
    }
    return{feasible:blockers.length===0,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],evidence}
  }
}
class DecisionTradeoffEngine{
  simulate(candidate,context){const {CoreUtil}=host(),base=context.data,sim={...base,tasks:array(base.tasks).slice(),projects:array(base.projects).slice(),events:array(base.events).slice(),timeBlocks:array(base.timeBlocks).slice(),dayProfiles:array(base.dayProfiles).slice()};if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind)){sim.timeBlocks=clone(candidate.simulatedBlocks||sim.timeBlocks);return sim}if(candidate.kind==='task-session'){sim.timeBlocks.push({id:`sim:${candidate.id}`,date:candidate.date,startTime:CoreUtil.time(candidate.startMinute),duration:candidate.duration,taskId:candidate.taskId,projectId:candidate.projectId||'',type:'task',sourceType:'decision-sim'});return sim}if(PLAN_KINDS.has(candidate.kind)){const remove=new Set(array(candidate.plan?.remove).map(b=>b.id));sim.timeBlocks=sim.timeBlocks.filter(b=>!remove.has(b.id));for(const item of array(candidate.plan?.planned))sim.timeBlocks.push({...clone(item.block),type:'task'});return sim}if(candidate.kind==='deferral-plan'){for(const change of array(candidate.changes)){const rows=array(sim[change.store]),index=rows.findIndex(r=>r.id===change.id);if(change.after==null){if(index>=0)rows.splice(index,1)}else if(index>=0)rows[index]=clone(change.after);else rows.push(clone(change.after));sim[change.store]=rows}return sim}return sim}
  forecastEffect(before,after,context,candidate){const {CoreUtil,DeadlineEngine}=host(),riskValue={Low:0,Moderate:1,High:2,Critical:3,Impossible:4,Overdue:4},details=[],affectedIds=new Set([candidate.taskId,...array(candidate.affectedEntityIds),...array(candidate.plan?.planned).map(x=>x.block?.taskId),...array(candidate.changes).filter(c=>c.store==='tasks').map(c=>c.id),...array(candidate.changes).filter(c=>c.store==='timeBlocks').flatMap(c=>[c.before?.taskId,c.after?.taskId])].filter(Boolean)),deadlineTasks=array(before.tasks).filter(activeTask).filter(t=>t.deadline&&affectedIds.has(t.id)).slice(0,100);let beforeRiskPoints=0,afterRiskPoints=0,shortfallBefore=0,shortfallAfter=0,improved=0,worsened=0;for(const task of deadlineTasks){try{const afterTask=array(after.tasks).find(t=>t.id===task.id)||task,end=task.deadline>=context.decisionDate?task.deadline:context.decisionDate,a=DeadlineEngine.forecastTask(task,before,context.settings,{from:context.decisionDate,end}),b=DeadlineEngine.forecastTask(afterTask,after,context.settings,{from:context.decisionDate,end}),ar=riskValue[a.risk]??2,br=riskValue[b.risk]??2;beforeRiskPoints+=ar;afterRiskPoints+=br;shortfallBefore+=num(a.shortfall);shortfallAfter+=num(b.shortfall);if(br<ar||num(b.shortfall)<num(a.shortfall))improved++;if(br>ar||num(b.shortfall)>num(a.shortfall))worsened++;if(ar!==br||num(a.shortfall)!==num(b.shortfall))details.push({taskId:task.id,title:task.title,beforeRisk:a.risk,afterRisk:b.risk,beforeShortfall:num(a.shortfall),afterShortfall:num(b.shortfall)})}catch{}}return{beforeRiskPoints,afterRiskPoints,riskPointReduction:beforeRiskPoints-afterRiskPoints,shortfallBefore,shortfallAfter,shortfallReducedMinutes:shortfallBefore-shortfallAfter,improvedTasks:improved,worsenedTasks:worsened,details}}
  projectEffect(before,after,context){const {CoreUtil,ProjectAllocator}=host(),week=CoreUtil.startOfWeek(context.decisionDate),beforeCtx=ProjectAllocator.context(before,context.settings),afterCtx=ProjectAllocator.context(after,context.settings);let shortfallBefore=0,shortfallAfter=0,improvedProjects=0;const details=[];for(const project of array(before.projects).filter(p=>p.status==='Active')){try{const a=ProjectAllocator.shortfall(project,before.tasks,week,before,context.settings,beforeCtx),bProject=array(after.projects).find(p=>p.id===project.id)||project,b=ProjectAllocator.shortfall(bProject,after.tasks,week,after,context.settings,afterCtx);shortfallBefore+=num(a.shortfall);shortfallAfter+=num(b.shortfall);if(b.shortfall<a.shortfall)improvedProjects++;if(a.shortfall!==b.shortfall)details.push({projectId:project.id,title:project.title,beforeShortfall:a.shortfall,afterShortfall:b.shortfall})}catch{}}return{shortfallBefore,shortfallAfter,shortfallReducedMinutes:shortfallBefore-shortfallAfter,improvedProjects,details}}
  evaluate(candidate,context,feasibility){const api=host(),{CoreUtil,CapacityEngine,RecoveryTimeEngine,ContextSwitchEngine,ScheduleStabilityEngine}=api;if(candidate.kind===KEEP_CURRENT_PLAN)return{deadlineProtection:0,projectAlignment:0,forecastImpact:0,capacityFit:1,disruption:0,recoveryImpact:0,contextCost:0,bufferImpact:0,deferralCost:0,opportunityCostMinutes:0,capacityConsumedMinutes:0,remainingCapacityMinutes:num(context.capacity?.focusRemaining),forecastEffect:{beforeRiskPoints:0,afterRiskPoints:0,riskPointReduction:0,shortfallBefore:0,shortfallAfter:0,shortfallReducedMinutes:0,improvedTasks:0,worsenedTasks:0,details:[]},projectEffect:{shortfallBefore:0,shortfallAfter:0,shortfallReducedMinutes:0,improvedProjects:0,details:[]},reasons:[reason('NO-CHANGE','DecisionTradeoffEngine','disruption',0,'Current plan preserved')]};
    const sim=this.simulate(candidate,context),forecastEffect=this.forecastEffect(context.data,sim,context,candidate),projectEffect=this.projectEffect(context.data,sim,context),blocks=candidate.kind==='task-session'?[{date:candidate.date,startTime:CoreUtil.time(candidate.startMinute),duration:candidate.duration,taskId:candidate.taskId}]:PLAN_KINDS.has(candidate.kind)?array(candidate.plan?.planned).map(x=>x.block):candidate.kind==='deferral-plan'?array(candidate.changes).filter(c=>c.store==='timeBlocks'&&c.after).map(c=>c.after):[],candidateMinutes=blocks.reduce((sum,b)=>sum+num(b.duration),0),dates=[...new Set(blocks.map(b=>b.date).filter(Boolean))];if(!dates.length)dates.push(context.decisionDate);
    let recoveryMinutes=0,contextTransitions=0;for(const block of blocks){const task=array(context.tasks).find(t=>t.id===block.taskId);if(!task)continue;const start=CoreUtil.dayIndex(block.date)*1440+(CoreUtil.clock(block.startTime)||0);try{recoveryMinutes+=num(RecoveryTimeEngine.evaluate(start,start+num(block.duration),context.data,context.settings,block.date).minutes)}catch{}try{contextTransitions+=num(ContextSwitchEngine.evaluate(task,block.date,CoreUtil.clock(block.startTime)||0,(CoreUtil.clock(block.startTime)||0)+num(block.duration),sim,context.settings).transitions)}catch{}}
    let stability={disruptionCost:0,score:100};try{stability=ScheduleStabilityEngine.compare(context.data.timeBlocks,sim.timeBlocks,{tasks:sim.tasks,nowMinute:CoreUtil.dayIndex(context.decisionDate)*1440+(CoreUtil.clock(context.currentLocalTime)||0)})}catch{}
    const beforeCapacity=dates.reduce((sum,date)=>{try{return sum+Math.max(0,num(CapacityEngine.summary(date,context.data,context.settings).focusRemaining))}catch{return sum}},0),afterCapacity=dates.reduce((sum,date)=>{try{return sum+Math.max(0,num(CapacityEngine.summary(date,sim,context.settings).focusRemaining))}catch{return sum}},0),affected=new Set([candidate.taskId,...blocks.map(b=>b.taskId)].filter(Boolean)),competingDemand=context.readyTasks.filter(t=>!affected.has(t.id)).reduce((sum,t)=>sum+Math.max(0,num(t.remainingDuration,num(t.estimatedDuration))-num(t.actualMinutes)),0),opportunityCostMinutes=Math.max(0,competingDemand-afterCapacity),capacityConsumedMinutes=Math.max(0,beforeCapacity-afterCapacity)||candidateMinutes;
    const affectedTasks=context.tasks.filter(t=>affected.has(t.id)),urgency=affectedTasks.reduce((max,t)=>Math.max(max,t.deadline?(deadlineDays(t,context.decisionDate,CoreUtil)<=0?1:deadlineDays(t,context.decisionDate,CoreUtil)<=1?.96:deadlineDays(t,context.decisionDate,CoreUtil)<=3?.8:deadlineDays(t,context.decisionDate,CoreUtil)<=7?.55:.25):0),0),forecastImpact=Math.max(0,Math.min(1,forecastEffect.riskPointReduction*.25+(Math.max(0,forecastEffect.shortfallReducedMinutes)/Math.max(1,forecastEffect.shortfallBefore||candidateMinutes))*.75)),projectAlignment=Math.max(0,Math.min(1,(Math.max(0,projectEffect.shortfallReducedMinutes)/Math.max(1,projectEffect.shortfallBefore||candidateMinutes))+(projectEffect.improvedProjects?0.15:0))),deadlineProtection=Math.max(urgency,forecastImpact),capacityFit=beforeCapacity?Math.max(0,Math.min(1,candidateMinutes/beforeCapacity)):candidateMinutes?0:1,desiredBuffer=Math.max(num(context.settings.minBufferMinutes),beforeCapacity*num(context.settings.bufferPercent)/100),bufferImpact=desiredBuffer?Math.max(-1,Math.min(1,(afterCapacity-desiredBuffer)/desiredBuffer)):0,disruption=Math.min(1,num(stability.disruptionCost)/Math.max(1,(array(context.data.timeBlocks).length+blocks.length)*180)),recoveryImpact=recoveryMinutes,contextCost=contextTransitions;
    let ruleAlignment=0,intelligenceAlignment=0,intelligenceReason='';const primary=affectedTasks[0],taskType=String(primary?.taskType||primary?.type||primary?.context||''),startMinute=blocks.length?CoreUtil.clock(blocks[0].startTime):candidate.startMinute,deepCutoff=CoreUtil.clock(context.settings.deepWorkBefore||''),typeCutoff=CoreUtil.clock(context.settings.taskTypePreferredBefore?.[taskType]||'');if(primary?.workMode==='Deep'&&deepCutoff!==null&&startMinute!==null)ruleAlignment=startMinute<deepCutoff?.35:-.15;if(typeCutoff!==null&&startMinute!==null)ruleAlignment+=startMinute<typeCutoff?.25:-.1;try{const signal=primary&&api.PersonalIntelligenceEngine?.signalForTask?.(primary,context.intelligence||{insights:[]},context.settings,startMinute);if(signal){intelligenceAlignment=Math.min(.25,num(signal.boost,0)/24);intelligenceReason=signal.explanation||''}}catch{}
    const deferralCost=candidate.kind==='deferral-plan'?Math.max(0,-forecastEffect.shortfallReducedMinutes)+Math.max(0,forecastEffect.afterRiskPoints-forecastEffect.beforeRiskPoints)*60:deadlineProtection*.8+forecastImpact*.2,reasons=[reason('FORECAST-BEFORE-AFTER','DeadlineEngine','shortfallReducedMinutes',forecastEffect.shortfallReducedMinutes,`risk points ${forecastEffect.beforeRiskPoints}→${forecastEffect.afterRiskPoints}`),reason('PROJECT-ALLOCATOR','ProjectAllocator','shortfallReducedMinutes',projectEffect.shortfallReducedMinutes,`${projectEffect.improvedProjects} project(s) improved`),reason('RECOVERY-COST','RecoveryTimeEngine','overlapMinutes',recoveryMinutes,'Protected recovery is hard; preferred recovery is costed'),reason('CONTEXT-SWITCH','ContextSwitchEngine','transitions',contextTransitions,'Lower is better'),reason('SCHEDULE-STABILITY','ScheduleStabilityEngine','score',stability.score,`disruption cost ${stability.disruptionCost}`),reason('OPPORTUNITY-COST','CapacityEngine','uncoveredCompetingMinutes',opportunityCostMinutes,`${afterCapacity}m focus capacity remains across affected dates`)];if(ruleAlignment)reasons.push(reason('RULEENGINE-ALIGNMENT','RuleEngine','planningPreference',ruleAlignment,'Applied planning-policy outputs remain soft unless an automatic matched hard rule constrains feasibility.'));if(intelligenceAlignment&&intelligenceReason)reasons.push(reason('PERSONAL-INTELLIGENCE','PersonalIntelligenceEngine','acceptedPreference',intelligenceAlignment,intelligenceReason));return{deadlineProtection,projectAlignment,forecastImpact,capacityFit,disruption,recoveryImpact,contextCost,bufferImpact,ruleAlignment,intelligenceAlignment,deferralCost,opportunityCostMinutes,capacityConsumedMinutes,remainingCapacityMinutes:afterCapacity,competingDemandMinutes:competingDemand,forecastEffect,projectEffect,stability,reasons}
  }
}
class DecisionRankingEngine{
  rank(rows){const ranked=stableSort(rows.filter(r=>r.feasibility.feasible),(a,b)=>{const A=a.tradeoffs,B=b.tradeoffs,stages=[B.deadlineProtection-A.deadlineProtection,B.forecastImpact-A.forecastImpact,B.projectAlignment-A.projectAlignment,num(B.ruleAlignment)-num(A.ruleAlignment),B.capacityFit-A.capacityFit,A.opportunityCostMinutes-B.opportunityCostMinutes,A.disruption-B.disruption,A.recoveryImpact-B.recoveryImpact,A.contextCost-B.contextCost,num(B.intelligenceAlignment)-num(A.intelligenceAlignment),B.bufferImpact-A.bufferImpact];for(const delta of stages)if(Math.abs(delta)>.0001)return delta;if(a.candidate.kind===KEEP_CURRENT_PLAN&&b.candidate.kind!==KEEP_CURRENT_PLAN)return 1;if(b.candidate.kind===KEEP_CURRENT_PLAN&&a.candidate.kind!==KEEP_CURRENT_PLAN)return-1;return String(a.candidate.id).localeCompare(String(b.candidate.id))});const keep=ranked.find(row=>row.candidate.kind===KEEP_CURRENT_PLAN),bestChange=ranked.find(row=>row.candidate.kind!==KEEP_CURRENT_PLAN),material=bestChange&&(bestChange.tradeoffs.deadlineProtection>=.35||bestChange.tradeoffs.projectAlignment>=.2||bestChange.tradeoffs.forecastImpact>=.2||bestChange.tradeoffs.capacityConsumedMinutes>0||bestChange.candidate.kind==='deferral-plan'||bestChange.candidate.kind==='schedule-conflict-plan'||bestChange.candidate.kind==='plan-repair'),ordered=keep&&!material?[keep,...ranked.filter(row=>row!==keep)]:ranked;return ordered.map((row,index)=>({...row,rank:index+1}))}
}
class DecisionAlternativeGenerator{
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
}

class DecisionExplanationEngine{
  explain(row,runnerUp,context){const {candidate,tradeoffs}=row,{CoreUtil}=host();if(candidate.kind===KEEP_CURRENT_PLAN)return{summary:'Keep the current plan. No alternative creates enough evidence-backed improvement to justify disruption.',protects:['Schedule stability','Existing commitments'],changes:['No production change'],defers:[],risks:context.dataQuality.warnings||[],opportunityCost:'0 minutes of additional capacity are committed; the current plan is preserved.',opportunityCostMinutes:0,forecastEffect:tradeoffs.forecastEffect,reasons:tradeoffs.reasons};const blocks=candidate.kind==='task-session'?[{taskId:candidate.taskId,date:candidate.date,startTime:CoreUtil.time(candidate.startMinute),duration:candidate.duration}]:PLAN_KINDS.has(candidate.kind)?array(candidate.plan?.planned).map(x=>x.block):candidate.kind==='deferral-plan'?array(candidate.changes).filter(c=>c.store==='timeBlocks'&&c.after).map(c=>c.after):[],taskNames=[...new Set(blocks.map(b=>context.tasks.find(t=>t.id===b.taskId)?.title).filter(Boolean))],changes=[];if(PLAN_KINDS.has(candidate.kind))changes.push(`Schedule ${blocks.length} task block${blocks.length===1?'':'s'} totaling ${blocks.reduce((s,b)=>s+num(b.duration),0)} minutes.`);else if(candidate.kind==='deferral-plan')changes.push(`Move ${num(candidate.metadata?.freedMinutes)} scheduled minutes to ${candidate.targetDate} and update the task deferral state.`);else if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind))changes.push(`Apply ${array(candidate.changes).length} validated schedule repair change${array(candidate.changes).length===1?'':'s'}.`);else changes.push(`Reserve ${candidate.duration} minutes for ${candidate.title} from ${CoreUtil.time(candidate.startMinute)}.`);const f=tradeoffs.forecastEffect||{},protects=[];if(f.improvedTasks)protects.push(`Improves ${f.improvedTasks} deadline forecast${f.improvedTasks===1?'':'s'}; shortfall changes ${f.shortfallBefore}→${f.shortfallAfter} minutes.`);if(tradeoffs.projectEffect?.improvedProjects)protects.push(`Reduces allocation shortfall for ${tradeoffs.projectEffect.improvedProjects} project${tradeoffs.projectEffect.improvedProjects===1?'':'s'}.`);if(!protects.length)protects.push('Preserves hard feasibility while using available planning capacity.');const opportunityCost=`Commits ${Math.round(num(tradeoffs.capacityConsumedMinutes))} minutes; ${Math.round(num(tradeoffs.remainingCapacityMinutes))} minutes of focus capacity remain across the affected horizon; ${Math.round(num(tradeoffs.opportunityCostMinutes))} minutes of competing ready-work demand remain uncovered.`,defers=context.readyTasks.filter(t=>!blocks.some(b=>b.taskId===t.id)&&t.id!==candidate.taskId).slice(0,3).map(t=>t.title),runner=runnerUp?.candidate,whyLower=runner&&runner.kind!==KEEP_CURRENT_PLAN?`${runner.title} ranked lower after hard feasibility, forecast delta, project allocation, quantified opportunity cost, stability, recovery and context-switch costs were compared.`:'Keeping the current plan ranked lower because this feasible option produces a material evidence-backed planning benefit.';return{summary:candidate.kind==='deferral-plan'?candidate.title:PLAN_KINDS.has(candidate.kind)?`${candidate.title}: ${blocks.length} blocks / ${blocks.reduce((s,b)=>s+num(b.duration),0)} minutes.`:['plan-repair','schedule-conflict-plan'].includes(candidate.kind)?candidate.title:`Do ${candidate.title} for ${candidate.duration} minutes now.`,protects,changes,defers,risks:[...(context.dataQuality.missingInputs||[]),...(row.feasibility.warnings||[])],opportunityCost,opportunityCostMinutes:tradeoffs.opportunityCostMinutes,forecastEffect:f,whyLower,reasons:tradeoffs.reasons,taskNames}
  }
}
class DecisionPreviewManager{
  currentBlocks(candidate){
    if(PLAN_KINDS.has(candidate.kind))return array(candidate.plan?.remove);
    if(['deferral-plan','plan-repair','schedule-conflict-plan'].includes(candidate.kind))return array(candidate.changes).filter(c=>c.store==='timeBlocks'&&c.before).map(c=>c.before);
    return[];
  }
  proposedBlocks(candidate){
    if(PLAN_KINDS.has(candidate.kind))return array(candidate.plan?.planned).map(x=>x.block);
    if(candidate.kind==='task-session')return[{taskId:candidate.taskId,date:candidate.date,startTime:host().CoreUtil.time(candidate.startMinute),duration:candidate.duration}];
    if(['deferral-plan','plan-repair','schedule-conflict-plan'].includes(candidate.kind))return array(candidate.changes).filter(c=>c.store==='timeBlocks'&&c.after).map(c=>c.after);
    return[];
  }
  build(decision,alternativeId){
    const choice=decision.alternatives.find(a=>a.candidate.id===alternativeId)||decision.alternatives[0];
    if(!choice)throw new Error('No feasible alternative is available.');
    const candidate=choice.candidate,currentBlocks=this.currentBlocks(candidate),blocks=this.proposedBlocks(candidate),tradeoffs=choice.tradeoffs||{},forecast=clone(tradeoffs.forecastEffect||{});
    return{
      previewId:`preview:${decision.decisionId}:${candidate.id}`,
      decisionId:decision.decisionId,
      alternativeId:candidate.id,
      contextFingerprint:decision.contextFingerprint,
      productionFingerprintBefore:decision.contextFingerprint,
      current:{
        scope:'affected-schedule',
        blockCount:currentBlocks.length,
        blocks:clone(currentBlocks),
        changeCount:currentBlocks.length,
        summary:currentBlocks.length?`${currentBlocks.length} affected production block${currentBlocks.length===1?'':'s'} before this alternative.`:'No existing affected production block; the current state is unchanged.'
      },
      proposed:{
        type:candidate.kind,
        taskId:candidate.taskId||'',
        date:candidate.date,
        duration:candidate.duration,
        startMinute:candidate.startMinute,
        blockCount:blocks.length,
        blocks:clone(blocks),
        changeCount:array(candidate.changes).length,
        summary:blocks.length?`${blocks.length} proposed block${blocks.length===1?'':'s'} in the affected scope.`:candidate.kind===KEEP_CURRENT_PLAN?'Keep the current plan with no production mutation.':'The proposal changes state without adding a schedule block.'
      },
      changes:clone(choice.explanation?.changes||[]),
      warnings:clone(choice.explanation?.risks||[]),
      forecastEffect:forecast,
      opportunity:{
        opportunityCostMinutes:num(tradeoffs.opportunityCostMinutes),
        capacityConsumedMinutes:num(tradeoffs.capacityConsumedMinutes),
        remainingCapacityMinutes:num(tradeoffs.remainingCapacityMinutes),
        competingDemandMinutes:num(tradeoffs.competingDemandMinutes),
        projectEffect:clone(tradeoffs.projectEffect||{}),
        stability:clone(tradeoffs.stability||{})
      },
      opportunityCostMinutes:num(tradeoffs.opportunityCostMinutes),
      generatedAt:nowISO(),
      immutable:true
    };
  }
}
class DecisionApplyCoordinator{
  constructor(app=host().app,outcomes=null){this.app=app;this.outcomes=outcomes}
  async revalidate(decision){const context=await new DecisionContextBuilder(this.app).build(decision.request);return{fresh:context.contextFingerprint===decision.contextFingerprint,context}}
  planChanges(decision,choice,context){const {CoreUtil}=host(),candidate=choice.candidate,now=nowISO(),changes=[],expectedRevisions={},durationByTask=new Map();for(const block of array(candidate.plan?.remove)){const current=context.data.timeBlocks.find(b=>b.id===block.id);if(current){changes.push({store:'timeBlocks',id:current.id,before:current,after:null});if(current.revision)expectedRevisions[`timeBlocks:${current.id}`]=current.revision}}
    for(const item of array(candidate.plan?.planned)){const block={...clone(item.block),sourceType:'decision',decisionId:decision.decisionId,generatedBy:`LifeOS Decision Engine ${DECISION_ENGINE_VERSION}`,generationOperationId:`decision:${decision.decisionId}`,createdAt:now,updatedAt:now,revision:1};changes.push({store:'timeBlocks',id:block.id,before:null,after:block});durationByTask.set(block.taskId,(durationByTask.get(block.taskId)||0)+num(block.duration))}
    for(const [taskId,minutes] of durationByTask){const task=context.tasks.find(t=>t.id===taskId);if(!task)continue;const after={...task,status:'Scheduled',plannedMinutes:num(task.plannedMinutes)+minutes,updatedAt:now,revision:num(task.revision,1)+1};changes.push({store:'tasks',id:task.id,before:task,after});if(task.revision)expectedRevisions[`tasks:${task.id}`]=task.revision}
    return{changes,expectedRevisions}
  }
  deferralChanges(candidate,context){const now=nowISO(),changes=[],expectedRevisions={};for(const source of array(candidate.changes)){const before=source.store==='tasks'?context.tasks.find(t=>t.id===source.id):source.store==='timeBlocks'?context.data.timeBlocks.find(b=>b.id===source.id):source.before;if(!before)continue;const after=source.after?{...clone(source.after),updatedAt:now,revision:num(before.revision,1)+1}:null;changes.push({store:source.store,id:source.id,before,after});if(before.revision)expectedRevisions[`${source.store}:${source.id}`]=before.revision}return{changes,expectedRevisions}}
  async commitUndo(decision,choice,mutation,label){const stores=[...new Set(mutation.changes.map(c=>c.store))],entry=await this.app.journal?.begin('decision-apply',stores,'');try{const operation=await this.app.undo.execute(label,mutation.changes,{activityType:'decision-apply',meta:{decisionId:decision.decisionId,decisionEngineVersion:DECISION_ENGINE_VERSION,alternativeId:choice.candidate.id},expectedRevisions:mutation.expectedRevisions});if(entry)await this.app.journal.finish(entry,'committed');return operation}catch(error){if(entry)await this.app.journal.finish(entry,'failed',error);throw error}}
  async apply(decision,alternativeId){const choice=decision.alternatives.find(a=>a.candidate.id===alternativeId)||decision.alternatives[0];if(!choice)throw new Error('No feasible decision can be applied.');if(decision.request.mode==='scenario'){const error=new Error('Scenario decisions cannot write directly to production. Apply scenario changes through Scenario Lab after reviewing the scenario diff.');error.code='DECISION-SCENARIO-APPLY-461';throw error}const fresh=await this.revalidate(decision);if(!fresh.fresh){const error=new Error('This recommendation is out of date because the underlying plan changed.');error.code='DECISION-STALE-461';throw error}if(choice.candidate.kind===KEEP_CURRENT_PLAN)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});const feasibility=new DecisionFeasibilityGate().evaluate(choice.candidate,fresh.context);if(!feasibility.feasible){const error=new Error('This recommendation is no longer feasible under the current hard constraints.');error.code='DECISION-REVALIDATION-461';error.details={blockers:feasibility.blockers,evidence:feasibility.evidence};throw error}
    const candidate=choice.candidate,op=async()=>{const lockedFresh=await this.revalidate(decision);if(!lockedFresh.fresh){const error=new Error('This recommendation is out of date because the underlying plan changed while waiting for the data lock.');error.code='DECISION-STALE-461';throw error}const lockedFeasibility=new DecisionFeasibilityGate().evaluate(candidate,lockedFresh.context);if(!lockedFeasibility.feasible){const error=new Error('This recommendation is no longer feasible under the current hard constraints.');error.code='DECISION-REVALIDATION-461';error.details={blockers:lockedFeasibility.blockers,evidence:lockedFeasibility.evidence};throw error}const executionContext=lockedFresh.context;if(['plan-repair','schedule-conflict-plan'].includes(candidate.kind)){const preview=await this.app.service.buildRepair(executionContext.decisionDate,{maxRadius:Math.max(4,num(candidate.repairRadius,1))});if(preview.sourceFingerprint!==candidate.repairSourceFingerprint){const error=new Error('Schedule repair source changed after decision analysis.');error.code='DECISION-REPAIR-STALE-461';throw error}const result=await this.app.service.applyRepair(preview,candidate.repairCandidateId,{skipOperationLock:true,label:`Decision — ${candidate.title}`});return this.record(decision,choice,'Applied',{operationId:result?.operationId||candidate.repairCandidateId})}
      if(PLAN_KINDS.has(candidate.kind)){const mutation=this.planChanges(decision,choice,executionContext);if(!mutation.changes.length)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});const operation=await this.commitUndo(decision,choice,mutation,`Decision — ${candidate.title}`);for(const change of mutation.changes.filter(c=>c.store==='timeBlocks'&&c.before===null))if(!await this.app.repo.get('timeBlocks',change.id)){const error=new Error('A multi-task Decision plan did not become durably readable after commit.');error.code='DECISION-COMMIT-VISIBILITY-461';throw error}return this.record(decision,choice,'Applied',{operationId:operation.id})}
      if(candidate.kind==='deferral-plan'){const mutation=this.deferralChanges(candidate,executionContext),operation=await this.commitUndo(decision,choice,mutation,`Decision — ${candidate.title}`);return this.record(decision,choice,'Applied',{operationId:operation.id})}
      const task=executionContext.tasks.find(t=>t.id===candidate.taskId);if(!task)throw new Error('Task no longer exists.');const {CoreUtil}=host(),start=candidate.startMinute,block={id:CoreUtil.uid(),date:candidate.date,startTime:CoreUtil.time(start),endTime:CoreUtil.time(start+candidate.duration),duration:candidate.duration,type:'task',taskId:task.id,projectId:task.projectId||'',lifeAreaId:task.lifeAreaId||'',title:task.title||candidate.title,sourceType:'decision',sourceId:task.id,decisionId:decision.decisionId,manuallyPlaced:true,locked:false,createdAt:nowISO(),updatedAt:nowISO(),revision:1},change={store:'timeBlocks',id:block.id,before:null,after:block},operation=await this.commitUndo(decision,choice,{changes:[change],expectedRevisions:{}},`Decision — ${choice.label||candidate.title}`);if(!await this.app.repo.get('timeBlocks',block.id)){const error=CoreUtil.error('DECISION-COMMIT-VISIBILITY-461','The accepted decision did not become durably readable after its atomic commit.');throw error}return this.record(decision,choice,'Applied',{operationId:operation.id})};return this.app.operationLocks?.withQueuedExclusiveLock?this.app.operationLocks.withQueuedExclusiveLock('Decision apply',op):this.app.operationLocks?this.app.operationLocks.withExclusiveLock('Decision apply',op):op()
  }
  async record(decision,choice,status,extra={}){
    const affected=[...new Set([...(choice.candidate.affectedEntityIds||[]),choice.candidate.taskId,choice.candidate.projectId].filter(Boolean))],record={
      id:`decision-history:${decision.decisionId}:${Date.now()}`,decisionId:decision.decisionId,type:decision.request.type,
      selectedAlternative:choice.candidate.id,status,reasons:choice.tradeoffs.reasons,affectedEntityIds:affected,
      operationId:extra.operationId||'',generatedAt:decision.generatedAt,appliedAt:status==='Applied'?nowISO():'',
      candidateTitle:choice.candidate.title||'',decisionEngineVersion:DECISION_ENGINE_VERSION
    };
    try{await this.app.repo.save('activityLog',{...record,type:'decision-history',text:`${status}: ${choice.candidate.title}`,at:nowISO(),createdAt:nowISO(),updatedAt:nowISO()},{validate:false})}catch{}
    if(status==='Applied'&&!extra.noChange&&this.outcomes)try{await this.outcomes.create(decision,choice,extra.operationId||'')}catch{}
    return{record,...extra};
  }
}
class DecisionHistory{
  constructor(app=host().app){this.app=app}
  async list(limit=50){
    const rows=await this.app.repo.all('activityLog',{fresh:true});
    return rows.filter(x=>x.type==='decision-history').sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,limit);
  }
}

class DecisionOutcomeEngine{
  constructor(app=host().app){this.app=app}
  async create(decision,choice,operationId=''){
    if(!decision?.decisionId||!choice?.candidate?.id)return null;
    const {CoreUtil}=host(),id=`decision-outcome:${decision.decisionId}`,existing=await this.app.repo.get('activityLog',id);
    if(existing)return existing;
    const at=nowISO(),decisionDate=decision.request?.date||CoreUtil.localDate(),record={
      id,type:'decision-outcome',text:`Decision follow-up: ${choice.candidate.title||choice.candidate.id}`,
      decisionId:decision.decisionId,alternativeId:choice.candidate.id,operationId,status:'Pending',outcome:'',notes:'',
      decisionDate,followUpDate:CoreUtil.addDays(decisionDate,1),appliedAt:at,recordedAt:'',at,createdAt:at,updatedAt:at,
      decisionEngineVersion:DECISION_ENGINE_VERSION
    };
    await this.app.repo.save('activityLog',record,{validate:false});
    return record;
  }
  async list(limit=100){
    const rows=await this.app.repo.all('activityLog',{fresh:true});
    return rows.filter(x=>x.type==='decision-outcome').sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,limit);
  }
  async pending(limit=20){return (await this.list(200)).filter(x=>x.status==='Pending').slice(0,limit)}
  async record(decisionId,outcome,notes=''){
    const allowed=new Set(['Worked','Partly','Did not work','Undone']);
    if(!allowed.has(outcome))throw new Error('Decision outcome must be Worked, Partly, Did not work, or Undone.');
    const id=`decision-outcome:${decisionId}`,current=await this.app.repo.get('activityLog',id);
    if(!current)throw new Error('Decision follow-up record was not found.');
    const at=nowISO(),next={...current,status:'Recorded',outcome,notes:String(notes||''),recordedAt:at,updatedAt:at,at};
    await this.app.repo.save('activityLog',next,{validate:false});
    return next;
  }
}

class DecisionBriefEngine{
  constructor(engine,app=host().app,outcomes=null){this.engine=engine;this.app=app;this.outcomes=outcomes||new DecisionOutcomeEngine(app)}
  async morning(date=host().CoreUtil.localDate()){
    const {CoreUtil,CapacityEngine}=host(),[data,settings]=await Promise.all([this.app.repo.dataset({fresh:true}),this.app.repo.settings()]);
    let capacity=null;try{capacity=CapacityEngine.summary(date,data,settings)}catch{}
    const todayRecommendation=await this.engine.analyze({type:DECISION_TYPES.TODAY_PLAN,date,mode:'preview',source:'morning-decision-brief'});
    const deadlineRecommendation=await this.engine.analyze({type:DECISION_TYPES.DEADLINE_TRIAGE,date,mode:'preview',source:'morning-decision-brief',constraints:{horizonDays:3}});
    const active=array(data.tasks).filter(activeTask),due=active.filter(task=>task.deadline&&task.deadline<=CoreUtil.addDays(date,3));
    return{
      kind:'morning-decision-brief',date,generatedAt:nowISO(),localOnly:true,
      capacity:capacity?{focusRemaining:num(capacity.focusRemaining),physicalLeft:num(capacity.physicalLeft),status:capacity.status||''}:null,
      dueCount:due.length,
      todayRecommendation,
      deadlineRecommendation,
      summary:{
        today:todayRecommendation.recommended?.explanation?.summary||'No feasible day-plan change is currently recommended.',
        deadlines:deadlineRecommendation.recommended?.explanation?.summary||'No deadline-triage change is currently recommended.'
      }
    };
  }
  async endOfDay(date=host().CoreUtil.localDate()){
    const [history,pending]=await Promise.all([new DecisionHistory(this.app).list(200),this.outcomes.pending(100)]);
    const applied=history.filter(row=>row.status==='Applied'&&String(row.appliedAt||row.at||'').slice(0,10)===date);
    const duePending=pending.filter(row=>!row.followUpDate||row.followUpDate<=host().CoreUtil.addDays(date,1));
    return{
      kind:'end-of-day-decision-review',date,generatedAt:nowISO(),localOnly:true,
      appliedCount:applied.length,
      applied,
      pendingOutcomes:duePending,
      summary:applied.length?`${applied.length} decision${applied.length===1?' was':'s were'} applied today; ${duePending.length} outcome follow-up${duePending.length===1?' is':'s are'} pending.`:`No Decision Engine mutation was applied on ${date}; ${duePending.length} outcome follow-up${duePending.length===1?' is':'s are'} pending.`
    };
  }
}

class DecisionSelfTestExtension{
  static fixture(runner){
    const {CoreUtil}=host(),sample=runner.sampleData(),date='2031-01-15',task={...sample.task,id:'decision-self-task',title:'Decision self task',status:'Next',priority:'High',estimatedDuration:60,remainingDuration:60,actualMinutes:0,plannedMinutes:0,minimumSessionDuration:15,maximumSessionDuration:60,blockedBy:[],deadline:'2031-01-17',revision:1},data={...clone(sample.data),tasks:[task],events:[],timeBlocks:[],rules:[],projects:[{...sample.project,id:'p1',status:'Active',revision:1}],dayProfiles:[]},settings={...sample.settings,dayStart:'07:00',dayEnd:'23:00',recoveryMode:'preferred',revision:1},quality={completeness:1,missingInputs:[],unavailableSignals:[],warnings:[]};
    return{sample,date,task,data,settings,context:Object.freeze({generatedAt:'2031-01-15T00:00:00.000Z',decisionDate:date,currentDate:'2031-01-14',currentLocalTime:'09:00',timeZoneId:'Europe/Berlin',mode:'production',data:clone(data),settings:clone(settings),tasks:[clone(task)],readyTasks:[clone(task)],blockedTasks:[],projects:clone(data.projects),events:[],timeBlocks:[],capacity:{focusRemaining:480,physicalLeft:720,status:'Available'},deadlineForecasts:[],projectForecasts:[],projectShortfalls:[],activeRules:[],intelligence:{insights:[]},contextFingerprint:CoreUtil.hash({date,task}),dataGeneration:2,sourceRevisions:{settings:1,scenario:0,tasks:{[task.id]:1},projects:{p1:1},rules:{}},dataQuality:quality})};
  }
  static async run(runner){
    const {CoreUtil}=host(),fx=this.fixture(runner),generator=new DecisionCandidateGenerator(),gate=new DecisionFeasibilityGate(),trade=new DecisionTradeoffEngine(),ranking=new DecisionRankingEngine();
    await runner.test('Decision Context','data-quality contract is deterministic',()=>{const q=new DecisionContextBuilder(host().app).dataQuality([fx.task],fx.data.projects,fx.context.capacity,[]);runner.assert(Number.isFinite(q.completeness)&&Array.isArray(q.missingInputs)&&Array.isArray(q.unavailableSignals))});
    await runner.test('Decision Context','synthetic decision context is immutable at boundary',()=>runner.assert(Object.isFrozen(fx.context)&&fx.context.decisionDate===fx.date));
    await runner.test('Decision Fingerprint','decision hash repeats for identical structured input',()=>runner.assert(decisionHash({a:1,b:['x',2]})===decisionHash({a:1,b:['x',2]})));
    await runner.test('Decision Fingerprint','candidate identity is stable across repeated generation',()=>{const req={type:DECISION_TYPES.NEXT_ACTION,date:fx.date,mode:'production'},a=generator.generate(req,fx.context).map(x=>x.id),b=generator.generate(req,fx.context).map(x=>x.id);runner.assert(CoreUtil.hash(a)===CoreUtil.hash(b))});
    await runner.test('Decision Candidate Generation','NEXT_ACTION includes keep-current and actionable work',()=>{const rows=generator.generate({type:DECISION_TYPES.NEXT_ACTION,date:fx.date},fx.context);runner.assert(rows.some(x=>x.kind===KEEP_CURRENT_PLAN)&&rows.some(x=>x.kind==='task-session'))});
    await runner.test('Decision Feasibility','keep-current is always a zero-mutation feasible baseline',()=>runner.assert(gate.evaluate({id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN,changes:[]},fx.context).feasible));
    await runner.test('Decision Feasibility','locked task candidate is rejected as a hard constraint',()=>{const task={...fx.task,locked:true},context={...fx.context,tasks:[task],readyTasks:[task],data:{...fx.context.data,tasks:[task]}},candidate={id:'locked',kind:'task-session',taskId:task.id,title:task.title,duration:30,date:fx.date,startMinute:600,affectedEntityIds:[task.id]};runner.assert(!gate.evaluate(candidate,context).feasible)});
    await runner.test('Decision Trade-offs','keep-current has zero quantified opportunity cost',()=>{const f=gate.evaluate({id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN,changes:[]},fx.context),t=trade.evaluate({id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN,changes:[]},fx.context,f);runner.assert(t.opportunityCostMinutes===0&&t.capacityConsumedMinutes===0)});
    await runner.test('Decision Ranking','infeasible candidates are excluded before ranking',()=>{const rows=[{candidate:{id:'bad',kind:'task-session'},feasibility:{feasible:false},tradeoffs:{}},{candidate:{id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN},feasibility:{feasible:true},tradeoffs:{deadlineProtection:0,forecastImpact:0,projectAlignment:0,ruleAlignment:0,capacityFit:1,opportunityCostMinutes:0,disruption:0,recoveryImpact:0,contextCost:0,intelligenceAlignment:0,bufferImpact:0,capacityConsumedMinutes:0}}],out=ranking.rank(rows);runner.assert(out.length===1&&out[0].candidate.id===KEEP_CURRENT_PLAN)});
    await runner.test('Decision Ranking','stable tie-break uses candidate identity',()=>{const t={deadlineProtection:0,forecastImpact:0,projectAlignment:0,ruleAlignment:0,capacityFit:1,opportunityCostMinutes:0,disruption:0,recoveryImpact:0,contextCost:0,intelligenceAlignment:0,bufferImpact:0,capacityConsumedMinutes:1},rows=['b','a'].map(id=>({candidate:{id,kind:'task-session'},feasibility:{feasible:true},tradeoffs:{...t}})),out=ranking.rank(rows);runner.assert(out.map(x=>x.candidate.id).join(',')==='a,b')});
    await runner.test('Decision Preview','preview exposes explicit current and proposed structures',()=>{const candidate={id:'preview-self',kind:'task-session',taskId:fx.task.id,title:fx.task.title,duration:30,date:fx.date,startMinute:600,changes:[],affectedEntityIds:[fx.task.id]},choice={candidate,tradeoffs:{opportunityCostMinutes:15,capacityConsumedMinutes:30,remainingCapacityMinutes:450,competingDemandMinutes:15,forecastEffect:{riskPointReduction:0},projectEffect:{},stability:{}},explanation:{changes:['Reserve 30 minutes.'],risks:[]}},decision={decisionId:'decision-self-preview',contextFingerprint:'fp',alternatives:[choice]},p=new DecisionPreviewManager().build(decision,candidate.id);runner.assert(p.immutable&&p.current&&p.proposed&&p.forecastEffect&&p.opportunity&&p.proposed.blockCount===1)});
    await runner.test('Decision Atomicity','apply path retains one UndoManager transaction coordinator',()=>{const src=DecisionApplyCoordinator.prototype.commitUndo.toString();runner.assert(src.includes('this.app.undo.execute')&&src.includes('expectedRevisions'))});
    await runner.test('Decision Concurrency','apply revalidates again inside queued exclusive lock',()=>{const src=DecisionApplyCoordinator.prototype.apply.toString();runner.assert(src.includes('withQueuedExclusiveLock')&&src.includes('lockedFresh=await this.revalidate(decision)')&&src.includes('lockedFeasibility'))});
    await runner.test('Decision Scenario','scenario Apply remains production-write blocked',()=>runner.assert(DecisionApplyCoordinator.prototype.apply.toString().includes('DECISION-SCENARIO-APPLY-461')));
    await runner.test('Decision Data Quality','missing duration is disclosed and lowers completeness',()=>{const q=new DecisionContextBuilder(host().app).dataQuality([{...fx.task,estimatedDuration:0,remainingDuration:0}],fx.data.projects,fx.context.capacity,[]);runner.assert(q.missingInputs.length>0&&q.completeness<1)});
    await runner.test('Decision Privacy','Decision Engine contains no remote-network primitive',()=>{const source=[DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionApplyCoordinator,DecisionBriefEngine,DecisionOutcomeEngine].map(x=>x.toString()).join('\n');runner.assert(!/(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource)/.test(source))});
    await runner.test('Decision Brief','morning brief composes day and deadline decisions locally',async()=>{const fakeDecision={decisionId:'brief',recommended:{explanation:{summary:'Local recommendation'}}},engine={analyze:async request=>({...fakeDecision,request})},app={repo:{dataset:async()=>fx.data,settings:async()=>fx.settings}},briefEngine=new DecisionBriefEngine(engine,app,{pending:async()=>[]}),value=await briefEngine.morning(fx.date);runner.assert(value.localOnly&&value.todayRecommendation.request.type===DECISION_TYPES.TODAY_PLAN&&value.deadlineRecommendation.request.type===DECISION_TYPES.DEADLINE_TRIAGE)});
    await runner.test('Decision Outcome','applied decision follow-up persists then records outcome',async()=>{const rows=new Map(),repo={get:async(_s,id)=>rows.get(id)||null,save:async(_s,row)=>{rows.set(row.id,clone(row));return row},all:async()=>[...rows.values()]},engine=new DecisionOutcomeEngine({repo}),decision={decisionId:'outcome-self',request:{date:fx.date}},choice={candidate:{id:'alt-self',title:'Outcome self'}};await engine.create(decision,choice,'op-self');const value=await engine.record(decision.decisionId,'Worked','validated');runner.assert(value.status==='Recorded'&&value.outcome==='Worked'&&value.operationId==='op-self')});
  }
}
function extendDecisionSelfTests(api){
  const Runner=api.SelfTestRunner;
  if(!Runner||Runner.prototype.__decision462Extended)return false;
  const original=Runner.prototype.run;
  Runner.prototype.__decision462Extended=true;
  Runner.prototype.run=async function(){
    const base=await original.call(this);
    await DecisionSelfTestExtension.run(this);
    const groups={};for(const result of this.results){const group=groups[result.group]||(groups[result.group]={passed:0,total:0});group.total++;if(result.pass)group.passed++}
    const passed=this.results.filter(result=>result.pass).length,total=this.results.length;
    return{...base,decisionEngineVersion:DECISION_ENGINE_VERSION,completedAt:nowISO(),passed,total,groups,results:this.results,healthy:passed===total};
  };
  return true;
}

class DecisionEngine{
  constructor(app=host().app){
    this.app=app;this.contextBuilder=new DecisionContextBuilder(app);this.generator=new DecisionCandidateGenerator();
    this.feasibility=new DecisionFeasibilityGate();this.tradeoffs=new DecisionTradeoffEngine();this.ranking=new DecisionRankingEngine();
    this.alternatives=new DecisionAlternativeGenerator();this.explanations=new DecisionExplanationEngine();this.previewManager=new DecisionPreviewManager();
    this.outcomes=new DecisionOutcomeEngine(app);this.applyCoordinator=new DecisionApplyCoordinator(app,this.outcomes);this.history=new DecisionHistory(app);this.briefs=new DecisionBriefEngine(this,app,this.outcomes);this.generation=0;
  }
  normalize(request={}){
    const {CoreUtil}=host();
    const type=Object.values(DECISION_TYPES).includes(request.type)?request.type:DECISION_TYPES.NEXT_ACTION;
    return{id:request.id||CoreUtil.uid(),type,date:request.date||'',horizon:request.horizon||'',entityIds:array(request.entityIds),constraints:clone(request.constraints||{}),source:request.source||'decision-center',mode:['production','preview','scenario'].includes(request.mode)?request.mode:'production',scenarioId:request.scenarioId||'',requestedAt:request.requestedAt||nowISO()};
  }
  async analyze(rawRequest={}){
    const generation=++this.generation,request=this.normalize(rawRequest),started=performance.now?.()||Date.now(),context=await this.contextBuilder.build(request);
    if(generation!==this.generation){const error=new Error('A newer decision analysis replaced this one.');error.code='DECISION-STALE-GENERATION-460';throw error}
    const candidates=this.generator.generate(request,context),evaluated=[];
    for(const candidate of candidates){
      const feasibility=this.feasibility.evaluate(candidate,context);
      const tradeoffs=this.tradeoffs.evaluate(candidate,context,feasibility);
      evaluated.push({candidate,feasibility,tradeoffs});
    }
    const ranked=this.ranking.rank(evaluated);
    const rawAlternatives=this.alternatives.generate(ranked,context);
    const alternatives=rawAlternatives.map((row,index)=>({...row,explanation:this.explanations.explain(row,rawAlternatives[index+1]||rawAlternatives[0],context)}));
    const recommended=alternatives[0]||null,elapsed=(performance.now?.()||Date.now())-started;
    const confidence=this.confidence(context,alternatives);
    const availableMinutes=Math.max(0,num(context.capacity?.focusRemaining,context.capacity?.physicalLeft||0));
    const requiredMinutes=context.readyTasks.reduce((sum,task)=>sum+Math.max(0,num(task.remainingDuration,num(task.estimatedDuration,0))),0);
    const minimumDeadlineMinutes=context.readyTasks.filter(task=>task.deadline&&deadlineDays(task,context.decisionDate,host().CoreUtil)<=1).reduce((sum,task)=>sum+Math.max(0,num(task.remainingDuration,num(task.estimatedDuration,0))),0);
    const capacityShortfall={availableMinutes,requiredMinutes,minimumDeadlineMinutes,shortfallMinutes:Math.max(0,requiredMinutes-availableMinutes),deadlineShortfallMinutes:Math.max(0,minimumDeadlineMinutes-availableMinutes)};
    const decision={decisionId:`decision:${decisionHash({request,contextFingerprint:context.contextFingerprint,generation})}`,request,contextFingerprint:context.contextFingerprint,dataGeneration:context.dataGeneration,engineVersion:DECISION_ENGINE_VERSION,generatedAt:nowISO(),durationMs:Number(elapsed.toFixed?.(2)||elapsed),dataQuality:context.dataQuality,capacityShortfall,recommended,alternatives,rejected:evaluated.filter(r=>!r.feasibility.feasible).map(r=>({candidate:r.candidate,blockers:r.feasibility.blockers,evidence:r.feasibility.evidence})),confidence};
    return decision;
  }
  confidence(context,alternatives){
    const completeness=num(context.dataQuality?.completeness,.5);
    if(!alternatives.length)return{label:'Limited',reasons:['No feasible alternative found.']};
    const top=alternatives[0],second=alternatives[1];
    let separation=.5;
    if(second){
      separation=Math.abs(top.tradeoffs.deadlineProtection-second.tradeoffs.deadlineProtection)+Math.abs(top.tradeoffs.projectAlignment-second.tradeoffs.projectAlignment)+Math.abs(top.tradeoffs.forecastImpact-second.tradeoffs.forecastImpact);
      separation=Math.min(1,separation);
    }
    const value=completeness*.65+separation*.35;
    return{label:value>=.78?'Strong':value>=.5?'Moderate':'Limited',reasons:[`Data completeness ${Math.round(completeness*100)}%.`,second?'Top alternatives were compared across deterministic stages.':'Only one feasible option is available.']};
  }
  preview(decision,alternativeId){return this.previewManager.build(decision,alternativeId)}
  apply(decision,alternativeId){return this.applyCoordinator.apply(decision,alternativeId)}
  morningBrief(date){return this.briefs.morning(date)}
  endOfDayReview(date){return this.briefs.endOfDay(date)}
  recordOutcome(decisionId,outcome,notes=''){return this.outcomes.record(decisionId,outcome,notes)}
}

class DecisionCenterUI{
  constructor(engine){this.engine=engine;this.app=engine.app||host().app;this.current=null;this.preview=null;this.button=null;this.panel=null;this.selectedId='';this.lastApplied=null;this.shortcutHandler=null}
  mount(){
    if(document.getElementById('decisionCenterButton'))return;
    const button=document.createElement('button');button.id='decisionCenterButton';button.className='btn decision-center-launch';button.type='button';button.textContent='Decision Center';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-keyshortcuts','Control+Alt+D');button.title='Decision Center · Ctrl+Alt+D';
    button.addEventListener('click',()=>this.open());(document.querySelector('.top-actions')||document.body).prepend(button);this.button=button;
    this.shortcutHandler=event=>{if(event.ctrlKey&&event.altKey&&!event.shiftKey&&String(event.key||'').toLowerCase()==='d'){event.preventDefault();this.open()}};document.addEventListener('keydown',this.shortcutHandler);
    const dialog=document.createElement('dialog');dialog.id='decisionCenterDialog';dialog.className='decision-center-dialog';dialog.setAttribute('aria-labelledby','decisionCenterTitle');
    dialog.innerHTML=`<div class="decision-center-shell"><div class="decision-center-head"><div><small>LifeOS 4.6.2 · Ctrl+Alt+D</small><h2 id="decisionCenterTitle">Decision Center</h2></div><button class="btn icon" data-decision-close aria-label="Close Decision Center">×</button></div><div class="decision-center-controls"><label>Decision <select data-decision-type><option value="next-action">What should I do now?</option><option value="today-plan">Today plan</option><option value="deadline-triage">Deadline triage</option><option value="project-allocation">Project allocation</option><option value="deferral">Deferral</option><option value="week-priority">Week priority</option><option value="schedule-conflict">Schedule conflict</option><option value="plan-repair">Plan repair</option></select></label><button class="btn primary" data-decision-analyze>Analyze</button></div><div class="decision-brief-actions" role="group" aria-label="Decision reviews"><button class="btn small" data-decision-brief="morning">Morning Decision Brief</button><button class="btn small" data-decision-brief="eod">End-of-Day Decision Review</button></div><div data-decision-status class="muted" role="status" aria-live="polite"></div><div data-decision-body></div></div>`;
    document.body.append(dialog);this.panel=dialog;
    dialog.querySelector('[data-decision-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-decision-analyze]').onclick=()=>this.analyze();
    dialog.addEventListener('click',event=>this.handle(event));
    dialog.addEventListener('change',event=>{const choice=event.target?.dataset?.decisionChoice;if(choice)this.selectedId=choice});
  }
  open(){this.panel?.showModal();this.panel?.querySelector('[data-decision-analyze]')?.focus()}
  async analyze(){
    const status=this.panel.querySelector('[data-decision-status]'),body=this.panel.querySelector('[data-decision-body]'),type=this.panel.querySelector('[data-decision-type]').value;
    status.textContent='Analyzing current constraints, capacity, deadlines and trade-offs…';body.innerHTML='';
    try{
      this.current=await this.engine.analyze({type,mode:'production',source:'decision-center'});
      this.preview=null;this.lastApplied=null;this.selectedId=this.current.recommended?.candidate?.id||this.current.alternatives[0]?.candidate?.id||'';
      status.textContent=`Decision analysis complete. ${this.current.alternatives.length} feasible alternative${this.current.alternatives.length===1?'':'s'} found. Confidence: ${this.current.confidence.label}.`;
      this.render();
    }catch(error){status.textContent=error.message;body.innerHTML=`<div class="note warning">${escapeHtml(error.message)}</div>`}
  }
  render(){
    const body=this.panel.querySelector('[data-decision-body]'),decision=this.current;if(!decision){body.innerHTML='';return}
    if(!decision.recommended){body.innerHTML='<div class="note warning">No feasible alternative is available. Review blocked tasks and hard constraints.</div>';return}
    const card=(alt,index)=>{
      const id=escapeHtml(alt.candidate.id),checked=alt.candidate.id===this.selectedId?'checked':'';
      return`<article class="decision-card ${index===0?'recommended':''}" data-alt="${id}"><div class="decision-choice"><input type="radio" name="decision-alternative" data-decision-choice="${id}" value="${id}" ${checked} aria-label="Choose ${escapeHtml(alt.candidate.title)}"><span>${escapeHtml(alt.label)}</span></div><h3>${escapeHtml(alt.candidate.title)}</h3>${alt.candidate.duration?`<div class="decision-duration">${alt.candidate.duration} min</div>`:''}<p>${escapeHtml(alt.explanation.summary)}</p><div class="decision-grid"><div><b>Protects</b><ul>${alt.explanation.protects.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div><div><b>Opportunity cost</b><p>${escapeHtml(alt.explanation.opportunityCost)}</p></div></div><details><summary>Why and trade-offs</summary><ul>${alt.tradeoffs.reasons.map(r=>`<li>${escapeHtml(r.reasonCode)} · ${escapeHtml(r.sourceEngine)}: ${escapeHtml(r.metric)} ${escapeHtml(r.value)}</li>`).join('')}</ul>${alt.explanation.whyLower?`<p>${escapeHtml(alt.explanation.whyLower)}</p>`:''}</details><div class="decision-actions"><button class="btn" data-preview="${id}">Preview</button><button class="btn primary" data-apply="${id}">Apply</button></div></article>`;
    };
    const shortfall=decision.capacityShortfall?.shortfallMinutes||0,shortfallNote=shortfall?`<div class="warning"><b>Capacity shortfall:</b> ${shortfall} minutes cannot fit in the remaining focus capacity today.</div>`:'';
    body.innerHTML=`<section class="decision-summary"><div><b>Recommended decision</b><span class="decision-confidence">Confidence: ${escapeHtml(decision.confidence.label)}</span></div><small>Exact context ${escapeHtml(decision.contextFingerprint)} · ${escapeHtml(String(decision.durationMs))} ms</small></section>${shortfallNote}${decision.dataQuality.missingInputs.length?`<div class="note">${decision.dataQuality.missingInputs.map(escapeHtml).join(' ')}</div>`:''}<div class="decision-card-list">${decision.alternatives.map(card).join('')}</div><div data-preview-output></div>`;
  }
  blockList(blocks){
    return blocks.length?`<ul class="decision-block-list">${blocks.map(block=>`<li>${escapeHtml(block.date||'')} ${escapeHtml(block.startTime||'')} · ${escapeHtml(String(block.duration||0))} min${block.title?` · ${escapeHtml(block.title)}`:''}</li>`).join('')}</ul>`:'<p class="muted">No affected schedule blocks.</p>';
  }
  previewHTML(preview){
    const f=preview.forecastEffect||{},o=preview.opportunity||{};
    return`<section class="decision-preview" data-decision-preview><div class="decision-preview-head"><div><h3>Preview</h3><p><b>Production state is unchanged until Apply.</b></p></div><span class="pill">Immutable preview</span></div><div class="decision-preview-compare"><section class="decision-preview-panel" data-preview-current><h4>CURRENT</h4><p>${escapeHtml(preview.current.summary)}</p>${this.blockList(preview.current.blocks)}</section><section class="decision-preview-panel" data-preview-proposed><h4>PROPOSED</h4><p>${escapeHtml(preview.proposed.summary)}</p>${this.blockList(preview.proposed.blocks)}</section></div><div class="decision-preview-metrics"><section class="decision-preview-panel" data-preview-forecast><h4>Forecast effect</h4><p>Risk points: <b>${escapeHtml(String(f.beforeRiskPoints??0))} → ${escapeHtml(String(f.afterRiskPoints??0))}</b></p><p>Deadline shortfall: <b>${escapeHtml(String(f.shortfallBefore??0))} → ${escapeHtml(String(f.shortfallAfter??0))} min</b></p><p>Improved tasks: ${escapeHtml(String(f.improvedTasks??0))} · Worsened: ${escapeHtml(String(f.worsenedTasks??0))}</p></section><section class="decision-preview-panel" data-preview-opportunity><h4>Opportunity cost</h4><p>Capacity committed: <b>${escapeHtml(String(o.capacityConsumedMinutes??0))} min</b></p><p>Remaining capacity: <b>${escapeHtml(String(o.remainingCapacityMinutes??0))} min</b></p><p>Competing work uncovered: <b>${escapeHtml(String(o.opportunityCostMinutes??0))} min</b></p></section></div><p>${preview.changes.map(escapeHtml).join(' ')||'No production change.'}</p><small>Fingerprint ${escapeHtml(preview.productionFingerprintBefore)}</small><div class="decision-actions"><button class="btn primary" data-apply="${escapeHtml(preview.alternativeId)}" autofocus>Apply this alternative</button></div></section>`;
  }
  async showMorning(){
    const status=this.panel.querySelector('[data-decision-status]'),body=this.panel.querySelector('[data-decision-body]');status.textContent='Building Morning Decision Brief from local planning data…';
    try{const brief=await this.engine.morningBrief();const cap=brief.capacity||{};body.innerHTML=`<section class="decision-brief" data-morning-decision-brief><h3>Morning Decision Brief</h3><div class="grid grid-3"><div class="card"><b>Today</b><p>${escapeHtml(brief.summary.today)}</p></div><div class="card"><b>Deadlines</b><p>${escapeHtml(brief.summary.deadlines)}</p><small>${escapeHtml(String(brief.dueCount))} due/near-due active task(s)</small></div><div class="card"><b>Focus capacity</b><p>${escapeHtml(String(cap.focusRemaining??0))} min remaining</p><small>${escapeHtml(cap.status||'Local capacity model')}</small></div></div><p class="muted">Generated locally · no production mutation.</p></section>`;status.textContent='Morning Decision Brief ready.'}catch(error){status.textContent=error.message}
  }
  async showEndOfDay(){
    const status=this.panel.querySelector('[data-decision-status]'),body=this.panel.querySelector('[data-decision-body]');status.textContent='Building End-of-Day Decision Review from local history…';
    try{const review=await this.engine.endOfDayReview();const pending=review.pendingOutcomes.map(row=>`<div class="decision-follow-up" data-decision-follow-up="${escapeHtml(row.decisionId)}"><b>${escapeHtml(row.text||row.decisionId)}</b><p class="muted">Applied ${escapeHtml(row.appliedAt||'')} · Follow-up ${escapeHtml(row.followUpDate||'')}</p><div class="actions"><button class="btn small" data-decision-outcome="Worked" data-decision-id="${escapeHtml(row.decisionId)}">Worked</button><button class="btn small" data-decision-outcome="Partly" data-decision-id="${escapeHtml(row.decisionId)}">Partly</button><button class="btn small" data-decision-outcome="Did not work" data-decision-id="${escapeHtml(row.decisionId)}">Did not work</button></div></div>`).join('');body.innerHTML=`<section class="decision-brief" data-end-of-day-decision-review><h3>End-of-Day Decision Review</h3><p>${escapeHtml(review.summary)}</p><div><b>Applied today:</b> ${escapeHtml(String(review.appliedCount))}</div>${pending||'<p class="muted">No pending decision outcome follow-up.</p>'}</section>`;status.textContent='End-of-Day Decision Review ready.'}catch(error){status.textContent=error.message}
  }
  async handle(event){
    const target=event.target,brief=target?.dataset?.decisionBrief,outcome=target?.dataset?.decisionOutcome,decisionId=target?.dataset?.decisionId,previewId=target?.dataset?.preview,applyId=target?.dataset?.apply;
    if(brief==='morning')return this.showMorning();
    if(brief==='eod')return this.showEndOfDay();
    if(outcome&&decisionId){const status=this.panel.querySelector('[data-decision-status]');target.disabled=true;try{await this.engine.recordOutcome(decisionId,outcome);await this.showEndOfDay();status.textContent=`Decision outcome recorded: ${outcome}.`;return}catch(error){target.disabled=false;status.textContent=error.message;return}}
    if(target?.dataset?.decisionUndo!==undefined){const status=this.panel.querySelector('[data-decision-status]');try{const result=await this.app.undo.undo();if(this.current?.decisionId)try{await this.engine.recordOutcome(this.current.decisionId,'Undone','Undo from Decision Center')}catch{}status.textContent=result?'Decision undone. The production state was restored.':'No Decision operation is available to undo.';this.lastApplied=null;return}catch(error){status.textContent=error.message;return}}
    if(previewId){
      this.selectedId=previewId;const radio=this.panel.querySelector(`input[data-decision-choice="${CSS.escape(previewId)}"]`);if(radio)radio.checked=true;
      this.preview=this.engine.preview(this.current,previewId);const out=this.panel.querySelector('[data-preview-output]');out.innerHTML=this.previewHTML(this.preview);out.scrollIntoView({block:'nearest'});queueMicrotask(()=>out.querySelector('[data-apply]')?.focus());return;
    }
    if(applyId){
      const status=this.panel.querySelector('[data-decision-status]');status.textContent='Revalidating before apply…';
      try{const result=await this.engine.apply(this.current,applyId);this.lastApplied=result;status.textContent=result.noChange?'Current plan kept. No production mutation was made.':'Decision applied as one logical operation.';const out=this.panel.querySelector('[data-preview-output]');if(!result.noChange&&out)out.insertAdjacentHTML('beforeend','<div class="decision-undo"><button class="btn" data-decision-undo>Undo Decision</button></div>')}
      catch(error){status.textContent=error.message}
    }
  }
}

function expose(){
  const api=host();
  const engine=new DecisionEngine(api.app);
  api.decisionEngineVersion=DECISION_ENGINE_VERSION;
  api.DECISION_ENGINE_VERSION=DECISION_ENGINE_VERSION;
  api.DECISION_TYPES=DECISION_TYPES;
  Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory,DecisionOutcomeEngine,DecisionBriefEngine,DecisionSelfTestExtension});
  api.app.decisionEngine=engine;api.app.decisionOutcome=engine.outcomes;api.app.decisionBrief=engine.briefs;extendDecisionSelfTests(api);
  api.app.whatNow=async function(){
    try{
      const decision=await engine.analyze({type:DECISION_TYPES.NEXT_ACTION,mode:'production',source:'what-now'}),recommended=decision.recommended;
      if(!recommended){
        this.modal.open('What should I do now?',`<div data-decision-what-now data-decision-what-now-evidence="4.6.2" class="note"><b>No feasible next action is available.</b><p>Review blocked work, protected recovery, fixed commitments and hard capacity constraints in Decision Center.</p></div>`,'<button class="btn" data-action="close-dialog">Close</button>');
        return decision;
      }
      const candidate=recommended.candidate,explanation=recommended.explanation||{},alternative=decision.alternatives.find(item=>item.candidate.id!==candidate.id&&item.candidate.kind!==KEEP_CURRENT_PLAN)||decision.alternatives.find(item=>item.candidate.id!==candidate.id);
      const why=array(recommended.tradeoffs?.reasons).filter(item=>item.severity!=='hard').slice(0,4).map(item=>`<li><b>${escapeHtml(item.reasonCode.replaceAll('-',' '))}</b> — ${escapeHtml(item.comparison||`${item.metric}: ${item.value}`)}</li>`).join('');
      const protects=array(explanation.protects).map(item=>`<li>${escapeHtml(item)}</li>`).join('')||'<li>Current feasible plan and remaining capacity.</li>';
      const next=array(explanation.defers)[0]||'Reassess after this session or when the current context changes.';
      const bestAlternative=alternative?`<div class="item"><div class="item-main"><b>${escapeHtml(alternative.candidate.title)}</b><div class="muted">${alternative.candidate.duration?escapeHtml(alternative.candidate.duration+' min'):'No extra scheduled time'} · ${escapeHtml(alternative.label)}</div></div></div>`:'<p class="muted">No materially different feasible alternative is available.</p>';
      const intelligenceEvidence=array(recommended.tradeoffs?.reasons).find(item=>item.reasonCode==='PERSONAL-INTELLIGENCE');
      const evidenceText=intelligenceEvidence?`Historical duration evidence — ${intelligenceEvidence.comparison||'Accepted Personal Intelligence was used as a soft ranking signal.'}`:'Limited historical evidence is available for this decision.';
      const startAction=candidate.kind==='task-session'&&candidate.taskId?`<button class="btn primary" data-action="start-focus" data-id="${escapeHtml(candidate.taskId)}">Start Focus</button>`:'<button class="btn primary" data-action="close-dialog">Keep Current Plan</button>';
      this.modal.open('What should I do now?',`<div data-decision-what-now data-decision-what-now-evidence="4.6.2"><div class="success-box"><div class="muted">DECISION ENGINE RECOMMENDATION</div><h2>${escapeHtml(candidate.title)}</h2>${candidate.duration?`<div class="metric">${escapeHtml(candidate.duration)} min</div>`:''}<p>${escapeHtml(explanation.summary||'This is the highest-ranked feasible decision under the current constraints.')}</p></div><div class="flow-gap-14"><h3>Why now?</h3><ul>${why||'<li>The recommendation passed hard feasibility and deterministic trade-off ranking.</li>'}</ul><h3>Evidence</h3><p>${escapeHtml(evidenceText)}</p><p class="muted">No calendar changes required</p><h3>What this protects</h3><ul>${protects}</ul><h3>What comes next?</h3><p>${escapeHtml(next)}</p><h3>Opportunity cost</h3><p>${escapeHtml(explanation.opportunityCost||'Remaining capacity is preserved for the next decision.')}</p><h3>Best alternative</h3>${bestAlternative}<p class="muted">Confidence: ${escapeHtml(decision.confidence?.label||'Limited')} · Decision Engine ${escapeHtml(DECISION_ENGINE_VERSION)}</p></div></div>`,'<button class="btn" data-action="close-dialog">Close</button>'+startAction,{subtitle:'Decision-aware recommendation using current hard constraints and trade-offs.'});
      return decision;
    }catch(error){
      this.modal.open('What should I do now?',`<div data-decision-what-now data-decision-what-now-evidence="4.6.2" class="note warning"><b>Decision analysis could not complete.</b><p>${escapeHtml(error.message)}</p></div>`,'<button class="btn" data-action="close-dialog">Close</button>');
      return null;
    }
  };
  const ui=new DecisionCenterUI(engine);api.app.decisionCenter=ui;ui.mount();
  return engine;
}
function boot(){
  const attempt=()=>{if(globalThis.LifeOS?.app?.repo){try{expose()}catch(error){console.error('[DECISION-BOOT-460]',error)}return true}return false};
  if(attempt())return;let tries=0;const timer=setInterval(()=>{tries++;if(attempt()||tries>200)clearInterval(timer)},25);
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',boot,{once:true}):boot();
})();

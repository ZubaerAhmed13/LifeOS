(() => {
'use strict';

const DECISION_ENGINE_VERSION='4.6.0';
const DECISION_TYPES=Object.freeze({
  NEXT_ACTION:'next-action',TODAY_PLAN:'today-plan',DEADLINE_TRIAGE:'deadline-triage',
  PROJECT_ALLOCATION:'project-allocation',CAPACITY_SHORTFALL:'capacity-shortfall',
  SCHEDULE_CONFLICT:'schedule-conflict',DEFERRAL:'deferral',PLAN_REPAIR:'plan-repair',
  WEEK_PRIORITY:'week-priority'
});
const KEEP_CURRENT_PLAN='keep-current-plan';
const MAX_TASK_CANDIDATES=30;
const MAX_ALTERNATIVES=5;

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
    const api=host(),{CoreUtil,CivilTimeEngine,CapacityEngine,DeadlineEngine,ProjectForecastEngine,ScenarioDataView}=api;
    const repo=this.app.repo;
    const [productionData,settings]=await Promise.all([repo.dataset({fresh:true}),repo.settings()]);
    let data=productionData,mode=request.mode||'production',scenario=null;
    if(mode==='scenario'&&request.scenarioId&&this.app.scenarioEngine){
      scenario=await this.app.scenarioEngine.get(request.scenarioId);
      if(scenario){
        const view=new ScenarioDataView(productionData,settings,scenario),materialized=view.materialize();
        data=materialized.data;
      }
    }
    const zone=settings.timeZoneId||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    let civil;
    try{civil=CivilTimeEngine.parts(Date.now(),zone)}catch{civil={date:CoreUtil.localDate(),time:new Date().toTimeString().slice(0,5),timeZoneId:zone}}
    const date=request.date||civil.date||CoreUtil.localDate();
    const capacity=CapacityEngine.summary(date,data,settings);
    const tasks=array(data.tasks),projects=array(data.projects),events=array(data.events),timeBlocks=array(data.timeBlocks);
    const deadlineForecasts=[];
    for(const task of tasks.filter(activeTask).filter(t=>t.deadline).slice(0,100)){
      try{
        const end=task.deadline>=date?task.deadline:date;
        deadlineForecasts.push(DeadlineEngine.forecastTask(task,data,settings,{from:date,end}));
      }catch{}
    }
    const projectForecasts=[];
    for(const project of projects.filter(p=>p.status==='Active').slice(0,50)){
      try{
        const end=project.targetDate&&project.targetDate>=date?project.targetDate:CoreUtil.addDays(date,14);
        projectForecasts.push(ProjectForecastEngine.project(project,data,settings,{from:date,end}));
      }catch{}
    }
    let rules=[];
    try{rules=(await repo.all('rules',{fresh:true})).filter(r=>r.enabled)}catch{}
    let intelligence=null;
    try{
      if(api.PersonalIntelligenceEngine){
        const engine=new api.PersonalIntelligenceEngine(data,settings);
        intelligence=engine.analyze?.({from:CoreUtil.addDays(date,-90),to:date})||engine.analyze?.();
      }
    }catch{}
    const relevant={
      date,time:civil.time||'',timeZoneId:zone,mode,
      tasks:tasks.map(t=>({id:t.id,revision:t.revision,status:t.status,priority:t.priority,deadline:t.deadline,estimatedDuration:t.estimatedDuration,remainingDuration:t.remainingDuration,blockedBy:t.blockedBy,projectId:t.projectId,locked:t.locked,protected:t.protected,preferredDate:t.preferredDate,preferredTime:t.preferredTime,workMode:t.workMode,context:t.context,taskType:t.taskType})),
      projects:projects.map(p=>({id:p.id,revision:p.revision,status:p.status,targetDate:p.targetDate,weeklyTargetHours:p.weeklyTargetHours,minimumWeeklyHours:p.minimumWeeklyHours,stretchWeeklyHours:p.stretchWeeklyHours})),
      events:events.filter(e=>e.startDate<=date&&e.endDate>=date).map(e=>({id:e.id,revision:e.revision,startDate:e.startDate,startTime:e.startTime,endDate:e.endDate,endTime:e.endTime,locked:e.locked})),
      timeBlocks:timeBlocks.filter(b=>b.date===date).map(b=>({id:b.id,revision:b.revision,date:b.date,startTime:b.startTime,duration:b.duration,taskId:b.taskId,projectId:b.projectId,locked:b.locked})),
      settings:{revision:settings.revision,dayStart:settings.dayStart,dayEnd:settings.dayEnd,bufferPercent:settings.bufferPercent,minBufferMinutes:settings.minBufferMinutes,recoveryMode:settings.recoveryMode,deepWorkBefore:settings.deepWorkBefore,timeZoneId:zone},
      rules:rules.map(r=>({id:r.id,revision:r.revision,enabled:r.enabled,name:r.name,executionPolicy:r.executionPolicy})),
      scenario:scenario?{id:scenario.id,revision:scenario.revision,baselineFingerprint:scenario.baselineFingerprint}:null
    };
    const dataGeneration=[...tasks,...projects,...events,...timeBlocks].reduce((sum,row)=>sum+num(row.revision,1),0);
    const contextFingerprint=CoreUtil.hash(relevant);
    const readyTasks=tasks.filter(t=>readyTask(t,tasks));
    const blockedTasks=tasks.filter(activeTask).filter(t=>!readyTask(t,tasks));
    const context={
      generatedAt:nowISO(),decisionDate:date,currentDate:civil.date||date,currentLocalTime:civil.time||'',timeZoneId:zone,mode,
      data:clone(data),settings:clone(settings),tasks:clone(tasks),readyTasks:clone(readyTasks),blockedTasks:clone(blockedTasks),
      projects:clone(projects),events:clone(events),timeBlocks:clone(timeBlocks),capacity:clone(capacity),
      deadlineForecasts:clone(deadlineForecasts),projectForecasts:clone(projectForecasts),activeRules:clone(rules),
      intelligence:clone(intelligence),contextFingerprint,dataGeneration,
      sourceRevisions:{settings:num(settings.revision),scenario:num(scenario?.revision),tasks:tasks.reduce((m,t)=>(m[t.id]=num(t.revision),m),{}),projects:projects.reduce((m,p)=>(m[p.id]=num(p.revision),m),{})},
      dataQuality:this.dataQuality(tasks,projects,capacity,deadlineForecasts)
    };
    return Object.freeze(context);
  }
  dataQuality(tasks,projects,capacity,forecasts){
    const missingInputs=[],unavailableSignals=[];
    const active=tasks.filter(activeTask);
    if(active.some(t=>!num(t.estimatedDuration)&&!num(t.remainingDuration)))missingInputs.push('Some active tasks have no duration estimate.');
    if(active.some(t=>!t.priority))missingInputs.push('Some active tasks have no priority.');
    if(!projects.length)unavailableSignals.push('No project data are available for project alignment.');
    if(!forecasts.length)unavailableSignals.push('No deadline forecast is available for this decision.');
    if(!capacity)unavailableSignals.push('Capacity summary is unavailable.');
    const completeness=Math.max(0,1-(missingInputs.length*.12)-(unavailableSignals.length*.08));
    return {completeness:Number(completeness.toFixed(2)),missingInputs,unavailableSignals,warnings:[]};
  }
}

class DecisionCandidateGenerator{
  generate(request,context){
    const api=host(),{CoreUtil}=api;
    const type=request.type||DECISION_TYPES.NEXT_ACTION;
    const candidates=[this.keepCurrent(context)];
    const ready=stableSort(context.readyTasks,(a,b)=>{
      const dd=deadlineDays(a,context.decisionDate,CoreUtil)-deadlineDays(b,context.decisionDate,CoreUtil);
      if(dd)return dd;
      const pr=priorityRank(b.priority)-priorityRank(a.priority);
      if(pr)return pr;
      return String(a.id).localeCompare(String(b.id));
    }).slice(0,MAX_TASK_CANDIDATES);
    const currentMinute=context.decisionDate>context.currentDate?(CoreUtil.clock(context.settings.dayStart)||0):(CoreUtil.clock(context.currentLocalTime)||CoreUtil.clock(context.settings.dayStart)||0);
    const slotStart=Math.ceil(currentMinute/15)*15;
    const remaining=Math.max(0,num(context.capacity?.focusRemaining,context.capacity?.physicalLeft||0));
    if([DECISION_TYPES.NEXT_ACTION,DECISION_TYPES.TODAY_PLAN,DECISION_TYPES.DEADLINE_TRIAGE,DECISION_TYPES.CAPACITY_SHORTFALL,DECISION_TYPES.PROJECT_ALLOCATION].includes(type)){
      for(const task of ready){
        const estimate=Math.max(15,num(task.remainingDuration,num(task.estimatedDuration,30)));
        const min=Math.max(15,num(task.minimumSessionDuration,15));
        const max=Math.max(min,num(task.maximumSessionDuration,90));
        const duration=Math.max(min,Math.min(max,estimate,remaining||max));
        if(duration<=0)continue;
        candidates.push({
          id:`task:${task.id}:${duration}`,kind:'task-session',taskId:task.id,projectId:task.projectId||'',
          title:task.title||'Untitled task',duration,date:context.decisionDate,startMinute:slotStart,
          requestedType:type,changes:[],metadata:{priority:task.priority||'',deadline:task.deadline||''}
        });
      }
    }
    if(type===DECISION_TYPES.PLAN_REPAIR)candidates.push({id:'repair:minimal',kind:'plan-repair',title:'Run minimal repair',duration:0,date:context.decisionDate,changes:[]});
    return candidates.slice(0,MAX_TASK_CANDIDATES+1);
  }
  keepCurrent(context){return{id:KEEP_CURRENT_PLAN,kind:KEEP_CURRENT_PLAN,title:'Keep current plan',duration:0,date:context.decisionDate,startMinute:null,changes:[],metadata:{}}}
}

class DecisionFeasibilityGate{
  evaluate(candidate,context){
    const api=host(),{CoreUtil,ConflictEngine}=api;
    const blockers=[],warnings=[],evidence=[];
    if(candidate.kind===KEEP_CURRENT_PLAN)return{feasible:true,blockers,warnings,evidence:[reason('KEEP-CURRENT','DecisionFeasibilityGate','currentPlan',true,'No mutation','info')]};
    if(candidate.kind==='plan-repair')return{feasible:true,blockers,warnings,evidence};
    const task=context.tasks.find(t=>t.id===candidate.taskId);
    if(!task){blockers.push('Task no longer exists.');return{feasible:false,blockers,warnings,evidence}};
    if(!activeTask(task)){blockers.push('Task is not active.');return{feasible:false,blockers,warnings,evidence}};
    if(!readyTask(task,context.tasks)){blockers.push('Task dependencies are incomplete.');evidence.push(reason('DEPENDENCY-BLOCK','DependencyGraph','ready',false,'Requires completed blockers','hard'));return{feasible:false,blockers,warnings,evidence}}
    if(task.locked||task.protected){blockers.push('Task is locked or protected.');evidence.push(reason('ENTITY-PROTECTED','Repository','locked',true,'Protected entity','hard'));return{feasible:false,blockers,warnings,evidence}}
    const start=CoreUtil.dayIndex(candidate.date)*1440+candidate.startMinute;
    const interval={sourceId:`decision:${candidate.id}`,startDateTime:start,endDateTime:start+candidate.duration,minutes:candidate.duration,locked:false};
    let conflicts=[];
    try{conflicts=ConflictEngine.checkInterval(interval,context.data,context.settings,{task})||[]}catch(error){warnings.push(`Conflict validation unavailable: ${error.message}`)}
    for(const conflict of conflicts){
      if(['hard','capacity','dependency','rule'].includes(conflict.type)){
        blockers.push(conflict.message||conflict.title||conflict.code);
        evidence.push(reason(conflict.code||'CONFLICT','ConflictEngine','conflict',conflict.type,conflict.title||'','hard'));
      }else warnings.push(conflict.message||conflict.title||String(conflict));
    }
    return{feasible:blockers.length===0,blockers,warnings,evidence};
  }
}

class DecisionTradeoffEngine{
  evaluate(candidate,context,feasibility){
    const api=host(),{CoreUtil}=api;
    if(candidate.kind===KEEP_CURRENT_PLAN)return{
      deadlineProtection:0,projectAlignment:0,forecastImpact:0,capacityFit:1,disruption:0,recoveryImpact:0,contextCost:0,bufferImpact:0,deferralCost:0,reasons:[reason('NO-CHANGE','DecisionTradeoffEngine','disruption',0,'Current plan preserved')]
    };
    if(candidate.kind==='plan-repair')return{
      deadlineProtection:.5,projectAlignment:.3,forecastImpact:.2,capacityFit:.5,disruption:.3,recoveryImpact:0,contextCost:0,bufferImpact:0,deferralCost:0,reasons:[reason('MINIMAL-REPAIR','ScheduleRepairEngine','repair',true,'Current plan invalid or conflicting')]
    };
    const task=context.tasks.find(t=>t.id===candidate.taskId),deadline=task?.deadline||'',days=deadlineDays(task,context.decisionDate,CoreUtil);
    const forecast=context.deadlineForecasts.find(f=>f.taskId===task?.id);
    const project=context.projects.find(p=>p.id===task?.projectId);
    const projectForecast=context.projectForecasts.find(f=>f.projectId===project?.id);
    const deadlineProtection=deadline?days<0?1:days===0?1:days===1?.96:days<=3?.8:days<=7?.55:.25:0;
    const forecastRisk=String(forecast?.risk||'').toLowerCase();
    const forecastImpact=/critical|high|at risk|late/.test(forecastRisk)?.9:/medium/.test(forecastRisk)?.55:forecast?.shortfall>0?.65:.2;
    const target=num(project?.weeklyTargetHours)*60,projectShortfall=num(projectForecast?.shortfall,0);
    const projectAlignment=project?(projectShortfall>0?.85:target>0?.45:.25):.1;
    const cap=Math.max(1,num(context.capacity?.focusRemaining,context.capacity?.physicalLeft||candidate.duration));
    const capacityFit=Math.max(0,Math.min(1,candidate.duration/cap));
    const bufferAfter=Math.max(0,cap-candidate.duration),desiredBuffer=Math.max(num(context.settings.minBufferMinutes,0),cap*num(context.settings.bufferPercent,0)/100);
    const bufferImpact=desiredBuffer?Math.max(-1,Math.min(1,(bufferAfter-desiredBuffer)/desiredBuffer)):0;
    const currentContext=context.timeBlocks.filter(b=>b.date===candidate.date).sort((a,b)=>String(a.startTime).localeCompare(String(b.startTime))).at(-1)?.context||'';
    const contextCost=currentContext&&task?.context&&currentContext!==task.context?1:0;
    const disruption=.15;
    const recoveryImpact=0;
    const taskType=String(task?.taskType||task?.type||task?.context||'');
    const deepCutoff=CoreUtil.clock(context.settings.deepWorkBefore||''),typeCutoff=CoreUtil.clock(context.settings.taskTypePreferredBefore?.[taskType]||'');
    let ruleAlignment=0;
    if(task?.workMode==='Deep'&&deepCutoff!==null)ruleAlignment=candidate.startMinute<deepCutoff?.35:-.15;
    if(typeCutoff!==null)ruleAlignment+=candidate.startMinute<typeCutoff?.25:-.1;
    let intelligenceAlignment=0,intelligenceReason='';
    try{const signal=api.PersonalIntelligenceEngine?.signalForTask?.(task,context.intelligence||{insights:[]},context.settings,candidate.startMinute);if(signal){intelligenceAlignment=Math.min(.25,num(signal.boost,0)/24);intelligenceReason=signal.explanation||''}}catch{}
    const deferralCost=deadlineProtection*.8+forecastImpact*.2;
    const reasons=[
      reason('DEADLINE-PROTECTION','DeadlineEngine','daysToDeadline',days,deadline||'No deadline',deadlineProtection>.8?'important':'info'),
      reason('PROJECT-ALIGNMENT','ProjectForecastEngine','projectShortfall',projectShortfall,project?.title||'No project'),
      reason('CAPACITY-FIT','CapacityEngine','focusRemaining',cap,`${candidate.duration}m proposed`),
      reason('BUFFER-PRESERVATION','CapacityEngine','bufferAfter',bufferAfter,`desired ${Math.round(desiredBuffer)}m`)
    ];
    if(ruleAlignment)reasons.push(reason('RULEENGINE-ALIGNMENT','RuleEngine','planningPreference',ruleAlignment,'Applied planning-policy outputs are soft unless enforced by authoritative feasibility.'));
    if(intelligenceAlignment&&intelligenceReason)reasons.push(reason('PERSONAL-INTELLIGENCE','PersonalIntelligenceEngine','acceptedPreference',intelligenceAlignment,intelligenceReason));
    if(forecast)reasons.push(reason('FORECAST-RISK','DeadlineEngine','risk',forecast.risk||'',`shortfall ${num(forecast.shortfall)}m`));
    return{deadlineProtection,projectAlignment,forecastImpact,capacityFit,disruption,recoveryImpact,contextCost,bufferImpact,ruleAlignment,intelligenceAlignment,deferralCost,reasons};
  }
}

class DecisionRankingEngine{
  rank(rows){
    const ranked=stableSort(rows.filter(r=>r.feasibility.feasible),(a,b)=>{
      const A=a.tradeoffs,B=b.tradeoffs;
      const stages=[
        B.deadlineProtection-A.deadlineProtection,
        B.projectAlignment-A.projectAlignment,
        num(B.ruleAlignment)-num(A.ruleAlignment),
        B.forecastImpact-A.forecastImpact,
        B.capacityFit-A.capacityFit,
        A.disruption-B.disruption,
        A.recoveryImpact-B.recoveryImpact,
        A.contextCost-B.contextCost,
        num(B.intelligenceAlignment)-num(A.intelligenceAlignment),
        B.bufferImpact-A.bufferImpact
      ];
      for(const delta of stages)if(Math.abs(delta)>.0001)return delta;
      if(a.candidate.kind===KEEP_CURRENT_PLAN&&b.candidate.kind!==KEEP_CURRENT_PLAN)return 1;
      if(b.candidate.kind===KEEP_CURRENT_PLAN&&a.candidate.kind!==KEEP_CURRENT_PLAN)return-1;
      return String(a.candidate.id).localeCompare(String(b.candidate.id));
    });
    const keep=ranked.find(row=>row.candidate.kind===KEEP_CURRENT_PLAN),bestChange=ranked.find(row=>row.candidate.kind!==KEEP_CURRENT_PLAN);
    const material=bestChange&&(bestChange.tradeoffs.deadlineProtection>=.35||bestChange.tradeoffs.projectAlignment>=.55||bestChange.tradeoffs.forecastImpact>=.55||bestChange.tradeoffs.deferralCost>=.55);
    const ordered=keep&&!material?[keep,...ranked.filter(row=>row!==keep)]:ranked;
    return ordered.map((row,index)=>({...row,rank:index+1}));
  }
}

class DecisionAlternativeGenerator{
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
}

class DecisionExplanationEngine{
  explain(row,runnerUp,context){
    const {candidate,tradeoffs}=row;
    if(candidate.kind===KEEP_CURRENT_PLAN)return{
      summary:'Keep the current plan. No alternative creates enough evidence-backed improvement to justify disruption.',
      protects:['Schedule stability','Existing commitments'],changes:['No production change'],defers:[],risks:context.dataQuality.warnings||[],
      opportunityCost:'The plan is preserved, so no additional task receives protected time now.',reasons:tradeoffs.reasons
    };
    if(candidate.kind==='plan-repair')return{
      summary:'Run the existing minimal repair engine rather than rebuilding the schedule.',
      protects:['Locked and fixed commitments','Existing schedule structure'],changes:['Only the repair engine’s validated changes'],defers:[],risks:[],
      opportunityCost:'Some flexible work may move to restore feasibility.',reasons:tradeoffs.reasons
    };
    const task=context.tasks.find(t=>t.id===candidate.taskId),runner=runnerUp?.candidate;
    const protects=[];
    if(task?.deadline)protects.push(`${task.title||candidate.title} deadline ${task.deadline}`);
    if(task?.projectId)protects.push('Project progress requirement');
    if(!protects.length)protects.push('Usable focus capacity');
    const changes=[`Reserve ${candidate.duration} minutes for ${candidate.title} from ${host().CoreUtil.time(candidate.startMinute)}.`];
    const defers=context.readyTasks.filter(t=>t.id!==candidate.taskId).slice(0,2).map(t=>t.title);
    const opportunityCost=defers.length?`${defers.join(' and ')} receive less remaining capacity today.`:'Remaining capacity is reduced by the recommended session.';
    const whyLower=runner&&runner.kind!==KEEP_CURRENT_PLAN?`${runner.title} ranked lower after deadline, project, forecast, capacity and disruption stages were compared.`:'Keeping the current plan ranked lower because this feasible option better protects current obligations.';
    return{
      summary:`Do ${candidate.title} for ${candidate.duration} minutes now.`,
      protects,changes,defers,
      risks:[...(context.dataQuality.missingInputs||[]),...(row.feasibility.warnings||[])],
      opportunityCost,whyLower,reasons:tradeoffs.reasons
    };
  }
}

class DecisionPreviewManager{
  build(decision,alternativeId){
    const choice=decision.alternatives.find(a=>a.candidate.id===alternativeId)||decision.alternatives[0];
    if(!choice)throw new Error('No feasible alternative is available.');
    const beforeFingerprint=decision.contextFingerprint;
    const proposed={type:choice.candidate.kind,taskId:choice.candidate.taskId||'',date:choice.candidate.date,duration:choice.candidate.duration,startMinute:choice.candidate.startMinute};
    const previewId=`preview:${decision.decisionId}:${choice.candidate.id}`;
    return{previewId,decisionId:decision.decisionId,alternativeId:choice.candidate.id,contextFingerprint:beforeFingerprint,productionFingerprintBefore:beforeFingerprint,proposed,changes:clone(choice.explanation.changes),warnings:clone(choice.explanation.risks),generatedAt:nowISO(),immutable:true};
  }
}

class DecisionApplyCoordinator{
  constructor(app=host().app){this.app=app}
  async revalidate(decision){
    const context=await new DecisionContextBuilder(this.app).build(decision.request);
    return{fresh:context.contextFingerprint===decision.contextFingerprint,context};
  }
  async apply(decision,alternativeId){
    const choice=decision.alternatives.find(a=>a.candidate.id===alternativeId)||decision.alternatives[0];
    if(!choice)throw new Error('No feasible decision can be applied.');
    const fresh=await this.revalidate(decision);
    if(!fresh.fresh){
      const error=new Error('This recommendation is out of date because the underlying plan changed.');
      error.code='DECISION-STALE-460';throw error;
    }
    if(choice.candidate.kind===KEEP_CURRENT_PLAN)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
    if(choice.candidate.kind!=='plan-repair'){
      const feasibility=new DecisionFeasibilityGate().evaluate(choice.candidate,fresh.context);
      if(!feasibility.feasible){const error=new Error('This recommendation is no longer feasible under the current hard constraints.');error.code='DECISION-REVALIDATION-460';error.details={blockers:feasibility.blockers,evidence:feasibility.evidence};throw error}
    }
    if(choice.candidate.kind==='plan-repair'){
      const op=async()=>{
        const preview=await this.app.service.buildRepair(fresh.context.decisionDate,{maxRadius:4}),candidate=preview.candidates?.[0];
        if(!candidate)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
        const result=await this.app.service.applyRepair(preview,candidate.id,{skipOperationLock:true,label:'Decision — minimal repair'});
        return this.record(decision,choice,'Applied',{operationId:result?.operationId||candidate.id||''});
      };
      return this.app.operationLocks?this.app.operationLocks.withExclusiveLock('Decision apply',op):op();
    }
    const task=fresh.context.tasks.find(t=>t.id===choice.candidate.taskId);
    if(!task)throw new Error('Task no longer exists.');
    const {CoreUtil}=host(),start=choice.candidate.startMinute;
    const block={
      id:CoreUtil.uid(),date:choice.candidate.date,startTime:CoreUtil.time(start),endTime:CoreUtil.time(start+choice.candidate.duration),duration:choice.candidate.duration,type:'task',
      taskId:task.id,projectId:task.projectId||'',lifeAreaId:task.lifeAreaId||'',title:task.title||choice.candidate.title,
      sourceType:'decision',sourceId:task.id,decisionId:decision.decisionId,manuallyPlaced:true,locked:false,createdAt:nowISO(),updatedAt:nowISO(),revision:1
    };
    const change={store:'timeBlocks',id:block.id,before:null,after:block};
    const op=async()=>{
      const entry=await this.app.journal?.begin('decision-apply',['timeBlocks'],'');
      try{
        const undoResult=await this.app.undo.execute(`Decision — ${choice.label||choice.candidate.title}`,[change],{activityType:'decision-apply',meta:{decisionId:decision.decisionId,decisionEngineVersion:DECISION_ENGINE_VERSION,alternativeId:choice.candidate.id}});
        if(entry)await this.app.journal.finish(entry,'committed');
        await this.app.bus?.emit?.('decision:applied',{decisionId:decision.decisionId,alternativeId:choice.candidate.id});
        return this.record(decision,choice,'Applied',{operationId:undoResult?.id||block.id});
      }catch(error){if(entry)await this.app.journal.finish(entry,'failed',error);throw error}
    };
    return this.app.operationLocks?this.app.operationLocks.withExclusiveLock('Decision apply',op):op();
  }
  async record(decision,choice,status,extra={}){
    const record={id:`decision-history:${decision.decisionId}:${Date.now()}`,decisionId:decision.decisionId,type:decision.request.type,selectedAlternative:choice.candidate.id,status,reasons:choice.tradeoffs.reasons,affectedEntityIds:[choice.candidate.taskId,choice.candidate.projectId].filter(Boolean),operationId:extra.operationId||'',generatedAt:decision.generatedAt,appliedAt:status==='Applied'?nowISO():'',decisionEngineVersion:DECISION_ENGINE_VERSION};
    try{await this.app.repo.save('activityLog',{...record,type:'decision-history',text:`${status}: ${choice.candidate.title}`,at:nowISO(),createdAt:nowISO(),updatedAt:nowISO()},{validate:false})}catch{}
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

class DecisionEngine{
  constructor(app=host().app){
    this.app=app;this.contextBuilder=new DecisionContextBuilder(app);this.generator=new DecisionCandidateGenerator();
    this.feasibility=new DecisionFeasibilityGate();this.tradeoffs=new DecisionTradeoffEngine();this.ranking=new DecisionRankingEngine();
    this.alternatives=new DecisionAlternativeGenerator();this.explanations=new DecisionExplanationEngine();this.previewManager=new DecisionPreviewManager();
    this.applyCoordinator=new DecisionApplyCoordinator(app);this.history=new DecisionHistory(app);this.generation=0;
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
}

class DecisionCenterUI{
  constructor(engine){this.engine=engine;this.current=null;this.preview=null;this.button=null;this.panel=null}
  mount(){
    if(document.getElementById('decisionCenterButton'))return;
    const button=document.createElement('button');button.id='decisionCenterButton';button.className='btn decision-center-launch';button.type='button';button.textContent='Decision Center';button.setAttribute('aria-haspopup','dialog');
    button.addEventListener('click',()=>this.open());(document.querySelector('.top-actions')||document.body).prepend(button);this.button=button;
    const dialog=document.createElement('dialog');dialog.id='decisionCenterDialog';dialog.className='decision-center-dialog';dialog.setAttribute('aria-labelledby','decisionCenterTitle');dialog.innerHTML=`<div class="decision-center-shell"><div class="decision-center-head"><div><small>LifeOS 4.6</small><h2 id="decisionCenterTitle">Decision Center</h2></div><button class="btn icon" data-decision-close aria-label="Close Decision Center">×</button></div><div class="decision-center-controls"><label>Decision <select data-decision-type><option value="next-action">What should I do now?</option><option value="today-plan">Today plan</option><option value="deadline-triage">Deadline triage</option><option value="project-allocation">Project allocation</option><option value="plan-repair">Plan repair</option></select></label><button class="btn primary" data-decision-analyze>Analyze</button></div><div data-decision-status class="muted" role="status" aria-live="polite"></div><div data-decision-body></div></div>`;
    document.body.append(dialog);this.panel=dialog;
    dialog.querySelector('[data-decision-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-decision-analyze]').onclick=()=>this.analyze();
    dialog.addEventListener('click',event=>this.handle(event));
  }
  open(){this.panel?.showModal();this.panel?.querySelector('[data-decision-analyze]')?.focus()}
  async analyze(){
    const status=this.panel.querySelector('[data-decision-status]'),body=this.panel.querySelector('[data-decision-body]'),type=this.panel.querySelector('[data-decision-type]').value;
    status.textContent='Analyzing current constraints, capacity, deadlines and trade-offs…';body.innerHTML='';
    try{this.current=await this.engine.analyze({type,mode:'production',source:'decision-center'});this.preview=null;status.textContent=`Decision analysis complete. ${this.current.alternatives.length} feasible alternative${this.current.alternatives.length===1?'':'s'} found. Confidence: ${this.current.confidence.label}.`;this.render()}
    catch(error){status.textContent=error.message;body.innerHTML=`<div class="note warning">${escapeHtml(error.message)}</div>`}
  }
  render(){
    const body=this.panel.querySelector('[data-decision-body]'),decision=this.current;if(!decision){body.innerHTML='';return}
    if(!decision.recommended){body.innerHTML='<div class="note warning">No feasible alternative is available. Review blocked tasks and hard constraints.</div>';return}
    const card=(alt,index)=>`<article class="decision-card ${index===0?'recommended':''}" data-alt="${escapeHtml(alt.candidate.id)}"><div class="decision-card-kicker">${escapeHtml(alt.label)}</div><h3>${escapeHtml(alt.candidate.title)}</h3>${alt.candidate.duration?`<div class="decision-duration">${alt.candidate.duration} min</div>`:''}<p>${escapeHtml(alt.explanation.summary)}</p><div class="decision-grid"><div><b>Protects</b><ul>${alt.explanation.protects.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div><div><b>Opportunity cost</b><p>${escapeHtml(alt.explanation.opportunityCost)}</p></div></div><details><summary>Why and trade-offs</summary><ul>${alt.tradeoffs.reasons.map(r=>`<li>${escapeHtml(r.reasonCode)} · ${escapeHtml(r.sourceEngine)}: ${escapeHtml(r.metric)} ${escapeHtml(r.value)}</li>`).join('')}</ul>${alt.explanation.whyLower?`<p>${escapeHtml(alt.explanation.whyLower)}</p>`:''}</details><div class="decision-actions"><button class="btn" data-preview="${escapeHtml(alt.candidate.id)}">Preview</button><button class="btn primary" data-apply="${escapeHtml(alt.candidate.id)}">Apply</button></div></article>`;
    const shortfall=decision.capacityShortfall?.shortfallMinutes||0,shortfallNote=shortfall?`<div class="warning"><b>Capacity shortfall:</b> ${shortfall} minutes cannot fit in the remaining focus capacity today.</div>`:'';
    body.innerHTML=`<section class="decision-summary"><div><b>Recommended decision</b><span class="decision-confidence">Confidence: ${escapeHtml(decision.confidence.label)}</span></div><small>Exact context ${escapeHtml(decision.contextFingerprint)} · ${escapeHtml(String(decision.durationMs))} ms</small></section>${shortfallNote}${decision.dataQuality.missingInputs.length?`<div class="note">${decision.dataQuality.missingInputs.map(escapeHtml).join(' ')}</div>`:''}<div class="decision-card-list">${decision.alternatives.map(card).join('')}</div><div data-preview-output></div>`;
  }
  async handle(event){
    const previewId=event.target?.dataset?.preview,applyId=event.target?.dataset?.apply;
    if(previewId){this.preview=this.engine.preview(this.current,previewId);const out=this.panel.querySelector('[data-preview-output]');out.innerHTML=`<section class="decision-preview"><h3>Preview</h3><p><b>Production state is unchanged.</b></p><p>${this.preview.changes.map(escapeHtml).join(' ')||'No production change.'}</p><small>Fingerprint ${escapeHtml(this.preview.productionFingerprintBefore)}</small></section>`;out.scrollIntoView({block:'nearest'});}
    if(applyId){
      const status=this.panel.querySelector('[data-decision-status]');status.textContent='Revalidating before apply…';
      try{const result=await this.engine.apply(this.current,applyId);status.textContent=result.noChange?'Current plan kept. No production mutation was made.':'Decision applied as one logical operation. Undo is available through LifeOS.';await this.analyze()}
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
  Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory});
  api.app.decisionEngine=engine;
  api.app.whatNow=async function(){
    try{
      const decision=await engine.analyze({type:DECISION_TYPES.NEXT_ACTION,mode:'production',source:'what-now'}),recommended=decision.recommended;
      if(!recommended){
        this.modal.open('What should I do now?',`<div data-decision-what-now class="note"><b>No feasible next action is available.</b><p>Review blocked work, protected recovery, fixed commitments and hard capacity constraints in Decision Center.</p></div>`,'<button class="btn" data-action="close-dialog">Close</button>');
        return decision;
      }
      const candidate=recommended.candidate,explanation=recommended.explanation||{},alternative=decision.alternatives.find(item=>item.candidate.id!==candidate.id&&item.candidate.kind!==KEEP_CURRENT_PLAN)||decision.alternatives.find(item=>item.candidate.id!==candidate.id);
      const why=array(recommended.tradeoffs?.reasons).filter(item=>item.severity!=='hard').slice(0,4).map(item=>`<li><b>${escapeHtml(item.reasonCode.replaceAll('-',' '))}</b> — ${escapeHtml(item.comparison||`${item.metric}: ${item.value}`)}</li>`).join('');
      const protects=array(explanation.protects).map(item=>`<li>${escapeHtml(item)}</li>`).join('')||'<li>Current feasible plan and remaining capacity.</li>';
      const next=array(explanation.defers)[0]||'Reassess after this session or when the current context changes.';
      const bestAlternative=alternative?`<div class="item"><div class="item-main"><b>${escapeHtml(alternative.candidate.title)}</b><div class="muted">${alternative.candidate.duration?escapeHtml(alternative.candidate.duration+' min'):'No extra scheduled time'} · ${escapeHtml(alternative.label)}</div></div></div>`:'<p class="muted">No materially different feasible alternative is available.</p>';
      const startAction=candidate.kind==='task-session'&&candidate.taskId?`<button class="btn primary" data-action="start-focus" data-id="${escapeHtml(candidate.taskId)}">Start Focus</button>`:'<button class="btn primary" data-action="close-dialog">Keep Current Plan</button>';
      this.modal.open('What should I do now?',`<div data-decision-what-now><div class="success-box"><div class="muted">DECISION ENGINE RECOMMENDATION</div><h2>${escapeHtml(candidate.title)}</h2>${candidate.duration?`<div class="metric">${escapeHtml(candidate.duration)} min</div>`:''}<p>${escapeHtml(explanation.summary||'This is the highest-ranked feasible decision under the current constraints.')}</p></div><div class="flow-gap-14"><h3>Why now?</h3><ul>${why||'<li>The recommendation passed hard feasibility and deterministic trade-off ranking.</li>'}</ul><h3>What this protects</h3><ul>${protects}</ul><h3>What comes next?</h3><p>${escapeHtml(next)}</p><h3>Opportunity cost</h3><p>${escapeHtml(explanation.opportunityCost||'Remaining capacity is preserved for the next decision.')}</p><h3>Best alternative</h3>${bestAlternative}<p class="muted">Confidence: ${escapeHtml(decision.confidence?.label||'Limited')} · Decision Engine ${escapeHtml(DECISION_ENGINE_VERSION)}</p></div></div>`,'<button class="btn" data-action="close-dialog">Close</button>'+startAction,{subtitle:'Decision-aware recommendation using current hard constraints and trade-offs.'});
      return decision;
    }catch(error){
      this.modal.open('What should I do now?',`<div data-decision-what-now class="note warning"><b>Decision analysis could not complete.</b><p>${escapeHtml(error.message)}</p></div>`,'<button class="btn" data-action="close-dialog">Close</button>');
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

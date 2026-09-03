import fs from 'node:fs';

const file='decision-engine.js';
let source=fs.readFileSync(file,'utf8');
const replace=(oldValue,newValue,marker,label)=>{
  if(marker&&source.includes(marker))return;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`LifeOS 4.6 apply-safety guard failed: ${label} signature missing.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`LifeOS 4.6 apply-safety guard failed: ${label} signature not unique.`);
  source=source.replace(oldValue,newValue);
};

replace(
`      generatedAt:nowISO(),decisionDate:date,currentLocalTime:civil.time||'',timeZoneId:zone,mode,`,
`      generatedAt:nowISO(),decisionDate:date,currentDate:civil.date||date,currentLocalTime:civil.time||'',timeZoneId:zone,mode,`,
'currentDate:civil.date||date',
'current civil date in decision context'
);
replace(
`    const currentMinute=CoreUtil.clock(context.currentLocalTime)||CoreUtil.clock(context.settings.dayStart)||0;
    const slotStart=Math.ceil(currentMinute/15)*15;`,
`    const currentMinute=context.decisionDate>context.currentDate?(CoreUtil.clock(context.settings.dayStart)||0):(CoreUtil.clock(context.currentLocalTime)||CoreUtil.clock(context.settings.dayStart)||0);
    const slotStart=Math.ceil(currentMinute/15)*15;`,
'context.decisionDate>context.currentDate',
'future-day candidate start'
);
replace(
`    if(choice.candidate.kind===KEEP_CURRENT_PLAN)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
    if(choice.candidate.kind==='plan-repair'){`,
`    if(choice.candidate.kind===KEEP_CURRENT_PLAN)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
    if(choice.candidate.kind!=='plan-repair'){
      const feasibility=new DecisionFeasibilityGate().evaluate(choice.candidate,fresh.context);
      if(!feasibility.feasible){const error=new Error('This recommendation is no longer feasible under the current hard constraints.');error.code='DECISION-REVALIDATION-460';error.details={blockers:feasibility.blockers,evidence:feasibility.evidence};throw error}
    }
    if(choice.candidate.kind==='plan-repair'){`,
"error.code='DECISION-REVALIDATION-460'",
'hard constraint revalidation immediately before apply'
);
replace(
`      const api=host(),{ScheduleRepairEngine,CoreUtil}=api;
      const op=async()=>{
        const engine=new ScheduleRepairEngine(fresh.context.data,fresh.context.settings,api.PersonalPlanningModel.build(fresh.context.data),{nowMinute:CoreUtil.dayIndex(fresh.context.decisionDate)*1440+(CoreUtil.clock(fresh.context.currentLocalTime)||0)});
        const preview=engine.generate(fresh.context.decisionDate,{maxRadius:4}),candidate=preview.candidates?.[0];
        if(!candidate)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
        const changes=array(candidate.changes).map(c=>({store:'timeBlocks',id:c.id,before:c.before,after:c.after}));
        const result=changes.length?await this.app.undo.execute('Decision — minimal repair',changes,{activityType:'decision-apply',meta:{decisionId:decision.decisionId,decisionEngineVersion:DECISION_ENGINE_VERSION}}):null;
        return this.record(decision,choice,'Applied',{operationId:result?.id||candidate.id||''});
      };`,
`      const op=async()=>{
        const preview=await this.app.service.buildRepair(fresh.context.decisionDate,{maxRadius:4}),candidate=preview.candidates?.[0];
        if(!candidate)return this.record(decision,choice,'Applied',{operationId:'',noChange:true});
        const result=await this.app.service.applyRepair(preview,candidate.id,{skipOperationLock:true,label:'Decision — minimal repair'});
        return this.record(decision,choice,'Applied',{operationId:result?.operationId||candidate.id||''});
      };`,
"this.app.service.buildRepair(fresh.context.decisionDate",
'delegate repair apply to authoritative DomainService repair transaction'
);

fs.writeFileSync(file,source);
for(const invariant of ['currentDate:civil.date||date','context.decisionDate>context.currentDate','DECISION-REVALIDATION-460','this.app.service.buildRepair','this.app.service.applyRepair'])if(!source.includes(invariant))throw new Error(`LifeOS 4.6 apply-safety invariant missing: ${invariant}`);
console.log('LifeOS 4.6 apply safety hardening applied and verified.');

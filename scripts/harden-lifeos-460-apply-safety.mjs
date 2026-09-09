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
replace(
`        const undoResult=await this.app.undo.execute(\`Decision — \${choice.label||choice.candidate.title}\`,[change],{activityType:'decision-apply',meta:{decisionId:decision.decisionId,decisionEngineVersion:DECISION_ENGINE_VERSION,alternativeId:choice.candidate.id}});
        if(entry)await this.app.journal.finish(entry,'committed');`,
`        const undoResult=await this.app.undo.execute(\`Decision — \${choice.label||choice.candidate.title}\`,[change],{activityType:'decision-apply',meta:{decisionId:decision.decisionId,decisionEngineVersion:DECISION_ENGINE_VERSION,alternativeId:choice.candidate.id}});
        let persisted=null;
        for(let attempt=0;attempt<3&&!persisted;attempt++){
          persisted=await this.app.repo.get('timeBlocks',block.id);
          if(!persisted&&attempt<2)await CoreUtil.yield();
        }
        if(!persisted){const error=CoreUtil.error('DECISION-COMMIT-VISIBILITY-460','The accepted decision did not become durably readable after its atomic commit.',{decisionId:decision.decisionId,alternativeId:choice.candidate.id,timeBlockId:block.id});throw error}
        if(entry)await this.app.journal.finish(entry,'committed');`,
"DECISION-COMMIT-VISIBILITY-460",
'cross-browser post-commit durability verification'
);

fs.writeFileSync(file,source);
for(const invariant of ['currentDate:civil.date||date','context.decisionDate>context.currentDate','DECISION-REVALIDATION-460','this.app.service.buildRepair','this.app.service.applyRepair','DECISION-COMMIT-VISIBILITY-460'])if(!source.includes(invariant))throw new Error(`LifeOS 4.6 apply-safety invariant missing: ${invariant}`);

const appFile='app.js';
let app=fs.readFileSync(appFile,'utf8');
const replaceApp=(oldValue,newValue,marker,label)=>{
  if(marker&&app.includes(marker))return;
  const first=app.indexOf(oldValue);
  if(first<0)throw new Error(`LifeOS 4.6 repository-snapshot guard failed: ${label} signature missing.`);
  if(app.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`LifeOS 4.6 repository-snapshot guard failed: ${label} signature not unique.`);
  app=app.replace(oldValue,newValue);
};
replaceApp(
`    constructor(database,bus){this.db=database;this.bus=bus;this.cache=new Map();this.dataCache={};this.dataCacheAt=0;this.validationLogger=null;this.crossTab=null}`,
`    constructor(database,bus){this.db=database;this.bus=bus;this.cache=new Map();this.dataCache={};this.dataCacheAt=0;this.dataCacheGeneration=0;this.validationLogger=null;this.crossTab=null}`,
'dataCacheGeneration=0',
'repository dataset generation counter'
);
replaceApp(
`    invalidate(stores=[]){for(const store of stores){this.cache.delete(store);delete this.dataCache[store]}this.bus?.emit('data:changed',stores)}`,
`    invalidate(stores=[]){this.dataCacheGeneration+=1;for(const store of stores){this.cache.delete(store);delete this.dataCache[store]}this.bus?.emit('data:changed',stores)}`,
'this.dataCacheGeneration+=1',
'repository invalidation generation advance'
);
replaceApp(
`    async dataset({fresh=false}={}){const names=['tasks','events','projects','goals','lifeAreas','habits','timeBlocks','focusSessions','dailyCheckins','dailyReviews','weeklyReviews','notes','milestones','habitLogs','rules','dayProfiles','dayTemplates','activityLog'];if(fresh)this.dataCache={};for(const name of names)if(!Object.hasOwn(this.dataCache,name)){let rows=await this.all(name,{fresh});if(['tasks','events','projects','dayTemplates','rules'].includes(name))rows=rows.map(record=>DataValidator.safe(name,record,this.validationLogger)).filter(Boolean);this.dataCache[name]=rows}this.dataCacheAt=Date.now();return CoreUtil.clone(this.dataCache)}`,
`    async dataset({fresh=false}={}){const names=['tasks','events','projects','goals','lifeAreas','habits','timeBlocks','focusSessions','dailyCheckins','dailyReviews','weeklyReviews','notes','milestones','habitLogs','rules','dayProfiles','dayTemplates','activityLog'];for(let attempt=0;attempt<3;attempt++){const generation=this.dataCacheGeneration,snapshot=fresh?{}:CoreUtil.clone(this.dataCache);for(const name of names)if(!Object.hasOwn(snapshot,name)){let rows=await this.all(name,{fresh});if(['tasks','events','projects','dayTemplates','rules'].includes(name))rows=rows.map(record=>DataValidator.safe(name,record,this.validationLogger)).filter(Boolean);snapshot[name]=rows}if(generation===this.dataCacheGeneration){this.dataCache=CoreUtil.clone(snapshot);this.dataCacheAt=Date.now();return CoreUtil.clone(snapshot)}fresh=true;await CoreUtil.yield()}throw CoreUtil.error('DATASET-CONCURRENT-460','Planning data changed repeatedly while LifeOS was building a coherent dataset snapshot. Please retry.',{generation:this.dataCacheGeneration})}`,
'DATASET-CONCURRENT-460',
'coherent repository dataset snapshot under concurrent invalidation'
);
fs.writeFileSync(appFile,app);
for(const invariant of ['dataCacheGeneration=0','this.dataCacheGeneration+=1','DATASET-CONCURRENT-460'])if(!app.includes(invariant))throw new Error(`LifeOS 4.6 repository snapshot invariant missing: ${invariant}`);

console.log('LifeOS 4.6 apply safety and coherent repository snapshot hardening applied and verified.');

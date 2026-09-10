import fs from 'node:fs';

const VERSION='4.6.2';
const read=file=>fs.readFileSync(file,'utf8');
const write=(file,value)=>fs.writeFileSync(file,value);
const fragment=name=>read(`scripts/decision-462/${name}`).trimEnd();
const swap=(source,from,to,label)=>{
  if(source.includes(to))return source;
  if(!source.includes(from))throw new Error(`4.6.2 upgrade failed: ${label}`);
  return source.replace(from,to);
};
const replaceClass=(source,name,nextName,replacement)=>{
  const start=source.indexOf(`class ${name}{`),end=source.indexOf(`\nclass ${nextName}{`,start);
  if(start<0||end<0)throw new Error(`4.6.2 upgrade could not locate class ${name}`);
  return source.slice(0,start)+replacement+'\n'+source.slice(end+1);
};
const replaceSpan=(source,startMarker,endMarker,replacement)=>{
  const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
  if(start<0||end<0)throw new Error(`4.6.2 upgrade could not locate span ${startMarker}`);
  return source.slice(0,start)+replacement+source.slice(end);
};

let app=read('app.js');
app=swap(app,"const APP_VERSION='4.6.1';","const APP_VERSION='4.6.2';",'APP_VERSION');
app=swap(app,"const DECISION_ENGINE_VERSION='4.6.1';","const DECISION_ENGINE_VERSION='4.6.2';",'DECISION_ENGINE_VERSION in app');
app=swap(app,"const BUILD_NAME='Professional Core · Decision Planning Completion';","const BUILD_NAME='Professional Core · Master-Spec Certification Completion';",'build name');
write('app.js',app);

let sw=read('service-worker.js');
sw=swap(sw,"const APP_VERSION = '4.6.1';","const APP_VERSION = '4.6.2';",'service worker version');
write('service-worker.js',sw);

let manifest=read('manifest.webmanifest');
manifest=swap(manifest,'"name": "LifeOS 4.6.1 — Decision Planning Completion"','"name": "LifeOS 4.6.2 — Master-Spec Certification Completion"','manifest name');
manifest=swap(manifest,'"short_name": "LifeOS 4.6.1"','"short_name": "LifeOS 4.6.2"','manifest short name');
write('manifest.webmanifest',manifest);

let index=read('index.html');
index=swap(index,'<title>LifeOS 4.6.1 — Decision Planning Completion</title>','<title>LifeOS 4.6.2 — Master-Spec Certification Completion</title>','document title');
write('index.html',index);

let decision=read('decision-engine.js');
decision=swap(decision,"const DECISION_ENGINE_VERSION='4.6.1';","const DECISION_ENGINE_VERSION='4.6.2';",'Decision Engine version');
if(!decision.includes("const DECISION_MASTER_SPEC_MARKER='4.6.2';"))decision=swap(decision,"const DECISION_COMPLETION_MARKER='4.6.1';","const DECISION_COMPLETION_MARKER='4.6.1';\nconst DECISION_MASTER_SPEC_MARKER='4.6.2';",'master-spec marker');

decision=replaceClass(decision,'DecisionPreviewManager','DecisionApplyCoordinator',fragment('preview.js.txt'));
decision=swap(decision,"constructor(app=host().app){this.app=app}\n  async revalidate(decision)","constructor(app=host().app,outcomes=null){this.app=app;this.outcomes=outcomes}\n  async revalidate(decision)",'Apply coordinator outcome injection');
decision=replaceSpan(decision,"  async record(decision,choice,status,extra={}){","\n}\nclass DecisionHistory{",fragment('record-method.js.txt'));

if(!decision.includes('class DecisionOutcomeEngine{')){
  const insertion=fragment('p1-engines.js.txt')+'\n\n'+fragment('selftest-extension.js.txt')+'\n\n';
  decision=decision.replace('\nclass DecisionEngine{','\n'+insertion+'class DecisionEngine{');
}
decision=swap(decision,"this.applyCoordinator=new DecisionApplyCoordinator(app);this.history=new DecisionHistory(app);this.generation=0;","this.outcomes=new DecisionOutcomeEngine(app);this.applyCoordinator=new DecisionApplyCoordinator(app,this.outcomes);this.history=new DecisionHistory(app);this.briefs=new DecisionBriefEngine(this,app,this.outcomes);this.generation=0;",'Decision P1 engines');
decision=swap(decision,"  apply(decision,alternativeId){return this.applyCoordinator.apply(decision,alternativeId)}\n}","  apply(decision,alternativeId){return this.applyCoordinator.apply(decision,alternativeId)}\n  morningBrief(date){return this.briefs.morning(date)}\n  endOfDayReview(date){return this.briefs.endOfDay(date)}\n  recordOutcome(decisionId,outcome,notes=''){return this.outcomes.record(decisionId,outcome,notes)}\n}",'Decision Engine P1 methods');

decision=replaceSpan(decision,'class DecisionCenterUI{','\nfunction expose(){',fragment('ui.js.txt')+'\n');
decision=swap(decision,"Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory});","Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory,DecisionOutcomeEngine,DecisionBriefEngine,DecisionSelfTestExtension});",'public master-spec exports');
decision=swap(decision,"api.app.decisionEngine=engine;","api.app.decisionEngine=engine;api.app.decisionOutcome=engine.outcomes;api.app.decisionBrief=engine.briefs;extendDecisionSelfTests(api);",'Decision P1 app exports');
decision=decision.replaceAll('data-decision-what-now-evidence="4.6.1"','data-decision-what-now-evidence="4.6.2"');
write('decision-engine.js',decision);

let css=read('app.css');
const cssMarker='/* LifeOS 4.6.2 Master-Spec Decision completion */';
if(!css.includes(cssMarker))css+=`\n\n${cssMarker}
.decision-brief-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}
.decision-choice{display:flex;gap:8px;align-items:center;font-weight:800;margin-bottom:8px}
.decision-choice input{width:18px;height:18px}
.decision-preview-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.decision-preview-compare,.decision-preview-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.decision-preview-panel{border:1px solid var(--line,#cbd5e1);border-radius:12px;padding:12px;background:var(--surface,#fff)}
.decision-preview-panel h4{margin:0 0 8px;letter-spacing:.06em}
.decision-block-list{margin:8px 0;padding-left:20px}
.decision-undo{display:flex;justify-content:flex-end;margin-top:12px}
.decision-brief{margin-top:12px}
.decision-follow-up{border-top:1px solid var(--line,#cbd5e1);padding:12px 0}
@media (max-width:700px){.decision-preview-compare,.decision-preview-metrics{grid-template-columns:1fr}}
`;
write('app.css',css);

for(const [file,marker] of [['app.js',"const APP_VERSION='4.6.2';"],['decision-engine.js',"const DECISION_MASTER_SPEC_MARKER='4.6.2';"],['service-worker.js',"const APP_VERSION = '4.6.2';"]])if(!read(file).includes(marker))throw new Error(`4.6.2 marker missing after generation: ${file}`);
console.log('LifeOS 4.6.2 master-spec upgrade applied from auditable source fragments.');

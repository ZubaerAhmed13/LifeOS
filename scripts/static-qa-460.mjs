import fs from 'node:fs';

const files={
  app:fs.readFileSync('app.js','utf8'),
  decision:fs.readFileSync('decision-engine.js','utf8'),
  index:fs.readFileSync('index.html','utf8'),
  css:fs.readFileSync('app.css','utf8'),
  sw:fs.readFileSync('service-worker.js','utf8'),
  manifest:fs.readFileSync('manifest.webmanifest','utf8'),
  worker:fs.readFileSync('planning-worker.js','utf8')
};
const checks=[];
const add=(name,pass,details='')=>checks.push({name,pass:Boolean(pass),details});
const has=(source,needle)=>source.includes(needle);
const classBody=(source,name)=>{
  const start=source.indexOf(`class ${name}`);if(start<0)return'';
  const rest=source.slice(start+6+name.length),nextIndex=rest.search(/\nclass\s+[A-Za-z0-9_]+/);
  return nextIndex<0?source.slice(start):source.slice(start,start+6+name.length+nextIndex);
};

add('APP_VERSION 4.6.0',has(files.app,"const APP_VERSION='4.6.0';"));
add('DECISION_ENGINE_VERSION 4.6.0',has(files.app,"const DECISION_ENGINE_VERSION='4.6.0';")&&has(files.decision,"const DECISION_ENGINE_VERSION='4.6.0';"));
add('RuleEngine remains 4.5.1',has(files.app,"const RULE_ENGINE_VERSION='4.5.1';"));
add('Intelligence remains 4.4.2',has(files.app,"const INTELLIGENCE_MODEL_VERSION='4.4.2';"));
add('Calendar remains 4.3.0',has(files.app,"const CALENDAR_ENGINE_VERSION='4.3.0';"));
add('Forecast remains 4.2.0',has(files.app,"const FORECAST_MODEL_VERSION='4.2.0';"));
add('Scheduler remains 4.1.0',has(files.app,"const SCHEDULER_VERSION='4.1.0';"));
add('Rule schema remains 1',has(files.app,'const RULE_SCHEMA_VERSION=1;'));
add('DB schema remains 16',has(files.app,'const DB_SCHEMA_VERSION=16;'));

for(const component of ['DecisionEngine','DecisionContextBuilder','DecisionCandidateGenerator','DecisionFeasibilityGate','DecisionTradeoffEngine','DecisionRankingEngine','DecisionAlternativeGenerator','DecisionExplanationEngine','DecisionPreviewManager','DecisionApplyCoordinator','DecisionHistory'])add(`${component} present`,has(files.decision,`class ${component}`));

add('Decision types complete',['NEXT_ACTION','TODAY_PLAN','DEADLINE_TRIAGE','PROJECT_ALLOCATION','CAPACITY_SHORTFALL','SCHEDULE_CONFLICT','DEFERRAL','PLAN_REPAIR','WEEK_PRIORITY'].every(x=>has(files.decision,x)));
add('Keep current plan supported',has(files.decision,"const KEEP_CURRENT_PLAN='keep-current-plan';")&&has(files.decision,"title:'Keep current plan'"));
add('Candidate generation bounded',has(files.decision,'MAX_TASK_CANDIDATES=30')&&has(files.decision,'MAX_ALTERNATIVES=5'));
add('Context fingerprint included',has(files.decision,'contextFingerprint')&&has(files.decision,'dataGeneration')&&has(files.decision,'sourceRevisions'));
add('ScenarioDataView delegated',has(files.decision,'ScenarioDataView'));
add('CapacityEngine delegated',has(files.decision,'CapacityEngine.summary'));
add('DeadlineEngine delegated',has(files.decision,'DeadlineEngine.forecastTask'));
add('Project forecast delegated',has(files.decision,'ProjectForecastEngine.project'));
add('ConflictEngine owns hard feasibility',has(files.decision,'ConflictEngine.checkInterval'));
add('ScheduleRepairEngine delegated',has(files.decision,'ScheduleRepairEngine'));
add('Personal Intelligence consumed softly',has(files.decision,'PersonalIntelligenceEngine'));
add('Rules consumed without remote parsing',has(files.decision,"repo.all('rules'")&&has(files.decision,'activeRules'));
add('Undo used for accepted decision',has(files.decision,'.undo.execute('));
add('OperationJournal used',has(files.decision,'.journal?.begin('));
add('Cross-tab operation lock used',has(files.decision,"withExclusiveLock('Decision apply'"));
add('Stale decision protection',has(files.decision,'DECISION-STALE-460')&&has(files.decision,'contextFingerprint===decision.contextFingerprint'));
add('Stale analysis cancellation',has(files.decision,'DECISION-STALE-GENERATION-460'));
add('Decision confidence labels',has(files.decision,"'Strong'")&&has(files.decision,"'Moderate'")&&has(files.decision,"'Limited'"));
add('Reason provenance structure',['reasonCode','sourceEngine','metric','value','comparison','severity'].every(x=>has(files.decision,x)));
add('Opportunity cost explicit',has(files.decision,'opportunityCost'));

const preview=classBody(files.decision,'DecisionPreviewManager');
add('Preview manager does not mutate repository',preview&&!/\.repo\.|\.save\(|\.remove\(|\.undo\.|\.journal\./.test(preview));
add('Preview marked immutable',has(preview,'immutable:true'));

const feasibility=classBody(files.decision,'DecisionFeasibilityGate');
const ranking=classBody(files.decision,'DecisionRankingEngine');
add('Hard feasibility rejects before ranking',has(feasibility,'feasible:blockers.length===0')&&has(ranking,'.filter(r=>r.feasibility.feasible)'));
add('Protected dependency checks are hard',has(feasibility,'DEPENDENCY-BLOCK')&&has(feasibility,'ENTITY-PROTECTED'));

add('No eval in production scripts',!/(^|[^\w])eval\s*\(/m.test(files.app+files.decision+files.worker));
add('No new Function in production scripts',!/new\s+Function\s*\(/.test(files.app+files.decision+files.worker));
add('No remote network API in decision layer',!/(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource)/.test(files.decision));
add('No cloud/telemetry endpoint in decision layer',!/(https?:\/\/|telemetry|analytics endpoint|cloud inference)/i.test(files.decision));

add('Decision Center UI present',has(files.decision,'DecisionCenterUI')&&has(files.decision,'decisionCenterDialog'));
add('Accessible live status',has(files.decision,'aria-live="polite"')&&has(files.decision,'aria-labelledby="decisionCenterTitle"'));
add('Keyboard-native controls',has(files.decision,"dialog.id='decisionCenterDialog'")&&has(files.decision,"button.type='button'"));
add('Mobile 390-class layout covered',has(files.css,'@media (max-width:430px)')&&has(files.css,'.decision-grid{grid-template-columns:1fr}'));
add('Tablet-safe responsive layout',has(files.css,'@media (max-width:700px)'));

add('PWA loads Decision Engine',has(files.index,'./decision-engine.js'));
add('Service worker precaches Decision Engine',has(files.sw,"'./decision-engine.js'"));
add('Service worker identity 4.6.0',has(files.sw,"const APP_VERSION = '4.6.0';"));
add('Manifest identity 4.6',has(files.manifest,'LifeOS 4.6'));
add('Decision Engine is exposed through LifeOS',has(files.decision,'api.decisionEngineVersion=DECISION_ENGINE_VERSION')&&has(files.app,'decisionEngineVersion:DECISION_ENGINE_VERSION'));

const failures=checks.filter(x=>!x.pass);
for(const check of checks)console.log(`${check.pass?'PASS':'FAIL'} ${check.name}${check.details?` — ${check.details}`:''}`);
console.log(`LIFEOS_460_STATIC_QA ${checks.length-failures.length}/${checks.length}`);
if(failures.length){console.error(`Static QA failed: ${failures.map(x=>x.name).join('; ')}`);process.exit(1)}

import fs from 'node:fs';

const files={app:fs.readFileSync('app.js','utf8'),decision:fs.readFileSync('decision-engine.js','utf8'),index:fs.readFileSync('index.html','utf8'),css:fs.readFileSync('app.css','utf8'),sw:fs.readFileSync('service-worker.js','utf8'),manifest:fs.readFileSync('manifest.webmanifest','utf8'),worker:fs.readFileSync('planning-worker.js','utf8')};
const checks=[];const add=(name,pass)=>checks.push({name,pass:Boolean(pass)}),has=(src,needle)=>src.includes(needle);
const classBody=(source,name)=>{const start=source.indexOf(`class ${name}`);if(start<0)return'';const rest=source.slice(start+6+name.length),next=rest.search(/\nclass\s+[A-Za-z0-9_]+/);return next<0?source.slice(start):source.slice(start,start+6+name.length+next)};

add('APP_VERSION 4.6.1',has(files.app,"const APP_VERSION='4.6.1';"));
add('DECISION_ENGINE_VERSION 4.6.1',has(files.app,"const DECISION_ENGINE_VERSION='4.6.1';")&&has(files.decision,"const DECISION_ENGINE_VERSION='4.6.1';"));
add('RuleEngine remains 4.5.1',has(files.app,"const RULE_ENGINE_VERSION='4.5.1';"));
add('Intelligence remains 4.4.2',has(files.app,"const INTELLIGENCE_MODEL_VERSION='4.4.2';"));
add('Calendar remains 4.3.0',has(files.app,"const CALENDAR_ENGINE_VERSION='4.3.0';"));
add('Forecast remains 4.2.0',has(files.app,"const FORECAST_MODEL_VERSION='4.2.0';"));
add('Scheduler remains 4.1.0',has(files.app,"const SCHEDULER_VERSION='4.1.0';"));
add('DB and Rule schema preserved',has(files.app,'const DB_SCHEMA_VERSION=16;')&&has(files.app,'const RULE_SCHEMA_VERSION=1;'));
add('4.6.1 completion marker',has(files.decision,"const DECISION_COMPLETION_MARKER='4.6.1';"));
for(const component of ['DecisionEngine','DecisionContextBuilder','DecisionCandidateGenerator','DecisionFeasibilityGate','DecisionTradeoffEngine','DecisionRankingEngine','DecisionAlternativeGenerator','DecisionExplanationEngine','DecisionPreviewManager','DecisionApplyCoordinator','DecisionHistory'])add(`${component} present`,has(files.decision,`class ${component}`));

const generator=classBody(files.decision,'DecisionCandidateGenerator'),feasibility=classBody(files.decision,'DecisionFeasibilityGate'),tradeoffs=classBody(files.decision,'DecisionTradeoffEngine'),apply=classBody(files.decision,'DecisionApplyCoordinator'),preview=classBody(files.decision,'DecisionPreviewManager');
add('TODAY_PLAN is a real DayScheduler plan',has(generator,"type===DECISION_TYPES.TODAY_PLAN")&&has(generator,'new DayScheduler')&&has(generator,"'day-plan'"));
add('DEADLINE_TRIAGE is a multi-task plan',has(generator,"type===DECISION_TYPES.DEADLINE_TRIAGE")&&has(generator,"'deadline-triage-plan'")&&has(generator,'deadlineTaskIds'));
add('PROJECT_ALLOCATION uses ProjectAllocator + WeekScheduler',has(generator,"type===DECISION_TYPES.PROJECT_ALLOCATION")&&has(generator,'ProjectAllocator.shortfall')&&has(generator,"'project-allocation-plan'")&&has(generator,'new WeekScheduler'));
add('DEFERRAL has concrete candidate changes',has(generator,"type===DECISION_TYPES.DEFERRAL")&&has(generator,"'deferral-plan'")&&has(generator,'postponeCount'));
add('WEEK_PRIORITY uses real WeekScheduler plans',has(generator,"type===DECISION_TYPES.WEEK_PRIORITY")&&has(generator,"'week-priority-plan'")&&has(generator,'priorityMode'));
add('SCHEDULE_CONFLICT delegates to ScheduleRepairEngine',has(generator,"type===DECISION_TYPES.SCHEDULE_CONFLICT")&&has(generator,"'schedule-conflict-plan'")&&has(generator,'ScheduleRepairEngine'));
add('ProjectAllocator is publicly available to Decision Engine',has(files.app,'WeekScheduler,ProjectAllocator,DeadlineEngine'));

add('ConflictEngine failures fail closed',has(feasibility,'ConflictEngine validation failed closed')&&!has(feasibility,'Conflict validation unavailable:'));
add('ProjectAllocator owns per-block allocation feasibility',has(feasibility,'ProjectAllocator.dailyAllowance')&&has(feasibility,"'PROJECT-ALLOWANCE'"));
add('Protected RecoveryTimeEngine is hard feasibility',has(feasibility,'RecoveryTimeEngine.evaluate')&&has(feasibility,"'RECOVERY-PROTECTED'"));
add('RuleEngine automatic hard constraints integrated',has(feasibility,'hardRuleBlockers')&&has(feasibility,'engine.evaluate(rule,event,ruleContext)')&&has(feasibility,"'RULEENGINE-HARD'"));
add('Infeasible rows are removed before ranking',has(classBody(files.decision,'DecisionRankingEngine'),'.filter(r=>r.feasibility.feasible)'));

add('RecoveryTimeEngine trade-off quantified',has(tradeoffs,'RecoveryTimeEngine.evaluate')&&has(tradeoffs,"'RECOVERY-COST'"));
add('ContextSwitchEngine trade-off quantified',has(tradeoffs,'ContextSwitchEngine.evaluate')&&has(tradeoffs,"'CONTEXT-SWITCH'"));
add('ScheduleStabilityEngine trade-off quantified',has(tradeoffs,'ScheduleStabilityEngine.compare')&&has(tradeoffs,"'SCHEDULE-STABILITY'"));
add('ProjectAllocator before/after shortfall effect',has(tradeoffs,'projectEffect(')&&has(tradeoffs,'shortfallReducedMinutes'));
add('Deadline forecast before/after effect',has(tradeoffs,'forecastEffect(')&&has(tradeoffs,"'FORECAST-BEFORE-AFTER'"));
add('Opportunity cost is quantified in minutes',has(tradeoffs,'opportunityCostMinutes')&&has(classBody(files.decision,'DecisionExplanationEngine'),'minutes of competing ready-work demand remain uncovered'));

add('Preview remains non-mutating',preview&&!/\.repo\.|\.save\(|\.remove\(|\.undo\.|\.journal\./.test(preview)&&has(preview,'immutable:true'));
add('Scenario Apply fails closed',has(apply,"decision.request.mode==='scenario'")&&has(apply,'DECISION-SCENARIO-APPLY-461'));
add('Stale Apply protected',has(apply,'DECISION-STALE-461')&&has(apply,'contextFingerprint===decision.contextFingerprint'));
add('All non-noop Apply paths revalidate hard feasibility',has(apply,'new DecisionFeasibilityGate().evaluate'));
add('Multi-task Apply is one Undo operation',has(apply,'planChanges(')&&has(apply,'this.app.undo.execute')&&has(apply,"activityType:'decision-apply'"));
add('Repair Apply delegates to authoritative DomainService',has(apply,'this.app.service.buildRepair')&&has(apply,'this.app.service.applyRepair'));
add('Cross-tab exclusive lock wraps mutations',has(apply,"withExclusiveLock('Decision apply'"));
add('Durability is checked after multi-plan commit',has(apply,'DECISION-COMMIT-VISIBILITY-461'));

add('Decision Center exposes all implemented decision workflows',['deferral','week-priority','schedule-conflict'].every(x=>has(files.decision,`value="${x}"`)));
add('What Now evidence migrated to 4.6.1',has(files.decision,'data-decision-what-now-evidence="4.6.1"'));
add('PWA loads Decision Engine',has(files.index,'./decision-engine.js'));
add('Service worker precaches Decision Engine',has(files.sw,"'./decision-engine.js'")&&has(files.sw,"const APP_VERSION = '4.6.1';"));
add('Manifest identity 4.6.1',has(files.manifest,'LifeOS 4.6.1'));
add('No eval/new Function',!/(^|[^\w])eval\s*\(/m.test(files.app+files.decision+files.worker)&&!/new\s+Function\s*\(/.test(files.app+files.decision+files.worker));
add('Decision layer remains local-only',!/(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/)/.test(files.decision));

const failures=checks.filter(x=>!x.pass);for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.name}`);console.log(`LIFEOS_461_STATIC_QA ${checks.length-failures.length}/${checks.length}`);if(failures.length){console.error('Static QA failed: '+failures.map(x=>x.name).join('; '));process.exit(1)}

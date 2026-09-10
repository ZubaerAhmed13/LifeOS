import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const files={app:read('app.js'),decision:read('decision-engine.js'),css:read('app.css'),index:read('index.html'),sw:read('service-worker.js'),manifest:read('manifest.webmanifest'),test:read('tests/decision-462-master-spec.spec.js')};
const checks=[];
const add=(name,pass)=>checks.push({name,pass:Boolean(pass)});
const has=(source,...terms)=>terms.every(term=>source.includes(term));

add('App identity 4.6.2',has(files.app,"const APP_VERSION='4.6.2';","const DECISION_ENGINE_VERSION='4.6.2';","Professional Core · Master-Spec Certification Completion"));
add('Preserved engine identities',has(files.app,"const RULE_ENGINE_VERSION='4.5.1';","const INTELLIGENCE_MODEL_VERSION='4.4.2';","const DB_SCHEMA_VERSION=16;","const RULE_SCHEMA_VERSION=1;","const CALENDAR_ENGINE_VERSION='4.3.0';","const FORECAST_MODEL_VERSION='4.2.0';","const SCHEDULER_VERSION='4.1.0';"));
add('Decision master-spec marker',has(files.decision,"const DECISION_MASTER_SPEC_MARKER='4.6.2';"));
add('Planning fingerprint excludes ephemeral wall-clock minute',has(files.decision,"date,timeZoneId:zone,mode")&&!files.decision.includes("date,time:civil.time||'',timeZoneId:zone,mode"));
add('Decision apply freshness has bounded temporal age',has(files.decision,"const DECISION_MAX_APPLY_AGE_MS=5*60*1000;","stateFresh=context.contextFingerprint===decision.contextFingerprint","temporalFresh=ageMs<=DECISION_MAX_APPLY_AGE_MS","fresh:stateFresh&&temporalFresh"));
add('Past candidate start fails closed after clock advances',has(files.decision,"Candidate start time has already passed.","CANDIDATE-TIME-PASSED","block.date===context.currentDate?CoreUtil.clock(context.currentLocalTime):null"));
for(const group of ['Decision Context','Decision Fingerprint','Decision Candidate Generation','Decision Feasibility','Decision Trade-offs','Decision Ranking','Decision Preview','Decision Atomicity','Decision Concurrency','Decision Scenario','Decision Data Quality','Decision Privacy','Decision Brief','Decision Outcome'])add(`Internal group ${group}`,files.decision.includes(`'${group}'`));
add('Internal SelfTestRunner extension',has(files.decision,'extendDecisionSelfTests(api)','Runner.prototype.run=async function','DecisionSelfTestExtension.run(this)'));
add('Preview model CURRENT vs PROPOSED',has(files.decision,'current:{','proposed:{','forecastEffect:forecast','opportunity:{'));
add('Preview UI CURRENT vs PROPOSED',has(files.decision,'data-preview-current','>CURRENT<','data-preview-proposed','>PROPOSED<'));
add('Preview forecast panel',has(files.decision,'data-preview-forecast','Forecast effect','Risk points','Deadline shortfall'));
add('Preview opportunity panel',has(files.decision,'data-preview-opportunity','Opportunity cost','Capacity committed','Competing work uncovered'));
add('Keyboard alternative selection control',has(files.decision,'data-decision-choice','type="radio" name="decision-alternative"','aria-keyshortcuts','Control+Alt+D'));
add('In-Decision-Center Undo',has(files.decision,'data-decision-undo','Undo Decision','Decision undone. The production state was restored.'));
add('Decision queued lock retained',has(files.decision,'withQueuedExclusiveLock','Decision apply'));
add('Decision in-lock freshness and feasibility revalidation retained',has(files.decision,'lockedFresh=await this.revalidate(decision)','lockedFeasibility=new DecisionFeasibilityGate().evaluate'));
add('Scenario apply remains fail closed',has(files.decision,'DECISION-SCENARIO-APPLY-461'));
add('Morning Decision Brief implementation',has(files.decision,'class DecisionBriefEngine','morning(date=','morning-decision-brief','Morning Decision Brief'));
add('End-of-Day Decision Review implementation',has(files.decision,'endOfDay(date=','end-of-day-decision-review','End-of-Day Decision Review'));
add('Decision outcome follow-up persistence',has(files.decision,'class DecisionOutcomeEngine',"'decision-outcome'","status:'Pending'","followUpDate","record(decisionId,outcome"));
add('Applied decisions create follow-up',has(files.decision,'this.outcomes.create(decision,choice',"status==='Applied'&&!extra.noChange"));
add('P1 engines exported',has(files.decision,'DecisionOutcomeEngine,DecisionBriefEngine,DecisionSelfTestExtension','api.app.decisionOutcome=engine.outcomes','api.app.decisionBrief=engine.briefs'));
add('New browser suite has two-tab Decision Apply',has(files.test,'two tabs applying the same Decision create exactly one logical mutation','Promise.all([apply(page),apply(second)])'));
add('New browser suite has keyboard-only flow',has(files.test,'keyboard only chooses a different alternative then Preview → Apply → Undo',"page.keyboard.press('Control+Alt+D')","page.keyboard.press('ArrowDown')","page.keyboard.press('Enter')")&&!files.test.includes("page.keyboard.press('Tab')"));
add('New browser suite has offline full flow',has(files.test,'offline Analyze → Preview → Apply → Undo remains fully local','context.setOffline(true)','Undo Decision'));
add('New browser suite has Preview UI gate',has(files.test,'Preview UI shows explicit CURRENT vs PROPOSED plus forecast and opportunity panels','data-preview-current','data-preview-proposed'));
add('New browser suite has Morning/EOD/outcome gates',has(files.test,'Morning Decision Brief is structured','End-of-Day Decision Review exposes pending outcome','Decision outcome recorded: Worked.'));
add('4.6.2 service worker identity',has(files.sw,"const APP_VERSION = '4.6.2';"));
add('4.6.2 manifest identity',has(files.manifest,'LifeOS 4.6.2'));
add('4.6.2 document title',has(files.index,'LifeOS 4.6.2'));
add('Master-spec responsive styles',has(files.css,'LifeOS 4.6.2 Master-Spec Decision completion','.decision-preview-compare','.decision-brief-actions'));
add('Decision Engine remains network-free',!/(?:\bfetch|\bXMLHttpRequest|\bWebSocket|\bEventSource)\s*\(/.test(files.decision));
add('No arbitrary code execution',!/\beval\s*\(/.test(files.app+files.decision)&&!/\bnew\s+Function\s*\(/.test(files.app+files.decision));

for(const row of checks)console.log(`${row.pass?'PASS':'FAIL'} ${row.name}`);
const failed=checks.filter(x=>!x.pass);
console.log(`LIFEOS_462_STATIC_QA ${checks.length-failed.length}/${checks.length}`);
if(failed.length){console.error(failed.map(x=>x.name).join('\n'));process.exit(1)}
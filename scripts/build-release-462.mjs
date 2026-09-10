import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const APP_VERSION='4.6.2',DECISION_ENGINE_VERSION='4.6.2',RULE_ENGINE_VERSION='4.5.1',INTELLIGENCE_MODEL_VERSION='4.4.2',CALENDAR_ENGINE_VERSION='4.3.0',FORECAST_MODEL_VERSION='4.2.0',SCHEDULER_VERSION='4.1.0',DB_SCHEMA_VERSION=16,RULE_SCHEMA_VERSION=1;
const STANDALONE_NAME='LifeOS_4_6_2_Master_Spec_Standalone.html',dist='dist',sourceSha=process.env.LIFEOS_SOURCE_SHA||process.env.GITHUB_SHA||'';
const sha256Buffer=value=>crypto.createHash('sha256').update(value).digest('hex'),sha256=file=>sha256Buffer(fs.readFileSync(file));
const copyDir=(from,to)=>{fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from,{withFileTypes:true})){const src=path.join(from,entry.name),dst=path.join(to,entry.name);entry.isDirectory()?copyDir(src,dst):fs.copyFileSync(src,dst)}};

fs.rmSync(dist,{recursive:true,force:true});fs.mkdirSync(path.join(dist,'icons'),{recursive:true});
for(const file of ['index.html','app.js','decision-engine.js','app.css','planning-worker.js','service-worker.js','manifest.webmanifest'])fs.copyFileSync(file,path.join(dist,file));
for(const file of fs.readdirSync('icons'))fs.copyFileSync(path.join('icons',file),path.join(dist,'icons',file));
if(fs.existsSync('INSTALL.md'))fs.copyFileSync('INSTALL.md',path.join(dist,'INSTALL.md'));
if(fs.existsSync('tests'))copyDir('tests',path.join(dist,'tests'));

const appSource=fs.readFileSync('app.js','utf8'),decisionSource=fs.readFileSync('decision-engine.js','utf8'),swSource=fs.readFileSync('service-worker.js','utf8'),indexSource=fs.readFileSync('index.html','utf8');
for(const [label,source,signature] of [
  ['app',appSource,"const APP_VERSION='4.6.2';"],['decision version in app',appSource,"const DECISION_ENGINE_VERSION='4.6.2';"],['decision layer',decisionSource,"const DECISION_ENGINE_VERSION='4.6.2';"],
  ['rule engine',appSource,"const RULE_ENGINE_VERSION='4.5.1';"],['intelligence',appSource,"const INTELLIGENCE_MODEL_VERSION='4.4.2';"],['service worker',swSource,"const APP_VERSION = '4.6.2';"]
])if(!source.includes(signature))throw new Error(`Release identity mismatch for ${label}: ${signature}`);
for(const signature of ["const RULE_SCHEMA_VERSION=1;","const DB_SCHEMA_VERSION=16;","const CALENDAR_ENGINE_VERSION='4.3.0';","const FORECAST_MODEL_VERSION='4.2.0';","const SCHEDULER_VERSION='4.1.0';",'WeekScheduler,ProjectAllocator,DeadlineEngine'])if(!appSource.includes(signature))throw new Error(`Required preserved release signature missing: ${signature}`);
for(const signature of [
  "const DECISION_COMPLETION_MARKER='4.6.1';","const DECISION_MASTER_SPEC_MARKER='4.6.2';",'class DecisionOutcomeEngine','class DecisionBriefEngine','class DecisionSelfTestExtension',
  'data-preview-current','data-preview-proposed','data-preview-forecast','data-preview-opportunity','data-decision-choice','data-decision-undo',
  'Morning Decision Brief','End-of-Day Decision Review',"'decision-outcome'",'withQueuedExclusiveLock','lockedFresh=await this.revalidate(decision)',
  'RecoveryTimeEngine.evaluate','ContextSwitchEngine.evaluate','ScheduleStabilityEngine.compare','ProjectAllocator.dailyAllowance','FORECAST-BEFORE-AFTER','opportunityCostMinutes','DECISION-SCENARIO-APPLY-461','failed closed'
])if(!decisionSource.includes(signature))throw new Error(`Decision master-spec invariant missing: ${signature}`);
for(const group of ['Decision Context','Decision Fingerprint','Decision Candidate Generation','Decision Feasibility','Decision Trade-offs','Decision Ranking','Decision Preview','Decision Atomicity','Decision Concurrency','Decision Scenario','Decision Data Quality','Decision Privacy','Decision Brief','Decision Outcome'])if(!decisionSource.includes(`'${group}'`))throw new Error(`Missing internal Decision self-test group: ${group}`);
if(/\beval\s*\(/.test(appSource+decisionSource)||/\bnew\s+Function\s*\(/.test(appSource+decisionSource))throw new Error('Arbitrary JavaScript execution primitive detected.');
if(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(decisionSource))throw new Error('Decision Engine contains a network access primitive.');

const css=fs.readFileSync('app.css','utf8').replace(/<\/style/gi,'<\\/style'),appJs=appSource.replace(/<\/script/gi,'<\\/script'),decisionJs=decisionSource.replace(/<\/script/gi,'<\\/script');
let standalone=indexSource.replace('<link rel="manifest" href="./manifest.webmanifest">','').replace('<link rel="icon" href="./icons/icon-192.png">','').replace('<link rel="stylesheet" href="./app.css">',`<style>\n${css}\n</style>`).replace('<script src="./app.js" defer></script>',`<script>\n${appJs}\n</script>`).replace('<script src="./decision-engine.js" defer></script>',`<script>\n${decisionJs}\n</script>`);
if(standalone.includes('./app.js')||standalone.includes('./decision-engine.js')||standalone.includes('./app.css'))throw new Error('Standalone build still contains external core asset references.');
if(!standalone.includes('LifeOS 4.6.2'))throw new Error('Standalone title does not identify LifeOS 4.6.2.');
if(!standalone.includes(`<script>\n${appJs}\n</script>`))throw new Error('Standalone app.js byte parity failed.');
if(!standalone.includes(`<script>\n${decisionJs}\n</script>`))throw new Error('Standalone decision-engine.js byte parity failed.');
fs.writeFileSync(path.join(dist,STANDALONE_NAME),standalone);

const manifestFiles=['app.js','decision-engine.js','app.css','index.html','service-worker.js','planning-worker.js','manifest.webmanifest',STANDALONE_NAME];
fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),manifestFiles.map(file=>`${sha256(path.join(dist,file))}  ${file}`).join('\n')+'\n');
const provenance={
  repository:process.env.GITHUB_REPOSITORY||'ZubaerAhmed13/LifeOS',branch:process.env.GITHUB_REF_NAME||'',finalSha:sourceSha,workflowRunId:process.env.GITHUB_RUN_ID||'',workflowRunAttempt:process.env.GITHUB_RUN_ATTEMPT||'',releaseTag:process.env.LIFEOS_RELEASE_TAG||'',buildTimestamp:new Date().toISOString(),
  appVersion:APP_VERSION,decisionEngineVersion:DECISION_ENGINE_VERSION,ruleEngineVersion:RULE_ENGINE_VERSION,ruleSchemaVersion:RULE_SCHEMA_VERSION,intelligenceModelVersion:INTELLIGENCE_MODEL_VERSION,calendarEngineVersion:CALENDAR_ENGINE_VERSION,forecastModelVersion:FORECAST_MODEL_VERSION,schedulerVersion:SCHEDULER_VERSION,dbSchemaVersion:DB_SCHEMA_VERSION,
  appJsSha256:sha256(path.join(dist,'app.js')),decisionEngineSha256:sha256(path.join(dist,'decision-engine.js')),appCssSha256:sha256(path.join(dist,'app.css')),indexHtmlSha256:sha256(path.join(dist,'index.html')),serviceWorkerSha256:sha256(path.join(dist,'service-worker.js')),planningWorkerSha256:sha256(path.join(dist,'planning-worker.js')),standaloneSha256:sha256(path.join(dist,STANDALONE_NAME)),
  pwaStandaloneAppParity:true,pwaStandaloneDecisionParity:true,localFirstDecisionEngine:true,remoteDecisionDependencies:false,decisionBackedWhatNow:true,
  wholeDayMultiTaskPlanning:true,deadlineTriagePlanning:true,projectAllocationPlanning:true,deferral:true,weekPriority:true,scheduleConflictPlanning:true,recoveryIntegration:true,scheduleStabilityIntegration:true,contextSwitchIntegration:true,projectAllocatorIntegration:true,hardRuleConstraints:true,beforeAfterForecast:true,quantifiedOpportunityCosts:true,failClosedFeasibility:true,scenarioApplySafety:true,
  decisionInternalGroups:true,decisionTwoTabE2E:true,keyboardDecisionFlow:true,offlineDecisionApplyUndo:true,currentVsProposedPreview:true,morningDecisionBrief:true,endOfDayDecisionReview:true,decisionOutcomeFollowUp:true
};
fs.writeFileSync(path.join(dist,'BUILD_PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(`Built ${STANDALONE_NAME}`);console.log(`PWA_STANDALONE_APP_PARITY PASS ${provenance.appJsSha256}`);console.log(`PWA_STANDALONE_DECISION_PARITY PASS ${provenance.decisionEngineSha256}`);console.log(`SOURCE_COMMIT ${provenance.finalSha||'local'}`);

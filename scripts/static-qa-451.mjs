import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync('app.js','utf8');
const sw=fs.readFileSync('service-worker.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('planning-worker.js','utf8');
const checks=[];
const add=(name,pass)=>checks.push({name,pass:Boolean(pass)});
const has=value=>app.includes(value);

for(const [name,signature] of [
  ['app version 4.5.1',"const APP_VERSION='4.5.1';"],['rule engine version 4.5.1',"const RULE_ENGINE_VERSION='4.5.1';"],['rule schema 1','const RULE_SCHEMA_VERSION=1;'],['db schema 16','const DB_SCHEMA_VERSION=16;'],['intelligence 4.4.2',"const INTELLIGENCE_MODEL_VERSION='4.4.2';"],['calendar 4.3.0',"const CALENDAR_ENGINE_VERSION='4.3.0';"],['forecast 4.2.0',"const FORECAST_MODEL_VERSION='4.2.0';"],['scheduler 4.1.0',"const SCHEDULER_VERSION='4.1.0';"],['patch build name','Final Automation Completion']
])add(name,has(signature));

add('trigger producer registry',has('const RULE_TRIGGER_PRODUCERS=Object.freeze({'));
add('action executor registry',has('const RULE_ACTION_EXECUTORS=Object.freeze({'));
add('planning preference registry',has('const RULE_PLANNING_PREFERENCES=Object.freeze({'));
for(const trigger of ['planning-refresh','schedule-generated','schedule-repaired','day-changed','capacity-recalculated','project-weekly-shortfall'])add(`producer ${trigger}`,has(`'${trigger}':`));
for(const action of ['run-minimal-repair','create-suggested-task','planning-preference'])add(`executor ${action}`,has(`'${action}':`));
add('civil-day lifecycle active',has("evaluateCivilDay('timer')")&&has("visibilitychange"));
add('civil-day lifecycle cleanup',has("removeEventListener?.('visibilitychange'"));
add('configured-zone rule context',has("civil=TimeZoneEngine.parts(Date.now(),settings.timeZoneId"));
add('bounded operation settlement',has('RULE-OPERATION-WAIT-019'));
add('rule save waits for lifecycle queue',has("async save(rule){const saved=await this.repo.save('rules',DataValidator.rule(rule));await this.processing;return saved}"));
add('rule dry-run waits for lifecycle queue',has("async testRule(rule,event,{data=null,settings=null,mode='dry-run'}={}){await this.processing;"));
add('capacity lifecycle',has('evaluateCapacityChanges(stores,dates,lineage=null)'));
add('project shortfall lifecycle',has('evaluateProjectShortfalls(stores,dates,lineage=null)'));
add('planning refresh lifecycle',has('emitPlanningRefresh(stores,dates,lineage=null'));
add('real day schedule-generated producer',has("schedule-generated:'+committed.operationId"));
add('real repair producer',has("repairReason:'manual-repair'"));
add('repair delegates to DomainService',has('RULE-REPAIR-EXECUTOR-018')&&has('this.service.applyRepair('));
add('repair stale fingerprint check',has("REPAIR-STALE-001"));
add('repair high-impact standalone guard',has('Minimal schedule repair must be reviewed as a standalone high-impact mutation.'));
add('suggested-task provenance',has('automationProvenance:{dedupeKey'));
add('planning preference settings mutation',has("p.settingKey==='taskTypePreferredBefore'"));
add('preference settings validation',has('SETTINGS-DEEP-WORK-004')&&has('SETTINGS-PREFERRED-BEFORE-005'));
add('deep work scheduler preference active',has('deepTiming=task.workMode'));
add('task-type preferred-before scheduler preference active',has('preferredTiming=preferredCutoff'));
add('logical preference conflict identity',has("planning.preference:'+(action.params.preferenceKey"));
add('settings included in stale approvals',has("affected.type==='settings'"));
add('approval preview describes actions',has('ruleActionPreview(action)'));
add('new internal registry tests',has("'Rule Registry Coverage'"));
add('new internal trigger wiring tests',has("'Rule Trigger Wiring'"));
add('new internal action coverage tests',has("'Rule Action Coverage'"));
add('4.5.1 internal tests invoked',has('runRule451Tests(repo)'));
add('registry exports visible',has('RULE_TRIGGER_PRODUCERS,RULE_ACTION_EXECUTORS,RULE_PLANNING_PREFERENCES'));

add('no eval calls',!/\beval\s*\(/.test(app));
add('no Function constructor',!/\bnew\s+Function\s*\(/.test(app));
add('strict app mode',app.startsWith("'use strict';"));
add('strict service worker mode',sw.startsWith("'use strict';"));
add('service worker 4.5.1',sw.includes("const APP_VERSION = '4.5.1';"));
add('index 4.5.1 identity',index.includes('LifeOS 4.5.1'));
add('local CSP retained',index.includes("default-src 'self' data: blob:")&&index.includes("connect-src 'self'"));
add('planning worker retained',worker.includes('LifeOSCompute'));
add('closed-browser limitation retained',has('Rules run while LifeOS is active or at the next supported refresh'));
add('evidence cohort correction retained',has('comparison-specific eligible dated cohort')&&has('maximumStratumWeight'));

try{new vm.Script(app,{filename:'app.js'});add('app.js parses',true)}catch{add('app.js parses',false)}
try{new vm.Script(sw,{filename:'service-worker.js'});add('service-worker.js parses',true)}catch{add('service-worker.js parses',false)}
try{new vm.Script(worker,{filename:'planning-worker.js'});add('planning-worker.js parses',true)}catch{add('planning-worker.js parses',false)}

const failed=checks.filter(x=>!x.pass);
for(const check of checks)console.log(`${check.pass?'PASS':'FAIL'}  ${check.name}`);
console.log(`STATIC_QA_451 ${checks.length-failed.length}/${checks.length} PASS`);
if(failed.length){console.error(`STATIC_QA_451_FAILED ${failed.length}: ${failed.map(x=>x.name).join(' | ')}`);process.exit(1)}

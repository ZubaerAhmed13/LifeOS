import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync('app.js', 'utf8');
const sw = fs.readFileSync('service-worker.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const manifest = fs.readFileSync('manifest.webmanifest', 'utf8');
const worker = fs.readFileSync('planning-worker.js', 'utf8');

const checks = [];
const add = (name, pass) => checks.push({ name, pass: Boolean(pass) });
const has = value => app.includes(value);

// Release identity and preserved certified engines.
add('app version 4.5.0', has("const APP_VERSION='4.5.0';"));
add('rule engine version 4.5.0', has("const RULE_ENGINE_VERSION='4.5.0';"));
add('rule schema version 1', has('const RULE_SCHEMA_VERSION=1;'));
add('intelligence model remains 4.4.2', has("const INTELLIGENCE_MODEL_VERSION='4.4.2';"));
add('intelligence thresholds remain 4.4.2', has("version:'4.4.2',earlySamples:3"));
add('database schema remains 16', has('const DB_SCHEMA_VERSION=16;'));
add('scheduler remains 4.1.0', has("const SCHEDULER_VERSION='4.1.0';"));
add('forecast remains 4.2.0', has("const FORECAST_MODEL_VERSION='4.2.0';"));
add('calendar remains 4.3.0', has("const CALENDAR_ENGINE_VERSION='4.3.0';"));
add('build name identifies Rules Automation', has("BUILD_NAME='Professional Core · Rules, Automation & Planning Policies'"));

// Security / local-first constraints.
add('no eval calls', !/\beval\s*\(/.test(app));
add('no Function constructor', !/\bnew\s+Function\s*\(/.test(app));
add('strict mode retained', app.startsWith("'use strict';"));
add('no Zapier integration', !/zapier/i.test(app));
add('no IFTTT integration', !/ifttt/i.test(app));
add('no Slack automation integration', !/slack\s+automation/i.test(app));
add('no remote AI rule dependency', !/remote\s+ai/i.test(app));
add('no arbitrary JavaScript rule action', !/javascript-rule|script-action|execute-script/i.test(app));
add('rules remain local wording', has('Deterministic local rules'));
add('closed-browser limitation disclosed', has('Rules run while LifeOS is active or at the next supported refresh'));

// Rule architecture.
add('RuleEngine present', has('class RuleEngine{'));
add('trigger registry present', has('const RULE_TRIGGERS=Object.freeze('));
add('condition registry present', has('const RULE_CONDITIONS=Object.freeze('));
add('operator registry present', has('const RULE_OPERATORS=Object.freeze('));
add('action registry present', has('const RULE_ACTIONS=Object.freeze('));
add('template registry present', has('const RULE_TEMPLATES=Object.freeze('));
add('risk registry present', has('const RULE_ACTION_RISK=Object.freeze(') || has("risk:'LOW'"));
add('maximum chain depth bounded', has('MAX_RULE_CHAIN_DEPTH=5'));
add('history retention bounded', has('RULE_HISTORY_LIMIT=250'));
add('event memory bounded', has('RULE_EVENT_MEMORY_LIMIT=250'));
add('rules use existing rules store', has("repo.all('rules'"));
add('no automationRules store', !has('automationRules'));
add('no rulesV2 store', !has('rulesV2'));
add('DataValidator rule validation present', has('static rule(record)'));
add('DataValidator dispatches rules', has("if(store==='rules')return this.rule(record)"));
add('IntegrityEngine validates rule references', has('RuleIntegrity') || has('INTEGRITY-RULE'));
add('RuleEngine indexes by trigger', has('this.index=new Map()') && has('this.index.get(rule.trigger.type)'));
add('stable event identity present', has('eventId'));
add('event lineage fields present', has('sourceRuleExecutionId') && has('chainDepth'));
add('self retrigger protection present', has('sourceRuleId') && has('sourceRuleExecutionId'));
add('cycle/chain protection present', has('MAX_RULE_CHAIN_DEPTH'));
add('duplicate event memory present', has('RULE_EVENT_MEMORY_LIMIT'));
add('cross-tab exclusive lock integration present', has('operationLocks.withExclusiveLock'));
add('stale revision expected-revision integration present', has('expectedRevisions'));
add('UndoManager execution integration present', has('undo.execute('));
add('OperationJournal integration present', has('journal.begin(') && has('journal.finish('));
add('atomic multi-action path present', has('executePlan('));
add('dry run testRule present', has('testRule('));
add('dry run production hash invariant present', has('productionChanges'));
add('conflict resolution present', has('resolveConflicts('));
add('priority sorting deterministic', has('b.priority-a.priority'));
add('stable ID tie break present', has('String(a.id).localeCompare(String(b.id))'));
add('notification dedupe present', has('notificationDedupe') || has('dedupe'));
add('audit history bounded', has('RULE_HISTORY_LIMIT'));
add('rule templates install visible rule', has('installTemplate('));
add('intelligence suggestion requires confirmation UI', has('confirmInsightRule'));
add('intelligence provenance fields present', has('sourceInsightId') && has('createdFromEvidenceAt'));
add('What Now semantic action present', has("'surface-what-now'"));
add('attention action present', has("'set-attention'"));
add('schedule repair action present', has('schedule-repair'));
add('scenario rule mode present', has("mode='scenario'") || has("mode:'scenario'") || has('ScenarioDataView'));
add('planning policy support present', has("'planning-preference'"));

// Rule UI / accessibility / mobile.
add('Rules navigation item present', has("id:'rules',label:'Rules & Automation'"));
add('Rules workspace renderer present', has('async renderRules()'));
add('guided Rule Builder present', has('async openRule(record={})'));
add('Rule Builder uses fieldset', has('<fieldset><legend>1. Name</legend>'));
add('Rule Builder Test Rule button present', has('data-action=\\"test-rule-form\\"') || has('data-action="test-rule-form"'));
add('Rule Builder aria-live result present', has('data-rule-test-inline aria-live=\\"polite\\"') || has('data-rule-test-inline aria-live="polite"'));
add('Rule Builder supports ALL and ANY', has('ALL conditions') && has('ANY condition'));
add('execution policy Automatic present', has('>Automatic</option>'));
add('execution policy Ask present', has('Ask before applying'));
add('execution policy Suggestion present', has('Suggestion only'));
add('priority input bounded 0-100', has('name=\\"priority\\" min=\\"0\\" max=\\"100\\"') || has('name="priority" min="0" max="100"'));
add('rule search present', has('id=\\"ruleSearch\\"') || has('id="ruleSearch"'));
add('rule filters present', has('Needs attention') && has('Recently triggered') && has('From Intelligence'));
add('bulk rule controls present', has('bulk-rules-enable') && has('bulk-rules-disable') && has('bulk-rules-delete'));
add('rule duplicate present', has('duplicate-rule'));
add('rule enable disable present', has('rule-toggle'));
add('rule history present', has('rule-history'));
add('mobile responsive CSS rule present', /@media[^\{]*\(max-width:\s*820px\)/.test(fs.readFileSync('app.css','utf8')));

// All rendered data-actions should have an onClick case except passive/handled non-click controls.
const actionValues = new Set([...app.matchAll(/data-action=\\?"([^"\\]+)\\?"/g)].map(match => match[1]));
const switchActions = new Set([...app.matchAll(/case'([^']+)'/g)].map(match => match[1]));
const allowedExternal = new Set([]);
const unwired = [...actionValues].filter(action => !switchActions.has(action) && !allowedExternal.has(action));
add(`all data-actions wired (${unwired.length ? unwired.join(', ') : 'none missing'})`, unwired.length === 0);

// Preserve LifeOS 4.4.1 evidence correctness and architecture.
add('paired association candidates are included rows', has('includedRows:comparisonRows,eligibleRows:comparisonRows'));
add('paired source-field count disclosed', has('fieldAvailable:usableRows.length'));
add('paired comparison count disclosed', has('comparedSamples:comparisonRows.length'));
add('paired exclusions disclosed', has('excludedFromComparison:excludedComparisonRows'));
add('stale usableRows evidence path removed', !has('includedRows:usableRows,eligibleRows,dataset,values:association.candidates'));
add('postponement comparison-specific cohort present', has('comparisonEligibleRows=eligibleRows===null?rows:CoreUtil.array(eligibleRows)'));
add('stale global postponement denominator removed', !has('includedRows:rows,eligibleRows:attempts,dataset:null'));
add('completion association candidate cohort present', has('includedRows:completionAssociation.candidates,eligibleRows:completionAssociation.candidates'));
add('evidence invariant source comment present', has('records that are available but do not participate in A-vs-B'));
add('postponement method explains comparison cohort', has('comparison-specific eligible dated cohort'));
add('Energy 3/3/14 internal regression retained', has("Evidence Comparison Cohorts','Energy 3/3/14 uses six comparison participants"));
add('Energy medium invariance retained', has("Evidence Comparison Cohorts','Energy medium-band observations are invariant"));
add('Context unknown regression retained', has("Evidence Comparison Cohorts','unknown Context records do not inflate comparison evidence"));
add('Recovery unknown regression retained', has("Evidence Comparison Cohorts','unknown Recovery records do not inflate comparison evidence"));
add('Postponement 100 Admin regression retained', has("Evidence Comparison Cohorts','Career time-window evidence ignores 100 unrelated Admin attempts"));
add('Postponement 500 unrelated regression retained', has("Evidence Comparison Cohorts','Career time-window evidence ignores 500 unrelated observations"));
add('Load middle-band regression retained', has("Evidence Comparison Cohorts','planned-load middle band does not inflate A-vs-B evidence"));
add('Simpson reversal guard retained', has('simpsonReversal'));
add('mixed-category guard retained', has('mixedCategory'));
add('bounded stratum weight retained', has('maximumStratumWeight'));
add('legacy cumulative postponement limitation retained', has('cumulative-only legacy'));

for (const symbol of [
  'IntelligenceStatistics','IntelligenceConfidenceEngine','IntelligenceDatasetBuilder','PersonalIntelligenceEngine','PersonalBaselineEngine','StratifiedAssociationEngine',
  'PersonalPlanningModel','ExplanationEngine','RecoveryTimeEngine','ContextSwitchEngine','ScheduleStabilityEngine','CapacityEngine','DeadlineEngine','ScenarioEngine',
  'MonteCarloEngine','CalendarInteractionEngine','Repository','Database','IntegrityEngine','MigrationManager','BackupManager','SnapshotManager','UndoManager','OperationJournal',
  'CrossTabCoordinator','OperationLockManager','ComputeManager','PWAController','SelfTestRunner','DayScheduler','WeekScheduler','ScheduleRepairEngine','ConflictEngine'
]) add(`architecture retained: ${symbol}`, has(`class ${symbol}`) || has(`${symbol}={`) || has(`${symbol} =`));

// Internal rule tests and performance fixtures.
add('internal Rule 4.5 test suite present', has('runRule450Tests(repo)'));
for (const group of ['Rule Schema','Rule Trigger','Rule Conditions','Rule Actions','Rule Dry Run','Rule Safety','Rule Conflict Resolution','Rule Loop Prevention','Rule Atomic Execution','Rule Undo','Rule Concurrency','Rule Audit','Rule Notifications','Planning Policies','Rule Intelligence Integration','Rule Scenario Integration','Rule Backup','Rule Integrity','Rule Accessibility','Rule Privacy']) add(`internal group present: ${group}`, has(`'${group}'`));
add('100-rule performance fixture present', has('100') && has('Rule Performance'));
add('500-rule performance fixture present', has('500') && has('Rule Performance'));
add('1000-rule performance fixture present', has('1000') && has('Rule Performance'));

// PWA / shell / CSP.
add('planning worker protocol retained', worker.includes('LifeOSCompute'));
add('service worker strict mode', sw.startsWith("'use strict';"));
add('service worker app version 4.5.0', sw.includes("const APP_VERSION = '4.5.0';"));
add('service worker cache build pwa1', sw.includes("const CACHE_BUILD = 'pwa1';"));
add('service worker caches index', sw.includes("'./index.html'"));
add('service worker caches app.css', sw.includes("'./app.css'"));
add('service worker caches app.js', sw.includes("'./app.js'"));
add('service worker caches planning worker', sw.includes("'./planning-worker.js'"));
add('service worker caches manifest', sw.includes("'./manifest.webmanifest'"));
add('service worker caches 192 icon', sw.includes("'./icons/icon-192.png'"));
add('service worker caches 512 icon', sw.includes("'./icons/icon-512.png'"));
add('service worker caches maskable icon', sw.includes("'./icons/icon-maskable-512.png'"));
add('service worker excludes cross-origin fetches', sw.includes('url.origin !== self.location.origin'));
add('service worker preserves local IndexedDB statement', sw.includes('IndexedDB user records are intentionally never copied'));
add('index title is LifeOS 4.5', /<title>LifeOS 4\.5/.test(index));
add('index manifest linked', index.includes('rel="manifest" href="./manifest.webmanifest"'));
add('index CSP default self', index.includes("default-src 'self' data: blob:"));
add('index CSP connect self', index.includes("connect-src 'self'"));
add('index CSP object none', index.includes("object-src 'none'"));
add('index CSP base none', index.includes("base-uri 'none'"));
add('index app script local', index.includes('<script src="./app.js" defer></script>'));
add('index app css local', index.includes('<link rel="stylesheet" href="./app.css">'));
add('index skip link retained', index.includes('Skip to main content'));
add('index aria-live polite retained', index.includes('aria-live="polite"'));
add('manifest is valid JSON', (() => { try { JSON.parse(manifest); return true; } catch { return false; } })());
add('manifest references 192 icon', manifest.includes('icon-192.png'));
add('manifest references 512 icon', manifest.includes('icon-512.png'));
add('manifest references maskable icon', manifest.includes('icon-maskable-512.png'));

// Global exports / no source regression.
add('LifeOS global export retained', has('globalThis.LifeOS={app:lifeOS'));
add('rule engine version exported', has('ruleEngineVersion:RULE_ENGINE_VERSION'));
add('RuleEngine exported', has('RuleEngine,RULE_TRIGGERS,RULE_CONDITIONS,RULE_ACTIONS,RULE_TEMPLATES'));
add('intelligence model export retained', has('intelligenceModelVersion:INTELLIGENCE_MODEL_VERSION'));
add('self-test export retained', has('SelfTestRunner};'));
add('DB schema not bumped to 17', !has('DB_SCHEMA_VERSION=17'));

try { new vm.Script(app, { filename: 'app.js' }); add('app.js parses as JavaScript', true); } catch { add('app.js parses as JavaScript', false); }
try { new vm.Script(sw, { filename: 'service-worker.js' }); add('service-worker.js parses as JavaScript', true); } catch { add('service-worker.js parses as JavaScript', false); }
try { new vm.Script(worker, { filename: 'planning-worker.js' }); add('planning-worker.js parses as JavaScript', true); } catch { add('planning-worker.js parses as JavaScript', false); }

const failed = checks.filter(check => !check.pass);
for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`);
console.log(`STATIC_QA ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) {
  console.error(`STATIC_QA_FAILED ${failed.length}: ${failed.map(x => x.name).join(' | ')}`);
  process.exit(1);
}

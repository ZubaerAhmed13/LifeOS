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

add('app version 4.4.1', has("const APP_VERSION='4.4.1';"));
add('intelligence model 4.4.2', has("const INTELLIGENCE_MODEL_VERSION='4.4.2';"));
add('intelligence thresholds 4.4.2', has("version:'4.4.2',earlySamples:3"));
add('database schema remains 16', has('const DB_SCHEMA_VERSION=16;'));
add('scheduler remains 4.1.0', has("const SCHEDULER_VERSION='4.1.0';"));
add('forecast remains 4.2.0', has("const FORECAST_MODEL_VERSION='4.2.0';"));
add('calendar remains 4.3.0', has("const CALENDAR_ENGINE_VERSION='4.3.0';"));
add('no eval calls', !/\beval\s*\(/.test(app));
add('no Function constructor', !/\bnew\s+Function\s*\(/.test(app));
add('strict mode retained', app.startsWith("'use strict';"));
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
add('Energy 3/3/14 internal regression present', has("Evidence Comparison Cohorts','Energy 3/3/14 uses six comparison participants"));
add('Energy medium invariance internal regression present', has("Evidence Comparison Cohorts','Energy medium-band observations are invariant"));
add('Context unknown internal regression present', has("Evidence Comparison Cohorts','unknown Context records do not inflate comparison evidence"));
add('Recovery unknown internal regression present', has("Evidence Comparison Cohorts','unknown Recovery records do not inflate comparison evidence"));
add('Postponement 100 Admin regression present', has("Evidence Comparison Cohorts','Career time-window evidence ignores 100 unrelated Admin attempts"));
add('Postponement 500 unrelated regression present', has("Evidence Comparison Cohorts','Career time-window evidence ignores 500 unrelated observations"));
add('Load middle-band regression present', has("Evidence Comparison Cohorts','planned-load middle band does not inflate A-vs-B evidence"));
add('retained dataset version assertion is 4.4.2', has("dataset.intelligenceModelVersion==='4.4.2'"));
add('retained analysis version assertion is 4.4.2', has("analysis.intelligenceModelVersion==='4.4.2'"));
add('retained Energy evidence assertion uses comparison cohort', has("Energy Stratification','comparison evidence excludes non-participants'"));

for (const symbol of [
  'IntelligenceStatistics','IntelligenceConfidenceEngine','IntelligenceDatasetBuilder','PersonalIntelligenceEngine','PersonalBaselineEngine','StratifiedAssociationEngine',
  'PersonalPlanningModel','ExplanationEngine','RecoveryTimeEngine','ContextSwitchEngine','ScheduleStabilityEngine','CapacityEngine','DeadlineEngine','ScenarioEngine',
  'MonteCarloEngine','CalendarInteractionEngine','Repository','Database','IntegrityEngine','MigrationManager','BackupManager','SnapshotManager','UndoManager','OperationJournal',
  'CrossTabCoordinator','OperationLockManager','ComputeManager','PWAController','SelfTestRunner'
]) add(`architecture retained: ${symbol}`, has(`class ${symbol}`) || has(`${symbol}={`) || has(`${symbol} =`));

add('planning worker protocol retained', worker.includes('LifeOSCompute'));
add('service worker strict mode', sw.startsWith("'use strict';"));
add('service worker app version 4.4.1', sw.includes("const APP_VERSION = '4.4.1';"));
add('service worker cache build remains harness-compatible pwa1', sw.includes("const CACHE_BUILD = 'pwa1';"));
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
add('index title bumped', index.includes('<title>LifeOS 4.4.1 — Personal Intelligence</title>'));
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
add('LifeOS global export retained', has('globalThis.LifeOS={app:lifeOS'));
add('intelligence model export retained', has('intelligenceModelVersion:INTELLIGENCE_MODEL_VERSION'));
add('self-test export retained', has('SelfTestRunner};'));
add('postponement time window retained', has("'postponement-time-window'"));
add('postponement load retained', has("'postponement-load'"));
add('postponement project retained', has("'postponement-project'"));
add('postponement context retained', has("'postponement-context'"));
add('postponement day profile retained', has("'postponement-day-profile'"));
add('repeated postponement retained', has("'repeated-postponement'"));
add('Energy analysis retained', has("kind:'energy-pattern'"));
add('Context analysis retained', has("kind:'context-pattern'"));
add('Recovery analysis retained', has("kind:'recovery-pattern'"));
add('Simpson reversal guard retained', has('simpsonReversal'));
add('mixed-category guard retained', has('mixedCategory'));
add('bounded stratum weight retained', has('maximumStratumWeight'));
add('legacy cumulative postponement limitation retained', has('cumulative-only legacy'));
add('DB schema not bumped to 17', !has('DB_SCHEMA_VERSION=17'));

try { new vm.Script(app, { filename: 'app.js' }); add('app.js parses as JavaScript', true); } catch { add('app.js parses as JavaScript', false); }
try { new vm.Script(sw, { filename: 'service-worker.js' }); add('service-worker.js parses as JavaScript', true); } catch { add('service-worker.js parses as JavaScript', false); }
try { new vm.Script(worker, { filename: 'planning-worker.js' }); add('planning-worker.js parses as JavaScript', true); } catch { add('planning-worker.js parses as JavaScript', false); }

const failed = checks.filter(check => !check.pass);
for (const check of checks) console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}`);
console.log(`STATIC_QA ${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);

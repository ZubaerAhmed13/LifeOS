import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const APP_VERSION='4.5.1';
const RULE_ENGINE_VERSION='4.5.1';
const INTELLIGENCE_MODEL_VERSION='4.4.2';
const CALENDAR_ENGINE_VERSION='4.3.0';
const FORECAST_MODEL_VERSION='4.2.0';
const SCHEDULER_VERSION='4.1.0';
const DB_SCHEMA_VERSION=16;
const RULE_SCHEMA_VERSION=1;
const STANDALONE_NAME='LifeOS_4_5_1_Final_Automation_Completion_Standalone.html';
const dist='dist';
const sha256Buffer=value=>crypto.createHash('sha256').update(value).digest('hex');
const sha256=file=>sha256Buffer(fs.readFileSync(file));

fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(path.join(dist,'icons'),{recursive:true});
for(const file of ['index.html','app.js','app.css','planning-worker.js','service-worker.js','manifest.webmanifest'])fs.copyFileSync(file,path.join(dist,file));
for(const file of fs.readdirSync('icons'))fs.copyFileSync(path.join('icons',file),path.join(dist,'icons',file));
if(fs.existsSync('INSTALL.md'))fs.copyFileSync('INSTALL.md',path.join(dist,'INSTALL.md'));

const appSource=fs.readFileSync('app.js','utf8');
const swSource=fs.readFileSync('service-worker.js','utf8');
const indexSource=fs.readFileSync('index.html','utf8');
for(const [label,source,signature] of [
  ['app',appSource,"const APP_VERSION='4.5.1';"],
  ['rule engine',appSource,"const RULE_ENGINE_VERSION='4.5.1';"],
  ['intelligence',appSource,"const INTELLIGENCE_MODEL_VERSION='4.4.2';"],
  ['service worker',swSource,"const APP_VERSION = '4.5.1';"]
])if(!source.includes(signature))throw new Error(`Release identity mismatch for ${label}: ${signature}`);
for(const signature of ["const RULE_SCHEMA_VERSION=1;","const DB_SCHEMA_VERSION=16;","const CALENDAR_ENGINE_VERSION='4.3.0';","const FORECAST_MODEL_VERSION='4.2.0';","const SCHEDULER_VERSION='4.1.0';","const RULE_TRIGGER_PRODUCERS=Object.freeze({","const RULE_ACTION_EXECUTORS=Object.freeze({"])if(!appSource.includes(signature))throw new Error(`Required 4.5.1 release signature missing: ${signature}`);
if(/\beval\s*\(/.test(appSource)||/\bnew\s+Function\s*\(/.test(appSource))throw new Error('Arbitrary JavaScript execution primitive detected.');

const css=fs.readFileSync('app.css','utf8').replace(/<\/style/gi,'<\\/style');
const js=appSource.replace(/<\/script/gi,'<\\/script');
let standalone=indexSource
  .replace('<link rel="manifest" href="./manifest.webmanifest">','')
  .replace('<link rel="icon" href="./icons/icon-192.png">','')
  .replace('<link rel="stylesheet" href="./app.css">',`<style>\n${css}\n</style>`)
  .replace('<script src="./app.js" defer></script>',`<script>\n${js}\n</script>`);
if(standalone.includes('./app.js')||standalone.includes('./app.css'))throw new Error('Standalone build still contains external core asset references.');
if(!standalone.includes('LifeOS 4.5.1'))throw new Error('Standalone title does not identify LifeOS 4.5.1.');
fs.writeFileSync(path.join(dist,STANDALONE_NAME),standalone);

const embeddedStart=standalone.indexOf("'use strict';"),embeddedEnd=standalone.lastIndexOf('</script>');
if(embeddedStart<0||embeddedEnd<embeddedStart)throw new Error('Unable to locate embedded application source.');
const embedded=standalone.slice(embeddedStart,embeddedEnd).trimEnd();
const normalizedSource=appSource.trimEnd().replace(/<\/script/gi,'<\\/script');
const embeddedHash=sha256Buffer(embedded),sourceHash=sha256Buffer(normalizedSource);
if(embeddedHash!==sourceHash)throw new Error(`PWA/Standalone app.js parity failed: ${embeddedHash} != ${sourceHash}`);

const manifestFiles=['app.js','app.css','index.html','service-worker.js','planning-worker.js','manifest.webmanifest',STANDALONE_NAME];
fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),manifestFiles.map(file=>`${sha256(path.join(dist,file))}  ${file}`).join('\n')+'\n');
const provenance={
  repository:process.env.GITHUB_REPOSITORY||'ZubaerAhmed13/LifeOS',ref:process.env.GITHUB_REF_NAME||'',sourceCommit:process.env.GITHUB_SHA||'',workflowRunId:process.env.GITHUB_RUN_ID||'',workflowRunAttempt:process.env.GITHUB_RUN_ATTEMPT||'',builtAt:new Date().toISOString(),
  appVersion:APP_VERSION,ruleEngineVersion:RULE_ENGINE_VERSION,ruleSchemaVersion:RULE_SCHEMA_VERSION,intelligenceModelVersion:INTELLIGENCE_MODEL_VERSION,calendarEngineVersion:CALENDAR_ENGINE_VERSION,forecastModelVersion:FORECAST_MODEL_VERSION,schedulerVersion:SCHEDULER_VERSION,dbSchemaVersion:DB_SCHEMA_VERSION,
  appJsSha256:sha256(path.join(dist,'app.js')),appCssSha256:sha256(path.join(dist,'app.css')),indexHtmlSha256:sha256(path.join(dist,'index.html')),serviceWorkerSha256:sha256(path.join(dist,'service-worker.js')),planningWorkerSha256:sha256(path.join(dist,'planning-worker.js')),standaloneSha256:sha256(path.join(dist,STANDALONE_NAME)),standaloneEmbeddedAppSha256:embeddedHash,sourceNormalizedAppSha256:sourceHash,pwaStandaloneAppParity:true,localFirstRules:true,remoteAutomationDependencies:false,finalAutomationCompletion:true
};
fs.writeFileSync(path.join(dist,'BUILD_PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(`Built ${STANDALONE_NAME}`);
console.log(`PWA_STANDALONE_APP_PARITY PASS ${embeddedHash}`);
console.log(`SOURCE_COMMIT ${provenance.sourceCommit||'local'}`);

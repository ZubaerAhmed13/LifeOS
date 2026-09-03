import fs from 'node:fs';

const paths={app:'app.js',index:'index.html',css:'app.css',sw:'service-worker.js',manifest:'manifest.webmanifest'};
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,v)=>fs.writeFileSync(p,v);
let app=read(paths.app),index=read(paths.index),css=read(paths.css),sw=read(paths.sw),manifest=read(paths.manifest);

function replaceOnce(source,oldValue,newValue,label){
  if(source.includes(newValue))return source;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`LifeOS 4.6 patch guard failed: ${label} source signature missing.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`LifeOS 4.6 patch guard failed: ${label} source signature is not unique.`);
  return source.replace(oldValue,newValue);
}
function insertAfter(source,anchor,addition,marker,label){
  if(source.includes(marker))return source;
  const first=source.indexOf(anchor);
  if(first<0)throw new Error(`LifeOS 4.6 patch guard failed: ${label} anchor missing.`);
  if(source.indexOf(anchor,first+anchor.length)>=0)throw new Error(`LifeOS 4.6 patch guard failed: ${label} anchor is not unique.`);
  return source.slice(0,first+anchor.length)+addition+source.slice(first+anchor.length);
}

if(app.includes("const APP_VERSION='4.5.1';"))app=replaceOnce(app,"const APP_VERSION='4.5.1';","const APP_VERSION='4.6.0';",'app version');
else if(!app.includes("const APP_VERSION='4.6.0';"))throw new Error('Expected certified LifeOS 4.5.1 or already-patched 4.6.0 app source.');

app=insertAfter(app,"  const RULE_ENGINE_VERSION='4.5.1';","\n  const DECISION_ENGINE_VERSION='4.6.0';","const DECISION_ENGINE_VERSION='4.6.0';",'decision engine version');
app=replaceOnce(app,"  const BUILD_NAME='Professional Core · Final Automation Completion';","  const BUILD_NAME='Professional Core · Decision Engine, Goal Alignment & Adaptive Planning';",'build identity');
app=replaceOnce(
  app,
  "globalThis.LifeOS={app:lifeOS,ruleEngineVersion:RULE_ENGINE_VERSION,",
  "globalThis.LifeOS={app:lifeOS,decisionEngineVersion:DECISION_ENGINE_VERSION,ruleEngineVersion:RULE_ENGINE_VERSION,",
  'global decision-engine version export'
);

index=replaceOnce(index,'<title>LifeOS 4.5.1 — Final Automation Completion</title>','<title>LifeOS 4.6 — Decision Engine, Goal Alignment & Adaptive Planning</title>','document title');
index=replaceOnce(index,'<script src="./app.js" defer></script>','<script src="./app.js" defer></script>\n  <script src="./decision-engine.js" defer></script>','decision engine script load');

if(sw.includes("const APP_VERSION = '4.5.1';"))sw=replaceOnce(sw,"const APP_VERSION = '4.5.1';","const APP_VERSION = '4.6.0';",'service worker version');
else if(!sw.includes("const APP_VERSION = '4.6.0';"))throw new Error('Expected certified 4.5.1 or 4.6.0 service worker source.');
sw=insertAfter(sw,"  './app.js',","\n  './decision-engine.js',","'./decision-engine.js'","decision engine PWA precache");

manifest=replaceOnce(manifest,'"name": "LifeOS 4.5 — Rules, Automation & Planning Policies"','"name": "LifeOS 4.6 — Decision Engine, Goal Alignment & Adaptive Planning"','manifest name');
manifest=replaceOnce(manifest,'"short_name": "LifeOS 4.5"','"short_name": "LifeOS 4.6"','manifest short name');
manifest=replaceOnce(
  manifest,
  '"description": "A local-first personal operating system with transparent pattern learning, confidence-aware insights, adaptive planning, professional calendar workflows and offline-first data safety."',
  '"description": "A local-first personal operating system with deterministic decision support, goal alignment, adaptive planning, transparent trade-offs, professional calendar workflows and offline-first data safety."',
  'manifest description'
);

const marker='/* LifeOS 4.6 Decision Center */';
if(!css.includes(marker)){
css+=`\n\n${marker}
.decision-center-launch{white-space:nowrap}
.decision-center-dialog{width:min(980px,calc(100vw - 28px));max-height:min(92vh,920px);padding:0;border:1px solid var(--line,#d8dee9);border-radius:18px;background:var(--panel,#fff);color:var(--text,#172033)}
.decision-center-dialog::backdrop{background:rgba(15,23,42,.52);backdrop-filter:blur(3px)}
.decision-center-shell{display:grid;gap:16px;padding:20px}
.decision-center-head,.decision-center-controls,.decision-summary>div,.decision-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.decision-center-head h2{margin:2px 0 0}.decision-center-head small,.decision-card-kicker{font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#667085)}
.decision-center-controls{flex-wrap:wrap;padding:12px;border:1px solid var(--line,#d8dee9);border-radius:14px;background:var(--surface-2,#f8fafc)}
.decision-center-controls label{display:flex;align-items:center;gap:8px;font-weight:700}.decision-center-controls select{min-width:220px}
.decision-summary{display:grid;gap:4px;padding:12px 14px;border-radius:14px;background:var(--surface-2,#f8fafc);border:1px solid var(--line,#d8dee9)}
.decision-confidence{font-size:.82rem;color:var(--muted,#667085)}
.decision-card-list{display:grid;gap:12px}.decision-card{position:relative;padding:16px;border:1px solid var(--line,#d8dee9);border-radius:16px;background:var(--panel,#fff);box-shadow:0 4px 18px rgba(15,23,42,.05)}
.decision-card.recommended{border-width:2px}.decision-card h3{margin:5px 0}.decision-duration{display:inline-flex;padding:4px 8px;border-radius:999px;background:var(--surface-2,#eef2f7);font-weight:800;font-size:.82rem}
.decision-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0}.decision-grid p,.decision-grid ul{margin:6px 0 0}.decision-card details{margin-top:10px}.decision-card summary{cursor:pointer;font-weight:750}
.decision-actions{justify-content:flex-end;margin-top:12px}.decision-preview{margin-top:14px;padding:14px;border:1px dashed var(--line,#cbd5e1);border-radius:14px;background:var(--surface-2,#f8fafc)}
@media (max-width:700px){.decision-center-launch{font-size:.8rem;padding-inline:9px}.decision-center-dialog{width:calc(100vw - 16px);max-height:94vh}.decision-center-shell{padding:14px}.decision-center-head,.decision-summary>div{align-items:flex-start}.decision-center-controls{align-items:stretch}.decision-center-controls label{display:grid;width:100%}.decision-center-controls select{width:100%;min-width:0}.decision-grid{grid-template-columns:1fr}.decision-actions{display:grid;grid-template-columns:1fr 1fr}.decision-actions .btn{width:100%}}
@media (max-width:430px){.decision-center-launch{max-width:104px;overflow:hidden;text-overflow:ellipsis}.decision-center-dialog{margin:auto 8px}.decision-center-shell{padding:12px}.decision-card{padding:13px}}
`;
}

write(paths.app,app);write(paths.index,index);write(paths.css,css);write(paths.sw,sw);write(paths.manifest,manifest);

for(const [file,signature] of [
  ['app.js',"const APP_VERSION='4.6.0';"],
  ['app.js',"const DECISION_ENGINE_VERSION='4.6.0';"],
  ['index.html','./decision-engine.js'],
  ['service-worker.js',"'./decision-engine.js'"],
  ['manifest.webmanifest','LifeOS 4.6'],
  ['app.css',marker]
]){
  if(!read(file).includes(signature))throw new Error(`Post-patch invariant missing: ${file} ${signature}`);
}
console.log('LifeOS 4.6 production shell patch applied and verified.');

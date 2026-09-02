import fs from 'node:fs';

const appPath='app.js',cssPath='app.css',swPath='service-worker.js',indexPath='index.html',manifestPath='manifest.webmanifest';
let app=fs.readFileSync(appPath,'utf8'),css=fs.readFileSync(cssPath,'utf8'),sw=fs.readFileSync(swPath,'utf8'),index=fs.readFileSync(indexPath,'utf8'),manifest=fs.readFileSync(manifestPath,'utf8'),changed=false;
const uiFragment=fs.readFileSync('scripts/fragments/lifeos-450-ui.jsfrag','utf8').trimEnd();
const testFragment=fs.readFileSync('scripts/fragments/lifeos-450-tests.jsfrag','utf8').trimEnd();

function replaceOnce(source,oldValue,newValue,label){
  if(source.includes(newValue))return source;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`Patch guard failed: ${label} source signature was not found.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`Patch guard failed: ${label} source signature is not unique.`);
  changed=true;
  return source.replace(oldValue,newValue);
}
function insertBeforeOnce(source,anchor,block,marker,label){
  if(source.includes(marker))return source;
  const first=source.indexOf(anchor);
  if(first<0)throw new Error(`Patch guard failed: ${label} insertion anchor was not found.`);
  if(source.indexOf(anchor,first+anchor.length)>=0)throw new Error(`Patch guard failed: ${label} insertion anchor is not unique.`);
  changed=true;
  return source.slice(0,first)+block+'\n\n'+source.slice(first);
}

app=replaceOnce(app,"    {id:'insights',label:'Insights',icon:'⌁',simple:true,subtitle:'Observed patterns from your own history'},","    {id:'insights',label:'Insights',icon:'⌁',simple:true,subtitle:'Observed patterns from your own history'},\n    {id:'rules',label:'Rules & Automation',icon:'⚡',simple:true,subtitle:'Visible, testable planning rules and policies'},",'Rules navigation');
app=replaceOnce(app,"this.ruleEngine=null;this.pendingRuleSuggestion=null;this.ruleTestResult=null}","this.ruleEngine=null;this.pendingRuleSuggestion=null;this.ruleTestResult=null;this.selectedRules=new Set();this.state.set({ruleFilter:'all',ruleSearch:''})}",'Rules UI state');
app=insertBeforeOnce(app,'    async renderSettings(){',uiFragment,'async renderRules(){','Rules workspace methods');
app=replaceOnce(app,'<button class="btn small" data-action="dismiss-insight" data-id="${CoreUtil.escape(insight.insightId)}">Dismiss</button>','${[\'established\',\'strong\'].includes(evidence.level)?`<button class="btn small" data-action="suggest-rule-from-insight" data-id="${CoreUtil.escape(insight.insightId)}">Suggest rule</button>`:\'\'}<button class="btn small" data-action="dismiss-insight" data-id="${CoreUtil.escape(insight.insightId)}">Dismiss</button>','Intelligence to Rule suggestion control');
app=replaceOnce(app,"case'quick-add':this.openQuickAdd();break;case'new-task':","case'new-rule':await this.openRule();break;case'edit-rule':await this.openRule(await this.repo.get('rules',id));break;case'test-rule':await this.openRuleTest(id);break;case'test-rule-form':await this.dryRunRuleFromForm(target.closest('form'));break;case'add-rule-condition':this.addRuleCondition();break;case'remove-rule-condition':target.closest('[data-rule-condition]')?.remove();break;case'add-rule-action':this.addRuleAction();break;case'remove-rule-action':target.closest('[data-rule-action]')?.remove();break;case'rule-toggle':await this.ruleEngine.setEnabled(id,target.dataset.enabled==='true');await this.render();break;case'duplicate-rule':await this.ruleEngine.duplicate(id);await this.render();break;case'delete-rule':await this.confirmRuleDelete(id);break;case'confirm-delete-rule':await this.ruleEngine.remove(id);this.modal.close();await this.render();break;case'rule-templates':await this.openRuleTemplates();break;case'install-rule-template':await this.ruleEngine.installTemplate(id);this.modal.close();await this.render();break;case'rule-history':await this.openRuleHistory();break;case'rule-filter':this.state.set({ruleFilter:target.dataset.filter});await this.render();break;case'bulk-rules-enable':await this.bulkRuleChange('enable');break;case'bulk-rules-disable':await this.bulkRuleChange('disable');break;case'bulk-rules-delete':await this.bulkRuleChange('delete');break;case'suggest-rule-from-insight':await this.previewInsightRule(id);break;case'confirm-insight-rule':await this.confirmInsightRule();break;case'quick-add':this.openQuickAdd();break;case'new-task':",'Rule actions dispatch');
app=replaceOnce(app,"switch(form.dataset.form){case'task':","switch(form.dataset.form){case'rule':await this.saveRuleForm(form);return;case'rule-test':await this.submitRuleTest(form);return;case'task':",'Rule forms dispatch');
app=replaceOnce(app,"if(element.matches('[data-task-select]')){","if(element.matches('[data-rule-select]')){element.checked?this.selectedRules.add(element.dataset.ruleSelect):this.selectedRules.delete(element.dataset.ruleSelect);await this.render();return}if(element.matches('[data-task-select]')){",'Rule selection change');
app=replaceOnce(app,"onInput(event){if(event.target.id==='settingsSearch')","onInput(event){if(event.target.id==='ruleSearch'){this.state.set({ruleSearch:event.target.value});const query=event.target.value.toLowerCase();document.querySelectorAll('[data-rule-card]').forEach(card=>card.hidden=Boolean(query&&!card.textContent.toLowerCase().includes(query)));return}if(event.target.id==='settingsSearch')",'Rule search input');
app=replaceOnce(app,'<tr><th>Intelligence model</th><td>${INTELLIGENCE_MODEL_VERSION}</td></tr>','<tr><th>Intelligence model</th><td>${INTELLIGENCE_MODEL_VERSION}</td></tr><tr><th>Rule engine</th><td>${RULE_ENGINE_VERSION}</td></tr>','Settings Rule Engine identity');
app=insertBeforeOnce(app,'    async run(){this.results=[];',testFragment,'async runRule450Tests(repo)','RuleEngine self-test group');
app=replaceOnce(app,"      await this.runIntelligenceTests();\n      try{await db?.close();","      await this.runIntelligenceTests();\n      await this.runRule450Tests(repo);\n      try{await db?.close();",'Run RuleEngine self-tests');

if(!css.includes('/* LifeOS 4.5 Rules & Automation */')){
  css+='\n\n/* LifeOS 4.5 Rules & Automation */\n.rule-toolbar{display:grid;gap:12px}.rule-filter-row{display:grid;gap:12px}.rule-card{scroll-margin-top:80px}.rule-card:focus{outline:2px solid currentColor;outline-offset:3px}.rule-summary{display:grid;grid-template-columns:minmax(90px,.35fr) 1fr;gap:8px 12px}.rule-summary div{display:contents}.rule-summary dt{font-weight:700}.rule-summary dd{margin:0}.rule-builder{display:grid;gap:16px}.rule-builder fieldset{border:1px solid var(--border);border-radius:12px;padding:14px;display:grid;gap:12px}.rule-builder legend{font-weight:800;padding:0 6px}.rule-builder-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(150px,1fr) minmax(160px,1fr) auto;gap:10px;align-items:end}.rule-builder-row label{display:grid;gap:6px}.rule-test-inline{margin-top:10px}.rule-select{display:inline-flex;align-items:center}.rule-bulk{padding-top:10px;border-top:1px solid var(--border)}@media(max-width:720px){.rule-builder-row{grid-template-columns:1fr}.rule-summary{grid-template-columns:1fr}.rule-summary div{display:block}.rule-filter-row .segmented{overflow-x:auto;justify-content:flex-start}.rule-card .actions{display:grid;grid-template-columns:1fr 1fr}.rule-card .actions .danger{grid-column:1/-1}}\n';changed=true;
}
sw=replaceOnce(sw,"const APP_VERSION = '4.4.1';","const APP_VERSION = '4.5.0';",'Service worker app version');
index=replaceOnce(index,'<title>LifeOS 4.4.1 — Personal Intelligence</title>','<title>LifeOS 4.5 — Rules, Automation & Planning Policies</title>','Document title');
const parsed=JSON.parse(manifest);
if(parsed.name!=='LifeOS 4.5 — Rules, Automation & Planning Policies'||parsed.short_name!=='LifeOS 4.5'){
  parsed.name='LifeOS 4.5 — Rules, Automation & Planning Policies';
  parsed.short_name='LifeOS 4.5';
  manifest=JSON.stringify(parsed,null,2)+'\n';
  changed=true;
}

if(changed){
  fs.writeFileSync(appPath,app);fs.writeFileSync(cssPath,css);fs.writeFileSync(swPath,sw);fs.writeFileSync(indexPath,index);fs.writeFileSync(manifestPath,manifest);
  console.log('Applied fragment-based LifeOS 4.5 Rules workspace and QA patch.');
}else console.log('Fragment-based LifeOS 4.5 Rules workspace and QA patch already applied.');

const required=["{id:'rules',label:'Rules & Automation'",'async renderRules(){','async openRule(record={})','ruleFromForm(form)','async runRule450Tests(repo)',"await this.runRule450Tests(repo);",'suggest-rule-from-insight','bulk-rules-enable'];
for(const signature of required)if(!app.includes(signature))throw new Error(`Post-patch verification failed: ${signature}`);
if(!css.includes('/* LifeOS 4.5 Rules & Automation */'))throw new Error('Rules CSS was not installed.');
if(!sw.includes("const APP_VERSION = '4.5.0';"))throw new Error('Service worker identity was not updated.');
if(!index.includes('LifeOS 4.5 — Rules, Automation & Planning Policies'))throw new Error('Index identity was not updated.');

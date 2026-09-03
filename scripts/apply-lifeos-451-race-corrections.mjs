import fs from 'node:fs';

const path='app.js';
let source=fs.readFileSync(path,'utf8');
let changed=false;

function replaceExact(oldValue,newValue,marker,label){
  if(source.includes(marker))return;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`4.5.1 race correction guard failed: ${label} signature missing.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`4.5.1 race correction guard failed: ${label} signature not unique.`);
  source=source.replace(oldValue,newValue);
  changed=true;
}

replaceExact(
  "    async save(rule){return this.repo.save('rules',DataValidator.rule(rule))}",
  "    async save(rule){const saved=await this.repo.save('rules',DataValidator.rule(rule));await this.processing;return saved}",
  "async save(rule){const saved=await this.repo.save('rules',DataValidator.rule(rule));await this.processing;return saved}",
  'RuleEngine save queue settlement'
);

replaceExact(
  "    async testRule(rule,event,{data=null,settings=null,mode='dry-run'}={}){const normalized=DataValidator.rule({...rule,enabled:Boolean(rule.enabled)}),before=CoreUtil.hash(await this.repo.dataset({fresh:true}))",
  "    async testRule(rule,event,{data=null,settings=null,mode='dry-run'}={}){await this.processing;const normalized=DataValidator.rule({...rule,enabled:Boolean(rule.enabled)}),before=CoreUtil.hash(await this.repo.dataset({fresh:true}))",
  "async testRule(rule,event,{data=null,settings=null,mode='dry-run'}={}){await this.processing;",
  'Rule dry-run queue settlement'
);

if(changed)fs.writeFileSync(path,source);
console.log(changed?'Applied LifeOS 4.5.1 lifecycle queue corrections.':'LifeOS 4.5.1 lifecycle queue corrections already applied.');

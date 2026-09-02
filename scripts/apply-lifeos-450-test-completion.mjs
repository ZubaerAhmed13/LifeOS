import fs from 'node:fs';

const appPath='app.js';
const fragmentPath='scripts/fragments/lifeos-450-tests.jsfrag';
let app=fs.readFileSync(appPath,'utf8');
let fragment=fs.readFileSync(fragmentPath,'utf8');
let changed=false;

function insertAfter(source,anchor,block,marker,label){
  if(source.includes(marker))return source;
  const first=source.indexOf(anchor);
  if(first<0)throw new Error(`Patch guard failed: ${label} anchor missing.`);
  if(source.indexOf(anchor,first+anchor.length)>=0)throw new Error(`Patch guard failed: ${label} anchor not unique.`);
  changed=true;
  return source.slice(0,first+anchor.length)+'\n'+block+source.slice(first+anchor.length);
}

const actionAnchor="      await this.test('Rule Conditions','ANY semantics',()=>{const anyRule=DataValidator.rule({...valid,id:'rule-any',conditionMode:'any',conditions:[{field:'task.priority',operator:'equals',value:'Low'},{field:'task.status',operator:'equals',value:'Next'}]});this.assert(engine.evaluate(anyRule,engine.makeEvent('task-overdue','tasks','condition-task',null,conditionContext.task),conditionContext).matched)});";
const actionBlock=`      await this.test('Rule Actions','registry actions are structured and risk classified',()=>{const entries=Object.entries(RULE_ACTIONS);this.assert(entries.length>=10&&entries.every(([type,definition])=>type&&definition.label&&['LOW','MEDIUM','HIGH'].includes(definition.risk)&&definition.target))});
      await this.test('Rule Actions','task action plan maps priority context and attention without arbitrary code',()=>{const rule=DataValidator.rule({...valid,id:'rule-action-map',name:'Action map',actions:[{type:'change-priority',params:{priority:'High'}},{type:'set-context',params:{context:'Study'}},{type:'set-attention',params:{level:'urgent'}}]}),event=engine.makeEvent('task-overdue','tasks','condition-task',null,{...conditionContext.task,revision:1}),plan=engine.evaluate(rule,event,conditionContext),mutation=engine.taskChanges(plan,event,conditionContext);this.assert(mutation.changes.length===1&&mutation.changes[0].after.priority==='High'&&mutation.changes[0].after.context==='Study'&&mutation.changes[0].after.automationAttention.level==='urgent')});`;

const notificationAnchor="      await this.test('Rule Audit','bounded history limit configured',()=>this.assert(RULE_HISTORY_LIMIT===250));";
const notificationBlock=`      let notificationCalls=0;const notificationEngine=new RuleEngine(repo,{undo:new UndoManager(repo),journal:new OperationJournal(repo),operationLocks:new OperationLockManager(repo,'rule-notification-selftest'),notifications:{notify:async()=>{notificationCalls++;return{}}},bus:new EventBus()}),notificationRule=DataValidator.rule({...valid,id:'rule-notification-selftest',name:'Notification self-test',actions:[{type:'create-notification',params:{title:'One logical notification',message:'Deduplicated'}}]}),notificationEvent=notificationEngine.makeEvent('task-overdue','tasks',testTask.id,null,await repo.get('tasks',testTask.id),{eventId:'rule-notification-dedupe-event'}),notificationContext=notificationEngine.context(notificationEvent,await repo.dataset({fresh:true}),await repo.settings()),notificationPlan=notificationEngine.evaluate(notificationRule,notificationEvent,notificationContext),notificationAction=notificationPlan.proposedActions[0];await notificationEngine.notifyOnce(notificationPlan,notificationEvent,notificationAction);await notificationEngine.notifyOnce(notificationPlan,notificationEvent,notificationAction);
      await this.test('Rule Notifications','same logical notification is deduplicated',()=>this.assert(notificationCalls===1));
      await this.test('Rule Notifications','notification dedupe memory remains bounded',async()=>{const runtime=await notificationEngine.runtime();this.assert(CoreUtil.array(runtime.recentNotificationKeys).length<=RULE_EVENT_MEMORY_LIMIT)});`;

for(const target of ['fragment','app']){
  let source=target==='fragment'?fragment:app;
  source=insertAfter(source,actionAnchor,actionBlock,"this.test('Rule Actions','registry actions are structured",`${target} Rule Actions`);
  source=insertAfter(source,notificationAnchor,notificationBlock,"this.test('Rule Notifications','same logical notification",`${target} Rule Notifications`);
  if(target==='fragment')fragment=source;else app=source;
}

if(changed){
  fs.writeFileSync(fragmentPath,fragment);
  fs.writeFileSync(appPath,app);
  console.log('Completed required LifeOS 4.5 Rule Actions and Rule Notifications self-test groups.');
}else console.log('LifeOS 4.5 required rule self-test groups already complete.');

for(const source of [fragment,app])for(const signature of ["this.test('Rule Actions','registry actions are structured","this.test('Rule Notifications','same logical notification"])if(!source.includes(signature))throw new Error(`Post-patch verification failed: ${signature}`);

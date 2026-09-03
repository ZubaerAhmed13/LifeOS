import fs from 'node:fs';

const path='scripts/apply-lifeos-451-final-automation.mjs';
let source=fs.readFileSync(path,'utf8');
let changed=false;

function swap(oldValue,newValue){if(source.includes(oldValue)){source=source.replace(oldValue,newValue);changed=true}}

swap(",'deepWorkBefore','planning preference defaults');",",\"deepWorkBefore:'14:00',taskTypePreferredBefore:{}\",'planning preference defaults');");
swap("'static parts(epochMilliseconds,timeZoneId)','CivilTimeEngine active-date projection'","'civilStatus:analysis.status','CivilTimeEngine active-date projection'");
swap("app=replaceLine(app,/^    stop\\(\\)\\{.*$/m,stopMethod,'this.lifecycleTimer=0','RuleEngine lifecycle stop');","app=replaceLine(app,/^    stop\\(\\)\\{.*$/m,stopMethod,\"removeEventListener?.('visibilitychange'\",'RuleEngine lifecycle stop');");
swap("app=replaceLine(app,/^    validateSafety\\(rule,event,actions,context\\)\\{.*$/m,validateSafety,'resolveRepairAction(action,context)','complete action safety resolution');","app=replaceLine(app,/^    validateSafety\\(rule,event,actions,context\\)\\{.*$/m,validateSafety,'Minimal schedule repair must be reviewed as a standalone high-impact mutation.','complete action safety resolution');");

const weekStart="app=replaceLine(app,/^    async applyWeekPlan\\(plan\\)\\{.*$/m,weekPlan,'weeklyReviews',{label:'week plan identity'});";
const weekEnd="if(!app.includes(\"return{...plan,operationId:journal.operationId}}catch(error){await this.journal.finish(journal,'failed',error);throw error}}\\n    async softDelete\")){\n  app=replaceLine(app,/^    async applyWeekPlan\\(plan\\)\\{.*$/m,weekPlan,'operationId:journal.operationId}}catch(error)','week schedule generation operation identity');\n}";
if(source.includes(weekStart)&&source.includes(weekEnd)){
  const replacement="app=replaceLine(app,/^    async applyWeekPlan\\(plan\\)\\{.*$/m,weekPlan,\"return{...plan,operationId:journal.operationId}}catch(error){await this.journal.finish(journal,'failed',error);throw error}}\\n    async softDelete\",'week schedule generation operation identity');";
  source=source.replace(weekStart+"\n// The previous helper cannot use an object label; re-run guard below only when needed.\n"+weekEnd,replacement);
  changed=true;
}

const pendingPattern=/app=replaceText\(app,"pending\.proposedActions\.map[\s\S]*?,'pending approval detailed action preview'\);/;
if(pendingPattern.test(source)){
  const replacement=String.raw`const openPendingRule="    async openPendingRule(executionId){const pending=(await this.ruleEngine.pendingApprovals()).find(row=>row.executionId===executionId);if(!pending)return;const body=\`<div class=\\\"note\\\"><b>Automation is waiting for your approval.</b><p>\${CoreUtil.escape(pending.ruleName)}</p></div><dl class=\\\"evidence-grid\\\"><div><dt>Trigger</dt><dd>\${CoreUtil.escape(this.ruleLabel(pending.triggerType,RULE_TRIGGERS))}</dd></div><div><dt>Created</dt><dd>\${CoreUtil.formatDateTime(pending.createdAt)}</dd></div><div><dt>Affected entities</dt><dd>\${CoreUtil.array(pending.affectedEntities).length}</dd></div><div><dt>Risk</dt><dd>\${CoreUtil.escape(pending.proposedActions.map(action=>action.risk).join(', ')||'LOW')}</dd></div></dl><h3>Proposed actions</h3><ul>\${pending.proposedActions.map(action=>\`<li><b>\${CoreUtil.escape(this.ruleActionPreview(action))}</b>\${action.risk==='HIGH'?' · High impact':''}</li>\`).join('')}</ul>\${pending.warnings.length?\`<div class=\\\"warning-box\\\"><b>Warnings</b><ul>\${pending.warnings.map(value=>\`<li>\${CoreUtil.escape(value)}</li>\`).join('')}</ul></div>\`:''}<p class=\\\"muted\\\">Before applying, LifeOS reloads affected records and rejects stale approvals before any mutation.</p><div class=\\\"dialog-foot embedded-dialog-foot\\\"><button class=\\\"btn\\\" data-action=\\\"reject-pending-rule\\\" data-id=\\\"\${CoreUtil.escape(executionId)}\\\">Reject</button><button class=\\\"btn primary\\\" data-action=\\\"apply-pending-rule\\\" data-id=\\\"\${CoreUtil.escape(executionId)}\\\">Apply</button></div>\`;this.modal.open('Review Automation',body,'',{subtitle:'Explicit approval · stale-revision protected'})}";
app=replaceLine(app,/^    async openPendingRule.*$/m,openPendingRule,'this.ruleActionPreview(action)','pending approval detailed action preview');`;
  source=source.replace(pendingPattern,replacement);
  changed=true;
}

// Replace the zero-delay lock spin with a bounded real wait. Manual schedule operations
// can legitimately hold the cross-tab operation lock while repository change events queue.
const oldWait="async waitForExternalOperation(){for(let index=0;index<200&&this.operationLocks?.currentOperation&&!String(this.operationLocks.currentOperation).startsWith('Rule ');index++)await new Promise(resolve=>setTimeout(resolve,0))}";
const newWait="async waitForExternalOperation(){for(let index=0;index<500&&this.operationLocks?.currentOperation&&!String(this.operationLocks.currentOperation).startsWith('Rule ');index++)await new Promise(resolve=>setTimeout(resolve,10));if(this.operationLocks?.currentOperation&&!String(this.operationLocks.currentOperation).startsWith('Rule '))throw CoreUtil.error('RULE-OPERATION-WAIT-019','Planning operation did not settle before rule evaluation.')}";
swap(oldWait,newWait);

// Context time must follow LifeOS's configured civil time rather than the host/browser zone.
const oldContext="date=event.current?.date||task?.preferredDate||CoreUtil.localDate(),capacity=CapacityEngine.summary(date,data,settings),profile=capacity.type?.code||data.dayProfiles.find(row=>row.date===date)?.dayType||'Auto',checkin=[...CoreUtil.array(data.dailyCheckins)].filter(row=>row.date===date).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0],projectShortfall=project?ProjectAllocator.shortfall(project,data.tasks,CoreUtil.startOfWeek(date),data,settings):null,repairs=CoreUtil.array(data.activityLog).filter(row=>row.type==='repair-apply').sort((a,b)=>String(b.at).localeCompare(String(a.at))),stability=CoreUtil.num(repairs[0]?.meta?.stability,100),now=new Date(),time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')";
const newContext="civil=TimeZoneEngine.parts(Date.now(),settings.timeZoneId||TimeZoneEngine.deviceTimeZone()||'UTC'),date=event.current?.date||task?.preferredDate||civil.date,capacity=CapacityEngine.summary(date,data,settings),profile=capacity.type?.code||data.dayProfiles.find(row=>row.date===date)?.dayType||'Auto',checkin=[...CoreUtil.array(data.dailyCheckins)].filter(row=>row.date===date).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0],projectShortfall=project?ProjectAllocator.shortfall(project,data.tasks,CoreUtil.startOfWeek(date),data,settings):null,repairs=CoreUtil.array(data.activityLog).filter(row=>row.type==='repair-apply').sort((a,b)=>String(b.at).localeCompare(String(a.at))),stability=CoreUtil.num(repairs[0]?.meta?.stability,100),time=civil.time";
swap(oldContext,newContext);

if(changed)fs.writeFileSync(path,source);
console.log(changed?'Repaired LifeOS 4.5.1 patcher guards.':'LifeOS 4.5.1 patcher guards already repaired.');

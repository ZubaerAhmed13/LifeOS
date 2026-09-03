import fs from 'node:fs';

const path='scripts/apply-lifeos-451-final-automation.mjs';
let source=fs.readFileSync(path,'utf8');
let changed=false;

const oldDefaultMarker=",'deepWorkBefore','planning preference defaults');";
const newDefaultMarker=",\"deepWorkBefore:'14:00',taskTypePreferredBefore:{}\",'planning preference defaults');";
if(source.includes(oldDefaultMarker)){source=source.replace(oldDefaultMarker,newDefaultMarker);changed=true}

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

if(changed)fs.writeFileSync(path,source);
console.log(changed?'Repaired LifeOS 4.5.1 patcher guards.':'LifeOS 4.5.1 patcher guards already repaired.');

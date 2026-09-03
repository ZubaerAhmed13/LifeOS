import fs from 'node:fs';

const file='decision-engine.js';
let source=fs.readFileSync(file,'utf8');
const marker='data-decision-what-now';
if(source.includes(marker)){
  console.log('LifeOS 4.6 Decision-backed What Now already present.');
  process.exit(0);
}
const anchor=`  api.app.decisionEngine=engine;\n  const ui=new DecisionCenterUI(engine);api.app.decisionCenter=ui;ui.mount();`;
if(!source.includes(anchor))throw new Error('LifeOS 4.6 What Now hardening guard failed: expose anchor missing.');
const replacement=`  api.app.decisionEngine=engine;
  api.app.whatNow=async function(){
    try{
      const decision=await engine.analyze({type:DECISION_TYPES.NEXT_ACTION,mode:'production',source:'what-now'}),recommended=decision.recommended;
      if(!recommended){
        this.modal.open('What should I do now?',\`<div data-decision-what-now class="note"><b>No feasible next action is available.</b><p>Review blocked work, protected recovery, fixed commitments and hard capacity constraints in Decision Center.</p></div>\`,'<button class="btn" data-action="close-dialog">Close</button>');
        return decision;
      }
      const candidate=recommended.candidate,explanation=recommended.explanation||{},alternative=decision.alternatives.find(item=>item.candidate.id!==candidate.id&&item.candidate.kind!==KEEP_CURRENT_PLAN)||decision.alternatives.find(item=>item.candidate.id!==candidate.id);
      const why=array(recommended.tradeoffs?.reasons).filter(item=>item.severity!=='hard').slice(0,4).map(item=>\`<li><b>\${escapeHtml(item.reasonCode.replaceAll('-',' '))}</b> — \${escapeHtml(item.comparison||\`\${item.metric}: \${item.value}\`)}</li>\`).join('');
      const protects=array(explanation.protects).map(item=>\`<li>\${escapeHtml(item)}</li>\`).join('')||'<li>Current feasible plan and remaining capacity.</li>';
      const next=array(explanation.defers)[0]||'Reassess after this session or when the current context changes.';
      const bestAlternative=alternative?\`<div class="item"><div class="item-main"><b>\${escapeHtml(alternative.candidate.title)}</b><div class="muted">\${alternative.candidate.duration?escapeHtml(alternative.candidate.duration+' min'):'No extra scheduled time'} · \${escapeHtml(alternative.label)}</div></div></div>\`:'<p class="muted">No materially different feasible alternative is available.</p>';
      const startAction=candidate.kind==='task-session'&&candidate.taskId?\`<button class="btn primary" data-action="start-focus" data-id="\${escapeHtml(candidate.taskId)}">Start Focus</button>\`:'<button class="btn primary" data-action="close-dialog">Keep Current Plan</button>';
      this.modal.open('What should I do now?',\`<div data-decision-what-now><div class="success-box"><div class="muted">DECISION ENGINE RECOMMENDATION</div><h2>\${escapeHtml(candidate.title)}</h2>\${candidate.duration?\`<div class="metric">\${escapeHtml(candidate.duration)} min</div>\`:''}<p>\${escapeHtml(explanation.summary||'This is the highest-ranked feasible decision under the current constraints.')}</p></div><div class="flow-gap-14"><h3>Why now?</h3><ul>\${why||'<li>The recommendation passed hard feasibility and deterministic trade-off ranking.</li>'}</ul><h3>What this protects</h3><ul>\${protects}</ul><h3>What comes next?</h3><p>\${escapeHtml(next)}</p><h3>Opportunity cost</h3><p>\${escapeHtml(explanation.opportunityCost||'Remaining capacity is preserved for the next decision.')}</p><h3>Best alternative</h3>\${bestAlternative}<p class="muted">Confidence: \${escapeHtml(decision.confidence?.label||'Limited')} · Decision Engine \${escapeHtml(DECISION_ENGINE_VERSION)}</p></div></div>\`,'<button class="btn" data-action="close-dialog">Close</button>'+startAction,{subtitle:'Decision-aware recommendation using current hard constraints and trade-offs.'});
      return decision;
    }catch(error){
      this.modal.open('What should I do now?',\`<div data-decision-what-now class="note warning"><b>Decision analysis could not complete.</b><p>\${escapeHtml(error.message)}</p></div>\`,'<button class="btn" data-action="close-dialog">Close</button>');
      return null;
    }
  };
  const ui=new DecisionCenterUI(engine);api.app.decisionCenter=ui;ui.mount();`;
source=source.replace(anchor,replacement);
fs.writeFileSync(file,source);
for(const invariant of [marker,"source:'what-now'",'DECISION ENGINE RECOMMENDATION','What this protects','Opportunity cost','Best alternative'])if(!source.includes(invariant))throw new Error(`LifeOS 4.6 What Now invariant missing: ${invariant}`);
if(source.includes('decision-center-open'))throw new Error('LifeOS 4.6 What Now contains an unsupported modal action.');
console.log('LifeOS 4.6 Decision-backed What Now applied and verified.');

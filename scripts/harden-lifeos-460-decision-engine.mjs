import fs from 'node:fs';

const file='decision-engine.js';
let source=fs.readFileSync(file,'utf8');
const replace=(oldValue,newValue,marker,label)=>{
  if(marker&&source.includes(marker))return;
  const first=source.indexOf(oldValue);
  if(first<0)throw new Error(`LifeOS 4.6 hardening guard failed: ${label} signature missing.`);
  if(source.indexOf(oldValue,first+oldValue.length)>=0)throw new Error(`LifeOS 4.6 hardening guard failed: ${label} signature not unique.`);
  source=source.replace(oldValue,newValue);
};

replace(
`    const contextCost=currentContext&&task?.context&&currentContext!==task.context?1:0;
    const disruption=.15;
    const recoveryImpact=0;
    const deferralCost=deadlineProtection*.8+forecastImpact*.2;
    const reasons=[`,
`    const contextCost=currentContext&&task?.context&&currentContext!==task.context?1:0;
    const disruption=.15;
    const recoveryImpact=0;
    const taskType=String(task?.taskType||task?.type||task?.context||'');
    const deepCutoff=CoreUtil.clock(context.settings.deepWorkBefore||''),typeCutoff=CoreUtil.clock(context.settings.taskTypePreferredBefore?.[taskType]||'');
    let ruleAlignment=0;
    if(task?.workMode==='Deep'&&deepCutoff!==null)ruleAlignment=candidate.startMinute<deepCutoff?.35:-.15;
    if(typeCutoff!==null)ruleAlignment+=candidate.startMinute<typeCutoff?.25:-.1;
    let intelligenceAlignment=0,intelligenceReason='';
    try{const signal=api.PersonalIntelligenceEngine?.signalForTask?.(task,context.intelligence||{insights:[]},context.settings,candidate.startMinute);if(signal){intelligenceAlignment=Math.min(.25,num(signal.boost,0)/24);intelligenceReason=signal.explanation||''}}catch{}
    const deferralCost=deadlineProtection*.8+forecastImpact*.2;
    const reasons=[`,
'intelligenceAlignment=0',
'RuleEngine-produced planning preference integration'
);
replace(
`      reason('BUFFER-PRESERVATION','CapacityEngine','bufferAfter',bufferAfter,\`desired \${Math.round(desiredBuffer)}m\`)
    ];
    if(forecast)reasons.push(reason('FORECAST-RISK','DeadlineEngine','risk',forecast.risk||'',\`shortfall \${num(forecast.shortfall)}m\`));
    return{deadlineProtection,projectAlignment,forecastImpact,capacityFit,disruption,recoveryImpact,contextCost,bufferImpact,deferralCost,reasons};`,
`      reason('BUFFER-PRESERVATION','CapacityEngine','bufferAfter',bufferAfter,\`desired \${Math.round(desiredBuffer)}m\`)
    ];
    if(ruleAlignment)reasons.push(reason('RULEENGINE-ALIGNMENT','RuleEngine','planningPreference',ruleAlignment,'Applied planning-policy outputs are soft unless enforced by authoritative feasibility.'));
    if(intelligenceAlignment&&intelligenceReason)reasons.push(reason('PERSONAL-INTELLIGENCE','PersonalIntelligenceEngine','acceptedPreference',intelligenceAlignment,intelligenceReason));
    if(forecast)reasons.push(reason('FORECAST-RISK','DeadlineEngine','risk',forecast.risk||'',\`shortfall \${num(forecast.shortfall)}m\`));
    return{deadlineProtection,projectAlignment,forecastImpact,capacityFit,disruption,recoveryImpact,contextCost,bufferImpact,ruleAlignment,intelligenceAlignment,deferralCost,reasons};`,
"reason('RULEENGINE-ALIGNMENT'",
'RuleEngine/Intelligence reason provenance'
);
replace(
`        B.projectAlignment-A.projectAlignment,
        B.forecastImpact-A.forecastImpact,
        B.capacityFit-A.capacityFit,
        A.disruption-B.disruption,
        A.recoveryImpact-B.recoveryImpact,
        A.contextCost-B.contextCost,
        B.bufferImpact-A.bufferImpact
      ];`,
`        B.projectAlignment-A.projectAlignment,
        num(B.ruleAlignment)-num(A.ruleAlignment),
        B.forecastImpact-A.forecastImpact,
        B.capacityFit-A.capacityFit,
        A.disruption-B.disruption,
        A.recoveryImpact-B.recoveryImpact,
        A.contextCost-B.contextCost,
        num(B.intelligenceAlignment)-num(A.intelligenceAlignment),
        B.bufferImpact-A.bufferImpact
      ];`,
'num(B.ruleAlignment)',
'deterministic staged RuleEngine/Intelligence ranking'
);
replace(
`    return ranked.map((row,index)=>({...row,rank:index+1}));`,
`    const keep=ranked.find(row=>row.candidate.kind===KEEP_CURRENT_PLAN),bestChange=ranked.find(row=>row.candidate.kind!==KEEP_CURRENT_PLAN);
    const material=bestChange&&(bestChange.tradeoffs.deadlineProtection>=.35||bestChange.tradeoffs.projectAlignment>=.55||bestChange.tradeoffs.forecastImpact>=.55||bestChange.tradeoffs.deferralCost>=.55);
    const ordered=keep&&!material?[keep,...ranked.filter(row=>row!==keep)]:ranked;
    return ordered.map((row,index)=>({...row,rank:index+1}));`,
'const material=bestChange',
'meaningful-improvement no-change gate'
);
replace(
`    const recommended=alternatives[0]||null,elapsed=(performance.now?.()||Date.now())-started;
    const confidence=this.confidence(context,alternatives);
    const decision={decisionId:`,
`    const recommended=alternatives[0]||null,elapsed=(performance.now?.()||Date.now())-started;
    const confidence=this.confidence(context,alternatives);
    const availableMinutes=Math.max(0,num(context.capacity?.focusRemaining,context.capacity?.physicalLeft||0));
    const requiredMinutes=context.readyTasks.reduce((sum,task)=>sum+Math.max(0,num(task.remainingDuration,num(task.estimatedDuration,0))),0);
    const minimumDeadlineMinutes=context.readyTasks.filter(task=>task.deadline&&deadlineDays(task,context.decisionDate,host().CoreUtil)<=1).reduce((sum,task)=>sum+Math.max(0,num(task.remainingDuration,num(task.estimatedDuration,0))),0);
    const capacityShortfall={availableMinutes,requiredMinutes,minimumDeadlineMinutes,shortfallMinutes:Math.max(0,requiredMinutes-availableMinutes),deadlineShortfallMinutes:Math.max(0,minimumDeadlineMinutes-availableMinutes)};
    const decision={decisionId:`,
'const capacityShortfall=',
'capacity shortfall computation'
);
replace(
`generatedAt:nowISO(),durationMs:Number(elapsed.toFixed?.(2)||elapsed),dataQuality:context.dataQuality,recommended,alternatives,rejected:`,
`generatedAt:nowISO(),durationMs:Number(elapsed.toFixed?.(2)||elapsed),dataQuality:context.dataQuality,capacityShortfall,recommended,alternatives,rejected:`,
'dataQuality:context.dataQuality,capacityShortfall',
'capacity shortfall output'
);
replace(
`      id:CoreUtil.uid(),date:choice.candidate.date,startTime:CoreUtil.time(start),duration:choice.candidate.duration,
      taskId:task.id,projectId:task.projectId||'',title:task.title||choice.candidate.title,
      sourceType:'decision',decisionId:decision.decisionId,locked:false,createdAt:nowISO(),updatedAt:nowISO(),revision:1`,
`      id:CoreUtil.uid(),date:choice.candidate.date,startTime:CoreUtil.time(start),endTime:CoreUtil.time(start+choice.candidate.duration),duration:choice.candidate.duration,type:'task',
      taskId:task.id,projectId:task.projectId||'',lifeAreaId:task.lifeAreaId||'',title:task.title||choice.candidate.title,
      sourceType:'decision',sourceId:task.id,decisionId:decision.decisionId,manuallyPlaced:true,locked:false,createdAt:nowISO(),updatedAt:nowISO(),revision:1`,
"sourceType:'decision',sourceId:task.id",
'native time-block fields'
);
replace(
`    body.innerHTML=\`<section class="decision-summary"><div><b>Recommended decision</b><span class="decision-confidence">Confidence: \${escapeHtml(decision.confidence.label)}</span></div><small>Exact context \${escapeHtml(decision.contextFingerprint)} · \${escapeHtml(String(decision.durationMs))} ms</small></section>\${decision.dataQuality.missingInputs.length?\`<div class="note">\${decision.dataQuality.missingInputs.map(escapeHtml).join(' ')}</div>\`:''}<div class="decision-card-list">\${decision.alternatives.map(card).join('')}</div><div data-preview-output></div>\`;`,
`    const shortfall=decision.capacityShortfall?.shortfallMinutes||0,shortfallNote=shortfall?\`<div class="warning"><b>Capacity shortfall:</b> \${shortfall} minutes cannot fit in the remaining focus capacity today.</div>\`:'';
    body.innerHTML=\`<section class="decision-summary"><div><b>Recommended decision</b><span class="decision-confidence">Confidence: \${escapeHtml(decision.confidence.label)}</span></div><small>Exact context \${escapeHtml(decision.contextFingerprint)} · \${escapeHtml(String(decision.durationMs))} ms</small></section>\${shortfallNote}\${decision.dataQuality.missingInputs.length?\`<div class="note">\${decision.dataQuality.missingInputs.map(escapeHtml).join(' ')}</div>\`:''}<div class="decision-card-list">\${decision.alternatives.map(card).join('')}</div><div data-preview-output></div>\`;`,
'const shortfall=decision.capacityShortfall',
'capacity shortfall UI'
);

fs.writeFileSync(file,source);
for(const invariant of ['RULEENGINE-ALIGNMENT','PERSONAL-INTELLIGENCE','const material=bestChange','const capacityShortfall=','deadlineShortfallMinutes','sourceType:\'decision\',sourceId:task.id'])if(!source.includes(invariant))throw new Error(`LifeOS 4.6 hardening invariant missing: ${invariant}`);
console.log('LifeOS 4.6 Decision Engine hardening applied and verified.');

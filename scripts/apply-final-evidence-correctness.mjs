import fs from 'node:fs';

const appPath = 'app.js';
const swPath = 'service-worker.js';
const indexPath = 'index.html';

let app = fs.readFileSync(appPath, 'utf8');
let sw = fs.readFileSync(swPath, 'utf8');
let index = fs.readFileSync(indexPath, 'utf8');
let changed = false;

function replaceOnce(source, oldValue, newValue, label) {
  if (source.includes(newValue)) return source;
  const first = source.indexOf(oldValue);
  if (first < 0) throw new Error(`Patch guard failed: ${label} source signature was not found.`);
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Patch guard failed: ${label} source signature is not unique.`);
  changed = true;
  return source.replace(oldValue, newValue);
}

app = replaceOnce(app, "const APP_VERSION='4.4.0';", "const APP_VERSION='4.4.1';", 'APP_VERSION');
app = replaceOnce(app, "const INTELLIGENCE_MODEL_VERSION='4.4.1';", "const INTELLIGENCE_MODEL_VERSION='4.4.2';", 'INTELLIGENCE_MODEL_VERSION');
app = replaceOnce(app, "const INTELLIGENCE_THRESHOLDS=Object.freeze({\n    version:'4.4.1',", "const INTELLIGENCE_THRESHOLDS=Object.freeze({\n    version:'4.4.2',", 'INTELLIGENCE_THRESHOLDS version');

app = replaceOnce(
  app,
  "    static pairedAssociation(dataset,{kind,title,statement,eligible,usable,groupA,groupB,dimensions,stratumKey='taskType'}){",
  "    // Evidence invariant: records that are available but do not participate in A-vs-B must never increase comparison sample size or evidence strength.\n    static pairedAssociation(dataset,{kind,title,statement,eligible,usable,groupA,groupB,dimensions,stratumKey='taskType'}){",
  'pairedAssociation invariant comment'
);

app = replaceOnce(
  app,
  "const evidence=this.evidence({includedRows:usableRows,eligibleRows,dataset,values:association.candidates.map(row=>row.estimateRatio),stratification:association}),comparison={",
  "const comparisonRows=association.candidates,excludedComparisonRows=Math.max(0,usableRows.length-comparisonRows.length),evidence=this.evidence({includedRows:comparisonRows,eligibleRows:comparisonRows,dataset,values:comparisonRows.map(row=>row.estimateRatio),stratification:association,exclusions:excludedComparisonRows?[excludedComparisonRows+' source-field observation'+(excludedComparisonRows===1?'':'s')+' excluded because they did not belong to either comparison group.']:[]}),comparison={fieldAvailable:usableRows.length,comparedSamples:comparisonRows.length,excludedFromComparison:excludedComparisonRows,",
  'pairedAssociation comparison sample'
);

app = replaceOnce(
  app,
  "make=(type,title,statement,a,b,dimensions)=>{if(a.length<3||b.length<3)return;const difference=rate(a)-rate(b);if(Math.abs(difference)<INTELLIGENCE_THRESHOLDS.postponementRateEffect)return;const rows=[...a,...b],evidence=this.evidence({includedRows:rows,eligibleRows:attempts,dataset:null,values:rows.map(row=>row.postponed?1:0)});insights.push(",
  "make=(type,title,statement,a,b,dimensions,{eligibleRows=null,exclusions=[]}={})=>{if(a.length<3||b.length<3)return;const difference=rate(a)-rate(b);if(Math.abs(difference)<INTELLIGENCE_THRESHOLDS.postponementRateEffect)return;const rows=[...a,...b],comparisonEligibleRows=eligibleRows===null?rows:CoreUtil.array(eligibleRows),evidence=this.evidence({includedRows:rows,eligibleRows:comparisonEligibleRows,dataset:null,values:rows.map(row=>row.postponed?1:0),exclusions});insights.push(",
  'postponement comparison cohort'
);

app = replaceOnce(
  app,
  "method:'Postponement rate is dated postponed scheduled attempts divided by all eligible dated scheduled attempts. Activity-log attempt IDs are authoritative and cumulative-only legacy counts are excluded.'",
  "method:'Postponement rate is dated postponed scheduled attempts divided by the comparison-specific eligible dated cohort. Activity-log attempt IDs are authoritative; unrelated, middle-band, unknown and cumulative-only legacy records are excluded from the comparison evidence.'",
  'postponement method text'
);

app = replaceOnce(
  app,
  "includedRows:completionAssociation.candidates,eligibleRows:completed,dataset:null,values:completionAssociation.candidates.map(row=>row.estimateRatio),stratification:completionAssociation",
  "includedRows:completionAssociation.candidates,eligibleRows:completionAssociation.candidates,dataset:null,values:completionAssociation.candidates.map(row=>row.estimateRatio),stratification:completionAssociation",
  'postponement completion comparison cohort'
);

const anchor = "      await this.test('Intelligence Compute','robust main-thread fallback',async()=>{const compute=new ComputeManager(),value=await compute.run('intelligence-summary',{values:[1,2,3,4,100]},{dataGeneration:44});this.assert(value.result.count===5&&value.result.median===3&&value.dataGeneration===44)});";
const regressionMarker = "Evidence Comparison Cohorts','Energy 3/3/14 uses six comparison participants";
if (!app.includes(regressionMarker)) {
  if (!app.includes(anchor)) throw new Error('Patch guard failed: intelligence regression insertion anchor was not found.');
  const regressionBlock = `
      const evidenceBase=dataset.observations[0],evidenceDate=CoreUtil.localDate(),evidenceSnapshot=value=>({sampleSize:value.evidence.sampleSize,eligibleCount:value.evidence.eligibleCount,coverage:value.evidence.coverage,level:value.evidence.level,effect:value.metric.value,magnitude:value.magnitude});
      const energyCore=[...Array.from({length:3},(_,i)=>({...evidenceBase,observationId:'energy-high-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1,energyBefore:8})),...Array.from({length:3},(_,i)=>({...evidenceBase,observationId:'energy-low-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.4,energyBefore:3}))],energyMedium=Array.from({length:14},(_,i)=>({...evidenceBase,observationId:'energy-medium-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.2,energyBefore:i%2?5:6})),energySix=PersonalIntelligenceEngine.energy({...dataset,observations:energyCore})[0],energyTwenty=PersonalIntelligenceEngine.energy({...dataset,observations:[...energyCore,...energyMedium]})[0];
      await this.test('Evidence Comparison Cohorts','Energy 3/3/14 uses six comparison participants',()=>this.assert(energyTwenty.evidence.sampleSize===6&&energyTwenty.evidence.eligibleCount===6&&energyTwenty.evidence.coverage===1&&energyTwenty.comparison.fieldAvailable===20&&energyTwenty.comparison.comparedSamples===6&&energyTwenty.comparison.excludedFromComparison===14));
      await this.test('Evidence Comparison Cohorts','Energy medium-band observations are invariant',()=>this.assert(CoreUtil.hash(evidenceSnapshot(energySix))===CoreUtil.hash(evidenceSnapshot(energyTwenty))));
      const contextCore=[...Array.from({length:6},(_,i)=>({...evidenceBase,observationId:'context-same-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1,contextEligible:true,contextSwitchBefore:false})),...Array.from({length:6},(_,i)=>({...evidenceBase,observationId:'context-switched-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.4,contextEligible:true,contextSwitchBefore:true}))],contextUnknown=Array.from({length:100},(_,i)=>({...evidenceBase,observationId:'context-unknown-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.2,contextEligible:true,contextSwitchBefore:null})),contextBaseInsight=PersonalIntelligenceEngine.context({...dataset,observations:contextCore})[0],contextExpandedInsight=PersonalIntelligenceEngine.context({...dataset,observations:[...contextCore,...contextUnknown]})[0];
      await this.test('Evidence Comparison Cohorts','unknown Context records do not inflate comparison evidence',()=>this.assert(contextExpandedInsight.evidence.sampleSize===12&&CoreUtil.hash(evidenceSnapshot(contextBaseInsight))===CoreUtil.hash(evidenceSnapshot(contextExpandedInsight))));
      const recoveryCore=[...Array.from({length:6},(_,i)=>({...evidenceBase,observationId:'recovery-met-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1,recoveryEligible:true,recoveryMet:true,recoverySource:'Work'})),...Array.from({length:6},(_,i)=>({...evidenceBase,observationId:'recovery-short-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.4,recoveryEligible:true,recoveryMet:false,recoverySource:'Work'}))],recoveryUnknown=Array.from({length:100},(_,i)=>({...evidenceBase,observationId:'recovery-unknown-'+i,date:evidenceDate,taskType:'Study',validEstimation:true,estimateRatio:1.2,recoveryEligible:true,recoveryMet:null,recoverySource:'Work'})),recoveryBaseInsight=PersonalIntelligenceEngine.recovery({...dataset,observations:recoveryCore})[0],recoveryExpandedInsight=PersonalIntelligenceEngine.recovery({...dataset,observations:[...recoveryCore,...recoveryUnknown]})[0];
      await this.test('Evidence Comparison Cohorts','unknown Recovery records do not inflate comparison evidence',()=>this.assert(recoveryExpandedInsight.evidence.sampleSize===12&&CoreUtil.hash(evidenceSnapshot(recoveryBaseInsight))===CoreUtil.hash(evidenceSnapshot(recoveryExpandedInsight))));
      const careerAttempts=Array.from({length:10},(_,i)=>({attemptId:'career-attempt-'+i,taskType:'Career',scheduledDate:evidenceDate,scheduledLocalHour:i<5?10:20,flexible:true,postponed:i>=5&&i<9,completed:!(i>=5&&i<9),previousPostponements:0,plannedLoadRatio:.6})),controlAttempts=Array.from({length:6},(_,i)=>({attemptId:'control-attempt-'+i,taskType:'Control',scheduledDate:evidenceDate,scheduledLocalHour:12,flexible:true,postponed:i===0,completed:i!==0,previousPostponements:0,plannedLoadRatio:.6})),adminAttempts=count=>Array.from({length:count},(_,i)=>({attemptId:'admin-attempt-'+count+'-'+i,taskType:'Admin',scheduledDate:evidenceDate,scheduledLocalHour:13,flexible:true,postponed:i%6===0,completed:i%6!==0,previousPostponements:0,plannedLoadRatio:.6})),careerInsight=rows=>PersonalIntelligenceEngine.postponement({postponementAttempts:rows}).find(row=>row.insightType==='postponement-time-window'&&row.sourceDimensions.taskType==='Career'),careerBaseInsight=careerInsight([...careerAttempts,...controlAttempts]),career100Insight=careerInsight([...careerAttempts,...controlAttempts,...adminAttempts(100)]),career500Insight=careerInsight([...careerAttempts,...controlAttempts,...adminAttempts(500)]);
      await this.test('Evidence Comparison Cohorts','Career time-window evidence ignores 100 unrelated Admin attempts',()=>this.assert(careerBaseInsight&&career100Insight&&career100Insight.evidence.sampleSize===10&&career100Insight.evidence.eligibleCount===10&&career100Insight.evidence.coverage===1&&CoreUtil.hash(evidenceSnapshot(careerBaseInsight))===CoreUtil.hash(evidenceSnapshot(career100Insight))));
      await this.test('Evidence Comparison Cohorts','Career time-window evidence ignores 500 unrelated observations',()=>this.assert(career500Insight&&CoreUtil.hash(evidenceSnapshot(careerBaseInsight))===CoreUtil.hash(evidenceSnapshot(career500Insight))));
      const loadHigh=Array.from({length:6},(_,i)=>({attemptId:'load-high-'+i,taskType:'Load',scheduledDate:evidenceDate,flexible:true,plannedLoadRatio:.95,postponed:i<5,completed:i>=5,previousPostponements:0})),loadLow=Array.from({length:6},(_,i)=>({attemptId:'load-low-'+i,taskType:'Load',scheduledDate:evidenceDate,flexible:true,plannedLoadRatio:.6,postponed:false,completed:true,previousPostponements:0})),loadMiddle=Array.from({length:100},(_,i)=>({attemptId:'load-middle-'+i,taskType:'Load',scheduledDate:evidenceDate,flexible:true,plannedLoadRatio:.85,postponed:i%2===0,completed:i%2!==0,previousPostponements:0})),loadInsight=rows=>PersonalIntelligenceEngine.postponement({postponementAttempts:rows}).find(row=>row.insightType==='postponement-load'),loadBaseInsight=loadInsight([...loadHigh,...loadLow]),loadExpandedInsight=loadInsight([...loadHigh,...loadLow,...loadMiddle]);
      await this.test('Evidence Comparison Cohorts','planned-load middle band does not inflate A-vs-B evidence',()=>this.assert(loadBaseInsight&&loadExpandedInsight&&loadExpandedInsight.evidence.sampleSize===12&&loadExpandedInsight.evidence.eligibleCount===12&&CoreUtil.hash(evidenceSnapshot(loadBaseInsight))===CoreUtil.hash(evidenceSnapshot(loadExpandedInsight))));`;
  app = app.replace(anchor, anchor + regressionBlock);
  changed = true;
}

sw = replaceOnce(sw, "const APP_VERSION = '4.4.0';", "const APP_VERSION = '4.4.1';", 'service worker APP_VERSION');
sw = replaceOnce(sw, "const CACHE_BUILD = 'pwa1';", "const CACHE_BUILD = 'evidence-correctness-1';", 'service worker cache build');
index = replaceOnce(index, '<title>LifeOS 4.4 — Personal Intelligence</title>', '<title>LifeOS 4.4.1 — Personal Intelligence</title>', 'document title');

if (changed) {
  fs.writeFileSync(appPath, app);
  fs.writeFileSync(swPath, sw);
  fs.writeFileSync(indexPath, index);
  console.log('Applied LifeOS 4.4.1 final evidence-correctness patch.');
} else {
  console.log('LifeOS final evidence-correctness patch is already applied; no source changes required.');
}

const required = [
  "const APP_VERSION='4.4.1';",
  "const INTELLIGENCE_MODEL_VERSION='4.4.2';",
  'includedRows:comparisonRows,eligibleRows:comparisonRows',
  'comparisonEligibleRows=eligibleRows===null?rows:CoreUtil.array(eligibleRows)',
  "Evidence Comparison Cohorts','Energy 3/3/14 uses six comparison participants"
];
for (const signature of required) if (!app.includes(signature)) throw new Error(`Post-patch verification failed: ${signature}`);
if (app.includes('includedRows:usableRows,eligibleRows,dataset,values:association.candidates')) throw new Error('Post-patch verification failed: stale pairedAssociation evidence path remains.');
if (app.includes('includedRows:rows,eligibleRows:attempts,dataset:null')) throw new Error('Post-patch verification failed: stale global postponement cohort remains.');

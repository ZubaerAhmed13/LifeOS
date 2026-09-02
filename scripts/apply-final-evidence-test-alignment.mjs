import fs from 'node:fs';

const appPath = 'app.js';
const swPath = 'service-worker.js';
let app = fs.readFileSync(appPath, 'utf8');
let sw = fs.readFileSync(swPath, 'utf8');
let changed = false;

function replaceOnce(source, oldValue, newValue, label) {
  if (source.includes(newValue)) return source;
  const first = source.indexOf(oldValue);
  if (first < 0) throw new Error(`Alignment guard failed: ${label} signature not found.`);
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) throw new Error(`Alignment guard failed: ${label} signature is not unique.`);
  changed = true;
  return source.replace(oldValue, newValue);
}

app = replaceOnce(
  app,
  "await this.test('Intelligence Dataset','model version attached',()=>this.assert(dataset.intelligenceModelVersion==='4.4.1'));",
  "await this.test('Intelligence Dataset','model version attached',()=>this.assert(dataset.intelligenceModelVersion==='4.4.2'));",
  'dataset intelligence version assertion'
);
app = replaceOnce(
  app,
  "await this.test('Personal Intelligence','analysis model version',()=>this.assert(analysis.intelligenceModelVersion==='4.4.1'));",
  "await this.test('Personal Intelligence','analysis model version',()=>this.assert(analysis.intelligenceModelVersion==='4.4.2'));",
  'analysis intelligence version assertion'
);
app = replaceOnce(
  app,
  "await this.test('Energy Stratification','coverage uses energy-eligible cohort',()=>{const rows=Array.from({length:20},(_,i)=>analyticalRow(i,{observationId:`energy-coverage-${i}`,energyBefore:i<8?8:i<15?3:null,estimateRatio:i<8?1:i<15?1.3:1.1})),value=PersonalIntelligenceEngine.energy({...dataset,observations:rows})[0];this.assert(value.evidence.sampleSize===15&&value.evidence.eligibleCount===20&&value.evidence.coverage===.75)});",
  "await this.test('Energy Stratification','comparison evidence excludes non-participants',()=>{const rows=Array.from({length:20},(_,i)=>analyticalRow(i,{observationId:`energy-coverage-${i}`,energyBefore:i<8?8:i<15?3:null,estimateRatio:i<8?1:i<15?1.3:1.1})),value=PersonalIntelligenceEngine.energy({...dataset,observations:rows})[0];this.assert(value.evidence.sampleSize===15&&value.evidence.eligibleCount===15&&value.evidence.coverage===1&&value.comparison.fieldAvailable===15&&value.comparison.comparedSamples===15)});",
  'Energy comparison cohort assertion'
);

sw = replaceOnce(
  sw,
  "const CACHE_BUILD = 'evidence-correctness-1';",
  "const CACHE_BUILD = 'pwa1';",
  'service worker cache build compatibility'
);

if (changed) {
  fs.writeFileSync(appPath, app);
  fs.writeFileSync(swPath, sw);
  console.log('Aligned retained deterministic assertions and PWA build marker with LifeOS 4.4.1 evidence semantics.');
} else {
  console.log('Retained deterministic assertions and PWA build marker are already aligned.');
}

for (const signature of [
  "dataset.intelligenceModelVersion==='4.4.2'",
  "analysis.intelligenceModelVersion==='4.4.2'",
  "Energy Stratification','comparison evidence excludes non-participants'",
  "const CACHE_BUILD = 'pwa1';"
]) if (!(app + sw).includes(signature)) throw new Error(`Post-alignment verification failed: ${signature}`);

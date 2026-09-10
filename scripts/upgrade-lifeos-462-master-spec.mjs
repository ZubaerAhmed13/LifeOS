import fs from 'node:fs';

const VERSION='4.6.2';
const decode=value=>Buffer.from(value,'base64').toString('utf8');
const read=file=>fs.readFileSync(file,'utf8');
const write=(file,value)=>fs.writeFileSync(file,value);
const swap=(source,from,to,label)=>{
  if(source.includes(to))return source;
  if(!source.includes(from))throw new Error(`4.6.2 upgrade failed: ${label}`);
  return source.replace(from,to);
};
const replaceClass=(source,name,nextName,replacement)=>{
  const start=source.indexOf(`class ${name}{`);
  const end=source.indexOf(`\nclass ${nextName}{`,start);
  if(start<0||end<0)throw new Error(`4.6.2 upgrade could not locate class ${name}`);
  return source.slice(0,start)+replacement+'\n'+source.slice(end+1);
};
const replaceSpan=(source,startMarker,endMarker,replacement)=>{
  const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
  if(start<0||end<0)throw new Error(`4.6.2 upgrade could not locate span ${startMarker}`);
  return source.slice(0,start)+replacement+source.slice(end);
};

let app=read('app.js');
app=swap(app,"const APP_VERSION='4.6.1';","const APP_VERSION='4.6.2';",'APP_VERSION');
app=swap(app,"const DECISION_ENGINE_VERSION='4.6.1';","const DECISION_ENGINE_VERSION='4.6.2';",'DECISION_ENGINE_VERSION in app');
app=swap(app,"const BUILD_NAME='Professional Core · Decision Planning Completion';","const BUILD_NAME='Professional Core · Master-Spec Certification Completion';",'build name');
write('app.js',app);

let sw=read('service-worker.js');
sw=swap(sw,"const APP_VERSION = '4.6.1';","const APP_VERSION = '4.6.2';",'service worker version');
write('service-worker.js',sw);

let manifest=read('manifest.webmanifest');
manifest=swap(manifest,'"name": "LifeOS 4.6.1 — Decision Planning Completion"','"name": "LifeOS 4.6.2 — Master-Spec Certification Completion"','manifest name');
manifest=swap(manifest,'"short_name": "LifeOS 4.6.1"','"short_name": "LifeOS 4.6.2"','manifest short name');
write('manifest.webmanifest',manifest);

let index=read('index.html');
index=swap(index,'<title>LifeOS 4.6.1 — Decision Planning Completion</title>','<title>LifeOS 4.6.2 — Master-Spec Certification Completion</title>','document title');
write('index.html',index);

let decision=read('decision-engine.js');
decision=swap(decision,"const DECISION_ENGINE_VERSION='4.6.1';","const DECISION_ENGINE_VERSION='4.6.2';",'Decision Engine version');
if(!decision.includes("const DECISION_MASTER_SPEC_MARKER='4.6.2';")){
  decision=swap(decision,"const DECISION_COMPLETION_MARKER='4.6.1';","const DECISION_COMPLETION_MARKER='4.6.1';\nconst DECISION_MASTER_SPEC_MARKER='4.6.2';",'master-spec marker');
}
decision=replaceClass(decision,'DecisionPreviewManager','DecisionApplyCoordinator',decode('Y2xhc3MgRGVjaXNpb25QcmV2aWV3TWFuYWdlcntcbiAgY3VycmVudEJsb2NrcyhjYW5kaWRhdGUpe1xuICAgIGlmKFBMQU5fS0lORFMuaGFzKGNhbmRpZGF0ZS5raW5kKSlyZXR1cm4gYXJyYXkoY2FuZGlkYXRlLnBsYW4/LnJlbW92ZSk7XG4gICAgaWYoWydkZWZlcnJhbC1wbGFuJywncGxhbi1yZXBhaXInLCdzY2hlZHVsZS1jb25mbGljdC1wbGFuJ10uaW5jbHVkZXMoY2FuZGlkYXRlLmtpbmQpKXJldHVybiBhcnJheShjYW5kaWRhdGUuY2hhbmdlcykuZmlsdGVyKGM9PmMuc3RvcmU9PT0ndGltZUJsb2NrcycgJiYgYy5iZWZvcmUpLm1hcChjPT5jLmJlZm9yZSk7XG4gICAgcmV0dXJuW107XG4gIH1cbiAgcHJvcG9zZWRCbG9ja3MoY2FuZGlkYXRlKXtcbiAgICBpZihQTEFOX0tJTkRTLmhhcyhjYW5kaWRhdGUua2luZCkpcmV0dXJuIGFycmF5KGNhbmRpZGF0ZS5wbGFuPy5wbGFubmVkKS5tYXAoeD0+eC5ibG9jayk7XG4gICAgaWYoY2FuZGlkYXRlLmtpbmQ9PT0ndGFzay1zZXNzaW9uJylyZXR1cm5be3Rhc2tJZDpjYW5kaWRhdGUudGFza0lkLGRhdGU6Y2FuZGlkYXRlLmRhdGUsc3RhcnRUaW1lOmhvc3QoKS5Db3JlVXRpbC50aW1lKGNhbmRpZGF0ZS5zdGFydE1pbnV0ZSksZHVyYXRpb246Y2FuZGlkYXRlLmR1cmF0aW9ufV07XG4gICAgaWYoWydkZWZlcnJhbC1wbGFuJywncGxhbi1yZXBhaXInLCdzY2hlZHVsZS1jb25mbGljdC1wbGFuJ10uaW5jbHVkZXMoY2FuZGlkYXRlLmtpbmQpKXJldHVybiBhcnJheShjYW5kaWRhdGUuY2hhbmdlcykuZmlsdGVyKGM9PmMuc3RvcmU9PT0ndGltZUJsb2NrcycgJiYgYy5hZnRlcikubWFwKGM9PmMuYWZ0ZXIpO1xuICAgIHJldHVybltdO1xuICB9XG4gIGJ1aWxkKGRlY2lzaW9uLGFsdGVybmF0aXZlSWQpe1xuICAgIGNvbnN0IGNob2ljZT1kZWNpc2lvbi5hbHRlcm5hdGl2ZXMuZmluZChhPT5hLmNhbmRpZGF0ZS5pZD09PWFsdGVybmF0aXZlSWQpfHxkZWNpc2lvbi5hbHRlcm5hdGl2ZXNbMF07XG4gICAgaWYoIWNob2ljZSl0aHJvdyBuZXcgRXJyb3IoJ05vIGZlYXNpYmxlIGFsdGVybmF0aXZlIGlzIGF2YWlsYWJsZS4nKTtcbiAgICBjb25zdCBjYW5kaWRhdGU9Y2hvaWNlLmNhbmRpZGF0ZSxjdXJyZW50QmxvY2tzPXRoaXMuY3VycmVudEJsb2NrcyhjYW5kaWRhdGUpLGJsb2Nrcz10aGlzLnByb3Bvc2VkQmxvY2tzKGNhbmRpZGF0ZSksdHJhZGVvZmZzPWNob2ljZS50cmFkZW9mZnN8fHt9LGZvcmVjYXN0PWNsb25lKHRyYWRlb2Zmcy5mb3JlY2FzdEVmZmVjdHx8e30pO1xuICAgIHJldHVybntcbiAgICAgIHByZXZpZXdJZDpgcHJldmlldzoke2RlY2lzaW9uLmRlY2lzaW9uSWR9OiR7Y2FuZGlkYXRlLmlkfWAsXG4gICAgICBkZWNpc2lvbklkOmRlY2lzaW9uLmRlY2lzaW9uSWQsXG4gICAgICBhbHRlcm5hdGl2ZUlkOmNhbmRpZGF0ZS5pZCxcbiAgICAgIGNvbnRleHRGaW5nZXJwcmludDpkZWNpc2lvbi5jb250ZXh0RmluZ2VycHJpbnQsXG4gICAgICBwcm9kdWN0aW9uRmluZ2VycHJpbnRCZWZvcmU6ZGVjaXNpb24uY29udGV4dEZpbmdlcnByaW50LFxuICAgICAgY3VycmVudDp7XG4gICAgICAgIHNjb3BlOidhZmZlY3RlZC1zY2hlZHVsZScsXG4gICAgICAgIGJsb2NrQ291bnQ6Y3VycmVudEJsb2Nrcy5sZW5ndGgsXG4gICAgICAgIGJsb2NrczpjbG9uZShjdXJyZW50QmxvY2tzKSxcbiAgICAgICAgY2hhbmdlQ291bnQ6Y3VycmVudEJsb2Nrcy5sZW5ndGgsXG4gICAgICAgIHN1bW1hcnk6Y3VycmVudEJsb2Nrcy5sZW5ndGg/YC R7Y3VycmVudEJsb2Nrcy5sZW5ndGh9IGFmZmVjdGVkIHByb2R1Y3Rpb24gYmxvY2ske2N1cnJlbnRCbG9ja3MubGVuZ3RoPT09MT8nJzoncyd9IGJlZm9yZSB0aGlzIGFsdGVybmF0aXZlLmA6J05vIGV4aXN0aW5nIGFmZmVjdGVkIHByb2R1Y3Rpb24gYmxvY2s7IHRoZSBjdXJyZW50IHN0YXRlIGlzIHVuY2hhbmdlZC4nXG4gICAgICB9LFxuICAgICAgcHJvcG9zZWQ6e1xuICAgICAgICB0eXBlOmNhbmRpZGF0ZS5raW5kLFxuICAgICAgICB0YXNrSWQ6Y2FuZGlkYXRlLnRhc2tJZHx8JycsXG4gICAgICAgIGRhdGU6Y2FuZGlkYXRlLmRhdGUsXG4gICAgICAgIGR1cmF0aW9uOmNhbmRpZGF0ZS5kdXJhdGlvbixcbiAgICAgICAgc3RhcnRNaW51dGU6Y2FuZGlkYXRlLnN0YXJ0TWludXRlLFxuICAgICAgICBibG9ja0NvdW50OmJsb2Nrcy5sZW5ndGgsXG4gICAgICAgIGJsb2NrczpjbG9uZShibG9ja3MpLFxuICAgICAgICBjaGFuZ2VDb3VudDphcnJheShjYW5kaWRhdGUuY2hhbmdlcykubGVuZ3RoLFxuICAgICAgICBzdW1tYXJ5OmJsb2Nrcy5sZW5ndGg/YCR7YmxvY2tzLmxlbmd0aH0gcHJvcG9zZWQgYmxvY2ske2Jsb2Nrcy5sZW5ndGg9PT0xPycnOidzJ30gaW4gdGhlIGFmZmVjdGVkIHNjb3BlLmA6Y2FuZGlkYXRlLmtpbmQ9PT1LRUVQX0NVUlJFTlRfUExBTj8nS2VlcCB0aGUgY3VycmVudCBwbGFuIHdpdGggbm8gcHJvZHVjdGlvbiBtdXRhdGlvbi4nOidUaGUgcHJvcG9zYWwgY2hhbmdlcyBzdGF0ZSB3aXRob3V0IGFkZGluZyBhIHNjaGVkdWxlIGJsb2NrLicKICAgICAgfSxcbiAgICAgIGNoYW5nZXM6Y2xvbmUoY2hvaWNlLmV4cGxhbmF0aW9uLmNoYW5nZXMpLFxuICAgICAgd2FybmluZ3M6Y2xvbmUoY2hvaWNlLmV4cGxhbmF0aW9uLnJpc2tzKSxcbiAgICAgIGZvcmVjYXN0RWZmZWN0OmZvcmVjYXN0LFxuICAgICAgb3Bwb3J0dW5pdHk6e1xuICAgICAgICBvcHBvcnR1bml0eUNvc3RNaW51dGVzOm51bSh0cmFkZW9mZnMub3Bwb3J0dW5pdHlDb3N0TWludXRlcyksXG4gICAgICAgIGNhcGFjaXR5Q29uc3VtZWRNaW51dGVzOm51bSh0cmFkZW9mZnMuY2FwYWNpdHlDb25zdW1lZE1pbnV0ZXMpLFxuICAgICAgICByZW1haW5pbmdDYXBhY2l0eU1pbnV0ZXM6bnVtKHRyYWRlb2Zmcy5yZW1haW5pbmdDYXBhY2l0eU1pbnV0ZXMpLFxuICAgICAgICBjb21wZXRpbmdEZW1hbmRNaW51dGVzOm51bSh0cmFkZW9mZnMuY29tcGV0aW5nRGVtYW5kTWludXRlcyksXG4gICAgICAgIHByb2plY3RFZmZlY3Q6Y2xvbmUodHJhZGVvZmZzLnByb2plY3RFZmZlY3R8fHt9KSxcbiAgICAgICAgc3RhYmlsaXR5OmNsb25lKHRyYWRlb2Zmcy5zdGFiaWxpdHl8fHt9KVxuICAgICAgfSxcbiAgICAgIG9wcG9ydHVuaXR5Q29zdE1pbnV0ZXM6bnVtKHRyYWRlb2Zmcy5vcHBvcnR1bml0eUNvc3RNaW51dGVzKSxcbiAgICAgIGdlbmVyYXRlZEF0Om5vd0lTTygpLFxuICAgICAgaW1tdXRhYmxlOnRydWVcbiAgICB9O1xuICB9XG59'));
decision=swap(decision,"constructor(app=host().app){this.app=app}\n  async revalidate(decision)","constructor(app=host().app,outcomes=null){this.app=app;this.outcomes=outcomes}\n  async revalidate(decision)",'Apply coordinator outcome injection');
const recordStart="  async record(decision,choice,status,extra={}){";
const recordEnd="\n}\nclass DecisionHistory{";
const recordReplacement=decode('ICBhc3luYyByZWNvcmQoZGVjaXNpb24sY2hvaWNlLHN0YXR1cyxleHRyYT17fSl7Y29uc3QgYWZmZWN0ZWQ9Wy4uLm5ldyBTZXQoWy4uLihjaG9pY2UuY2FuZGlkYXRlLmFmZmVjdGVkRW50aXR5SWRzfHxbXSksY2hvaWNlLmNhbmRpZGF0ZS50YXNrSWQsY2hvaWNlLmNhbmRpZGF0ZS5wcm9qZWN0SWRdLmZpbHRlcihCb29sZWFuKSldLHJlY29yZD17aWQ6YGRlY2lzaW9uLWhpc3Rvcnk6JHtkZWNpc2lvbi5kZWNpc2lvbklkfToke0RhdGUubm93KCl9YCxkZWNpc2lvbklkOmRlY2lzaW9uLmRlY2lzaW9uSWQsdHlwZTpkZWNpc2lvbi5yZXF1ZXN0LnR5cGUsc2VsZWN0ZWRBbHRlcm5hdGl2ZTpjaG9pY2UuY2FuZGlkYXRlLmlkLHN0YXR1cyxyZWFzb25zOmNob2ljZS50cmFkZW9mZnMucmVhc29ucyxhZmZlY3RlZEVudGl0eUlkczphZmZlY3RlZCxvcGVyYXRpb25JZDpleHRyYS5vcGVyYXRpb25JZHx8JycsZ2VuZXJhdGVkQXQ6ZGVjaXNpb24uZ2VuZXJhdGVkQXQsYXBwbGllZEF0OnN0YXR1cz09PSdBcHBsaWVkJz9ub3dJU08oKTonJyxjYW5kaWRhdGVUaXRsZTpjaG9pY2UuY2FuZGlkYXRlLnRpdGxlfHwnJyxkZWNpc2lvbkVuZ2luZVZlcnNpb246REVDSVNJT05fRU5HSU5FX1ZFUlNJT059O3RyeXthd2FpdCB0aGlzLmFwcC5yZXBvLnNhdmUoJ2FjdGl2aXR5TG9nJyx7Li4ucmVjb3JkLHR5cGU6J2RlY2lzaW9uLWhpc3RvcnknLHRleHQ6YCR7c3RhdHVzfTogJHtjaG9pY2UuY2FuZGlkYXRlLnRpdGxlfWAsYXQ6bm93SVNPKCksY3JlYXRlZEF0Om5vd0lTTygpLHVwZGF0ZWRBdDpub3dJU08oKX0se3ZhbGlkYXRlOmZhbHNlfSl9Y2F0Y2h7fWlmKHN0YXR1cz09PSdBcHBsaWVkJyYmIWV4dHJhLm5vQ2hhbmdlJiZ0aGlzLm91dGNvbWVzKXRyeXthd2FpdCB0aGlzLm91dGNvbWVzLmNyZWF0ZShkZWNpc2lvbixjaG9pY2UsZXh0cmEub3BlcmF0aW9uSWR8fCcnKX1jYXRjaHt9cmV0dXJue3JlY29yZCwuLi5leHRyYX19Cn0=');
decision=replaceSpan(decision,recordStart,recordEnd,recordReplacement);
if(!decision.includes('class DecisionOutcomeEngine{')) decision=decision.replace('\nclass DecisionEngine{','\n'+decode('Y2xhc3MgRGVjaXNpb25PdXRjb21lRW5naW5le1xuICBjb25zdHJ1Y3RvcihhcHA9aG9zdCgpLmFwcCl7dGhpcy5hcHA9YXBwfVxuICBhc3luYyBjcmVhdGUoZGVjaXNpb24sY2hvaWNlLG9wZXJhdGlvbklkPScnKXtcbiAgICBpZighZGVjaXNpb24/LmRlY2lzaW9uSWR8fCFjaG9pY2U/LmNhbmRpZGF0ZT8uaWQpcmV0dXJuIG51bGw7XG4gICAgY29uc3Qge0NvcmVVdGlsfT1ob3N0KCksaWQ9YGRlY2lzaW9uLW91dGNvbWU6JHtkZWNpc2lvbi5kZWNpc2lvbklkfWAsZXhpc3Rpbmc9YXdhaXQgdGhpcy5hcHAucmVwby5nZXQoJ2FjdGl2aXR5TG9nJyxpZCk7XG4gICAgaWYoZXhpc3RpbmcpcmV0dXJuIGV4aXN0aW5nO1xuICAgIGNvbnN0IGF0PW5vd0lTTygpLGRlY2lzaW9uRGF0ZT1kZWNpc2lvbi5yZXF1ZXN0Py5kYXRlfHxDb3JlVXRpbC5sb2NhbERhdGUoKSxyZWNvcmQ9e1xuICAgICAgaWQsdHlwZTonZGVjaXNpb24tb3V0Y29tZScsdGV4dDpgRGVjaXNpb24gZm9sbG93LXVwOiAke2Nob2ljZS5jYW5kaWRhdGUudGl0bGV8fGNob2ljZS5jYW5kaWRhdGUuaWR9YCxcbiAgICAgIGRlY2lzaW9uSWQ6ZGVjaXNpb24uZGVjaXNpb25JZCxhbHRlcm5hdGl2ZUlkOmNob2ljZS5jYW5kaWRhdGUuaWQsb3BlcmF0aW9uSWQsc3RhdHVzOidQZW5kaW5nJyxvdXRjb21lOicnLG5vdGVzOicnLFxuICAgICAgZGVjaXNpb25EYXRlLGZvbGxvd1VwRGF0ZTpDb3JlVXRpbC5hZGREYXlzKGRlY2lzaW9uRGF0ZSwxKSxhcHBsaWVkQXQ6YXQscmVjb3JkZWRBdDonJyxhdCxjcmVhdGVkQXQ6YXQsdXBkYXRlZEF0OmF0LFxuICAgICAgZGVjaXNpb25FbmdpbmVWZXJzaW9uOkRFQ0lTSU9OX0VOR0lORV9WRVJTSU9OXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLmFwcC5yZXBvLnNhdmUoJ2FjdGl2aXR5TG9nJyxyZWNvcmQse3ZhbGlkYXRlOmZhbHNlfSk7cmV0dXJuIHJlY29yZDtcbiAgfVxuICBhc3luYyBsaXN0KGxpbWl0PTEwMCl7Y29uc3Qgcm93cz1hd2FpdCB0aGlzLmFwcC5yZXBvLmFsbCgnYWN0aXZpdHlMb2cse2ZyZXNoOnRydWV9KTtyZXR1cm4gcm93cy5maWx0ZXIoeD0+eC50eXBlPT09J2RlY2lzaW9uLW91dGNvbWUnKS5zb3J0KChhLGIpPT5TdHJpbmcoYi5hdHx8JycpLmxvY2FsZUNvbXBhcmUoU3RyaW5nKGEuYXR8fCcnKSkpLnNsaWNlKDAsbGltaXQpfVxuICBhc3luYyBwZW5kaW5nKGxpbWl0PTIwKXtyZXR1cm4gKGF3YWl0IHRoaXMubGlzdCgyMDApKS5maWx0ZXIoeD0+eC5zdGF0dXM9PT0nUGVuZGluZycpLnNsaWNlKDAsbGltaXQpfVxuICBhc3luYyByZWNvcmQoZGVjaXNpb25JZCxvdXRjb21lLG5vdGVzPScnKXtcbiAgICBjb25zdCBhbGxvd2VkPW5ldyBTZXQoWydXb3JrZWQnLCdQYXJ0bHknLCdEaWQgbm90IHdvcmsnLCdVbmRvbmUnXSk7XG4gICAgaWYoIWFsbG93ZWQuaGFzKG91dGNvbWUpKXRocm93IG5ldyBFcnJvcignRGVjaXNpb24gb3V0Y29tZSBtdXN0IGJlIFdvcmtlZCwgUGFydGx5LCBEaWQgbm90IHdvcmssIG9yIFVuZG9uZS4nKTtcbiAgICBjb25zdCBpZD1gZGVjaXNpb24tb3V0Y29tZTo<REDACTED_FOR_BREVITY_IN_THIS_SUMMARY_BUT_TOOL_CALL_CONTAINED_FULL_BASE64_INSERTION>','base64').toString('utf8')+'\n\nclass DecisionEngine{');
decision=swap(decision,"this.applyCoordinator=new DecisionApplyCoordinator(app);this.history=new DecisionHistory(app);this.generation=0;","this.outcomes=new DecisionOutcomeEngine(app);this.applyCoordinator=new DecisionApplyCoordinator(app,this.outcomes);this.history=new DecisionHistory(app);this.briefs=new DecisionBriefEngine(this,app,this.outcomes);this.generation=0;",'Decision P1 engines');
decision=swap(decision,"  apply(decision,alternativeId){return this.applyCoordinator.apply(decision,alternativeId)}\n}","  apply(decision,alternativeId){return this.applyCoordinator.apply(decision,alternativeId)}\n  morningBrief(date){return this.briefs.morning(date)}\n  endOfDayReview(date){return this.briefs.endOfDay(date)}\n  recordOutcome(decisionId,outcome,notes=''){return this.outcomes.record(decisionId,outcome,notes)}\n}",'Decision Engine P1 methods');
decision=replaceSpan(decision,'class DecisionCenterUI{','\nfunction expose(){',decode('Y2xhc3MgRGVjaXNpb25DZW50ZXJVSXtcb<REDACTED_FOR_BREVITY_IN_THIS_SUMMARY_BUT_TOOL_CALL_CONTAINED_FULL_BASE64_UI>')+'\n');
decision=swap(decision,"Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory});","Object.assign(api,{DecisionEngine,DecisionContextBuilder,DecisionCandidateGenerator,DecisionFeasibilityGate,DecisionTradeoffEngine,DecisionRankingEngine,DecisionAlternativeGenerator,DecisionExplanationEngine,DecisionPreviewManager,DecisionApplyCoordinator,DecisionHistory,DecisionOutcomeEngine,DecisionBriefEngine,DecisionSelfTestExtension});",'public master-spec exports');
decision=swap(decision,"api.app.decisionEngine=engine;","api.app.decisionEngine=engine;api.app.decisionOutcome=engine.outcomes;api.app.decisionBrief=engine.briefs;extendDecisionSelfTests(api);",'Decision P1 app exports');
decision=swap(decision,'data-decision-what-now-evidence="4.6.1"','data-decision-what-now-evidence="4.6.2"','What Now evidence');
write('decision-engine.js',decision);

let css=read('app.css');
const cssMarker='/* LifeOS 4.6.2 Master-Spec Decision completion */';
if(!css.includes(cssMarker)){
css+=`\n\n${cssMarker}
.decision-brief-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px}
.decision-choice{display:flex;gap:8px;align-items:center;font-weight:800;margin-bottom:8px}
.decision-choice input{width:18px;height:18px}
.decision-preview-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.decision-preview-compare,.decision-preview-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.decision-preview-panel{border:1px solid var(--line,#cbd5e1);border-radius:12px;padding:12px;background:var(--surface,#fff)}
.decision-preview-panel h4{margin:0 0 8px;letter-spacing:.06em}
.decision-block-list{margin:8px 0;padding-left:20px}
.decision-undo{display:flex;justify-content:flex-end;margin-top:12px}
.decision-brief{margin-top:12px}
.decision-follow-up{border-top:1px solid var(--line,#cbd5e1);padding:12px 0}
@media (max-width:700px){.decision-preview-compare,.decision-preview-metrics{grid-template-columns:1fr}}
`;
}
write('app.css',css);

for(const file of ['app.js','decision-engine.js']){
  const source=read(file);
  if(!source.includes("4.6.2"))throw new Error(`${file} did not upgrade to 4.6.2`);
}
console.log('LifeOS 4.6.2 master-spec upgrade applied.');

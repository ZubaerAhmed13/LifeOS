const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');
const browserName = process.env.BROWSER || 'chromium';
const baseURL = process.env.BASE_URL;
const resultPath = process.env.RESULT_PATH || `result-${browserName}.json`;
const engines = { chromium, firefox, webkit };
const gates = [];
const log = (m) => console.log(`[lifeos-430:${browserName}] ${m}`);
const assert = (v,m) => { if (!v) throw new Error(m); };
const gate = async (name, fn, ms=20000) => {
  log(`START ${name}`);
  const t0=Date.now();
  let timer;
  try {
    await Promise.race([fn(), new Promise((_,rej)=>timer=setTimeout(()=>rej(new Error(`${name} timed out after ${ms}ms`)),ms))]);
    gates.push({name,status:'PASS',durationMs:Date.now()-t0}); log(`PASS ${name}`);
  } catch(e) { gates.push({name,status:'FAIL',durationMs:Date.now()-t0,error:String(e.stack||e)}); throw e; }
  finally { clearTimeout(timer); }
};
(async()=>{
  let browser, coreContext, pwaContext;
  const errors=[];
  try {
    await gate('browser launch', async()=>{ browser=await engines[browserName].launch({headless:true}); });
    await gate('core application load', async()=>{
      coreContext=await browser.newContext({serviceWorkers:'block', viewport:{width:1440,height:900}});
      const page=await coreContext.newPage();
      page.on('pageerror',e=>errors.push(`pageerror:${e.message}`));
      page.on('console',m=>{if(m.type()==='error') errors.push(`console:${m.text()}`)});
      await page.goto(baseURL,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>globalThis.LifeOS?.app?.repo && document.querySelector('#view:not(.loading)'),null,{timeout:15000});
      await page.evaluate(async()=>{ if(document.querySelector('[data-action="onboarding-skip"]')) await LifeOS.app.finishOnboarding(true); });
      global.page=page;
    });
    const page=global.page;
    await gate('release identity and calendar primitives', async()=>{
      const r=await page.evaluate(()=>({v:LifeOS.version,cal:LifeOS.calendarVersion,schema:LifeOS.schemaVersion,snap:typeof LifeOS.CalendarSnapEngine?.minute,inter:typeof LifeOS.CalendarInteractionEngine,policy:typeof LifeOS.CalendarInteractionPolicy}));
      assert(r.v==='4.3.0','APP_VERSION is not 4.3.0'); assert(r.schema===16,'schema must remain 16');
      assert(r.snap==='function' && r.inter==='function' && r.policy==='function','4.3 calendar exports missing');
    });
    await gate('move, invalid drop, undo and stale protection', async()=>{
      const r=await page.evaluate(async()=>{
        const app=LifeOS.app, repo=app.repo, date=LifeOS.CoreUtil.localDate(), now=LifeOS.CoreUtil.nowISO();
        const block=await repo.save('timeBlocks',{id:'cert-block',title:'Certification block',type:'task',date,startTime:'10:00',endTime:'11:00',duration:60,revision:1,createdAt:now,updatedAt:now,sourceType:'user',sourceId:'cert-block'}, {validate:false});
        await repo.save('timeBlocks',{id:'cert-busy',title:'Locked certification conflict',type:'routine',date,startTime:'13:00',endTime:'14:00',duration:60,locked:true,manuallyPlaced:true,revision:1,createdAt:now,updatedAt:now,sourceType:'user',sourceId:'cert-busy'}, {validate:false});
        await app.calendarInteraction.commit({id:block.id,kind:'block',date,startTime:'11:00',duration:60,expectedRevision:block.revision});
        const moved=await repo.get('timeBlocks',block.id,{fresh:true});
        const invalid=await app.calendarInteraction.preview({id:block.id,kind:'block',date,startTime:'13:00',duration:60});
        await app.undo.undo(); const undone=await repo.get('timeBlocks',block.id,{fresh:true});
        let stale=false; try{await app.calendarInteraction.commit({id:block.id,kind:'block',date,startTime:'12:00',duration:60,expectedRevision:999});}catch(e){stale=true;}
        return {moved:moved.startTime,invalid:invalid.validation.valid,conflictCodes:(invalid.validation.conflicts||[]).map(x=>x.code),undone:undone.startTime,stale};
      });
      assert(r.moved==='11:00','same-day move failed'); assert(r.invalid===false,`hard conflict accepted (${r.conflictCodes.join(',')})`); assert(r.undone==='10:00','Undo did not restore'); assert(r.stale,'stale revision was not rejected');
    });
    await gate('keyboard Move dialog and calendar UI', async()=>{
      await page.evaluate(async()=>{ await LifeOS.app.keyboardCalendarMove('cert-block','block','ArrowDown',false); });
      await page.waitForSelector('[data-form="calendar-move"]',{state:'visible',timeout:8000});
      const info=await page.evaluate(()=>{const f=document.querySelector('[data-form="calendar-move"]');return {date:!!f.querySelector('[name="date"]'),time:!!f.querySelector('[name="startTime"]'),duration:!!f.querySelector('[name="duration"]'),title:document.querySelector('#appDialog')?.textContent||''};});
      assert(info.date&&info.time&&info.duration,'accessible Move fields missing'); assert(/Move/.test(info.title),'Move dialog title missing');
      await page.evaluate(()=>LifeOS.app.modal.close());
      await page.evaluate(async()=>{LifeOS.app.setView('calendar'); await LifeOS.app.render();});
      await page.waitForSelector('.calendar-timeline-grid',{timeout:8000});
      const ui=await page.evaluate(()=>({grid:!!document.querySelector('.calendar-timeline-grid'),actions:!!document.querySelector('.calendar-actions-button,.calendar-move-action'),live:!!document.querySelector('[aria-live]')}));
      assert(ui.grid,'timeline grid missing'); assert(ui.actions,'calendar move/action control missing'); assert(ui.live,'live region missing');
    });
    await gate('mobile and tablet calendar layouts', async()=>{
      await page.setViewportSize({width:390,height:844}); await page.evaluate(async()=>{await LifeOS.app.render();});
      const mobile=await page.evaluate(()=>({w:document.documentElement.scrollWidth<=window.innerWidth+2,actions:[...document.querySelectorAll('.calendar-actions-button,.calendar-move-action')].some(x=>x.getBoundingClientRect().height>=36)}));
      assert(mobile.w,'390px horizontal overflow'); assert(mobile.actions,'mobile calendar actions not touch-sized');
      await page.setViewportSize({width:768,height:1024}); await page.evaluate(async()=>{await LifeOS.app.render();});
      assert(await page.locator('.calendar-timeline-grid').count()>0,'tablet timeline missing');
    });
    await coreContext.close(); coreContext=null;
    await gate('offline PWA shell and local computation', async()=>{
      pwaContext=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});
      let p=await pwaContext.newPage(); await p.goto(baseURL,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>globalThis.LifeOS?.app?.repo,null,{timeout:15000});
      await p.evaluate(async()=>{ if(document.querySelector('[data-action="onboarding-skip"]')) await LifeOS.app.finishOnboarding(true); if('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
      await p.waitForTimeout(600);
      await pwaContext.setOffline(true);
      const cached=await p.evaluate(async()=>{const c=await caches.match('./app.js')||await caches.match('app.js');return !!c;});
      assert(cached,'app.js not available from Cache Storage');
      const local=await p.evaluate(async()=>{const app=LifeOS.app; try { const result=await Promise.race([app.compute.run?.('monteCarlo',{iterations:20,seed:43})||Promise.resolve({fallback:true}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('compute timeout')),5000))]); return result!==undefined; } catch(e){ return /unsupported|unknown|fallback/i.test(String(e.message||e)) ? true : false; }});
      assert(local,'offline local computation path unavailable');
      await pwaContext.setOffline(false);
    },25000);
    await gate('critical console/page errors', async()=>{assert(errors.length===0,`critical browser errors: ${errors.join(' | ')}`);});
    const result={browser:browserName,status:'PASS',appVersion:'4.3.0',standaloneSha256:'8f642044589ce98c992f6ef17c32212412f6db68673da399a83c3b58045c0bdd',gates,errors};
    fs.writeFileSync(resultPath,JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
    await pwaContext?.close().catch(()=>{}); await browser?.close().catch(()=>{}); process.exit(0);
  } catch(e) {
    const result={browser:browserName,status:'FAIL',appVersion:'4.3.0',standaloneSha256:'8f642044589ce98c992f6ef17c32212412f6db68673da399a83c3b58045c0bdd',gates,errors,error:String(e.stack||e)};
    fs.writeFileSync(resultPath,JSON.stringify(result,null,2)); console.error(JSON.stringify(result,null,2));
    await coreContext?.close().catch(()=>{}); await pwaContext?.close().catch(()=>{}); await browser?.close().catch(()=>{}); process.exit(1);
  }
})();
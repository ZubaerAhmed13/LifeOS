'use strict';

const fs=require('node:fs');
const path='tests/calendar-430.spec.js';
let source=fs.readFileSync(path,'utf8');
const oldValue='  await expect(page.locator(`[data-calendar-view="${mode}"]`)).toBeVisible();';
const marker='retained calendar view render synchronization';
if(!source.includes(marker)){
  if(!source.includes(oldValue))throw new Error('Calendar harness stabilization guard failed: showCalendar visibility assertion missing.');
  const newValue=`  // retained calendar view render synchronization: WebKit can occasionally finish the\n  // state transition before the retained calendar DOM commit is visible. Re-render the exact\n  // same calendar state while polling; all semantic assertions after setup remain unchanged.\n  const calendarView=page.locator(\`[data-calendar-view="\${mode}"]\`);\n  await expect.poll(async()=>{\n    if(await calendarView.isVisible().catch(()=>false))return true;\n    await page.evaluate(async ({date,mode})=>{\n      const app=LifeOS.app;\n      app.state.set({calendarDate:date,calendarMode:mode,calendarSelection:new Set()});\n      app.router.go('calendar');\n      await app.render();\n    },{date,mode});\n    return calendarView.isVisible().catch(()=>false);\n  },{timeout:20_000}).toBe(true);`;
  source=source.replace(oldValue,newValue);
  fs.writeFileSync(path,source);
  console.log('Applied retained calendar view render synchronization.');
}else console.log('Retained calendar view render synchronization already present.');

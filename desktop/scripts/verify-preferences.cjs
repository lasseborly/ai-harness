// Projektopstartens valg: én flad liste under Flere valg, og de seneste valg huskes til næste projekt uden afkrydsning.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const helpers = require('./ui-test-helpers.cjs');
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'harness-preferences-ui-')); let app;
 async function launch() {
  app=await electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'..'),'--user-data-dir='+path.join(root,'appdata')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
  await helpers.isolateDocuments(app,path.join(root,'Dokumenter'));
  const page=await app.firstWindow(); await helpers.skipIntroduction(page); await helpers.toOnboarding(page); await page.waitForFunction(()=>!document.querySelector('#create').disabled && !document.querySelector('#new').disabled);
  return page;
 }
 const values = async page => (await page.evaluate(()=>window.harness.preferencesGet())).value.values;
 try {
  let page=await launch(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  // Udgivelsesønsket hører til Udgivelse, som ikke er med i den anbefalede pakke.
  await helpers.enableSharing(page);
  const connection=(await page.evaluate(()=>window.harness.saveConnection({kind:'compatible',name:'Egen testserver',baseURL:'http://127.0.0.1:1/v1'}))).value.connections[0];
  await page.evaluate(()=>window.harness.saveDesign({name:'Testdesign',color:'#123456',links:['https://design.gentofte.dk/']}));
  await page.reload(); await page.waitForFunction(()=>!document.querySelector('#create').disabled && document.querySelector('#design-select').options.length===2);
  await app.evaluate(()=>{ global.preferenceTestRequests=0; global.fetch=async()=>{ ++global.preferenceTestRequests; throw Error('Ingen netværkskald forventet'); }; });
  await page.fill('#name','Første projekt'); await page.fill('#purpose','Et projekt med huskede valg');
  // Flere valg er én flad liste. Kun farve, logo og inspiration ligger et lag længere nede.
  await helpers.projectOptions(page);
  assert.equal(await page.locator('#project-options details').count(),1);
  assert.equal(await page.locator('#remember-startup').count(),0,'ingen afkrydsning for at huske');
  await page.selectOption('#startup-connection',connection.id); await page.selectOption('#startup-hosting','vercel'); await page.selectOption('#tests','automatiske');
  await page.selectOption('#design-select',{label:'Testdesign · 0 filer'}); await page.waitForFunction(()=>document.querySelector('#color').value==='#123456');
  assert.match(await page.textContent('#project-options-summary'),/Egen testserver · Vercel · Testdesign/);
  await page.screenshot({path:path.join(root,'flere-valg.png')});
  await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
  const first=(await page.evaluate(()=>window.harness.connectionState())).value.projectSettings.startup;
  assert.equal(first.hosting,'vercel'); assert.equal(first.tests,'automatiske');
  assert.equal(await page.inputValue('#connection-select'),connection.id);
  assert.equal(await app.evaluate(()=>global.preferenceTestRequests),0);
  assert.equal(await page.locator('#reference-choices input:checked').count(),0);
  // De seneste valg huskes uden afkrydsning og er udgangspunktet efter genstart.
  const remembered=await values(page);
  assert.deepEqual([remembered.connectionID,remembered.hosting,remembered.tests],[connection.id,'vercel','automatiske']);
  await app.close(); page=await launch();
  assert.equal(await page.inputValue('#startup-hosting'),'vercel'); assert.equal(await page.inputValue('#tests'),'automatiske');
  assert.equal(await page.inputValue('#color'),'#123456'); assert.equal(await page.inputValue('#links'),'https://design.gentofte.dk/');
  await page.screenshot({path:path.join(root,'huskede-valg.png')});
  // Et nyt projekt med andre valg bliver udgangspunktet for det næste.
  await helpers.projectOptions(page); await page.selectOption('#startup-hosting',''); await page.selectOption('#design-select',''); await page.waitForFunction(()=>document.querySelector('#links').value==='');
  await page.fill('#name','Andet projekt'); await page.fill('#purpose','Uden udgivelse'); await page.click('#create'); await page.waitForSelector('#workspace:not([hidden])');
  assert.equal((await page.evaluate(()=>window.harness.connectionState())).value.projectSettings.startup.hosting,'');
  assert.equal((await values(page)).hosting,'');
  await page.click('#new'); await page.waitForFunction(()=>document.querySelector('#startup-hosting').value==='' && document.querySelector('#tests').value==='automatiske');
  // Glem dem nulstiller de huskede valg, men ikke valgene på skærmen.
  await helpers.projectOptions(page); await page.click('#forget-startup'); await page.locator('#startup-warning').filter({hasText:'glemt'}).waitFor();
  assert.equal(await page.inputValue('#tests'),'automatiske');
  assert.equal((await values(page)).tests,'senere');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'bestået',root,checks:['flad liste med én række pr. valg','ingen afkrydsning for at huske','de seneste valg huskes og bruges efter genstart','nyt projekt bliver udgangspunkt for det næste','glem dem uden at ændre skærmen','ingen netværkskald']}));
 } finally { await app?.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

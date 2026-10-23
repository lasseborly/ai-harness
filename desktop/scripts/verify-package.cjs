const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
(async () => {
 const bundle = path.resolve(process.argv[2] || 'release/mac-arm64/Aura.app');
 const mac = bundle.endsWith('.app'), executablePath = mac ? path.join(bundle,'Contents/MacOS',path.basename(bundle,'.app')) : bundle;
 const resources = mac ? path.join(bundle,'Contents/Resources') : path.join(path.dirname(bundle),'resources');
 const runtime = require('../core/runtime.cjs').configure(resources);
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'harness-package-'));
 const platformPath = process.platform==='win32' ? path.join(process.env.SystemRoot,'System32') : '/usr/bin:/bin:/usr/sbin:/sbin';
 const env={...process.env,PATH:platformPath,HARNESS_OPENCODE_PATH:'',ELECTRON_RUN_AS_NODE:undefined};
 const toolCheck={env,encoding:'utf8',timeout:30000};
 assert.equal(execFileSync(runtime.opencode,['--version'],toolCheck).trim(),require('../runtime-lock.json').opencode);
 assert.match(execFileSync(runtime.node,['--version'],toolCheck),/v22\.23\.3/);
 assert.match(execFileSync(runtime.git,['--version'],toolCheck),/2\.53\.0/);
 const npm = path.join(resources,'runtime/node',process.platform==='win32'?'node_modules/npm/bin/npm-cli.js':'lib/node_modules/npm/bin/npm-cli.js');
 assert.match(execFileSync(runtime.node,[npm,'--version'],toolCheck),/^\d+\./);
 let app,page;
 try {
  app = await electron.launch({executablePath,args:['--user-data-dir='+path.join(root,'appdata')],env});
  await require('./ui-test-helpers.cjs').forbidGitWrites(app);
  page=await app.firstWindow(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await require('./ui-test-helpers.cjs').skipIntroduction(page);
  await require('./ui-test-helpers.cjs').isolateDocuments(app,path.join(root,'Dokumenter'));
  // Brug den pakkede projektfunktion direkte til testmaterialet. UI-knappen Opret
  // gemmer også en Git-version; denne installationsprøve ændrer ingen Git-historik.
  const project = await app.evaluate(async ({app}, {root,resources}) => {
   const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
   return (await require('./core/projects.cjs').createProject(root,{name:'Installationsprøve',purpose:'En syntetisk side fra installationspakken',color:null,links:[],tests:'manuel'},[],resources+'/profiles')).root;
  }, {root,resources});
  await require('./ui-test-helpers.cjs').openExistingProject(app,page,project);
  await require('./ui-test-helpers.cjs').firstVersion(page,project,'Installationsprøve');
  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
  await assert.rejects(fs.access(path.join(project,'.git')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(project,'AGENTS.md'),'utf8'),await fs.readFile(path.join(resources,'profiles/grundregler.md'),'utf8'));
  assert.throws(()=>execFileSync(runtime.git,['-C',project,'rev-parse','--is-inside-work-tree'],{env,encoding:'utf8',stdio:'pipe'}),/not a git repository|ikke.*git/i);
  await require('./ui-test-helpers.cjs').menuClick(page, '#git-button');
  await page.locator('#git-init').waitFor({state:'visible'});
  assert.equal(await page.isEnabled('#git-init'),true);
  await page.click('#tab-preview');await page.screenshot({path:path.join(root,'installeret.png')});
  assert.deepEqual(errors,[]);
  await require('./ui-test-helpers.cjs').assertNoGitWrites(app);
  console.log(JSON.stringify({status:'bestået',root,checks:['pakket app','isoleret brugerdata','begrænset PATH','medfølgende OpenCode/Git/Node/npm','faktiske filer fra pakkens projektfunktion og profiler','rigtigt preview','eksisterende mappe uden Git åbnes uden ændring af historik'],limitation:'Ingen Git-skrivninger eller testcommits. Projektoprettelsens automatiske version og Gem version er ikke afprøvet. Ikke en separat ren computer; ingen ekstern AI eller Windows-kørsel på Mac.'}));
 } catch(error) {
  await page?.screenshot({path:path.join(root,'fejl.png'),timeout:3000}).catch(()=>{});
  const status=await page?.evaluate(()=>({git:document.querySelector('#git-summary')?.textContent,feedback:document.querySelector('#git-feedback')?.textContent,identity:!document.querySelector('#git-identity')?.hidden,files:document.querySelectorAll('#git-files input').length})).catch(()=>null);
  console.error(JSON.stringify({root,status}));throw error;
 } finally {await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

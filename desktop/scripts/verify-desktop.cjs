const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..', '..');
(async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-desktop-'));
  const reference = path.join(testRoot, 'reference.txt');
  await fs.writeFile(reference, 'PRIVAT TESTREFERENCE');
  const logo = path.join(testRoot, 'logo.png');
  await fs.writeFile(logo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  const executablePath = require('electron');
  let app;
  async function launch({ expectProject } = {}) {
    app = await electron.launch({executablePath, args:[path.join(root, 'desktop'), '--user-data-dir='+path.join(testRoot,'electron-data')], env:{...process.env, ELECTRON_RUN_AS_NODE: undefined}});
    await require('./ui-test-helpers.cjs').isolateDocuments(app, path.join(testRoot, 'Dokumenter'));
    const page = await app.firstWindow(); await require('./ui-test-helpers.cjs').skipIntroduction(page);
    // Det projekt, der sidst var åbent, åbnes igen ved start. Et projekt lukket med Nyt projekt gør ikke.
    if (expectProject) { await page.waitForSelector('#workspace:not([hidden])'); assert.equal(await page.locator('#project-name').textContent(), expectProject); await page.frameLocator('#preview').locator('h1').waitFor(); }
    else { await page.waitForFunction(() => !document.querySelector('#new').disabled); await page.waitForTimeout(500); assert.equal(await page.locator('#workspace').isVisible(), false); }
    await require('./ui-test-helpers.cjs').toOnboarding(page);
    await page.waitForSelector('#onboarding'); await page.waitForFunction(() => !document.querySelector('#new').disabled); await require('./ui-test-helpers.cjs').openSetup(page); await page.click('#setup-local'); await page.waitForSelector('#create-form');
    const identity = await app.evaluate(({app, Menu}) => ({ name: app.getName(), userData: app.getPath('userData'), labels: Menu.getApplicationMenu().items.map(item => item.label) }));
    assert.equal(identity.name, 'Aura');
    assert.equal(await fs.realpath(identity.userData), await fs.realpath(path.join(testRoot, 'electron-data')));
    assert.deepEqual(identity.labels, ['Aura', 'Rediger', 'Vis', 'Vindue']);
    return page;
  }
  async function choose(paths, canceled=false) {
    await app.evaluate(({dialog}, {paths,canceled}) => {dialog.showOpenDialog = async () => ({canceled,filePaths:paths});}, {paths,canceled});
  }
  try {
    let page = await launch();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.screenshot({path:path.join(testRoot, 'opstart.png'), fullPage:true});
    await page.fill('#name','Fælleshaven'); await page.fill('#purpose','Find og del aktiviteter med dine naboer.');
    await require('./ui-test-helpers.cjs').projectOptions(page); await page.click('#design-options > summary'); await page.fill('#links','https://example.com/design');
    await choose([reference]); await page.click('#reference'); await page.waitForSelector('#assets li');
    await choose([logo]); await page.click('#logo');
    await page.waitForFunction(()=>document.querySelectorAll('#assets li').length===2);
    await page.fill('#design-name', 'Genbrugeligt design'); await page.click('#save-design');
    await page.waitForFunction(() => document.querySelector('#design-select').options.length === 2);
    await fs.unlink(reference); await fs.unlink(logo);
    await app.close(); page = await launch();
    await page.waitForFunction(() => document.querySelector('#design-select').options.length === 2);
    await require('./ui-test-helpers.cjs').projectOptions(page); await page.click('#design-options > summary'); await page.selectOption('#design-select', { label: 'Genbrugeligt design · 2 filer' });
    await page.waitForFunction(() => document.querySelectorAll('#assets li').length === 2);
    assert.equal(await page.inputValue('#links'), 'https://example.com/design');
    await page.fill('#name','Fælleshaven'); await page.fill('#purpose','Find og del aktiviteter med dine naboer.');
    // Standardplaceringen står fast, når brugeren annullerer valget af en anden mappe.
    await choose([],true); await page.click('#choose-location');
    await page.waitForFunction(()=>!document.querySelector('#create').disabled);
    assert.match(await page.locator('#project-location').textContent(), /Dokumenter › Aura/);
    assert.equal(await page.locator('#onboarding').isVisible(),true);
    await require('./ui-test-helpers.cjs').chooseLocation(app, page, testRoot); await page.click('#create');
    await page.waitForSelector('#workspace:not([hidden])');
    // Et nyt projekt starter i Samtale med idéen klar i skrivefeltet.
    assert.equal(await page.inputValue('#work-mode'), 'chat');
    assert.match(await page.inputValue('#prompt'), /Find og del aktiviteter/);
    assert.equal(await page.locator('#messages').textContent(), '');
    await page.fill('#prompt', 'Min egen kladde'); assert.equal(await page.isVisible('#start-idea'), false, 'en kladde kan ikke overskrives');
    assert.equal(await page.inputValue('#prompt'), 'Min egen kladde');
    assert.equal(await page.locator('#messages').textContent(), '');
    await page.fill('#prompt', '');
    const preview = page.frameLocator('#preview');
    const all = await fs.readdir(testRoot); const projectDir=path.join(testRoot,all.find(x=>x.startsWith('projekt-')));
    const publicIndex=path.join(projectDir,'public/index.html');
    // Før første version viser ruden kun en pladsholder. Når siden er ændret, vises den rigtige side med logoet.
    await page.screenshot({path:path.join(testRoot,'foer-foerste-version.png')});
    await require('./ui-test-helpers.cjs').firstVersion(page,projectDir,'Fælleshaven');
    assert.equal(await preview.locator('.logo').evaluate(el=>el.complete && el.naturalWidth>0),true);
    const initial=await fs.readFile(publicIndex,'utf8');
    await page.waitForTimeout(1800);
    await fs.writeFile(publicIndex,initial.replace('Fælleshaven</h1>','En levende fælleshave</h1>'));
    await preview.locator('h1').filter({hasText:'En levende fælleshave'}).waitFor({timeout:10000});
    for (const [preset, w, h] of [['desktop',1920,1080],['tablet',768,1024],['phone',390,844]]) {
      await page.selectOption('#viewport-preset',preset);
      await page.waitForFunction(([w,h])=>{const f=document.querySelector('#preview');return f.clientWidth===w&&f.clientHeight===h;},[w,h]);
      assert.deepEqual(await preview.locator('body').evaluate(()=>[innerWidth,innerHeight]),[w,h]);
    }
    await require('./ui-test-helpers.cjs').previewOptions(page); await page.click('#viewport-rotate');
    assert.deepEqual(await preview.locator('body').evaluate(()=>[innerWidth,innerHeight]),[844,390]);
    await page.fill('#viewport-width','1024'); await page.locator('#viewport-width').press('Tab');
    assert.equal(await preview.locator('body').evaluate(()=>innerWidth),1024);
    await page.keyboard.press('Escape');
    const divider=await page.locator('#workspace-divider').boundingBox();
    const originalWidth=(await page.locator('#chat-panel').boundingBox()).width;
    await page.mouse.move(divider.x+3,divider.y+100);await page.mouse.down();await page.mouse.move(divider.x+143,divider.y+100,{steps:12});await page.mouse.up();
    assert.ok((await page.locator('#chat-panel').boundingBox()).width>originalWidth+100);
    await page.locator('#workspace-divider').focus();await page.keyboard.press('Home');
    assert.equal(await page.locator('#workspace-divider').getAttribute('aria-valuenow'),'280');
    await page.selectOption('#viewport-preset','desktop');await require('./ui-test-helpers.cjs').previewOptions(page);await page.selectOption('#viewport-zoom','actual');
    assert.ok(await page.locator('#preview-surface').evaluate(el=>el.scrollWidth>el.clientWidth));
    await page.selectOption('#viewport-zoom','fit'); await page.keyboard.press('Escape');
    assert.ok(await page.locator('#preview-surface').evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.screenshot({path:path.join(testRoot,'desktop-preview.png'),fullPage:true});
    await page.selectOption('#viewport-preset','fluid');
    assert.equal(await preview.locator('body').evaluate(()=>typeof window.harness),'undefined');
    assert.equal(await preview.locator('body').evaluate(()=>typeof require),'undefined');
    assert.equal(await preview.locator('body').evaluate(async()=>{try{await fetch('https://example.com');return true;}catch{return false;}}),false);
    await fs.rename(publicIndex, publicIndex + '.backup');
    await page.locator('#preview-status').filter({hasText:'Kan ikke læse siden'}).waitFor({timeout:10000});
    await fs.rename(publicIndex + '.backup', publicIndex);
    await page.locator('#preview-status').filter({hasText:'Lokal forhåndsvisning'}).waitFor({timeout:10000});
    assert.equal(await preview.locator('body').evaluate(()=>{try{return !!parent.harness;}catch{return false;}}),false);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980,720));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
    assert.ok((await page.locator('#preview').boundingBox()).width > 250);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(1440,940));
    await page.screenshot({path:path.join(testRoot, 'arbejdsflade.png'),fullPage:true});
    await page.click('#new');
    await page.waitForSelector('#onboarding:not([hidden])');
    assert.equal(await page.inputValue('#name'), '');
    await app.close();
    page=await launch(); await choose([projectDir]); await page.click('#open');
    await page.frameLocator('#preview').locator('h1').filter({hasText:'En levende fælleshave'}).waitFor();
    await app.close(); page=await launch({ expectProject: 'Fælleshaven' });
    // Samme navn samme sted giver en ny, nummereret mappe. Det eksisterende projekt røres ikke.
    await page.fill('#name','Fælleshaven');await page.fill('#purpose','Må ikke overskrive');await require('./ui-test-helpers.cjs').chooseLocation(app, page, testRoot);await page.click('#create');
    await page.waitForSelector('#workspace:not([hidden])');assert.match(await fs.readFile(publicIndex,'utf8'),/En levende fælleshave/);
    assert.match(await fs.readFile(path.join(testRoot,'projekt-faelleshaven-2','README.md'),'utf8'),/Må ikke overskrive/);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('harness://')).setSize(980,720));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:['designpakke genbrugt efter genstart og slettede originaler','projektoprettelse','annulleret dialog','logo og reference','ægte preview','automatisk opdatering fra disk','skærmstørrelser, rotation, egne mål, skalering og trækbar skillelinje','ingen Node eller IPC i preview','genåbning efter genstart','eksisterende projekt bevaret'],testRoot,projectDir,screenshots:[path.join(testRoot, 'opstart.png'),path.join(testRoot, 'arbejdsflade.png')]}));
  } finally {if(app) await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});

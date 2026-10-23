// Udgiv er altid synlig. Uden udgivelse viser Udgiv ét næste trin, "Slå udgivelse til". Derefter starter det almindelige
// udgivelsesforløb, også før appen har en gemt version, så opsætningen kan klares, mens appen bygges.
// Prøvemappen er syntetisk og midlertidig og har ingen Git-version.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const helpers = require('./ui-test-helpers.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-del-indgang-'))), project = path.join(root, 'Mødelokaler');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<!doctype html><html lang="da"><title>Mødelokaler</title><h1>Mødelokaler</h1></html>');
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(), errors = [], screens = [];
    page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); }, project);
    const idle = () => page.waitForFunction(() => !document.querySelector('#deployment-fields').disabled);
    const step = () => page.evaluate(() => document.querySelector('#deployment-dialog [data-deploy-step]:not([hidden])')?.dataset.deployStep);
    const capture = async name => {
      const choices = await page.locator('#deployment-dialog :is(button,select,summary,input[type=checkbox],input[type=radio]):visible').count();
      screens.push({ name, heading: await page.textContent('#deployment-heading'), choices });
      await page.screenshot({ path: path.join(root, name + '.png') });
    };
    await helpers.skipIntroduction(page); await page.click('#open'); await page.waitForSelector('#workspace:not([hidden])');
    // 1. Udgiv er synlig, også med udgivelse slået fra, og viser ét næste trin.
    assert.equal(await page.textContent('#deploy-button'), 'Udgiv');
    assert.equal(await page.isVisible('#deploy-button'), true);
    assert.equal(await page.evaluate(() => window.sharingOn()), false);
    await page.click('#deploy-button'); await idle();
    assert.equal(await step(), 'sharingOff'); assert.equal(await page.textContent('#deployment-heading'), 'Vil du udgive dit projekt?');
    await capture('del-slaaet-fra');
    // 2. Slå udgivelse til: det almindelige udgivelsesforløb starter, også uden en gemt version.
    await page.click('#deployment-enable-sharing'); await idle();
    await page.waitForFunction(() => document.querySelector('#deployment-heading').textContent === 'Hvordan vil du udgive?');
    assert.equal(await page.evaluate(() => window.sharingOn()), true);
    assert.equal((await page.evaluate(() => window.harness.featuresGet())).value.effective.versioner, true, 'deling slår versioner til');
    assert.equal(await step(), 'destination');
    await capture('del-forloeb');
    assert.deepEqual(errors, []);
    assert(screens.every(s => s.choices <= 4), 'Højst fire synlige kontroller: ' + JSON.stringify(screens));
    console.log(JSON.stringify({ status: 'bestået', root, screens, limitations: ['syntetisk prøvemappe', 'ingen udbyder kontaktet'] }, null, 2));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

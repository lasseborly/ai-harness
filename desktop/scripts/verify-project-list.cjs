// Sidepanelets projektliste med flere projekter, end der vises: de 12 senest åbnede står først, og "Vis alle N
// projekter" viser resten. Et ældre projekt findes i paletten, kan åbnes fra listen og står derefter først, også
// efter genstart. Rigtig Electron med isolerede appdata; ingen modelkald og ingen netværk.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const helpers = require('./ui-test-helpers.cjs');
const { Store } = require('../core/store.cjs');

(async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-projektliste-')));
  // 14 projekter, som appen tidligere har åbnet. Projekt 01 er det ældste, Projekt 14 det nyeste.
  const store = new Store(path.join(root, 'appdata', 'harness')), projects = [];
  for (let i = 1; i <= 14; i++) {
    const name = `Projekt ${String(i).padStart(2, '0')}`, folder = path.join(root, name);
    await fs.mkdir(path.join(folder, 'public'), { recursive: true });
    await fs.writeFile(path.join(folder, 'public/index.html'), `<!doctype html><title>${name}</title><h1>${name}</h1>`);
    await store.saveProject(folder, { recent: { root: folder, name, at: new Date(Date.UTC(2026, 9, 1, i)).toISOString() } });
    projects.push(name);
  }
  const newest = [...projects].reverse(), errors = [];
  const launch = async () => {
    const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--user-data-dir=' + path.join(root, 'appdata')], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await helpers.skipIntroduction(page);
    return { app, page };
  };
  let app;
  try {
    let page; ({ app, page } = await launch());
    const names = () => page.locator('#project-list .project-name').allTextContents();
    const more = page.locator('#project-list .project-all');
    await more.waitFor();
    assert.equal(await more.textContent(), 'Vis alle 14 projekter');
    assert.deepEqual(await names(), newest.slice(0, 12), 'de 12 senest åbnede, nyeste først');
    await page.screenshot({ path: path.join(root, 'tolv-projekter.png'), animations: 'disabled' });

    // Paletten finder også et projekt, der ikke står i listen endnu.
    await page.evaluate(() => window.palette.open());
    await page.fill('#palette-input', 'Projekt 01');
    await page.locator('#palette-list .palette-label', { hasText: 'Projekt 01' }).waitFor();
    await page.keyboard.press('Escape');

    // Vis alle: alle 14 står der, linket forsvinder, og fokus står på det første projekt, der kom frem.
    await more.click();
    assert.deepEqual(await names(), newest);
    assert.equal(await more.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Projekt 02');
    await page.screenshot({ path: path.join(root, 'alle-projekter.png'), animations: 'disabled' });

    // Det ældste projekt åbnes fra listen. Det står derefter først, og listen viser stadig alle.
    await page.locator('#project-list .project-name', { hasText: 'Projekt 01' }).click();
    await page.waitForFunction(() => document.querySelector('#project-name').textContent === 'Projekt 01');
    await page.waitForFunction(() => document.querySelector('#project-list .project-name')?.textContent === 'Projekt 01');
    assert.deepEqual(await names(), ['Projekt 01', ...newest.slice(0, 13)]);

    // Efter genstart åbnes Projekt 01 igen, og listen viser igen de 12 nyeste med linket.
    await app.close(); ({ app, page } = await launch());
    await page.waitForFunction(() => document.querySelector('#project-name').textContent === 'Projekt 01');
    await page.locator('#project-list .project-all').waitFor();
    assert.deepEqual(await page.locator('#project-list .project-name').allTextContents(), ['Projekt 01', ...newest.slice(0, 11)]);
    assert.equal(await page.locator('#project-list .project-all').textContent(), 'Vis alle 14 projekter');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'bestået', root, checks: ['12 senest åbnede projekter, nyeste først', 'Vis alle 14 projekter viser resten', 'fokus på det første nye projekt', 'paletten finder et skjult projekt', 'det ældste projekt kan åbnes og står derefter først', 'listen er den samme efter genstart'] }, null, 2));
  } catch (error) {
    if (app) await (await app.firstWindow()).screenshot({ path: path.join(root, 'fejl.png') }).catch(() => {});
    console.error('Prøvens filer:', root, 'Sidefejl:', errors); process.exitCode = 1; console.error(error);
  } finally { await app?.close(); }
})();

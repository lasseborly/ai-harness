const { test } = require('node:test');
const assert = require('node:assert/strict');
const { options, freshAccount, ownedInstall, installerArgs, GUID } = require('../scripts/windows-upgrade-safety.cjs');
const argv = ['C:\\pakker\\gammel.exe', 'C:\\pakker\\ny.exe', '--isolated-windows-account', '--old-version=0.5.0-beta.3', '--new-version=0.6.0-beta.1', '--old-sha256=' + 'a'.repeat(64), '--new-sha256=' + 'b'.repeat(64)];
test('Windows-opgraderingsprøven afviser forkert platform, manglende isolation, hashes og tvetydige valg', () => {
  assert.equal(options(argv, 'win32').method, 'installer');
  assert.equal(options([...argv, '--method=updater'], 'win32').method, 'updater');
  assert.throws(() => options(argv, 'darwin'), /rigtig Windows/);
  assert.throws(() => options(argv.filter(arg => arg !== '--isolated-windows-account'), 'win32'), /tom Windows-testkonto/);
  assert.throws(() => options(argv.filter(arg => !arg.startsWith('--new-sha256')), 'win32'), /SHA-256/);
  assert.throws(() => options([...argv, '--old-version=0.5.0-beta.3'], 'win32'), /gentaget/);
  assert.throws(() => options(argv.map(arg => arg === '--new-version=0.6.0-beta.1' ? '--new-version=0.4.0-beta.1' : arg), 'win32'), /nyere/);
  assert.throws(() => options([argv[0], 'c:\\PAKKER\\gammel.exe', ...argv.slice(2)], 'win32'), /forskellige/);
});
test('Windows-konto med eksisterende appdata, installation eller proces afvises før NSIS starter', () => {
  const clean = { complete: true, registry: [], paths: [], processes: [] };
  freshAccount(clean);
  for (const kind of ['registry', 'paths', 'processes']) assert.throws(() => freshAccount({ ...clean, [kind]: ['eksisterende'] }), /eksisterende/);
  assert.throws(() => freshAccount({ ...clean, complete: false }), /ikke kontrolleres/);
  assert.throws(() => freshAccount({}), /ikke kontrolleres/);
});
test('kun prøvens præcise per-user-installationsmappe accepteres, aldrig nabo eller fælles sti', () => {
  const root = 'C:\\Temp\\Aura prøve\\Programmer\\Aura';
  const snapshot = { complete: true, registry: [{ hive: 'CurrentUser', location: root.toLowerCase() }] };
  ownedInstall(snapshot, root);
  const uninstall = { hive: 'CurrentUser', location: '', uninstall: '"' + root + '\\Uninstall Aura.exe" /currentuser' };
  ownedInstall({ ...snapshot, registry: [...snapshot.registry, uninstall] }, root);
  assert.throws(() => ownedInstall({ ...snapshot, registry: [...snapshot.registry, { ...uninstall, uninstall: '"C:\\Programs\\Uninstall Aura.exe" /currentuser' }] }, root), /uden for/);
  assert.throws(() => ownedInstall({ complete: true, registry: [] }, root), /ikke registreret/);
  for (const entry of [{ hive: 'LocalMachine', location: root }, { hive: 'CurrentUser', location: root + '-nabo' }, { hive: 'CurrentUser', location: 'C:\\Programs\\Aura' }]) assert.throws(() => ownedInstall({ ...snapshot, registry: [entry] }, root), /uden for/);
  assert.deepEqual(installerArgs(root), ['/S', '/currentuser', '/D=' + root]);
  assert.throws(() => installerArgs(root + '" /allusers'), /Ugyldig/);
});
test('NSIS-identiteten og databevarelsen er stadig kompatibel med den eksisterende Windows-beta', () => {
  const config = require('../electron-builder.cjs');
  const { UUID } = require('builder-util-runtime');
  assert.equal(UUID.v5(config.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')), GUID);
  assert.equal(config.productName, 'Aura');
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.publish.url, 'https://ai-alliancen-org.github.io/ai-harness/updates/');
  assert.equal(config.publish.channel, 'beta');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { signingOptions } = require('../scripts/sign-mac.cjs');

test('native npm-pakker tillades kun i den medfølgende Node, aldrig i Electron', () => {
  const app = '/tmp/Prøve med mellemrum/Aura.app', inherited = { hardenedRuntime: true, entitlements: 'electron.plist' };
  const options = signingOptions({ app, identity: 'bevares', optionsForFile: () => inherited });
  assert.equal(options.identity, 'bevares');
  assert.equal(options.optionsForFile(app), inherited);
  assert.equal(options.optionsForFile(path.join(app, 'Contents/MacOS/Aura')), inherited);
  assert.equal(options.optionsForFile(path.join(app, 'Contents/Resources/runtime/andet/node')), inherited);
  const node = options.optionsForFile(path.join(app, 'Contents/Resources/runtime/node/bin/node'));
  assert.equal(node.hardenedRuntime, true); assert.match(fs.readFileSync(node.entitlements, 'utf8'), /disable-library-validation<\/key><true\/>/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../packaging/entitlements.mac.plist'), 'utf8'), /disable-library-validation/);
});

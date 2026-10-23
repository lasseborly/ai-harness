const path = require('node:path');

// Node kører brugerens gennemgåede projektkode og skal kunne indlæse projektets
// native npm-pakker. Tilladelsen gælder kun Node, aldrig Electron eller renderere.
function signingOptions(options) {
  const node = path.join(options.app, 'Contents', 'Resources', 'runtime', 'node', 'bin', 'node');
  const previous = options.optionsForFile || (() => ({}));
  return { ...options, optionsForFile(file) {
    const selected = previous(file);
    return path.resolve(file) === node ? { ...selected, entitlements: path.resolve(__dirname, '../packaging/entitlements.node.mac.plist') } : selected;
  } };
}
async function sign(options) {
  return require('app-builder-lib/out/codeSign/macCodeSign').sign(signingOptions(options));
}
module.exports = { sign, signingOptions };

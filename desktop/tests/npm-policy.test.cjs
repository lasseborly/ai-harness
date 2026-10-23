const test = require('node:test');
const assert = require('node:assert/strict');
const { npmInstallPolicy, npmFailure } = require('../core/npm-policy.cjs');
const pkg = { devDependencies: { '@promte/app-library': '^0.1.6', react: '19.2.8', 'react-dom': '19.2.8' } };
const locked = () => ({ packages: {
  'node_modules/@promte/app-library': { version: '0.1.8', resolved: 'https://registry.npmjs.org/@promte/app-library/-/app-library-0.1.8.tgz', peerDependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' } },
  'node_modules/react': { version: '19.2.8' }, 'node_modules/react-dom': { version: '19.2.8' },
} });
const files = lock => ({ 'package-lock.json': JSON.stringify(lock) });

test('kun den kendte låste Promte/React-kombination bruger den dokumenterede npm-undtagelse', () => {
  assert.deepEqual(npmInstallPolicy(pkg, files(locked())).args, ['--legacy-peer-deps']);
  for (const change of [
    lock => { lock.packages['node_modules/@promte/app-library'].version = '0.2.0'; },
    lock => { lock.packages['node_modules/@promte/app-library'].peerDependencies.react = '^19.0.0'; },
    lock => { lock.packages['node_modules/@promte/app-library'].resolved = 'https://other.example/library.tgz'; },
    lock => { lock.packages['node_modules/react'].version = '20.0.0'; },
    lock => { delete lock.packages['node_modules/react-dom']; },
  ]) { const lock = locked(); change(lock); assert.deepEqual(npmInstallPolicy(pkg, files(lock)).args, []); }
  assert.deepEqual(npmInstallPolicy({ devDependencies: { react: '19.2.8' } }, files(locked())).args, []);
  assert.deepEqual(npmInstallPolicy({ devDependencies: { ...pkg.devDependencies, react: '20.0.0' } }, files(locked())).args, []);
  assert.deepEqual(npmInstallPolicy(pkg, {}).args, []);
  for (const value of ['true', 'false']) assert.deepEqual(npmInstallPolicy(pkg, { ...files(locked()), '.npmrc': `legacy-peer-deps=${value}\n` }).args, [], 'projektets eksplicitte npm-valg får forrang');
});

test('npm-fejl skelner versionskonflikt, låsefil, netværk, adgang og ukendt årsag', () => {
  assert.match(npmFailure('npm error code ERESOLVE\nnpm error conflicting peer dependency'), /Pakkeversionerne.*ERESOLVE/);
  assert.doesNotMatch(npmFailure('npm error ERESOLVE'), /netværk|forbindelse/);
  assert.match(npmFailure('npm error code EUSAGE'), /Låsefilen/);
  assert.match(npmFailure('npm error code ENOTFOUND'), /forbindelsen/);
  assert.match(npmFailure('npm error code E401'), /afviste adgangen/);
  assert.match(npmFailure('npm error code ETARGET'), /version kunne ikke findes/);
  assert.doesNotMatch(npmFailure('ukendt procesfejl'), /netværk|forbindelse/);
});

test('den fatale npm-fejl har forrang for tidligere ERESOLVE-advarsler', () => {
  const warning = 'npm warn ERESOLVE overriding peer dependency\nnpm warn Conflicting peer dependency: react@18.3.1\n';
  assert.match(npmFailure(warning + 'npm error code ENOTCACHED'), /pakkecache/);
  assert.match(npmFailure(warning + 'npm ERR! code ENOTFOUND'), /forbindelsen/);
  assert.match(npmFailure(warning + 'npm error code E401'), /afviste adgangen/);
  assert.doesNotMatch(npmFailure(warning + 'npm error code EUNKNOWN'), /ERESOLVE|forbindelse/);
  assert.doesNotMatch(npmFailure(warning), /ERESOLVE|forbindelse/);
  assert.match(npmFailure(warning + 'npm error code ERESOLVE'), /Pakkeversionerne.*ERESOLVE/);
});

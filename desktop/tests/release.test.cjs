const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { expectedFiles, assetURL, validateRelease, releaseSnapshot } = require('../../scripts/release-contract.cjs');
const { check } = require('../../scripts/check-release.cjs');
const { selectDraft, validateAssetIDs } = require('../../scripts/download-desktop-draft.cjs');
const version = '0.2.0-beta.6';
function fixture() {
  const content = Buffer.from('Syntetisk installationsfil. Ikke et program.'), sha256 = createHash('sha256').update(content).digest('hex');
  const files = expectedFiles(version).map(name => ({ name, bytes: content.length, sha256, notarized: name.endsWith('.dmg'), ...(name.endsWith('.dmg') ? { notarization: { id: '12345678-1234-1234-1234-123456789abc', checkedAt: '2026-10-13T08:00:00Z' } } : {}) }));
  const manifest = { version, files }, checksums = files.map(f => `${f.sha256}  ${f.name}`).join('\n')+'\n';
  const release = { id: 1, tag_name: `v${version}`, draft: true, prerelease: true, body: 'Syntetiske udgivelsesnoter', assets: [...files.map(f => ({ name: f.name, size: f.bytes, digest: `sha256:${f.sha256}` })), { name: 'release.json' }, { name: 'SHA256SUMS.txt' }].map(a => ({ ...a, state: 'uploaded', browser_download_url: assetURL(`v${version}`, a.name) })) };
  return { content, release, manifest, checksums };
}
test('Udgivelse kræver én gennemgået beta med præcis fire komplette installationsfiler', () => {
  const f = fixture(); assert.equal(validateRelease(f.release,f.manifest,f.checksums,version).files.length,4);
  for (const mutate of [
    f=>f.release.draft=false, f=>f.release.prerelease=false, f=>f.release.body='', f=>f.release.tag_name='v0.2.0-beta.5',
    f=>f.release.assets.pop(), f=>f.release.assets.push({...f.release.assets[0],name:'.env'}),
    f=>f.release.assets[0].digest='sha256:'+'f'.repeat(64), f=>f.release.assets[0].size++,
    f=>f.manifest.version='0.2.0-beta.5', f=>f.manifest.files[0].notarized=false, f=>delete f.manifest.files[0].notarization,
    f=>f.manifest.files[0].notarization.id='-'.repeat(36), f=>f.manifest.files[0].notarization.checkedAt='ukendt',
    f=>f.manifest.files[1]={...f.manifest.files[0]}, f=>f.checksums='forkert',
  ]) { const bad=fixture(); mutate(bad); assert.throws(()=>validateRelease(bad.release,bad.manifest,bad.checksums,version)); }
});
test('Gentagen kontrol tillader downloadtællere, men afviser ændrede noter og filer', () => {
  const {release}=fixture(),before=releaseSnapshot(release);release.assets[0].download_count=2;
  assert.equal(releaseSnapshot(release),before);release.body='Ændrede noter';assert.notEqual(releaseSnapshot(release),before);
  release.body='Syntetiske udgivelsesnoter';release.assets[0].digest='ændret';assert.notEqual(releaseSnapshot(release),before);
});
test('Desktopkladder hentes via ID og må bruge GitHubs midlertidige downloadadresser', () => {
  const f = fixture();
  f.release.assets.forEach((a, i) => {
    a.id = 100 + i; a.size ||= 100; a.digest ||= 'sha256:' + 'b'.repeat(64);
    a.url = `https://api.github.com/repos/ai-alliancen-org/ai-harness/releases/assets/${a.id}`;
    a.browser_download_url = assetURL('untagged-9eb271ba7508f6aaf1fd', a.name);
  });
  assert.equal(selectDraft([f.release], 'v' + version).id, f.release.id);
  assert.equal(validateAssetIDs(f.release).length, 6);
  assert.equal(validateRelease(f.release, f.manifest, f.checksums, version).files.length, 4);
  for (const mutate of [r => r.assets[0].url = 'https://example.org/fil', r => r.assets[0].id = r.assets[1].id,
    r => r.assets[1].browser_download_url = assetURL('untagged-abcdef', r.assets[1].name),
    r => r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace('ai-alliancen-org', 'other'),
    r => r.assets[0].size = 0, r => r.assets.pop(), r => r.draft = false]) {
    const bad = structuredClone(f.release); mutate(bad); assert.throws(() => validateAssetIDs(bad));
  }
});
test('Udgivelseskontrollen læser de faktiske bytes uden at kræve en AI-udbyder', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'aura-release-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const f=fixture(), metadata={full_name:'ai-alliancen-org/ai-harness',private:false,visibility:'public'};
  for(const file of f.manifest.files)await fs.writeFile(path.join(root,file.name),f.content);
  await fs.writeFile(path.join(root,'release.json'),JSON.stringify(f.manifest));await fs.writeFile(path.join(root,'SHA256SUMS.txt'),f.checksums);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Generel udgivelse må ikke kontakte en AI-udbyder'); });
  assert.equal((await check(root,f.release,metadata,version)).version,version);
  await fs.writeFile(path.join(root,f.manifest.files[0].name),Buffer.alloc(f.content.length));
  await assert.rejects(check(root,f.release,metadata,version),/SHA-256/);
  await assert.rejects(check(root,f.release,{...metadata,private:true},version),/offentligt/);
});
test('Desktopudgivelse er fortsat manuel og har ingen særskilt AI-login-kontrol', async () => {
  const workflow = await fs.readFile(path.join(__dirname, '../../.github/workflows/desktop-release.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /godkend_udgivelse:/);
  assert.doesNotMatch(workflow, /komplai_afproevet|checkKomplaiConfig/);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|release|schedule):/m);
  assert.match(workflow, /node scripts\/check-release\.cjs/);
  assert.match(workflow, /releaseSnapshot/);
});

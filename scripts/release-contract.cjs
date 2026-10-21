// Fælles fil- og versionskontrol for lokale pakker, Releases og Pages.
const repository = 'ai-alliancen-org/ai-harness';
const versionPattern = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const submissionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function installer(name) {
  const match = /^(Aura|AI-Harness)-(\d+\.\d+\.\d+(?:-beta\.\d+)?)-(mac|win|linux)-(arm64|x64)\.(dmg|zip|exe|AppImage)$/.exec(name || '');
  const extensions = { mac: ['dmg', 'zip'], win: ['exe'], linux: ['AppImage'] }[match?.[3]] || [];
  if (!match || !extensions.includes(match[5])) return null;
  return { version: match[2], os: match[3], arch: match[4], extension: match[5], target: `${match[3]}-${match[4]}` };
}
function expectedFiles(version) {
  if (!versionPattern.test(version)) throw new Error('Ugyldigt versionsnummer.');
  return [`Aura-${version}-mac-arm64.dmg`, `Aura-${version}-mac-x64.dmg`, `Aura-${version}-win-x64.exe`, `Aura-${version}-linux-x64.AppImage`];
}
function hasUpdater(version) {
  if (!versionPattern.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 0 || minor >= 3;
}
function releaseBinaries(version) {
  return [...expectedFiles(version), ...(hasUpdater(version) ? [`Aura-${version}-mac-arm64.zip`, `Aura-${version}-mac-x64.zip`] : [])];
}
function updateFeeds(manifest) {
  const version = manifest.version, channel = version.includes('-beta.') ? 'beta' : 'latest';
  if (!hasUpdater(version)) return [];
  if (typeof manifest.update?.critical !== 'boolean' || typeof manifest.update?.message !== 'string' || manifest.update.message.length > 500 || manifest.update.critical && !manifest.update.message.trim()) throw new Error('Ugyldig meddelelse om opdateringen.');
  return ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].map(target => {
    const [platform, arch] = target.split('-');
    const name = `Aura-${version}-${platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : 'win'}-${arch}.${platform === 'darwin' ? 'zip' : platform === 'linux' ? 'AppImage' : 'exe'}`;
    const file = manifest.files.find(f => f.name === name);
    if (!file || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '') || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Opdateringen mangler en fil med størrelse og SHA-512.');
    const url = assetURL('v' + version, name);
    const prefix = platform === 'darwin' ? '-mac' : platform === 'linux' ? '-linux' : '';
    return { path: `updates/${channel}/${target}/${channel}${prefix}.yml`, info: { version, files: [{ url, sha512: file.sha512, size: file.bytes }], path: url, sha512: file.sha512, critical: manifest.update.critical, message: manifest.update.message } };
  });
}
function assetURL(tag, name) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}
function matchesAssetURL(release, asset, { draft = false } = {}) {
  if (asset.browser_download_url === assetURL(release.tag_name, asset.name)) return true;
  const temporary = draft && release.draft === true
    ? release.assets[0]?.browser_download_url?.match(/\/releases\/download\/(untagged-[a-f0-9]{1,64})\//)?.[1] : null;
  return Boolean(temporary && asset.browser_download_url === assetURL(temporary, asset.name));
}
function releaseFiles(release, options = {}) {
  const version = release?.tag_name?.replace(/^v/, '');
  if (!versionPattern.test(version || '') || !Array.isArray(release.assets)) return [];
  const files = [], targets = new Set();
  for (const asset of release.assets) {
    const parsed = installer(asset.name);
    // ZIP-apps og filer fra en anden version må ikke forveksles med installationsprogrammet.
    if (!parsed || parsed.version !== version || parsed.extension === 'zip' || asset.state !== 'uploaded') continue;
    if (!matchesAssetURL(release, asset, options)) throw new Error('Downloadadressen matcher ikke repository og version.');
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) continue;
    if (targets.has(parsed.target)) throw new Error('Flere installationsfiler til samme platform.');
    targets.add(parsed.target); files.push({ ...asset, ...parsed });
  }
  return files.sort((a, b) => a.target.localeCompare(b.target));
}
function validateRelease(release, manifest, checksums, version) {
  const names = releaseBinaries(version);
  if (release?.draft !== true || release.tag_name !== `v${version}`) throw new Error('Udgivelsen skal være en kladde med det aftalte versionstag.');
  if (release.prerelease !== version.includes('-beta.') || !release.body?.trim()) throw new Error('Kladdeudgivelsen mangler korrekt betamarkering eller udgivelsesnoter.');
  if (manifest?.version !== version || !Array.isArray(manifest.files) || manifest.files.length !== names.length) throw new Error('Filoversigten skal indeholde præcis de krævede installations- og opdateringsfiler fra denne version.');
  const assets = release.assets;
  const allowed = new Set([...names, 'release.json', 'SHA256SUMS.txt']);
  if (release.assets.length !== allowed.size || new Set(release.assets.map(a => a.name)).size !== allowed.size || release.assets.some(a => !allowed.has(a.name) || a.state !== 'uploaded' || !matchesAssetURL(release, a, { draft: true }))) throw new Error('Release må kun indeholde de krævede programfiler, release.json og SHA256SUMS.txt.');
  for (const name of names) {
    const entries = manifest.files.filter(f => f.name === name), asset = assets.find(a => a.name === name);
    const file = entries[0];
    if (entries.length !== 1 || !asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || file.bytes !== asset.size || `sha256:${file.sha256}` !== asset.digest) throw new Error(`Fil, størrelse eller SHA-256 stemmer ikke: ${name}`);
    if (installer(name).os === 'mac' && (file.notarized !== true || !submissionIdPattern.test(file.notarization?.id || '') || !Number.isFinite(Date.parse(file.notarization?.checkedAt)))) throw new Error(`Mac-pakken mangler en kvittering for den konkrete fil: ${name}`);
    if (hasUpdater(version) && !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 || '')) throw new Error('Filens SHA-512 mangler.');
  }
  const expected = manifest.files.map(f => `${f.sha256}  ${f.name}`).sort();
  if (JSON.stringify(checksums.trim().split(/\r?\n/).sort()) !== JSON.stringify(expected)) throw new Error('SHA256SUMS.txt stemmer ikke med filoversigten.');
  if (hasUpdater(version)) updateFeeds(manifest);
  return { version, files: names };
}
function releaseSnapshot(release) {
  // Downloadtælleren ændres af vores egen kontrol. Sammenlign kun udgivelsens indhold.
  return JSON.stringify({ id: release.id, tag: release.tag_name, target: release.target_commitish, draft: release.draft, prerelease: release.prerelease, name: release.name, body: release.body, assets: release.assets.map(a => ({ id: a.id, name: a.name, state: a.state, size: a.size, digest: a.digest, url: a.browser_download_url })).sort((a, b) => a.name.localeCompare(b.name)) });
}
module.exports = { repository, versionPattern, installer, expectedFiles, releaseBinaries, hasUpdater, updateFeeds, assetURL, matchesAssetURL, releaseFiles, validateRelease, releaseSnapshot, submissionIdPattern };

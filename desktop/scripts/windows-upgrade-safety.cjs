// Fælles, afprøvelige grænser for den destruktive del af Windows-installationsprøven.
const path = require('node:path');
const semver = require('semver');
const GUID = '528e9e35-72bf-5491-ac22-99811c2c04de';
function options(argv, platform = process.platform) {
  if (platform !== 'win32') throw Error('Installationsprøven kræver rigtig Windows i en separat, tom testkonto eller Windows Sandbox.');
  const [oldInstaller, newInstaller, ...flags] = argv, values = {};
  for (const flag of flags) {
    const match = /^--(isolated-windows-account|method|old-version|new-version|old-sha256|new-sha256)(?:=(.*))?$/.exec(flag);
    if (!match || Object.hasOwn(values, match[1])) throw Error('Ukendt eller gentaget testvalg: ' + flag);
    values[match[1]] = match[2] ?? true;
  }
  if (values['isolated-windows-account'] !== true) throw Error('Brug kun en separat, tom Windows-testkonto. Bekræft med --isolated-windows-account.');
  if (![oldInstaller, newInstaller].every(file => typeof file === 'string' && /\.exe$/i.test(file)) || path.win32.resolve(oldInstaller).toLowerCase() === path.win32.resolve(newInstaller).toLowerCase()) throw Error('Angiv to forskellige NSIS-installationsfiler.');
  const method = values.method || 'installer';
  if (!['installer', 'updater'].includes(method)) throw Error('Vælg --method=installer eller --method=updater.');
  for (const key of ['old-version', 'new-version']) if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(values[key] || '') || !semver.valid(values[key])) throw Error('Angiv en præcis appversion med --' + key + '=VERSION.');
  if (!semver.gt(values['new-version'], values['old-version'])) throw Error('Den nye version skal være nyere end den gamle.');
  for (const key of ['old-sha256', 'new-sha256']) if (!/^[a-f0-9]{64}$/i.test(values[key] || '')) throw Error('Angiv den gennemgåede installationsfils SHA-256 med --' + key + '=HASH.');
  return { oldInstaller, newInstaller, method, oldVersion: values['old-version'], newVersion: values['new-version'], oldHash: values['old-sha256'].toLowerCase(), newHash: values['new-sha256'].toLowerCase() };
}
function freshAccount(snapshot) {
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.registry) || !Array.isArray(snapshot.paths) || !Array.isArray(snapshot.processes)) throw Error('Windows-kontoens isolation kunne ikke kontrolleres.');
  if (snapshot.registry.length || snapshot.paths.length || snapshot.processes.length) throw Error('Prøven afviser en eksisterende Aura/AI Harness-installation, appdata eller proces. Brug en tom testkonto eller Windows Sandbox.');
}
function ownedInstall(snapshot, root) {
  if (snapshot?.complete !== true || !Array.isArray(snapshot.registry) || !snapshot.registry.length) throw Error('Installationen blev ikke registreret i Windows.');
  const expected = path.win32.resolve(root).toLowerCase();
  let foundInstallLocation = false;
  for (const entry of snapshot.registry) {
    if (entry.hive !== 'CurrentUser') throw Error('Installationen peger uden for prøvens egen mappe eller på en fælles installation.');
    if (entry.location) {
      if (path.win32.resolve(entry.location).toLowerCase() !== expected) throw Error('Installationen peger uden for prøvens egen mappe eller på en fælles installation.');
      foundInstallLocation = true;
    } else {
      // electron-builder gemmer InstallLocation i sin egen nøgle, men kun
      // UninstallString i Windows' afinstallationsnøgle. Begge skal høre til prøven.
      const command = /^"([^"]+)"\s+\/currentuser$/i.exec(entry.uninstall || '');
      if (!command || path.win32.resolve(command[1]).toLowerCase() !== path.win32.join(expected, 'uninstall aura.exe')) throw Error('Installationen peger uden for prøvens egen mappe eller på en fælles installation.');
    }
  }
  if (!foundInstallLocation) throw Error('Installationen blev ikke registreret i Windows.');
}
// /D skal være sidste argument og uden citationstegn, også når stien indeholder mellemrum.
function installerArgs(directory) {
  if (!path.win32.isAbsolute(directory) || /["\r\n\0]/.test(directory)) throw Error('Ugyldig installationsmappe.');
  return ['/S', '/currentuser', '/D=' + directory];
}
function preflightScript() {
  return `$ErrorActionPreference='Stop'
$entries=@(); $found=@(); $processes=@()
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
  foreach($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
    $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
    try { foreach($name in @('Software\\${GUID}','Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${GUID}')) {
      $key=$base.OpenSubKey($name)
      if($null -ne $key) { try { $entries+=@{hive=$hive.ToString();view=$view.ToString();key=$name;location=$key.GetValue('InstallLocation','');version=$key.GetValue('DisplayVersion','');uninstall=$key.GetValue('UninstallString','')} } finally {$key.Dispose()} }
    } } finally {$base.Dispose()}
  }
}
foreach($name in @('Aura','AI Harness','aura-desktop','ai-harness-desktop','aura-desktop-updater','ai-harness-desktop-updater')) {
  foreach($folder in @((Join-Path $env:APPDATA $name),(Join-Path $env:LOCALAPPDATA $name),(Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $name))) {
    if(Test-Path -LiteralPath $folder) {$found+=$folder}
  }
}
foreach($process in @(Get-Process)) {if($process.ProcessName -in @('Aura','AI Harness')) {$processes+=$process.Id}}
@{complete=$true;registry=@($entries);paths=@($found);processes=@($processes);os=[Environment]::OSVersion.VersionString;architecture=$env:PROCESSOR_ARCHITECTURE;user=$env:USERNAME} | ConvertTo-Json -Depth 5 -Compress`;
}
module.exports = { GUID, options, freshAccount, ownedInstall, installerArgs, preflightScript };

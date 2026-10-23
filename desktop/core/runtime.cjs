const path = require('node:path');
const fs = require('node:fs');
let bundled = null;
function configure(resources, platform = process.platform, arch = process.arch) {
  const root = path.join(resources, 'runtime');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.target !== `${platform}-${arch}`) throw new Error('Installationspakken passer ikke til denne computer.');
  const win = platform === 'win32', gitRoot = path.join(root, 'git');
  const gitSub = arch === 'arm64' ? 'clangarm64' : 'mingw64';
  const paths = {
    git: path.join(gitRoot, win ? 'cmd/git.exe' : 'bin/git'),
    opencode: path.join(root, 'opencode', win ? 'bin/opencode.exe' : 'bin/opencode'),
    node: path.join(root, 'node', win ? 'node.exe' : 'bin/node'),
    gitExec: path.join(gitRoot, win ? `${gitSub}/libexec/git-core` : 'libexec/git-core'),
    gitTemplates: path.join(gitRoot, win ? `${gitSub}/share/git-core/templates` : 'share/git-core/templates'),
    gitCa: platform === 'linux' ? path.join(gitRoot, 'ssl/cacert.pem') : null
  };
  for (const key of ['git','node','opencode']) if (!fs.existsSync(paths[key])) throw new Error('Installationen mangler ' + key + '. Hent installationspakken igen.');
  const bins = [path.dirname(paths.node), path.dirname(paths.git), path.dirname(paths.opencode)];
  if (win) bins.push(path.join(gitRoot, gitSub, 'bin'), path.join(gitRoot, 'usr', 'bin'));
  bundled = { ...paths, versions: manifest.versions, bins };
  const previous = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH');
  const value = previous ? process.env[previous] : '';
  if (previous && previous !== 'PATH') delete process.env[previous];
  process.env.PATH = [...bins, value || ''].join(path.delimiter);
  return bundled;
}
function gitEnvironment(env) {
  if (!bundled) return env;
  const git = { GIT_EXEC_PATH: bundled.gitExec, GIT_TEMPLATE_DIR: bundled.gitTemplates };
  if (bundled.gitCa) git.GIT_SSL_CAINFO = bundled.gitCa;
  return { ...env, ...git };
}
module.exports = { configure, gitEnvironment, get: () => bundled };

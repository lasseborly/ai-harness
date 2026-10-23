// Promtes dokumenterede React 19-runtime har ældre peer-krav i disse biblioteksudgaver.
// Genbrug kun undtagelsen for den kendte, låste kombination. Andre konflikter skal rettes.
function npmInstallPolicy(pkg, files = {}) {
  const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const npmrc = typeof files['.npmrc'] === 'string' ? files['.npmrc'] : '';
  if (/^\s*legacy-peer-deps\s*=/im.test(npmrc)) return { args: [], reason: '' };
  let lock;
  try { lock = JSON.parse(files['npm-shrinkwrap.json'] || files['package-lock.json'] || 'null'); } catch {}
  const packages = lock?.packages, library = packages?.['node_modules/@promte/app-library'];
  if (dependencies['@promte/app-library'] && dependencies.react === '19.2.8' && dependencies['react-dom'] === '19.2.8'
    && /^0\.1\.[678]$/.test(library?.version || '')
    && library?.peerDependencies?.react === '^18.2.0' && library?.peerDependencies?.['react-dom'] === '^18.2.0'
    && packages?.['node_modules/react']?.version === '19.2.8' && packages?.['node_modules/react-dom']?.version === '19.2.8'
    && /^https:\/\/registry\.npmjs\.org\/@promte\/app-library\/-\/app-library-0\.1\.[678]\.tgz$/.test(library?.resolved || '')) {
    return { args: ['--legacy-peer-deps'], reason: 'Promtes dokumenterede React 19-opsætning kræver --legacy-peer-deps med denne låste udgave af app-biblioteket.' };
  }
  return { args: [], reason: '' };
}

function npmFailureCode(output = '') {
  const codes = [...String(output).replace(/\u001b\[[0-9;]*m/g, '').matchAll(/^\s*npm\s+(?:error|ERR!)\s+code\s+(\S+)/gm)];
  return codes.at(-1)?.[1] || null;
}
function npmFailure(output = '') {
  // npm kan advare om peer-krav og derefter fejle af en helt anden grund.
  // Den afsluttende fejlkode har forrang for tekst og advarsler tidligere i loggen.
  const clean = String(output).replace(/\u001b\[[0-9;]*m/g, '');
  const failure = npmFailureCode(clean) || clean.split(/\r?\n/).filter(line => !/^\s*npm\s+(?:warn|warning)\b/i.test(line)).join('\n');
  if (/\bERESOLVE\b|unable to resolve dependency tree|conflicting peer dependency/i.test(failure)) return 'Pakkeversionerne passer ikke sammen (ERESOLVE). Ret versionskravene i package.json og låsefilen, og gem en ny version. Se detaljer om de pakker, der er i konflikt.';
  if (/\bEUSAGE\b|package\.json and package-lock\.json.*in sync|Missing: .+ from lock file|Invalid: lock file/i.test(failure)) return 'Låsefilen passer ikke til package.json. Opdatér projektets pakker efter gennemgang, og gem en ny version før bygning.';
  if (/\b(?:ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH)\b|network request failed/i.test(failure)) return 'Pakkerne kunne ikke hentes. Kontrollér forbindelsen og adgangen til npm, og prøv igen.';
  if (/\b(?:E401|E403)\b/i.test(failure)) return 'Pakkekilden afviste adgangen. Kontrollér projektets adgang til de anvendte pakker.';
  if (/\b(?:ETARGET|E404|ENOVERSIONS)\b/i.test(failure)) return 'En pakke eller pakkeversion kunne ikke findes. Kontrollér navn og version i package.json og låsefilen.';
  if (/\bENOTCACHED\b/i.test(failure)) return 'En nødvendig pakke mangler i den lokale pakkecache. Installationen kan ikke gennemføres uden adgang til pakkekilden.';
  return 'Installationen blev ikke gennemført. Se detaljerne, og ret årsagen før næste forsøg.';
}

module.exports = { npmInstallPolicy, npmFailure, npmFailureCode };

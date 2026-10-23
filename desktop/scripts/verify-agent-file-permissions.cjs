// Rigtig OpenCode, syntetiske filer og lokal modelserver. Ingen Git-skrivninger eller ekstern AI.
// På macOS er NTFS-navnene almindelige filnavne: prøven beviser motorens konkrete
// tilladelsesmatch, mens Windows' stream-/filsystemsemantik kræver en Windows-kørsel.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { OpenCodeEngine } = require('../core/engine.cjs');

(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-filgraenser-')));
  const root = path.join(base, 'Projekt med æøå'), directory = path.join(base, 'motor');
  await fs.mkdir(root);
  const secret = 'SYNTETISK_PRIVAT_FILINDHOLD', publicText = 'OFFENTLIG_PROJEKTFIL', referenceText = 'VALGT_REFERENCEMATERIALE';
  for (const file of ['.env', 'api.key', 'api.pem', '.env::$DATA', 'api.key::$DATA', 'api.pem:stream', 'api.key:stream', '.ENV', 'api.KEY::$DATA', 'api.key.', 'api.key ']) await fs.writeFile(path.join(root, file), secret);
  await fs.writeFile(path.join(root, 'almindelig.txt'), publicText);
  await fs.mkdir(path.join(root, 'Secrets')); await fs.writeFile(path.join(root, 'Secrets', 'værdi.txt'), secret);
  await fs.mkdir(path.join(root, 'references')); await fs.writeFile(path.join(root, 'references', 'valgt.txt'), referenceText);
  await fs.writeFile(path.join(root, 'references', 'privat.txt'), secret);
  await fs.symlink(path.join(root, '.env'), path.join(root, 'offentligt-navn.txt'));
  await fs.symlink(path.join(root, 'almindelig.txt'), path.join(root, 'almindeligt-link.txt'));
  const steps = [
    ...['almindelig.txt', 'almindeligt-link.txt'].map(file => ['read', { filePath: path.join(root, file) }, publicText]),
    ['read', { filePath: path.join(root, 'references', 'valgt.txt') }, referenceText],
    ...['.env', '.env::$DATA', 'api.key::$DATA', 'api.pem:stream', '.ENV', 'api.KEY::$DATA', 'api.key.', 'api.key ', 'Secrets/værdi.txt', 'offentligt-navn.txt', 'references/privat.txt'].map(file => ['read', { filePath: path.join(root, file) }, 'blocked']),
    ['write', { filePath: path.join(root, 'ny.key:stream'), content: 'MÅ_IKKE_SKRIVES' }, 'blocked'],
    ['write', { filePath: path.join(root, 'ny.txt'), content: 'Godkendt almindelig fil' }]
  ];
  const requests = [], asked = [], failures = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const main = body.tools?.some(tool => tool.function?.name === 'read');
      const step = main ? steps[body.messages.filter(message => message.role === 'tool').length] : null;
      const delta = step ? { role: 'assistant', tool_calls: [{ index: 0, id: `fil-${requests.length}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { role: 'assistant', content: 'Filprøven er afsluttet.' };
      res.setHeader('content-type', 'text/event-stream');
      const frame = { id: 'kontrolleret', object: 'chat.completion.chunk', created: 1, model: 'filmodel', choices: [{ index: 0, delta, finish_reason: null }] };
      res.write('data: ' + JSON.stringify(frame) + '\n\n');
      res.end('data: ' + JSON.stringify({ ...frame, choices: [{ index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let finish, timer;
  const completed = new Promise(resolve => { finish = resolve; timer = setTimeout(() => resolve('timeout'), 90000); });
  const provider = { npm: '@ai-sdk/openai-compatible', name: 'Lokal filprøve', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'syntetisk' }, models: { filmodel: { name: 'filmodel', tool_call: true, limit: { context: 32768, output: 4096 } } } };
  const engine = new OpenCodeEngine({ root, directory, provider, model: { id: 'filmodel' }, references: ['references/valgt.txt'], mode: 'free', skills: [], onEvent: event => {
    if (event.type === 'permission.asked') {
      asked.push(event.properties);
      const allowed = event.properties.permission === 'edit' && event.properties.metadata?.filepath === path.join(root, 'ny.txt');
      engine.reply(event.properties.id, allowed).catch(error => failures.push(error.message));
    }
    if (['session.idle', 'session.error', 'engine.error'].includes(event.type)) finish(event.type);
  } });
  try {
    await engine.start(); await engine.send('Afprøv filgrænserne.', 'Brug kun de syntetiske prøvefiler.');
    assert.equal(await completed, 'session.idle');
    const main = requests.filter(body => body.tools?.some(tool => tool.function?.name === 'read'));
    const results = main.at(-1).messages.filter(message => message.role === 'tool').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    assert.equal(results.length, steps.length);
    for (const [index, step] of steps.entries()) {
      if (step[2] === 'blocked') assert.match(results[index], /prevents you from using this specific tool call|Aura beskytter denne fil/, step[1].filePath);
      else if (step[2]) assert.match(results[index], new RegExp(step[2]), step[1].filePath);
    }
    assert.equal(results.some(text => text.includes(secret)), false, 'beskyttede bytes når aldrig den kontrollerede model');
    await assert.rejects(fs.access(path.join(root, 'ny.key:stream')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'ny.txt'), 'utf8'), 'Godkendt almindelig fil');
    assert.equal(asked.length, 1); assert.equal(asked[0].permission, 'edit'); assert.deepEqual(failures, []);
    const report = { status: 'bestået', platform: process.platform, root: base, requests: requests.length, checks: ['almindelig fil og link læses', 'valgt reference læses, øvrige referencer afvises', 'beskyttede filer, casevarianter, streamnavne, navnealiaser og symlinkmål afvises af motoren', 'beskyttet streamnavn kan ikke skrives', 'almindelig fil skrives efter enkeltgodkendelse', 'ingen beskyttede bytes når modellen'], limitation: process.platform === 'win32' ? 'Kontrolleret lokal model; ingen ekstern AI eller installation/opdatering.' : 'Rigtig lokal motor på macOS/Linux. Windows-stier og NTFS-semantik er ikke native afprøvet.' };
    await fs.writeFile(path.join(base, 'rapport.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { clearTimeout(timer); await engine.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

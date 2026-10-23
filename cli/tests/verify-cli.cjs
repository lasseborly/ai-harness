const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

(async () => {
  if (process.platform === 'win32') throw new Error('PTY-prøven bruger Unix-pty. Følg den manuelle Windows-prøve i cli/README.md.');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aura-cli-real-')));
  const project = path.join(root, 'projekt med mellemrum'), state = path.join(root, 'state');
  await fs.mkdir(path.join(project, 'public'), { recursive: true });
  await fs.writeFile(path.join(project, 'public/index.html'), '<h1>Før</h1>');
  await fs.writeFile(path.join(project, 'AGENTS.md'), '# Projektregler\nCLI-PROJEKTREGEL: Bevar projektets eksisterende filer.\n');
  const calls = [], modes = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer aura_cli_synthetic_secret_12345') { res.writeHead(401); return res.end('{}'); }
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'cli-test', name: 'Kontrolleret model', pricing: { prompt: '0', completion: '0' } }] })); }
    let raw = ''; for await (const chunk of req) raw += chunk;
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400); return res.end('{}'); }
    calls.push(body);
    const user = [...body.messages].reverse().find(m => m.role === 'user');
    const text = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content || '');
    const mode = text.includes('Vent på svar') ? 'wait' : text.includes('Forbindelsesfejl') ? 'error' : text.includes('Afvis ændringen') ? 'reject' : 'write';
    modes.add(mode);
    if (mode === 'wait') { await fs.writeFile(path.join(state, 'test-wait'), 'waiting'); return; }
    if (mode === 'error') { res.writeHead(401); return res.end(JSON.stringify({ error: { message: 'Syntetisk afvist adgang' } })); }
    const lastUser = body.messages.lastIndexOf(user);
    const hasResult = body.messages.slice(lastUser + 1).some(m => m.role === 'tool');
    const canWrite = body.tools?.some(t => t.function.name === 'write');
    const tool = canWrite && !hasResult ? { id: 'call_cli_' + calls.length, type: 'function', function: { name: 'write', arguments: JSON.stringify({ filePath: path.join(project, 'public/index.html'), content: mode === 'reject' ? '<h1>Må ikke skrives</h1>' : '<h1>Bygget i terminalen</h1>' }) } } : null;
    const content = tool ? 'Jeg ændrer startsiden.\n' : canWrite ? 'Opgaven er behandlet.\nSe resultatet i browseren.' : '## Det bygger vi\nEn enkel startside.\n## Sådan skal det se ud\nEn tydelig overskrift.\n## Teknik og data\nHTML med syntetiske data.\n## Det skal du prøve\nSe resultatet i browseren.';
    if (body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      const chunk = { id: 'cli-test', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content, ...(tool ? { tool_calls: [{ index: 0, ...tool }] } : {}) }, finish_reason: null }] };
      res.write('data: ' + JSON.stringify(chunk) + '\n\n');
      res.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 25, completion_tokens: 15, total_tokens: 40 } }) + '\n\n'); res.end('data: [DONE]\n\n');
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'cli-test', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }] })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const entry = path.resolve(process.argv[2] || path.join(__dirname, '../aura.cjs'));
    const child = spawn('python3', [path.join(__dirname, 'terminal_driver.py'), process.execPath, entry, project, state, `http://127.0.0.1:${server.address().port}/v1`, path.join(root, 'terminal.txt')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HARNESS_OPENCODE_PATH: process.env.HARNESS_OPENCODE_PATH || '' } });
    let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`${output}\nTerminaludskrift: ${path.join(root, 'terminal.txt')}`);
    assert.equal(await fs.readFile(path.join(project, 'public/index.html'), 'utf8'), '<h1>Bygget i terminalen</h1>');
    const settings = await fs.readFile(path.join(state, 'settings.json'), 'utf8'); assert.doesNotMatch(settings, /aura_cli_synthetic_secret_12345/);
    assert.ok(calls.some(body => JSON.stringify(body).includes('FÆLLES-GRUNDLAG-02')), 'De fælles regler skal nå modelserveren');
    const system = calls.flatMap(body => body.messages.filter(message => message.role === 'system')).map(message => JSON.stringify(message.content)).join('\n');
    assert.match(system, /CLI-PROJEKTREGEL/, 'Projektets egne regler når den faktiske modelserver');
    assert.match(system, /Kilde: AGENTS.md/, 'Reglernes oprindelse følger med');
    assert.match(system, /\/save/); assert.match(system, /\/deploy/);
    assert.doesNotMatch(system, /appens Udgiv-knap|Auras knap Udgiv|Start forhåndsvisning/);
    assert.ok(modes.has('reject') && modes.has('error'), 'Afvisning og forbindelsesfejl skal nå serveren');
    await assert.rejects(fs.stat(path.join(state, 'cli.lock')), { code: 'ENOENT' });
    console.log(output.trim()); console.log(JSON.stringify({ root, entry, platform: process.platform, arch: process.arch, motor: 'rigtig OpenCode', model: 'kontrolleret lokal server', betalteKald: 0 }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

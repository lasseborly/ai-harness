const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {normalize,listModels,disclosure,engineProvider}=require('../core/connections.cjs');
const {startGateway}=require('../core/gateway.cjs');
test('Large 4 bruger Mistrals adapter, kataloggrænser og listepris uden en permanent lanceringsrabat', () => {
 const {modelLimits,priceFor}=require('../core/connections.cjs');
 const connection=normalize({kind:'mistral',name:'Min Mistral'});
 for(const id of ['mistral-large-4','mistral-large-4-0']) {
  const model={id,name:'Mistral Large 4'};
  assert.equal(engineProvider(connection,model,'http://127.0.0.1:1/v1','midlertidig').npm,'@ai-sdk/mistral');
  assert.deepEqual(modelLimits(connection,model),{context:1000000,output:32000});
  assert.deepEqual(modelLimits(connection,{...model,limits:{context:524288,output:262144}}),{context:524288,output:32000});
  assert.deepEqual(priceFor(connection,model),{input:1.36,output:4.18,cacheRead:0.14,cacheWrite:1.36});
  const data=disclosure(connection,model);
  assert.match(data.price,/kontrolleret 2026-10-07/);
  assert.match(data.price,/lanceringsrabat er ikke trukket fra/);
  assert.match(data.price,/https:\/\/docs.mistral.ai\/inference\/pricing/);
  assert.equal(data.checkedAt,'2026-09-29','prisopslaget må ikke foregive et nyt opslag af datavilkårene');
  assert.match(data.priceShort,/normal listepris/);
 }
 assert.equal(priceFor(connection,{id:'mistral-large-latest'}),null,'et flytbart alias får ikke automatisk Large 3-prisen');
 assert.equal(priceFor(connection,{id:'mistral-large-4-1'}),null,'en ukendt fremtidig version får ingen opdigtet pris');
 const priced={id:'mistral-large-4',price:{prompt:'0.00000068',completion:'0.00000209',input_cache_read:'0.00000007'}};
 for(const [field,value] of Object.entries({input:0.68,output:2.09,cacheRead:0.07,cacheWrite:0.68})) assert.ok(Math.abs(priceFor(connection,priced)[field]-value)<1e-10,field);
 assert.notEqual(disclosure(connection,priced).fingerprint,disclosure(connection,{id:priced.id}).fingerprint);
 assert.equal(engineProvider({kind:'compatible'}, {id:'mistral-large-4'}, 'http://127.0.0.1:1/v1','t').npm,'@ai-sdk/openai-compatible','egne servere beholder deres valgte protokol');
});
test('Corti og Mistral fastholder destination; ukendte udbydere afvises',()=>{
 for(const [kind,host] of [['corti','ai.eu.corti.app'],['mistral','api.mistral.ai'],['alexandra','inference.alexandra.dk']]) {
  const c=normalize({kind,name:kind,baseURL:'https://example.invalid'});assert.equal(new URL(c.baseURL).hostname,host);
  assert.match(disclosure(c,{id:'test'}).price,/Ukendt/);
  assert.equal(engineProvider(c,{id:'test'},'http://127.0.0.1:1/v1','midlertidig').options.apiKey,'midlertidig');
 }
 assert.throws(()=>normalize({kind:'promte',name:'Promte',baseURL:'https://example.invalid'}),/understøttet/);
});
for(const kind of ['corti','mistral','alexandra']) test(`${kind}: katalog, streaming, værktøjskald og fejl gennem rigtig HTTP-gateway`,async t=>{
 const received=[];let fail=false;
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-noegle');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'kode',capabilities:{completion_chat:true,function_calling:true}},{id:'embedding',capabilities:{completion_chat:false}}]}));
  let raw='';for await(const chunk of req)raw+=chunk;received.push(JSON.parse(raw));
  if(fail){res.writeHead(401);return res.end('hemmelig leverandørfejl');}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'tool1',type:'function',function:{name:'read',arguments:'{}'}}]}}]})+'\n\n');res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const c={kind,name:kind,baseURL:`http://127.0.0.1:${server.address().port}/v1`};
 const gateway=await startGateway(c,{id:'kode'},'test-noegle');
 t.after(async()=>{await gateway.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 await assert.rejects(listModels(c,''),/API-nøgle/);
 const models=await listModels(c,'test-noegle');assert.equal(models.length,1);assert.equal(models[0].capabilities.tools,true);
 const send=()=>fetch(gateway.url+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${gateway.token}`},body:JSON.stringify({model:'kode',stream:true,messages:[{role:'user',content:'Læs filen'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object'}}}]})});
 const response=await send();assert.match(await response.text(),/tool_calls/);assert.equal(received[0].tools[0].function.name,'read');
 fail=true;const rejected=await send();assert.equal(rejected.status,401);assert.doesNotMatch(await rejected.text(),/hemmelig/);assert.equal(received.length,2);
});
test('kendte modeller får deres dokumenterede tokengrænser; ukendte beholder de forsigtige', () => {
 const { modelLimits } = require('../core/connections.cjs');
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-sonnet-5-5' }), { context: 200000, output: 32000 });
 assert.deepEqual(modelLimits({ kind: 'anthropic' }, { id: 'claude-3-haiku-20240307' }), { context: 200000, output: 4096 });
 assert.deepEqual(modelLimits({ kind: 'ollama' }, { id: 'qwen3:8b' }), { context: 32768, output: 4096 });
 // Kataloget har forrang, men et svar kan aldrig fylde mere end halvdelen af konteksten.
 assert.deepEqual(modelLimits({ kind: 'compatible' }, { id: 'lille', limits: { context: 8192, output: 8192 } }), { context: 8192, output: 4096 });
 assert.equal(engineProvider({ kind: 'anthropic', name: 'a' }, { id: 'claude-opus-5-5' }, 'http://127.0.0.1:1/v1', 't').models['claude-opus-5-5'].limit.output, 32000);
});
test('gatewayen lader en langsom strøm køre færdig, men stopper stilstand', async t => {
 let stall = false;
 const server = http.createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  // Fem bidder med 150 ms mellemrum: samlet længere end grænsen for stilstand, men aldrig stille så længe.
  for (let i = 0; i < 5; i++) { res.write(`data: {"del":${i}}\n\n`); await new Promise(r => setTimeout(r, 150)); if (stall && i === 1) await new Promise(r => setTimeout(r, 1000)); }
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const failures = [];
 const gateway = await startGateway({ kind: 'compatible', name: 'Prøve', baseURL: `http://127.0.0.1:${server.address().port}/v1` }, { id: 'kode' }, '', null, message => failures.push(message), { idleLimit: 400 });
 t.after(async () => { await gateway.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
 const send = () => fetch(gateway.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'kode', stream: true, messages: [] }) });
 const text = await (await send()).text();
 assert.match(text, /"del":4/); assert.match(text, /\[DONE\]/); assert.deepEqual(failures, []);
 stall = true;
 await assert.rejects((await send()).text());
 assert.match(failures[0], /svarede ikke i 1 s, så forbindelsen blev afbrudt/);
});
test('Zens vilkår vises for hver model', () => {
 const zen = { kind: 'zen', name: 'Zen', baseURL: 'https://opencode.ai/zen/v1' };
 assert.match(disclosure(zen, { id: 'longcat-2.5-preview-free' }).trainingShort, /bruges ikke til træning/);
 assert.match(disclosure(zen, { id: 'muse-spark-1.3-contributor-free' }).trainingShort, /Metas modeller/);
 assert.match(disclosure(zen, { id: 'big-pickle' }).trainingShort, /forbedre modellen/);
 assert.equal(disclosure(zen, { id: 'claude-sonnet-5-5' }).regionShort, 'USA');
});

test('Corti-forbindelsen bruger adressen fra nøglens miljø og aldrig USA', () => {
  // Opdigtede nøgler i samme form som Cortis: miljøet står først, derefter resten, alt i base64.
  const key = environment => Buffer.from(`${environment}:password:testklient:testbruger:hemmelighed`).toString('base64');
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: key('fr') }).baseURL, 'https://ai.fr.corti.app/v1');
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: key('eu') }).baseURL, 'https://ai.eu.corti.app/v1');
  assert.equal(normalize({ kind: 'corti', name: 'Corti', apiKey: 'en-nøgle-i-et-andet-format' }).baseURL, 'https://ai.eu.corti.app/v1');
  assert.equal(normalize({ kind: 'corti', name: 'Corti' }).baseURL, 'https://ai.eu.corti.app/v1');
  assert.throws(() => normalize({ kind: 'corti', name: 'Corti', apiKey: key('us') }), /amerikanske miljø/);
  assert.throws(() => normalize({ kind: 'corti', name: 'Corti', apiKey: key('dk') }), /endnu ikke bruger/);
  // Behandlingsstedet i "Før du sender" følger adressen og har Cortis kilde.
  const france = disclosure({ kind: 'corti', name: 'Corti', baseURL: 'https://ai.fr.corti.app/v1' }, { id: 'corti-s1' });
  assert.match(france.regionShort, /Scaleway i Paris/);
  assert.equal(france.source, 'https://docs.corti.ai/authentication/environments_tenants');
  assert.match(france.recipients, /ai\.fr\.corti\.app/);
  assert.doesNotMatch(disclosure({ kind: 'corti', name: 'Corti', baseURL: 'https://ai.eu.corti.app/v1' }, { id: 'corti-s1' }).regionShort, /Paris/);
});

test('når Corti afviser nøglen, siger beskeden hvilken adresse appen prøvede', async t => {
  const { requestJSON } = require('../core/connections.cjs');
  const server = require('node:http').createServer((req, res) => { res.statusCode = 401; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  await assert.rejects(requestJSON(`http://127.0.0.1:${server.address().port}/v1/models`, { key: 'afvist', kind: 'corti' }), /Corti afviste nøglen på adressen i EU\. Brug en nøgle fra Corti Models/);
  await assert.rejects(requestJSON(`http://127.0.0.1:${server.address().port}/v1/models`, { key: 'afvist', kind: 'mistral' }), /Serveren afviste adgangen/);
});

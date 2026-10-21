const { randomUUID, createHash } = require('node:crypto');
const definitions = {
  openai: { name: 'OpenAI API', provider: 'OpenAI', baseURL: 'https://api.openai.com/v1', protocol: 'responses', keyRequired: true, source: 'https://developers.openai.com/api/docs/guides/your-data', checkedAt: '2026-10-15',
    training: 'API-data bruges ikke til træning som standard. Et aktivt tilvalg hos OpenAI kan ændre dette.', trainingShort: 'Bruges ikke til træning som standard',
    region: 'Ikke fastlagt. Aura bruger OpenAIs globale API-adresse; den dokumenterer ikke behandling i EU.', regionShort: 'Global API-adresse, region ikke fastlagt',
    retention: 'Aura slår lagring af Responses-svar fra. OpenAI kan som standard gemme indhold i misbrugslogs i op til 30 dage. Særlige aftaler kan ændre dette.', retentionShort: 'Misbrugslogs i op til 30 dage som standard' },
  azure: { name: 'Azure OpenAI / Microsoft Foundry', provider: 'Microsoft Azure', baseURL: '', protocol: 'responses', keyRequired: true, source: 'https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy', checkedAt: '2026-10-15',
    training: 'Microsoft oplyser, at prompts og svar ikke bruges til at træne grundmodeller uden tilladelse eller instruktion.', trainingShort: 'Grundmodeller trænes ikke uden tilladelse',
    region: 'Afhænger af jeres deployment. Global kan behandle data på tværs af geografier, DataZone inden for sin zone. Serveradressen alene dokumenterer ikke regionen.', regionShort: 'Afhænger af jeres Azure-deployment',
    retention: 'Afhænger af jeres aftale og misbrugsovervågning. Aura slår lagring af Responses-svar fra; det slår ikke Microsofts misbrugsovervågning fra.', retentionShort: 'Afhænger af aftale og misbrugsovervågning' },
  // Vilkår for de tre udbydere i opsætningen er kontrolleret hos udbyderne 29. september 2026. De korte tekster vises i resuméet før afsendelse.
  corti: { name: 'Corti S1 · EU', provider: 'Corti', baseURL: 'https://ai.eu.corti.app/v1', protocol: 'openai', keyRequired: true, source: 'https://docs.corti.ai/models/regions', checkedAt: '2026-09-29',
    training: 'Corti oplyser, at data i EU-projekter aldrig bruges til træning. Kontrollér aftalen for jeres projekt.', trainingShort: 'Bruges ikke til træning, ifølge Corti',
    region: 'EU ifølge Cortis dokumentation: EU-projekter kører på Cortis egen klynge i EU. Denne adapter bruger kun EU-endpointet; den konkrete installation er ikke uafhængigt verificeret.', regionShort: 'EU, på Cortis egne servere',
    retention: 'Corti oplyser, at prompts og svar i EU-projekter aldrig gemmes eller logges.', retentionShort: 'Gemmes ikke, ifølge Corti' },
  alexandra: { name: 'Alexandra AI Platform · Danmark', provider: 'Alexandra Instituttet', baseURL: 'https://inference.alexandra.dk/v1', protocol: 'openai', keyRequired: true, source: 'https://platform.alexandra.dk/platform-ui/docs', checkedAt: '2026-10-21',
    training: 'Alexandra oplyser, at prompts og data ikke bruges til at træne modeller. Kontrollér aftalen for jeres projekt.', trainingShort: 'Bruges ikke til træning, ifølge Alexandra',
    region: 'Danmark ifølge Alexandra: platformen hostes i Danmark. Den konkrete installation er ikke uafhængigt verificeret.', regionShort: 'Danmark, hos Alexandra Instituttet',
    retention: 'Ikke fastlagt i appen. Se Alexandras dokumentation for opbevaring af prompts og svar.', retentionShort: 'Se Alexandras dokumentation' },
  mistral: { name: 'Mistral API', provider: 'Mistral', baseURL: 'https://api.mistral.ai/v1', protocol: 'openai', keyRequired: true, source: 'https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models', checkedAt: '2026-09-29',
    training: 'På Mistrals gratis plan kan input og svar bruges til træning. Med betalt forbrug kan du fravælge det under Privacy i Mistral Admin. Appen kontrollerer ikke kontoens valg.', trainingShort: 'Kan bruges til træning på gratisplanen',
    region: 'Mistral hoster data i EU, men det globale endpoint api.mistral.ai lover ikke, hvor selve behandlingen sker. Garanteret EU-behandling kræver Mistrals EU-endpoint, som appen ikke bruger endnu.', regionShort: 'Hostes i EU, behandlingssted ikke garanteret',
    retention: 'Gemmes i 30 dage til misbrugskontrol. Nuldataopbevaring kan aftales ved betalt forbrug.', retentionShort: 'Gemmes i 30 dage' },
  anthropic: { name: 'Anthropic API', provider: 'Anthropic', baseURL: 'https://api.anthropic.com/v1', protocol: 'anthropic', keyRequired: true, source: 'https://platform.claude.com/docs/en/manage-claude/data-residency', checkedAt: '2026-09-29',
    training: 'Anthropic oplyser: API-data bruges ikke som standard til træning; aftaler og aktivt tilvalg kan ændre dette.', trainingShort: 'Bruges ikke til træning som standard',
    region: 'Globalt. Anthropic kan behandle data i flere lande, også uden for EU, og gemmer data i USA. Der findes ingen EU-mulighed.', regionShort: 'Globalt, også uden for EU',
    retention: 'Slettes inden for 30 dage. Indhold, der markeres for misbrug, kan gemmes i op til 2 år.', retentionShort: 'Slettes inden for 30 dage' },
  openrouter: { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', protocol: 'openai', keyRequired: true, source: 'https://openrouter.ai/docs/guides/privacy/provider-logging', training: 'Afhænger af den valgte modeludbyder og kontoens indstillinger.' },
  // Zen-vilkår kontrolleret på opencode.ai/docs/zen 29. september 2026. Træning afhænger af modellen; se zenTerms.
  zen: { name: 'OpenCode Zen', provider: 'OpenCode Zen', baseURL: 'https://opencode.ai/zen/v1', protocol: 'openai', keyRequired: false, source: 'https://opencode.ai/docs/zen/', checkedAt: '2026-09-29',
    training: 'Afhænger af modellen. Flere af Zens gratis modeller kan bruge dine data til at forbedre eller træne modeller.', region: 'USA. Zen oplyser, at alle modeller hostes i USA.', regionShort: 'USA',
    retention: 'Afhænger af modellen. Zen oplyser nul opbevaring for de fleste modeller og 30 dage for OpenAI og Anthropic.' },
  ollama: { name: 'Ollama', baseURL: 'http://127.0.0.1:11434', protocol: 'openai', keyRequired: false, source: 'https://docs.ollama.com/api/introduction', training: 'Afhænger af den valgte lokale modelserver og eventuel cloud-videresendelse.' },
  compatible: { name: 'Egen server', baseURL: '', protocol: 'openai', keyRequired: false, source: '', training: 'Ukendt. Kontroller serverens konfiguration og eventuel videresendelse.' }
};
// Zens gratis modeller har forskellige vilkår. Kontrolleret på opencode.ai/docs/zen 29. september 2026.
const zenTerms = [
  [/^(space-bunny|longcat)/, 'Gemmes ikke og bruges ikke til træning, ifølge Zen', 'Zen oplyser nul opbevaring, og at data ikke bruges.'],
  [/^muse-spark/, 'Bruges til at træne Metas modeller', 'Zen oplyser, at prompts og svar må bruges til at træne fremtidige Meta-modeller.'],
  [/^(big-pickle|mimo|ling|nemotron|jev|deepseek)/, 'Kan bruges til at forbedre modellen', 'Zen oplyser, at indsamlede data kan bruges til at forbedre modellen.']
];
// Oplyste API-priser i USD pr. million tokens. Kontrolleret 29. september 2026, med særskilte datoer ved nye opslag.
// Kataloget har forrang, når det selv oplyser en pris.
const knownPrices = [
  ['anthropic', /^claude-fable-5/, 10, 50], ['anthropic', /^claude-opus-5/, 4, 20], ['anthropic', /^claude-sonnet-5/, 2, 10], ['anthropic', /^claude-haiku-4-5/, 1, 5],
  ['mistral', /^mistral-large-4(?:-0)?$/, 1.36, 4.18, { cacheRead: 0.14, checkedAt: '2026-10-07', note: 'Overslaget bruger normal listepris. Mistrals midlertidige lanceringsrabat er ikke trukket fra.' }],
  // Et bevægeligt "latest"-alias må ikke få den gamle Large 3-pris uden dokumentation for, hvad det peger på.
  ['mistral', /^mistral-medium-(3-5|latest)/, 1.5, 7.5], ['mistral', /^mistral-large-2512$/, 0.5, 1.5], ['mistral', /^codestral-(2508|latest)/, 0.3, 0.9],
  ['corti', /^corti-s1-mini/, 1, 4], ['corti', /^corti-s1/, 2, 8]
];
const priceSources = { anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing', mistral: 'https://docs.mistral.ai/inference/pricing', corti: 'https://docs.corti.ai/models/models' };
// Pris i USD pr. million tokens til et anslået forbrug. Cachelæsning og -skrivning følger udbydernes prislister;
// kendes cacheprisen ikke, regnes den som almindeligt input.
function priceFor(connection, model, route = null) {
  const catalog = route?.price || model.price;
  if (catalog && catalog.prompt != null && catalog.completion != null) {
    const per = value => Number(value) * 1e6, input = per(catalog.prompt);
    if (!Number.isFinite(input) || !Number.isFinite(per(catalog.completion))) return null;
    return { ...(catalog.currency === 'DKK' ? { currency: 'DKK' } : {}), input, output: per(catalog.completion), cacheRead: catalog.input_cache_read != null ? per(catalog.input_cache_read) : input, cacheWrite: catalog.input_cache_write != null ? per(catalog.input_cache_write) : input };
  }
  const known = knownPrice(connection.kind, model.id);
  if (!known) return null;
  const read = connection.kind === 'anthropic' ? (/^claude-fable-5/.test(model.id) ? 0.025 : /^claude-opus-5-5/.test(model.id) ? 0.05 : 0.1) : connection.kind === 'corti' ? 0.1 : 1;
  return { input: known.input, output: known.output, cacheRead: known.cacheRead ?? known.input * read, cacheWrite: connection.kind === 'anthropic' ? known.input * 1.25 : known.input };
}
function knownPrice(kind, id) { const found = knownPrices.find(([provider, pattern]) => provider === kind && pattern.test(id)); return found ? { input: found[2], output: found[3], source: priceSources[kind], checkedAt: definitions[kind].checkedAt, ...found[4] } : null; }
const usd = value => value.toLocaleString('da-DK', { maximumFractionDigits: 2 });
function endpoint(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Angiv en fuld serveradresse med http:// eller https://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Serveradressen må ikke indeholde login, parametre eller fragmenter.');
  return url.href.replace(/\/$/, '');
}
// Cortis nøgler bærer deres miljø først, fx "fr:" i base64, og virker kun i deres eget miljø. Appen vælger derfor adressen
// ud fra nøglen. Kun EU og Frankrig bruges; appen skifter aldrig til USA.
const CORTI = { eu: 'https://ai.eu.corti.app/v1', fr: 'https://ai.fr.corti.app/v1' };
const cortiFrance = {
  region: 'Frankrig ifølge Corti: miljøet fr kører hos Scaleway i Paris, og adgang kræver aftale med Corti. Appen bruger kun Cortis adresser i EU og Frankrig og skifter aldrig til USA.',
  regionShort: 'Frankrig, hos Scaleway i Paris ifølge Corti', source: 'https://docs.corti.ai/authentication/environments_tenants'
};
function cortiEndpoint(key) {
  const environment = /^([a-z]{2}):/.exec(Buffer.from(String(key), 'base64').toString('utf8'))?.[1];
  if (!environment) return CORTI.eu;
  if (CORTI[environment]) return CORTI[environment];
  throw new Error(environment === 'us' ? 'Nøglen hører til Cortis amerikanske miljø. Aura bruger kun Corti i EU og Frankrig.' : `Nøglen hører til Cortis miljø "${environment}", som Aura endnu ikke bruger. Brug en nøgle fra et projekt i EU eller Frankrig.`);
}
function assertSupported(connection) {
  if (connection?.kind === 'komplai') throw new Error('komplai bruges nu kun til udgivelse via Del. Vælg en anden AI-forbindelse.');
  if (!connection || !Object.hasOwn(definitions, connection.kind)) throw new Error('Vælg en understøttet forbindelsestype.');
}
function normalize(input) {
  assertSupported(input);
  const def = definitions[input.kind];
  const baseURL = input.kind === 'azure' ? azureEndpoint(input.baseURL) : endpoint(['compatible', 'ollama'].includes(input.kind) ? input.baseURL : input.kind === 'corti' && input.apiKey ? cortiEndpoint(input.apiKey) : def.baseURL);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Angiv et forbindelsesnavn på højst 100 tegn.');
  if (input.apiKey && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey))) throw new Error('API-nøglen er ugyldig.');
  const extra = {};
  if (input.kind === 'azure') {
    if (typeof input.deployment !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.deployment.trim())) throw new Error('Angiv deployment-navnet fra Azure. Brug bogstaver, tal, punktum, bindestreg eller understregning.');
    if (input.protocol && !['responses', 'openai'].includes(input.protocol)) throw new Error('Vælg Responses eller Chat Completions.');
    extra.deployment = input.deployment.trim(); extra.protocol = input.protocol || 'responses';
  }
  return { id: input.id || randomUUID(), name: input.name.trim(), kind: input.kind, baseURL, ...extra };
}
function azureEndpoint(value) {
  const url = new URL(endpoint(value));
  if (url.protocol !== 'https:' || url.port || !/^[a-z0-9-]+\.(openai\.azure\.com|services\.ai\.azure\.com)$/.test(url.hostname) || !['/', '/openai/v1'].includes(url.pathname)) throw new Error('Brug ressourcens HTTPS-adresse fra Azure OpenAI eller Foundry, fx https://mit-projekt.openai.azure.com.');
  return `${url.origin}/openai/v1`;
}
function usesResponses(connection) { return (connection.protocol || definitions[connection.kind]?.protocol) === 'responses'; }
async function requestJSON(url, { key = '', kind, method = 'GET', body, signal } = {}) {
  const headers = { accept: 'application/json' };
  if (key) Object.assign(headers, kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : kind === 'azure' ? { 'api-key': key } : { Authorization: `Bearer ${key}` });
  if (body) headers['content-type'] = 'application/json';
  let response;
  try { response = await fetch(url, { method, headers, body: body && JSON.stringify(body), signal: signal || AbortSignal.timeout(15000), redirect: 'error' }); }
  catch { throw new Error('Serveren svarer ikke. Kontrollér adresse, port, netværk og eventuelt Tailscale.'); }
  // En Corti-nøgle virker kun i sit eget miljø. Beskeden siger, hvilken adresse appen prøvede, så testeren ved, hvad der skal tjekkes.
  if (!response.ok && kind === 'corti' && (response.status === 401 || response.status === 403)) throw new Error(`Corti afviste nøglen på ${url.startsWith(CORTI.fr) ? 'adressen i Frankrig' : 'adressen i EU'}. Brug en nøgle fra Corti Models i et projekt i EU eller Frankrig; en nøgle virker kun i sit eget miljø.`);
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Serveren afviste adgangen. Kontrollér API-nøglen og tilladelserne.' : `Serveren svarede med HTTP ${response.status}. Ingen anden forbindelse blev valgt.`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8_000_000) throw new Error('Serverens svar er for stort.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { throw new Error('Serveren returnerede ikke gyldige modeloplysninger.'); }
}
async function listModels(connection, key) {
  assertSupported(connection);
  if (definitions[connection.kind].keyRequired && !key) throw new Error('Denne forbindelse kræver en API-nøgle.');
  const ollama = connection.kind === 'ollama';
  const response = await requestJSON(`${connection.baseURL}${ollama ? '/api/tags' : '/models'}`, { key, kind: connection.kind });
  const models = response[ollama ? 'models' : 'data'];
  if (!Array.isArray(models)) throw new Error('Serveren returnerede ingen læsbar modelliste.');
  // Azures katalog beskriver modeller, ikke kundens deployment-navne. Vi sender kun til navnet, brugeren har angivet.
  if (connection.kind === 'azure') return [{ id: connection.deployment, name: connection.deployment, price: null, capabilities: { tools: null }, configuredDeployment: true }];
  return models.slice(0, 5000).filter(model => model && model.capabilities?.completion_chat !== false && !(connection.kind === 'corti' && /embedding/.test(model.id)) && (connection.kind !== 'openai' || /^(gpt-|chatgpt-|codex-|o\d)/.test(model.id) && !/audio|realtime|transcribe|image|tts|search|deep-research/.test(model.id))).map(model => ({
    id: ollama ? model.name : model.id, name: model.name || model.display_name || model.id,
    price: model.pricing || null, capabilities: { tools: model.capabilities?.function_calling ?? model.supported_parameters?.includes('tools') ?? null },
    limits: { context: tokenCount(model.context_length ?? model.max_context_length ?? model.context_window ?? model.max_input_tokens), output: tokenCount(model.top_provider?.max_completion_tokens ?? model.max_output_tokens ?? model.max_tokens) },
    local: ollama && !model.remote_host && !/:.*cloud/.test(model.name) ? 'Ikke verificeret' : null
  })).filter(model => typeof model.id === 'string');
}
async function routes(connection, key, model) {
  assertSupported(connection);
  if (connection.kind !== 'openrouter') return [];
  const data = await requestJSON(`${connection.baseURL}/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`, { key });
  return (data.data?.endpoints || []).map(item => ({ id: item.tag || item.provider_name, name: item.provider_name, price: item.pricing || null, policy: item.data_policy || null })).filter(route => route.id);
}
function disclosure(connection, model, route = null) {
  assertSupported(connection);
  const def = definitions[connection.kind];
  const url = new URL(connection.baseURL);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const site = connection.kind === 'corti' && `${url.origin}/v1` === CORTI.fr ? cortiFrance : {};
  const price = route?.price || model.price;
  const free = price && Number(price.prompt) === 0 && Number(price.completion) === 0;
  const known = knownPrice(connection.kind, model.id);
  const zen = connection.kind === 'zen' ? zenTerms.find(([pattern]) => pattern.test(model.id)) : null;
  const data = {
    connection: connection.name, model: model.id, endpoint: connection.baseURL, protocol: connection.protocol || def.protocol,
    recipients: connection.kind === 'openrouter' ? `OpenRouter → ${route?.name || 'Ukendt modeludbyder'}` : `${def.name} · ${url.hostname}`,
    region: site.region || def.region || (loopback ? 'Forbindelsen går til denne computer. Selve modellens behandlingssted er endnu ikke verificeret.' : 'Ukendt; serveradressen dokumenterer ikke behandlingsstedet.'),
    retention: def.retention || 'Ikke verificeret for denne forbindelse. Konto-, model- og servervilkår kan variere.',
    training: zen ? zen[2] : def.training, price: free ? '0 i oplyst pris for input/output. Kvoter, øvrige gebyrer og senere prisændringer kan gælde.' : price ? `Oplyst API-pris: ${JSON.stringify(price)}` : known ? `${usd(known.input)} USD pr. million tokens, du sender, og ${usd(known.output)} USD pr. million tokens i svar, ifølge ${def.provider}s prisliste (kontrolleret ${known.checkedAt}). ${known.note ? known.note + ' ' : ''}Prisen kan ændre sig; se dit forbrug hos udbyderen. Kilde: ${known.source}` : 'Ukendt pris eller egen drift. Ingen garanti om gratis brug.',
    provider: def.provider || def.name, regionShort: site.regionShort || def.regionShort || null, trainingShort: zen?.[1] || def.trainingShort || null, retentionShort: def.retentionShort || null,
    priceShort: free ? 'Gratis ifølge kataloget. Kvoter kan gælde.' : known && !price ? `${usd(known.input)} USD ind og ${usd(known.output)} USD ud pr. million tokens${known.note ? ' · normal listepris' : ''}` : null,
    capabilities: model.capabilities?.tools === true ? 'Kataloget angiver værktøjskald; faktisk kodearbejde er ikke verificeret for denne model.' : model.capabilities?.tools === false ? 'Kataloget angiver ikke værktøjsunderstøttelse. Modellen kan være uegnet som kodeagent.' : 'Værktøjsunderstøttelse er ukendt. Modelkataloget er ikke et kompatibilitetsbevis.',
    material: 'Beskeder, samtalehistorik, fælles regler, projektkontekst og de filer/værktøjsresultater agenten læser. Referencefiler kræver særskilt tilvalg. Modelskift starter en ny session.',
    security: url.protocol === 'http:' && !loopback ? 'HTTP uden TLS. Tailscale-kryptering er kun gældende, hvis forbindelsen faktisk går gennem Tailscale; det er ikke verificeret her.' : 'Forbindelsesadressen er kontrolleret. Det er ikke en sikkerhedsgodkendelse af tjenesten.',
    source: site.source || def.source || 'Ingen leverandørkilde registreret; oplysninger skal kontrolleres hos serverens ejer.', checkedAt: def.checkedAt || '2026-09-22', evidence: 'Leverandørdokumentation og modelkatalog; ikke uafhængig revision.', route: route?.id || null
  };
  return { ...data, fingerprint: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
// Tal fra et modelkatalog bruges kun, når de ligner rigtige tokengrænser.
function tokenCount(value) { const number = Number(value); return Number.isInteger(number) && number >= 1024 && number <= 10_000_000 ? number : null; }
// Grænser for kendte modeller. Kataloget har forrang, når det oplyser grænserne.
// Ukendte modeller beholder de forsigtige standarder, så en lille lokal model ikke får for store kald.
const knownLimits = [
  ['anthropic', /^claude-3-haiku/, { context: 200000, output: 4096 }],
  ['anthropic', /^claude-3-5-/, { context: 200000, output: 8192 }],
  // Claude 5 kan rumme en million tokens. Samtalen komprimeres alligevel ved 200.000, så hvert kald ikke bliver dyrt.
  ['anthropic', /^claude-/, { context: 200000, output: 32000 }],
  ['zen', /^claude-/, { context: 200000, output: 32000 }],
  // Modelkortet oplyser 1M kontekst. De 32.000 svartokens er Auras loft, ikke modellens dokumenterede maksimum.
  ['mistral', /^mistral-large-4(?:-0)?$/, { context: 1000000, output: 32000 }],
  ['mistral', /^mistral-(large|medium)/, { context: 200000, output: 16384 }],
  ['mistral', /codestral|devstral/, { context: 128000, output: 16384 }],
  // Cortis katalog oplyser 262.144 tokens kontekst, men ingen grænse for svarlængden. Corti S1 tænker, før den svarer, og
  // tankerne tæller med i svaret. Med appens forsigtige standard på 4.096 blev svaret skåret af, før en fil blev skrevet.
  ['corti', /^corti-s1/, { context: 262144, output: 32000 }]
];
function modelLimits(connection, model) {
  const known = knownLimits.find(([kind, pattern]) => kind === connection.kind && pattern.test(model.id))?.[2];
  const context = model.limits?.context || known?.context || 32768;
  // OpenCode sender højst 32.000 svartokens pr. kald. Et svar må aldrig kunne fylde hele konteksten.
  const output = Math.min(model.limits?.output || known?.output || 4096, 32000, Math.floor(context / 2));
  return { context, output };
}
function engineProvider(connection, model, gatewayURL, token) {
  assertSupported(connection);
  const anthropic = connection.kind === 'anthropic' || (connection.kind === 'zen' && /^claude-/.test(model.id));
  // Mistral sender både tekst og strukturerede tænkeafsnit. Dets adapter bevarer disse gennem streaming og værktøjssvar.
  return { npm: anthropic ? '@ai-sdk/anthropic' : connection.kind === 'mistral' ? '@ai-sdk/mistral' : usesResponses(connection) ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible', name: connection.name,
    options: { baseURL: gatewayURL, apiKey: token },
    models: { [model.id]: { name: model.name, tool_call: true, limit: modelLimits(connection, model), ...(usesResponses(connection) ? { options: { store: false, include: ['reasoning.encrypted_content'] } } : {}) } } };
}
module.exports = { definitions, assertSupported, endpoint, normalize, requestJSON, listModels, routes, disclosure, engineProvider, modelLimits, priceFor, usesResponses };

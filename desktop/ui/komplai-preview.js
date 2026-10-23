// En komplai Run-app i forhåndsvisningen spørger siden omkring den (komplaiPreview), når SDK'et kalder komplai.
// Aura sender kaldet til Hubs forhåndsvisning af din egen app: rigtig identitet og AI, data adskilt fra appens rigtige data.
// Kun den aktive forhåndsvisnings vindue må bruge det valgte projekts forbindelse.
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#komplai-preview');
  let checked = false;
  const frameFor = source => { const frame = $('#preview'); return frame?.contentWindow === source ? frame : null; };
  const active = (frame, owner) => frame === $('#preview') && owner?.root === current?.root && owner?.chat === view.id;
  function show(text, action = null, title = '') {
    status.hidden = !text; status.textContent = text; status.title = title; status.disabled = !action;
    status.onclick = action ? () => action().catch(error => show(error.message)) : null;
  }
  async function refresh(frame, owner) {
    const r = await window.harness.komplaiPreviewState(undefined, owner);
    if (!active(frame, owner)) return;
    if (!r.ok || !r.value.active) { show(''); return; }
    const s = r.value;
    if (!s.connected) { show('Log ind med komplai for at afprøve appen', async () => window.openKomplaiLogin?.()); return; }
    if (!s.link) {
      show(`Opret appen ${s.name} i komplai`, async () => {
        if (!active(frame, owner)) return;
        show('Opretter appen i komplai …');
        const created = await window.harness.komplaiPreviewCreate(undefined, owner);
        if (!active(frame, owner)) return;
        if (!created.ok) throw Error(created.error);
        // Appen har opgivet sine kald, mens appen blev oprettet. En genindlæsning starter dem igen,
        // og status vises på ny ved første kald.
        checked = false; frame.src = frame.src;
      });
      return;
    }
    show(s.problem ? `komplai: ${s.problem}` : `komplai · ${s.link.name || 'din app'} · forhåndsvisning`, null, 'Din rigtige identitet og AI-adgang. Data i forhåndsvisningen holdes adskilt fra appens rigtige data.');
  }
  window.addEventListener('message', async event => {
    const frame = frameFor(event.source), d = event.data;
    if (!frame || !d || typeof d !== 'object' || d.komplaiPreview !== 1 || d.kind !== 'call' || !Number.isSafeInteger(d.id) || typeof d.path !== 'string' || typeof d.method !== 'string') return;
    const owner = selectedOwner();
    let answer;
    try { const r = await window.harness.komplaiPreviewCall({ method: d.method, path: d.path, body: d.body ?? null }, owner); answer = r.ok ? r.value : { status: 503, body: { error: 'unavailable' } }; }
    catch { answer = { status: 503, body: { error: 'unavailable' } }; }
    if (!active(frame, owner)) return;
    event.source.postMessage({ komplaiPreview: 1, kind: 'answer', id: d.id, status: answer.status, body: answer.body }, '*');
    // Status vises ved første kald og igen, når komplai afviser noget.
    if (!checked || answer.status >= 400) { checked = true; void refresh(frame, owner); }
  });
  window.addEventListener('aura:project', () => { checked = false; show(''); });
  window.addEventListener('harness:komplai-connected', () => { checked = false; const frame = $('#preview'); if (frame?.src && frame.src !== 'about:blank') frame.src = frame.src; });
})();

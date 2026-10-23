// Kommandopaletten: ⌘K (Ctrl+K på Windows og Linux) finder en handling, en samtale eller et projekt.
// Den er valgfri og har ingen knap; alt i den findes også i appen. En handling udføres ved at trykke på appens egen
// knap, så funktioner, der er slået fra, og handlinger, der er låst under en opgave, heller ikke kan vælges her.
(() => {
  const dialog = $('#palette'), input = $('#palette-input'), list = $('#palette-list'), empty = $('#palette-empty');
  const mac = /Mac/i.test(navigator.platform);
  let items = [], active = 0, returnFocus = null;
  // Appens egne knapper. Kun knapper, der er synlige i deres sammenhæng og ikke er låst, kan bruges.
  const actions = [
    { label: 'Ny samtale', target: '#project-list .project-entry.is-current .project-add', words: ['chat', 'session', 'plus', 'start'], first: true },
    { label: 'Skriv til AI’en', target: '#prompt', focus: true, words: ['besked', 'skrivefelt', 'prompt'], first: true },
    { label: 'Ret i siden', target: '#preview-pick', words: ['vælg element', 'tekst', 'rediger'], first: true },
    { label: 'Vis forhåndsvisningen', target: '#tab-preview', words: ['preview', 'fane', 'side'] },
    { label: 'Vis planen', target: '#tab-plan', words: ['plan', 'brief', 'fane'] },
    { label: 'Vis ændringerne', target: '#tab-changes', words: ['diff', 'fane', 'filer'], first: true },
    { label: 'Vis koden', target: '#tab-code', words: ['filer', 'fane', 'kode'] },
    { label: 'Vis aktiviteten', target: '#tab-activity', words: ['log', 'fane', 'værktøjer'] },
    { label: 'Genindlæs forhåndsvisningen', target: '#refresh', words: ['opdater', 'reload'] },
    { label: 'Gem version', target: '#git-button', words: ['versioner', 'git', 'fortryd', 'historik'], first: true },
    { label: 'Sikkerhedskopi', target: '#publish-button', words: ['github', 'backup', 'upload'] },
    { label: 'Udgiv', target: '#deploy-button', words: ['del', 'deling', 'publicer', 'deploy', 'vercel', 'azure'] },
    { label: 'Vælg AI-model', target: '#model-chip', words: ['model', 'indsats', 'skift'] },
    { label: 'Flet ind i projektet', target: '#merge-copy', words: ['kopi', 'indflet', 'samtale'], first: true },
    { label: 'Stop opgaven', target: '#stop', words: ['afbryd', 'stop'], first: true },
    { label: 'Nyt projekt', target: '#new', words: ['opret', 'idé'] },
    { label: 'Åbn et projekt fra computeren', target: '#open', words: ['mappe', 'åbn'] },
    { label: 'AI-forbindelser', target: '#connections-button', words: ['udbyder', 'nøgle', 'api'] },
    { label: 'Funktioner', target: '#features-button', words: ['indstillinger', 'slå til', 'slå fra'] },
    { label: 'Projektets indstillinger', target: '#project-settings-button', words: ['tilladelser', 'godkendelser', 'automatisk', 'opstart', 'server', 'netværk'] },
    { label: 'Hjælp og feedback', target: '#support-button', words: ['support', 'fejlrapport'], first: true },
    { label: 'Aura Harness i dit kodeværktøj', target: '#tools-button', words: ['claude code', 'codex', 'cursor', 'skills'] },
    { label: 'Vis introduktion', target: '#intro-button', words: ['velkomst', 'guide'] },
    { label: () => $('#sidebar-toggle').getAttribute('aria-label') || 'Skjul sidepanelet', target: '#sidebar-toggle', words: ['sidepanel', 'menu', 'samtaler'] }
  ];
  // Synlig i sin sammenhæng: ingen skjult forælder. Lukkede menuer tæller ikke som skjulte.
  const usable = element => element && !element.disabled && !element.closest('[hidden]') && !element.closest('dialog:not([open])');
  const fold = text => String(text || '').toLocaleLowerCase('da').normalize('NFD').replace(/[̀-ͯ]/g, '');
  function score(item, query) {
    if (!query) return 1;
    const label = fold(item.label), words = item.words.map(fold);
    if (label.startsWith(query)) return 100;
    if (label.split(/[\s»«·,]+/).some(word => word.startsWith(query))) return 80;
    if (label.includes(query)) return 60;
    if (words.some(word => word.startsWith(query))) return 40;
    if (words.some(word => word.includes(query))) return 20;
    const parts = query.split(/\s+/).filter(Boolean);
    return parts.length > 1 && parts.every(part => label.includes(part) || words.some(word => word.includes(part))) ? 10 : 0;
  }
  // Alle valg lige nu: handlinger, det åbne projekts samtaler og de seneste andre projekter.
  function collect() {
    const found = [];
    for (const entry of actions) {
      const element = $(entry.target);
      if (!usable(element) || (entry.focus && !element.offsetParent)) continue;
      const label = typeof entry.label === 'function' ? entry.label() : entry.label;
      found.push({ group: 'Handlinger', label, words: entry.words, first: entry.first, run: () => { if (entry.focus) element.focus(); else { element.click(); if (element.getAttribute('role') === 'tab') element.focus(); } } });
    }
    const projects = window.chats?.projects() || [];
    const open = projects.find(project => project.root === current?.root);
    for (const chat of open?.chats || []) {
      if (chat.id === view.id || chat.archived) continue;
      found.push({ group: 'Samtaler', label: chat.title || 'Ny samtale', meta: window.chats.meta(chat), words: [open.name, 'samtale'], first: true, run: () => window.chats.openChat(open, chat.id) });
    }
    for (const project of projects) {
      if (project.root === current?.root || !project.id) continue;
      found.push({ group: 'Projekter', label: project.name, meta: 'Projekt', words: ['projekt', ...(project.chats || []).map(chat => chat.title || '')], first: true, run: () => window.chats.openProject(project) });
    }
    return found;
  }
  function render() {
    const query = fold(input.value.trim());
    const all = collect().map(item => ({ ...item, score: score(item, query) })).filter(item => item.score > 0);
    // Uden søgning vises de vigtigste: få handlinger, de seneste samtaler og projekter. Søgning finder dem alle.
    const limits = query ? { Handlinger: 12, Samtaler: 8, Projekter: 6 } : { Handlinger: 6, Samtaler: 5, Projekter: 3 };
    items = [];
    for (const group of ['Handlinger', 'Samtaler', 'Projekter']) {
      // Uden søgning står de vigtigste først; er der få af dem, fyldes op med andre handlinger, der kan bruges nu.
      const inGroup = all.filter(item => item.group === group).sort((a, b) => b.score - a.score || Number(Boolean(b.first)) - Number(Boolean(a.first)));
      items.push(...inGroup.slice(0, limits[group]));
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    const rows = []; let last = '';
    items.forEach((item, index) => {
      if (item.group !== last) { last = item.group; const head = node('li', item.group, 'palette-group'); head.setAttribute('role', 'presentation'); rows.push(head); }
      const row = node('li', undefined, 'palette-item'); row.id = `palette-option-${index}`; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === active));
      row.append(node('span', item.label, 'palette-label'));
      if (item.meta) row.append(node('span', item.meta, 'palette-meta'));
      row.addEventListener('mousemove', () => { if (active !== index) { active = index; mark(); } });
      row.addEventListener('click', () => choose(index));
      rows.push(row);
    });
    list.replaceChildren(...rows);
    empty.hidden = Boolean(items.length);
    mark();
  }
  function mark() {
    for (const row of list.querySelectorAll('.palette-item')) row.setAttribute('aria-selected', String(row.id === `palette-option-${active}`));
    const row = $(`#palette-option-${active}`);
    if (row) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }
  function choose(index) {
    const item = items[index]; if (!item) return;
    close();
    action(async () => { await item.run(); });
  }
  function open() {
    if (dialog.open) return;
    // Andre dialoger og guider har deres egne valg; paletten åbner kun fra appens hovedvisning.
    if (document.querySelector('dialog[open]')) return;
    returnFocus = document.activeElement;
    for (const menu of document.querySelectorAll(':popover-open')) menu.hidePopover();
    input.value = ''; active = 0;
    render(); dialog.showModal(); input.focus();
  }
  // Fokus gives tilbage med det samme, så en handling, der selv flytter fokus, fx til en fane, beholder det.
  function restoreFocus() {
    const target = returnFocus; returnFocus = null;
    if (target?.isConnected && !target.closest('[hidden]')) target.focus();
  }
  function close() {
    if (!dialog.open) return;
    dialog.close(); restoreFocus();
  }
  // Escape lukker dialogen af sig selv; så gives fokus tilbage her.
  dialog.addEventListener('close', () => { if (returnFocus) restoreFocus(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', event => {
    const keys = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in keys) { event.preventDefault(); if (items.length) { active = (active + keys[event.key] + items.length) % items.length; mark(); } }
    else if (event.key === 'Home' && !input.value) { event.preventDefault(); active = 0; mark(); }
    else if (event.key === 'End' && !input.value) { event.preventDefault(); active = Math.max(0, items.length - 1); mark(); }
    else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
  });
  // Genvejen fanges i hovedprocessen, så den også virker, når fokus står i forhåndsvisningen. Når hovedprocessen har
  // taget tastetrykket, når det ikke siden; tastetryk, der kun når siden, fanges her.
  const toggle = () => dialog.open ? close() : open();
  window.harness.onEvent(event => { if (event.type === 'palette.toggle') toggle(); });
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey || event.repeat || !(mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
    event.preventDefault(); toggle();
  }, true);
  // Hjælp nævner genvejen med computerens egne taster.
  $('#palette-shortcut').textContent = mac ? '⌘K' : 'Ctrl+K';
  window.palette = { open, close };
})();

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const docs = window.DOCUMENTS || [];
  const latest = new Map();
  const documentKey = (doc) => `${doc.model}:${doc.type}`;
  const compareVersion = (a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const delta = (left[i] || 0) - (right[i] || 0);
      if (delta) return delta;
    }
    return 0;
  };
  for (const doc of docs) {
    const key = documentKey(doc);
    if (!latest.has(key) || compareVersion(doc.version, latest.get(key).version) > 0) latest.set(key, doc);
  }
  const isLatest = (doc) => latest.get(documentKey(doc))?.id === doc.id;
  const size = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let family = 'all';
  const families = ['all', ...new Set(docs.map((doc) => doc.family).sort())];
  $('model-count').textContent = new Set(docs.map((doc) => doc.model)).size;
  $('file-count').textContent = docs.length;
  $('nav-count').textContent = docs.length;
  for (const name of families) {
    const button = document.createElement('button');
    button.className = `filter-button${name === family ? ' selected' : ''}`;
    button.textContent = name === 'all' ? '全部系列' : `${name} 系列`;
    button.setAttribute('aria-pressed', String(name === family));
    button.addEventListener('click', () => {
      family = name;
      for (const sibling of button.parentElement.children) {
        sibling.classList.toggle('selected', sibling === button);
        sibling.setAttribute('aria-pressed', String(sibling === button));
      }
      renderLibrary();
    });
    $('family-filters').append(button);
  }
  function renderLibrary() {
    const terms = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = docs.filter((doc) => (family === 'all' || doc.family === family)
      && ($('document-type').value === 'all' || doc.type === $('document-type').value)
      && (!$('latest-only').checked || isLatest(doc))
      && terms.every((term) => `${doc.model} ${doc.filename} ${doc.family} v${doc.version} ${doc.type} ${doc.title} ${doc.type === 'DS' ? 'Datasheet' : 'Reference Manual'}`.toLowerCase().includes(term)));
    filtered.sort((a, b) => $('sort').value === 'size' ? a.bytes - b.bytes : a.model.localeCompare(b.model) || a.type.localeCompare(b.type) || compareVersion(b.version, a.version));
    $('results-summary').textContent = `共 ${filtered.length} 份文档${$('latest-only').checked ? ' · 已收起历史版本' : ' · 包含历史版本'}`;
    $('empty-state').hidden = filtered.length !== 0;
    $('document-grid').replaceChildren();
    for (const doc of filtered) {
      const card = document.createElement('article');
      card.className = 'document-card';
      card.innerHTML = `<div class="card-content"><div class="card-top"><span class="pdf-icon" aria-hidden="true">${escape(doc.type)}</span><span class="badge ${isLatest(doc) ? '' : 'historical'}">${isLatest(doc) ? '最新版本' : '历史版本'}</span></div><h3>${escape(doc.model)}</h3><p class="card-description">${escape(doc.title)} / ${doc.type === 'DS' ? 'Datasheet' : 'Reference Manual'}</p><div class="file-name" title="${escape(doc.filename)}">${escape(doc.filename)}</div><div class="card-meta"><span class="version">v${escape(doc.version)}</span><span>PDF · ${size(doc.bytes)}</span><span class="series">${escape(doc.family)} 系列</span></div></div><button class="card-action" aria-label="在线阅读 ${escape(doc.model)} ${escape(doc.title)} v${escape(doc.version)}"><span>在线阅读</span><span aria-hidden="true">↗</span></button>`;
      card.querySelector('button').addEventListener('click', () => navigateTo(doc));
      $('document-grid').append(card);
    }
  }
  $('search').addEventListener('input', renderLibrary);
  $('latest-only').addEventListener('change', renderLibrary);
  $('sort').addEventListener('change', renderLibrary);
  $('document-type').addEventListener('change', renderLibrary);
  $('reset-filters').addEventListener('click', () => {
    $('search').value = '';
    $('latest-only').checked = true;
    $('sort').value = 'model';
    $('document-type').value = 'all';
    $('family-filters').firstElementChild.click();
    $('search').focus();
  });

  let recent = [];
  try {
    const saved = JSON.parse(localStorage.getItem('ytm-recent') || '[]');
    if (Array.isArray(saved)) recent = saved.filter((id) => docs.some((doc) => doc.id === id)).slice(0, 3);
  } catch { /* Storage is optional, including in private browsing. */ }
  function saveRecent() {
    try { localStorage.setItem('ytm-recent', JSON.stringify(recent)); } catch { /* Optional. */ }
    renderRecent();
  }
  function renderRecent() {
    $('recent-section').hidden = !recent.length;
    $('recent-list').replaceChildren();
    for (const id of recent) {
      const doc = docs.find((item) => item.id === id);
      const button = document.createElement('button');
      button.className = 'recent-item';
      button.textContent = `${doc.model} · ${doc.type} · v${doc.version} ↗`;
      button.addEventListener('click', () => navigateTo(doc));
      $('recent-list').append(button);
    }
  }
  $('clear-recent').addEventListener('click', () => { recent = []; saveRecent(); });
  $('help-open').addEventListener('click', () => $('help').showModal());
  $('help-close').addEventListener('click', () => $('help').close());
  $('help').addEventListener('click', (event) => { if (event.target === $('help')) {
    const rect = $('help').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('help').close();
  }});

  const navigateTo = window.createPdfReader({
    docs, $, isLatest, size,
    onRead(doc) {
      recent = [doc.id, ...recent.filter((id) => id !== doc.id)].slice(0, 3);
      saveRecent();
    },
  });
  renderLibrary();
  renderRecent();
})();

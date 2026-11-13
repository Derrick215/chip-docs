/* Continuous PDF reader. Canvas resources are bounded; all page positions remain scrollable. */
window.createPdfReader = ({ docs, $, isLatest, size, onRead }) => {
  let libPromise, pdf, loadingTask, activeDoc, currentPage = 1;
  let session = 0, layoutVersion = 0, searchVersion = 0;
  let slots = [], rendered = new Set(), activeJobs = new Set();
  let observer, scrollTimer, resizeTimer, pumping = false, pendingPump = false;
  let baseWidth = 595, baseHeight = 842, scale = 1;
  let textCache = new Map(), results = [], resultsShown = 0;
  let searchSpec = null, selectedMatch = null, focusMatch = false;
  const scroll = $('page-scroll');
  const pages = $('pdf-pages');
  const library = () => libPromise ||= import('./vendor/pdfjs/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', document.baseURI).href;
    // Explicit Latin families keep canvas measurement and DOM text consistent
    // under a Chinese browser locale; CJK glyphs still use the system fallback.
    lib.TextLayer.fontFamilyMap.set('serif', '"Times New Roman", "Noto Serif", serif');
    lib.TextLayer.fontFamilyMap.set('sans-serif', 'Arial, "Noto Sans", sans-serif');
    return lib;
  }).catch((error) => { libPromise = null; throw error; });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  function status(message, busy = false) {
    $('reader-status').replaceChildren();
    if (busy) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      $('reader-status').append(spinner);
    }
    const text = document.createElement('div');
    text.textContent = message;
    $('reader-status').append(text);
    $('reader-status').hidden = false;
  }
  function controls() {
    const ready = Boolean(pdf && slots.length);
    $('prev-page').disabled = !ready || currentPage <= 1;
    $('next-page').disabled = !ready || currentPage >= pdf.numPages;
    for (const id of ['page-number', 'zoom', 'outline-toggle', 'find-toggle']) $(id).disabled = !ready;
    if (document.activeElement !== $('page-number')) $('page-number').value = currentPage;
    $('page-number').max = ready ? pdf.numPages : 1;
    $('page-total').textContent = `/ ${ready ? pdf.numPages : '—'}`;
  }
  function setRoute(doc, page = 1, replace = false) {
    const hash = `#${new URLSearchParams({ doc: doc.id, page: String(page) })}`;
    if (replace) history.replaceState(null, '', hash);
    else location.hash = hash;
  }
  async function route() {
    const params = new URLSearchParams(location.hash.slice(1));
    const doc = docs.find((item) => item.id === params.get('doc'));
    if (!doc) { if ($('reader').open) close(false); return; }
    const page = Math.max(1, parseInt(params.get('page'), 10) || 1);
    if (activeDoc?.id === doc.id && $('reader').open) { jump(page); return; }
    await open(doc, page);
  }
  function release(slot) {
    slot.job?.cancel();
    slot.text?.cancel();
    slot.job = slot.text = null;
    slot.textIndex = null;
    for (const canvas of slot.element.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; }
    slot.element.replaceChildren();
    slot.element.classList.remove('is-rendered');
    slot.state = 'empty';
    rendered.delete(slot);
    slot.page?.cleanup();
    slot.page = null;
  }
  function clear() {
    layoutVersion++;
    searchVersion++;
    observer?.disconnect();
    clearTimeout(scrollTimer);
    clearTimeout(resizeTimer);
    for (const slot of slots) release(slot);
    slots = [];
    rendered.clear();
    pages.replaceChildren();
    textCache.clear();
    results = [];
    searchSpec = selectedMatch = null;
    focusMatch = false;
    const old = loadingTask;
    loadingTask = pdf = null;
    old?.destroy().catch(() => {});
  }
  async function open(doc, page) {
    const token = ++session;
    clear();
    activeDoc = doc;
    currentPage = page;
    $('reader-title').textContent = `${doc.model} ${doc.title}`;
    $('reader-subtitle').textContent = `v${doc.version} · ${size(doc.bytes)}${isLatest(doc) ? '' : ' · 历史版本'}`;
    $('reader-original').href = doc.url;
    $('zoom').value = 'fit';
    $('outline-content').replaceChildren();
    for (const name of ['outline', 'find']) { $(`${name}-panel`).hidden = true; $(`${name}-toggle`).setAttribute('aria-expanded', 'false'); }
    $('find-input').value = '';
    $('find-results').replaceChildren();
    $('find-more').hidden = $('find-stop').hidden = true;
    $('find-summary').textContent = '搜索当前文档正文，结果将显示在这里。';
    $('reader-footnote').textContent = '连续滚动 · 按需渲染';
    status(`正在打开${doc.title}…`, true);
    controls();
    if (!$('reader').open) $('reader').showModal();
    try {
      if (location.protocol === 'file:') throw new Error('LOCAL_FILE');
      const lib = await library();
      if (token !== session) return;
      loadingTask = lib.getDocument({
        url: new URL(doc.url, document.baseURI).href,
        cMapUrl: new URL('./vendor/pdfjs/cmaps/', document.baseURI).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', document.baseURI).href,
        isEvalSupported: false, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536,
      });
      const loaded = await loadingTask.promise;
      if (token !== session) return;
      pdf = loaded;
      const first = await pdf.getPage(1);
      if (token !== session) return;
      const viewport = first.getViewport({ scale: 1 });
      baseWidth = viewport.width;
      baseHeight = viewport.height;
      for (let number = 1; number <= pdf.numPages; number++) {
        const element = document.createElement('section');
        element.className = 'pdf-page';
        element.dataset.page = number;
        element.setAttribute('aria-label', `第 ${number} 页`);
        const slot = { number, element, width: baseWidth, height: baseHeight, state: 'empty' };
        slots.push(slot);
        pages.append(element);
      }
      $('reader-status').hidden = true;
      $('reader-footnote').textContent = `${doc.filename} · ${pdf.numPages} 页`;
      controls();
      onRead(doc);
      layout(page);
      loadOutline(loaded, token);
    } catch (error) {
      if (token !== session) return;
      clear();
      controls();
      status(error.message === 'LOCAL_FILE' ? '请运行“一键预览.bat”，通过预览地址使用内置阅读器。' : '文档未能打开，请检查网络或点击右上角“打开原文件”。');
      const retry = document.createElement('button');
      retry.className = 'primary-button';
      retry.textContent = '重新加载';
      retry.addEventListener('click', () => open(doc, page));
      $('reader-status').append(retry);
      if (error.message !== 'LOCAL_FILE') console.error('PDF reader:', error);
    }
  }
  function layout(target = currentPage) {
    if (!pdf || !slots.length) return;
    layoutVersion++;
    if (selectedMatch?.page === target) focusMatch = true;
    observer?.disconnect();
    const padding = parseFloat(getComputedStyle(scroll).paddingLeft) * 2;
    scale = $('zoom').value === 'fit' ? Math.max(.1, Math.min(2, (scroll.clientWidth - padding) / baseWidth)) : Number($('zoom').value);
    for (const slot of slots) {
      release(slot);
      slot.element.style.width = `${slot.width * scale}px`;
      slot.element.style.height = `${slot.height * scale}px`;
      slot.element.style.setProperty('--scale-factor', scale);
    }
    observer = new IntersectionObserver(() => schedule(), { root: scroll, rootMargin: '600px 0px' });
    for (const slot of slots) observer.observe(slot.element);
    jump(target);
  }
  function topOf(slot) { return slot.element.offsetTop + pages.offsetTop; }
  function visibleSlots() {
    const top = scroll.scrollTop, bottom = top + scroll.clientHeight;
    return slots.filter((slot) => {
      const start = topOf(slot);
      return start + slot.element.offsetHeight > top - 700 && start < bottom + 700;
    }).sort((a, b) => Math.abs(topOf(a) - top) - Math.abs(topOf(b) - top));
  }
  function schedule() {
    if (!pdf) return;
    const nearby = visibleSlots();
    const keep = new Set(nearby);
    for (const slot of [...rendered, ...activeJobs]) if (!keep.has(slot)) release(slot);
    pump();
  }
  async function pump() {
    if (pumping) { pendingPump = true; return; }
    pumping = true;
    try {
      do {
        pendingPump = false;
        if (!pdf) break;
        const nearby = visibleSlots();
        const next = nearby.find((slot) => slot.state === 'empty');
        if (!next) break;
        await paint(next);
        pendingPump = true;
      } while (pendingPump);
    } finally { pumping = false; }
  }
  async function paint(slot) {
    const token = session, version = layoutVersion, document = pdf;
    slot.state = 'loading';
    activeJobs.add(slot);
    const valid = () => token === session && version === layoutVersion && slot.state === 'loading';
    try {
      const page = await document.getPage(slot.number);
      if (!valid()) return;
      slot.page = page;
      const viewport = page.getViewport({ scale });
      // Update unusual page sizes without moving the page currently being read.
      const anchor = slots[currentPage - 1];
      const anchorTop = anchor ? topOf(anchor) : 0;
      slot.width = viewport.width / scale;
      slot.height = viewport.height / scale;
      slot.element.style.width = `${viewport.width}px`;
      slot.element.style.height = `${viewport.height}px`;
      if (anchor && slot.number < currentPage) scroll.scrollTop += topOf(anchor) - anchorTop;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(6000000 / (viewport.width * viewport.height)));
      const canvas = window.document.createElement('canvas');
      canvas.setAttribute('aria-label', `PDF 第 ${slot.number} 页`);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      slot.element.append(canvas);
      slot.job = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
      await slot.job.promise;
      if (!valid()) return;
      slot.job = null;
      const container = window.document.createElement('div');
      container.className = 'textLayer';
      slot.element.append(container);
      const lib = await library();
      if (!valid()) return;
      slot.text = new lib.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      await slot.text.render();
      if (!valid()) return;
      slot.state = 'ready';
      slot.element.classList.add('is-rendered');
      rendered.add(slot);
      highlight(slot);
    } catch (error) {
      if (!valid() || ['RenderingCancelledException', 'AbortException'].includes(error.name)) return;
      slot.state = 'error';
      rendered.add(slot);
      const retry = window.document.createElement('button');
      retry.className = 'page-retry toolbar-button';
      retry.textContent = `第 ${slot.number} 页加载失败，点击重试`;
      retry.addEventListener('click', () => { release(slot); schedule(); });
      slot.element.append(retry);
    } finally { activeJobs.delete(slot); }
  }
  function jump(number) {
    if (!pdf || !slots.length) return;
    currentPage = Math.min(pdf.numPages, Math.max(1, Math.trunc(number) || 1));
    scroll.scrollTo({ top: topOf(slots[currentPage - 1]), behavior: 'instant' });
    controls();
    setRoute(activeDoc, currentPage, true);
    updateOutline();
    schedule();
  }
  scroll.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!pdf || !slots.length) return;
      const position = scroll.scrollTop + scroll.clientHeight / 2;
      let low = 0, high = slots.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (topOf(slots[middle]) <= position) low = middle; else high = middle - 1;
      }
      currentPage = low + 1;
      controls();
      setRoute(activeDoc, currentPage, true);
      updateOutline();
      schedule();
    }, 70);
  }, { passive: true });

  const destinationPages = new Map();
  async function resolveDestination(document, destination) {
    if (!destination) return null;
    const key = typeof destination === 'string' ? destination : JSON.stringify(destination);
    if (destinationPages.has(key)) return destinationPages.get(key);
    const dest = typeof destination === 'string' ? await document.getDestination(destination) : destination;
    if (!dest) return null;
    const index = typeof dest[0] === 'number' ? dest[0] : await document.getPageIndex(dest[0]);
    const number = index + 1;
    if (document === pdf) destinationPages.set(key, number);
    return number;
  }
  function updateOutline() {
    let selected;
    for (const link of $('outline-content').querySelectorAll('.outline-link[data-page]')) {
      const number = Number(link.dataset.page);
      link.classList.remove('current');
      link.removeAttribute('aria-current');
      if (link.getClientRects().length && number <= currentPage && (!selected || number >= Number(selected.dataset.page))) selected = link;
    }
    if (selected) { selected.classList.add('current'); selected.setAttribute('aria-current', 'location'); }
  }
  async function loadOutline(document, token) {
    destinationPages.clear();
    try {
      const outline = await document.getOutline();
      if (token !== session) return;
      if (!outline?.length) { $('outline-content').textContent = '此 PDF 未提供书签目录，可使用页码跳转。'; return; }
      const queue = [];
      const build = (items, parent, depth = 0) => {
        for (const item of items) {
          const node = window.document.createElement('div');
          node.className = 'outline-node';
          const row = window.document.createElement('div');
          row.className = 'outline-row';
          row.style.paddingLeft = `${depth * 14}px`;
          const arrow = window.document.createElement('button');
          arrow.className = 'outline-arrow';
          arrow.textContent = '▸';
          arrow.setAttribute('aria-label', `展开 ${item.title}`);
          arrow.setAttribute('aria-expanded', 'false');
          arrow.disabled = !item.items?.length;
          const link = window.document.createElement('button');
          link.className = 'outline-link';
          const icon = window.document.createElement('span');
          icon.className = 'bookmark-icon';
          icon.setAttribute('aria-hidden', 'true');
          const title = window.document.createElement('span');
          title.className = 'outline-title';
          title.textContent = item.title || '未命名章节';
          const number = window.document.createElement('span');
          number.className = 'outline-page-number';
          link.append(icon, title, number);
          row.append(arrow, link);
          node.append(row);
          if (item.items?.length) {
            const children = window.document.createElement('div');
            children.hidden = true;
            arrow.addEventListener('click', () => {
              children.hidden = !children.hidden;
              arrow.setAttribute('aria-expanded', String(!children.hidden));
              arrow.setAttribute('aria-label', `${children.hidden ? '展开' : '收起'} ${item.title}`);
              updateOutline();
            });
            build(item.items, children, depth + 1);
            node.append(children);
          }
          link.disabled = !item.dest;
          link.addEventListener('click', async () => {
            try {
              const page = await resolveDestination(document, item.dest);
              if (token !== session || !page) return;
              if (innerWidth <= 720) panel('outline', false);
              jump(page);
            } catch { if (token === session) $('reader-footnote').textContent = '此书签无法跳转，请使用页码定位。'; }
          });
          queue.push(async () => {
            try {
              const page = await resolveDestination(document, item.dest);
              if (token !== session || !page) return;
              link.dataset.page = page;
              number.textContent = page;
              link.setAttribute('aria-label', `${item.title}，第 ${page} 页`);
            } catch { /* A broken bookmark must not prevent other entries from working. */ }
          });
          parent.append(node);
        }
      };
      build(outline, $('outline-content'));
      // Resolve a few at a time so a large bookmark tree does not flood the worker.
      for (let i = 0; i < queue.length && token === session; i += 12) {
        await Promise.all(queue.slice(i, i + 12).map((job) => job()));
        updateOutline();
        await tick();
      }
    } catch { if (token === session) $('outline-content').textContent = '目录暂不可用，请使用页码跳转。'; }
  }
  function panel(name, force) {
    const target = $(`${name}-panel`);
    const visible = typeof force === 'boolean' ? force : target.hidden;
    for (const other of ['outline', 'find']) {
      const show = other === name && visible;
      $(`${other}-panel`).hidden = !show;
      $(`${other}-toggle`).setAttribute('aria-expanded', String(show));
    }
    if (innerWidth > 720 && $('zoom').value === 'fit') layout();
    if (name === 'outline' && visible) updateOutline();
    if (name === 'find' && visible) $('find-input').focus();
  }

  function normalize(text) { return text.normalize('NFKC').replace(/\s+/g, ' ').replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1').trim(); }
  function matches(text, spec = searchSpec) {
    if (!spec) return [];
    const pattern = spec.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...text.matchAll(new RegExp(pattern, spec.sensitive ? 'gu' : 'giu'))].map((match) => ({ index: match.index, length: match[0].length }));
  }
  // Map normalized search offsets back to original PDF text, including ligatures,
  // collapsed whitespace and words split across PDF text items.
  function textIndex(strings) {
    const raw = strings.join(' '), starts = [], ends = [];
    let expanded = '';
    const segments = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)
      : Array.from(raw, (segment) => ({ segment }));
    let offset = 0;
    for (const part of segments) {
      const start = part.index ?? offset, end = start + part.segment.length;
      const value = part.segment.normalize('NFKC');
      expanded += value;
      for (let i = 0; i < value.length; i++) { starts.push(start); ends.push(end); }
      offset = end;
    }
    const chars = [], from = [], to = [];
    for (let i = 0; i < expanded.length; i++) {
      if (/\s/.test(expanded[i])) {
        const start = i;
        while (i + 1 < expanded.length && /\s/.test(expanded[i + 1])) i++;
        if (!chars.length || i === expanded.length - 1) continue;
        if (/[\u3400-\u9fff]/.test(chars.at(-1)) && /[\u3400-\u9fff]/.test(expanded[i + 1])) continue;
        chars.push(' '); from.push(starts[start]); to.push(ends[i]);
      } else { chars.push(expanded[i]); from.push(starts[i]); to.push(ends[i]); }
    }
    const items = [];
    offset = 0;
    for (const value of strings) { items.push({ start: offset, end: offset + value.length }); offset += value.length + 1; }
    return { text: chars.join(''), starts: from, ends: to, items };
  }
  function highlight(slot) {
    slot.element.querySelector('.pdf-match-layer')?.remove();
    if (!searchSpec || slot.state !== 'ready' || !slot.text) return;
    const index = slot.textIndex ||= textIndex(slot.text.textContentItemsStr);
    const found = matches(index.text);
    const layer = document.createElement('div');
    layer.className = 'pdf-match-layer';
    layer.setAttribute('aria-hidden', 'true');
    const pageRect = slot.element.getBoundingClientRect();
    let selectedRect;
    for (const match of found) {
      const rawStart = index.starts[match.index], rawEnd = index.ends[match.index + match.length - 1];
      const selected = selectedMatch?.page === slot.number && selectedMatch.index === match.index;
      for (let i = 0; i < index.items.length; i++) {
        const item = index.items[i];
        if (item.end <= rawStart || item.start >= rawEnd) continue;
        const node = slot.text.textDivs[i]?.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.setStart(node, Math.max(0, rawStart - item.start));
        range.setEnd(node, Math.min(node.length, rawEnd - item.start));
        for (const rect of range.getClientRects()) {
          if (rect.width < .1 || rect.height < .1) continue;
          const mark = document.createElement('div');
          mark.className = `pdf-match${selected ? ' selected' : ''}`;
          mark.dataset.match = match.index;
          mark.dataset.text = range.toString();
          Object.assign(mark.style, { left: `${rect.left - pageRect.left}px`, top: `${rect.top - pageRect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
          layer.append(mark);
          if (selected && !selectedRect) selectedRect = rect;
        }
      }
    }
    slot.element.append(layer);
    if (focusMatch && selectedRect) {
      focusMatch = false;
      const viewport = scroll.getBoundingClientRect();
      scroll.scrollTo({ top: scroll.scrollTop + selectedRect.top - viewport.top - scroll.clientHeight * .5,
        left: Math.max(0, scroll.scrollLeft + selectedRect.left - viewport.left - scroll.clientWidth * .4), behavior: 'instant' });
    }
  }
  function refreshHighlights() { for (const slot of rendered) highlight(slot); }
  function selectResult(result) {
    selectedMatch = result;
    focusMatch = true;
    for (const button of $('find-results').children) {
      const selected = button.dataset.id === `${result.page}:${result.index}`;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    if (innerWidth <= 720) panel('find', false);
    jump(result.page);
    refreshHighlights();
  }
  function appendResults() {
    const end = Math.min(results.length, resultsShown + 60);
    for (let i = resultsShown; i < end; i++) {
      const result = results[i];
      const button = document.createElement('button');
      button.className = 'find-result';
      button.dataset.page = result.page;
      button.dataset.id = `${result.page}:${result.index}`;
      const text = textCache.get(result.page) || '';
      const before = text.slice(Math.max(0, result.index - 16), result.index);
      const after = text.slice(result.index + result.length, result.index + result.length + 36);
      const value = text.slice(result.index, result.index + result.length);
      button.setAttribute('aria-label', `${before}${value}${after}，第 ${result.page} 页`);
      button.setAttribute('aria-pressed', 'false');
      const snippet = document.createElement('span');
      snippet.className = 'find-snippet';
      snippet.append(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.textContent = value;
      snippet.append(mark, document.createTextNode(after));
      const number = document.createElement('span');
      number.className = 'find-page-number';
      number.textContent = result.page;
      button.append(snippet, number);
      button.addEventListener('click', () => selectResult(result));
      $('find-results').append(button);
    }
    resultsShown = end;
    $('find-more').hidden = end >= results.length;
  }
  async function search() {
    if (!pdf) return;
    const document = pdf, token = session, version = ++searchVersion;
    const query = normalize($('find-input').value);
    searchSpec = query ? { query, sensitive: $('find-case').checked } : null;
    selectedMatch = null;
    focusMatch = false;
    refreshHighlights();
    results = [];
    resultsShown = 0;
    $('find-results').replaceChildren();
    $('find-more').hidden = true;
    if (!query) { $('find-summary').textContent = '请输入要查找的关键词。'; $('find-stop').hidden = true; return; }
    const spec = searchSpec;
    let hits = 0, failed = 0, matchedPages = 0;
    $('find-stop').hidden = false;
    const valid = () => token === session && version === searchVersion;
    for (let number = 1; number <= document.numPages; number++) {
      if (!valid()) return;
      let text = textCache.get(number);
      if (text === undefined) {
        try {
          const page = await document.getPage(number);
          if (!valid()) return;
          const content = await page.getTextContent();
          if (!valid()) return;
          text = normalize(content.items.map((item) => item.str || '').join(' '));
          textCache.set(number, text);
          if (slots[number - 1]?.state === 'empty') page.cleanup();
        } catch { if (!valid()) return; failed++; text = ''; }
      }
      const found = matches(text, spec);
      if (found.length) {
        matchedPages++;
        hits += found.length;
        for (const match of found) results.push({ page: number, ...match });
      }
      if (number % 5 === 0 || number === document.numPages) {
        $('find-summary').textContent = `已检索 ${number} / ${document.numPages} 页 · ${hits} 处匹配`;
        if (resultsShown < 60) appendResults();
        $('find-more').hidden = resultsShown >= results.length;
        await tick();
      }
    }
    if (!valid()) return;
    $('find-stop').hidden = true;
    $('find-summary').textContent = `${results.length ? `检索完成 · ${hits} 处匹配，分布在 ${matchedPages} 页` : '检索完成，未找到匹配内容。扫描图片中的文字暂不支持检索。'}${failed ? `（${failed} 页未能读取，可重新搜索）` : ''}`;
  }
  function close(clearRoute = true) {
    session++;
    clear();
    activeDoc = null;
    if ($('reader').open) $('reader').close();
    if (clearRoute) history.replaceState(null, '', location.pathname + location.search);
  }
  $('reader-close').addEventListener('click', () => close());
  $('reader').addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  $('outline-toggle').addEventListener('click', () => panel('outline'));
  $('find-toggle').addEventListener('click', () => panel('find'));
  $('prev-page').addEventListener('click', () => jump(currentPage - 1));
  $('next-page').addEventListener('click', () => jump(currentPage + 1));
  $('page-form').addEventListener('submit', (event) => { event.preventDefault(); const number = Number($('page-number').value); $('page-number').blur(); jump(number); });
  $('zoom').addEventListener('change', () => layout());
  $('find-form').addEventListener('submit', (event) => { event.preventDefault(); search(); });
  $('find-case').addEventListener('change', () => { if ($('find-input').value.trim()) search(); });
  $('find-input').addEventListener('input', () => {
    searchVersion++;
    searchSpec = selectedMatch = null;
    focusMatch = false;
    refreshHighlights();
    results = [];
    resultsShown = 0;
    $('find-results').replaceChildren();
    $('find-more').hidden = true;
    $('find-stop').hidden = true;
    $('find-summary').textContent = '关键词已修改，按回车或点击搜索。';
  });
  $('find-stop').addEventListener('click', () => { searchVersion++; $('find-stop').hidden = true; $('find-summary').textContent += ' · 已停止'; });
  $('find-more').addEventListener('click', appendResults);
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if ($('reader').open && pdf && $('zoom').value === 'fit') layout(); }, 180);
  });
  document.addEventListener('keydown', (event) => {
    if ($('reader').open && pdf && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); panel('find', true); return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.target.isContentEditable) return;
    if ($('reader').open && pdf && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); jump(currentPage - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); jump(currentPage + 1); }
    } else if (event.key === '/' && !$('help').open && !$('reader').open) { event.preventDefault(); $('search').focus(); }
  });
  window.addEventListener('hashchange', route);
  route();
  return (doc) => setRoute(doc);
};

'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const ACCENTS = ['a-cyan', 'a-acid', 'a-pink', 'a-amber'];
  const LIVE = new Set(['IN_STOCK', 'PREORDER']);
  let state = null;
  let seenLive = null;
  let lastLogT = 0;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = (u) => (/^https:\/\//i.test(u || '') ? esc(u) : '#');
  const money = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const signed = (cents) => (cents > 0 ? '+' : '') + money(cents);
  const ago = (t) => {
    if (!t) return 'never';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
  };
  const clock = (t) => new Date(t).toLocaleTimeString('en-AU', { hour12: false });
  const daysTo = (d) => Math.ceil((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
    return body;
  }

  // Boot screen
  const bootLines = ['> SYNDICATE.OS kernel 1.0 loaded', '> DROP_DESK module online', '> retailer uplinks: BIG W · EB · TARGET · KMART · JB', '> alert relays: SMS · DISCORD', '> ready.'];
  bootLines.forEach((l, i) => setTimeout(() => { $('bootLines').insertAdjacentHTML('beforeend', `<div>${esc(l)}</div>`); }, i * 300));

  function beep() {
    try {
      const ctx = new AudioContext();
      [0, 0.18, 0.36].forEach((at) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 1320;
        g.gain.value = 0.08;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + at);
        o.stop(ctx.currentTime + at + 0.12);
      });
    } catch { /* audio blocked until first click */ }
  }

  function notifyLive(item) {
    beep();
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(`${item.status === 'PREORDER' ? 'PREORDER OPEN' : 'IN STOCK'}: ${item.name}`, { body: `${item.retailer}${item.price ? ' $' + item.price.toFixed(2) : ''}`, tag: item.id });
      n.onclick = () => window.open(item.url, '_blank', 'noopener');
    }
  }

  function renderStats(s) {
    $('sWatching').textContent = s.watching;
    $('sLive').textContent = s.live;
    $('sAlerts').textContent = s.alertsSent;
    const p = $('sProfit');
    p.textContent = signed(s.profitCents);
    p.className = 'num ' + (s.profitCents > 0 ? 'acid' : s.profitCents < 0 ? 'pink' : 'cyan');
    $('sProfitCap').textContent = s.unsoldCostCents ? `${money(s.unsoldCostCents)} still in unsold stock` : 'on sold stock, after fees';
  }

  function renderOps(items, retailers) {
    const names = [...new Set([...retailers.slice(0, 8), ...items.map((i) => i.retailer)])].slice(0, 12);
    $('ops').innerHTML = names.map((name, idx) => {
      const mine = items.filter((i) => i.retailer === name && i.active !== false);
      const live = mine.filter((i) => LIVE.has(i.status));
      const blocked = mine.filter((i) => i.status === 'BLOCKED');
      const lastCheck = Math.max(0, ...mine.map((i) => i.lastChecked || 0));
      let cls = ACCENTS[idx % 4];
      let chip = '<span class="chip">● DEPLOYED</span>';
      let directive = `> ${mine.length} on watch. last sweep ${ago(lastCheck)}.`;
      if (!mine.length) { cls = 'offline'; chip = '<span class="chip">○ OFFLINE</span>'; directive = '> no products on watch. paste a link below.'; }
      else if (live.length) { cls += ' working'; chip = '<span class="chip fill">■ LIVE</span>'; directive = `> ${live.length} BUYABLE NOW: ${esc(live[0].name)}`; }
      else if (blocked.length === mine.length) { cls = 'a-amber'; chip = '<span class="chip">⊗ BLOCKED</span>'; directive = '> retailer is refusing automated checks. backing off 5 min.'; }
      return `<article class="op ${cls}">
        <div class="op-top"><div><div class="label">OP-${String(idx + 1).padStart(2, '0')} // RETAILER</div><div class="op-title">${esc(name)}</div></div>${chip}</div>
        <div class="op-metrics">
          <div><div class="label">WATCH</div><div class="metric">${mine.length}</div></div>
          <div><div class="label">LIVE</div><div class="metric ${live.length ? 'acid' : ''}">${live.length}</div></div>
          <div><div class="label">BLOCKED</div><div class="metric ${blocked.length ? 'amber' : ''}">${blocked.length}</div></div>
        </div>
        <div class="directive cursor">${directive}</div>
      </article>`;
    }).join('');
  }

  function statusChip(i) {
    const s = i.active === false ? 'PAUSED' : i.status || 'CHECKING';
    const label = { IN_STOCK: '■ IN STOCK', PREORDER: '■ PREORDER', OUT_OF_STOCK: '○ SOLD OUT', BLOCKED: '⊗ BLOCKED', ERROR: '✕ ERROR', UNKNOWN: '? UNKNOWN', PAUSED: '‖ PAUSED', CHECKING: '↻ CHECKING' }[s] || s;
    return `<span class="chip s-${esc(s)} ${LIVE.has(s) ? 'fill' : ''}">${esc(label)}</span>`;
  }

  function renderItems(items) {
    if (!items.length) {
      $('items').innerHTML = '<div class="empty">Nothing on watch yet. Open the product page on Big W, EB Games, Target, Kmart or JB Hi-Fi, copy the link from the address bar and paste it above.</div>';
      return;
    }
    const order = (i) => (LIVE.has(i.status) ? 0 : i.releaseDate ? 1 : 2);
    const sorted = [...items].sort((a, b) => order(a) - order(b) || (a.releaseDate || '').localeCompare(b.releaseDate || ''));
    $('items').innerHTML = sorted.map((i) => {
      const live = LIVE.has(i.status) && i.active !== false;
      const rel = i.releaseDate ? (() => { const d = daysTo(i.releaseDate); return d > 0 ? `<span class="amber">NEXT_UP › releases in ${d}d (${esc(i.releaseDate)})</span>` : d === 0 ? '<span class="acid">RELEASE DAY</span>' : `<span>released ${esc(i.releaseDate)}</span>`; })() : '';
      const over = i.maxPrice && i.price && i.price > i.maxPrice ? ` <span class="pink">over $${esc(i.maxPrice)} cap</span>` : '';
      return `<div class="row ${live ? 'live' : ''}">
        <div class="row-main">
          <div class="row-name">${esc(i.name)}</div>
          <div class="row-meta">${statusChip(i)}<span>${esc(i.retailer)}</span><span>${esc(i.kind.replace('_', ' '))}</span>
            <span>${i.price ? '$' + i.price.toFixed(2) : '$—'}${over}</span><span>checked ${ago(i.lastChecked)}${i.source && i.source !== 'none' ? ' via ' + esc(i.source) : ''}</span>${rel}</div>
        </div>
        <div class="row-actions">
          <a class="btn ${live ? 'fill buy' : ''}" href="${safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">${live ? '▶ BUY NOW' : 'OPEN'} ↗</a>
          <button class="btn cyan" data-act="check" data-id="${esc(i.id)}" type="button">↻ CHECK</button>
          <button class="btn" data-act="toggle" data-id="${esc(i.id)}" type="button">${i.active === false ? '▶ RESUME' : '‖ PAUSE'}</button>
          <button class="btn pink" data-act="del" data-id="${esc(i.id)}" type="button" aria-label="Stop watching ${esc(i.name)}">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderBuys(buys) {
    if (!buys.length) {
      $('buys').innerHTML = '<div class="empty">No buys logged. After each drop, log what you bought here; when it sells, tap SOLD and enter the sale price.</div>';
      return;
    }
    $('buys').innerHTML = buys.map((b) => {
      const cost = b.unitCost * b.qty;
      const sold = b.soldUnitPrice !== null;
      const pl = sold ? b.soldUnitPrice * b.qty - cost - (b.fees || 0) : null;
      return `<div class="row">
        <div class="row-main">
          <div class="row-name">${esc(b.qty)} × ${esc(b.itemName)}</div>
          <div class="row-meta"><span>${esc(b.retailer)}</span><span>${esc(b.date)}</span><span>cost ${money(cost)}</span>
            ${sold ? `<span>sold ${money(b.soldUnitPrice)} ea${b.fees ? ', fees ' + money(b.fees) : ''}</span><span class="${pl >= 0 ? 'acid' : 'pink'}">${signed(pl)}</span>` : '<span class="amber">UNSOLD</span>'}</div>
        </div>
        <div class="row-actions">
          <button class="btn acid" data-act="sold" data-id="${esc(b.id)}" type="button">${sold ? '✎ EDIT SALE' : '$ SOLD'}</button>
          <button class="btn pink" data-act="delbuy" data-id="${esc(b.id)}" type="button" aria-label="Delete entry">✕</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderFeed(log) {
    const feed = $('feed');
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 30;
    const fresh = log.filter((l) => l.t > lastLogT);
    if (!fresh.length) return;
    lastLogT = fresh[fresh.length - 1].t;
    feed.insertAdjacentHTML('beforeend', fresh.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="t">&gt; [${clock(l.t)}]</span> <span class="cyan">${esc(l.who)}</span> <span class="msg">${esc(l.text)}</span></div>`).join(''));
    while (feed.children.length > 200) feed.firstChild.remove();
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  function renderLive(items) {
    const live = items.filter((i) => LIVE.has(i.status) && i.active !== false);
    const strip = $('liveStrip');
    strip.hidden = !live.length;
    strip.innerHTML = live.map((i) => `<div class="strip-row"><span class="what">${i.status === 'PREORDER' ? 'PREORDER OPEN' : 'LIVE'}</span><span>${esc(i.name)} @ ${esc(i.retailer)}${i.price ? ' $' + i.price.toFixed(2) : ''}</span><a class="btn fill acid" href="${safeUrl(i.url)}" target="_blank" rel="noopener noreferrer">▶ BUY NOW ↗</a></div>`).join('');
    const ids = new Set(live.map((i) => i.id + i.status));
    if (seenLive) live.filter((i) => !seenLive.has(i.id + i.status)).forEach(notifyLive);
    seenLive = ids;
    document.title = live.length ? `(${live.length}) LIVE — SYNDICATE.DROP` : 'SYNDICATE.DROP';
  }

  function render() {
    renderStats(state.stats);
    renderOps(state.items, state.retailers);
    renderItems(state.items);
    renderBuys(state.buys);
    renderFeed(state.log);
    renderLive(state.items);
    const c = state.channels;
    $('chanInfo').textContent = `alerts › sms ${c.sms ? 'ON' : 'NOT SET UP'} · discord ${c.discord ? 'ON' : 'NOT SET UP'}`;
    if (!$('kindSel').options.length) {
      $('kindSel').innerHTML = state.kinds.map((k) => `<option value="${esc(k)}">${esc(k.replace('_', ' '))}</option>`).join('');
      $('retailerList').innerHTML = state.retailers.map((r) => `<option value="${esc(r)}">`).join('');
    }
  }

  async function refresh() {
    try {
      state = await api('/api/state');
      $('sys').className = 'sys';
      $('sys').innerHTML = '<span class="dot"></span>SYS_ONLINE';
      render();
    } catch {
      $('sys').className = 'sys down';
      $('sys').innerHTML = '<span class="dot"></span>LINK_LOST';
    }
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('addErr').textContent = '';
    try {
      await api('/api/items', { method: 'POST', body: JSON.stringify(formData(e.target)) });
      e.target.reset();
      refresh();
    } catch (err) { $('addErr').textContent = err.message; }
  });

  $('buyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('buyErr').textContent = '';
    try {
      await api('/api/buys', { method: 'POST', body: JSON.stringify(formData(e.target)) });
      e.target.reset();
      refresh();
    } catch (err) { $('buyErr').textContent = err.message; }
  });

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.act === 'check') { b.disabled = true; await api(`/api/items/${id}/check`, { method: 'POST' }); }
      if (b.dataset.act === 'toggle') await api(`/api/items/${id}/toggle`, { method: 'POST' });
      if (b.dataset.act === 'del' && confirm('Stop watching this product?')) await api(`/api/items/${id}`, { method: 'DELETE' });
      if (b.dataset.act === 'delbuy' && confirm('Delete this ledger entry?')) await api(`/api/buys/${id}`, { method: 'DELETE' });
      if (b.dataset.act === 'sold') {
        const price = prompt('Sold price for EACH one, in dollars:');
        if (price === null) return;
        const fees = prompt('Total selling fees and postage for this line, in dollars (0 if none):', '0');
        if (fees === null) return;
        await api(`/api/buys/${id}`, { method: 'PATCH', body: JSON.stringify({ soldUnitPrice: price, fees }) });
      }
    } catch (err) { alert(err.message); }
    refresh();
  });

  $('testBtn').addEventListener('click', async () => {
    const b = $('testBtn');
    b.disabled = true;
    try { await api('/api/test-alert', { method: 'POST' }); } catch (err) { alert(err.message); }
    b.disabled = false;
    refresh();
  });

  $('notifyBtn').addEventListener('click', async () => {
    beep();
    if (!('Notification' in window)) return alert('This browser cannot show notifications. SMS and Discord still work.');
    const p = await Notification.requestPermission();
    $('notifyBtn').textContent = p === 'granted' ? '■ PHONE ALERTS ON' : '⚑ PHONE ALERTS';
  });

  refresh();
  setInterval(refresh, 3000);
})();

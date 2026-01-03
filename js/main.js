// JavaScript code for managing transactions in the Ledjer R application

const $ = id => document.getElementById(id);
const listBody = $('listBody');
const entryForm = $('entryForm');
const filters = document.querySelectorAll('.btn-filter');
const summary = $('summary');
const exportBtn = $('exportBtn');

let entries = JSON.parse(localStorage.getItem('transactions_v1') || '[]');
let currentFilter = 'ALL';

// Normalize entries (ensure each entry has an id)
function normalizeEntries(){
  let changed = false;
  entries = entries.map(e => {
    if(!e.id){ e.id = Date.now() + Math.floor(Math.random()*1000); changed = true; }
    return e;
  });
  if(changed) localStorage.setItem('transactions_v1', JSON.stringify(entries));
}
normalizeEntries();

// Items database (loaded from Assets/CSV/items.csv and localStorage fallback)
let itemsDB = JSON.parse(localStorage.getItem('items_db_v1') || '[]');

async function loadItemsCSV(path = 'Assets/CSV/items.csv'){
  try{
    const res = await fetch(path);
    if(!res.ok) throw new Error('failed to load items CSV at ' + path);
    const txt = await res.text();
    let rows = [];
    if(window.Papa && Papa.parse){
      const parsed = Papa.parse(txt, {header:true, skipEmptyLines:true});
      rows = parsed.data.map(r => ({ name: (r.name||'').trim(), tier: (r.tier||'').toLowerCase() }));
    } else {
      rows = txt.trim().split(/\r?\n/).slice(1).map(line => {
        const [name,tier] = line.split(',').map(s => s && s.trim());
        return { name, tier: (tier||'').toLowerCase() };
      }).filter(it => it.name);
    }
    // merge CSV items with localStorage (local overrides CSV when duplicate name)
    const map = new Map();
    rows.forEach(r => map.set(r.name.toLowerCase(), r));
    itemsDB.forEach(r => map.set(r.name.toLowerCase(), r));
    itemsDB = Array.from(map.values());
  }catch(e){
    console.warn('loadItemsCSV:', e);
    // fallback to legacy path if present
    if(path !== 'data/items.csv'){
      return loadItemsCSV('data/items.csv');
    }
  }
}

function saveItemsDB(){
  localStorage.setItem('items_db_v1', JSON.stringify(itemsDB));
}

function findItemByName(name){
  if(!name) return null;
  const n = String(name).trim().toLowerCase();
  return itemsDB.find(it => it.name.toLowerCase() === n) || null;
}

function addItemToLocalDB(name, tier){
  const existing = findItemByName(name);
  if(existing) return existing;
  const item = { name: String(name).trim(), tier: (tier||'').toLowerCase() };
  itemsDB.push(item);
  saveItemsDB();
  showToast('Item saved locally');
  return item;
}

// utility helpers
function debounce(fn, wait = 180){ let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), wait); }; }

function showToast(msg, t = 2500){ const el = $('toast'); if(!el) return; el.textContent = msg; el.hidden = false; clearTimeout(el._to); el._to = setTimeout(()=> el.hidden = true, t); }

function todayISO(){
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,10);
}

// init default date
$('date').value = todayISO();

function save(){ localStorage.setItem('transactions_v1', JSON.stringify(entries)); }

function render(){
  listBody.innerHTML = '';
  let shown = entries.filter(e => currentFilter === 'ALL' || e.action === currentFilter);
  if(!shown.length){
    listBody.innerHTML = '<tr class="empty-row"><td colspan="10" class="empty">Belum ada transaksi sesuai filter.</td></tr>';
    summary.textContent = 'Total: 0 • Equity: 0';
    return;
  }

  let totalEquity = 0;
  const ordered = shown.slice().reverse();
  let running = 0;
  const equityMap = new Map();
  ordered.forEach(e => {
    running += Number(e.total) * (e.action === 'SELL' ? 1 : -1);
    equityMap.set(e, running);
  });
  shown.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="vertical-align:middle">${i+1}</td>
      <td style="vertical-align:middle">${escapeHtml(formatLongDate(e.date))}</td>
      <td style="vertical-align:middle">${escapeHtml(e.item)}</td>
      <td style="vertical-align:middle"><span class="tier-pill ${normalizeTier(e.tier)}">${escapeHtml(humanizeTier(e.tier))}</span></td>
      <td style="vertical-align:middle"><span class="badge ${e.action==='BUY'?'buy':'sell'}">${e.action}</span></td>
      <td class="right" style="vertical-align:middle">${formatNumber(e.qty)}</td>
      <td class="right" style="vertical-align:middle">${formatNumberNoSymbol(e.total)}</td>
      <td class="right" style="vertical-align:middle">${formatNumberNoSymbol(equityMap.get(e) || 0)}</td>
      <td style="vertical-align:middle">${escapeHtml(e.notes||'')}</td>
      <td style="vertical-align:middle">
        <button class="action-btn edit" data-id="${e.id}" aria-label="Edit transaksi">Edit</button>
        <button class="action-btn delete" data-id="${e.id}" aria-label="Hapus transaksi">Hapus</button>
      </td>
    `;
    listBody.appendChild(tr);
  });
  totalEquity = running;
  const realizedProfit = computeRealizedProfit(entries);
  let profitClass = 'profit-zero';
  if(realizedProfit > 0) profitClass = 'profit-positive';
  else if(realizedProfit < 0) profitClass = 'profit-negative';
  summary.innerHTML = `Total: ${shown.length} • Equity: ${formatCurrency(totalEquity)} • Profit Terealisasi: <span class="${profitClass}">${formatCurrency(realizedProfit)}</span>`; 
}

function formatCurrency(v){
  const n = Number(v) || 0;
  const hasDecimal = Math.round(n) !== n;
  const formatted = n.toLocaleString(undefined, {minimumFractionDigits: hasDecimal ? 2 : 0, maximumFractionDigits: 2});
  return `${formatted} Gold Coins`;
}

/**
 * Compute realized profit across all items (grouped by name + tier)
 * Uses average-cost method: profit = sum(sellValue - avgCostPerUnit * sellQty)
 */
function computeRealizedProfit(entries){
  const map = new Map();
  for(const e of entries){
    const name = String(e.item || '').trim();
    const tier = String(e.tier || '').trim();
    if(!name) continue;
    const key = `${name.toLowerCase()}||${normalizeTier(tier)}`;
    let rec = map.get(key);
    if(!rec){ rec = { buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 }; }
    const qty = Number(e.qty) || 0;
    const total = Number(e.total) || 0;
    if(e.action === 'BUY'){ rec.buyQty += qty; rec.buyValue += total; }
    else if(e.action === 'SELL'){ rec.sellQty += qty; rec.sellValue += total; }
    map.set(key, rec);
  }

  let profit = 0;
  for(const rec of map.values()){
    const avgCost = rec.buyQty ? (rec.buyValue / rec.buyQty) : 0;
    profit += (rec.sellValue - (avgCost * rec.sellQty));
  }
  return profit;
}
function formatNumber(n){ return Number(n).toLocaleString(); }
function formatNumberNoSymbol(v){
  if(v === '' || v === null || v === undefined) return '';
  const n = Number(v) || 0;
  const hasDecimal = Math.round(n) !== n;
  return n.toLocaleString('en-US', {minimumFractionDigits: hasDecimal ? 2 : 0, maximumFractionDigits: 2});
}
function formatLongDate(d){
  if(!d) return '';
  const dt = new Date(d);
  if(isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
}
function normalizeTier(t){
  if(!t) return 'empty';
  const token = String(t).toLowerCase().replace(/\s+/g,'-');
  if(/^t\d$/.test(token)) return token;
  return token;
}
function humanizeTier(t){
  if(!t) return '';
  const token = String(t).toLowerCase().replace(/\s+/g,'-');
  const map = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    ultra: 'Ultra Rare',
    legendary: 'Legendary',
    mythic: 'Mythic',
    t1: 'T1', t2: 'T2', t3: 'T3', t4: 'T4'
  };
  return map[token] || String(t);
}
function escapeHtml(str){ return String(str).replace(/[&<>\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[s])); }

let editingId = null;
entryForm.addEventListener('submit', e => {
  e.preventDefault();
  const itemName = $('item').value.trim();
  const tierVal = $('tier').value || '';

  if(itemName && !findItemByName(itemName)){
    addItemToLocalDB(itemName, tierVal);
  }

  const record = {
    id: editingId || (Date.now() + Math.floor(Math.random()*1000)),
    date: $('date').value,
    action: $('action').value,
    item: itemName,
    tier: tierVal,
    qty: Number($('qty').value) || 0,
    total: Number($('total').value) || 0,
    notes: $('notes').value.trim()
  };

  if(editingId){
    const idx = entries.findIndex(x => String(x.id) === String(editingId));
    if(idx >= 0){ entries[idx] = record; showToast('Transaksi diperbarui'); }
    editingId = null; $('submitBtn').textContent = 'Tambah'; $('cancelEditBtn').style.display = 'none';
  } else {
    entries.unshift(record);
    showToast('Transaksi ditambahkan');
  }

  save(); render(); entryForm.reset(); $('date').value = todayISO();
});

$('clearBtn').addEventListener('click', () => entryForm.reset() );

filters.forEach(b => b.addEventListener('click', ()=> {
  filters.forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); currentFilter = b.dataset.filter; render();
}));

exportBtn.addEventListener('click', () => {
  if(!entries.length) return alert('Tidak ada data untuk diekspor');
  const header = ['HARI/TANGGAL','ITEMS','TIER','QUANTITY','BUY / OUTFLOW','SELL / INFLOW','EQUITY','CATATAN'];
  const ordered = entries.slice().reverse();
  let running = 0;
  const rows = ordered.map((e) => {
    if(e.action === 'SELL'){
      running += Number(e.total) || 0;
      return [formatLongDate(e.date), e.item, e.tier||'', e.qty, '', formatNumberNoSymbol(e.total), formatNumberNoSymbol(running), e.notes || ''];
    } else {
      running -= Number(e.total) || 0;
      return [formatLongDate(e.date), e.item, e.tier||'', e.qty, formatNumberNoSymbol(e.total), '', formatNumberNoSymbol(running), e.notes || ''];
    }
  });
  const csv = [header, ...rows].map(r => r.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  // prepend UTF-8 BOM so Excel reads UTF-8 correctly
  const blob = new Blob(["\uFEFF", csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download = 'transactions.csv'; a.click(); URL.revokeObjectURL(url);
  showToast('CSV diekspor');
});

// --- Autocomplete suggestions ---
const itemInput = $('item');
const suggestions = $('suggestions');
let suggestionIndex = -1;

function renderSuggestions(list){
  suggestions.innerHTML = '';
  if(!list.length){ suggestions.hidden = true; $('item').setAttribute('aria-expanded','false'); return; }
  suggestions.hidden = false; $('item').setAttribute('aria-expanded','true');
  list.forEach((it, idx) => {
    const li = document.createElement('li');
    li.setAttribute('role','option');
    li.id = `suggestion-${idx}`;
    li.dataset.index = idx;
    li.innerHTML = `<div class="suggestion-left"><div class="suggestion-name">${escapeHtml(it.name)}</div></div><div class="suggestion-tier"><span class="tier-pill ${normalizeTier(it.tier)}">${escapeHtml(humanizeTier(it.tier))}</span></div>`;
    li.addEventListener('click', ()=> selectSuggestion(it));
    suggestions.appendChild(li);
  });
}

function filterItems(q){
  if(!q) return [];
  const ql = q.toLowerCase();
  return itemsDB.filter(it => it.name.toLowerCase().includes(ql)).slice(0,12);
}

function selectSuggestion(item){
  itemInput.value = item.name;
  $('tier').value = item.tier || '';
  suggestions.hidden = true; $('item').setAttribute('aria-expanded','false'); $('item').removeAttribute('aria-activedescendant');
  itemInput.focus();
}

// debounce item input
const debouncedInput = debounce((e) => {
  const results = filterItems(e.target.value);
  renderSuggestions(results);
  suggestionIndex = -1;
  // aria
  $('item').setAttribute('aria-expanded', results.length > 0 ? 'true' : 'false');
}, 180);
itemInput.addEventListener('input', debouncedInput);

itemInput.addEventListener('keydown', e => {
  const visible = !suggestions.hidden;
  const items = Array.from(suggestions.children);
  if(e.key === 'ArrowDown' && visible){ suggestionIndex = Math.min(suggestionIndex+1, items.length-1); items.forEach((li,i)=>li.classList.toggle('active', i===suggestionIndex)); e.preventDefault(); }
  else if(e.key === 'ArrowUp' && visible){ suggestionIndex = Math.max(suggestionIndex-1, 0); items.forEach((li,i)=>li.classList.toggle('active', i===suggestionIndex)); e.preventDefault(); }
  else if(e.key === 'Enter' && visible && suggestionIndex >= 0){ items[suggestionIndex].click(); e.preventDefault(); }
  else if(e.key === 'Escape'){ suggestions.hidden = true; suggestionIndex = -1; $('item').setAttribute('aria-expanded','false'); }
  // update aria-activedescendant
  const active = items[suggestionIndex];
  if(active){ $('item').setAttribute('aria-activedescendant', active.id); } else { $('item').removeAttribute('aria-activedescendant'); }
});

document.addEventListener('click', (ev)=>{ if(!ev.target.closest('#suggestions') && ev.target !== itemInput) { suggestions.hidden = true; $('item').setAttribute('aria-expanded','false'); } });

// action buttons (edit/delete) using event delegation
listBody.addEventListener('click', (ev)=>{
  const btn = ev.target.closest('.action-btn');
  if(!btn) return;
  const id = btn.dataset.id;
  if(btn.classList.contains('edit')){
    editTransaction(id);
  } else if(btn.classList.contains('delete')){
    deleteTransaction(id);
  }
});

function editTransaction(id){
  const item = entries.find(e => String(e.id) === String(id));
  if(!item) return showToast('Transaksi tidak ditemukan');
  editingId = id;
  $('date').value = item.date;
  $('action').value = item.action;
  $('item').value = item.item;
  $('tier').value = item.tier;
  $('qty').value = item.qty;
  $('total').value = item.total;
  $('notes').value = item.notes;
  $('submitBtn').textContent = 'Simpan';
  $('cancelEditBtn').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteTransaction(id){
  if(!confirm('Hapus transaksi ini?')) return;
  const idx = entries.findIndex(e => String(e.id) === String(id));
  if(idx === -1) return showToast('Transaksi tidak ditemukan');
  entries.splice(idx,1); save(); render(); showToast('Transaksi dihapus');
}

$('cancelEditBtn').addEventListener('click', ()=>{
  editingId = null; entryForm.reset(); $('submitBtn').textContent = 'Tambah'; $('cancelEditBtn').style.display = 'none'; $('date').value = todayISO();
});

// import transactions via CSV (append/update/delete)
const importTxInput = $('importTxInput');
const importTxBtn = $('importTxBtn');
importTxBtn.addEventListener('click', ()=> importTxInput.click());

function parseNumberValue(val){
  if(val === undefined || val === null || val === '') return 0;
  return Number(String(val).replace(/[^0-9\.-]+/g, '')) || 0;
}

function firstKeyMatch(obj, candidates){
  const keys = Object.keys(obj || {});
  for(const c of candidates){
    const found = keys.find(k => k.toLowerCase().trim() === c);
    if(found) return obj[found];
  }
  // try contains
  for(const k of keys){
    const lk = k.toLowerCase();
    for(const c of candidates){ if(lk.includes(c)) return obj[k]; }
  }
  return undefined;
}

importTxInput.addEventListener('change', async (ev)=>{
  const file = ev.target.files && ev.target.files[0];
  if(!file) return;
  const txt = await file.text();
  let parsedRows = [];
  if(window.Papa && Papa.parse){
    const parsed = Papa.parse(txt, {header:true, skipEmptyLines:true});
    parsedRows = parsed.data;
  } else {
    const lines = txt.trim().split(/\r?\n/);
    const header = (lines.shift()||'').split(',').map(h=>h.trim());
    parsedRows = lines.map(line => {
      const cols = line.split(','); const obj = {};
      header.forEach((h,i)=> obj[h] = (cols[i]||'').trim());
      return obj;
    });
  }

  let added = 0, updated = 0, removed = 0, errors = 0;
  const unknownItems = new Set();

  for(const row of parsedRows){
    try{
      const rawDate = firstKeyMatch(row, ['date','tanggal','hari/tanggal','hari']);
      const rawItem = firstKeyMatch(row, ['item','items','name']);
      const rawTier = firstKeyMatch(row, ['tier']);
      const rawQty = firstKeyMatch(row, ['qty','quantity','jumlah']);
      const rawAction = firstKeyMatch(row, ['action','aksi','type']);
      const rawTotal = firstKeyMatch(row, ['total','equity','amount','price']);
      const rawNotes = firstKeyMatch(row, ['notes','catatan','note']);
      const rawId = firstKeyMatch(row, ['id']);
      const rawDel = firstKeyMatch(row, ['delete','hapus','remove','del']);
      const rawBuy = firstKeyMatch(row, ['buy','outflow']);
      const rawSell = firstKeyMatch(row, ['sell','inflow']);

      const dateVal = rawDate ? (new Date(String(rawDate)).toISOString().slice(0,10)) : todayISO();
      const itemVal = String(rawItem || '').trim();
      const tierVal = String(rawTier || '').trim().toLowerCase();
      const qtyVal = Number(rawQty===undefined?0:parseNumberValue(rawQty));
      const totalVal = (rawSell && rawSell !== '') ? parseNumberValue(rawSell) : ((rawBuy && rawBuy !== '') ? parseNumberValue(rawBuy) : parseNumberValue(rawTotal));
      let actionVal = '';
      if(rawSell && String(rawSell).trim() !== '') actionVal = 'SELL';
      else if(rawBuy && String(rawBuy).trim() !== '') actionVal = 'BUY';
      else if(rawAction) actionVal = String(rawAction).trim().toUpperCase();

      const notesVal = rawNotes || '';
      const idVal = rawId ? String(rawId).trim() : null;
      const delFlag = rawDel ? (String(rawDel).trim().toLowerCase() === 'true' || String(rawDel).trim() === '1' || String(rawDel).trim().toLowerCase() === 'yes') : false;

      if(!itemVal){ errors++; continue; }

      if(!findItemByName(itemVal)) unknownItems.add(itemVal);

      if(delFlag || actionVal === 'DELETE'){
        let removedOne = false;
        if(idVal){
          const idx = entries.findIndex(e => String(e.id) === String(idVal));
          if(idx !== -1){ entries.splice(idx,1); removed++; removedOne = true; }
        } else {
          const idx = entries.findIndex(e => e.date === dateVal && e.item === itemVal && Number(e.total) === Number(totalVal));
          if(idx !== -1){ entries.splice(idx,1); removed++; removedOne = true; }
        }
        if(!removedOne) errors++;
        continue;
      }

      const record = {
        id: idVal || (Date.now() + Math.floor(Math.random()*1000)),
        date: dateVal,
        action: (actionVal || (totalVal && totalVal > 0 ? 'SELL' : 'BUY')).toUpperCase(),
        item: itemVal,
        tier: tierVal || '',
        qty: qtyVal || 0,
        total: Number(totalVal) || 0,
        notes: notesVal || ''
      };

      if(idVal){
        const idx = entries.findIndex(e => String(e.id) === String(idVal));
        if(idx !== -1){ entries[idx] = record; updated++; continue; }
      }

      const foundIdx = entries.findIndex(e => e.date === record.date && e.item === record.item && Number(e.total) === Number(record.total) && Number(e.qty) === Number(record.qty));
      if(foundIdx !== -1){ entries[foundIdx] = record; updated++; }
      else { entries.unshift(record); added++; }
    }catch(err){ console.warn('import tx row err', err); errors++; }
  }

  save(); render();
  const unknownCount = unknownItems.size;
  const unknownSample = Array.from(unknownItems).slice(0,4).join(', ');
  showToast(`Import selesai: +${added} new, ~${updated} updated, -${removed} removed, !${errors} errors${unknownCount?` • ${unknownCount} unknown items: ${unknownSample}`:''}`);
  importTxInput.value = '';
});

// load DB and initial render
loadItemsCSV().then(()=>{ console.log('itemsDB loaded', itemsDB.length); });
render();
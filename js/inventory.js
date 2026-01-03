// Simple inventory page logic — aggregates BUY/SELL by item + tier
const $ = id => document.getElementById(id);

function escapeHtml(str){ return String(str||'').replace(/[&<>\\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s])); }
function normalizeTier(t){ if(!t) return 'empty'; const token = String(t).toLowerCase().replace(/\s+/g,'-'); if(/^t\d$/.test(token)) return token; return token; }
function humanizeTier(t){ if(!t) return ''; const token = String(t).toLowerCase().replace(/\s+/g,'-'); const map = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', ultra: 'Ultra Rare', legendary: 'Legendary', mythic: 'Mythic', t1:'T1',t2:'T2',t3:'T3',t4:'T4' }; return map[token] || String(t); }
function formatNumberNoSymbol(v){ if(v === '' || v === null || v === undefined) return ''; const n = Number(v) || 0; const hasDecimal = Math.round(n) !== n; return n.toLocaleString('en-US', {minimumFractionDigits: hasDecimal ? 2 : 0, maximumFractionDigits: 2}); }
function formatCurrency(v){ const n = Number(v) || 0; const hasDecimal = Math.round(n) !== n; const formatted = n.toLocaleString(undefined, {minimumFractionDigits: hasDecimal ? 2 : 0, maximumFractionDigits: 2}); return `${formatted} Gold Coins`; }

function buildInventory(){
  const entries = JSON.parse(localStorage.getItem('transactions_v1') || '[]');
  const map = new Map();
  for(const e of entries){
    const name = String(e.item || '').trim();
    const tier = String(e.tier || '').trim();
    const key = `${name.toLowerCase()}||${normalizeTier(tier)}`;
    const qty = Number(e.qty) || 0;
    const total = Number(e.total) || 0;
    let rec = map.get(key);
    if(!rec){ rec = { name, tier, qty:0, value:0 }; }
    if(e.action === 'BUY') { rec.qty += qty; rec.value += total; }
    else if(e.action === 'SELL') { rec.qty -= qty; rec.value -= total; }
    map.set(key, rec);
  }
  // keep only positive qty
  const list = Array.from(map.values()).filter(r => r.qty > 0).sort((a,b)=> a.name.localeCompare(b.name) || a.tier.localeCompare(b.tier));
  return list;
}

function renderInventory(filter = ''){
  const body = $('invBody');
  const summary = $('invSummary');
  const list = buildInventory().filter(r => r.name.toLowerCase().includes(filter.toLowerCase()));
  body.innerHTML = '';
  if(!list.length){ body.innerHTML = '<tr class="empty-row"><td colspan="5" class="inventory-empty">Inventory kosong.</td></tr>'; summary.textContent = 'Items: 0 • Total Value: 0 Gold Coins'; return; }

  let totalValue = 0;
  for(const r of list){
    const avg = r.qty ? (r.value / r.qty) : 0;
    totalValue += Number(r.value) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="vertical-align:middle">${escapeHtml(r.name)}</td>
      <td style="vertical-align:middle"><span class="tier-pill ${normalizeTier(r.tier)}">${escapeHtml(humanizeTier(r.tier))}</span></td>
      <td class="right" style="vertical-align:middle">${formatNumberNoSymbol(r.qty)}</td>
      <td class="right" style="vertical-align:middle">${formatCurrency(r.value)}</td>
      <td class="right" style="vertical-align:middle">${formatCurrency(avg)}</td>
    `;
    body.appendChild(tr);
  }
  summary.textContent = `Items: ${list.length} • Total Value: ${formatCurrency(totalValue)}`;
}

// search
$('invSearch') && $('invSearch').addEventListener('input', (e)=> renderInventory(e.target.value));

// export
$('exportInvBtn') && $('exportInvBtn').addEventListener('click', ()=>{
  const list = buildInventory();
  if(!list.length) return alert('Inventory kosong');
  const header = ['Item','Tier','Qty','TotalValue','AvgPrice'];
  const rows = list.map(r => {
    const avg = r.qty ? (r.value / r.qty) : 0;
    return [r.name, r.tier||'', String(r.qty), String(r.value), String(avg)];
  });
  const csv = [header, ...rows].map(r => r.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(["\uFEFF", csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'inventory.csv'; a.click(); URL.revokeObjectURL(url);
  alert('Inventory diekspor');
});

renderInventory();

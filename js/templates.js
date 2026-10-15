// ===== HTML TEMPLATES =====
// All template strings extracted from index.html for maintainability

function txHTML(t, showActions = true, isAdmin) {
  const typeClass = t.type;
  const sign = t.type === 'income' ? '+' : '-';
  const icon = t.type === 'income' ? 'add_circle' : 'remove_circle';
  const fundName = t.fund ? (data.funds.find(f => f.id === t.fund)?.name || 'Quỹ chung') : 'Quỹ chung';
  const cat = t.category ? data.categories.find(c => c.id === t.category) : null;
  const catBadge = cat ? `<span class="cat-badge" style="background:${cat.color || '#FFF3E0'};color:${cat.textColor || '#7A6E62'}">${esc(cat.icon)} ${esc(cat.name)}</span>` : '';
  return `<div class="tx-item" onclick="openTxDetail('${t.id}')">
    <div class="tx-icon ${typeClass}"><span class="material-symbols-outlined">${icon}</span></div>
    <div class="tx-info">
      <div class="tx-name">${esc(t.name)}${catBadge}</div>
      <div class="tx-meta">${fmtDate(t.date)} • ${esc(fundName)} • <span style="font-family:'Courier New',monospace;font-weight:700;color:var(--primary)">${receiptSerial(t)}</span></div>
    </div>
    ${showActions && isAdmin ? `<div class="tx-actions" onclick="event.stopPropagation()">
      <button class="tx-action-btn edit" onclick="openTxModal('${t.id}')" title="Sửa"><span class="material-symbols-outlined" style="font-size:18px">edit</span></button>
      <button class="tx-action-btn del" onclick="deleteTx('${t.id}')" title="Xóa"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
    </div>` : ''}
    <span class="tx-amount ${typeClass}">${sign}${fmtMoneyFull(t.amount)}</span>
  </div>`;
}

function receiptHTML(t, author, extraNote, serial, autoPrint) {
  const fundName = t.fund ? (data.funds.find(f => f.id === t.fund)?.name || 'Quỹ chung') : 'Quỹ chung';
  const isIncome = t.type === 'income';
  const sign = isIncome ? '+' : '-';
  const typeLabel = isIncome ? 'PHIẾU THU' : 'PHIẾU CHI';
  const amountWords = numberToVietnamese(t.amount);
  const now = new Date();
  const printDate = `${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`;
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Be Vietnam Pro',sans-serif;background:white;color:#111;font-size:13px;line-height:1.5;position:relative;overflow:hidden}
.wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:52px;font-weight:900;color:rgba(255,140,0,0.05);letter-spacing:4px;text-transform:uppercase;white-space:nowrap;pointer-events:none;z-index:0}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:12px;border-bottom:2.5px solid #FF8C00}
.hdr-org strong{display:block;font-size:14px;font-weight:800}
.hdr-org span{font-size:10px;color:#888}
.badge{padding:4px 14px;border-radius:99px;font-size:11px;font-weight:800;border:1.5px solid}
.badge.income{background:#E8F7F0;color:#2D9E6A;border-color:#A7E3C9}
.badge.expense{background:#FEF0F0;color:#D94F4F;border-color:#FDC5C5}
h1{font-size:22px;font-weight:800;text-align:center;margin:14px 0 2px;letter-spacing:1px}
.no{font-size:11px;text-align:center;color:#666;margin-bottom:16px;font-weight:700;letter-spacing:.5px}
.no b{color:#FF8C00;font-family:'Courier New',monospace;font-size:12px}
.amt{background:linear-gradient(135deg,#FF8C00,#E65C00);border-radius:10px;padding:14px;text-align:center;margin-bottom:18px}
.amt-lbl{color:rgba(255,255,255,.75);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
.amt-val{color:white;font-size:28px;font-weight:900;margin-top:4px}
.amt-w{color:rgba(255,255,255,.85);font-size:10px;margin-top:4px;font-style:italic}
table{width:100%;border-collapse:collapse;margin-bottom:18px}
tr{border-bottom:1px solid #f0f0f0}
td{padding:9px 6px;font-size:12px;vertical-align:top}
td:first-child{color:#888;width:120px}
td:last-child{font-weight:600}
.ftr{display:flex;justify-content:space-around;margin-top:24px;padding-top:14px;border-top:1px dashed #ddd}
.sig{text-align:center}
.sig-ttl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888}
.sig-d{font-size:9px;color:#aaa;margin-top:2px}
.sig-n{margin-top:42px;font-size:11px;font-weight:700;border-top:1px solid #111;padding-top:3px;display:inline-block;min-width:100px}
.serial{font-size:9px;color:#ccc;text-align:right;margin-top:8px}
.receipt-code-chip{display:inline-flex;align-items:center;gap:4px;background:var(--primary-light);color:var(--primary);font-weight:800;font-size:12px;padding:3px 9px;border-radius:8px;cursor:pointer;font-family:'Courier New',monospace;letter-spacing:.5px}
@media print{@page{size:A5 portrait;margin:8mm}}
</style></head><body>
<div class="wm">${typeLabel}</div>
<div class="hdr">
  <div class="hdr-org"><strong>${esc(data.neighborhoodName)}</strong><span>Ban quản lý khu phố</span></div>
  <span class="badge ${t.type}">${isIncome ? 'PHIẾU THU' : 'PHIẾU CHI'}</span>
</div>
<h1>${typeLabel}</h1>
<div class="no">Mã phiếu: <b>${serial}</b> &nbsp;|&nbsp; Ngày in: ${printDate}</div>
<div class="amt">
  <div class="amt-lbl">Số tiền</div>
  <div class="amt-val">${sign}${t.amount.toLocaleString('vi-VN')} VND</div>
  <div class="amt-w">(${amountWords.charAt(0).toUpperCase() + amountWords.slice(1)})</div>
</div>
<table>
  <tr><td>Nội dung</td><td>${esc(t.name)}</td></tr>
  <tr><td>Ngày giao dịch</td><td>${fmtDate(t.date)}</td></tr>
  <tr><td>Quỹ</td><td>${esc(fundName)}</td></tr>
  <tr><td>Ghi chú</td><td>${esc(t.note || extraNote || '—')}</td></tr>
  ${extraNote && t.note ? `<tr><td>Ghi chú thêm</td><td>${esc(extraNote)}</td></tr>` : ''}
</table>
<div class="ftr">
  <div class="sig"><div class="sig-ttl">Người nộp / nhận</div><div class="sig-d">(Ký, ghi rõ họ tên)</div><div><span class="sig-n">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div></div>
  <div class="sig"><div class="sig-ttl">Thủ quỹ</div><div class="sig-d">(Ký, ghi rõ họ tên)</div><div><span class="sig-n">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div></div>
  <div class="sig"><div class="sig-ttl">Người lập phiếu</div><div class="sig-d">(Ký, ghi rõ họ tên)</div><div><span class="sig-n">${author ? esc(author) : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span></div></div>
</div>
<div class="serial">Mã tra cứu: ${serial} — Quét/tra cứu trong ứng dụng ${esc(data.neighborhoodName)} để đối chiếu | ID: ${esc(t.id)}</div>
${autoPrint ? `<script>var _printed=false;function go(){if(_printed)return;_printed=true;window.focus();window.print()}if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(go,120)});setTimeout(go,2500)}else{setTimeout(go,600)}<\/script>` : ''}
</body></html>`;
}

function reportPDFHTML(income, expense, txs, m, y) {
  const balance = income - expense;
  const now = new Date();
  const printDate = `${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}`;
  const rows = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => {
    const fn = t.fund ? (data.funds.find(f => f.id === t.fund)?.name || 'Quỹ chung') : 'Quỹ chung';
    const sign = t.type === 'income' ? '+' : '-';
    const color = t.type === 'income' ? '#2D9E6A' : '#D94F4F';
    return `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.name)}</td><td style="color:${color};font-weight:700">${t.type === 'income' ? 'Thu' : 'Chi'}</td><td style="color:${color};font-weight:700;text-align:right">${sign}${t.amount.toLocaleString('vi-VN')}</td><td>${esc(fn)}</td><td style="color:#888">${esc(t.note || '')}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Be Vietnam Pro',sans-serif;background:white;padding:12mm;color:#111;font-size:11px}
h1{font-size:18px;font-weight:800;color:#FF8C00;margin-bottom:2px}
.sub{font-size:10px;color:#888;margin-bottom:14px}
.stats{display:flex;gap:10px;margin-bottom:16px}
.stat{flex:1;padding:10px;border-radius:8px;text-align:center}
.stat.i{background:#E8F7F0}.stat.e{background:#FEF0F0}.stat.b{background:#FFF3E0}
.slbl{font-size:9px;color:#888;font-weight:700;text-transform:uppercase}
.sval{font-size:14px;font-weight:800;margin-top:3px}
.stat.i .sval{color:#2D9E6A}.stat.e .sval{color:#D94F4F}.stat.b .sval{color:#FF8C00}
table{width:100%;border-collapse:collapse}
th{background:#FF8C00;color:white;padding:7px 6px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.5px}
td{padding:7px 6px;border-bottom:1px solid #f0f0f0;font-size:10px}
.ftr{margin-top:20px;font-size:9px;color:#aaa;text-align:center;border-top:1px dashed #ddd;padding-top:8px}
@media print{@page{size:A4;margin:8mm}}
</style></head><body>
<h1>Báo cáo Thu Chi – ${esc(data.neighborhoodName)}</h1>
<div class="sub">Tháng ${m + 1}/${y} &nbsp;|&nbsp; In ngày ${printDate} &nbsp;|&nbsp; ${txs.length} giao dịch</div>
<div class="stats">
  <div class="stat i"><div class="slbl">Tổng thu</div><div class="sval">+${income.toLocaleString('vi-VN')}đ</div></div>
  <div class="stat e"><div class="slbl">Tổng chi</div><div class="sval">-${expense.toLocaleString('vi-VN')}đ</div></div>
  <div class="stat b"><div class="slbl">Số dư</div><div class="sval">${balance >= 0 ? '+' : ''}${balance.toLocaleString('vi-VN')}đ</div></div>
</div>
<table><thead><tr><th>Ngày</th><th>Nội dung</th><th>Loại</th><th style="text-align:right">Số tiền</th><th>Quỹ</th><th>Ghi chú</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px">Không có giao dịch</td></tr>'}</tbody></table>
<div class="ftr">${esc(data.neighborhoodName)} &middot; Quản lý tài chính khu phố &middot; Tháng ${m + 1}/${y}</div>
<script>var _printed=false;function go(){if(_printed)return;_printed=true;window.focus();window.print()}if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(go,120)});setTimeout(go,2500)}else{setTimeout(go,600)}<\/script>
</body></html>`;
}

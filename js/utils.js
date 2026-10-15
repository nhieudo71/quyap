// ===== UTILITIES =====

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Chống XSS
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isAdmin() { return currentNeighborhood?.role === 'admin'; }
function isMember() { return currentNeighborhood?.role === 'member'; }
function canAddTx() { return currentNeighborhood?.role === 'admin' || currentNeighborhood?.role === 'member'; }

function getRoleInfo(role) {
  switch (role) {
    case 'admin':
      return {
        role: 'admin',
        title: 'Thủ quỹ',
        badgeText: '🔑 Thủ quỹ',
        badgeFullText: '🔑 Thủ quỹ (Toàn quyền)',
        badgeClass: 'admin',
        desc: 'Toàn quyền quản trị: thêm, sửa, xóa, duyệt đề xuất & phân quyền'
      };
    case 'member':
      return {
        role: 'member',
        title: 'Thành viên',
        badgeText: '👤 Thành viên',
        badgeFullText: '👤 Thành viên (thêm GD)',
        badgeClass: 'member',
        desc: 'Xem số liệu & gửi đề xuất thu chi kèm hóa đơn chờ duyệt'
      };
    case 'viewer':
    default:
      return {
        role: 'viewer',
        title: 'Người xem',
        badgeText: '👁️ Người xem',
        badgeFullText: '👁️ Người xem (chỉ đọc)',
        badgeClass: 'viewer',
        desc: 'Chỉ đọc số liệu và báo cáo công khai, không thể thêm/sửa'
      };
  }
}

function fmtMoney(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toLocaleString('vi-VN');
}
function fmtMoneyFull(n) { return n.toLocaleString('vi-VN') + 'đ'; }

function parseLocalDate(d) {
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  return new Date(d);
}
function fmtDate(d) {
  const dt = parseLocalDate(d);
  return `${String(dt.getDate()).padStart(2,'0')} Th${String(dt.getMonth()+1).padStart(2,'0')}, ${dt.getFullYear()}`;
}

function numberToVietnamese(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n === 0) return 'Không đồng';
  const u = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function readGroup(num, full) {
    const tram = Math.floor(num / 100);
    const chuc = Math.floor((num % 100) / 10);
    const dv = num % 10;
    const hasHundred = tram > 0 || full;
    let s = '';
    if (tram > 0) s += u[tram] + ' trăm';
    else if (full) s += 'không trăm';
    if (chuc === 0) { if (dv > 0) s += hasHundred ? ' lẻ ' + u[dv] : ' ' + u[dv]; }
    else if (chuc === 1) { s += ' mười'; if (dv === 5) s += ' lăm'; else if (dv > 0) s += ' ' + u[dv]; }
    else { s += ' ' + u[chuc] + ' mươi'; if (dv === 1) s += ' mốt'; else if (dv === 5) s += ' lăm'; else if (dv > 0) s += ' ' + u[dv]; }
    return s.trim();
  }
  const scales = ['', ' nghìn', ' triệu', ' tỷ'];
  const groups = []; let x = n; while (x > 0) { groups.unshift(x % 1000); x = Math.floor(x / 1000); }
  let result = ''; const last = groups.length - 1;
  groups.forEach((g, i) => { const scaleIdx = last - i; if (g === 0) return; result += readGroup(g, i > 0) + scales[scaleIdx] + ' '; });
  result = result.trim().replace(/\s+/g, ' ');
  return result.charAt(0).toUpperCase() + result.slice(1) + ' đồng';
}

function getNextTxSeq() {
  return data.transactions.reduce((m, t) => Math.max(m, t.seq || 0), 0) + 1;
}
function receiptSerial(t) {
  const y = new Date(t.date).getFullYear();
  if (t.seq) return `${y}-${String(t.seq).padStart(4, '0')}`;
  return `${y}-${String(t.id).slice(-6).toUpperCase()}`;
}
function normalizeReceiptCode(s) { return String(s || '').trim().toUpperCase().replace(/\s+/g, ''); }
function findTxByReceiptCode(code) {
  const q = normalizeReceiptCode(code); if (!q) return null;
  return data.transactions.find(t => normalizeReceiptCode(receiptSerial(t)) === q) || null;
}
function copyReceiptCode(code) {
  const done = () => showToast('📋 Đã sao chép mã phiếu: ' + code);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
  else fallbackCopy(code, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch(e) { showToast('⚠️ Không thể sao chép'); }
  document.body.removeChild(ta);
}

// Activity log helpers
function cleanSnapshot(tx) {
  const out = {};
  Object.keys(tx || {}).forEach(k => { if (k.startsWith('_')) return; if (tx[k] === undefined) return; out[k] = tx[k]; });
  return out;
}
function logActivity(action, tx, extra) {
  if (!currentNeighborhood) return;
  const entry = {
    id: uid(), action, txId: tx?.id || '', txName: tx?.name || '', txType: tx?.type || '',
    amount: Number(tx?.amount) || 0, byUid: currentUser?.uid || '',
    byName: currentUser?.displayName || currentUser?.email || 'Thủ quỹ',
    at: new Date().toISOString(),
    snapshot: action === 'delete' ? cleanSnapshot(tx) : null, restored: false
  };
  if (extra) Object.assign(entry, extra);
  data.activityLog = data.activityLog || [];
  data.activityLog.push(entry);
  fsSetDoc('activityLog', entry.id, entry);
}

// Toast
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Lookup
function activityWhen(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

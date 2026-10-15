// ===== DATA STORE =====
let data = {
  neighborhoodName: '',
  funds: [], transactions: [], categories: [],
  budgets: {}, members: [], activityLog: [], lastUpdated: null,
  generalFundVisible: true
};

let currentUser = null;
let currentNeighborhood = null;
let currentTxType = 'income';
let editingTxId = null;
let reportMonth = new Date();
let filterActive = 'all';
let searchQuery = '';
let catFilterActive = '';
let firestoreUnsubscribe = null;
let lastSyncTime = null;

// P1 optimizations
let knownTxIds = new Set();
let isFirstLoad = true;
let historyLimit = 100;

// Lookup Maps (P1)
let txMap = new Map();
let fundMap = new Map();
let catMap = new Map();

function rebuildMaps() {
  txMap = new Map(data.transactions.map(t => [t.id, t]));
  fundMap = new Map(data.funds.map(f => [f.id, f]));
  catMap = new Map(data.categories.map(c => [c.id, c]));
}

// ===== FIREBASE AUTH =====
function signInWithGoogle() {
  const { auth, provider, signInWithPopup } = window.fb;
  document.getElementById('btn-google-login').disabled = true;
  document.getElementById('login-loading').style.display = 'flex';
  document.getElementById('login-error').style.display = 'none';
  signInWithPopup(auth, provider).catch(err => {
    document.getElementById('login-error').textContent = 'Đăng nhập thất bại: ' + (err.message || err.code);
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('btn-google-login').disabled = false;
    document.getElementById('login-loading').style.display = 'none';
  });
}

function signOutUser() {
  if (!confirm('Đăng xuất?')) return;
  const { auth, signOut } = window.fb;
  if (firestoreUnsubscribe) { firestoreUnsubscribe(); firestoreUnsubscribe = null; }
  signOut(auth).then(() => {
    currentUser = null; currentNeighborhood = null;
    localStorage.removeItem('khu_pho_finance');
    localStorage.removeItem('last_neighborhood_id');
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('nb-picker-screen').style.display = 'none';
    document.getElementById('app-loading').style.display = 'none';
  });
}

function switchNeighborhood() {
  if (firestoreUnsubscribe) { firestoreUnsubscribe(); firestoreUnsubscribe = null; }
  currentNeighborhood = null;
  localStorage.removeItem('last_neighborhood_id');
  knownTxIds.clear(); // P1: cleanup on switch
  showNbPicker();
}

async function onUserSignedIn(user) {
  currentUser = user;
  if (user.photoURL) { document.getElementById('user-photo').src = user.photoURL; document.getElementById('user-photo').style.display = 'block'; document.getElementById('user-default-icon').style.display = 'none'; }
  document.getElementById('header-greeting').textContent = 'Xin chào, ' + (user.displayName?.split(' ').pop() || 'bạn');
  if (user.photoURL) document.getElementById('settings-user-photo').innerHTML = `<img src="${esc(user.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  document.getElementById('settings-user-name').textContent = user.displayName || 'Người dùng';
  document.getElementById('settings-user-email').textContent = user.email || '';
  document.getElementById('sync-indicator').style.display = 'block';
  document.getElementById('login-screen').style.display = 'none';
  const lastNbId = localStorage.getItem('last_neighborhood_id');
  if (lastNbId) {
    document.getElementById('app-loading').style.display = 'flex';
    document.getElementById('loading-text').textContent = 'Đang tải khu phố...';
    const ok = await loadNeighborhood(lastNbId);
    if (ok) return;
    document.getElementById('app-loading').style.display = 'none';
  }
  showNbPicker();
}

// ===== NEIGHBORHOOD PICKER =====
async function showNbPicker() {
  const { db, collection, query, where, getDocs } = window.fb;
  document.getElementById('nb-picker-screen').style.display = 'flex';
  document.getElementById('nb-picker-user').textContent = currentUser?.email || '';
  document.getElementById('nb-picker-error').style.display = 'none';
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) { const inp = document.getElementById('join-code-input'); if (inp) inp.value = joinParam.toUpperCase(); }
  try {
    const memberSnap = await getDocs(collection(db, 'users', currentUser.uid, 'memberships'));
    const memberships = memberSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const section = document.getElementById('my-neighborhoods-section');
    const list = document.getElementById('my-neighborhoods-list');
    if (memberships.length > 0) {
      section.style.display = 'block';
      list.innerHTML = memberships.map(m => `<div onclick="loadNeighborhood('${m.id}')" style="background:rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px;backdrop-filter:blur(10px);transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,.2)'" onmouseout="this.style.background='rgba(255,255,255,.12)'">
        <div style="font-size:24px">🏘️</div><div style="flex:1"><div style="color:white;font-size:14px;font-weight:700">${esc(m.name)}</div><div style="color:rgba(255,255,255,.6);font-size:11px">${m.role==='admin'?'🔑 Thủ quỹ':m.role==='member'?'👤 Thành viên (thêm GD)':'👁️ Người xem'} · ${esc(m.joinCode)}</div></div>
        <span style="color:rgba(255,255,255,.4);font-size:20px">›</span></div>`).join('');
    } else section.style.display = 'none';
  } catch(e) { console.warn('Could not load memberships', e); }
}

async function createNeighborhood() {
  const name = document.getElementById('create-nb-name').value.trim();
  if (!name) { showNbPickerError('Vui lòng nhập tên khu phố'); return; }
  showNbPickerLoading(true);
  const { db, doc, setDoc, collection } = window.fb;
  const joinCode = 'KP-' + Math.random().toString(36).substr(2,4).toUpperCase();
  const nbId = 'nb_' + Date.now().toString(36);
  try {
    await setDoc(doc(db, 'neighborhoods', nbId), { name, joinCode, createdBy: currentUser.uid, createdAt: new Date().toISOString(), memberCount: 1 });
    await setDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid), { uid: currentUser.uid, email: currentUser.email, name: currentUser.displayName || '', photoURL: currentUser.photoURL || '', role: 'admin', joinedAt: new Date().toISOString() });
    await setDoc(doc(db, 'users', currentUser.uid, 'memberships', nbId), { id: nbId, name, joinCode, role: 'admin' });
    showNbPickerLoading(false);
    await loadNeighborhood(nbId);
  } catch(err) { console.error(err); showNbPickerLoading(false); showNbPickerError('Lỗi tạo khu phố: ' + err.message); }
}

async function joinNeighborhood() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) { showNbPickerError('Vui lòng nhập mã khu phố'); return; }
  showNbPickerLoading(true);
  const { db, collection, query, where, getDocs, doc, setDoc, getDoc, deleteDoc } = window.fb;
  try {
    const snap = await getDocs(query(collection(db, 'neighborhoods'), where('joinCode', '==', code)));
    if (snap.empty) { showNbPickerLoading(false); showNbPickerError('Không tìm thấy mã: ' + code); return; }
    const nbDoc = snap.docs[0]; const nbId = nbDoc.id; const nbData = nbDoc.data();
    let assignedRole = 'viewer';
    try {
      const inviteId = (currentUser.email || '').replace(/[.#$/\[\]]/g, '_');
      const inviteSnap = await getDoc(doc(db, 'neighborhoods', nbId, 'members', inviteId));
      if (inviteSnap.exists() && inviteSnap.data().role) { assignedRole = inviteSnap.data().role; await deleteDoc(doc(db, 'neighborhoods', nbId, 'members', inviteId)); }
    } catch(e) {}
    await setDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid), { uid: currentUser.uid, email: currentUser.email, name: currentUser.displayName || '', photoURL: currentUser.photoURL || '', role: assignedRole, joinedAt: new Date().toISOString() });
    await setDoc(doc(db, 'users', currentUser.uid, 'memberships', nbId), { id: nbId, name: nbData.name, joinCode: code, role: assignedRole });
    showNbPickerLoading(false);
    await loadNeighborhood(nbId);
  } catch(err) { console.error(err); showNbPickerLoading(false); showNbPickerError('Lỗi tham gia: ' + err.message); }
}

function showNbPickerError(msg) { const el = document.getElementById('nb-picker-error'); el.textContent = msg; el.style.display = 'block'; }
function showNbPickerLoading(show) { document.getElementById('nb-picker-loading').style.display = show ? 'block' : 'none'; document.getElementById('nb-picker-error').style.display = 'none'; }

// ===== LOAD NEIGHBORHOOD =====
async function loadNeighborhood(nbId) {
  const { db, doc, getDoc, collection, getDocs } = window.fb;
  document.getElementById('app-loading').style.display = 'flex';
  document.getElementById('loading-text').textContent = 'Đang tải dữ liệu khu phố...';
  try {
    const nbSnap = await getDoc(doc(db, 'neighborhoods', nbId));
    if (!nbSnap.exists()) { document.getElementById('app-loading').style.display = 'none'; localStorage.removeItem('last_neighborhood_id'); return false; }
    const nbData = nbSnap.data();

    // 1. Kiểm tra vai trò của currentUser (hỗ trợ cả theo UID và theo Email nếu được mời hoặc chỉnh trên Firebase)
    let role = 'viewer';
    const myUidDoc = await getDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid));
    if (myUidDoc.exists()) {
      role = myUidDoc.data().role || 'viewer';
      if (!myUidDoc.data().name || !myUidDoc.data().email) {
        setDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid), {
          uid: currentUser.uid,
          email: currentUser.email || '',
          name: currentUser.displayName || myUidDoc.data().name || '',
          photoURL: currentUser.photoURL || myUidDoc.data().photoURL || ''
        }, { merge: true }).catch(()=>{});
      }
    } else {
      // Trường hợp được mời qua email hoặc sửa trực tiếp trên Firebase Console dưới dạng email
      const emailDocId = (currentUser.email || '').replace(/[.#$/\[\]]/g, '_');
      const emailSnap = await getDoc(doc(db, 'neighborhoods', nbId, 'members', emailDocId));
      if (emailSnap.exists()) {
        role = emailSnap.data().role || 'viewer';
        try {
          await setDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid), {
            ...emailSnap.data(),
            uid: currentUser.uid,
            email: currentUser.email,
            name: currentUser.displayName || emailSnap.data().name || '',
            photoURL: currentUser.photoURL || emailSnap.data().photoURL || '',
            role: role
          }, { merge: true });
          if (emailDocId !== currentUser.uid) {
            await deleteDoc(doc(db, 'neighborhoods', nbId, 'members', emailDocId));
          }
        } catch(e) { console.warn('Lỗi migrate member doc:', e); }
      } else if (currentUser.email) {
        try {
          const qSnap = await getDocs(query(collection(db, 'neighborhoods', nbId, 'members'), where('email', '==', currentUser.email)));
          if (!qSnap.empty) {
            const foundDoc = qSnap.docs[0];
            role = foundDoc.data().role || 'viewer';
            if (foundDoc.id !== currentUser.uid) {
              await setDoc(doc(db, 'neighborhoods', nbId, 'members', currentUser.uid), {
                ...foundDoc.data(),
                uid: currentUser.uid,
                role: role
              }, { merge: true });
              await deleteDoc(doc(db, 'neighborhoods', nbId, 'members', foundDoc.id));
            }
          }
        } catch(e) {}
      }
    }

    currentNeighborhood = { id: nbId, name: nbData.name, joinCode: nbData.joinCode, role };
    localStorage.setItem('last_neighborhood_id', nbId);
    data.neighborhoodName = nbData.name;

    const [fundsSnap, txSnap, catSnap, memberListSnap, settingsSnap, logSnap] = await Promise.all([
      getDocs(collection(db, 'neighborhoods', nbId, 'funds')),
      getDocs(collection(db, 'neighborhoods', nbId, 'transactions')),
      getDocs(collection(db, 'neighborhoods', nbId, 'categories')),
      getDocs(collection(db, 'neighborhoods', nbId, 'members')),
      getDoc(doc(db, 'neighborhoods', nbId, 'settings', 'main')),
      getDocs(collection(db, 'neighborhoods', nbId, 'activityLog'))
    ]);
    data.funds = fundsSnap.docs.map(d => ({ id: d.id, ...d.data(), initialBalance: d.data().initialBalance ?? d.data().balance ?? 0, note: d.data().note || '', visible: d.data().visible !== false }));
    data.transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    data.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Lọc thành viên khác, loại trừ currentUser triệt để để không bao giờ bị trùng lặp
    data.members = memberListSnap.docs
      .map(d => ({ id: d.id, uid: d.data().uid || d.id, ...d.data() }))
      .filter(m => {
        const isMeUid = m.uid && currentUser?.uid && m.uid === currentUser.uid;
        const isMeId = m.id && currentUser?.uid && m.id === currentUser.uid;
        const isMeEmail = m.email && currentUser?.email && m.email.toLowerCase() === currentUser.email.toLowerCase();
        return !isMeUid && !isMeId && !isMeEmail;
      });

    data.activityLog = logSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (settingsSnap.exists()) { data.budgets = settingsSnap.data().budgets || {}; data.generalFundVisible = settingsSnap.data().generalFundVisible !== false; }

    rebuildMaps(); // P1

    if (data.funds.length === 0 && data.transactions.length === 0 && role === 'admin') seedDefaultData();
    lastSyncTime = new Date(); saveLocalCache(); initKnownTxIds(); subscribeRealtime(); applyRoleUI(role);
    document.getElementById('nb-picker-screen').style.display = 'none'; document.getElementById('app-loading').style.display = 'none';
    reportMonth = new Date(); render();
    return true;
  } catch(err) { console.error('loadNeighborhood error:', err); document.getElementById('app-loading').style.display = 'none'; return false; }
}

function applyRoleUI(role) {
  const canWrite = role === 'admin' || role === 'member';
  const isAdminRole = role === 'admin';
  document.querySelectorAll('.write-only').forEach(el => { el.style.display = canWrite ? '' : 'none'; });
  const navAdd = document.querySelector('.nav-add');
  if (navAdd) navAdd.style.display = canWrite ? '' : 'none';
  document.querySelectorAll('.admin-only').forEach(el => { el.style.display = isAdminRole ? '' : 'none'; });
}

// ===== FIRESTORE HELPERS =====
function nbCol(collPath) { const { db, collection } = window.fb; return collection(db, 'neighborhoods', currentNeighborhood.id, collPath); }
function nbDoc(collPath, docId) { const { db, doc } = window.fb; return doc(db, 'neighborhoods', currentNeighborhood.id, collPath, docId); }

function subscribeRealtime() {
  if (!currentNeighborhood) return;
  const { onSnapshot } = window.fb;
  if (firestoreUnsubscribe) firestoreUnsubscribe();
  const unsubs = [
    onSnapshot(nbCol('transactions'), snap => { const newTxs = snap.docs.map(d => ({ id: d.id, ...d.data() })); checkNewTransactions(newTxs); data.transactions = newTxs; rebuildMaps(); saveLocalCache(); render(); lastSyncTime = new Date(); updateFirebaseSyncUI(); }, err => console.warn('TX snapshot:', err)),
    onSnapshot(nbCol('funds'), snap => { data.funds = snap.docs.map(d => ({ id: d.id, ...d.data(), initialBalance: d.data().initialBalance ?? d.data().balance ?? 0, note: d.data().note || '', visible: d.data().visible !== false })); rebuildMaps(); saveLocalCache(); render(); }, err => console.warn('Fund snapshot:', err)),
    onSnapshot(nbCol('members'), snap => {
      // 1. Tự động cập nhật vai trò nếu bị thay đổi trực tiếp trên Firebase Console
      const myDoc = snap.docs.find(d => 
        d.id === currentUser.uid || 
        d.data().uid === currentUser.uid || 
        (d.data().email && currentUser.email && d.data().email.toLowerCase() === currentUser.email.toLowerCase())
      );
      if (myDoc && myDoc.data().role) {
        const newRole = myDoc.data().role;
        if (currentNeighborhood && currentNeighborhood.role !== newRole) {
          currentNeighborhood.role = newRole;
          applyRoleUI(newRole);
          try {
            const { db, doc, setDoc } = window.fb;
            setDoc(doc(db, 'users', currentUser.uid, 'memberships', currentNeighborhood.id), { role: newRole }, { merge: true }).catch(()=>{});
          } catch(e) {}
          render();
          showToast(`🔔 Vai trò của bạn đã được cập nhật: ${getRoleInfo(newRole).badgeFullText}`);
        }
      }

      // 2. Lọc các thành viên khác
      data.members = snap.docs
        .map(d => ({ id: d.id, uid: d.data().uid || d.id, ...d.data() }))
        .filter(m => {
          const isMeUid = m.uid && currentUser?.uid && m.uid === currentUser.uid;
          const isMeId = m.id && currentUser?.uid && m.id === currentUser.uid;
          const isMeEmail = m.email && currentUser?.email && m.email.toLowerCase() === currentUser.email.toLowerCase();
          return !isMeUid && !isMeId && !isMeEmail;
        });
      saveLocalCache();
      renderSettings();
      if (document.getElementById('members-modal')?.classList.contains('open')) {
        renderMembersList();
      }
    }, err => console.warn('Member snapshot:', err)),
    onSnapshot(nbCol('categories'), snap => { data.categories = snap.docs.map(d => ({ id: d.id, ...d.data() })); rebuildMaps(); saveLocalCache(); render(); }, err => console.warn('Category snapshot:', err)),
    onSnapshot(nbDoc('settings', 'main'), snap => { if (snap.exists()) { data.budgets = snap.data().budgets || {}; data.generalFundVisible = snap.data().generalFundVisible !== false; saveLocalCache(); render(); } }, err => console.warn('Settings snapshot:', err)),
    onSnapshot(nbCol('activityLog'), snap => { data.activityLog = snap.docs.map(d => ({ id: d.id, ...d.data() })); saveLocalCache(); if (document.getElementById('activity-modal')?.classList.contains('open')) renderActivityLog(); }, err => console.warn('ActivityLog snapshot:', err)),
  ];
  firestoreUnsubscribe = () => unsubs.forEach(u => u());
  subscribePendingProposals(); subscribeMyProposals();
}

async function fsSetDoc(collPath, docId, docData) {
  if (!currentNeighborhood) return;
  const { setDoc } = window.fb;
  await setDoc(nbDoc(collPath, docId), { ...docData, _updatedAt: new Date().toISOString() }, { merge: true });
}
async function fsDeleteDoc(collPath, docId) {
  if (!currentNeighborhood) return;
  const { deleteDoc } = window.fb;
  await deleteDoc(nbDoc(collPath, docId));
}
async function fsSaveSettings() {
  if (!currentNeighborhood) return;
  const { setDoc, db, doc, updateDoc } = window.fb;
  await setDoc(nbDoc('settings', 'main'), { neighborhoodName: data.neighborhoodName, budgets: data.budgets, generalFundVisible: data.generalFundVisible !== false, _updatedAt: new Date().toISOString() });
  await updateDoc(doc(db, 'neighborhoods', currentNeighborhood.id), { name: data.neighborhoodName });
}

// ===== SYNC UI =====
function updateFirebaseSyncUI() {
  if (lastSyncTime) {
    const el = document.getElementById('firebase-last-sync');
    if (el) el.textContent = 'Đồng bộ lần cuối: ' + lastSyncTime.toLocaleTimeString('vi-VN');
  }
}
async function forceSyncFromFirebase() {
  showToast('🔄 Đang đồng bộ...');
  await loadNeighborhood(currentNeighborhood.id);
  showToast('✅ Đã đồng bộ xong');
}
function copyJoinCode() {
  const code = currentNeighborhood?.joinCode || '';
  navigator.clipboard?.writeText(code).then(() => showToast('📋 Đã sao chép mã: ' + code))
    .catch(() => showToast('Mã: ' + code));
}

// ===== LOCAL CACHE =====
function saveLocalCache() {
  data.lastUpdated = new Date().toISOString();
  localStorage.setItem('khu_pho_finance', JSON.stringify(data));
}
function loadLocalCache() {
  const raw = localStorage.getItem('khu_pho_finance');
  if (raw) { try {
    const p = JSON.parse(raw); data = { ...data, ...p };
    if (!data.funds) data.funds = [];
    if (!data.transactions) data.transactions = [];
    if (!data.categories) data.categories = [];
    if (!data.budgets) data.budgets = {};
    if (!data.members) data.members = [];
    if (!data.activityLog) data.activityLog = [];
    data.funds = data.funds.map(f => ({ ...f, initialBalance: f.initialBalance ?? f.balance ?? 0, note: f.note || '' }));
    rebuildMaps();
  } catch(e){} }
}
function saveData() { saveLocalCache(); }
function loadData() { loadLocalCache(); }

// Khu phố mới: chỉ tạo sẵn quỹ (số dư 0) và danh mục mẫu — KHÔNG tạo giao dịch giả
function seedDefaultData() {
  data.funds = [
    { id: uid(), name: 'Quỹ Chung', initialBalance: 0, balance: 0, note: 'Chi phí hạ tầng, sinh hoạt khu phố' }
  ];
  data.categories = [
    { id: uid(), name: 'Hạ tầng', icon: '🏗️', color: '#FFF3E0', textColor: '#E07800' },
    { id: uid(), name: 'Giáo dục', icon: '🎓', color: '#EBF3FF', textColor: '#1A54A8' },
    { id: uid(), name: 'An ninh', icon: '🔒', color: '#E8F7F0', textColor: '#1A7A4A' },
    { id: uid(), name: 'Lễ hội', icon: '🎉', color: '#FCE4EC', textColor: '#AD1457' },
    { id: uid(), name: 'Điện nước', icon: '💧', color: '#E0F7FA', textColor: '#00838F' },
  ];
  data.transactions = [];
  rebuildMaps();
  data.funds.forEach(f => fsSetDoc('funds', f.id, f));
  data.categories.forEach(c => fsSetDoc('categories', c.id, c));
}

async function deletePhotoFromStorage(docId) {
  if (!USE_STORAGE) return;
  const fb = window.fb;
  if (!fb || !fb.storage || !currentNeighborhood) return;
  try {
    const path = `neighborhoods/${currentNeighborhood.id}/receipts/${docId}.jpg`;
    await fb.deleteObject(fb.storageRef(fb.storage, path));
  } catch (e) { /* không có ảnh hoặc đã xóa — bỏ qua */ }
}

// ===== RECEIPT PHOTO =====
let receiptPhotoBase64 = null;
const USE_STORAGE = false;

function onReceiptPhotoSelected(event) {
  const file = event.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('⚠️ Vui lòng chọn tệp ảnh'); return; }
  if (file.size > 8 * 1024 * 1024) { showToast('⚠️ Ảnh quá lớn (tối đa 8MB)'); return; }
  showToast('⏳ Đang xử lý ảnh...');
  compressImage(file, 1280, 0.7).then(dataUrl => {
    receiptPhotoBase64 = dataUrl;
    document.getElementById('receipt-photo-preview').src = receiptPhotoBase64;
    document.getElementById('receipt-photo-preview').style.display = 'block';
    document.getElementById('receipt-photo-icon').style.display = 'none';
    document.getElementById('receipt-photo-label').style.display = 'none';
    document.getElementById('receipt-photo-remove').style.display = 'block';
  }).catch(() => showToast('❌ Không đọc được ảnh'));
}
function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => { const img = new Image();
      img.onload = () => { let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
        else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let out = canvas.toDataURL('image/jpeg', quality); let q = quality;
        while (out.length > 900000 && q > 0.4) { q -= 0.1; out = canvas.toDataURL('image/jpeg', q); } resolve(out); };
      img.onerror = reject; img.src = e.target.result;
    }; reader.onerror = reject; reader.readAsDataURL(file);
  });
}
function removeReceiptPhoto() {
  receiptPhotoBase64 = null;
  document.getElementById('receipt-photo-preview').style.display = 'none';
  document.getElementById('receipt-photo-preview').src = '';
  document.getElementById('receipt-photo-icon').style.display = '';
  document.getElementById('receipt-photo-label').style.display = '';
  document.getElementById('receipt-photo-remove').style.display = 'none';
  document.getElementById('receipt-photo-input').value = '';
}
async function uploadPhotoIfNeeded(dataUrl, docId) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl;
  if (!USE_STORAGE) return dataUrl;
  const fb = window.fb; if (!fb || !fb.storage) return dataUrl;
  try { const path = `neighborhoods/${currentNeighborhood.id}/receipts/${docId}.jpg`; const r = fb.storageRef(fb.storage, path); await fb.uploadString(r, dataUrl, 'data_url'); return await fb.getDownloadURL(r); }
  catch (e) { console.warn('Upload Storage thất bại', e); return dataUrl; }
}

// ===== PROPOSE / APPROVE =====
let pendingProposals = [];
async function subscribePendingProposals() {
  if (!currentNeighborhood || currentNeighborhood.role !== 'admin') return;
  const { onSnapshot, query, where } = window.fb;
  const q = query(nbCol('proposals'), where('status', '==', 'pending'));
  onSnapshot(q, snap => { pendingProposals = snap.docs.map(d => ({ id: d.id, ...d.data() })); updateApprovalBadge(); }, err => console.warn('Proposals snapshot:', err));
}
let myProposalsFirst = true, myProposalStatus = {};
function subscribeMyProposals() {
  if (!currentNeighborhood || currentNeighborhood.role !== 'member') return;
  const { onSnapshot, query, where } = window.fb; myProposalsFirst = true; myProposalStatus = {};
  const q = query(nbCol('proposals'), where('createdBy', '==', currentUser.uid));
  onSnapshot(q, snap => { snap.docs.forEach(d => { const p = d.data(); const prev = myProposalStatus[d.id]; myProposalStatus[d.id] = p.status; if (!myProposalsFirst && prev === 'pending') { if (p.status === 'approved') { showToast('✅ Đề xuất "' + (p.name||'') + '" đã được duyệt'); fsDeleteDoc('proposals', d.id); } else if (p.status === 'rejected') { showToast('❌ Đề xuất "' + (p.name||'') + '" bị từ chối'); fsDeleteDoc('proposals', d.id); } } }); myProposalsFirst = false; }, err => console.warn('My proposals snapshot:', err));
}
function updateApprovalBadge() { const count = pendingProposals.length; const hdrBadge = document.getElementById('approval-header-badge'); if (hdrBadge) { hdrBadge.textContent = count; hdrBadge.style.display = count > 0 ? 'block' : 'none'; } }

function openApprovalModal() { renderApprovalList(); document.getElementById('approval-modal').classList.add('open'); }
function renderApprovalList() {
  const el = document.getElementById('approval-list');
  if (pendingProposals.length === 0) { el.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)"><span style="font-size:40px">✅</span><p style="margin-top:8px;font-size:14px;font-weight:600">Không có đề xuất nào chờ duyệt</p></div>'; return; }
  el.innerHTML = pendingProposals.map(p => `<div style="background:var(--bg);border-radius:12px;padding:14px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px"><div style="flex:1"><div style="font-size:13px;font-weight:700">${esc(p.name)}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(p.proposedBy || 'Thành viên')} · ${fmtDate(p.date)}</div></div>
    <div style="font-size:15px;font-weight:800;color:${p.type==='income'?'var(--success)':'var(--danger)'}">${p.type==='income'?'+':'-'}${p.amount.toLocaleString('vi-VN')}đ</div></div>
    ${p.note ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">📝 ${esc(p.note)}</div>` : ''}
    ${p.photoURL ? `<img src="${esc(p.photoURL)}" style="width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px">` : ''}
    <div style="display:flex;gap:8px"><button onclick="approveProposal('${p.id}')" style="flex:1;padding:9px;background:var(--success);color:white;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">✅ Duyệt</button>
    <button onclick="rejectProposal('${p.id}')" style="flex:1;padding:9px;background:var(--danger);color:white;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">❌ Từ chối</button></div></div>`).join('');
}
async function approveProposal(proposalId) {
  if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được duyệt'); return; }
  const p = pendingProposals.find(x => x.id === proposalId); if (!p) return;
  const newTx = { id: uid(), seq: getNextTxSeq(), type: p.type, name: p.name, amount: p.amount, date: p.date, note: p.note, fund: p.fund || '', category: p.category || '', photoURL: p.photoURL || '', createdBy: p.createdBy || '', createdByName: p.proposedByName || p.proposedBy || '', approvedBy: currentUser.email, approvedAt: new Date().toISOString() };
  await fsSetDoc('transactions', newTx.id, newTx); logActivity('create', newTx, { via: 'Duyệt đề xuất của ' + (p.proposedByName || p.proposedBy || 'thành viên') });
  await fsSetDoc('proposals', proposalId, { status: 'approved', approvedBy: currentUser.email, approvedAt: new Date().toISOString() });
  pendingProposals = pendingProposals.filter(x => x.id !== proposalId); updateApprovalBadge(); renderApprovalList(); showToast('✅ Đã duyệt và thêm giao dịch!');
}
async function rejectProposal(proposalId) {
  if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được từ chối'); return; }
  if (!confirm('Từ chối đề xuất này?')) return;
  await fsSetDoc('proposals', proposalId, { status: 'rejected', rejectedBy: currentUser.email, rejectedAt: new Date().toISOString() });
  pendingProposals = pendingProposals.filter(x => x.id !== proposalId); updateApprovalBadge(); renderApprovalList(); showToast('❌ Đã từ chối đề xuất');
}

// ===== CALCULATIONS =====
function getFundBalance(fundId) { const fund = data.funds.find(f => f.id === fundId); if (!fund) return 0; const initial = fund.initialBalance ?? fund.balance ?? 0; const txDelta = data.transactions.filter(t => t.fund === fundId).reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0); return initial + txDelta; }
function getGeneralFundBalance() { return data.transactions.filter(t => !t.fund).reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0); }
function getTotalBalance() { const fundTotal = data.funds.reduce((s, f) => s + getFundBalance(f.id), 0); const noFundTxDelta = data.transactions.filter(t => !t.fund).reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0); return fundTotal + noFundTxDelta; }
function getMonthStats(date) {
  const m = date.getMonth(), y = date.getFullYear();
  const txs = data.transactions.filter(t => { const d = parseLocalDate(t.date); return d.getMonth() === m && d.getFullYear() === y; });
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { income, expense, txs };
}

// ===== RENDER (targeted, P1) =====
function render() { renderDashboard(); renderHistory(); renderReport(); renderSettings(); }

function renderDashboard() {
  const total = getTotalBalance();
  document.getElementById('total-balance').innerHTML = total.toLocaleString('vi-VN') + '<span>VND</span>';
  if (data.lastUpdated) { const d = new Date(data.lastUpdated); document.getElementById('last-updated').textContent = `Hôm nay, ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; }
  const { income, expense } = getMonthStats(new Date());
  document.getElementById('month-income').textContent = '+' + fmtMoneyFull(income);
  document.getElementById('month-expense').textContent = '-' + fmtMoneyFull(expense);
  const fundList = document.getElementById('fund-list'); const admin = isAdmin(); const generalBalance = getGeneralFundBalance(); const generalVisible = data.generalFundVisible !== false; const visibleFunds = data.funds.filter(f => admin || f.visible !== false); const showGeneral = admin || generalVisible;
  if (visibleFunds.length === 0 && !showGeneral) { fundList.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">folder_open</span><p>Chưa có quỹ nào</p></div>`; } else {
    const fundBalances = visibleFunds.map(f => ({ ...f, currentBalance: getFundBalance(f.id) }));
    let totalFunds = fundBalances.reduce((s, f) => s + Math.max(f.currentBalance, 0), 0); if (showGeneral) totalFunds += Math.max(generalBalance, 0); totalFunds = totalFunds || 1;
    let html = ''; if (showGeneral) { const pct = Math.max(0, Math.round(generalBalance / totalFunds * 100)); const balColor = generalBalance < 0 ? 'color:var(--danger)' : ''; html += `<div class="fund-card" onclick="openFundDetail(null)"><div class="fund-header"><div><span class="fund-name">Quỹ chung</span>${admin && !generalVisible ? `<span class="fund-hidden-badge"><span class="material-symbols-outlined" style="font-size:12px">visibility_off</span>Đã ẩn</span>` : ''}<div style="font-size:10px;color:var(--text-muted);margin-top:2px">Giao dịch không gắn quỹ cụ thể</div></div><span class="fund-amount" style="${balColor}">${fmtMoneyFull(generalBalance)} (${pct}%)</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>`; }
    html += fundBalances.map(f => { const pct = Math.max(0, Math.round(f.currentBalance / totalFunds * 100)); const balColor = f.currentBalance < 0 ? 'color:var(--danger)' : ''; return `<div class="fund-card" onclick="openFundDetail('${f.id}')"><div class="fund-header"><div><span class="fund-name">${esc(f.name)}</span>${admin && f.visible === false ? `<span class="fund-hidden-badge"><span class="material-symbols-outlined" style="font-size:12px">visibility_off</span>Đã ẩn</span>` : ''}${f.note ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc(f.note)}</div>` : ''}</div><span class="fund-amount" style="${balColor}">${fmtMoneyFull(f.currentBalance)} (${pct}%)</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div></div>`; }).join('');
    fundList.innerHTML = html;
  }
  const recent = [...data.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  const recentEl = document.getElementById('recent-txs');
  if (recent.length === 0) { recentEl.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">receipt_long</span><p>Chưa có giao dịch nào</p></div>`; } else { recentEl.innerHTML = recent.map(t => txHTML(t, true, isAdmin())).join(''); }
  document.getElementById('neighborhood-name').textContent = data.neighborhoodName; renderBudgetDashboard();
}

function renderHistory() {
  let txs = [...data.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if (filterActive !== 'all') txs = txs.filter(t=>t.type===filterActive);
  if (searchQuery) { const q = searchQuery.toLowerCase(); txs = txs.filter(t => t.name.toLowerCase().includes(q) || String(t.amount).includes(q) || (t.note||'').toLowerCase().includes(q) || (t.category ? catMap.get(t.category)?.name.toLowerCase().includes(q) : false) || fmtMoneyFull(t.amount).includes(q) || receiptSerial(t).toLowerCase().includes(q)); }
  if (catFilterActive) txs = txs.filter(t=>t.category===catFilterActive);
  const catBar = document.getElementById('cat-filter-bar');
  if (data.categories.length > 0) { catBar.innerHTML = data.categories.map(c => `<button class="filter-chip${catFilterActive===c.id?' active':''}" onclick="filterCat('${c.id}')">${c.icon} ${c.name}</button>`).join(''); if (catFilterActive) catBar.innerHTML = `<button class="filter-chip active" onclick="filterCat('')">✕ Tất cả</button>` + catBar.innerHTML; catBar.style.display = 'flex'; } else { catBar.style.display = 'none'; }
  const container = document.getElementById('all-txs-container'); const totalCount = txs.length; const shown = txs.slice(0, historyLimit);
  if (shown.length === 0) { container.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">receipt_long</span><p>${searchQuery||catFilterActive ? 'Không tìm thấy kết quả' : 'Không có giao dịch'}</p></div>`; return; }
  const groups = {}; shown.forEach(t => { const d = parseLocalDate(t.date); const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; const label = `Tháng ${d.getMonth()+1}, ${d.getFullYear()}`; if (!groups[key]) groups[key] = { label, txs: [] }; groups[key].txs.push(t); });
  container.innerHTML = Object.entries(groups).map(([k, g]) => `<div style="margin-bottom:12px"><div style="font-size:12px;font-weight:700;color:var(--text-muted);padding:8px 0 4px;">${g.label}</div>${g.txs.map(t => txHTML(t, true, isAdmin())).join('')}</div>`).join('') + (totalCount > historyLimit ? `<button class="btn btn-secondary" style="margin:8px 0 16px" onclick="loadMoreHistory()">Xem thêm (${totalCount - historyLimit} giao dịch)</button>` : '');
}
function loadMoreHistory() { historyLimit += 100; renderHistory(); }
let searchDebounce;
function onSearchInput(val) { document.getElementById('search-clear').style.display = val ? 'block' : 'none'; clearTimeout(searchDebounce); searchDebounce = setTimeout(() => { searchQuery = val.trim(); historyLimit = 100; renderHistory(); }, 200); }
function clearSearch() { searchQuery = ''; document.getElementById('search-input').value = ''; document.getElementById('search-clear').style.display = 'none'; historyLimit = 100; renderHistory(); }
function filterCat(catId) { catFilterActive = catId; historyLimit = 100; renderHistory(); }
function filterTx(f) { filterActive = f; historyLimit = 100; document.querySelectorAll('#filter-bar .filter-chip').forEach(c => { c.classList.toggle('active', c.dataset.filter === f); }); renderHistory(); }

function renderReport() {
  document.getElementById('report-month-label').textContent = `Tháng ${reportMonth.getMonth()+1}/${reportMonth.getFullYear()}`;
  const { income, expense, txs } = getMonthStats(reportMonth);
  document.getElementById('r-income').textContent = '+' + fmtMoneyFull(income);
  document.getElementById('r-expense').textContent = '-' + fmtMoneyFull(expense);
  document.getElementById('r-balance').textContent = (income - expense >= 0 ? '+' : '') + fmtMoneyFull(income - expense);
  const barChart = document.getElementById('bar-chart'); const months = [];
  for (let i=5; i>=0; i--) months.push(new Date(reportMonth.getFullYear(), reportMonth.getMonth() - i, 1));
  const allStats = months.map(m => getMonthStats(m)); const maxVal = Math.max(...allStats.map(s => Math.max(s.income, s.expense)), 1); const BAR_HEIGHT = 90;
  barChart.innerHTML = months.map((m, i) => { const s = allStats[i]; const ih = Math.max(Math.round(s.income / maxVal * BAR_HEIGHT), s.income > 0 ? 3 : 0); const eh = Math.max(Math.round(s.expense / maxVal * BAR_HEIGHT), s.expense > 0 ? 3 : 0); const isCurrentMonth = m.getMonth() === reportMonth.getMonth() && m.getFullYear() === reportMonth.getFullYear(); return `<div class="bar-col"><div class="bar-pair"><div class="bar-single income" style="height:${ih}px" title="Thu: ${fmtMoneyFull(s.income)}"></div><div class="bar-single expense" style="height:${eh}px" title="Chi: ${fmtMoneyFull(s.expense)}"></div></div><div class="bar-label" style="${isCurrentMonth ? 'color:var(--primary);font-weight:800' : ''}">T${m.getMonth()+1}</div></div>`; }).join('');
  renderCategoryPie(txs);
  const rtxs = document.getElementById('report-txs'); if (txs.length === 0) { rtxs.innerHTML = `<div style="padding:0 16px"><div class="empty-state"><span class="material-symbols-outlined">receipt_long</span><p>Không có giao dịch</p></div></div>`; } else { rtxs.innerHTML = `<div style="padding:0 16px">${txs.map(t=>txHTML(t,false,isAdmin())).join('')}</div>`; }
}
function renderCategoryPie(txs) {
  const container = document.getElementById('cat-pie-container'), pie = document.getElementById('cat-pie'), legend = document.getElementById('cat-pie-legend'); if (!container) return;
  const expenses = txs.filter(t => t.type === 'expense'); const total = expenses.reduce((s, t) => s + t.amount, 0);
  if (total === 0) { container.style.display = 'none'; return; } container.style.display = '';
  const byCat = {}; expenses.forEach(t => { const key = t.category || '__none__'; byCat[key] = (byCat[key] || 0) + t.amount; });
  const palette = ['#FF8C00','#3A7BD5','#2D9E6A','#D94F4F','#7C3AED','#F59E0B','#00838F','#AD1457','#5D6D7E','#E07800'];
  const items = Object.entries(byCat).map(([k, v]) => ({ name: catMap.get(k) ? `${catMap.get(k).icon} ${catMap.get(k).name}` : 'Không phân loại', amount: v })).sort((a, b) => b.amount - a.amount);
  let acc = 0; const stops = []; items.forEach((it, i) => { const col = palette[i % palette.length]; const start = acc / total * 100; acc += it.amount; const end = acc / total * 100; it.color = col; stops.push(`${col} ${start}% ${end}%`); });
  pie.style.background = `conic-gradient(${stops.join(',')})`; pie.style.boxShadow = 'inset 0 0 0 18px #fff';
  legend.innerHTML = items.map(it => { const pct = Math.round(it.amount / total * 100); return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:11px"><span style="width:10px;height:10px;border-radius:3px;background:${it.color};flex-shrink:0"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.name)}</span><span style="font-weight:700">${fmtMoneyFull(it.amount)} · ${pct}%</span></div>`; }).join('');
}

function renderSettings() {
  document.getElementById('nb-name-sub').textContent = data.neighborhoodName;
  document.getElementById('fund-count-sub').textContent = `${data.funds.length} quỹ đang hoạt động`;
  document.getElementById('cat-count-sub').textContent = `${data.categories.length} danh mục`;
  const budgetCount = Object.keys(data.budgets).length; document.getElementById('budget-sub').textContent = budgetCount > 0 ? `${budgetCount} danh mục có ngân sách` : 'Chưa đặt ngân sách';
  const memberCount = data.members.length; document.getElementById('member-count-sub').textContent = memberCount > 0 ? `${memberCount + 1} thành viên` : 'Chỉ mình bạn';
  const actSub = document.getElementById('activity-sub'); if (actSub) { const logCount = (data.activityLog || []).length; const delCount = (data.activityLog || []).filter(l => l.action === 'delete' && !l.restored).length; actSub.textContent = logCount > 0 ? `${logCount} hoạt động${delCount > 0 ? ` · ${delCount} có thể phục hồi` : ''}` : 'Ai thêm / sửa / xóa · phục hồi giao dịch'; }
  if (currentNeighborhood) {
    document.getElementById('settings-nb-name').textContent = currentNeighborhood.name;
    document.getElementById('nb-join-code').textContent = currentNeighborhood.joinCode;
    const role = currentNeighborhood.role;
    const info = getRoleInfo(role);
    document.getElementById('settings-nb-role').textContent = info.desc;
    const badge = document.getElementById('settings-nb-role-badge');
    badge.textContent = info.badgeFullText;
    badge.className = 'role-badge ' + info.badgeClass;
  }
  updateFirebaseSyncUI();
}

// ===== NAVIGATION =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active'); const navEl = document.getElementById('nav-'+name); if (navEl) navEl.classList.add('active');
  if (name==='report') renderReport(); if (name==='settings') renderSettings(); if (name==='history') renderHistory();
}

// ===== MODALS =====
function openTxModal(id=null) {
  editingTxId = id; document.getElementById('tx-modal-title').textContent = id ? 'Sửa giao dịch' : 'Thêm giao dịch';
  document.getElementById('tx-name').value = ''; document.getElementById('tx-amount').value = ''; document.getElementById('tx-note').value = ''; document.getElementById('tx-date').value = new Date().toISOString().split('T')[0]; document.getElementById('amount-helper').textContent = ''; setType('income');
  const sel = document.getElementById('tx-fund'); sel.innerHTML = '<option value="">-- Quỹ chung --</option>' + data.funds.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  const catSel = document.getElementById('tx-category'); catSel.innerHTML = '<option value="">-- Không phân loại --</option>' + data.categories.map(c => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
  removeReceiptPhoto();
  const role = currentNeighborhood?.role; const propSection = document.getElementById('tx-propose-section'); const saveBtn = document.getElementById('tx-save-btn');
  if (role === 'member' && !id) { propSection.style.display = 'block'; saveBtn.textContent = '📤 Gửi đề xuất'; } else { propSection.style.display = 'none'; saveBtn.textContent = 'Lưu giao dịch'; }
  if (id) { const t = data.transactions.find(x=>x.id===id); if (t) { setType(t.type); document.getElementById('tx-name').value = t.name; document.getElementById('tx-amount').value = t.amount; document.getElementById('tx-date').value = t.date; document.getElementById('tx-note').value = t.note || ''; document.getElementById('tx-fund').value = t.fund || ''; document.getElementById('tx-category').value = t.category || ''; updateAmountHelper(); if (t.photoURL) { receiptPhotoBase64 = t.photoURL; document.getElementById('receipt-photo-preview').src = t.photoURL; document.getElementById('receipt-photo-preview').style.display = 'block'; document.getElementById('receipt-photo-icon').style.display = 'none'; document.getElementById('receipt-photo-label').style.display = 'none'; document.getElementById('receipt-photo-remove').style.display = 'block'; } } }
  document.getElementById('tx-modal').classList.add('open');
}
function openFundModal() { renderFundManagement(); document.getElementById('fund-name').value = ''; document.getElementById('fund-initial').value = ''; document.getElementById('fund-modal').classList.add('open'); }
function openNeighborhoodModal() { document.getElementById('nb-name-input').value = data.neighborhoodName; document.getElementById('nb-modal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(el => { el.addEventListener('click', function(e) { if(e.target===this) closeModal(this.id); }); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const open = document.querySelector('.modal-overlay.open'); if (open) closeModal(open.id); } });

// ===== TRANSACTION LOGIC =====
function setType(t) { currentTxType = t; document.getElementById('btn-income').classList.toggle('active', t==='income'); document.getElementById('btn-expense').classList.toggle('active', t==='expense'); }
function updateAmountHelper() { const v = parseInt(document.getElementById('tx-amount').value)||0; document.getElementById('amount-helper').textContent = v > 0 ? v.toLocaleString('vi-VN') + ' VND' : ''; }

async function saveTx() {
  const name = document.getElementById('tx-name').value.trim(); const amount = parseInt(document.getElementById('tx-amount').value)||0; const date = document.getElementById('tx-date').value; const note = document.getElementById('tx-note').value.trim(); const fund = document.getElementById('tx-fund').value; const category = document.getElementById('tx-category').value; const rawPhoto = receiptPhotoBase64 || '';
  if (!name) { showToast('⚠️ Vui lòng nhập tên giao dịch'); return; } if (!amount || amount <= 0) { showToast('⚠️ Vui lòng nhập số tiền hợp lệ'); return; } if (!date) { showToast('⚠️ Vui lòng chọn ngày'); return; }
  const role = currentNeighborhood?.role; const saveBtn = document.getElementById('tx-save-btn'); if (saveBtn) saveBtn.disabled = true;
  if (USE_STORAGE && rawPhoto.startsWith('data:')) showToast('⏳ Đang tải ảnh lên...');
  try {
    if (role === 'member' && !editingTxId) { const pid = uid(); const photoURL = await uploadPhotoIfNeeded(rawPhoto, pid); const proposal = { id: pid, type: currentTxType, name, amount, date, note, fund, category, photoURL, status: 'pending', proposedBy: currentUser.email, proposedByName: currentUser.displayName || currentUser.email, proposedAt: new Date().toISOString(), createdBy: currentUser.uid }; await fsSetDoc('proposals', pid, proposal); closeModal('tx-modal'); showToast('📤 Đề xuất đã gửi — chờ thủ quỹ duyệt!'); return; }
    if (editingTxId) { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được sửa giao dịch'); return; } const idx = data.transactions.findIndex(t=>t.id===editingTxId); if (idx !== -1) { const before = cleanSnapshot(data.transactions[idx]); const photoURL = await uploadPhotoIfNeeded(rawPhoto, editingTxId); data.transactions[idx] = { ...data.transactions[idx], type: currentTxType, name, amount, date, note, fund, category, photoURL, updatedBy: currentUser?.email || '', updatedAt: new Date().toISOString() }; fsSetDoc('transactions', editingTxId, data.transactions[idx]); logActivity('edit', data.transactions[idx], { before }); } showToast('✅ Đã cập nhật giao dịch'); } else { if (!isAdmin()) { showToast('⚠️ Bạn không có quyền thêm trực tiếp'); return; } const newId = uid(); const photoURL = await uploadPhotoIfNeeded(rawPhoto, newId); const newTx = { id: newId, seq: getNextTxSeq(), type: currentTxType, name, amount, date, note, fund, category, photoURL, createdBy: currentUser?.uid || '', createdByName: currentUser?.displayName || '', createdAt: new Date().toISOString() }; data.transactions.push(newTx); knownTxIds.add(newTx.id); fsSetDoc('transactions', newTx.id, newTx); logActivity('create', newTx); showToast('✅ Đã thêm giao dịch'); }
    saveData(); closeModal('tx-modal'); render();
  } finally { if (saveBtn) saveBtn.disabled = false; }
}

function deleteTx(id) { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được xóa giao dịch'); return; } if (!confirm('Xóa giao dịch này?')) return; const victim = data.transactions.find(t=>t.id===id); if (victim) logActivity('delete', victim); data.transactions = data.transactions.filter(t=>t.id!==id); fsDeleteDoc('transactions', id); saveData(); render(); showToast('🗑️ Đã xóa giao dịch (có thể phục hồi trong Nhật ký)'); }

let detailTxId = null;
function openTxDetail(id) { const t = data.transactions.find(x=>x.id===id); if (!t) return; detailTxId = id; const fundName = t.fund ? (fundMap.get(t.fund)?.name || 'Quỹ chung') : 'Quỹ chung'; const cat = t.category ? catMap.get(t.category) : null; const sign = t.type==='income' ? '+' : '-'; document.getElementById('detail-amount').textContent = sign + t.amount.toLocaleString('vi-VN') + ' VND'; document.getElementById('detail-amount').style.color = t.type==='income' ? 'var(--success)' : 'var(--danger)'; document.getElementById('detail-type-badge').innerHTML = `<span class="detail-type-badge ${t.type}">${t.type==='income'?'Thu nhập':'Chi phí'}</span>`; document.getElementById('detail-rows').innerHTML = `<div class="detail-row"><span class="detail-label">Mã phiếu</span><span class="detail-value"><span class="receipt-code-chip" onclick="event.stopPropagation();copyReceiptCode('${receiptSerial(t)}')" title="Bấm để sao chép">${receiptSerial(t)} <span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">content_copy</span></span></span></div><div class="detail-row"><span class="detail-label">Tên giao dịch</span><span class="detail-value">${esc(t.name)}</span></div><div class="detail-row"><span class="detail-label">Ngày</span><span class="detail-value">${fmtDate(t.date)}</span></div><div class="detail-row"><span class="detail-label">Quỹ</span><span class="detail-value">${esc(fundName)}</span></div>${cat ? `<div class="detail-row"><span class="detail-label">Danh mục</span><span class="detail-value"><span style="background:${cat.color};color:${cat.textColor};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">${esc(cat.icon)} ${esc(cat.name)}</span></span></div>` : ''}${t.note ? `<div class="detail-row"><span class="detail-label">Ghi chú</span><span class="detail-value" style="color:var(--text-muted)">${esc(t.note)}</span></div>` : ''}${t.createdByName ? `<div class="detail-row"><span class="detail-label">Người tạo</span><span class="detail-value">${esc(t.createdByName)}</span></div>` : ''}${t.approvedBy ? `<div class="detail-row"><span class="detail-label">Duyệt bởi</span><span class="detail-value" style="color:var(--success)">✅ ${esc(t.approvedBy)}</span></div>` : ''}${t.photoURL ? `<div style="margin-top:12px"><div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:6px">📸 Ảnh hóa đơn</div><img src="${esc(t.photoURL)}" style="width:100%;max-height:200px;object-fit:contain;border-radius:10px;border:1px solid var(--border);cursor:pointer" onclick="viewFullPhoto('${id}')"></div>` : ''}`;
  document.querySelector('.detail-actions').style.display = isAdmin() ? '' : 'none'; document.getElementById('tx-detail-modal').classList.add('open'); }
function editFromDetail() { closeModal('tx-detail-modal'); setTimeout(() => openTxModal(detailTxId), 150); }
function deleteFromDetail() { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được xóa giao dịch'); return; } if (!confirm('Xóa giao dịch này?')) return; const victim = data.transactions.find(t=>t.id===detailTxId); if (victim) logActivity('delete', victim); data.transactions = data.transactions.filter(t=>t.id!==detailTxId); fsDeleteDoc('transactions', detailTxId); saveData(); closeModal('tx-detail-modal'); render(); showToast('🗑️ Đã xóa giao dịch (có thể phục hồi trong Nhật ký)'); }

// ===== FUND DETAIL =====
let fundDetailId = null;
function openFundDetail(fundId) { const admin = isAdmin(); const isGeneral = !fundId; if (isGeneral) { if (!admin && data.generalFundVisible === false) { showToast('⚠️ Quỹ chung đang bị ẩn'); return; } } else { const fund = fundMap.get(fundId); if (!fund) return; if (!admin && fund.visible === false) { showToast('⚠️ Quỹ này đang bị ẩn'); return; } } fundDetailId = fundId || null; renderFundDetail(); document.getElementById('fund-detail-modal').classList.add('open'); }
function renderFundDetail() { const admin = isAdmin(); const isGeneral = !fundDetailId; const fund = isGeneral ? null : fundMap.get(fundDetailId); if (!isGeneral && !fund) { closeModal('fund-detail-modal'); return; } const name = isGeneral ? 'Quỹ chung' : fund.name; const note = isGeneral ? 'Giao dịch không gắn quỹ cụ thể' : (fund.note || ''); const visible = isGeneral ? (data.generalFundVisible !== false) : (fund.visible !== false); document.getElementById('fund-detail-title').textContent = name; document.getElementById('fund-detail-note').textContent = note; const visBtn = document.getElementById('fund-detail-vis-btn'); if (admin) { visBtn.style.display = 'flex'; visBtn.className = 'fund-vis-btn ' + (visible ? 'on' : 'off'); visBtn.title = visible ? 'Đang hiển thị — bấm để ẩn' : 'Đang ẩn — bấm để hiện lại'; document.getElementById('fund-detail-vis-icon').textContent = visible ? 'visibility' : 'visibility_off'; } else visBtn.style.display = 'none'; const txs = isGeneral ? data.transactions.filter(t => !t.fund) : data.transactions.filter(t => t.fund === fundDetailId); const sorted = [...txs].sort((a,b)=>new Date(b.date)-new Date(a.date)); const income = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0); const expense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0); const balance = isGeneral ? getGeneralFundBalance() : getFundBalance(fundDetailId); document.getElementById('fund-detail-balance').innerHTML = fmtMoneyFull(balance); document.getElementById('fund-detail-balance').style.color = balance < 0 ? 'var(--danger)' : 'var(--text)'; document.getElementById('fund-detail-income').textContent = '+' + fmtMoneyFull(income); document.getElementById('fund-detail-expense').textContent = '-' + fmtMoneyFull(expense); const listEl = document.getElementById('fund-detail-tx-list'); if (sorted.length === 0) listEl.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">receipt_long</span><p>Chưa có giao dịch nào</p></div>`; else listEl.innerHTML = sorted.map(t => txHTML(t, false, isAdmin())).join(''); }
function toggleFundDetailVisibility() { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được thay đổi quyền xem quỹ'); return; } if (!fundDetailId) toggleGeneralFundVisibility(); else toggleFundVisibility(fundDetailId); renderFundDetail(); }
function toggleFundVisibility(id) { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được thay đổi quyền xem quỹ'); return; } const idx = data.funds.findIndex(f => f.id === id); if (idx === -1) return; const newVisible = data.funds[idx].visible === false; data.funds[idx].visible = newVisible; fsSetDoc('funds', id, data.funds[idx]); saveData(); renderFundManagement(); render(); showToast(newVisible ? '👁️ Đã hiện quỹ: ' + data.funds[idx].name : '🙈 Đã ẩn quỹ: ' + data.funds[idx].name); }
function toggleGeneralFundVisibility() { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được thay đổi quyền xem quỹ'); return; } data.generalFundVisible = data.generalFundVisible === false; fsSaveSettings(); saveData(); renderFundManagement(); render(); showToast(data.generalFundVisible ? '👁️ Đã hiện Quỹ chung' : '🙈 Đã ẩn Quỹ chung'); }

// ===== FUND LOGIC =====
function addFund() { const name = document.getElementById('fund-name').value.trim(); const initial = parseInt(document.getElementById('fund-initial').value) || 0; const note = document.getElementById('fund-note').value.trim(); if (!name) { showToast('⚠️ Vui lòng nhập tên quỹ'); return; } const newFund = { id: uid(), name, initialBalance: initial, balance: initial, note }; data.funds.push(newFund); fsSetDoc('funds', newFund.id, newFund); saveData(); document.getElementById('fund-name').value = ''; document.getElementById('fund-initial').value = ''; document.getElementById('fund-note').value = ''; renderFundManagement(); render(); showToast('✅ Đã thêm quỹ: ' + name); }
function deleteFund(id) { if (!confirm('Xóa quỹ này? Các giao dịch liên quan sẽ không bị xóa.')) return; data.funds = data.funds.filter(f=>f.id!==id); fsDeleteDoc('funds', id); saveData(); renderFundManagement(); render(); showToast('🗑️ Đã xóa quỹ'); }
function editFund(id) { document.querySelectorAll('.fund-edit-form').forEach(el => el.classList.remove('open')); const form = document.getElementById('fund-edit-form-' + id); if (form) form.classList.add('open'); }
function saveFundEdit(id) { const nameEl = document.getElementById('fund-edit-name-' + id); const balEl = document.getElementById('fund-edit-bal-' + id); const noteEl = document.getElementById('fund-edit-note-' + id); const name = nameEl.value.trim(); const initialBalance = parseInt(balEl.value) || 0; const note = noteEl ? noteEl.value.trim() : ''; if (!name) { showToast('⚠️ Tên quỹ không được để trống'); return; } const idx = data.funds.findIndex(f => f.id === id); if (idx !== -1) { data.funds[idx].name = name; data.funds[idx].initialBalance = initialBalance; data.funds[idx].balance = initialBalance; data.funds[idx].note = note; fsSetDoc('funds', id, data.funds[idx]); } saveData(); renderFundManagement(); render(); showToast('✅ Đã cập nhật quỹ'); }
function cancelFundEdit(id) { const form = document.getElementById('fund-edit-form-' + id); if (form) form.classList.remove('open'); }
function renderFundManagement() { const el = document.getElementById('fund-management-list'); const generalBal = getGeneralFundBalance(); const generalVisible = data.generalFundVisible !== false; let html = `<div class="fund-row ${generalVisible ? '' : 'fund-row-hidden'}"><div class="fund-row-info"><div class="fund-row-name">Quỹ chung</div><div class="fund-row-bal">Số dư: <strong style="${generalBal < 0 ? 'color:var(--danger)' : 'color:var(--success)'}">${fmtMoneyFull(generalBal)}</strong></div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">Giao dịch không gắn quỹ cụ thể</div></div><div class="fund-row-actions"><button class="fund-vis-btn ${generalVisible ? 'on' : 'off'}" onclick="toggleGeneralFundVisibility()" title="${generalVisible ? 'Đang hiển thị — bấm để ẩn' : 'Đang ẩn — bấm để hiện'}"><span class="material-symbols-outlined" style="font-size:18px">${generalVisible ? 'visibility' : 'visibility_off'}</span></button></div></div>`; if (data.funds.length === 0) { html += `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:8px">Chưa có quỹ nào khác</div>`; el.innerHTML = html; return; } html += data.funds.map(f => { const currentBal = getFundBalance(f.id); const initialBal = f.initialBalance ?? f.balance ?? 0; const balColor = currentBal < 0 ? 'color:var(--danger)' : 'color:var(--success)'; const visible = f.visible !== false; return `<div class="fund-row ${visible ? '' : 'fund-row-hidden'}"><div class="fund-row-info"><div class="fund-row-name">${esc(f.name)}</div><div class="fund-row-bal">Số dư: <strong style="${balColor}">${fmtMoneyFull(currentBal)}</strong> <span style="color:var(--text-muted);font-size:10px"> (gốc: ${fmtMoneyFull(initialBal)})</span></div>${f.note ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">📝 ${esc(f.note)}</div>` : ''}</div><div class="fund-row-actions"><button class="fund-vis-btn ${visible ? 'on' : 'off'}" onclick="toggleFundVisibility('${f.id}')" title="${visible ? 'Đang hiển thị — bấm để ẩn' : 'Đang ẩn — bấm để hiện'}"><span class="material-symbols-outlined" style="font-size:18px">${visible ? 'visibility' : 'visibility_off'}</span></button><button class="tx-action-btn edit" onclick="editFund('${f.id}')" title="Sửa"><span class="material-symbols-outlined" style="font-size:20px">edit</span></button><button class="tx-action-btn del" onclick="deleteFund('${f.id}')" title="Xóa"><span class="material-symbols-outlined" style="font-size:20px">delete</span></button></div></div><div class="fund-edit-form" id="fund-edit-form-${f.id}"><div class="fund-edit-row"><div><div class="form-label">Tên quỹ</div><input class="form-input" id="fund-edit-name-${f.id}" type="text" value="${esc(f.name)}" style="padding:9px 12px;font-size:13px"></div><div><div class="form-label">Số dư ban đầu</div><input class="form-input" id="fund-edit-bal-${f.id}" type="number" value="${initialBal}" style="padding:9px 12px;font-size:13px"></div></div><div style="margin-bottom:8px"><div class="form-label">Ghi chú</div><input class="form-input" id="fund-edit-note-${f.id}" type="text" value="${esc(f.note || '')}" placeholder="Mô tả mục đích quỹ..." style="padding:9px 12px;font-size:13px"></div><div class="fund-edit-btns"><button class="btn btn-primary" style="padding:9px;font-size:13px" onclick="saveFundEdit('${f.id}')">Lưu</button><button class="btn btn-secondary" style="padding:9px;font-size:13px" onclick="cancelFundEdit('${f.id}')">Hủy</button></div></div>`; }).join(''); el.innerHTML = html; }

// ===== SETTINGS =====
function saveNeighborhoodName() { const val = document.getElementById('nb-name-input').value.trim(); if (!val) { showToast('⚠️ Tên không được để trống'); return; } data.neighborhoodName = val; saveData(); fsSaveSettings(); closeModal('nb-modal'); render(); showToast('✅ Đã cập nhật tên khu phố'); }
function confirmClearData() { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được xóa dữ liệu'); return; } if (confirm('⚠️ XÓA TOÀN BỘ DỮ LIỆU?\nHành động này không thể hoàn tác!')) { if (confirm('Xác nhận lần 2: Bạn chắc chắn muốn xóa tất cả?')) { if (currentUser) { data.transactions.forEach(t => fsDeleteDoc('transactions', t.id)); data.funds.forEach(f => fsDeleteDoc('funds', f.id)); data.categories.forEach(c => fsDeleteDoc('categories', c.id)); (pendingProposals || []).forEach(p => fsDeleteDoc('proposals', p.id)); (data.activityLog || []).forEach(l => fsDeleteDoc('activityLog', l.id)); } data.budgets = {}; fsSaveSettings(); localStorage.removeItem('khu_pho_finance'); data = { neighborhoodName: data.neighborhoodName, funds: [], transactions: [], categories: [], budgets: {}, members: data.members || [], activityLog: [], lastUpdated: null }; saveData(); render(); showToast('🗑️ Đã xóa toàn bộ dữ liệu'); } } }

// ===== REPORT NAVIGATION =====
function prevMonth() { reportMonth.setMonth(reportMonth.getMonth()-1); renderReport(); }
function nextMonth() { const now = new Date(); if (reportMonth.getFullYear() > now.getFullYear() || (reportMonth.getFullYear() === now.getFullYear() && reportMonth.getMonth() >= now.getMonth())) { showToast('⚠️ Đã ở tháng hiện tại'); return; } reportMonth.setMonth(reportMonth.getMonth()+1); renderReport(); }

// ===== EXPORT / IMPORT =====
function exportJSON() { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; const d = new Date(); a.download = `khu_pho_backup_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`; a.click(); URL.revokeObjectURL(url); showToast('✅ Đã xuất file backup'); }
function importJSON(event) { const file = event.target.files[0]; if (!file) return; if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được nhập dữ liệu'); event.target.value=''; return; } const reader = new FileReader(); reader.onload = async function(e) { try { const imported = JSON.parse(e.target.result); if (!imported.transactions || !imported.funds) throw new Error('Invalid format'); if (!confirm('Nhập dữ liệu sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại trên đám mây. Tiếp tục?')) return; showToast('⏳ Đang nhập & đồng bộ lên đám mây...'); data.transactions.forEach(t => fsDeleteDoc('transactions', t.id)); data.funds.forEach(f => fsDeleteDoc('funds', f.id)); data.categories.forEach(c => fsDeleteDoc('categories', c.id)); data.funds = (imported.funds || []).map(f => ({ ...f, id: f.id || uid() })); data.transactions = (imported.transactions || []).map(t => ({ ...t, id: t.id || uid() })); data.categories = (imported.categories || []).map(c => ({ ...c, id: c.id || uid() })); data.budgets = imported.budgets || {}; if (imported.neighborhoodName) data.neighborhoodName = imported.neighborhoodName; data.funds.forEach(f => fsSetDoc('funds', f.id, f)); data.categories.forEach(c => fsSetDoc('categories', c.id, c)); data.transactions.forEach(t => fsSetDoc('transactions', t.id, t)); await fsSaveSettings(); saveData(); render(); showToast('✅ Đã nhập & đồng bộ ' + data.transactions.length + ' giao dịch'); } catch(err) { console.error(err); showToast('❌ File không hợp lệ'); } }; reader.readAsText(file); event.target.value = ''; }

// ===== PWA =====
let deferredInstallPrompt = null, pwaInstalled = false;
function getPwaIconSVG(size) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${size*0.22}" fill="#FF8C00"/><rect x="${size*0.18}" y="${size*0.18}" width="${size*0.64}" height="${size*0.64}" rx="${size*0.1}" fill="rgba(255,255,255,0.15)"/><text x="50%" y="57%" font-size="${size*0.5}" font-family="serif" fill="white" text-anchor="middle" dominant-baseline="middle">💰</text></svg>`; }
function svgToDataURI(svg) { return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); }
function injectPWAManifest() { if (location.protocol.startsWith('http')) return; const icon192 = svgToDataURI(getPwaIconSVG(192)); const icon512 = svgToDataURI(getPwaIconSVG(512)); const manifest = { name: 'Quản Lý Tài Chính Ấp', short_name: 'Tài Chính Ấp', description: 'Ứng dụng quản lý tài chính ấp – thu chi, báo cáo, đồng bộ đám mây Firebase', start_url: window.location.href, display: 'standalone', orientation: 'portrait', background_color: '#FF8C00', theme_color: '#FF8C00', lang: 'vi', categories: ['finance', 'productivity'], icons: [{ src: icon192, sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' }, { src: icon512, sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }], screenshots: [] }; const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }); const url = URL.createObjectURL(blob); document.getElementById('pwa-manifest').href = url; const iconEl = document.getElementById('apple-touch-icon'); if (iconEl) iconEl.href = icon192; const faviconEl = document.getElementById('favicon-svg'); if (faviconEl) faviconEl.href = svgToDataURI(getPwaIconSVG(32)); }
function registerServiceWorker() { if (!('serviceWorker' in navigator)) return; if (location.protocol.startsWith('http')) { navigator.serviceWorker.register('./sw.js', { scope: './' }).then(reg => { console.log('[PWA] SW registered:', reg.scope); updatePWAStatusUI(); }).catch(err => { console.warn('[PWA] sw.js lỗi', err); registerServiceWorkerBlob(); }); } else registerServiceWorkerBlob(); }
function registerServiceWorkerBlob() { const swCode = `const CACHE='khu-pho-finance-v6';self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;if(/firestore|firebase|googleapis\\.com\\/.*firebase|identitytoolkit/.test(e.request.url))return;e.respondWith(caches.match(e.request).then(cached=>{if(cached)return cached;return fetch(e.request).then(resp=>{if(!resp||resp.status!==200||resp.type==='opaque')return resp;const clone=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,clone));return resp;}).catch(()=>cached||new Response('Offline',{status:503}))}));});`; const blob = new Blob([swCode], { type: 'application/javascript' }); const url = URL.createObjectURL(blob); navigator.serviceWorker.register(url, { scope: './' }).then(reg => { console.log('[PWA] SW (blob) registered:', reg.scope); updatePWAStatusUI(); }).catch(err => console.warn('[PWA] SW failed', err)); }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; const dismissed = localStorage.getItem('pwa_banner_dismissed'); if (!dismissed && !pwaInstalled) setTimeout(() => document.getElementById('pwa-banner').classList.add('show'), 2000); updatePWAStatusUI(); });
window.addEventListener('appinstalled', () => { pwaInstalled = true; deferredInstallPrompt = null; document.getElementById('pwa-banner').classList.remove('show'); updatePWAStatusUI(); showToast('🎉 Ứng dụng đã được cài đặt!'); });
function installPWA() { if (!deferredInstallPrompt) { showPwaGuide(); return; } deferredInstallPrompt.prompt(); deferredInstallPrompt.userChoice.then(result => { if (result.outcome === 'accepted') { showToast('🎉 Đang cài đặt...'); document.getElementById('pwa-banner').classList.remove('show'); } deferredInstallPrompt = null; updatePWAStatusUI(); }); }
function dismissBanner() { document.getElementById('pwa-banner').classList.remove('show'); localStorage.setItem('pwa_banner_dismissed', '1'); }
function showPwaGuide() { document.getElementById('pwa-guide-modal').classList.add('open'); }
function updatePWAStatusUI() { const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || document.referrer.includes('android-app://'); const modeText = document.getElementById('pwa-mode-text'); const badge = document.getElementById('pwa-status-badge'); const installBtn = document.getElementById('pwa-install-settings-btn'); const installBtnText = document.getElementById('pwa-install-btn-text'); if (isStandalone) { pwaInstalled = true; if (modeText) modeText.textContent = 'Đang chạy ở chế độ ứng dụng độc lập'; if (badge) { badge.textContent = '✓ Đã cài đặt'; badge.className = 'pwa-status-badge installed'; } if (installBtn) { installBtn.disabled = true; installBtnText.textContent = 'Đã cài đặt trên thiết bị'; } } else if (deferredInstallPrompt) { if (modeText) modeText.textContent = 'Chưa cài đặt – sẵn sàng thêm vào màn hình'; if (badge) { badge.textContent = 'Trình duyệt'; badge.className = 'pwa-status-badge browser'; } if (installBtn) { installBtn.disabled = false; installBtnText.textContent = 'Thêm vào màn hình chính'; } } else { if (modeText) modeText.textContent = 'Xem hướng dẫn để cài đặt thủ công'; if (badge) { badge.textContent = 'Trình duyệt'; badge.className = 'pwa-status-badge browser'; } if (installBtn) { installBtn.disabled = false; installBtnText.textContent = 'Xem hướng dẫn cài đặt'; } } }

// Dark mode toggle (P1)
function toggleDarkMode() { const html = document.documentElement; const isDark = html.getAttribute('data-theme') === 'dark'; if (isDark) { html.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); } else { html.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); } }
function initTheme() { const saved = localStorage.getItem('theme'); if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); }

// ===== CSV EXPORT =====
function openExportModal() { updateCSVPreview(); document.getElementById('export-modal').classList.add('open'); }
function updateCSVPreview() { const rows = buildCSVRows(); const preview = rows.slice(0, 4).map(r => r.join(',')).join('\n'); document.getElementById('csv-preview-box').textContent = preview + (rows.length > 4 ? '\n...' : ''); }
function buildCSVRows() { const range = document.getElementById('csv-range').value; const inclDate = document.getElementById('csv-col-date').checked, inclName = document.getElementById('csv-col-name').checked, inclType = document.getElementById('csv-col-type').checked, inclAmount = document.getElementById('csv-col-amount').checked, inclFund = document.getElementById('csv-col-fund').checked, inclNote = document.getElementById('csv-col-note').checked; const headers = []; if (inclDate) headers.push('Ngày'); if (inclName) headers.push('Tên giao dịch'); if (inclType) headers.push('Loại'); if (inclAmount) headers.push('Số tiền (VND)'); if (inclFund) headers.push('Quỹ'); if (inclNote) headers.push('Ghi chú'); let txs = [...data.transactions].sort((a,b) => new Date(b.date) - new Date(a.date)); if (range === 'month') { const now = new Date(); txs = txs.filter(t => { const d = new Date(t.date); return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear(); }); } else if (range === 'income') txs = txs.filter(t => t.type === 'income'); else if (range === 'expense') txs = txs.filter(t => t.type === 'expense'); const rows = [headers]; txs.forEach(t => { const fundName = t.fund ? (fundMap.get(t.fund)?.name||'Quỹ chung') : 'Quỹ chung'; const row = []; if (inclDate) row.push(t.date); if (inclName) row.push(`"${t.name.replace(/"/g,'""')}"`); if (inclType) row.push(t.type==='income'?'Thu nhập':'Chi phí'); if (inclAmount) row.push(t.type==='income'?t.amount:-t.amount); if (inclFund) row.push(`"${fundName}"`); if (inclNote) row.push(`"${(t.note||'').replace(/"/g,'""')}"`); rows.push(row); }); const totalIncome = txs.filter(t=>t.type==='income').reduce((s,t)=>s+t.amount,0); const totalExpense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0); if (inclAmount && txs.length) { rows.push([]); const blankPad = (n) => Array(n).fill(''); rows.push([...blankPad(inclDate?1:0), '"Tổng thu"', ...(inclType?['']:[] ), totalIncome]); rows.push([...blankPad(inclDate?1:0), '"Tổng chi"', ...(inclType?['']:[] ), -totalExpense]); rows.push([...blankPad(inclDate?1:0), '"Số dư"', ...(inclType?['']:[] ), totalIncome-totalExpense]); } return rows; }
function doExportCSV() { const rows = buildCSVRows(); const bom = '﻿'; const csv = bom + rows.map(r => r.join(',')).join('\r\n'); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; const d = new Date(); const range = document.getElementById('csv-range').value; a.download = `tai_chinh_${range}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.csv`; a.click(); URL.revokeObjectURL(url); closeModal('export-modal'); showToast('✅ Đã xuất file CSV'); }
function exportCSVMonth() { const m = reportMonth.getMonth(), y = reportMonth.getFullYear(); const txs = data.transactions.filter(t => { const d = new Date(t.date); return d.getMonth()===m && d.getFullYear()===y; }).sort((a,b) => new Date(b.date)-new Date(a.date)); const bom = '﻿'; const headers = ['Ngày','Tên giao dịch','Loại','Số tiền (VND)','Quỹ','Ghi chú']; const rows = [headers, ...txs.map(t => { const fn = t.fund?(fundMap.get(t.fund)?.name||'Quỹ chung'):'Quỹ chung'; return [t.date,`"${t.name}"`,t.type==='income'?'Thu nhập':'Chi phí',t.type==='income'?t.amount:-t.amount,`"${fn}"`,`"${t.note||''}"`]; })]; const csv = bom + rows.map(r=>r.join(',')).join('\r\n'); const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `bao_cao_T${m+1}_${y}.csv`; a.click(); URL.revokeObjectURL(url); showToast(`✅ Đã xuất CSV tháng ${m+1}/${y}`); }
function exportExcelMonth() { if (typeof XLSX === 'undefined') { showToast('⚠️ Chưa tải được thư viện Excel — dùng CSV'); exportCSVMonth(); return; } const m = reportMonth.getMonth(), y = reportMonth.getFullYear(); const { income, expense, txs } = getMonthStats(reportMonth); const sorted = [...txs].sort((a,b) => parseLocalDate(a.date) - parseLocalDate(b.date)); const aoa = [[`Báo cáo thu chi - ${data.neighborhoodName}`], [`Tháng ${m+1}/${y}`, '', '', '', `Xuất: ${new Date().toLocaleString('vi-VN')}`], [], ['Ngày', 'Tên giao dịch', 'Loại', 'Số tiền (VND)', 'Quỹ', 'Danh mục', 'Ghi chú']]; sorted.forEach(t => { const fn = t.fund ? (fundMap.get(t.fund)?.name || 'Quỹ chung') : 'Quỹ chung'; const cat = t.category ? (catMap.get(t.category)?.name || '') : ''; aoa.push([t.date, t.name, t.type==='income'?'Thu nhập':'Chi phí', t.type==='income'?t.amount:-t.amount, fn, cat, t.note||'']); }); aoa.push([]); aoa.push(['', '', 'Tổng thu', income]); aoa.push(['', '', 'Tổng chi', -expense]); aoa.push(['', '', 'Số dư', income - expense]); const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{wch:12},{wch:30},{wch:10},{wch:16},{wch:16},{wch:16},{wch:24}]; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, `T${m+1}-${y}`); XLSX.writeFile(wb, `bao_cao_T${m+1}_${y}.xlsx`); showToast(`✅ Đã xuất Excel tháng ${m+1}/${y}`); }

// ===== RECEIPT PDF =====
function openReceiptModal() { const sel = document.getElementById('receipt-tx-select'); const sorted = [...data.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)); sel.innerHTML = '<option value="">-- Chọn giao dịch --</option>' + sorted.map(t=>{ const sign=t.type==='income'?'+':'-'; return `<option value="${t.id}">[${receiptSerial(t)}] ${fmtDate(t.date)} | ${esc(t.name)} | ${sign}${fmtMoneyFull(t.amount)}</option>`; }).join(''); sel.onchange = updateReceiptPreview; document.getElementById('receipt-author').oninput = updateReceiptPreview; document.getElementById('receipt-extra-note').oninput = updateReceiptPreview; document.getElementById('receipt-preview').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Chọn giao dịch để xem trước phiếu</div>'; document.getElementById('receipt-modal').classList.add('open'); }
function updateReceiptPreview() { const id = document.getElementById('receipt-tx-select').value; if (!id) { document.getElementById('receipt-preview').innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Chọn giao dịch để xem trước phiếu</div>'; return; } const t = data.transactions.find(x=>x.id===id); if (!t) return; const author = document.getElementById('receipt-author').value; const extraNote = document.getElementById('receipt-extra-note').value; const serial = receiptSerial(t); const html = receiptHTML(t,author,extraNote,serial); const encoded = html.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); document.getElementById('receipt-preview').innerHTML = `<iframe srcdoc="${encoded}" style="width:520px;height:700px;border:none;transform:scale(0.38);transform-origin:top left;pointer-events:none" scrolling="no"></iframe>`; }
function printReceiptPDF() { const id = document.getElementById('receipt-tx-select').value; if (!id) { showToast('⚠️ Vui lòng chọn giao dịch'); return; } const t = data.transactions.find(x=>x.id===id); if (!t) return; const author = document.getElementById('receipt-author').value; const extraNote = document.getElementById('receipt-extra-note').value; const serial = receiptSerial(t); const html = receiptHTML(t,author,extraNote,serial,true); const win = window.open('','_blank','width=600,height=800'); if (win) { win.document.write(html); win.document.close(); closeModal('receipt-modal'); showToast('🖨️ Đang mở cửa sổ in phiếu PDF...'); } else { showToast('⚠️ Trình duyệt đã chặn popup'); } }

// ===== LOOKUP =====
function openLookupModal() { const input = document.getElementById('lookup-code-input'); input.value = ''; document.getElementById('lookup-result').innerHTML = ''; document.getElementById('lookup-modal').classList.add('open'); input.onkeydown = (e) => { if (e.key === 'Enter') doLookupReceipt(); }; setTimeout(() => input.focus(), 250); }
function doLookupReceipt() { const raw = document.getElementById('lookup-code-input').value; const resultEl = document.getElementById('lookup-result'); if (!normalizeReceiptCode(raw)) { resultEl.innerHTML = `<div class="lookup-empty"><span class="material-symbols-outlined">search</span>Vui lòng nhập mã phiếu cần tra cứu</div>`; return; } const t = findTxByReceiptCode(raw); if (!t) { resultEl.innerHTML = `<div class="lookup-empty"><span class="material-symbols-outlined">error_outline</span>Không tìm thấy giao dịch nào với mã "<strong>${esc(normalizeReceiptCode(raw))}</strong>".<br>Vui lòng kiểm tra lại mã in trên phiếu.</div>`; return; } const fundName = t.fund ? (fundMap.get(t.fund)?.name || 'Quỹ chung') : 'Quỹ chung'; const cat = t.category ? catMap.get(t.category) : null; const isIncome = t.type === 'income'; const sign = isIncome ? '+' : '-'; resultEl.innerHTML = `<div class="lookup-result-card ${t.type}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span class="receipt-code-chip" onclick="copyReceiptCode('${receiptSerial(t)}')" title="Bấm để sao chép">${receiptSerial(t)} <span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">content_copy</span></span><span class="detail-type-badge ${t.type}">${isIncome ? 'Phiếu thu' : 'Phiếu chi'}</span></div><div style="font-size:22px;font-weight:800;color:${isIncome?'var(--success)':'var(--danger)'};margin-bottom:12px">${sign}${fmtMoneyFull(t.amount)}</div><div class="detail-row"><span class="detail-label">Nội dung</span><span class="detail-value">${esc(t.name)}</span></div><div class="detail-row"><span class="detail-label">Ngày</span><span class="detail-value">${fmtDate(t.date)}</span></div><div class="detail-row"><span class="detail-label">Quỹ</span><span class="detail-value">${esc(fundName)}</span></div>${cat ? `<div class="detail-row"><span class="detail-label">Danh mục</span><span class="detail-value">${esc(cat.icon)} ${esc(cat.name)}</span></div>` : ''}${t.note ? `<div class="detail-row"><span class="detail-label">Ghi chú</span><span class="detail-value" style="color:var(--text-muted)">${esc(t.note)}</span></div>` : ''}${t.createdByName ? `<div class="detail-row"><span class="detail-label">Người tạo</span><span class="detail-value">${esc(t.createdByName)}</span></div>` : ''}</div><p style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:10px">✅ Giao dịch này khớp với dữ liệu thu chi hiện có của ${esc(data.neighborhoodName || 'khu phố')}.</p>`; }
function exportReportPDF() { const m = reportMonth.getMonth(), y = reportMonth.getFullYear(); const { income, expense, txs } = getMonthStats(reportMonth); const html = reportPDFHTML(income, expense, txs, m, y); const win = window.open('','_blank','width=900,height=900'); if (win) { win.document.write(html); win.document.close(); showToast('🖨️ Đang xuất báo cáo PDF...'); } else { showToast('⚠️ Trình duyệt đã chặn popup'); } }

// ===== ACTIVITY LOG =====
let activityFilter = 'all';
function openActivityModal() { activityFilter = 'all'; document.querySelectorAll('#activity-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.af === 'all')); renderActivityLog(); document.getElementById('activity-modal').classList.add('open'); }
function filterActivity(f) { activityFilter = f; document.querySelectorAll('#activity-filter-bar .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.af === f)); renderActivityLog(); }
function renderActivityLog() { const list = document.getElementById('activity-list'); if (!list) return; let logs = [...(data.activityLog || [])].sort((a,b) => new Date(b.at) - new Date(a.at)); if (activityFilter !== 'all') logs = logs.filter(l => l.action === activityFilter); if (logs.length === 0) { list.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">history</span><p>Chưa có hoạt động nào</p></div>`; return; } const meta = { create: { icon:'add_circle', color:'var(--success)', bg:'#E8F7F0', label:'Đã thêm' }, edit: { icon:'edit', color:'var(--info)', bg:'#EBF3FF', label:'Đã sửa' }, delete: { icon:'delete', color:'var(--danger)', bg:'#FEF0F0', label:'Đã xóa' }, restore: { icon:'restore', color:'#7C3AED', bg:'#F3E8FF', label:'Đã phục hồi' } }; const admin = isAdmin(); list.innerHTML = logs.slice(0, 200).map(l => { const m = meta[l.action] || meta.edit; const sign = l.txType === 'income' ? '+' : (l.txType === 'expense' ? '-' : ''); const canRestore = l.action === 'delete' && l.snapshot && !l.restored && !data.transactions.some(t => t.id === (l.snapshot.id || l.txId)); const editInfo = (l.action === 'edit' && l.before) ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">Trước: ${esc(l.before.name||'')} · ${(Number(l.before.amount)||0).toLocaleString('vi-VN')}đ</div>` : ''; const viaInfo = l.via ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${esc(l.via)}</div>` : ''; const restoredInfo = (l.action === 'delete' && l.restored) ? `<div style="font-size:10px;color:var(--success);margin-top:3px">♻️ Đã phục hồi</div>` : ''; return `<div style="display:flex;gap:10px;padding:11px 0;border-bottom:1px solid var(--border)"><div style="width:34px;height:34px;border-radius:50%;background:${m.bg};color:${m.color};display:flex;align-items:center;justify-content:center;flex-shrink:0"><span class="material-symbols-outlined" style="font-size:19px">${m.icon}</span></div><div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700">${m.label}: <span style="font-weight:600">${esc(l.txName || '(không tên)')}</span></div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sign}${(l.amount||0).toLocaleString('vi-VN')}đ · ${esc(l.byName)} · ${activityWhen(l.at)}</div>${editInfo}${viaInfo}${restoredInfo}</div>${canRestore && admin ? `<button onclick="restoreTx('${l.id}')" style="align-self:center;flex-shrink:0;padding:7px 12px;background:#F3E8FF;color:#7C3AED;border:none;border-radius:8px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px"><span class="material-symbols-outlined" style="font-size:16px">restore</span>Phục hồi</button>` : ''}</div>`; }).join(''); }
async function restoreTx(logId) { if (!isAdmin()) { showToast('⚠️ Chỉ Thủ quỹ mới được phục hồi'); return; } const entry = (data.activityLog || []).find(l => l.id === logId); if (!entry || entry.action !== 'delete' || !entry.snapshot) { showToast('⚠️ Không có dữ liệu để phục hồi'); return; } const snap = entry.snapshot; if (data.transactions.some(t => t.id === snap.id)) { showToast('⚠️ Giao dịch đã tồn tại'); return; } if (!confirm(`Phục hồi giao dịch "${snap.name || ''}"?`)) return; const tx = { ...snap, restoredAt: new Date().toISOString(), restoredBy: currentUser?.email || '' }; data.transactions.push(tx); knownTxIds.add(tx.id); await fsSetDoc('transactions', tx.id, tx); logActivity('restore', tx); entry.restored = true; await fsSetDoc('activityLog', entry.id, { restored: true, restoredAt: new Date().toISOString(), restoredBy: currentUser?.email || '' }); saveData(); render(); renderActivityLog(); showToast('♻️ Đã phục hồi giao dịch'); }

// ===== MEMBERS =====
function openMembersModal() {
  renderMembersList();
  document.getElementById('members-modal').classList.add('open');
}

function renderMembersList() {
  const list = document.getElementById('members-list');
  const myRole = currentNeighborhood?.role || 'viewer';
  const myInfo = getRoleInfo(myRole);
  const userIsAdmin = myRole === 'admin';

  // 1. Hiển thị thông tin người dùng hiện tại (bản thân) với đúng nhãn vai trò thực tế
  const meItem = `
    <div class="member-item current-user-item" style="background:var(--bg);padding:12px;border-radius:12px;margin-bottom:12px;border:1.5px solid var(--border)">
      <div class="member-avatar">
        ${currentUser?.photoURL ? `<img src="${esc(currentUser.photoURL)}" style="width:100%;height:100%;object-fit:cover">` : '👤'}
      </div>
      <div class="member-info">
        <div class="member-name">
          ${esc(currentUser?.displayName || 'Bạn')} 
          <span style="font-size:11px;color:var(--text-muted);font-weight:600">(Bạn)</span>
        </div>
        <div class="member-email">${esc(currentUser?.email || '')}</div>
      </div>
      <span class="role-badge ${myInfo.badgeClass}">${myInfo.badgeFullText}</span>
    </div>
  `;

  // 2. Hiển thị danh sách các thành viên khác trong khu phố
  let memberItems = '';
  if (!data.members || data.members.length === 0) {
    memberItems = `
      <div style="text-align:center;padding:16px 8px;font-size:12px;color:var(--text-muted)">
        Chưa có thành viên nào khác trong khu phố này.
      </div>
    `;
  } else {
    memberItems = data.members.map(m => {
      const mRole = m.role || 'viewer';
      const mInfo = getRoleInfo(mRole);
      const docKey = m.id || m.uid || m.email;

      let actionControl = '';
      if (userIsAdmin) {
        // Thủ quỹ có quyền thay đổi vai trò hoặc xóa thành viên
        actionControl = `
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <select onchange="changeMemberRole('${esc(docKey)}', this.value)" style="font-size:11px;font-weight:600;border:1px solid var(--border);border-radius:8px;padding:5px 8px;font-family:inherit;background:white;cursor:pointer">
              <option value="admin" ${mRole==='admin'?'selected':''}>🔑 Thủ quỹ (Toàn quyền)</option>
              <option value="member" ${mRole==='member'?'selected':''}>👤 Thành viên (Thêm GD)</option>
              <option value="viewer" ${mRole==='viewer'?'selected':''}>👁️ Người xem (Chỉ đọc)</option>
            </select>
            <button onclick="removeMember('${esc(docKey)}')" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:11px;font-weight:600;font-family:inherit;padding:2px 4px">Xóa</button>
          </div>
        `;
      } else {
        // Thành viên hoặc người xem chỉ thấy nhãn vai trò
        actionControl = `
          <span class="role-badge ${mInfo.badgeClass}">${mInfo.badgeFullText}</span>
        `;
      }

      return `
        <div class="member-item">
          <div class="member-avatar">
            ${m.photoURL ? `<img src="${esc(m.photoURL)}" style="width:100%;height:100%;object-fit:cover">` : esc(m.name?.[0]||'?')}
          </div>
          <div class="member-info">
            <div class="member-name">${esc(m.name || 'Thành viên mới (chưa đăng nhập)')}</div>
            <div class="member-email">${esc(m.email || '')}</div>
          </div>
          ${actionControl}
        </div>
      `;
    }).join('');
  }

  list.innerHTML = meItem + '<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.5px">Thành viên khác</div>' + memberItems;

  // Ẩn/hiện khối Mời thành viên mới (chỉ Thủ quỹ mới thấy)
  const inviteBox = document.getElementById('invite-member-section');
  if (inviteBox) {
    inviteBox.style.display = userIsAdmin ? 'block' : 'none';
  }
}

async function inviteMember() {
  const email = document.getElementById('invite-email').value.trim();
  const role = document.getElementById('invite-role').value;
  if (!email || !email.includes('@')) { showToast('⚠️ Email không hợp lệ'); return; }
  if (data.members.find(m => m.email && m.email.toLowerCase() === email.toLowerCase())) { showToast('⚠️ Thành viên đã tồn tại'); return; }
  if (currentUser?.email && email.toLowerCase() === currentUser.email.toLowerCase()) { showToast('⚠️ Đó là chính tài khoản của bạn!'); return; }
  if (currentNeighborhood?.role !== 'admin') { showToast('⚠️ Chỉ Thủ quỹ mới được mời thành viên'); return; }

  const cleanDocId = email.replace(/[.#$/\[\]]/g, '_');
  const newMember = { uid: email, email, name: '', role, photoURL: '', invitedAt: new Date().toISOString(), invitedBy: currentUser.email };
  data.members.push({ id: cleanDocId, ...newMember });
  await fsSetDoc('members', cleanDocId, newMember);
  saveData();
  document.getElementById('invite-email').value = '';
  renderMembersList();
  renderSettings();
  showToast('✅ Đã gửi lời mời đến ' + email);
}

async function removeMember(docKey) {
  if (currentNeighborhood?.role !== 'admin') { showToast('⚠️ Chỉ Thủ quỹ mới có quyền xóa thành viên'); return; }
  const m = data.members.find(x => x.id === docKey || x.uid === docKey || x.email === docKey);
  if (!m) return;
  if (!confirm(`Xóa thành viên "${m.name || m.email}" khỏi khu phố?`)) return;

  const targetDocId = m.id || (m.uid && !m.uid.includes('@') ? m.uid : m.email.replace(/[.#$/\[\]]/g, '_'));
  data.members = data.members.filter(x => x !== m);
  await fsDeleteDoc('members', targetDocId);
  saveData();
  renderMembersList();
  renderSettings();
  showToast('🗑️ Đã xóa thành viên khỏi khu phố');
}

async function changeMemberRole(docKey, role) {
  if (currentNeighborhood?.role !== 'admin') { showToast('⚠️ Chỉ Thủ quỹ mới có quyền đổi vai trò'); return; }
  const m = data.members.find(x => x.id === docKey || x.uid === docKey || x.email === docKey);
  if (!m) { showToast('⚠️ Không tìm thấy thành viên'); return; }

  m.role = role;
  const targetDocId = m.id || (m.uid && !m.uid.includes('@') ? m.uid : m.email.replace(/[.#$/\[\]]/g, '_'));
  await fsSetDoc('members', targetDocId, { ...m, role });
  saveData();
  renderMembersList();
  renderSettings();
  showToast(`✅ Đã đổi vai trò thành: ${getRoleInfo(role).badgeFullText}`);
}

// ===== CATEGORIES =====
const CAT_COLORS = [{ bg:'#FFF3E0', text:'#E07800' }, { bg:'#E8F7F0', text:'#1A7A4A' }, { bg:'#EBF3FF', text:'#1A54A8' }, { bg:'#FEF0F0', text:'#B02020' }, { bg:'#F3E8FF', text:'#6B21A8' }, { bg:'#FFF9E0', text:'#92700A' }, { bg:'#E0F7FA', text:'#00838F' }, { bg:'#FCE4EC', text:'#AD1457' }, { bg:'#E8F5E9', text:'#2E7D32' }, { bg:'#F3E5F5', text:'#7B1FA2' }];
function openCategoryModal() { renderCategoryList(); document.getElementById('new-cat-name').value = ''; document.getElementById('category-modal').classList.add('open'); }
function renderCategoryList() { const list = document.getElementById('category-list'); if (data.categories.length === 0) { list.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:12px">Chưa có danh mục nào</div>`; return; } list.innerHTML = data.categories.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:20px">${esc(c.icon)}</span><span style="flex:1;font-size:13px;font-weight:600">${esc(c.name)}</span><span class="cat-badge" style="background:${c.color};color:${c.textColor}">Mẫu</span><button onclick="deleteCategory('${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--danger);padding:4px"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button></div>`).join(''); }
function addCategory() { const name = document.getElementById('new-cat-name').value.trim(); const icon = document.getElementById('new-cat-icon').value; if (!name) { showToast('⚠️ Vui lòng nhập tên danh mục'); return; } const colorIdx = data.categories.length % CAT_COLORS.length; const newCat = { id: uid(), name, icon, color: CAT_COLORS[colorIdx].bg, textColor: CAT_COLORS[colorIdx].text }; data.categories.push(newCat); fsSetDoc('categories', newCat.id, newCat); saveData(); renderCategoryList(); renderSettings(); document.getElementById('new-cat-name').value = ''; showToast('✅ Đã thêm danh mục: ' + name); }
function deleteCategory(id) { if (!confirm('Xóa danh mục này? Các giao dịch liên quan sẽ mất phân loại.')) return; data.categories = data.categories.filter(c=>c.id!==id); fsDeleteDoc('categories', id); delete data.budgets[id]; fsSaveSettings(); saveData(); renderCategoryList(); renderSettings(); showToast('🗑️ Đã xóa danh mục'); }

// ===== BUDGET =====
function openBudgetModal() { renderBudgetList(); document.getElementById('budget-modal').classList.add('open'); }
function renderBudgetList() { const list = document.getElementById('budget-list'); if (data.categories.length === 0) { list.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:12px">Chưa có danh mục nào. Hãy thêm danh mục trước.</div>`; return; } const now = new Date(); list.innerHTML = data.categories.map(c => { const budget = data.budgets[c.id]?.monthly || 0; const spent = data.transactions.filter(t => t.type==='expense' && t.category===c.id && new Date(t.date).getMonth()===now.getMonth() && new Date(t.date).getFullYear()===now.getFullYear()).reduce((s,t)=>s+t.amount, 0); const pct = budget > 0 ? Math.min(Math.round(spent/budget*100), 100) : 0; const fillClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe'; return `<div style="padding:12px 0;border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-size:13px;font-weight:600">${esc(c.icon)} ${esc(c.name)}</span>${budget > 0 ? `<span style="font-size:11px;color:${pct>=100?'var(--danger)':pct>=80?'#F59E0B':'var(--success)'};font-weight:700">${pct}%</span>` : ''}</div><div style="display:flex;gap:8px;align-items:center"><input type="number" min="0" placeholder="Hạn mức chi/tháng (VND)" value="${budget || ''}" onchange="saveBudget('${c.id}', this.value)" style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:12px;outline:none"></div>${budget > 0 ? `<div class="budget-bar-wrap" style="margin-top:8px"><div class="budget-bar-bg"><div class="budget-bar-fill ${fillClass}" style="width:${pct}%"></div></div><div class="budget-label"><span>Đã chi: ${fmtMoneyFull(spent)}</span><span>Còn: ${fmtMoneyFull(Math.max(budget-spent,0))}</span></div></div>` : ''}</div>`; }).join(''); }
function saveBudget(catId, val) { const amount = parseInt(val) || 0; if (amount > 0) { if (!data.budgets) data.budgets = {}; data.budgets[catId] = { monthly: amount }; } else { delete data.budgets[catId]; } fsSaveSettings(); saveData(); renderSettings(); renderBudgetDashboard(); }
function renderBudgetDashboard() { const section = document.getElementById('budget-overview-section'); const list = document.getElementById('budget-overview-list'); const budgetCats = data.categories.filter(c => data.budgets[c.id]); if (budgetCats.length === 0) { section.style.display='none'; return; } section.style.display = 'block'; const now = new Date(); list.innerHTML = budgetCats.map(c => { const budget = data.budgets[c.id].monthly; const spent = data.transactions.filter(t => t.type==='expense' && t.category===c.id && new Date(t.date).getMonth()===now.getMonth() && new Date(t.date).getFullYear()===now.getFullYear()).reduce((s,t)=>s+t.amount, 0); const pct = Math.min(Math.round(spent/budget*100), 100); const fillClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'safe'; const warnIcon = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢'; return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;font-weight:600">${warnIcon} ${esc(c.icon)} ${esc(c.name)}</span><span style="font-size:11px;color:var(--text-muted)">${fmtMoneyFull(spent)} / ${fmtMoneyFull(budget)}</span></div><div class="budget-bar-bg"><div class="budget-bar-fill ${fillClass}" style="width:${pct}%"></div></div></div>`; }).join(''); }

// ===== NOTIFICATIONS =====
function initKnownTxIds() { knownTxIds = new Set(data.transactions.map(t => t.id)); isFirstLoad = false; }
function checkNewTransactions(newTxs) { if (isFirstLoad) { initKnownTxIds(); return; } newTxs.forEach(t => { if (!knownTxIds.has(t.id) && t.createdBy && t.createdBy !== currentUser?.uid) { const sign = t.type === 'income' ? '+' : '-'; showToast(`🔔 ${t.createdByName || 'Ai đó'} thêm: ${t.name} ${sign}${t.amount.toLocaleString('vi-VN')}đ`); } knownTxIds.add(t.id); }); }

// ===== QR CODE =====
function buildJoinURL(code) { return location.origin + location.pathname + '?join=' + encodeURIComponent(code); }
function openQRModal() { if (!currentNeighborhood) return; const code = currentNeighborhood.joinCode; document.getElementById('qr-code-display').textContent = code; document.getElementById('qr-nb-name-display').textContent = currentNeighborhood.name; drawQRCode(code); document.getElementById('qr-modal').classList.add('open'); }
function drawQRCode(text) { const canvas = document.getElementById('qr-canvas'); const joinUrl = buildJoinURL(text); if (window.QRCode && typeof QRCode.toCanvas === 'function') { QRCode.toCanvas(canvas, joinUrl, { width: 200, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1A1208', light: '#FFFFFF' } }, err => { if (err) console.warn('QR error:', err); }); } else { const ctx = canvas.getContext('2d'); canvas.width = canvas.height = 200; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 200); ctx.fillStyle = '#1A1208'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 20px sans-serif'; ctx.fillText(text, 100, 95); ctx.font = '11px sans-serif'; ctx.fillStyle = '#888'; ctx.fillText('Nhập mã thủ công', 100, 120); } }
function downloadQR() { const canvas = document.getElementById('qr-canvas'); const a = document.createElement('a'); a.download = 'ma-khu-pho-' + (currentNeighborhood?.joinCode || '') + '.png'; a.href = canvas.toDataURL('image/png'); a.click(); showToast('📥 Đã tải ảnh QR!'); }

// ===== LOOKUP =====
function viewFullPhoto(txId) { const t = data.transactions.find(x => x.id === txId); if (!t?.photoURL) return; const overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer'; overlay.innerHTML = `<img src="${t.photoURL}" style="max-width:95vw;max-height:90vh;object-fit:contain;border-radius:8px">`; overlay.onclick = () => document.body.removeChild(overlay); document.body.appendChild(overlay); }

// ===== INIT =====
reportMonth = new Date();
function initApp() {
  initTheme();
  if (!window.fb) { setTimeout(initApp, 100); return; }
  const { auth, onAuthStateChanged } = window.fb;
  onAuthStateChanged(auth, user => {
    if (user) onUserSignedIn(user);
    else { document.getElementById('login-screen').style.display = 'flex'; document.getElementById('nb-picker-screen').style.display = 'none'; document.getElementById('app-loading').style.display = 'none'; }
  });
}
initApp();

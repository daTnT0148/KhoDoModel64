/**
 * auth.js — Firebase Authentication & Firestore config loader
 *
 * Flow:
 *   Page load → Firebase checks auth state
 *   → Not logged in: show login overlay
 *   → Logged in: fetch team config from Firestore → setCloudConfig() → loadData()
 *
 * Team model:
 *   Owner registers → creates team (stores Apps Script URL + Secret Key)
 *   Member registers → enters team code → linked to same team data
 */
(function () {
  'use strict';

  // ── Guard: skip if Firebase SDK not loaded ──────────────────────
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) {
    console.warn('[Auth] Firebase not available, skipping auth layer');
    return;
  }

  // ── Initialize Firebase ─────────────────────────────────────────
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();

  // Persist auth across sessions (default behavior, explicit for clarity)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  // ── State ───────────────────────────────────────────────────────
  let _currentUser = null;
  let _teamId      = null;

  // ── DOM helpers ─────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function showView(viewId) {
    document.querySelectorAll('#authOverlay .auth-view').forEach(v => v.style.display = 'none');
    const el = $(viewId);
    if (el) el.style.display = 'block';

    // Tự động điền Apps Script URL và Secret Key từ env.js nếu có sẵn (không mất công nhập lại)
    if (viewId === 'authSetupView') {
      const urlInput = $('authSetupUrl');
      const keyInput = $('authSetupKey');
      if (urlInput && !urlInput.value && window.ENV?.APPS_SCRIPT_URL) {
        urlInput.value = window.ENV.APPS_SCRIPT_URL;
      }
      if (keyInput && !keyInput.value && window.ENV?.SECRET_KEY) {
        keyInput.value = window.ENV.SECRET_KEY;
      }
    }
  }

  function showError(msg) {
    const el = $('authError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
  }

  function hideError() {
    const el = $('authError');
    if (el) el.style.display = 'none';
  }

  function showLoading(show) {
    const el = $('authLoading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function showOverlay(show) {
    const el = $('authOverlay');
    if (!el) return;
    if (show) el.classList.remove('auth-hidden');
    else      el.classList.add('auth-hidden');
  }

  // ── Auth state listener ─────────────────────────────────────────
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      _currentUser = user;
      showLoading(true);
      hideError();
      try {
        await loadUserConfig(user);
      } catch (err) {
        console.error('[Auth] Config load failed:', err);
        showLoading(false);
        showError('Lỗi tải cấu hình: ' + err.message);
      }
    } else {
      _currentUser = null;
      _teamId = null;
      showOverlay(true);
      showView('authLoginView');
      showLoading(false);
      hideUserDisplay();
    }
  });

  // ── Load user config from Firestore ─────────────────────────────
  async function loadUserConfig(user) {
    const userDoc = await db.collection('users').doc(user.uid).get();

    if (!userDoc.exists || !userDoc.data().teamId) {
      // No team yet — show setup screen
      showLoading(false);
      showOverlay(true);
      showView('authSetupView');
      return;
    }

    const userData = userDoc.data();
    _teamId = userData.teamId;

    // Fetch team config
    const teamDoc = await db.collection('teams').doc(_teamId).get();
    if (!teamDoc.exists) {
      showLoading(false);
      showOverlay(true);
      showError('Không tìm thấy kho. Liên hệ chủ kho.');
      showView('authSetupView');
      return;
    }

    const teamData = teamDoc.data();

    // Inject cloud config into db.js
    if (typeof setCloudConfig === 'function') {
      setCloudConfig(teamData.appsScriptUrl, teamData.secretKey);
    }

    // Update UI
    updateUserDisplay(user, userData, teamData);

    // Hide auth overlay, show app
    showOverlay(false);
    showLoading(false);

    // Reload data from cloud (db.js now has the correct config)
    if (typeof loadData === 'function') {
      await loadData();
    }
    if (typeof refreshApplicationData === 'function') {
      refreshApplicationData();
    }
  }

  // ── Login ───────────────────────────────────────────────────────
  async function login(email, password) {
    showLoading(true);
    hideError();
    try {
      await auth.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged handles the rest
    } catch (err) {
      showLoading(false);
      showError(translateError(err.code));
    }
  }

  // ── Google Sign-In ──────────────────────────────────────────────
  async function loginWithGoogle() {
    showLoading(true);
    hideError();
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
      // onAuthStateChanged handles the rest
    } catch (err) {
      showLoading(false);
      if (err.code !== 'auth/popup-closed-by-user') {
        showError(translateError(err.code));
      }
    }
  }

  // ── Register ────────────────────────────────────────────────────
  async function register(name, email, password) {
    showLoading(true);
    hideError();
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await cred.user.updateProfile({ displayName: name });
      // onAuthStateChanged fires → loadUserConfig → no team → show setup
    } catch (err) {
      showLoading(false);
      showError(translateError(err.code));
    }
  }

  // ── Setup: create new team (owner) ──────────────────────────────
  async function setupOwner(appsScriptUrl, secretKey) {
    if (!_currentUser) return;
    showLoading(true);
    hideError();

    try {
      const teamCode = 'KHO-' + randomCode(5);

      // Create team document
      await db.collection('teams').doc(teamCode).set({
        ownerId:       _currentUser.uid,
        ownerEmail:    _currentUser.email,
        appsScriptUrl: appsScriptUrl,
        secretKey:     secretKey,
        teamCode:      teamCode,
        members:       [_currentUser.uid],
        createdAt:     firebase.firestore.FieldValue.serverTimestamp()
      });

      // Create user document
      await db.collection('users').doc(_currentUser.uid).set({
        email:       _currentUser.email,
        displayName: _currentUser.displayName || '',
        role:        'owner',
        teamId:      teamCode,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });

      _teamId = teamCode;

      // Apply config
      if (typeof setCloudConfig === 'function') {
        setCloudConfig(appsScriptUrl, secretKey);
      }

      // Notify owner of their team code
      alert('Kho đã tạo thành công!\n\nMã kho: ' + teamCode + '\n\nChia sẻ mã này để mời người khác vào kho.');

      updateUserDisplay(_currentUser, { role: 'owner', teamId: teamCode }, { teamCode });
      showOverlay(false);
      showLoading(false);

      if (typeof loadData === 'function') await loadData();
      if (typeof refreshApplicationData === 'function') refreshApplicationData();

    } catch (err) {
      showLoading(false);
      showError('Lỗi tạo kho: ' + err.message);
    }
  }

  // ── Setup: join existing team (member) ──────────────────────────
  async function joinTeam(teamCode) {
    if (!_currentUser) return;
    showLoading(true);
    hideError();

    try {
      const teamDoc = await db.collection('teams').doc(teamCode).get();
      if (!teamDoc.exists) {
        showLoading(false);
        showError('Mã kho không tồn tại. Kiểm tra lại.');
        return;
      }

      const teamData = teamDoc.data();

      // Add member to team
      await db.collection('teams').doc(teamCode).update({
        members: firebase.firestore.FieldValue.arrayUnion(_currentUser.uid)
      });

      // Create user document
      await db.collection('users').doc(_currentUser.uid).set({
        email:       _currentUser.email,
        displayName: _currentUser.displayName || '',
        role:        'member',
        teamId:      teamCode,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });

      _teamId = teamCode;

      // Apply config
      if (typeof setCloudConfig === 'function') {
        setCloudConfig(teamData.appsScriptUrl, teamData.secretKey);
      }

      updateUserDisplay(_currentUser, { role: 'member', teamId: teamCode }, teamData);
      showOverlay(false);
      showLoading(false);

      if (typeof loadData === 'function') await loadData();
      if (typeof refreshApplicationData === 'function') refreshApplicationData();

    } catch (err) {
      showLoading(false);
      showError('Lỗi tham gia kho: ' + err.message);
    }
  }

  // ── Logout ──────────────────────────────────────────────────────
  async function logout() {
    try {
      if (typeof setCloudConfig === 'function') setCloudConfig('', '');
      await auth.signOut();
    } catch (err) {
      console.error('[Auth] Logout error:', err);
    }
  }

  // ── User display in app ─────────────────────────────────────────
  function updateUserDisplay(user, userData, teamData) {
    const name = user.displayName || user.email.split('@')[0] || 'Collector';
    const role = userData?.role === 'owner' ? 'Chủ kho' : 'Thành viên';
    const code = teamData?.teamCode || userData?.teamId || '';

    // Lấy chữ cuối cùng của tên làm avatar (Ví dụ: "Nguyễn Thành Đạt" → "Đạt")
    const words = name.trim().split(/\s+/);
    const lastWord = words.length > 0 ? words[words.length - 1] : name;

    // Cập nhật dưới Sidebar (thay thế Collector / Trader & AD)
    const avatarEl = $('sidebarAvatar');
    const nameEl   = $('sidebarUserName');
    const statusEl = $('sidebarUserStatus');
    if (avatarEl) {
      avatarEl.textContent = lastWord;
      avatarEl.title = name + ' (' + role + ')';
    }
    if (nameEl) {
      nameEl.textContent = name;
      nameEl.title = name + ' (' + user.email + ')';
    }
    if (statusEl) {
      statusEl.textContent = role + (code ? ' · ' + code : '');
    }

    // Nút đăng xuất ở góc trên bên phải
    const el = $('authUserInfo');
    if (el) {
      el.innerHTML = '<button class="auth-logout-btn" id="authLogoutBtn" title="Đăng xuất (' + name + ')">⏻</button>';
      el.style.display = 'flex';

      $('authLogoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Bạn có muốn đăng xuất không?')) logout();
      });
    }
  }

  function hideUserDisplay() {
    const avatarEl = $('sidebarAvatar');
    const nameEl   = $('sidebarUserName');
    const statusEl = $('sidebarUserStatus');
    if (avatarEl) avatarEl.textContent = 'AD';
    if (nameEl)   nameEl.textContent   = 'Collector / Trader';
    if (statusEl) statusEl.textContent = 'Online';

    const el = $('authUserInfo');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  }

  // ── Helpers ─────────────────────────────────────────────────────
  function translateError(code) {
    const map = {
      'auth/user-not-found':        'Email không tồn tại.',
      'auth/wrong-password':        'Sai mật khẩu.',
      'auth/invalid-email':         'Email không hợp lệ.',
      'auth/email-already-in-use':  'Email đã được đăng ký.',
      'auth/weak-password':         'Mật khẩu phải có ít nhất 6 ký tự.',
      'auth/too-many-requests':     'Quá nhiều lần thử. Đợi rồi thử lại.',
      'auth/network-request-failed':'Lỗi kết nối mạng.',
      'auth/popup-blocked':         'Trình duyệt chặn popup. Hãy bật cho phép popup.',
      'auth/popup-closed-by-user':  'Đã đóng cửa sổ đăng nhập.',
      'auth/invalid-credential':    'Email hoặc mật khẩu không đúng.'
    };
    return map[code] || 'Lỗi: ' + code;
  }

  function randomCode(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
  }

  // ── DOM Event Bindings ──────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {

    // Login
    $('authLoginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      login($('authEmail').value.trim(), $('authPassword').value);
    });

    // Google Sign-In
    $('authGoogleLoginBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      loginWithGoogle();
    });

    // Register
    $('authRegisterForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      register(
        $('authRegName').value.trim(),
        $('authRegEmail').value.trim(),
        $('authRegPassword').value
      );
    });

    // Switch login ↔ register
    $('authShowRegister')?.addEventListener('click', (e) => {
      e.preventDefault(); hideError(); showView('authRegisterView');
    });
    $('authShowLogin')?.addEventListener('click', (e) => {
      e.preventDefault(); hideError(); showView('authLoginView');
    });

    // Setup tabs (owner / member)
    document.querySelectorAll('.auth-setup-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-setup-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.setup;
        const ownerForm  = $('authSetupOwnerForm');
        const memberForm = $('authSetupMemberForm');
        if (ownerForm)  ownerForm.style.display  = mode === 'owner'  ? 'block' : 'none';
        if (memberForm) memberForm.style.display = mode === 'member' ? 'block' : 'none';
        hideError();
      });
    });

    // Owner setup
    $('authSetupOwnerForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      setupOwner($('authSetupUrl').value.trim(), $('authSetupKey').value.trim());
    });

    // Member setup
    $('authSetupMemberForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      joinTeam($('authSetupTeamCode').value.trim().toUpperCase());
    });
  });

  // Expose logout globally
  window.firebaseLogout = logout;

})();


      const API = (location.hostname === 'localhost' ? 'http://localhost:3001' : '') + '/api';

      // Safe DOM Utilities
      function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      }
      function setHTML(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
      }
      let saSession = null;
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const saToken = urlParams.get('sa_auth');
        if (saToken) {
          saSession = JSON.parse(decodeURIComponent(escape(atob(saToken))));
          localStorage.setItem('ovs_currentUser', JSON.stringify(saSession));
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          saSession = JSON.parse(localStorage.getItem('ovs_currentUser') || "null");
        }
      } catch(e) {}

      if (!saSession || saSession.role !== 'superadmin') {
        window.location.href = 'login.html?admin=true';
      }
      let allStudents = [];
      let chartInstance = null;
      let countdownInterval = null;
      let regCountdownInterval = null;
      let currentElectionConfig = null;
      let currentRegistrationConfig = null;
      let electionCategories = [];

      async function clearAuditLogs() {
        if (!confirm('Are you sure you want to permanently clear ALL audit logs for your institution? This action cannot be undone.')) return;
        try {
          await apiFetch(`/auditLogs?institution=${encodeURIComponent(saSession.institution)}`, { method: 'DELETE' });
          toast('Institution audit logs cleared');
          loadAudit();
        } catch (e) { toast(e.message, false); }
      }

      function toggleScheduleMode(isEditing) {
        const scheduler = document.getElementById('v-scheduler-inner');
        const countdown = document.getElementById('v-countdown-container');
        const cancelBtn = document.getElementById('v-cancel-edit');
        const startBtn = document.getElementById('v-start-btn');
        const title = document.getElementById('schedule-card-title');

        if (isEditing) {
          scheduler.style.display = 'flex';
          countdown.style.display = 'none';
          cancelBtn.style.display = 'block';
          setText('v-start-btn', '💾 Update Schedule');
          setText('schedule-card-title', '⚙️ Modify Election Schedule');
        } else {
          scheduler.style.display = 'none';
          countdown.style.display = 'block';
          setText('schedule-card-title', '⏳ Election Live Countdown');
        }
      }

      function toggleRegScheduleMode(isEditing) {
        const scheduler = document.getElementById('r-scheduler-inner');
        const countdown = document.getElementById('r-countdown-container');
        const cancelBtn = document.getElementById('r-cancel-edit');
        const startBtn = document.getElementById('r-start-btn');
        const title = document.getElementById('r-schedule-card-title');

        if (isEditing) {
          scheduler.style.display = 'flex';
          countdown.style.display = 'none';
          cancelBtn.style.display = 'block';
          setText('r-start-btn', '💾 Update Schedule');
          setText('r-schedule-card-title', '⚙️ Modify Reg Schedule');
        } else {
          scheduler.style.display = 'none';
          countdown.style.display = 'block';
          setText('r-schedule-card-title', '⏳ Registration Live Countdown');
        }
      }

      function startCountdown(endTimeStr) {
        if (countdownInterval) clearInterval(countdownInterval);
        const endTime = new Date(endTimeStr).getTime();

        function update() {
          const now = new Date().getTime();
          const distance = endTime - now;

          if (distance < 0) {
            clearInterval(countdownInterval);
            setText('cd-days', '00');
            setText('cd-hours', '00');
            setText('cd-mins', '00');
            setText('cd-secs', '00');

            // Auto-update backend to mark election as completed
            apiFetch(`/config/election_${saSession.institution}`, {
              method: 'POST',
              body: JSON.stringify({ merge: true, data: { isActive: false, isCompleted: true } })
            }).then(() => {
              loadVoting();
              loadAll();
            }).catch(e => console.error("Auto-stop failed", e));
            return;
          }

          const d = Math.floor(distance / (1000 * 60 * 60 * 24));
          const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          const s = Math.floor((distance % (1000 * 60)) / 1000);

          setText('cd-days', String(d).padStart(2, '0'));
          setText('cd-hours', String(h).padStart(2, '0'));
          setText('cd-mins', String(m).padStart(2, '0'));
          setText('cd-secs', String(s).padStart(2, '0'));
        }

        update();
        countdownInterval = setInterval(update, 1000);
      }

      function startRegCountdown(endTimeStr) {
        if (regCountdownInterval) clearInterval(regCountdownInterval);
        const endTime = new Date(endTimeStr).getTime();

        function update() {
          const now = new Date().getTime();
          const distance = endTime - now;

          if (distance < 0) {
            clearInterval(regCountdownInterval);
            setText('r-cd-days', '00');
            setText('r-cd-hours', '00');
            setText('r-cd-mins', '00');
            setText('r-cd-secs', '00');

            apiFetch(`/config/registration_${saSession.institution}`, {
              method: 'POST',
              body: JSON.stringify({ merge: true, data: { isActive: false, isCompleted: true } })
            }).then(() => {
              loadVoting();
            }).catch(e => console.error("Auto-stop reg failed", e));
            return;
          }

          const d = Math.floor(distance / (1000 * 60 * 60 * 24));
          const h = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const m = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
          const s = Math.floor((distance % (1000 * 60)) / 1000);

          setText('r-cd-days', String(d).padStart(2, '0'));
          setText('r-cd-hours', String(h).padStart(2, '0'));
          setText('r-cd-mins', String(m).padStart(2, '0'));
          setText('r-cd-secs', String(s).padStart(2, '0'));
        }

        update();
        regCountdownInterval = setInterval(update, 1000);
      }

      document.addEventListener('DOMContentLoaded', () => {
        if (saSession && saSession.role === 'superadmin') {
          const overlay = document.getElementById('auth-overlay');
          const layout = document.getElementById('main-layout');
          if (overlay) overlay.style.display = 'none';
          if (layout) layout.style.display = 'flex';
          setText('sa-inst-label', saSession.institution || 'Super Admin');
          setText('inst-name-sub', saSession.institution || '');
          loadAll();
        }
      });

      async function apiFetch(path, opts = {}) {
        // Standardize to use the new fetchApi which includes security headers
        return await fetchApi(path, opts);
      }

      // Security: SHA-256 Hashing for Super Admin
      async function hashSA(pwd) {
        if (!pwd) return "";
        try {
          if (!window.crypto || !window.crypto.subtle) return btoa(pwd);
          const msgUint8 = new TextEncoder().encode(pwd);
          const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
          return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { return btoa(pwd); }
      }

      // Obfuscated 2FA State
      let _sv_o = null;
      let _sv_u = null;

      function toast(msg, ok = true) {
        setText('toast', (ok ? '✅ ' : '❌ ') + msg);
        const t = document.getElementById('toast');
        if (!t) return;
        t.style.borderColor = ok ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)';
        t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000);
      }

      async function saStep1() {
        const btn = document.getElementById('auth-btn-step1');
        setText('auth-err', '');

        // Validate ID
        const id = document.getElementById('auth-id').value.trim().toUpperCase();
        const pass = document.getElementById('auth-pass').value;
        if (id.length !== 9) { setText('auth-err', 'Super Admin ID must be exactly 9 characters.'); return; }
        if (pass.length !== 10) { setText('auth-err', 'Password must be exactly 10 characters.'); return; }
        if ((pass.match(/[a-zA-Z]/g) || []).length < 3) { setText('auth-err', 'Password must contain at least 3 letters.'); return; }
        if (!/[0-9]/.test(pass)) { setText('auth-err', 'Password must contain at least 1 number.'); return; }
        if (!/[^a-zA-Z0-9]/.test(pass)) { setText('auth-err', 'Password must contain at least 1 special character.'); return; }

        setText('auth-btn-step1', 'Verifying...');
        btn.disabled = true;
        try {
          const user = await apiFetch(`/users/${id}?institution=${encodeURIComponent(saSession.institution)}`);
          if (!user || user.role !== 'superadmin') throw new Error('Not a Super Admin account.');
          if (user.status !== 'active') throw new Error('Account is not active.');
          const hashedSA = await hashSA(pass);
          const legacyB64 = btoa(pass);

          if (user.password !== pass && user.password !== legacyB64 && user.password !== hashedSA) {
            throw new Error('Wrong password.');
          }

          // Credentials OK — Generate and send OTP
          const otp = Math.floor(100000 + Math.random() * 900000).toString();
          _sv_o = otp;
          _sv_u = user;
          setText('auth-btn-step1', 'Sending OTP...');
          try {
            await StorageManager.sendEmailOtp(user.email, "Super Admin", otp, "Super Admin 2FA Login");
            // Show Step 2
            document.getElementById('auth-id').disabled = true;
            document.getElementById('auth-pass').disabled = true;
            btn.style.display = 'none';
            document.getElementById('otp-section').style.display = 'block';
            document.getElementById('auth-otp').focus();
            setText('auth-err', `✅ OTP sent to your email! Enter it below.`);
          } catch (emailErr) {
            setText('auth-btn-step1', '📧 Send OTP & Continue');
            btn.disabled = false;
            setText('auth-err', 'Failed to send OTP: ' + (emailErr.text || emailErr.message || 'Email error'));
          }
        } catch (e) {
          setText('auth-btn-step1', '📧 Send OTP & Continue');
          btn.disabled = false;
          setText('auth-err', e.message);
        }
      }

      async function saStep2() {
        const btn = document.getElementById('auth-btn-step2');
        setText('auth-err', '');

        const enteredOtp = document.getElementById('auth-otp').value.trim();
        if (!enteredOtp || enteredOtp.length !== 6) { setText('auth-err', 'Enter the 6-digit OTP from your email.'); return; }
        if (enteredOtp !== _sv_o) { setText('auth-err', '❌ Invalid OTP. Please try again.'); return; }

        setText('auth-btn-step2', 'Logging in...');
        btn.disabled = true;
        const user = _sv_u;
        saSession = user;
        localStorage.setItem('ovs_currentUser', JSON.stringify(user));
        const overlay = document.getElementById('auth-overlay');
        const layout = document.getElementById('main-layout');
        if (overlay) overlay.style.display = 'none';
        if (layout) layout.style.display = 'flex';
        setText('sa-inst-label', user.institution || 'Super Admin');
        setText('inst-name-sub', user.institution || '');
        loadAll();
      }

      function saLogout() {
        saSession = null;
        localStorage.removeItem('ovs_currentUser');
        window.location.href = 'login.html?admin=true';
      }

      // --- FORGOT MASTER PASSWORD FLOW ---
      let _saForgotOtp = null;
      let _saForgotInst = null;
      let _saForgotRegNum = null;

      function openSAForgotModal() {
        document.getElementById('sa-forgot-modal').style.display = 'flex';
        document.getElementById('sa-forgot-step1').style.display = 'block';
        document.getElementById('sa-forgot-step2').style.display = 'none';
        document.getElementById('sa-forgot-id').value = '';
        document.getElementById('sa-forgot-otp').value = '';
        document.getElementById('sa-forgot-newpass').value = '';
        setText('sa-forgot-err', '');
        document.getElementById('sa-forgot-id').focus();
      }

      function closeSAForgotModal() {
        document.getElementById('sa-forgot-modal').style.display = 'none';
      }

      async function saForgotSendOtp() {
        const btn = document.getElementById('sa-forgot-btn1');
        const id = document.getElementById('sa-forgot-id').value.trim();
        setText('sa-forgot-err', '');
        if (id.length !== 9) { setText('sa-forgot-err', 'Super Admin ID must be exactly 9 characters.'); return; }

        setText('sa-forgot-btn1', 'Looking up account...');
        btn.disabled = true;
        try {
          const user = await apiFetch(`/users/${id}`);
          if (!user || user.role !== 'superadmin') throw new Error('No Super Admin account found with that ID.');
          if (!user.email) throw new Error('This account has no recovery email registered.');
          _saForgotRegNum = id;
          _saForgotInst = user.institution;

          // Generate & send OTP
          const otp = Math.floor(100000 + Math.random() * 900000).toString();
          _saForgotOtp = otp;
          setText('sa-forgot-btn1', 'Sending OTP...');
          await StorageManager.sendEmailOtp(user.email, user.name || 'Super Admin', otp, 'Master Password Recovery');

          const masked = user.email.replace(/^(.{2})(.*)(@.*)$/, '$1***$3');
          setText('sa-forgot-hint', '— sent to ' + masked);
          document.getElementById('sa-forgot-step1').style.display = 'none';
          document.getElementById('sa-forgot-step2').style.display = 'block';
          setText('sa-forgot-err', '✅ OTP sent! Check your email inbox.');
        } catch (e) {
          setText('sa-forgot-err', e.message || 'Failed to send OTP');
          setText('sa-forgot-btn1', '📧 Send Recovery OTP');
          btn.disabled = false;
        }
      }

      async function saForgotReset() {
        const btn = document.getElementById('sa-forgot-btn2');
        const otp = document.getElementById('sa-forgot-otp').value.trim();
        const newPass = document.getElementById('sa-forgot-newpass').value;
        setText('sa-forgot-err', '');

        if (otp.length !== 6) { setText('sa-forgot-err', 'Enter the 6-digit code from your email.'); return; }
        if (otp !== _saForgotOtp) { setText('sa-forgot-err', '❌ Invalid OTP. Please try again.'); return; }

        // Validate new password
        if (newPass.length !== 10) { setText('sa-forgot-err', 'Password must be exactly 10 characters.'); return; }
        if ((newPass.match(/[a-zA-Z]/g) || []).length < 3) { setText('sa-forgot-err', 'Password needs at least 3 letters.'); return; }
        if (!/[0-9]/.test(newPass)) { setText('sa-forgot-err', 'Password needs at least 1 number.'); return; }
        if (!/[^a-zA-Z0-9]/.test(newPass)) { setText('sa-forgot-err', 'Password needs at least 1 special character.'); return; }

        btn.textContent = 'Resetting...';
        btn.disabled = true;
        try {
          await apiFetch(`/users/${_saForgotRegNum}?institution=${encodeURIComponent(_saForgotInst)}`, {
            method: 'PATCH',
            body: JSON.stringify({ password: btoa(newPass) })
          });
          setText('sa-forgot-err', '✅ Password reset successfully! You can now log in.');
          _saForgotOtp = null;
          setTimeout(closeSAForgotModal, 2500);
        } catch (e) {
          setText('sa-forgot-err', 'Reset failed: ' + e.message);
          setText('sa-forgot-btn2', '🔒 Reset Password');
          btn.disabled = false;
        }
      }

      function showPage(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('page-' + id).classList.add('active');
        event.currentTarget.classList.add('active');
        if (id === 'students') renderStudents(allStudents);
        if (id === 'voting') loadVoting();
        if (id === 'audit') loadAudit();
        if (id === 'health') loadSystemHealth();
      }

      async function refreshAll() {
        toast('🔄 Refreshing data...');
        await loadAll();
        toast('✅ Data refreshed!');
      }

      async function loadAll() {
        try {
          const [allUsers, election] = await Promise.all([
            apiFetch(`/users?institution=${encodeURIComponent(saSession.institution)}`),
            apiFetch(`/config/election_${saSession.institution}`).catch(() => ({}))
          ]);

          // Filter by institution — also catch NULL institution for legacy admins by regNum
          const instUsers = allUsers.filter(u =>
            u.institution === saSession.institution ||
            u.regNum === saSession.regNum
          );
          const students = instUsers.filter(u => u && ['voter', 'contestant'].includes(u.role));
          const admins = instUsers.filter(u => u && u.role === 'admin');
          const subadmins = instUsers.filter(u => u && u.role === 'subadmin');
          allStudents = students;

          const votedCount = students.filter(u => u.hasVoted == 1).length;
          const canVoteCount = students.filter(u => u.canVote == 1).length;

          setText('s-students', students.length);
          setText('s-admins', admins.length);
          setText('s-subadmins', subadmins.length);
          setText('s-voted', votedCount);
          setText('s-canvote', canVoteCount);

          // Update Summary Bar
          setText('sum-total', students.length);
          setText('sum-can', canVoteCount);
          setText('sum-voted', votedCount);
          setText('sum-not', students.length - canVoteCount);

          loadInstitutionCode();

          const eInfo = document.getElementById('election-status-info');
          if (election && election.isActive) {
            setHTML('election-status-info', `<span style="color:var(--green);font-weight:700;">🟢 Election is ACTIVE</span><br><small style="color:var(--muted)">End: ${election.endTime || 'No end time set'}</small>`);
          } else if (election && election.isCompleted) {
            setHTML('election-status-info', `<span style="color:var(--red);font-weight:700;">🔴 Election COMPLETED</span>`);
          } else {
            setHTML('election-status-info', `<span style="color:var(--muted);">⚪ Election not started</span>`);
          }

          renderAdminTable(admins);
          allSubAdmins = subadmins;
          renderSubAdminTable(subadmins);

          // Build scope UI for Advanced Election
          buildSaScopeHierarchy();

          // Load pack usage widget
          loadPackUsage();
        } catch (e) { toast(e.message, false); }
      }

      async function loadPackUsage() {
        try {
          const data = await apiFetch(`/institutions/pack-usage?institution=${encodeURIComponent(saSession.institution)}`);
          const card = document.getElementById('pack-usage-card');
          const inner = document.getElementById('pack-usage-inner');
          if (!card || !inner) return;
          if (!data.pack || !data.usage) { card.style.display = 'none'; return; }
          card.style.display = 'block';
          const p = data.pack;
          const u = data.usage;
          function bar(label, current, max, color) {
            const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
            const isNear = pct >= 80;
            const barColor = isNear ? 'var(--red)' : color;
            return `<div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                <span style="font-size:0.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:1px;">${label}</span>
                <span style="font-size:0.85rem; font-weight:700; color:${isNear ? 'var(--red)' : 'white'};">${current} / ${max} <span style="color:var(--muted); font-weight:400;">(${pct}%)</span></span>
              </div>
              <div style="width:100%; height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:3px; transition:width 0.6s ease;"></div>
              </div>
            </div>`;
          }
          inner.innerHTML = `
            <div style="font-size:0.78rem; color:#a855f7; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-bottom:-0.3rem;">Active Plan: ${p.name}</div>
            ${bar('Admins', u.admins.current, u.admins.max, 'var(--gold)')}
            ${bar('Sub-Admins', u.subAdmins.current, u.subAdmins.max, '#a855f7')}
            ${bar('Students', u.students.current, u.students.max, 'var(--cyan)')}
          `;
        } catch(e) { /* silently fail */ }
      }

      async function loadInstitutionCode() {
        try {
          const res = await apiFetch('/config/institution_codes');
          const myCodeKey = Object.keys(res).find(k => res[k] === saSession.institution);
          if (myCodeKey) {
            document.getElementById('inst-access-code').value = myCodeKey;
          } else {
            document.getElementById('inst-access-code').value = '';
            document.getElementById('inst-access-code').placeholder = 'NOT SET';
          }
        } catch (e) {
          if (e.message !== "Not found") toast("Error loading code: " + e.message, false);
          else {
            const el = document.getElementById('inst-access-code');
            if (el) el.placeholder = 'NOT SET';
          }
        }
      }

      async function updateInstitutionCode() {
        const newCode = document.getElementById('inst-access-code').value.trim();
        if (!newCode) return toast("Code cannot be empty", false);
        try {
          const res = await apiFetch('/config/institution_codes').catch(() => ({}));
          
          // Check if code is already in use by someone else
          if (res[newCode] && res[newCode] !== saSession.institution) {
              return toast(`Error: The code "${newCode}" is already in use by another institution.`, false);
          }

          const oldCode = Object.keys(res).find(k => res[k] === saSession.institution);

          if (oldCode) delete res[oldCode]; // Remove old code mapped to this institution
          res[newCode] = saSession.institution;

          await apiFetch('/config/institution_codes', {
            method: 'POST',
            body: JSON.stringify({ merge: false, data: res })
          });
          toast("Gateway Code successfully updated!");
          loadInstitutionCode();
        } catch (e) {
          toast("Failed to update: " + e.message, false);
        }
      }

      function renderAdminTable(admins) {
        if (!admins.length) { setHTML('admin-table', '<tr><td colspan="6" class="empty">No admins yet</td></tr>'); return; }
        setHTML('admin-table', admins.map(a => `<tr>
    <td><strong>${a.regNum}</strong></td><td>${a.name}</td>
    <td><span class="badge badge-active">${a.branch || '-'}</span></td>
    <td>${a.email || '-'}</td>
    <td><span class="badge badge-active">${a.status}</span></td>
    <td style="display:flex;gap:0.4rem;">
      <button class="btn-sm" style="background:rgba(245,158,11,0.15);color:var(--gold);border:1px solid rgba(245,158,11,0.3);" onclick="editAdmin('${a.regNum}','${a.name}','${a.email || ''}','${a.branch || ''}')">Edit</button>
      <button class="btn-sm btn-danger-sm" onclick="removeUser('${a.regNum}')">Remove</button>
    </td>
  </tr>`).join(''));
      }

      function renderSubAdminTable(sas) {
        if (!sas.length) { setHTML('subadmin-table', '<tr><td colspan="7" class="empty">No sub-admins yet</td></tr>'); return; }
        setHTML('subadmin-table', sas.map(s => `<tr>
    <td><strong>${s.regNum}</strong></td><td>${s.name}</td>
    <td>${s.branch || '-'}</td><td>${s.class || '-'}</td><td>${s.year || '-'}</td>
    <td>${s.managedBy || '-'}</td>
    <td style="display:flex;gap:0.4rem;">
      <button class="btn-sm" style="background:rgba(168,85,247,0.15);color:var(--purple);border:1px solid rgba(168,85,247,0.3);" onclick="editSubAdmin('${s.regNum}','${s.name}','${s.email || ''}','${s.branch || ''}','${s.class || ''}','${s.year || ''}')">Edit</button>
      <button class="btn-sm btn-danger-sm" onclick="removeUser('${s.regNum}')">Remove</button>
    </td>
  </tr>`).join(''));
      }

      function renderStudents(list) {
        if (!list.length) { setHTML('student-table', '<tr><td colspan="11" class="empty">No students found</td></tr>'); return; }
        setHTML('student-table', list.map((s, index) => `<tr>
    <td><span class="badge" style="background:rgba(255,255,255,0.05);color:var(--gold);">Total: ${list.length} / #${index + 1}</span></td>
    <td><strong>${s.regNum}</strong></td><td>${s.name}</td>
    <td><span class="badge" style="background:rgba(255,255,255,0.1); color:${(s && s.role === 'contestant') ? '#c084fc' : '#cbd5e1'}; border: 1px solid rgba(255,255,255,0.1);">${(s && s.role === 'contestant') ? 'Candidate' : 'Voter'}</span></td>
    <td><span class="badge" style="background:rgba(255,255,255,0.05);color:var(--purple);">${s.year || '1st'}</span></td>
    <td>${s.branch || '-'}</td><td>${s.class || '-'}</td>
    <td>${s.webcamReg ? '<span class="badge" style="background:rgba(6,182,212,0.15); color:#06b6d4; border:1px solid rgba(6,182,212,0.3); font-size:0.75rem;" title="AI Face Verified">🤖 AI Verified</span>' : '<span class="badge" style="background:rgba(100,116,139,0.15); color:#94a3b8; border:1px solid rgba(100,116,139,0.3); font-size:0.75rem;" title="Manual Registration">👤 Manual</span>'}</td>
    <td>
      <select class="action-select" onchange="superAction(this,'${s.regNum}')" style="padding:0.35rem 0.6rem;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:0.8rem;cursor:pointer;min-width:110px;">
        <option value="">⚡ Actions</option>
        <option value="edit">✏️ Edit Details</option>
        <option value="remove">🗑️ Remove</option>
      </select>
    </td>
  </tr>`).join(''));
      }

      window.superAction = function (sel, regNum) {
        const action = sel.value; sel.value = '';
        if (action === 'remove') removeUser(regNum);
        if (action === 'edit') {
          const s = allStudents.find(x => x.regNum === regNum);
          if (!s) return;
          setText('edit-modal-title', '✏️ Edit Student/Candidate');
          const roleEl = document.getElementById('edit-role');
          if (roleEl) roleEl.value = s.role;
          const regEl = document.getElementById('edit-regnum');
          if (regEl) regEl.value = s.regNum;
          setText('edit-regnum-display', s.regNum);
          document.getElementById('edit-name').value = s.name;
          document.getElementById('edit-email').value = s.email || '';
          document.getElementById('edit-branch').value = s.branch || 'CSE';
          document.getElementById('edit-class-group').style.display = 'flex';
          document.getElementById('edit-class').value = s.class || '';
          document.getElementById('edit-year').value = s.year || '1st';
          document.getElementById('edit-pass').value = '';
          document.getElementById('edit-modal').classList.add('open');
        }
      }

      function filterStudents(q) {
        applyStudentFilters();
      }

      function applyStudentFilters() {
        const q = (document.getElementById('student-search').value || '').toLowerCase();
        const branch = document.getElementById('sf-branch').value;
        const cls = (document.getElementById('sf-class').value || '').toUpperCase();
        const year = document.getElementById('sf-year').value;
        const filtered = allStudents.filter(s => {
          const matchQ = !q || [s.regNum, s.name, s.branch, s.class].join(' ').toLowerCase().includes(q);
          const matchBranch = !branch || (s.branch || '') === branch;
          const matchClass = !cls || (s.class || '').includes(cls);
          // Year stored as '1st', '2nd', etc. in the database
          const matchYear = !year || (s.year || '') === year || (s.class || '').toLowerCase().includes(year.toLowerCase());
          return matchQ && matchBranch && matchClass && matchYear;
        });
        renderStudents(filtered);
      }

      let allSubAdmins = [];

      function applySubAdminFilter() {
        const branch = document.getElementById('sa-filter-branch').value;
        const year = document.getElementById('sa-filter-year').value;
        const filtered = allSubAdmins.filter(s => {
          const matchBranch = !branch || (s.branch || '') === branch;
          const matchYear = !year || (s.year || '') === year;
          return matchBranch && matchYear;
        });
        renderSubAdminTable(filtered);
      }

      async function createAdmin() {
        const id = document.getElementById('a-id').value.trim();
        const nameInput = document.getElementById('a-name').value;
        if (nameInput.startsWith(' ')) return toast('Name cannot start with a space.', false);
        const name = nameInput.trim();
        const email = document.getElementById('a-email').value.trim();
        const branch = document.getElementById('a-branch').value;
        const pass = document.getElementById('a-pass').value;
        if (!id || !name || !branch || !pass) return toast('Fill all required fields', false);
        if (id.length !== 7 || !/^[A-Z0-9]{7}$/.test(id)) return toast('Admin ID must be exactly 7 uppercase letters/numbers (no space)', false);
        if (name.length > 30 || !/^[a-zA-Z\s.]+$/.test(name) || (name.match(/\./g) || []).length > 1) return toast('Name: max 30 chars, letters + one dot only', false);
        const pwdErr = validatePassword(pass, 8, 8);
        if (pwdErr) return toast('Admin Index: ' + pwdErr, false);
        try {
          await apiFetch('/users/add', { method: 'POST', body: JSON.stringify({ regNum: id, password: btoa(pass), role: 'admin', name, email, branch, institution: saSession.institution, status: 'active' }) });
          toast(`Admin ${id} created for branch ${branch}`);
          ['a-id', 'a-name', 'a-email', 'a-pass'].forEach(i => {
            const el = document.getElementById(i);
            if (el) el.value = '';
          });
          const brEl = document.getElementById('a-branch');
          if (brEl) brEl.value = '';
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      function closeEditModal() { document.getElementById('edit-modal').classList.remove('open'); }

      function editAdmin(id, name, email, branch) {
        setText('edit-modal-title', '✏️ Edit Branch Admin');
        const roleEl = document.getElementById('edit-role');
        if (roleEl) roleEl.value = 'admin';
        const regEl = document.getElementById('edit-regnum');
        if (regEl) regEl.value = id;
        setText('edit-regnum-display', id);
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-email').value = email || '';
        document.getElementById('edit-branch').value = branch || 'CSE';
        document.getElementById('edit-class-group').style.display = 'none';
        document.getElementById('edit-class').value = '';
        document.getElementById('edit-pass').value = '';
        document.getElementById('edit-modal').classList.add('open');
      }

      function editSubAdmin(id, name, email, branch, cls, year) {
        setText('edit-modal-title', '✏️ Edit Sub-Admin');
        const roleEl = document.getElementById('edit-role');
        if (roleEl) roleEl.value = 'subadmin';
        const regEl = document.getElementById('edit-regnum');
        if (regEl) regEl.value = id;
        setText('edit-regnum-display', id);
        document.getElementById('edit-name').value = name;
        document.getElementById('edit-email').value = email || '';
        document.getElementById('edit-branch').value = branch || 'CSE';
        document.getElementById('edit-class-group').style.display = 'flex';
        document.getElementById('edit-class').value = cls || '';
        document.getElementById('edit-year').value = year || '1st';
        document.getElementById('edit-pass').value = '';
        document.getElementById('edit-modal').classList.add('open');
      }

      async function saveEdit() {
        const role = document.getElementById('edit-role').value;
        const id = document.getElementById('edit-regnum').value;
        const name = document.getElementById('edit-name').value.trim();
        const email = document.getElementById('edit-email').value.trim();
        const branch = document.getElementById('edit-branch').value;
        const cls = document.getElementById('edit-class').value.trim().toUpperCase();
        const year = document.getElementById('edit-year').value;
        const pass = document.getElementById('edit-pass').value;

        if (!name) return toast('Name required', false);

        const updates = { name, email, branch };
        if (role === 'subadmin' || role === 'voter' || role === 'contestant') {
          updates.class = cls;
          updates.year = year;
        }

        let validPwdFn = (pwd) => {
          // Validate password based on role length
          let minLen = role === 'admin' ? 8 : (role === 'subadmin' ? 6 : 6);
          let minAlpha = 3; let minNum = 1; let minSpec = 1;
          return validateStrictPassword(pwd, minLen, minLen, minAlpha, minNum, minSpec);
        }

        if (pass && pass.trim() !== '') {
          const pwdErr = validPwdFn(pass);
          if (pwdErr) return toast(role + ' password ' + pwdErr, false);
          updates.password = btoa(pass);
        }

        try {
          await apiFetch(`/users/${id}?institution=${encodeURIComponent(saSession.institution)}`, { method: 'PATCH', body: JSON.stringify(updates) });
          toast(`${id} details updated successfully!`);
          closeEditModal();
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      function validateStrictPassword(pwd, minLen, maxLen, minAlpha, minNum, minSpec) {
        if (pwd.includes(' ')) return 'cannot contain spaces.';
        if (pwd.length < minLen || (maxLen && pwd.length > maxLen))
          return maxLen === minLen ? `must be exactly ${minLen} characters.` : `must be ${minLen}-${maxLen} characters.`;
        if ((pwd.match(/[a-zA-Z]/g) || []).length < minAlpha) return `must contain at least ${minAlpha} letters.`;
        if ((pwd.match(/[0-9]/g) || []).length < minNum) return `must contain at least ${minNum} numbers.`;
        if ((pwd.match(/[^a-zA-Z0-9]/g) || []).length < minSpec) return `must contain at least ${minSpec} special character.`;
        return null;
      }

      function validatePassword(pwd, minLen, maxLen) {
        if (pwd.length < minLen || (maxLen && pwd.length > maxLen)) {
          return maxLen === minLen ? `Password must be exactly ${minLen} characters.` : `Password must be ${minLen}-${maxLen} characters.`;
        }
        if ((pwd.match(/[a-zA-Z]/g) || []).length < 3) return 'Must contain at least 3 letters.';
        if (!/[0-9]/.test(pwd)) return 'Must contain at least 1 number.';
        if (!/[^a-zA-Z0-9]/.test(pwd)) return 'Must contain at least 1 special character.';
        return null;
      }

      async function toggleCanVote(regNum, val) {
        try {
          await apiFetch('/voters/can-vote', {
            method: 'POST',
            body: JSON.stringify({ regNum, canVote: val, institution: saSession.institution })
          });
          toast(val ? 'Vote access granted!' : 'Vote access revoked');
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      async function grantAllInstitutionVote() {
        if (!confirm('Grant vote access to ALL ACTIVE students in the ENTIRE institution?')) return;
        const activeStudents = allStudents.filter(s => s.status === 'active');
        if (!activeStudents.length) return toast('No active students found to grant access to.', false);

        try {
          const ids = activeStudents.map(s => s.regNum);
          await apiFetch('/voters/can-vote-bulk', {
            method: 'POST',
            body: JSON.stringify({ regNums: ids, canVote: true, institution: saSession.institution })
          });
          toast(`Vote access granted to ${ids.length} students!`);
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      async function createSubAdminSA() {
        const id = document.getElementById('sa-id').value.trim();
        const nameInput = document.getElementById('sa-name').value;
        if (nameInput.startsWith(' ')) return toast('Name cannot start with a space.', false);
        const name = nameInput.trim();
        const email = document.getElementById('sa-email').value.trim();
        const branch = document.getElementById('sa-branch').value;
        const cls = document.getElementById('sa-class').value.trim().toUpperCase();
        const year = document.getElementById('sa-year').value;
        const pass = document.getElementById('sa-pass').value;
        if (!id || !name || !branch || !cls || !year || !pass) return toast('Fill all required fields', false);
        if (id.length !== 9 || !/^[A-Z0-9]{9}$/.test(id)) return toast('Sub-Admin ID must be exactly 9 uppercase letters/numbers', false);
        if (name.length > 30 || !/^[a-zA-Z\s.]+$/.test(name) || (name.match(/\./g) || []).length > 1) return toast('Name: max 30 chars, letters + one dot only', false);
        const pwdErr = validatePassword(pass, 6, 6);
        if (pwdErr) return toast('Sub-Admin: ' + pwdErr, false);
        try {
          await apiFetch('/users/add', { method: 'POST', body: JSON.stringify({ regNum: id, password: btoa(pass), role: 'subadmin', name, email, branch: branch, class: cls, year: year, institution: saSession.institution, managedBy: saSession.regNum, status: 'active' }) });
          toast(`Sub-Admin ${id} created for class ${cls}`);
          ['sa-id', 'sa-name', 'sa-email', 'sa-class', 'sa-pass'].forEach(i => document.getElementById(i).value = '');
          document.getElementById('sa-branch').value = '';
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      async function removeUser(id) {
        if (!confirm(`Remove ${id}? This cannot be undone.`)) return;
        try {
          await apiFetch(`/users/${id}?institution=${encodeURIComponent(saSession.institution)}`, { method: 'DELETE' });
          toast(`${id} removed`);
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      async function setElectionTimes() {
        if (currentRegistrationConfig && currentRegistrationConfig.isActive) {
          return toast('Cannot start Election: Registration is currently active! Stop registration first.', false);
        }
        // ── Guard: Categories must be defined first ──
        if (!electionCategories || electionCategories.length === 0) {
          await loadElectionCategories();
          if (!electionCategories || electionCategories.length === 0) {
            return toast('❌ You must define at least one Election Category before starting the Election Schedule!', false);
          }
        }
        // ── Guard: Each category must have at least 2 candidates ──
        try {
          const allUsers = await apiFetch(`/users?institution=${encodeURIComponent(saSession.institution)}`);
          const contestants = allUsers.filter(u => u && u.role === 'contestant' && u.institution === saSession.institution && u.status === 'active');
          // Count candidates per category
          const countByCat = {};
          electionCategories.forEach(cat => { countByCat[cat] = 0; });
          contestants.forEach(c => {
            const cat = c.category || 'General';
            if (countByCat[cat] !== undefined) countByCat[cat]++;
          });
          const underMinCats = electionCategories.filter(cat => (countByCat[cat] || 0) < 2);
          if (underMinCats.length > 0) {
            const details = underMinCats.map(cat => `"${cat}" (${countByCat[cat] || 0} candidate${countByCat[cat] === 1 ? '' : 's'})`).join(', ');
            return toast(`❌ Cannot start Election: Each category needs at least 2 candidates. Insufficient: ${details}`, false);
          }
        } catch (e) {
          return toast('❌ Could not verify candidate counts. Please try again.', false);
        }
        const name = document.getElementById('v-name').value.trim();
        const start = document.getElementById('v-start').value;
        const end = document.getElementById('v-end').value;
        if (!name) return toast('Please enter an Election Name', false);
        if (!start || !end) return toast('Set both start and end times', false);
        try {
          await apiFetch(`/config/election_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({
              merge: true,
              data: {
                isActive: true,
                isCompleted: false,
                startTime: start,
                endTime: end,
                electionName: name
              }
            })
          });
          toast('Election times set & activated!');
          loadVoting(); // Refresh to update title
        } catch (e) { toast(e.message, false); }
      }

      async function setRegistrationTimes() {
        if (currentElectionConfig && currentElectionConfig.isActive) {
          return toast('Cannot start Registration: Election is currently active! Stop election first.', false);
        }
        // ── Guard: Categories must be defined first ──
        if (!electionCategories || electionCategories.length === 0) {
          // Try reloading from DB before rejecting
          await loadElectionCategories();
          if (!electionCategories || electionCategories.length === 0) {
            return toast('❌ You must define at least one Election Category before starting Registration! Candidates need to choose a category when registering.', false);
          }
        }
        const start = document.getElementById('r-start').value;
        const end = document.getElementById('r-end').value;
        if (!start || !end) return toast('Set both start and end times', false);
        try {
          await apiFetch(`/config/registration_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({
              merge: true,
              data: {
                isActive: true,
                isCompleted: false,
                startTime: start,
                endTime: end
              }
            })
          });
          toast('Registration schedule set & activated!');
          loadVoting();
        } catch (e) { toast(e.message, false); }
      }

      async function stopRegistration() {
        if (!confirm('End registration phase right now? Users will not be able to register.')) return;
        try {
          await apiFetch(`/config/registration_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { isActive: false, isCompleted: true } })
          });
          toast('Registration ended & marked as completed!');
          loadVoting();
        } catch (e) { toast(e.message, false); }
      }

      async function resetElection() {
        if (!confirm('Reset entire election? All votes will be cleared.')) return;
        try {
          await apiFetch('/election/reset', { method: 'POST', body: JSON.stringify({ institution: saSession.institution }) });
          toast('Election reset');
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      async function stopElection() {
        if (!confirm('End the election now? Voters will no longer be able to cast votes.')) return;
        try {
          await apiFetch(`/config/election_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { isActive: false, isCompleted: true } })
          });
          toast('Election ended & marked as completed!');
          loadVoting();
          loadAll();
        } catch (e) { toast(e.message, false); }
      }

      // ── Categories Management ──
      async function loadElectionCategories() {
        try {
          const res = await apiFetch(`/config/categories_${saSession.institution}`);
          if (res && res.categories) {
            electionCategories = res.categories;
            renderCategoriesList();
          }
        } catch (e) { }
      }

      function renderCategoriesList() {
        if (electionCategories.length === 0) {
          setHTML('categories-list', '<div style="color:var(--muted); text-align:center; padding:1rem; font-size:0.85rem;">No categories defined.</div>');
          return;
        }
        const list = document.getElementById('categories-list');
        if (!list) return;
        list.innerHTML = '';
        electionCategories.forEach((cat, idx) => {
          const div = document.createElement('div');
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.padding = '0.5rem 0.8rem';
          div.style.background = 'rgba(255,255,255,0.05)';
          div.style.borderRadius = '6px';
          div.innerHTML = `
            <span style="font-weight:600;">${cat}</span>
            <button style="background:transparent; border:none; color:var(--red); cursor:pointer; font-size:1.2rem; line-height:1;" onclick="removeElectionCategory(${idx})">&times;</button>
        `;
          list.appendChild(div);
        });
      }

      function addElectionCategory() {
        const input = document.getElementById('new-category-input');
        const val = input.value.trim();
        if (!val) return;
        if (electionCategories.includes(val)) return toast('Category already exists', false);
        electionCategories.push(val);
        input.value = '';
        renderCategoriesList();
      }

      function removeElectionCategory(idx) {
        if (confirm('Remove this category? Note: This will not delete previously assigned roles.')) {
          electionCategories.splice(idx, 1);
          renderCategoriesList();
        }
      }

      async function saveCategories() {
        try {
          await apiFetch(`/config/categories_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { categories: electionCategories } })
          });
          toast('Categories saved successfully!');
        } catch (e) {
          toast('Error saving categories: ' + e.message, false);
        }
      }

      async function loadVoting() {
        try {
          const [users, election, registration] = await Promise.all([
            apiFetch(`/users?institution=${encodeURIComponent(saSession.institution)}`),
            apiFetch(`/config/election_${saSession.institution}`).catch(() => ({})),
            apiFetch(`/config/registration_${saSession.institution}`).catch(() => ({}))
          ]);

          currentElectionConfig = election;
          currentRegistrationConfig = registration;

          const inst = saSession.institution;
          setText('voting-inst-sub', `Election management — ${inst}`);

          // ── Banner & Countdown Logic (Election) ────────────────
          const banner = document.getElementById('election-banner');
          const schInner = document.getElementById('v-scheduler-inner');
          const countContainer = document.getElementById('v-countdown-container');
          const title = document.getElementById('schedule-card-title');
          const startBtn = document.getElementById('v-start-btn');
          const nameInput = document.getElementById('v-name');

          if (election && election.isActive) {
            // (Election rendering)
            banner.style.background = 'rgba(34,197,94,0.1)';
            banner.style.borderColor = 'rgba(34,197,94,0.4)';
            banner.style.color = 'var(--green)';
            setHTML('election-banner', `🟢 <span><strong>${election.electionName || 'Election'}</strong> is <strong>ACTIVE</strong></span>
        <span style="margin-left:auto;font-size:0.85rem;font-weight:400;color:var(--muted);">
          Ends: ${election.endTime ? new Date(election.endTime).toLocaleString() : 'No end time set'}
        </span>`);

            // Auto-switch to countdown mode if active
            toggleScheduleMode(false);
            if (election.endTime) startCountdown(election.endTime);
            if (election.electionName) setText('schedule-card-title', '⏳ ' + election.electionName);

            // Pre-fill times
            if (election.startTime) document.getElementById('v-start').value = election.startTime.slice(0, 16);
            if (election.endTime) document.getElementById('v-end').value = election.endTime.slice(0, 16);
            if (election.electionName) nameInput.value = election.electionName;
          } else if (election && election.isCompleted) {
            banner.style.background = 'rgba(239,68,68,0.08)';
            banner.style.borderColor = 'rgba(239,68,68,0.3)';
            banner.style.color = 'var(--red)';
            setHTML('election-banner', '🔴 <span>Election is <strong>COMPLETED</strong> — Use Reset to start a new election</span>');

            schInner.style.display = 'flex';
            countContainer.style.display = 'none';
            setText('schedule-card-title', '⏱️ Election Schedule');
            setText('v-start-btn', '▶ Start Election');
            if (countdownInterval) clearInterval(countdownInterval);
          } else {
            banner.style.background = 'var(--surface)';
            banner.style.borderColor = 'var(--border)';
            banner.style.color = 'var(--muted)';
            setHTML('election-banner', '⚪ <span>Election <strong>not started</strong> — Set schedule and click Start Election</span>');

            schInner.style.display = 'flex';
            countContainer.style.display = 'none';
            setText('schedule-card-title', '⏱️ Election Schedule');
            setText('v-start-btn', '▶ Start Election');
            if (countdownInterval) clearInterval(countdownInterval);
          }

          // ── Countdown Logic (Registration) ────────────────
          const rSchInner = document.getElementById('r-scheduler-inner');
          const rCountContainer = document.getElementById('r-countdown-container');
          const rTitle = document.getElementById('r-schedule-card-title');
          const rStartBtn = document.getElementById('r-start-btn');

          if (registration && registration.isActive) {
            toggleRegScheduleMode(false);
            if (registration.endTime) startRegCountdown(registration.endTime);
            setText('r-schedule-card-title', '⏳ Registration Live');

            // Pre-fill times
            if (registration.startTime) document.getElementById('r-start').value = registration.startTime.slice(0, 16);
            if (registration.endTime) document.getElementById('r-end').value = registration.endTime.slice(0, 16);
          } else if (registration && registration.isCompleted) {
            rSchInner.style.display = 'flex';
            rCountContainer.style.display = 'none';
            setText('r-schedule-card-title', '🔴 Registration Ended');
            setText('r-start-btn', '▶ Restart Registration');
            if (regCountdownInterval) clearInterval(regCountdownInterval);
          } else {
            rSchInner.style.display = 'flex';
            rCountContainer.style.display = 'none';
            setText('r-schedule-card-title', '📝 Registration Schedule');
            setText('r-start-btn', '▶ Start Registration');
            if (regCountdownInterval) clearInterval(regCountdownInterval);
          }

          // ── Categories ───────────────────────────────
          await loadElectionCategories();
          renderCategoriesList();

          // ── Live Stats ───────────────────────────────
          const voters = users.filter(u => u && u.role === 'voter' && u.institution === inst);
          const candidates = users.filter(u => u && u.role === 'contestant' && u.institution === inst);
          const totalVoters = voters.length;
          const canVote = voters.filter(v => v.canVote == 1).length;
          const voted = voters.filter(v => v.hasVoted == 1).length;
          const pct = canVote > 0 ? Math.round((voted / canVote) * 100) : 0;

          document.getElementById('v-total').textContent = totalVoters;
          document.getElementById('v-canvote').textContent = canVote;
          document.getElementById('v-voted').textContent = voted;
          document.getElementById('v-pct').textContent = pct + '%';

          // ── Pre-calculate Multi-Category Votes ───────
          let voteCounts = {};
          voters.forEach(v => {
            if (!v.hasVoted || !v.votedFor) return;
            let votesObj = {};
            try {
              votesObj = JSON.parse(v.votedFor);
              if (typeof votesObj !== 'object') throw new Error("flat");
            } catch (e) {
              votesObj = { 'General': v.votedFor };
            }
            Object.values(votesObj).forEach(candRegNum => {
              voteCounts[candRegNum] = (voteCounts[candRegNum] || 0) + 1;
            });
          });

          // ── Bar Chart ────────────────────────────────
          const labels = candidates.map(c => c.name);
          const votes = candidates.map(c => voteCounts[c.regNum] || 0);
          const totalVotes = votes.reduce((a, b) => a + b, 0);

          // ── Category Winners Announcement ────────────
          const winnerBanner = document.getElementById('winner-banner');
          if (election && election.isCompleted && totalVotes > 0) {
            winnerBanner.style.display = 'block';
            const nameEl = document.getElementById('winner-name');
            const statsEl = document.getElementById('winner-stats');
            const badgeEl = document.querySelector('.winner-badge');

            let categoryWinners = {};
            candidates.forEach(c => {
              let cat = c.category || 'General';
              let v = voteCounts[c.regNum] || 0;
              if (!categoryWinners[cat]) categoryWinners[cat] = { max: -1, cands: [] };
              if (v > categoryWinners[cat].max) {
                categoryWinners[cat] = { max: v, cands: [c] };
              } else if (v === categoryWinners[cat].max) {
                categoryWinners[cat].cands.push(c);
              }
            });

            let winHtml = '';
            Object.entries(categoryWinners).forEach(([cat, data]) => {
              if (data.max > 0) {
                let names = data.cands.map(x => (x.symbol || '👤') + ' ' + String(x.name).toUpperCase()).join(' & ');
                let tiedStr = data.cands.length > 1 ? '<span style="color:var(--danger); font-size:0.8rem; margin-left:0.5rem; background:rgba(239,68,68,0.2); padding:0.2rem 0.5rem; border-radius:4px;">TIED</span>' : '';
                winHtml += `<div style="margin-top:0.75rem; padding:0.75rem; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px;">
                     <div style="font-size:0.75rem; color:var(--gold); text-transform:uppercase; letter-spacing:1px; margin-bottom:0.2rem;">${cat}</div>
                     <div style="font-size:1.3rem; font-weight:800; color:white;">${names} ${tiedStr} <span style="font-size:0.9rem; font-weight:normal; color:var(--muted)">(${data.max} votes)</span></div>
                 </div>`;
              }
            });

            setHTML('winner-name', winHtml || "NO WINNERS DECLARED");
            setHTML('winner-stats', `Final Results for <strong>${election.electionName || 'Election'}</strong>`);
            setText('winner-badge', '🏆');

          } else {
            winnerBanner.style.display = 'none';
          }

          // --- Multi-Tier Results Rendering ---
          loadMultiTierElections();

          if (chartInstance) chartInstance.destroy();
          const ctx = document.getElementById('results-chart').getContext('2d');

          if (candidates.length === 0) {
            setHTML('results-chart-container', '<p style="text-align:center;color:var(--muted);padding:2rem;">No candidates registered yet.</p>');
          } else {
            chartInstance = new Chart(ctx, {
              type: 'bar',
              data: {
                labels,
                datasets: [{
                  label: 'Votes Received',
                  data: votes,
                  backgroundColor: labels.map((_, i) => i % 2 === 0 ? 'rgba(255, 42, 77, 0.8)' : 'rgba(255, 255, 255, 0.1)'),
                  borderColor: labels.map((_, i) => i % 2 === 0 ? '#ff2a4d' : '#333333'),
                  borderWidth: 2,
                  borderRadius: 8
                }]
              },
              options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { beginAtZero: true, ticks: { color: '#cbd5e1', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  x: { ticks: { color: '#f8fafc' }, grid: { display: false } }
                }
              }
            });
          }

          // ── Candidate Tally Table ────────────────────
          const tallyEl = document.getElementById('candidate-tally');
          if (candidates.length === 0) {
            setHTML('candidate-tally', '');
          } else {
            // Sort by votes desc
            const ranked = candidates.map((c, i) => ({ ...c, votes: votes[i] })).sort((a, b) => b.votes - a.votes);
            setHTML('candidate-tally', `
        <table>
          <thead><tr>
            <th>#</th><th>Candidate</th><th>Reg No</th><th>Category</th><th>Branch</th>
            <th>Votes</th><th>Share %</th>
          </tr></thead>
          <tbody>
            ${ranked.map((c, i) => `<tr>
              <td><strong style="color:${i === 0 ? 'var(--gold)' : 'var(--muted)'}">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</strong></td>
              <td>
                <div style="font-weight:600;">${c.symbol || ''} ${c.name}</div>
                <div style="font-size:0.78rem;color:var(--muted);">${c.email || ''}</div>
              </td>
              <td><strong>${c.regNum}</strong></td>
              <td style="color:var(--purple);font-size:0.85rem;font-weight:bold;">${c.category || 'GENERAL'}</td>
              <td>${c.branch || '-'}</td>
              <td><strong style="color:var(--cyan);font-size:1.1rem;">${c.votes}</strong></td>
              <td>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                  <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;">
                    <div style="width:${totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0}%;height:100%;background:var(--cyan);border-radius:3px;"></div>
                  </div>
                  <span style="font-size:0.8rem;color:var(--muted);">${totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0}%</span>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        <p style="text-align:right;color:var(--muted);font-size:0.8rem;margin-top:0.75rem;">Total votes cast: <strong style="color:white;">${totalVotes}</strong> / ${canVote} eligible</p>`);
          }
        } catch (e) { toast(e.message, false); }
      }

      async function loadAudit() {
        try {
          const logs = await apiFetch(`/auditLogs?institution=${encodeURIComponent(saSession.institution)}`);
          const tb = document.getElementById('audit-table');
          if (!logs.length) { tb.innerHTML = '<tr><td colspan="4" class="empty">No logs</td></tr>'; return; }
          tb.innerHTML = logs.map(l => `<tr>
      <td style="white-space:nowrap;color:var(--muted);">${new Date(l.timestamp).toLocaleString()}</td>
      <td><strong>${l.action}</strong></td><td>${l.user}</td><td style="color:var(--muted);font-size:0.8rem;">${l.details}</td>
    </tr>`).join('');
        } catch (e) { toast(e.message, false); }
      }

      // Enter key navigation in auth
      document.getElementById('auth-id').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-pass').focus(); } });
      document.getElementById('auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saStep1(); } });
      document.getElementById('auth-otp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saStep2(); } });

      // Real-time input enforcement on auth
      document.getElementById('auth-id').addEventListener('input', function () {
        this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
      });
      document.getElementById('auth-pass').addEventListener('input', function () {
        this.value = this.value.replace(/\s/g, '').slice(0, 10);
      });

      // Real-time enforcement on Admin creation
      document.getElementById('a-id').addEventListener('input', function () {
        this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
      });
      document.getElementById('a-name').addEventListener('input', function () {
        if (this.value.startsWith(' ')) this.value = this.value.trimStart();
        let val = this.value.replace(/[^a-zA-Z\s.]/g, '');
        let parts = val.split('.');
        if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('').replace(/\./g, '');
        this.value = val.slice(0, 30);
      });
      document.getElementById('a-pass').addEventListener('input', function () {
        this.value = this.value.replace(/\s/g, '').slice(0, 8);
      });

      // Real-time enforcement on Sub-Admin creation
      document.getElementById('sa-id').addEventListener('input', function () {
        this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9);
      });
      document.getElementById('sa-name').addEventListener('input', function () {
        if (this.value.startsWith(' ')) this.value = this.value.trimStart();
        let val = this.value.replace(/[^a-zA-Z\s.]/g, '');
        let parts = val.split('.');
        if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('').replace(/\./g, '');
        this.value = val.slice(0, 30);
      });
      document.getElementById('sa-pass').addEventListener('input', function () {
        this.value = this.value.replace(/\s/g, '').slice(0, 6);
      });

      // Initialize tsParticles Cyber Mesh Effect
      tsParticles.load("tsparticles", {
        fpsLimit: 60,
        particles: {
          number: { value: 30, density: { enable: true, value_area: 800 } },
          color: { value: ["#ffffff", "#ff2a4d"] },
          shape: { type: "circle" },
          opacity: { value: 0.2, random: true },
          size: { value: 2, random: true },
          links: { enable: true, distance: 150, color: "#ffffff", opacity: 0.1, width: 1 },
          move: { enable: true, speed: 0.5, direction: "none", random: false, straight: false, outModes: { default: "out" } }
        },
        interactivity: {
          detectsOn: "canvas",
          events: {
            onHover: { enable: true, mode: "grab" },
            resize: true
          },
          modes: {
            grab: { distance: 150, links: { opacity: 0.3 } }
          }
        },
        retina_detect: true,
        background: { color: "transparent" }
      });
      window.promoteSemester = async function () {
        const code = prompt('Type "PROMOTE" to advance students to next semester (Deletes 4Y Sem2)');
        if (code !== 'PROMOTE') {
          toast('Semester promotion cancelled.', false);
          return;
        }
        try {
          const r = await apiFetch('/students/promote-semester', { method: 'POST', body: JSON.stringify({ institution: saSession.institution }) });
          toast(`Successfully promoted semester. Deleted ${r.deleted || 0} graduated students.`);
          loadAll();
        } catch (e) {
          toast(e.message, false);
        }
      };

      window.buildSaScopeHierarchy = function () {
        const years = ['1st', '2nd', '3rd', '4th'];
        let branchMap = {};
        allStudents.forEach(s => {
          if (s.year && s.branch) {
            if (!branchMap[s.year]) branchMap[s.year] = new Set();
            branchMap[s.year].add(s.branch);
          }
        });

        const c = document.getElementById('sa-scope-hierarchy');
        if (!c) return;
        let html = '';
        years.forEach(yy => {
          if (branchMap[yy] && branchMap[yy].size > 0) {
            const branches = Array.from(branchMap[yy]).sort();
            html += `<div style="margin-bottom:0.5rem;">
                <div style="font-weight:bold; margin-bottom:0.3rem; display:flex; align-items:center; gap:0.5rem; cursor:pointer;" onclick="toggleSaY('${yy}')">
                    <span id="sa-icon-${yy}">▶</span> 
                    <input type="checkbox" class="cb-sa-year cb-sa-all" id="cb-sa-y-${yy}" onclick="event.stopPropagation(); checkSaY('${yy}')" checked> ${yy} Year
                </div>
                <div id="sa-hc-${yy}" style="margin-left: 2rem; display: none; flex-direction: column; gap: 0.2rem;">
                    ${branches.map(br => `<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.85rem;color:var(--muted);text-transform:none;"><input type="checkbox" class="cb-sa-branch cb-sa-all cb-sa-y-${yy}" data-year="${yy}" data-branch="${br}" checked> ${br}</label>`).join('')}
                </div>
            </div>`;
          }
        });
        c.innerHTML = html;
      };

      window.toggleSaY = function (yy) {
        const el = document.getElementById(`sa-hc-${yy}`);
        const ic = document.getElementById(`sa-icon-${yy}`);
        if (el.style.display === 'flex') { el.style.display = 'none'; ic.textContent = '▶'; }
        else { el.style.display = 'flex'; ic.textContent = '▼'; }
      };

      window.checkSaY = function (yy) {
        const ycb = document.getElementById(`cb-sa-y-${yy}`);
        document.querySelectorAll(`.cb-sa-y-${yy}`).forEach(cb => cb.checked = ycb.checked);
      };

      window.toggleSaScopeAll = function () {
        const sa = document.getElementById('sa-scope-all').checked;
        document.querySelectorAll('.cb-sa-all').forEach(cb => cb.checked = sa);
      };

      async function loadMultiTierElections() {
        const list = document.getElementById('multi-tier-elections-list');
        try {
          const elections = await apiFetch(`/elections?institution=${encodeURIComponent(saSession.institution)}`);
          if (elections.length === 0) {
            list.innerHTML = '<p class="text-muted" style="grid-column:1/-1; text-align:center;">No specialized elections found.</p>';
            return;
          }

          list.innerHTML = '';
          elections.forEach(async (elec) => {
            const card = document.createElement('div');
            card.className = "card";
            card.style.margin = "0";
            card.style.background = "rgba(255,255,255,0.02)";
            card.style.border = "1px solid rgba(255,255,255,0.05)";

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
                    <div>
                        <h4 style="color:white; margin:0;">${elec.name}</h4>
                        <span style="font-size:0.7rem; color:var(--muted); text-transform:uppercase; letter-spacing:1px;">${elec.type} tier</span>
                    </div>
                    <span class="badge ${elec.isActive ? 'ba' : elec.isCompleted ? 'br' : 'bp'}">${elec.isActive ? 'LIVE' : elec.isCompleted ? 'ENDED' : 'PENDING'}</span>
                </div>
                <div id="results-mini-${elec.id}" style="display:flex; flex-direction:column; gap:0.6rem;">
                    <div class="skeleton" style="height:20px; border-radius:4px;"></div>
                    <div class="skeleton" style="height:20px; border-radius:4px; width:70%;"></div>
                </div>
            `;
            list.appendChild(card);

            // Fetch scoped analytics & results
            try {
              const [stats, resultsObj] = await Promise.all([
                apiFetch(`/elections/${encodeURIComponent(elec.id)}/analytics`),
                StorageManager.fetchElectionResults(elec.id)
              ]);

              const results = resultsObj.results || [];
              const totalVotes = results.reduce((s, r) => s + r.votes, 0);
              const resultsContainer = document.getElementById(`results-mini-${elec.id}`);

              if (results.length === 0) {
                resultsContainer.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">No votes cast yet.</p>';
              } else {
                resultsContainer.innerHTML = results.slice(0, 3).map((r, idx) => {
                  const pct = totalVotes > 0 ? Math.round((r.votes / totalVotes) * 100) : 0;
                  const isWin = idx === 0 && r.votes > 0;
                  return `
                            <div style="font-size:0.8rem;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">
                                    <span>${r.symbol} ${r.name}</span>
                                    <span style="color:var(--gold); font-weight:bold;">${r.votes}</span>
                                </div>
                                <div style="width:100%; height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden;">
                                    <div style="width:${pct}%; height:100%; background:${isWin ? 'var(--gold)' : 'var(--cyan)'};"></div>
                                </div>
                            </div>
                        `;
                }).join('');
                if (results.length > 3) {
                  resultsContainer.innerHTML += `<div style="text-align:center; font-size:0.7rem; color:var(--muted); margin-top:0.4rem;">+ ${results.length - 3} more candidates</div>`;
                }
              }

              const footer = document.createElement('div');
              footer.style.marginTop = '1.2rem';
              footer.style.paddingTop = '1rem';
              footer.style.borderTop = '1px solid rgba(255,255,255,0.05)';
              footer.style.display = 'flex';
              footer.style.justifyContent = 'space-between';
              footer.style.alignItems = 'center';
              footer.innerHTML = `
                    <div style="font-size:0.75rem; color:var(--muted);">Turnout: <strong style="color:white;">${stats.voted}/${stats.allowed}</strong></div>
                    <button class="btn-sm btn-e" style="font-size:0.65rem;" onclick="viewFullResults('${elec.id}')">Full Report 📊</button>
                `;
              card.appendChild(footer);
            } catch (e) { console.error(e); }
          });
        } catch (e) { toast(e.message, false); }
      }

      function viewFullResults(elecId) {
        toast("Opening detailed audit report for " + elecId);
      }

      async function createAdvancedElection() {
        const nm = document.getElementById('v-name').value.trim();
        const start = document.getElementById('v-start').value;
        const end = document.getElementById('v-end').value;
        if (!nm) return toast('Election Name Required', false);

        const isAll = document.getElementById('sa-scope-all').checked;
        const payload = {
          institution: saSession.institution,
          name: nm,
          type: isAll ? 'college' : 'college',
          scope: isAll ? { college: true } : getSaScopeData(),
          startTime: start || null,
          endTime: end || null,
          createdBy: saSession.regNum,
          createdByRole: 'superadmin'
        };

        try {
          const res = await apiFetch('/elections', { method: 'POST', body: JSON.stringify(payload) });
          toast(`Advanced Election created! Code: ${res.electionCode}`);

          await apiFetch(`/config/election_${saSession.institution}`, {
            method: 'POST',
            body: JSON.stringify({ isActive: true, isCompleted: false, name: nm, startTime: payload.startTime, endTime: payload.endTime })
          });
          loadAll();
        } catch (e) { toast(e.message, false); }
      };

      window.loadSystemHealth = async function() {
        try {
          const data = await apiFetch(`/admin/system-health?institution=${encodeURIComponent(saSession.institution)}`);
          const smtpStatus = document.getElementById('stat-smtp-status');
          const smtpBox = document.getElementById('stat-smtp-box');
          
          if (data && data.smtpStatus) {
            if (smtpStatus) { smtpStatus.textContent = "ONLINE"; smtpStatus.style.color = "var(--green)"; }
            if (smtpBox) smtpBox.style.borderBottomColor = "var(--green)";
          } else {
            if (smtpStatus) { smtpStatus.textContent = "OFFLINE"; smtpStatus.style.color = "var(--red)"; }
            if (smtpBox) smtpBox.style.borderBottomColor = "var(--red)";
          }
          
          const count = data.alerts ? data.alerts.length : 0;
          setText('stat-alert-count', count);
          
          const table = document.getElementById('health-alerts-table');
          if (table) {
            if (!data.alerts || data.alerts.length === 0) {
              table.innerHTML = '<tr><td colspan="4" class="empty">No alerts yet. System is healthy.</td></tr>';
            } else {
              table.innerHTML = data.alerts.map(a => `
                <tr>
                  <td style="white-space:nowrap;color:var(--muted);">${new Date(a.timestamp).toLocaleString()}</td>
                  <td><span class="badge ${a.type==='SMTP_FAILURE'?'badge-banned':'badge-active'}">${a.type}</span></td>
                  <td>${a.message}</td>
                  <td style="color:var(--red); font-family:monospace; font-size:0.75rem;">${a.details || '-'}</td>
                </tr>
              `).join('');
            }
          }
        } catch (e) { toast("Health fetch failed: " + e.message, false); }
      };

      window.testSmtpConnection = async function () {
        toast("Sending test email...");
        try {
          await StorageManager.sendEmailOtp(saSession.email, saSession.name, "123456", "SMTP Loopback Test");
          toast("✅ Test email sent successfully!");
          loadSystemHealth();
        } catch (e) {
          toast("❌ Test failed: " + e.message, false);
          loadSystemHealth();
        }
      };

    
/**
 * session-guard.js
 * Single Active Session Enforcement
 * Include in: login.html (call registerSession on login),
 *             subadmin_dashboard.html, admin_dashboard.html, voter portal (call startSessionGuard on load)
 */

const SESSION_TOKEN_KEY = 'ovs_session_token';
const API_BASE = '/api';

/**
 * Called immediately after a successful login.
 * Registers this device as the active session on the server.
 * Stores the returned token in localStorage.
 */
async function registerSession(regNum, institution, portal = 'unknown') {
    try {
        const res = await fetch(`${API_BASE}/session/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regNum, institution, portal })
        });
        const data = await res.json();
        if (data.sessionToken) {
            localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
            console.log('[SessionGuard] Session registered:', data.sessionToken.slice(0, 8) + '...');
        }
    } catch (e) {
        console.warn('[SessionGuard] Could not register session:', e.message);
    }
}

/**
 * Verifies current session is still valid.
 * Returns true if valid, false if replaced by another device.
 */
async function verifySession(regNum, institution) {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!token) return false;
    try {
        const res = await fetch(`${API_BASE}/session/verify`, {
            headers: {
                'x-ovs-reg-num': regNum,
                'x-ovs-institution': encodeURIComponent(institution),
                'x-ovs-session-token': token
            }
        });
        const data = await res.json();
        return data.valid === true;
    } catch (e) {
        console.warn('[SessionGuard] Verify failed (network?):', e.message);
        return true; // Don't log out on network error — benefit of the doubt
    }
}

/**
 * Starts the periodic session checker.
 * logoutFn: function to call when session is invalidated (e.g. redirect to login)
 * intervalMs: how often to check (default 30s)
 */
function startSessionGuard(regNum, institution, logoutFn, intervalMs = 30000) {
    if (!regNum || !institution) return;

    async function check() {
        const valid = await verifySession(regNum, institution);
        if (!valid) {
            console.warn('[SessionGuard] Session replaced by another device. Logging out...');
            localStorage.removeItem(SESSION_TOKEN_KEY);
            if (typeof logoutFn === 'function') logoutFn('session_replaced');
        }
    }

    // First check after 5s (let page settle), then every intervalMs
    setTimeout(check, 5000);
    return setInterval(check, intervalMs);
}

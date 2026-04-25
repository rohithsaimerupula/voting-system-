require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL || "libsql://dummy",
    authToken: process.env.TURSO_AUTH_TOKEN || "dummy",
});



// Basic Middleware for Request Scoping
function authGuard(req, res, next) {
    const regNum = req.headers['x-ovs-reg-num'];
    const institution = decodeURIComponent(req.headers['x-ovs-institution'] || '');
    
    // For now, we just ensure these exist for sensitive operations
    // In a full production app, this would verify a JWT token
    if (!regNum || !institution) {
        // Allow GET config without auth (except sensitive ones)
        if (req.method === 'GET' && req.path.startsWith('/api/config')) return next();
        return res.status(401).json({ error: "Unauthorized: Registration Number and Institution required in headers." });
    }
    next();
}

async function retryWithBackoff(fn, retries = 6, delayMs = 3000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await Promise.race([
                fn(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 25000))
            ]);
        } catch (e) {
            lastError = e;
            if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
            else throw e;
        }
    }
}

const db = {
    execute: (q) => retryWithBackoff(() => turso.execute(q)),
    batch: (q, m) => retryWithBackoff(() => turso.batch(q, m)),
};

async function initDb() {
    try {
        await db.batch([
            `CREATE TABLE IF NOT EXISTS users (regNum TEXT, institution TEXT, password TEXT, role TEXT, name TEXT, email TEXT, status TEXT, branch TEXT, class TEXT, managedBy TEXT, canVote INTEGER DEFAULT 0, hasVoted INTEGER DEFAULT 0, votedFor TEXT, votedAt TEXT, votePhoto TEXT, voteStatus TEXT, voteReceiptHash TEXT, voteFingerprint TEXT, isBanned INTEGER DEFAULT 0, portrait TEXT, webcamReg TEXT, deviceFingerprint TEXT, inviteCode TEXT, campaignPoints INTEGER DEFAULT 0, category TEXT, PRIMARY KEY (regNum, institution))`,
            `CREATE TABLE IF NOT EXISTS auditLogs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, user TEXT, details TEXT, timestamp TEXT, institution TEXT)`,
            `CREATE TABLE IF NOT EXISTS deviceFingerprints (fingerprint TEXT PRIMARY KEY, firstSeen TEXT, lastActive TEXT, counts JSON)`,
            `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value JSON)`,
            `CREATE TABLE IF NOT EXISTS publicLedger (receiptHash TEXT PRIMARY KEY, voterRegNum TEXT, electionCode TEXT, candidateStr TEXT, institution TEXT, timestamp TEXT, status TEXT)`,
            `CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY AUTOINCREMENT, candidateId TEXT, voterName TEXT, question TEXT, answer TEXT, timestamp TEXT, institution TEXT)`,
            `CREATE TABLE IF NOT EXISTS globalChat (id INTEGER PRIMARY KEY AUTOINCREMENT, voterName TEXT, text TEXT, timestamp TEXT, institution TEXT)`,
            `CREATE TABLE IF NOT EXISTS system_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, message TEXT, details TEXT, timestamp TEXT, institution TEXT)`,
            `CREATE TABLE IF NOT EXISTS elections (id TEXT PRIMARY KEY, institution TEXT, name TEXT, type TEXT, scope TEXT, electionCode TEXT, isActive INTEGER DEFAULT 0, isCompleted INTEGER DEFAULT 0, registrationOpen INTEGER DEFAULT 1, startTime TEXT, endTime TEXT, createdBy TEXT, createdByRole TEXT, createdAt TEXT)`
        ], "write");
        console.log("Database initialized.");
    } catch (err) { console.error("Error initializing DB:", err); }
}
initDb();

function boolInt(val) { return val ? 1 : 0; }

app.get('/api/users', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const result = await db.execute({ sql: "SELECT * FROM users WHERE institution = ?", args: [inst] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auditLogs', async (req, res) => {
    try {
        const { action, user, details, timestamp, institution } = req.body;
        await db.execute({
            sql: "INSERT INTO auditLogs (action, user, details, timestamp, institution) VALUES (?, ?, ?, ?, ?)",
            args: [action, user, details, timestamp, institution]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auditLogs', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const result = await db.execute({ sql: "SELECT * FROM auditLogs WHERE institution = ? ORDER BY timestamp DESC LIMIT 100", args: [inst] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/institutions/verify', async (req, res) => {
    try {
        const { code } = req.body;
        const codeMap = { 
            "VIEW2026": "Vignan's Institute of Engineering for Women", 
            "VIIT2026": "Vignan's Institute of Information Technology", 
            "TEST2026": "Test University" 
        };
        const institution = codeMap[code];
        if (institution) res.json({ success: true, institution });
        else res.status(401).json({ error: "Invalid access code." });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/add', async (req, res) => {
    try {
        const u = req.body;
        const inst = u.institution || 'Unknown';
        await db.execute({
            sql: `INSERT INTO users (regNum, institution, password, role, name, email, status, hasVoted, isBanned, portrait, webcamReg, deviceFingerprint, branch, class, managedBy, canVote, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [u.regNum, inst, u.password, u.role, u.name || '', u.email || '', u.status || 'pending', boolInt(u.hasVoted), boolInt(u.isBanned), u.portrait, u.webcamReg, u.deviceFingerprint, u.branch, u.class, u.managedBy, boolInt(u.canVote), u.category]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        let result = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [req.params.id, inst] });
        
        // Developer global fallback check
        if (result.rows.length === 0 && !inst && req.params.id === 'OVS-CORE-ROOT') {
            result = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND role = 'developer'", args: [req.params.id] });
        }
        
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dev/stats', async (req, res) => {
    try {
        const allUsers = await db.execute({ sql: "SELECT * FROM users" });
        const superAdmins = allUsers.rows.filter(u => u.role === 'superadmin');
        const insts = new Set(allUsers.rows.filter(u => u.institution && u.institution !== 'Unknown' && u.institution !== 'Global').map(u => u.institution));
        const instCount = insts.size;
        
        res.json({
            counts: { saCount: superAdmins.length, instCount, studentCount: allUsers.rows.length },
            superAdmins,
            institutions: Array.from(insts)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/orphans', async (req, res) => {
    try {
        const validInstsResult = await db.execute({ sql: "SELECT DISTINCT institution FROM users WHERE role = 'superadmin'" });
        const validInsts = validInstsResult.rows.map(r => r.institution);
        
        if (validInsts.length === 0) {
            return res.json({ rowsAffected: 0, message: "No valid institutions found to anchor data." });
        }
        
        const placeholders = validInsts.map(() => '?').join(',');
        const result = await db.execute({ 
            sql: `DELETE FROM users WHERE institution NOT IN (${placeholders}) AND role != 'developer'`, 
            args: validInsts 
        });
        
        res.json({ success: true, rowsAffected: result.rowsAffected });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        await db.execute({ sql: "DELETE FROM users WHERE regNum = ? AND institution = ?", args: [req.params.id, inst] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/role/:role', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        await db.execute({ sql: "DELETE FROM users WHERE role = ? AND institution = ?", args: [req.params.role, inst] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const updates = req.body;
        const inst = decodeURIComponent(req.query.institution || '');
        const keys = Object.keys(updates);
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => typeof updates[k] === 'boolean' ? boolInt(updates[k]) : updates[k]);
        values.push(req.params.id, inst);
        await db.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ? AND institution = ?`, args: values });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/deviceFingerprints/:fp', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT * FROM deviceFingerprints WHERE fingerprint = ?", args: [req.params.fp] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const row = result.rows[0];
        res.json({ ...row, counts: JSON.parse(row.counts || '{}') });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deviceFingerprints', async (req, res) => {
    try {
        const { fingerprint, firstSeen, lastActive, counts } = req.body;
        await db.execute({
            sql: "INSERT INTO deviceFingerprints (fingerprint, firstSeen, lastActive, counts) VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET lastActive = excluded.lastActive, counts = excluded.counts",
            args: [fingerprint, firstSeen, lastActive, JSON.stringify(counts)]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, name, otp, context } = req.body;
        if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });

        // --- BREVO API DELIVERY ---
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json',
                'accept': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: "Vanguard Security", email: process.env.SMTP_FROM || "security@ovs-vanguard.com" },
                to: [{ email, name }],
                subject: `${context || 'Verification Code'} — OVS`,
                htmlContent: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px;"><h2>Vanguard Voting</h2><p>Hello <strong>${name || 'User'}</strong>,</p><p>Your verification code for <strong>${context || 'Secure Activity'}</strong> is:</p><div style="background:#f4f4f4;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:5px;border-radius:5px;">${otp}</div><p style="color:#666;font-size:12px;">This code expires in 10 minutes.</p></div>`
            })
        });
        
        if (brevoRes.ok) return res.json({ success: true });
        
        const brevoErr = await brevoRes.json();
        console.error("[BREVO_FAIL]", brevoErr);
        res.status(500).json({ error: `Brevo API Error: ${brevoErr.message || 'Check API Key'}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/system-health', authGuard, async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const alerts = await db.execute({ sql: "SELECT * FROM system_alerts WHERE (institution = ? OR institution = 'Global') AND type != 'OTP_GENERATED' ORDER BY timestamp DESC LIMIT 20", args: [inst] });
        res.json({ alerts: alerts.rows, smtpStatus: !!process.env.BREVO_API_KEY });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vote', authGuard, async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp, institution, electionCode } = req.body;
        
        // Server-side validation: Check if user already voted or is banned
        const userCheck = await db.execute({ sql: "SELECT isBanned, status FROM users WHERE regNum = ? AND institution = ?", args: [voterRegNum, institution] });
        if (userCheck.rows.length === 0) return res.status(404).json({ error: "Voter not found" });
        const user = userCheck.rows[0];
        
        if (user.isBanned) return res.status(403).json({ error: "You are banned from voting." });
        if (user.status !== 'active') return res.status(403).json({ error: "You are not authorized to vote yet. Please wait for admin approval." });

        const ledgerCheck = await db.execute({ sql: "SELECT 1 FROM publicLedger WHERE voterRegNum = ? AND institution = ? AND (electionCode = ? OR electionCode = 'global')", args: [voterRegNum, institution, electionCode || 'global'] });
        if (ledgerCheck.rows.length > 0) return res.status(400).json({ error: "You have already cast your vote in this election." });

        await db.execute({
            sql: "INSERT INTO publicLedger (receiptHash, voterRegNum, electionCode, candidateStr, institution, timestamp, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            args: [secureHash, voterRegNum, electionCode || 'global', typeof candidateRegNum === 'object' ? JSON.stringify(candidateRegNum) : candidateRegNum, institution, timestamp, 'pending']
        });
        await db.execute({
            sql: "UPDATE users SET hasVoted = 1, votedFor = ?, votePhoto = ?, voteStatus = 'pending', voteReceiptHash = ? WHERE regNum = ? AND institution = ?",
            args: [typeof candidateRegNum === 'object' ? JSON.stringify(candidateRegNum) : candidateRegNum, votePhoto, secureHash, voterRegNum, institution]
        });
        res.json({ success: true, receipt: secureHash });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/questions', async (req, res) => {
    try {
        const { candidateId, voterName, question, timestamp, institution } = req.body;
        await db.execute({
            sql: "INSERT INTO questions (candidateId, voterName, question, timestamp, institution) VALUES (?, ?, ?, ?, ?)",
            args: [candidateId, voterName, question, timestamp, institution]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/questions/:candidateId', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const result = await db.execute({ sql: "SELECT * FROM questions WHERE candidateId = ? AND institution = ?", args: [req.params.candidateId, inst] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/questions/:id', async (req, res) => {
    try {
        const { answer } = req.body;
        const inst = decodeURIComponent(req.query.institution || '');
        await db.execute({ sql: "UPDATE questions SET answer = ? WHERE id = ? AND institution = ?", args: [answer, req.params.id, inst] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/globalChat', async (req, res) => {
    try {
        const { voterName, text, timestamp, institution } = req.body;
        await db.execute({
            sql: "INSERT INTO globalChat (voterName, text, timestamp, institution) VALUES (?, ?, ?, ?)",
            args: [voterName, text, timestamp, institution]
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/globalChat', async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const result = await db.execute({ sql: "SELECT * FROM globalChat WHERE institution = ? ORDER BY id DESC LIMIT 50", args: [inst] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/election/reset', async (req, res) => {
    try {
        const { institution } = req.body;
        await db.batch([
            { sql: "DELETE FROM publicLedger WHERE institution = ?", args: [institution] },
            { sql: "UPDATE users SET hasVoted = 0, votedFor = NULL, votePhoto = NULL, voteStatus = NULL, voteReceiptHash = NULL WHERE institution = ?", args: [institution] }
        ], "write");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/my-elections', authGuard, async (req, res) => {
    try {
        const inst = decodeURIComponent(req.query.institution || '');
        const regNum = req.query.regNum;
        
        // Find elections for this institution
        const elections = await db.execute({ sql: "SELECT * FROM elections WHERE institution = ? AND isActive = 1", args: [inst] });
        
        // Find if user has already voted in these elections
        const votes = await db.execute({ sql: "SELECT electionCode FROM publicLedger WHERE voterRegNum = ? AND institution = ?", args: [regNum, inst] });
        const votedCodes = new Set(votes.rows.map(v => v.electionCode));

        const result = elections.rows.map(e => ({
            ...e,
            hasVoted: votedCodes.has(e.id) || votedCodes.has(e.electionCode) || votedCodes.has('global')
        }));

        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/eligible', async (req, res) => {
    try {
        const elections = await db.execute({ sql: "SELECT * FROM elections WHERE institution = ? AND isActive = 1", args: [req.query.institution] });
        res.json(elections.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config/:key', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [req.params.key] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(JSON.parse(result.rows[0].value));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/:key', authGuard, async (req, res) => {
    try {
        const { data } = req.body;
        await db.execute({ sql: "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [req.params.key, JSON.stringify(data)] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/elections', async (req, res) => {
    try {
        const result = await db.execute({ sql: 'SELECT * FROM elections WHERE institution = ?', args: [req.query.institution] });
        res.json(result.rows.map(r => ({ ...r, scope: JSON.parse(r.scope || '{}') })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/elections', async (req, res) => {
    try {
        const { institution, name, type, scope, createdBy } = req.body;
        const id = `ELC-${Date.now()}`;
        const electionCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        await db.execute({
            sql: `INSERT INTO elections (id, institution, name, type, scope, electionCode, createdAt, createdBy) VALUES (?,?,?,?,?,?,?,?)`,
            args: [id, institution, name, type, JSON.stringify(scope || {}), electionCode, new Date().toISOString(), createdBy]
        });
        res.json({ success: true, id, electionCode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT * FROM users WHERE role = 'contestant' AND status = 'active' AND institution = ?", args: [req.query.institution] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

if (process.env.VERCEL !== '1') {
    app.listen(PORT, '0.0.0.0', () => console.log(`[VANGUARD] Running on port ${PORT}`));
}

module.exports = app;

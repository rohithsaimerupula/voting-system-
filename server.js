require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
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

const transporter = nodemailer.createTransport({
    pool: true, // Maintain persistent connections
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 20000, // 20s timeout
});

if (process.env.SMTP_USER && process.env.SMTP_USER !== 'your_sender_net_username') {
    transporter.verify((error) => {
        if (error) console.error("[SMTP] Configuration Error:", error.message);
        else console.log("[SMTP] Connection established!");
    });
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
        const inst = req.query.institution;
        const result = await db.execute({ sql: "SELECT * FROM users WHERE institution = ?", args: [decodeURIComponent(inst)] });
        res.json(result.rows);
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
        const inst = req.query.institution;
        const result = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [req.params.id, inst] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const updates = req.body;
        const keys = Object.keys(updates);
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => typeof updates[k] === 'boolean' ? boolInt(updates[k]) : updates[k]);
        values.push(req.params.id, req.query.institution);
        await db.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ? AND institution = ?`, args: values });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, name, otp, context, institution } = req.body;
        if (!email || !otp) return res.status(400).json({ error: "Email and OTP required" });
        if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_sender_net_username') {
            console.log(`[DEV_OTP] ${email}: ${otp}`);
            return res.json({ success: true, warning: "System in Developer Mode: OTP logged to server console." });
        }
        
        const mailOptions = {
            from: `"Vanguard Security" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: email,
            subject: `${context || 'Verification Code'} — OVS`,
            html: `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px;"><h2>Vanguard Voting</h2><p>Hello <strong>${name||'User'}</strong>,</p><p>Your verification code for <strong>${context||'Secure Activity'}</strong> is:</p><div style="background:#f4f4f4;padding:20px;text-align:center;font-size:32px;font-weight:bold;letter-spacing:5px;border-radius:5px;">${otp}</div><p style="color:#666;font-size:12px;">This code expires in 10 minutes.</p></div>`
        };

        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await transporter.sendMail(mailOptions);
                return res.json({ success: true });
            } catch (err) {
                lastError = err;
                console.warn(`[SMTP] Attempt ${attempt} failed: ${err.message}`);
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
            }
        }

        // Final failure: Log to DB for Super Admin visibility
        await db.execute({
            sql: "INSERT INTO system_alerts (type, message, details, timestamp, institution) VALUES (?, ?, ?, ?, ?)",
            args: ["SMTP_FAILURE", `Failed to delivery OTP to ${email}`, lastError.message, new Date().toISOString(), institution || "Global"]
        });

        res.status(500).json({ error: `SMTP_FAIL: ${lastError.message}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/system-health', async (req, res) => {
    try {
        const inst = req.query.institution;
        const alerts = await db.execute({ sql: "SELECT * FROM system_alerts WHERE institution = ? OR institution = 'Global' ORDER BY timestamp DESC LIMIT 20", args: [inst] });
        res.json({ alerts: alerts.rows, smtpStatus: !!process.env.SMTP_USER });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vote', async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp, institution, electionCode } = req.body;
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

app.post('/api/config/:key', async (req, res) => {
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

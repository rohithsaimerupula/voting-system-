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
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─────────────────────────────────────────
//  DATABASE INIT
// ─────────────────────────────────────────
async function initDb() {
    try {
        // Main users table with new hierarchy columns
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS users (
                regNum TEXT PRIMARY KEY,
                password TEXT,
                role TEXT,       -- developer | superadmin | admin | subadmin | voter | contestant
                name TEXT,
                email TEXT,
                status TEXT,     -- active | pending | rejected
                institution TEXT,
                branch TEXT,     -- for admin/subadmin/voter
                class TEXT,      -- for subadmin/voter
                managedBy TEXT,  -- regNum of the admin who manages a subadmin
                canVote INTEGER DEFAULT 0,
                hasVoted INTEGER DEFAULT 0,
                votedFor TEXT,
                votedAt TEXT,
                votePhoto TEXT,
                voteStatus TEXT,
                voteReceiptHash TEXT,
                voteFingerprint TEXT,
                isBanned INTEGER DEFAULT 0,
                portrait TEXT,
                webcamReg TEXT,
                deviceFingerprint TEXT,
                inviteCode TEXT,
                campaignPoints INTEGER DEFAULT 0
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS auditLogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                user TEXT,
                details TEXT,
                timestamp TEXT
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS deviceFingerprints (
                fingerprint TEXT PRIMARY KEY,
                firstSeen TEXT,
                lastActive TEXT,
                counts JSON
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value JSON
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS publicLedger (
                receiptHash TEXT PRIMARY KEY,
                timestamp TEXT,
                status TEXT
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidateId TEXT,
                voterName TEXT,
                question TEXT,
                answer TEXT,
                timestamp TEXT
            )
        `);
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS globalChat (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voterName TEXT,
                text TEXT,
                timestamp TEXT
            )
        `);

        // --- Migrate existing users table: add new columns if missing ---
        const newColumns = [
            `ALTER TABLE users ADD COLUMN institution TEXT`,
            `ALTER TABLE users ADD COLUMN branch TEXT`,
            `ALTER TABLE users ADD COLUMN "class" TEXT`,
            `ALTER TABLE users ADD COLUMN managedBy TEXT`,
            `ALTER TABLE users ADD COLUMN canVote INTEGER DEFAULT 0`,
            `ALTER TABLE users ADD COLUMN votedAt TEXT`,
            `ALTER TABLE users ADD COLUMN votePhoto TEXT`,
            `ALTER TABLE users ADD COLUMN voteStatus TEXT`,
            `ALTER TABLE users ADD COLUMN voteReceiptHash TEXT`,
            `ALTER TABLE users ADD COLUMN voteFingerprint TEXT`,
        ];
        for (const sql of newColumns) {
            try { await turso.execute(sql); } catch (e) { /* Column already exists, skip */ }
        }

        console.log("Database tables initialized successfully.");

        // Default election config
        const configSnap = await turso.execute("SELECT * FROM config WHERE key = 'election'");
        if (configSnap.rows.length === 0) {
            await turso.execute({ sql: "INSERT INTO config (key, value) VALUES ('election', ?)", args: [JSON.stringify({ isActive: false, isCompleted: false, startTime: null, endTime: null })] });
        }

        // Developer (GOD) account
        const devSnap = await turso.execute("SELECT * FROM users WHERE role = 'developer'");
        if (devSnap.rows.length === 0) {
            await turso.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status) VALUES (?, ?, ?, ?, ?, ?)`,
                args: ['OVSDEV2026', Buffer.from('OvsDev@2026!').toString('base64'), 'developer', 'OVS Developer', 'admin@ovs.com', 'active']
            });
            console.log("Developer account created: OVSDEV2026 / OvsDev@2026!");
        } else if (devSnap.rows[0].regNum === 'DEV001') {
            // Upgrade existing legacy developer account to new rules
            await turso.execute({
                sql: `UPDATE users SET regNum = 'OVSDEV2026', password = ? WHERE role = 'developer'`,
                args: [Buffer.from('OvsDev@2026!').toString('base64')]
            });
            console.log("Developer account upgraded to: OVSDEV2026 / OvsDev@2026!");
        }

        // Default Super Admin (for legacy institution)
        const saSnap = await turso.execute("SELECT * FROM users WHERE role = 'superadmin'");
        if (saSnap.rows.length === 0) {
            await turso.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['OVSADM001', Buffer.from('OvsAdm@123').toString('base64'), 'superadmin', 'Super Admin', 'tharunmerupula01@gmail.com', 'active', 'Default Institution']
            });
            console.log("Super Admin account created: OVSADM001 / OvsAdm@12");
        } else {
            // Upgrade SADMIN001 if still present
            const oldSA = saSnap.rows.find(r => r.regNum === 'SADMIN001');
            if (oldSA) {
                await turso.execute({
                    sql: `UPDATE users SET regNum = 'OVSADM001', password = ? WHERE regNum = 'SADMIN001'`,
                    args: [Buffer.from('OvsAdm@123').toString('base64')]
                });
                console.log("Super Admin upgraded to: OVSADM001 / OvsAdm@12");
            }
        }

        // Keep old ADMIN001 but mark as superadmin for backwards compat
        const adminSnap = await turso.execute("SELECT * FROM users WHERE regNum = 'ADMIN001'");
        if (adminSnap.rows.length > 0 && adminSnap.rows[0].role === 'admin') {
            await turso.execute({ sql: "UPDATE users SET role = 'superadmin', institution = 'Default Institution' WHERE regNum = 'ADMIN001'", args: [] });
            console.log("Upgraded ADMIN001 to superadmin role.");
        } else if (adminSnap.rows.length === 0) {
            await turso.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['ADMIN001', Buffer.from('Admin123').toString('base64'), 'superadmin', 'Super Admin', 'tharunmerupula01@gmail.com', 'active', 'Default Institution']
            });
            console.log("Default Super Admin created: ADMIN001 / Admin123");
        }

    } catch (err) {
        console.error("Error initializing DB:", err);
    }
}
initDb();

// ─────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────
function boolInt(val) { return val ? 1 : 0; }

// ─────────────────────────────────────────
//  USER ENDPOINTS
// ─────────────────────────────────────────
app.get('/api/users', async (req, res) => {
    try {
        const result = await turso.execute("SELECT * FROM users");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/add', async (req, res) => {
    try {
        const u = req.body;
        await turso.execute({
            sql: `INSERT INTO users (regNum, password, role, name, email, status, hasVoted, isBanned, portrait, webcamReg, deviceFingerprint, inviteCode, campaignPoints, institution, branch, class, managedBy, canVote)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                u.regNum, u.password, u.role, u.name || '', u.email || '', u.status || 'pending',
                boolInt(u.hasVoted), boolInt(u.isBanned), u.portrait || null, u.webcamReg || null,
                u.deviceFingerprint || null, u.inviteCode || null, u.campaignPoints || 0,
                u.institution || null, u.branch || null, u.class || null, u.managedBy || null,
                boolInt(u.canVote)
            ]
        });
        res.json({ success: true });
    } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) return res.status(400).json({ error: "Registration Number already exists." });
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const result = await turso.execute({ sql: "SELECT * FROM users WHERE regNum = ?", args: [req.params.id] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const updates = req.body;
        const keys = Object.keys(updates);
        if (keys.length === 0) return res.json({ success: true });
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => { const v = updates[k]; return typeof v === 'boolean' ? boolInt(v) : v; });
        values.push(req.params.id);
        await turso.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ?`, args: values });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        await turso.execute({ sql: "DELETE FROM users WHERE regNum = ?", args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/role/:role', async (req, res) => {
    try {
        await turso.execute({ sql: "DELETE FROM users WHERE role = ?", args: [req.params.role] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  STAFF ENDPOINTS (admin / subadmin management)
// ─────────────────────────────────────────

// Get all staff for an institution (superadmin use)
app.get('/api/staff/:institution', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: "SELECT * FROM users WHERE institution = ? AND role IN ('admin','subadmin')",
            args: [decodeURIComponent(req.params.institution)]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get subadmins managed by a specific admin
app.get('/api/staff/managed-by/:adminId', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: "SELECT * FROM users WHERE managedBy = ? AND role = 'subadmin'",
            args: [req.params.adminId]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get all Super Admins (developer use)
app.get('/api/superadmins', async (req, res) => {
    try {
        const result = await turso.execute("SELECT * FROM users WHERE role = 'superadmin'");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  VOTERS ENDPOINTS
// ─────────────────────────────────────────

// Get voters by class (subadmin/admin use)
app.get('/api/voters/by-class/:class', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: "SELECT * FROM users WHERE class = ? AND role IN ('voter','contestant')",
            args: [decodeURIComponent(req.params.class)]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get voters by branch (admin use)
app.get('/api/voters/by-branch/:branch', async (req, res) => {
    try {
        const result = await turso.execute({
            sql: "SELECT * FROM users WHERE branch = ? AND role IN ('voter','contestant')",
            args: [decodeURIComponent(req.params.branch)]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark canVote for a voter
app.post('/api/voters/can-vote', async (req, res) => {
    try {
        const { regNum, canVote } = req.body;
        await turso.execute({ sql: "UPDATE users SET canVote = ? WHERE regNum = ?", args: [boolInt(canVote), regNum] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk mark canVote for array of regNums
app.post('/api/voters/can-vote-bulk', async (req, res) => {
    try {
        const { regNums, canVote } = req.body;
        for (const r of regNums) {
            await turso.execute({ sql: "UPDATE users SET canVote = ? WHERE regNum = ?", args: [boolInt(canVote), r] });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  AUDIT LOGS
// ─────────────────────────────────────────
app.post('/api/auditLogs', async (req, res) => {
    try {
        const { action, user, details, timestamp } = req.body;
        await turso.execute({ sql: "INSERT INTO auditLogs (action, user, details, timestamp) VALUES (?, ?, ?, ?)", args: [action, user, details || "", timestamp] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auditLogs', async (req, res) => {
    try {
        const result = await turso.execute("SELECT * FROM auditLogs ORDER BY timestamp DESC LIMIT 200");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  DEVICE FINGERPRINTS
// ─────────────────────────────────────────
app.get('/api/deviceFingerprints/:id', async (req, res) => {
    try {
        const result = await turso.execute({ sql: "SELECT * FROM deviceFingerprints WHERE fingerprint = ?", args: [req.params.id] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const row = result.rows[0];
        row.counts = JSON.parse(row.counts);
        res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deviceFingerprints', async (req, res) => {
    try {
        const fp = req.body;
        await turso.execute({ sql: "INSERT INTO deviceFingerprints (fingerprint, firstSeen, lastActive, counts) VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET lastActive = excluded.lastActive, counts = excluded.counts", args: [fp.fingerprint, fp.firstSeen, fp.lastActive, JSON.stringify(fp.counts)] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
app.get('/api/config/:key', async (req, res) => {
    try {
        const result = await turso.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [req.params.key] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(JSON.parse(result.rows[0].value));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/:key', async (req, res) => {
    try {
        const { merge, data } = req.body;
        if (merge) {
            const result = await turso.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [req.params.key] });
            let existing = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : {};
            let updated = { ...existing, ...data };
            await turso.execute({ sql: "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [req.params.key, JSON.stringify(updated)] });
            res.json({ success: true, data: updated });
        } else {
            await turso.execute({ sql: "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [req.params.key, JSON.stringify(data)] });
            res.json({ success: true, data });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  ELECTION
// ─────────────────────────────────────────
app.post('/api/election/reset', async (req, res) => {
    try {
        await turso.execute({ sql: "UPDATE config SET value = ? WHERE key = 'election'", args: [JSON.stringify({ isCompleted: false, isActive: false, startTime: null, endTime: null })] });
        await turso.execute("UPDATE users SET hasVoted = 0, votedFor = NULL, voteStatus = NULL WHERE role IN ('voter','contestant')");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const result = await turso.execute("SELECT * FROM users WHERE role = 'contestant' AND status = 'active'");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  VOTE (with canVote gate)
// ─────────────────────────────────────────
app.post('/api/vote', async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp } = req.body;
        const voterResult = await turso.execute({ sql: "SELECT * FROM users WHERE regNum = ?", args: [voterRegNum] });
        if (voterResult.rows.length === 0) return res.status(404).json({ error: "Voter does not exist" });
        const v = voterResult.rows[0];

        if (!v.canVote || v.canVote === 0) return res.status(403).json({ error: "ACCESS_DENIED: Admin/Sub-Admin has not given you access yet!" });
        if (v.hasVoted === 1) return res.status(400).json({ error: "You have already voted!" });
        if (v.isBanned === 1) return res.status(403).json({ error: "Voting rights suspended." });

        await turso.execute({
            sql: `UPDATE users SET hasVoted = 1, votedFor = ?, votedAt = ?, votePhoto = ?, status = 'pending_vote_verification', voteStatus = 'pending', voteReceiptHash = ?, voteFingerprint = ? WHERE regNum = ?`,
            args: [candidateRegNum, timestamp, votePhoto, secureHash, fp, voterRegNum]
        });
        await turso.execute({ sql: "INSERT INTO publicLedger (receiptHash, timestamp, status) VALUES (?, ?, 'pending_verification')", args: [secureHash, timestamp] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  QUESTIONS
// ─────────────────────────────────────────
app.get('/api/questions/:candidateId', async (req, res) => {
    try {
        const result = await turso.execute({ sql: "SELECT * FROM questions WHERE candidateId = ? ORDER BY timestamp DESC", args: [req.params.candidateId] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/questions', async (req, res) => {
    try {
        const { candidateId, voterName, question, timestamp } = req.body;
        const result = await turso.execute({ sql: "INSERT INTO questions (candidateId, voterName, question, timestamp) VALUES (?, ?, ?, ?)", args: [candidateId, voterName, question, timestamp] });
        res.json({ success: true, id: result.lastInsertRowid.toString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/questions/:id', async (req, res) => {
    try {
        await turso.execute({ sql: "UPDATE questions SET answer = ? WHERE id = ?", args: [req.body.answer, req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  GLOBAL CHAT
// ─────────────────────────────────────────
app.get('/api/globalChat', async (req, res) => {
    try {
        const result = await turso.execute("SELECT * FROM globalChat ORDER BY timestamp DESC LIMIT 50");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/globalChat', async (req, res) => {
    try {
        const { voterName, text, timestamp } = req.body;
        const result = await turso.execute({ sql: "INSERT INTO globalChat (voterName, text, timestamp) VALUES (?, ?, ?)", args: [voterName, text, timestamp] });
        res.json({ success: true, id: result.lastInsertRowid.toString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;

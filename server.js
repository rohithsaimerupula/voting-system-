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

// ─────────────────────────────────────────
//  DB RETRY WRAPPER (handles Turso cold-start sleeps)
// ─────────────────────────────────────────
async function retryWithBackoff(fn, retries = 3, delayMs = 3000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('DB_TIMEOUT')), 20000)
                )
            ]);
            return result;
        } catch (e) {
            const isTimeout = e.message.includes('DB_TIMEOUT') || e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed');
            if (isTimeout && attempt < retries) {
                console.warn(`[DB] Attempt ${attempt} failed (cold start?). Retrying in ${delayMs * attempt}ms...`);
                await new Promise(r => setTimeout(r, delayMs * attempt));
            } else {
                throw new Error(`DB_TIMEOUT: Turso did not respond after ${retries} attempts. Please try again in a moment.`);
            }
        }
    }
}

const db = {
    execute: (q) => retryWithBackoff(() => turso.execute(q)),
    batch:   (q, m) => retryWithBackoff(() => turso.batch(q, m)),
};

// ─────────────────────────────────────────
//  DATABASE INIT
// ─────────────────────────────────────────
async function initDb() {
    try {
        // Main users table with new hierarchy columns
        await db.batch([
            `CREATE TABLE IF NOT EXISTS users (
                regNum TEXT,
                institution TEXT,
                password TEXT,
                role TEXT,       -- developer | superadmin | admin | subadmin | voter | contestant
                name TEXT,
                email TEXT,
                status TEXT,     -- active | pending | rejected
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
                campaignPoints INTEGER DEFAULT 0,
                PRIMARY KEY (regNum, institution)
            )`,
            `CREATE TABLE IF NOT EXISTS auditLogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT,
                user TEXT,
                details TEXT,
                timestamp TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS deviceFingerprints (
                fingerprint TEXT PRIMARY KEY,
                firstSeen TEXT,
                lastActive TEXT,
                counts JSON
            )`,
            `CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value JSON
            )`,
            `CREATE TABLE IF NOT EXISTS publicLedger (
                receiptHash TEXT PRIMARY KEY,
                timestamp TEXT,
                status TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidateId TEXT,
                voterName TEXT,
                question TEXT,
                answer TEXT,
                timestamp TEXT
            )`,
            `CREATE TABLE IF NOT EXISTS globalChat (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voterName TEXT,
                text TEXT,
                timestamp TEXT
            )`
        ], "write");

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
            `ALTER TABLE users ADD COLUMN year TEXT`,
        ];
        for (const sql of newColumns) {
            try { await db.execute(sql); } catch (e) { /* Column already exists, skip */ }
        }

        // --- Audit Logs Migration ---
        try {
            await db.execute("ALTER TABLE auditLogs ADD COLUMN institution TEXT");
        } catch (e) { /* Already exists */ }

        console.log("Database tables initialized successfully.");

        // Default election config
        const configSnap = await db.execute("SELECT * FROM config WHERE key = 'election'");
        if (configSnap.rows.length === 0) {
            await db.execute({ sql: "INSERT INTO config (key, value) VALUES ('election', ?)", args: [JSON.stringify({ isActive: false, isCompleted: false, startTime: null, endTime: null })] });
        }

        // Developer (GOD) account
        const devSnap = await db.execute("SELECT * FROM users WHERE role = 'developer'");
        if (devSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status) VALUES (?, ?, ?, ?, ?, ?)`,
                args: ['OVSDEV2026', Buffer.from('OvsDev@2026!').toString('base64'), 'developer', 'OVS Developer', 'admin@ovs.com', 'active']
            });
            console.log("Developer account created: OVSDEV2026 / OvsDev@2026!");
        } else if (devSnap.rows[0].regNum === 'DEV001') {
            // Upgrade existing legacy developer account to new rules
            await db.execute({
                sql: `UPDATE users SET regNum = 'OVSDEV2026', password = ? WHERE role = 'developer'`,
                args: [Buffer.from('OvsDev@2026!').toString('base64')]
            });
            console.log("Developer account upgraded to: OVSDEV2026 / OvsDev@2026!");
        }

        // Default Super Admin (for legacy institution)
        const saSnap = await db.execute("SELECT * FROM users WHERE role = 'superadmin'");
        if (saSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['OVSADM001', Buffer.from('OvsAdm@123').toString('base64'), 'superadmin', 'Super Admin', 'tharunmerupula01@gmail.com', 'active', 'Default Institution']
            });
            console.log("Super Admin account created: OVSADM001 / OvsAdm@12");
        }

        // Keep old ADMIN001 but mark as superadmin for backwards compat
        const adminSnap = await db.execute("SELECT * FROM users WHERE regNum = 'ADMIN001'");
        if (adminSnap.rows.length > 0 && adminSnap.rows[0].role === 'admin') {
            await db.execute({ sql: "UPDATE users SET role = 'superadmin', institution = 'Default Institution' WHERE regNum = 'ADMIN001'", args: [] });
            console.log("Upgraded ADMIN001 to superadmin role.");
        } else if (adminSnap.rows.length === 0) {
            await db.execute({
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
        const result = await db.execute("SELECT * FROM users");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/add', async (req, res) => {
    try {
        const u = req.body;
        const inst = u.institution || 'Unknown';
        await db.execute({
            sql: `INSERT INTO users (regNum, institution, password, role, name, email, status, hasVoted, isBanned, portrait, webcamReg, deviceFingerprint, inviteCode, campaignPoints, branch, class, managedBy, canVote, year)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                u.regNum, inst, u.password, u.role, u.name || '', u.email || '', u.status || 'pending',
                boolInt(u.hasVoted), boolInt(u.isBanned), u.portrait || null, u.webcamReg || null,
                u.deviceFingerprint || null, u.inviteCode || null, u.campaignPoints || 0,
                u.branch || null, u.class || null, u.managedBy || null,
                boolInt(u.canVote), u.year || null
            ]
        });
        res.json({ success: true });
    } catch (e) {
        if (e.message.includes('unique constraint') || e.message.includes('PRIMARY KEY')) 
            return res.status(400).json({ error: "Registration Number already exists at this institution." });
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const regNum = req.params.id;
        const institution = req.query.institution;
        
        let sql = "SELECT * FROM users WHERE regNum = ?";
        let args = [regNum];
        
        if (institution) {
            sql += " AND institution = ?";
            args.push(institution);
        }

        const result = await db.execute({ sql, args });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        
        // If multiple matches and no institution provided, warn but return first
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const regNum = req.params.id;
        const institution = req.query.institution;
        const updates = req.body;
        
        if (!institution) return res.status(400).json({ error: "Institution required for identification" });
        
        const keys = Object.keys(updates);
        if (keys.length === 0) return res.json({ success: true });
        
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => { const v = updates[k]; return typeof v === 'boolean' ? boolInt(v) : v; });
        
        values.push(regNum, institution);
        await db.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ? AND institution = ?`, args: values });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const institution = req.query.institution;

        if (!institution) return res.status(400).json({ error: "Institution required for deletion" });

        // Check if this user is a Super Admin — if so, cascade-delete entire institution
        const userResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [id, institution] });
        if (userResult.rows.length > 0 && userResult.rows[0].role === 'superadmin') {
            const institution = userResult.rows[0].institution;

            if (institution) {
                // 1. Delete ALL users belonging to this institution (admins, sub-admins, voters, contestants)
                await db.execute({ sql: "DELETE FROM users WHERE institution = ? AND role != 'developer'", args: [institution] });

                // 2. Delete the institution's election config key
                await db.execute({ sql: "DELETE FROM config WHERE key = ?", args: ['election_' + institution] });

                // 3. Remove this institution's gateway code from institution_codes
                const codesResult = await db.execute({ sql: "SELECT value FROM config WHERE key = 'institution_codes'", args: [] });
                if (codesResult.rows.length > 0) {
                    const codes = JSON.parse(codesResult.rows[0].value);
                    // Remove all codes that map to this institution
                    Object.keys(codes).forEach(k => { if (codes[k] === institution) delete codes[k]; });
                    await db.execute({ sql: "UPDATE config SET value = ? WHERE key = 'institution_codes'", args: [JSON.stringify(codes)] });
                }

                return res.json({ success: true, cascadeDeleted: true, institution });
            }
        }

        // Regular (non-super-admin) delete — just remove the single user
        await db.execute({ sql: "DELETE FROM users WHERE regNum = ? AND institution = ?", args: [id, institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/orphans', async (req, res) => {
    try {
        const result = await db.execute({ 
            sql: "DELETE FROM users WHERE role != 'developer' AND role != 'superadmin' AND (institution IS NULL OR institution = '' OR institution = 'Unknown')", 
            args: [] 
        });
        res.json({ success: true, rowsAffected: result.rowsAffected });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/role/:role', async (req, res) => {
    try {
        await db.execute({ sql: "DELETE FROM users WHERE role = ?", args: [req.params.role] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  STAFF ENDPOINTS (admin / subadmin management)
// ─────────────────────────────────────────

// Get all staff for an institution (superadmin use)
app.get('/api/staff/:institution', async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT * FROM users WHERE institution = ? AND role IN ('admin','subadmin')",
            args: [decodeURIComponent(req.params.institution)]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get subadmins managed by a specific admin
app.get('/api/staff/managed-by/:adminId', async (req, res) => {
    try {
        const result = await db.execute({
            sql: "SELECT * FROM users WHERE managedBy = ? AND role = 'subadmin'",
            args: [req.params.adminId]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get all Super Admins (developer use)
app.get('/api/superadmins', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM users WHERE role = 'superadmin'");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  VOTERS ENDPOINTS
// ─────────────────────────────────────────

// Get voters by class (subadmin/admin use) — scoped to institution
app.get('/api/voters/by-class/:class', async (req, res) => {
    try {
        const institution = req.query.institution;
        const year = req.query.year;
        let sql = "SELECT * FROM users WHERE class = ? AND role IN ('voter','contestant')";
        const args = [decodeURIComponent(req.params.class)];
        if (institution) {
            sql += " AND institution = ?";
            args.push(decodeURIComponent(institution));
        }
        if (year) {
            sql += " AND year = ?";
            args.push(decodeURIComponent(year));
        }
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get voters by branch (admin use) — scoped to institution
app.get('/api/voters/by-branch/:branch', async (req, res) => {
    try {
        const institution = req.query.institution;
        let sql = "SELECT * FROM users WHERE branch = ? AND role IN ('voter','contestant')";
        const args = [decodeURIComponent(req.params.branch)];
        if (institution) {
            sql += " AND institution = ?";
            args.push(decodeURIComponent(institution));
        }
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark canVote for a voter
app.post('/api/voters/can-vote', async (req, res) => {
    try {
        const { regNum, canVote } = req.body;
        await db.execute({ sql: "UPDATE users SET canVote = ? WHERE regNum = ?", args: [boolInt(canVote), regNum] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk mark canVote for array of regNums
app.post('/api/voters/can-vote-bulk', async (req, res) => {
    try {
        const { regNums, canVote } = req.body;
        for (const r of regNums) {
            await db.execute({ sql: "UPDATE users SET canVote = ? WHERE regNum = ?", args: [boolInt(canVote), r] });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  AUDIT LOGS
// ─────────────────────────────────────────
app.post('/api/auditLogs', async (req, res) => {
    try {
        const { action, user, details, timestamp, institution } = req.body;
        await db.execute({ 
            sql: "INSERT INTO auditLogs (action, user, details, timestamp, institution) VALUES (?, ?, ?, ?, ?)", 
            args: [action, user, details || "", timestamp, institution || "Unknown"] 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auditLogs', async (req, res) => {
    try {
        const inst = req.query.institution;
        let sql = "SELECT * FROM auditLogs";
        let args = [];
        if (inst) {
            sql += " WHERE institution = ?";
            args.push(inst);
        }
        sql += " ORDER BY timestamp DESC LIMIT 200";
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/auditLogs', async (req, res) => {
    try {
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution required for clearing logs" });
        await db.execute({ sql: "DELETE FROM auditLogs WHERE institution = ?", args: [inst] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  DEVICE FINGERPRINTS
// ─────────────────────────────────────────
app.get('/api/deviceFingerprints/:id', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT * FROM deviceFingerprints WHERE fingerprint = ?", args: [req.params.id] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const row = result.rows[0];
        row.counts = JSON.parse(row.counts);
        res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deviceFingerprints', async (req, res) => {
    try {
        const fp = req.body;
        await db.execute({ sql: "INSERT INTO deviceFingerprints (fingerprint, firstSeen, lastActive, counts) VALUES (?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET lastActive = excluded.lastActive, counts = excluded.counts", args: [fp.fingerprint, fp.firstSeen, fp.lastActive, JSON.stringify(fp.counts)] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────
app.get('/api/config/:key', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [req.params.key] });
        if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
        res.json(JSON.parse(result.rows[0].value));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/:key', async (req, res) => {
    try {
        const { merge, data } = req.body;
        if (merge) {
            const result = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [req.params.key] });
            let existing = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : {};
            let updated = { ...existing, ...data };
            await db.execute({ sql: "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [req.params.key, JSON.stringify(updated)] });
            res.json({ success: true, data: updated });
        } else {
            await db.execute({ sql: "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [req.params.key, JSON.stringify(data)] });
            res.json({ success: true, data });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  SUPER ADMINS
// ─────────────────────────────────────────
app.get('/api/superadmins', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM users WHERE role = 'superadmin'");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  INSTITUTION CODES
// ─────────────────────────────────────────
app.post('/api/institutions/verify', async (req, res) => {
    try {
        const { code } = req.body;
        const result = await db.execute({ sql: "SELECT value FROM config WHERE key = 'institution_codes'", args: [] });
        if (result.rows.length === 0) return res.status(404).json({ error: "No codes found" });
        const codes = JSON.parse(result.rows[0].value);
        if (codes[code]) {
            res.json({ success: true, institution: codes[code] });
        } else {
            res.status(401).json({ error: "Invalid Institution Access Code" });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  ELECTION
// ─────────────────────────────────────────
app.post('/api/election/reset', async (req, res) => {
    try {
        const { institution } = req.body;
        if (!institution) return res.status(400).json({ error: "Institution parameter is strictly required" });
        
        await db.execute({ sql: "UPDATE config SET value = ? WHERE key = ?", args: [JSON.stringify({ isCompleted: false, isActive: false, startTime: null, endTime: null }), 'election_' + institution] });
        await db.execute({ sql: "UPDATE users SET hasVoted = 0, votedFor = NULL, voteStatus = NULL WHERE role IN ('voter','contestant') AND institution = ?", args: [institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM users WHERE role = 'contestant' AND status = 'active'");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  VOTE (with canVote gate)
// ─────────────────────────────────────────
app.post('/api/vote', async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp } = req.body;
        const voterResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ?", args: [voterRegNum] });
        if (voterResult.rows.length === 0) return res.status(404).json({ error: "Voter does not exist" });
        const v = voterResult.rows[0];

        if (!v.canVote || v.canVote === 0) return res.status(403).json({ error: "ACCESS_DENIED: Admin/Sub-Admin has not given you access yet!" });
        if (v.hasVoted === 1) return res.status(400).json({ error: "You have already voted!" });
        if (v.isBanned === 1) return res.status(403).json({ error: "Voting rights suspended." });

        await db.execute({
            sql: `UPDATE users SET hasVoted = 1, votedFor = ?, votedAt = ?, votePhoto = ?, status = 'pending_vote_verification', voteStatus = 'pending', voteReceiptHash = ?, voteFingerprint = ? WHERE regNum = ?`,
            args: [candidateRegNum, timestamp, votePhoto, secureHash, fp, voterRegNum]
        });
        await db.execute({ sql: "INSERT INTO publicLedger (receiptHash, timestamp, status) VALUES (?, ?, 'pending_verification')", args: [secureHash, timestamp] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  QUESTIONS
// ─────────────────────────────────────────
app.get('/api/questions/:candidateId', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT * FROM questions WHERE candidateId = ? ORDER BY timestamp DESC", args: [req.params.candidateId] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/questions', async (req, res) => {
    try {
        const { candidateId, voterName, question, timestamp } = req.body;
        const result = await db.execute({ sql: "INSERT INTO questions (candidateId, voterName, question, timestamp) VALUES (?, ?, ?, ?)", args: [candidateId, voterName, question, timestamp] });
        res.json({ success: true, id: result.lastInsertRowid.toString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/questions/:id', async (req, res) => {
    try {
        await db.execute({ sql: "UPDATE questions SET answer = ? WHERE id = ?", args: [req.body.answer, req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  GLOBAL CHAT
// ─────────────────────────────────────────
app.get('/api/globalChat', async (req, res) => {
    try {
        const result = await db.execute("SELECT * FROM globalChat ORDER BY timestamp DESC LIMIT 50");
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/globalChat', async (req, res) => {
    try {
        const { voterName, text, timestamp } = req.body;
        const result = await db.execute({ sql: "INSERT INTO globalChat (voterName, text, timestamp) VALUES (?, ?, ?)", args: [voterName, text, timestamp] });
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

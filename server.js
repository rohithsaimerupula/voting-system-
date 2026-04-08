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
// ─────────────────────────────────────────
//  MAILER (Nodemailer Transporter)
// ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
// Verify transporter connection on start (silent)
if (process.env.SMTP_USER) {
    transporter.verify((error) => {
        if (error) console.warn("[SMTP] Connection failure:", error.message);
        else console.log("[SMTP] Connection established successfully.");
    });
}

// ─────────────────────────────────────────
//  DB RETRY WRAPPER (handles Turso cold-start sleeps)
// ─────────────────────────────────────────
async function retryWithBackoff(fn, retries = 6, delayMs = 3000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('DB_TIMEOUT')), 25000)
                )
            ]);
            return result;
        } catch (e) {
            lastError = e;
            const isTimeout = e.message.includes('DB_TIMEOUT') || 
                             e.message.includes('ECONNREFUSED') || 
                             e.message.includes('fetch failed') ||
                             e.message.includes('ETIMEDOUT') ||
                             e.message.includes('socket hang up');

            if (isTimeout && attempt < retries) {
                console.warn(`[DB] Attempt ${attempt}/${retries} failed (network/cold-start). Retrying in ${delayMs}ms...`);
                await new Promise(r => setTimeout(r, delayMs));
            } else {
                if (!isTimeout) throw e;
                throw new Error(`❌ DB_TIMEOUT: Turso did not respond after ${retries} attempts. Please try again in a moment. (Original: ${e.message})`);
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
        await db.batch([
            `CREATE TABLE IF NOT EXISTS users (
                regNum TEXT,
                institution TEXT,
                password TEXT,
                role TEXT,
                name TEXT,
                email TEXT,
                status TEXT,
                branch TEXT,
                class TEXT,
                managedBy TEXT,
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
                category TEXT,
                manifesto TEXT,
                socialLinks TEXT,
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
                voterRegNum TEXT,
                electionCode TEXT,
                candidateStr TEXT,
                institution TEXT,
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
            )`,
            `CREATE TABLE IF NOT EXISTS elections (
                id TEXT PRIMARY KEY,
                institution TEXT,
                name TEXT,
                type TEXT,
                scope TEXT,
                electionCode TEXT,
                isActive INTEGER DEFAULT 0,
                isCompleted INTEGER DEFAULT 0,
                registrationOpen INTEGER DEFAULT 1,
                startTime TEXT,
                endTime TEXT,
                createdBy TEXT,
                createdByRole TEXT,
                createdAt TEXT,
                isSealed INTEGER DEFAULT 0
            )`
        ], "write");

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
            `ALTER TABLE users ADD COLUMN category TEXT`,
            `ALTER TABLE users ADD COLUMN semester TEXT`,
            `ALTER TABLE users ADD COLUMN accessType TEXT`,
        ];
        for (const sql of newColumns) {
            try { await db.execute(sql); } catch (e) {}
        }
        try { await db.execute("ALTER TABLE auditLogs ADD COLUMN institution TEXT"); } catch (e) {}

        console.log("Database tables initialized successfully.");

        const configSnap = await db.execute("SELECT * FROM config WHERE key = 'election'");
        if (configSnap.rows.length === 0) {
            await db.execute({ sql: "INSERT INTO config (key, value) VALUES ('election', ?)", args: [JSON.stringify({ isActive: false, isCompleted: false, startTime: null, endTime: null })] });
        }

        const devSnap = await db.execute("SELECT * FROM users WHERE role = 'developer'");
        const devPass = process.env.OVS_DEV_PASS || 'OvsDev@2026!';
        if (devSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status) VALUES (?, ?, ?, ?, ?, ?)`,
                args: ['OVSDEV2026', Buffer.from(devPass).toString('base64'), 'developer', 'OVS Developer', 'admin@ovs.com', 'active']
            });
            console.log("Developer account initialized.");
        }

        const saPass = process.env.OVS_SA_PASS || 'OvsAdm@123';
        const adminSnap = await db.execute("SELECT * FROM users WHERE regNum = 'ADMIN001'");
        if (adminSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['ADMIN001', Buffer.from(saPass).toString('base64'), 'superadmin', 'Super Admin', 'tharunmerupula01@gmail.com', 'active', 'Default Institution']
            });
            console.log("Default Super Admin created.");
        }

        try { await db.execute("ALTER TABLE publicLedger ADD COLUMN voterRegNum TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE publicLedger ADD COLUMN electionCode TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE publicLedger ADD COLUMN candidateStr TEXT"); } catch (e) {}
        try { await db.execute("ALTER TABLE publicLedger ADD COLUMN institution TEXT"); } catch (e) {}
        console.log("Database initialized with hierarchy support");

    } catch (err) {
        console.error("Error initializing DB:", err);
    }
}
initDb();

function boolInt(val) { return val ? 1 : 0; }

app.get('/api/users', async (req, res) => {
    try {
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution parameter is required" });
        const result = await db.execute({ sql: "SELECT * FROM users WHERE institution = ?", args: [decodeURIComponent(inst)] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/add', async (req, res) => {
    try {
        const u = req.body;
        const inst = u.institution || 'Unknown';
        if (u.role === 'voter' || u.role === 'contestant') {
            const configRes = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [`registration_${inst}`] });
            if (configRes.rows.length > 0) {
                const reg = JSON.parse(configRes.rows[0].value);
                const now = Date.now();
                const start = reg.startTime ? new Date(reg.startTime).getTime() : 0;
                const end = reg.endTime ? new Date(reg.endTime).getTime() : 0;
                if (reg.isActive) {
                    if (end && now > (end + 60000)) return res.status(403).json({ error: "REGISTRATION_CLOSED" });
                } else {
                    if (reg.isCompleted) return res.status(403).json({ error: "REGISTRATION_FINISHED" });
                    if (start && now < start) return res.status(403).json({ error: "REGISTRATION_NOT_STARTED" });
                    return res.status(403).json({ error: "REGISTRATION_CLOSED" });
                }
            }
        }
        await db.execute({
            sql: `INSERT INTO users (regNum, institution, password, role, name, email, status, hasVoted, isBanned, portrait, webcamReg, deviceFingerprint, inviteCode, campaignPoints, branch, class, managedBy, canVote, year, category)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                u.regNum, inst, u.password, u.role, u.name || '', u.email || '', u.status || 'pending',
                boolInt(u.hasVoted), boolInt(u.isBanned), u.portrait || null, u.webcamReg || null,
                u.deviceFingerprint || null, u.inviteCode || null, u.campaignPoints || 0,
                u.branch || null, u.class || null, u.managedBy || null,
                boolInt(u.canVote), u.year || null, u.category || null
            ]
        });
        res.json({ success: true });
    } catch (e) {
        if (e.message.includes('unique constraint') || e.message.includes('PRIMARY KEY')) 
            return res.status(400).json({ error: "Already exists" });
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
        if (result.rows.length === 0) {
            const globalResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ?", args: [regNum] });
            if (globalResult.rows.length > 0 && globalResult.rows[0].role === 'developer') return res.json(globalResult.rows[0]);
            return res.status(404).json({ error: "Not found" });
        }
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const regNum = req.params.id;
        const oldInstitution = req.query.institution;
        const updates = req.body;
        if (!oldInstitution) return res.status(400).json({ error: "Institution required" });
        const keys = Object.keys(updates);
        if (keys.length === 0) return res.json({ success: true });
        if (updates.institution && updates.institution !== oldInstitution) {
            const userCheck = await db.execute({ sql: "SELECT role FROM users WHERE regNum = ? AND institution = ?", args: [regNum, oldInstitution] });
            if (userCheck.rows.length > 0 && userCheck.rows[0].role === 'superadmin') {
                const newInstitution = updates.institution;
                const batchOps = [
                    { sql: "UPDATE users SET institution = ? WHERE institution = ?", args: [newInstitution, oldInstitution] },
                    { sql: "UPDATE auditLogs SET institution = ? WHERE institution = ?", args: [newInstitution, oldInstitution] }
                ];
                const configItems = await db.execute({ sql: "SELECT * FROM config WHERE key LIKE ?", args: [`%_${oldInstitution}`] });
                for (const item of configItems.rows) {
                    const newKey = item.key.replace(`_${oldInstitution}`, `_${newInstitution}`);
                    batchOps.push({ sql: "INSERT INTO config (key, value) VALUES (?, ?)", args: [newKey, item.value] });
                    batchOps.push({ sql: "DELETE FROM config WHERE key = ?", args: [item.key] });
                }
                const codesRes = await db.execute({ sql: "SELECT value FROM config WHERE key = 'institution_codes'", args: [] });
                if (codesRes.rows.length > 0) {
                    const codes = JSON.parse(codesRes.rows[0].value);
                    let changed = false;
                    Object.keys(codes).forEach(k => { if (codes[k] === oldInstitution) { codes[k] = newInstitution; changed = true; } });
                    if (changed) batchOps.push({ sql: "UPDATE config SET value = ? WHERE key = 'institution_codes'", args: [JSON.stringify(codes)] });
                }
                await db.batch(batchOps, "write");
                return res.json({ success: true, renamePropagated: true });
            }
        }
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => { const v = updates[k]; return typeof v === 'boolean' ? boolInt(v) : v; });
        values.push(regNum, oldInstitution);
        await db.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ? AND institution = ?`, args: values });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const institution = req.query.institution;
        if (!institution) return res.status(400).json({ error: "Institution required" });
        const userResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [id, institution] });
        if (userResult.rows.length > 0 && userResult.rows[0].role === 'superadmin') {
            const inst = userResult.rows[0].institution;
            await db.execute({ sql: "DELETE FROM users WHERE institution = ? AND role != 'developer'", args: [inst] });
            await db.execute({ sql: "DELETE FROM config WHERE key = ?", args: ['election_' + inst] });
            return res.json({ success: true, cascadeDeleted: true });
        }
        await db.execute({ sql: "DELETE FROM users WHERE regNum = ? AND institution = ?", args: [id, institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/staff/:institution', async (req, res) => {
    try {
        const result = await db.execute({ sql: "SELECT * FROM users WHERE institution = ? AND role IN ('admin','subadmin')", args: [decodeURIComponent(req.params.institution)] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/by-class/:class', async (req, res) => {
    try {
        const institution = req.query.institution;
        const year = req.query.year;
        let sql = "SELECT * FROM users WHERE class = ? AND role IN ('voter','contestant')";
        const args = [decodeURIComponent(req.params.class)];
        if (institution) { sql += " AND institution = ?"; args.push(decodeURIComponent(institution)); }
        if (year) { sql += " AND year = ?"; args.push(decodeURIComponent(year)); }
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/by-branch/:branch', async (req, res) => {
    try {
        const institution = req.query.institution;
        let sql = "SELECT * FROM users WHERE branch = ? AND role IN ('voter','contestant')";
        const args = [decodeURIComponent(req.params.branch)];
        if (institution) { sql += " AND institution = ?"; args.push(decodeURIComponent(institution)); }
        const result = await db.execute({ sql, args });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/voters/can-vote', async (req, res) => {
    try {
        const { regNum, canVote, institution } = req.body;
        await db.execute({ sql: "UPDATE users SET canVote = ? WHERE regNum = ? AND institution = ?", args: [boolInt(canVote), regNum, decodeURIComponent(institution)] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auditLogs', async (req, res) => {
    try {
        const { action, user, details, timestamp, institution } = req.body;
        await db.execute({ sql: "INSERT INTO auditLogs (action, user, details, timestamp, institution) VALUES (?, ?, ?, ?, ?)", args: [action, user, details || "", timestamp, institution || "Unknown"] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dev/stats', async (req, res) => {
    try {
        const stats = await db.execute(`SELECT (SELECT COUNT(*) FROM users WHERE role = 'superadmin') as saCount, (SELECT COUNT(*) FROM users WHERE role = 'admin') as adminCount, (SELECT COUNT(*) FROM users WHERE role = 'subadmin') as subAdminCount, (SELECT COUNT(*) FROM users WHERE role IN ('voter','contestant')) as studentCount, (SELECT COUNT(DISTINCT institution) FROM users WHERE role = 'superadmin' AND institution IS NOT NULL AND institution != 'Unknown') as instCount FROM users LIMIT 1`);
        const saResult = await db.execute("SELECT regNum, name, institution, email, status FROM users WHERE role = 'superadmin' ORDER BY name ASC");
        const instResult = await db.execute("SELECT DISTINCT institution FROM users WHERE role = 'superadmin' AND institution IS NOT NULL AND institution != 'Unknown' ORDER BY institution ASC");
        res.json({ counts: stats.rows[0], superAdmins: saResult.rows, institutions: instResult.rows.map(r => r.institution) });
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

app.post('/api/institutions/verify', async (req, res) => {
    try {
        const { code } = req.body;
        const result = await db.execute({ sql: "SELECT value FROM config WHERE key = 'institution_codes'", args: [] });
        if (result.rows.length === 0) return res.status(404).json({ error: "No codes" });
        const codes = JSON.parse(result.rows[0].value);
        if (codes[code]) res.json({ success: true, institution: codes[code] });
        else res.status(401).json({ error: "Invalid" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/election/reset', async (req, res) => {
    try {
        const { institution } = req.body;
        await db.execute({ sql: "UPDATE config SET value = ? WHERE key = ?", args: [JSON.stringify({ isCompleted: false, isActive: false, startTime: null, endTime: null }), 'election_' + institution] });
        await db.execute({ sql: "DELETE FROM config WHERE key = ?", args: ['registration_' + institution] });
        await db.execute({ sql: "UPDATE users SET hasVoted = 0, votedFor = NULL, voteStatus = NULL, canVote = 0 WHERE role IN ('voter','contestant') AND institution = ?", args: [institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const inst = req.query.institution;
        const result = await db.execute({ sql: "SELECT * FROM users WHERE role = 'contestant' AND status = 'active' AND institution = ?", args: [decodeURIComponent(inst || '')] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, name, otp, context } = req.body;
        if (!email || !otp) return res.status(400).json({ error: "Missing params" });
        console.log(`[AUTH] Sending OTP: ${otp} to ${email}`);
        if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_sender_net_username') return res.json({ success: true, warning: "Dev mode" });
        const mailOptions = {
            from: `"Vanguard Security" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: email, subject: `${context || 'OTP'} - OVS`,
            html: `<div style="padding:2rem;"><h2>OVS Code: ${otp}</h2></div>`
        };
        await transporter.sendMail(mailOptions);
        res.json({ success: true });
    } catch (e) {
        console.error("Mail Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vote', async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp, institution, electionCode } = req.body;
        const voterResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [voterRegNum, institution] });
        if (voterResult.rows.length === 0) return res.status(404).json({ error: "Voter not found" });
        const v = voterResult.rows[0];
        if (!v.canVote || v.isBanned === 1) return res.status(403).json({ error: "Denied" });
        let elec = null;
        if (electionCode && electionCode !== 'global') {
            const eq = await db.execute({ sql: "SELECT * FROM elections WHERE electionCode = ? AND institution = ?", args: [electionCode, institution] });
            if (eq.rows.length > 0) elec = eq.rows[0];
        } else {
            const cr = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [`election_${v.institution}`] });
            if (cr.rows.length > 0) elec = JSON.parse(cr.rows[0].value);
        }
        if (!elec) return res.status(404).json({ error: "No election" });
        const codeToCheck = electionCode || 'global';
        const pv = await db.execute({ sql: "SELECT receiptHash FROM publicLedger WHERE voterRegNum = ? AND electionCode = ?", args: [voterRegNum, codeToCheck] });
        if (pv.rows.length > 0) return res.status(400).json({ error: "Voted" });
        const now = Date.now();
        const start = elec.startTime ? new Date(elec.startTime).getTime() : 0;
        const end = elec.endTime ? new Date(elec.endTime).getTime() : 0;
        const isActive = elec.isActive === 1 || elec.status === 'active';
        if (isActive) { if (end && now > end + 60000) return res.status(403).json({ error: "Closed" }); }
        else { if (start && now < start) return res.status(403).json({ error: "Upcoming" }); return res.status(403).json({ error: "Inactive" }); }
        const candStr = JSON.stringify(candidateRegNum);
        await db.execute({ sql: "UPDATE users SET hasVoted = 1, votedFor = ?, votedAt = ?, status = 'pending_vote_verification' WHERE regNum = ? AND institution = ?", args: [candStr, timestamp, voterRegNum, institution] });
        await db.execute({ sql: "INSERT INTO publicLedger (receiptHash, voterRegNum, electionCode, candidateStr, institution, timestamp, status) VALUES (?,?,?,?,?,?,'pending')", args: [secureHash, voterRegNum, codeToCheck, candStr, institution, timestamp] });
        res.json({ success: true, receipt: secureHash });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voters/my-elections', async (req, res) => {
    try {
        const { regNum, institution } = req.query;
        const uRes = await db.execute({ sql: "SELECT branch, year, class as cls FROM users WHERE regNum = ? AND institution = ?", args: [regNum, institution] });
        if (uRes.rows.length === 0) return res.status(404).json({ error: "Not found" });
        const branch = (uRes.rows[0].branch || '').trim().toUpperCase();
        const year = (uRes.rows[0].year || '').trim().toUpperCase();
        const cls = (uRes.rows[0].cls || '').trim().toUpperCase();
        console.log(`[LOBBY] Voter: ${regNum} | Branch: ${branch} | Year: ${year} | Cls: ${cls}`);
        const electionsRes = await db.execute({ sql: "SELECT * FROM elections WHERE institution = ? AND isCompleted = 0", args: [institution] });
        const eligible = [];
        for (const e of electionsRes.rows) {
            let scope = JSON.parse(e.scope || '{}');
            let allowed = false;
            const contains = (arr, val) => Array.isArray(arr) && arr.map(v => String(v).toUpperCase().trim()).includes(String(val).toUpperCase().trim());
            const match = (v1, v2) => String(v1).toUpperCase().trim() === String(v2).toUpperCase().trim();
            if (e.type === 'college' && (scope.college || scope.all)) allowed = true;
            else if (e.type === 'college' && scope.branches) { if (contains(scope.branches, branch) || contains(scope.years, year)) allowed = true; }
            else if (e.type === 'branch' && match(scope.branch, branch)) {
                if (scope.classes || scope.class) {
                    const clss = scope.classes || (Array.isArray(scope.class) ? scope.class : [scope.class]);
                    if (contains(clss, cls) || contains(scope.years, year)) allowed = true;
                } else allowed = true;
            } else if (e.type === 'class' && match(scope.class, cls) && match(scope.branch, branch)) allowed = true;
            if (allowed) {
                const vk = await db.execute({ sql: "SELECT status FROM publicLedger WHERE voterRegNum = ? AND electionCode = ?", args: [regNum, e.electionCode] });
                e.hasVoted = vk.rows.length > 0;
                eligible.push(e);
            }
        }
        res.json(eligible);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/questions/:candidateId', async (req, res) => {
    try {
        const r = await db.execute({ sql: "SELECT * FROM questions WHERE candidateId = ? ORDER BY timestamp DESC", args: [req.params.candidateId] });
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/questions', async (req, res) => {
    try {
        const { candidateId, voterName, question, timestamp } = req.body;
        const r = await db.execute({ sql: "INSERT INTO questions (candidateId, voterName, question, timestamp) VALUES (?, ?, ?, ?)", args: [candidateId, voterName, question, timestamp] });
        res.json({ success: true, id: r.lastInsertRowid.toString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/globalChat', async (req, res) => {
    try {
        const r = await db.execute("SELECT * FROM globalChat ORDER BY timestamp DESC LIMIT 50");
        res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/globalChat', async (req, res) => {
    try {
        const { voterName, text, timestamp } = req.body;
        const r = await db.execute({ sql: "INSERT INTO globalChat (voterName, text, timestamp) VALUES (?, ?, ?)", args: [voterName, text, timestamp] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/elections', async (req, res) => {
    try {
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: 'Required' });
        const r = await db.execute({ sql: 'SELECT * FROM elections WHERE institution = ? ORDER BY createdAt DESC', args: [inst] });
        res.json(r.rows.map(x => ({ ...x, scope: JSON.parse(x.scope || '{}') })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/elections', async (req, res) => {
    try {
        const { institution, name, type, scope, startTime, endTime, createdBy, createdByRole } = req.body;
        const id = `ELC-${Date.now()}`;
        const code = Math.random().toString(36).substr(2, 6).toUpperCase();
        await db.execute({
            sql: `INSERT INTO elections (id, institution, name, type, scope, electionCode, isActive, isCompleted, registrationOpen, startTime, endTime, createdBy, createdByRole, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [id, institution, name, type, JSON.stringify(scope || {}), code, 0, 0, 1, startTime || null, endTime || null, createdBy, createdByRole || '', new Date().toISOString()]
        });
        res.json({ success: true, id, electionCode: code });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/elections/code/:code', async (req, res) => {
    try {
        const r = await db.execute({ sql: 'SELECT * FROM elections WHERE electionCode = ?', args: [req.params.code] });
        if (r.rows.length === 0) return res.status(404).json({ error: 'Invalid' });
        res.json({ ...r.rows[0], scope: JSON.parse(r.rows[0].scope || '{}') });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/elections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const keys = Object.keys(updates).filter(k => k !== 'scope');
        const sets = [];
        const vals = [];
        for (const k of keys) { sets.push(`"${k}" = ?`); vals.push(updates[k]); }
        if (updates.scope) { sets.push('scope = ?'); vals.push(JSON.stringify(updates.scope)); }
        vals.push(id);
        await db.execute({ sql: `UPDATE elections SET ${sets.join(', ')} WHERE id = ?`, args: vals });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/elections/:id', async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM elections WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/elections/:id/analytics', async (req, res) => {
    try {
        const r = await db.execute({ sql: 'SELECT * FROM elections WHERE id = ?', args: [req.params.id] });
        if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const elec = r.rows[0];
        const inst = elec.institution;
        const stats = await db.execute({ sql: "SELECT COUNT(*) as total, SUM(canVote) as allowed FROM users WHERE institution = ? AND role IN ('voter','contestant')", args: [inst] });
        const voted = await db.execute({ sql: "SELECT COUNT(*) as voted FROM publicLedger WHERE electionCode = ? AND institution = ?", args: [elec.electionCode, inst] });
        res.json({ total: stats.rows[0].total, allowed: stats.rows[0].allowed, voted: voted.rows[0].voted });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/elections/:id/results', async (req, res) => {
    try {
        const r = await db.execute({ sql: 'SELECT * FROM elections WHERE id = ?', args: [req.params.id] });
        const elec = r.rows[0];
        const inst = elec.institution;
        const votes = await db.execute({ sql: "SELECT candidateStr FROM publicLedger WHERE electionCode = ? AND institution = ?", args: [elec.electionCode, inst] });
        const tallies = {};
        votes.rows.forEach(row => {
            let cand = JSON.parse(row.candidateStr);
            if (typeof cand === 'object') Object.values(cand).forEach(id => tallies[id] = (tallies[id] || 0) + 1);
            else if (cand) tallies[cand] = (tallies[cand] || 0) + 1;
        });
        const results = [];
        for (const [id, count] of Object.entries(tallies)) {
            const ci = await db.execute({ sql: "SELECT name, symbol, portrait, category FROM users WHERE regNum = ? AND institution = ?", args: [id, inst] });
            if (ci.rows.length > 0) results.push({ ...ci.rows[0], votes: count });
        }
        res.json({ success: true, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/students/promote-semester', async (req, res) => {
    try {
        const { institution } = req.body;
        await db.execute({ sql: "UPDATE users SET semester = '2' WHERE institution = ? AND year = '1st' AND (semester = '1' OR semester IS NULL)", args: [institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

if (process.env.VERCEL !== '1') {
    app.get('/api/ledger/verify/:hash', async (req, res) => {
        try {
            const r = await db.execute({ sql: `SELECT timestamp, institution, electionCode FROM publicLedger WHERE receiptHash = ?`, args: [req.params.hash] });
            if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            res.json({ verified: true, ...r.rows[0] });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.listen(PORT, '0.0.0.0', () => console.log(`Backend running on port ${PORT}`));
}

module.exports = app;

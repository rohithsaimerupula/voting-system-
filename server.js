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
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587/STARTTLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

// Verify transporter connection on start
if (process.env.SMTP_USER && process.env.SMTP_USER !== 'your_sender_net_username') {
    transporter.verify((error) => {
        if (error) {
            console.error("\x1b[31m%s\x1b[0m", `[SMTP] Configuration Error: ${error.message}`);
            if (error.message.includes('Invalid login') || error.responseCode === 535) {
                console.warn("\x1b[33m%s\x1b[0m", "[SMTP] Hint: Ensure you are using a Gmail 'App Password', not your main account password.");
            }
        } else {
            console.log("\x1b[32m%s\x1b[0m", "[SMTP] Connection established! Ready to send OTPs via Gmail.");
        }
    });
} else {
    console.log("\x1b[33m%s\x1b[0m", "[SMTP] Running in Developer Mode (Console-only OTPs).");
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
                // If it's not a timeout (e.g. SQL error), Throw it immediately
                if (!isTimeout) throw e;
                // If we ran out of retries, throw the timeout error
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
                category TEXT,   -- category explicitly for contestants
                manifesto TEXT,  -- vision statement / base64 PDF
                socialLinks TEXT, -- JSON string for twitter/ig/etc
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
                isSealed INTEGER DEFAULT 0 -- Official results confirmation
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
            `ALTER TABLE users ADD COLUMN category TEXT`,
            `ALTER TABLE users ADD COLUMN semester TEXT`,
            `ALTER TABLE users ADD COLUMN accessType TEXT`,
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
        const devPass = process.env.OVS_DEV_PASS || 'OvsDev@2026!';
        if (devSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status) VALUES (?, ?, ?, ?, ?, ?)`,
                args: ['OVSDEV2026', Buffer.from(devPass).toString('base64'), 'developer', 'OVS Developer', 'admin@ovs.com', 'active']
            });
            console.log("Developer account initialized.");
        } else if (devSnap.rows[0].regNum === 'DEV001') {
            await db.execute({
                sql: `UPDATE users SET regNum = 'OVSDEV2026', password = ? WHERE role = 'developer'`,
                args: [Buffer.from(devPass).toString('base64')]
            });
            console.log("Developer account upgraded.");
        }

        // Default Super Admin (for legacy institution)
        const saSnap = await db.execute("SELECT * FROM users WHERE role = 'superadmin'");
        const saPass = process.env.OVS_SA_PASS || 'OvsAdm@123';
        if (saSnap.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['OVSADM001', Buffer.from(saPass).toString('base64'), 'superadmin', 'Super Admin', 'tharunmerupula01@gmail.com', 'active', 'Default Institution']
            });
            console.log("Super Admin account initialized.");
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

        // Add columns for multi-tier tracking to publicLedger
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

// ─────────────────────────────────────────
//  HELPER
// ─────────────────────────────────────────
function boolInt(val) { return val ? 1 : 0; }

// ─────────────────────────────────────────
//  USER ENDPOINTS
// ─────────────────────────────────────────
app.get('/api/users', async (req, res) => {
    try {
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution parameter is required" });
        // Only return users belonging to this institution (no cross-tenant leakage)
        const result = await db.execute({ sql: "SELECT * FROM users WHERE institution = ?", args: [decodeURIComponent(inst)] });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/add', async (req, res) => {
    try {
        const u = req.body;
        const inst = u.institution || 'Unknown';

        // ── TEMPORAL GUARD: Check Registration Timeline ──
        if (u.role === 'voter' || u.role === 'contestant') {
            const configRes = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [`registration_${inst}`] });
            if (configRes.rows.length > 0) {
                const reg = JSON.parse(configRes.rows[0].value);
                const now = Date.now();
                const start = reg.startTime ? new Date(reg.startTime).getTime() : 0;
                const end = reg.endTime ? new Date(reg.endTime).getTime() : 0;

                if (reg.isActive) {
                    // If manually active, we generally allow it, but still check end time to be safe
                    if (end && now > (end + 60000)) { // 1 min grace for end time
                        return res.status(403).json({ error: "REGISTRATION_CLOSED: The deadline for registration has passed." });
                    }
                    // We don't strictly block if (now < start) if isActive is true, 
                    // because the admin just manually started it and clocks might drift.
                } else {
                    // Not active: either upcoming or finished
                    if (reg.isCompleted) {
                        return res.status(403).json({ error: "REGISTRATION_FINISHED: Registration for this institution has concluded." });
                    }
                    if (start && now < start) {
                        return res.status(403).json({ error: "REGISTRATION_NOT_STARTED: Registration has not opened yet." });
                    }
                    return res.status(403).json({ error: "REGISTRATION_CLOSED: Registration is currently inactive." });
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
        if (result.rows.length === 0) {
            // Fallback: Check if the user is a developer/global account (no institution filter)
            const globalResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ?", args: [regNum] });
            if (globalResult.rows.length > 0 && globalResult.rows[0].role === 'developer') {
                return res.json(globalResult.rows[0]);
            }
            return res.status(404).json({ error: "Not found" });
        }
        
        // If multiple matches and no institution provided, warn but return first
        res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
    try {
        const regNum = req.params.id;
        const oldInstitution = req.query.institution;
        const updates = req.body;
        
        if (!oldInstitution) return res.status(400).json({ error: "Institution required for identification" });
        
        const keys = Object.keys(updates);
        if (keys.length === 0) return res.json({ success: true });

        // ── CASCADE UPDATE: Check if Institution is changing for a Super Admin ──
        if (updates.institution && updates.institution !== oldInstitution) {
            const userCheck = await db.execute({ sql: "SELECT role FROM users WHERE regNum = ? AND institution = ?", args: [regNum, oldInstitution] });
            
            if (userCheck.rows.length > 0 && userCheck.rows[0].role === 'superadmin') {
                const newInstitution = updates.institution;
                const batchOps = [];

                // 1. Update ALL users in this institution
                batchOps.push({
                    sql: "UPDATE users SET institution = ? WHERE institution = ?",
                    args: [newInstitution, oldInstitution]
                });

                // 2. Update Audit Logs
                batchOps.push({
                    sql: "UPDATE auditLogs SET institution = ? WHERE institution = ?",
                    args: [newInstitution, oldInstitution]
                });

                // 3. Rename Config Keys (Election, Registration, Categories, Announcement)
                const configItems = await db.execute({ sql: "SELECT * FROM config WHERE key LIKE ?", args: [`%_${oldInstitution}`] });
                for (const item of configItems.rows) {
                    const newKey = item.key.replace(`_${oldInstitution}`, `_${newInstitution}`);
                    batchOps.push({ sql: "INSERT INTO config (key, value) VALUES (?, ?)", args: [newKey, item.value] });
                    batchOps.push({ sql: "DELETE FROM config WHERE key = ?", args: [item.key] });
                }

                // 4. Update Institution Access Codes mapping
                const codesRes = await db.execute({ sql: "SELECT value FROM config WHERE key = 'institution_codes'", args: [] });
                if (codesRes.rows.length > 0) {
                    const codes = JSON.parse(codesRes.rows[0].value);
                    let changed = false;
                    Object.keys(codes).forEach(k => {
                        if (codes[k] === oldInstitution) {
                            codes[k] = newInstitution;
                            changed = true;
                        }
                    });
                    if (changed) {
                        batchOps.push({ sql: "UPDATE config SET value = ? WHERE key = 'institution_codes'", args: [JSON.stringify(codes)] });
                    }
                }

                // 5. Update the Super Admin record itself (already handled by the global user update above)
                // But we still need to apply any other updates (name, email, password) to the Super Admin specifically
                const saKeys = keys.filter(k => k !== 'institution');
                if (saKeys.length > 0) {
                    const saSet = saKeys.map(k => `"${k}" = ?`).join(', ');
                    const saValues = saKeys.map(k => { const v = updates[k]; return typeof v === 'boolean' ? boolInt(v) : v; });
                    saValues.push(regNum, newInstitution); // Use NEW institution here
                    batchOps.push({ sql: `UPDATE users SET ${saSet} WHERE regNum = ? AND institution = ?`, args: saValues });
                }

                await db.batch(batchOps, "write");
                return res.json({ success: true, renamePropagated: true, from: oldInstitution, to: newInstitution });
            }
        }

        // --- REGULAR UPDATE (No college rename or not a Super Admin) ---
        const setClause = keys.map(k => `"${k}" = ?`).join(', ');
        const values = keys.map(k => { const v = updates[k]; return typeof v === 'boolean' ? boolInt(v) : v; });
        
        values.push(regNum, oldInstitution);
        await db.execute({ sql: `UPDATE users SET ${setClause} WHERE regNum = ? AND institution = ?`, args: values });
        res.json({ success: true });
    } catch (e) { 
        console.error("Cascade Update Error:", e);
        res.status(500).json({ error: e.message }); 
    }
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
        // Require institution to prevent accidental global deletion
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution required" });
        const adminToken = req.headers['x-admin-token'];
        if (!adminToken || adminToken !== process.env.ADMIN_SECRET) {
            return res.status(403).json({ error: "Forbidden: Valid admin token required" });
        }
        const result = await db.execute({ 
            sql: "DELETE FROM users WHERE institution = ? AND role NOT IN ('developer','superadmin') AND (status IS NULL OR status = 'rejected')", 
            args: [decodeURIComponent(inst)] 
        });
        res.json({ success: true, rowsAffected: result.rowsAffected });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/role/:role', async (req, res) => {
    try {
        // Require institution + secret token — this is a dangerous mass-delete endpoint
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution required for role-based deletion" });
        const adminToken = req.headers['x-admin-token'];
        if (!adminToken || adminToken !== process.env.ADMIN_SECRET) {
            return res.status(403).json({ error: "Forbidden: Valid admin token required" });
        }
        const role = req.params.role;
        if (['developer', 'superadmin'].includes(role)) {
            return res.status(403).json({ error: "Cannot mass-delete developer or superadmin accounts" });
        }
        await db.execute({ sql: "DELETE FROM users WHERE role = ? AND institution = ?", args: [role, decodeURIComponent(inst)] });
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

// Get staff by branch and institution (admin use)
app.get('/api/staff/branch/:branch', async (req, res) => {
    try {
        const institution = req.query.institution;
        if (!institution) return res.status(400).json({ error: "Institution required" });
        const result = await db.execute({
            sql: "SELECT * FROM users WHERE branch = ? AND institution = ? AND role = 'subadmin'",
            args: [decodeURIComponent(req.params.branch), decodeURIComponent(institution)]
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

// Mark canVote for a voter — scoped to institution
app.post('/api/voters/can-vote', async (req, res) => {
    try {
        const { regNum, canVote, institution } = req.body;
        if (!institution) return res.status(400).json({ error: "Institution required for voting control" });
        await db.execute({ 
            sql: "UPDATE users SET canVote = ? WHERE regNum = ? AND institution = ?", 
            args: [boolInt(canVote), regNum, decodeURIComponent(institution)] 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk mark canVote for array of regNums — scoped to institution
app.post('/api/voters/can-vote-bulk', async (req, res) => {
    try {
        const { regNums, canVote, institution } = req.body;
        if (!institution) return res.status(400).json({ error: "Institution required for bulk control" });
        for (const r of regNums) {
            await db.execute({ 
                sql: "UPDATE users SET canVote = ? WHERE regNum = ? AND institution = ?", 
                args: [boolInt(canVote), r, decodeURIComponent(institution)] 
            });
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

// ─────────────────────────────────────────
//  DEVELOPER / CORE INFRASTRUCTURE
// ────────────────────────────────────────
app.get('/api/dev/stats', async (req, res) => {
    try {
        const stats = await db.execute(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE role = 'superadmin') as saCount,
                (SELECT COUNT(*) FROM users WHERE role = 'admin') as adminCount,
                (SELECT COUNT(*) FROM users WHERE role = 'subadmin') as subAdminCount,
                (SELECT COUNT(*) FROM users WHERE role IN ('voter','contestant')) as studentCount,
                (SELECT COUNT(DISTINCT institution) FROM users WHERE role = 'superadmin' AND institution IS NOT NULL AND institution != 'Unknown') as instCount
            FROM users LIMIT 1
        `);
        const saResult = await db.execute("SELECT regNum, name, institution, email, status FROM users WHERE role = 'superadmin' ORDER BY name ASC");
        const instResult = await db.execute("SELECT DISTINCT institution FROM users WHERE role = 'superadmin' AND institution IS NOT NULL AND institution != 'Unknown' ORDER BY institution ASC");
        
        res.json({
            counts: stats.rows[0],
            superAdmins: saResult.rows,
            institutions: instResult.rows.map(r => r.institution)
        });
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
        // Also clear the registration schedule for this institution to prevent stale temporal guards
        await db.execute({ sql: "DELETE FROM config WHERE key = ?", args: ['registration_' + institution] });
        await db.execute({ sql: "UPDATE users SET hasVoted = 0, votedFor = NULL, voteStatus = NULL, canVote = 0 WHERE role IN ('voter','contestant') AND institution = ?", args: [institution] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/candidates', async (req, res) => {
    try {
        const inst = req.query.institution;
        if (!inst) return res.status(400).json({ error: "Institution parameter is required" });
        const result = await db.execute({
            sql: "SELECT * FROM users WHERE role = 'contestant' AND status = 'active' AND institution = ?",
            args: [decodeURIComponent(inst)]
        });
        res.json(result.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  AUTH / OTP ENDPOINT
// ─────────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        const { email, name, otp, context } = req.body;
        if (!email || !otp) return res.status(400).json({ error: "Email and OTP are required" });

        console.log(`[AUTH] Sending ${context || 'OTP'} to ${email}: ${otp}`);

        // If SMTP is NOT configured, we log to console (Development Fallback)
        if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_sender_net_username') {
            console.warn(`[AUTH] SMTP NOT CONFIGURED. OTP for ${email} is ${otp}`);
            return res.json({ 
                success: true, 
                warning: "Development Mode: SMTP not configured. OTP printed to server console." 
            });
        }

        const mailOptions = {
            from: `"Vanguard Security" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: email,
            subject: `${context || 'Verification Code'} — OVS`,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                    <h2 style="color: #ff2a4d; text-align: center;">Vanguard Voting System</h2>
                    <p>Hello <strong>${name || 'User'}</strong>,</p>
                    <p>You requested a verification code for: <strong>${context || 'Secure Activity'}</strong>.</p>
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: 800; letter-spacing: 5px; color: #333; margin: 20px 0;">
                        ${otp}
                    </div>
                    <p style="font-size: 13px; color: #666; text-align: center;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 11px; color: #999; text-align: center;">&copy; 2026 Vanguard Secure Systems. All rights reserved.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true });
    } catch (e) {
        console.error("[AUTH] Mail Error:", e);
        res.status(500).json({ error: "Failed to send email. " + e.message });
    }
});

// ─────────────────────────────────────────
//  VOTE (with canVote gate)
// ─────────────────────────────────────────
app.post('/api/vote', async (req, res) => {
    try {
        const { voterRegNum, candidateRegNum, votePhoto, secureHash, fp, timestamp, institution, electionCode } = req.body;
        if (!institution) return res.status(400).json({ error: "Institution required for voting" });
        // Scope voter lookup to institution
        const voterResult = await db.execute({ sql: "SELECT * FROM users WHERE regNum = ? AND institution = ?", args: [voterRegNum, institution] });
        if (voterResult.rows.length === 0) return res.status(404).json({ error: "Voter does not exist" });
        const v = voterResult.rows[0];

        if (!v.canVote || v.canVote === 0) return res.status(403).json({ error: "ACCESS_DENIED: Admin/Sub-Admin has not given you access yet!" });
        if (v.isBanned === 1) return res.status(403).json({ error: "Voting rights suspended." });

        let elec = null;
        let requiresElectionCode = false;

        // Route to Multi-Tier Election OR Legacy Global
        if (electionCode && electionCode !== 'global') {
            const elecQuery = await db.execute({ sql: "SELECT * FROM elections WHERE electionCode = ? AND institution = ?", args: [electionCode, institution] });
            if (elecQuery.rows.length === 0) return res.status(404).json({ error: "Invalid Election Code" });
            elec = elecQuery.rows[0];
            requiresElectionCode = true;
        } else {
            const configRes = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [`election_${v.institution}`] });
            if (configRes.rows.length > 0) elec = JSON.parse(configRes.rows[0].value);
        }

        if (!elec) return res.status(404).json({ error: "No active election found." });

        // MULTI-TIER LEDGER GUARD
        const codeToCheck = electionCode || 'global';
        const priorVote = await db.execute({ sql: "SELECT receiptHash FROM publicLedger WHERE voterRegNum = ? AND electionCode = ?", args: [voterRegNum, codeToCheck] });
        if (priorVote.rows.length > 0) return res.status(400).json({ error: "You have already voted in this specific election!" });

        // ── TEMPORAL GUARD ──
        const now = Date.now();
        const start = elec.startTime ? new Date(elec.startTime).getTime() : 0;
        const end = elec.endTime ? new Date(elec.endTime).getTime() : 0;
        
        const isLegacyActive = elec.isActive !== undefined ? elec.isActive : (elec.status === 'active');
        const isLegacyComplete = elec.isCompleted !== undefined ? elec.isCompleted : (elec.status === 'completed');

        if (isLegacyActive) {
            if (end && now > (end + 60000)) return res.status(403).json({ error: "ELECTION_CLOSED: Polls have closed for this election." });
        } else {
            if (isLegacyComplete) return res.status(403).json({ error: "ELECTION_FINISHED: This election has concluded." });
            if (start && now < start) return res.status(403).json({ error: "ELECTION_NOT_STARTED: Polls have not opened yet." });
            return res.status(403).json({ error: "ELECTION_CLOSED: Polls are currently inactive." });
        }


        const electionsRes = await db.execute({ sql: "SELECT * FROM elections WHERE institution = ? AND isActive = 1", args: [institution] });
        const eligible = [];
        
        for (const e of electionsRes.rows) {
            let scope;
            try { scope = JSON.parse(e.scope); } catch(err) { scope = {}; }
            let allowed = false;

            if (e.type === 'college' && scope.college) allowed = true;
            else if (e.type === 'college' && scope.branches) {
                if (scope.branches.includes(branch) || scope.years?.includes(year)) allowed = true;
            } else if (e.type === 'branch' && scope.branch === branch) {
                if (scope.class) {
                    if (scope.class.includes(cls) || scope.years?.includes(year)) allowed = true;
                } else allowed = true;
            } else if (e.type === 'class' && scope.class === cls && scope.branch === branch) {
                allowed = true;
            }

            if (allowed) {
                const voteChk = await db.execute({ sql: "SELECT status FROM publicLedger WHERE voterRegNum = ? AND electionCode = ?", args: [regNum, e.electionCode] });
                e.hasVoted = voteChk.rows.length > 0;
                eligible.push(e);
            }
        }

        // Include Legacy fallback
        const configRes = await db.execute({ sql: "SELECT value FROM config WHERE key = ?", args: [`election_${institution}`] });
        if (configRes.rows.length > 0) {
            const legacy = JSON.parse(configRes.rows[0].value);
            if (legacy.isActive) {
                const legacyVoteChk = await db.execute({ sql: "SELECT status FROM publicLedger WHERE voterRegNum = ? AND electionCode = 'global'", args: [regNum] });
                const votedLegacy = legacyVoteChk.rows.length > 0;
                eligible.push({
                    id: 'global',
                    electionCode: 'global',
                    name: legacy.electionName || legacy.name || 'Main Institutional Election',
                    type: 'college',
                    isActive: 1,
                    isCompleted: 0,
                    endTime: legacy.endTime || null,
                    hasVoted: votedLegacy
                });
            }
        }
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
//  ELECTIONS (Multi-Level)
// ─────────────────────────────────────────

// Get all elections for an institution (optionally filter by type/createdBy)
app.get('/api/elections', async (req, res) => {
    try {
        const inst = req.query.institution;
        const type = req.query.type;
        const createdBy = req.query.createdBy;
        if (!inst) return res.status(400).json({ error: 'Institution required' });
        let sql = 'SELECT * FROM elections WHERE institution = ?';
        const args = [inst];
        if (type) { sql += ' AND type = ?'; args.push(type); }
        if (createdBy) { sql += ' AND createdBy = ?'; args.push(createdBy); }
        sql += ' ORDER BY createdAt DESC';
        const result = await db.execute({ sql, args });
        res.json(result.rows.map(r => ({ ...r, scope: JSON.parse(r.scope || '{}') })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create a new election
app.post('/api/elections', async (req, res) => {
    try {
        const { institution, name, type, scope, startTime, endTime, createdBy, createdByRole } = req.body;
        if (!institution || !name || !type || !createdBy) return res.status(400).json({ error: 'institution, name, type, createdBy are required' });
        const id = `ELC-${Date.now()}-${Math.random().toString(36).substr(2,4).toUpperCase()}`;
        const electionCode = Math.random().toString(36).substr(2, 6).toUpperCase();
        const createdAt = new Date().toISOString();
        await db.execute({
            sql: `INSERT INTO elections (id, institution, name, type, scope, electionCode, isActive, isCompleted, registrationOpen, startTime, endTime, createdBy, createdByRole, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            args: [id, institution, name, type, JSON.stringify(scope || {}), electionCode, 0, 0, 1, startTime || null, endTime || null, createdBy, createdByRole || '', createdAt]
        });
        res.json({ success: true, id, electionCode });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update election (start, stop, modify schedule)
app.patch('/api/elections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const keys = Object.keys(updates).filter(k => k !== 'scope');
        const sets = [];
        const vals = [];
        for (const k of keys) { sets.push(`"${k}" = ?`); vals.push(updates[k]); }
        if (updates.scope) { sets.push('scope = ?'); vals.push(JSON.stringify(updates.scope)); }
        if (sets.length === 0) return res.json({ success: true });
        vals.push(id);
        await db.execute({ sql: `UPDATE elections SET ${sets.join(', ')} WHERE id = ?`, args: vals });
        // When election starts, lock registration
        if (updates.isActive === 1) {
            await db.execute({ sql: 'UPDATE elections SET registrationOpen = 0 WHERE id = ?', args: [id] });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete an election
app.delete('/api/elections/:id', async (req, res) => {
    try {
        await db.execute({ sql: 'DELETE FROM elections WHERE id = ?', args: [req.params.id] });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get election analytics (voter stats for a given election scope)
app.get('/api/elections/:id/analytics', async (req, res) => {
    try {
        const elecResult = await db.execute({ sql: 'SELECT * FROM elections WHERE id = ?', args: [req.params.id] });
        if (elecResult.rows.length === 0) return res.status(404).json({ error: 'Election not found' });
        const elec = elecResult.rows[0];
        const scope = JSON.parse(elec.scope || '{}');
        const inst = elec.institution;

        // Count Total Eligible & Allowed from users table based on scope
        let userSql = "SELECT COUNT(*) as total, SUM(canVote) as allowed FROM users WHERE institution = ? AND role IN ('voter','contestant')";
        let userArgs = [inst];
        
        let scopeClause = "";
        let scopeArgs = [];

        if (scope.college) {
            // Global scope
        } else if (scope.classes && scope.classes.length > 0) {
            scopeClause += ` AND class IN (${scope.classes.map(() => '?').join(',')})`;
            scopeArgs.push(...scope.classes);
        } else if (scope.branches && scope.branches.length > 0) {
            scopeClause += ` AND branch IN (${scope.branches.map(() => '?').join(',')})`;
            scopeArgs.push(...scope.branches);
        } else if (elec.type === 'branch' && scope.branch) {
            scopeClause += ' AND branch = ?'; scopeArgs.push(scope.branch);
        } else if (elec.type === 'class' && scope.class) {
            scopeClause += ' AND class = ?'; scopeArgs.push(scope.class);
            if (scope.branch) { scopeClause += ' AND branch = ?'; scopeArgs.push(scope.branch); }
        }
        
        if (scope.years && scope.years.length > 0) {
            scopeClause += ` AND year IN (${scope.years.map(() => '?').join(',')})`;
            scopeArgs.push(...scope.years);
        }

        userSql += scopeClause;
        userArgs.push(...scopeArgs);

        const userResult = await db.execute({ sql: userSql, args: userArgs });
        const stats = userResult.rows[0];

        // Count Voted from publicLedger based on electionCode
        const ledgerResult = await db.execute({ 
            sql: "SELECT COUNT(*) as voted FROM publicLedger WHERE electionCode = ? AND institution = ?", 
            args: [elec.electionCode, inst] 
        });
        const voted = ledgerResult.rows[0].voted;

        res.json({ total: stats.total || 0, allowed: stats.allowed || 0, voted: voted || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get detailed election results (candidate tallies)
app.get('/api/elections/:id/results', async (req, res) => {
    try {
        const elecResult = await db.execute({ sql: 'SELECT * FROM elections WHERE id = ?', args: [req.params.id] });
        if (elecResult.rows.length === 0) return res.status(404).json({ error: 'Election not found' });
        const elec = elecResult.rows[0];
        const inst = elec.institution;

        // Fetch all ledger entries for this election
        const votes = await db.execute({ 
            sql: "SELECT candidateStr FROM publicLedger WHERE electionCode = ? AND institution = ?", 
            args: [elec.electionCode, inst] 
        });

        const tallies = {};
        votes.rows.forEach(row => {
            let cand;
            try { cand = JSON.parse(row.candidateStr); } catch(e) { cand = row.candidateStr; }
            if (typeof cand === 'object' && cand !== null) {
                // Multi-category vote
                Object.values(cand).forEach(id => {
                    tallies[id] = (tallies[id] || 0) + 1;
                });
            } else if (cand) {
                tallies[cand] = (tallies[cand] || 0) + 1;
            }
        });

        // Fetch candidate details for those who received votes
        const results = [];
        for (const [regNum, count] of Object.entries(tallies)) {
            const candInfo = await db.execute({ 
                sql: "SELECT regNum, name, symbol, portrait, category FROM users WHERE regNum = ? AND institution = ?", 
                args: [regNum, inst] 
            });
            if (candInfo.rows.length > 0) {
                results.push({ ...candInfo.rows[0], votes: count });
            }
        }
        
        // Also include candidates in scope who got 0 votes
        // Fetch candidates based on election scope
        let candSql = "SELECT regNum, name, symbol, portrait, category FROM users WHERE institution = ? AND role = 'contestant'";
        let candArgs = [inst];
        // Apply same scope logic as analytics... but for brevity and accuracy we'll just check if they are already in results
        const resultRegNums = results.map(r => r.regNum);
        
        // Simple global contestant fetch for now (refined by institution)
        const allCands = await db.execute({ sql: candSql, args: candArgs });
        allCands.rows.forEach(c => {
            if (!resultRegNums.includes(c.regNum)) {
                // Here we could check if candidate matches election scope before adding 0-vote entries
                // For now, simplicity: if they aren't in results, they got 0.
                results.push({ ...c, votes: 0 });
            }
        });

        // Filter results by election categories if applicable
        // Or just return all and let frontend filter.
        
        results.sort((a,b) => b.votes - a.votes);
        res.json({ success: true, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Promote Semester (Super Admin only)
app.post('/api/students/promote-semester', async (req, res) => {
    try {
        const { institution } = req.body;
        if (!institution) return res.status(400).json({ error: 'Institution required' });

        // Promote: sem 2 → next year sem 1; sem 1 → sem 2; 4th year sem 2 → DELETE
        // Step 1: Delete 4th year sem 2 students
        const delResult = await db.execute({
            sql: "DELETE FROM users WHERE institution = ? AND year = '4th' AND semester = '2' AND role IN ('voter','contestant')",
            args: [institution]
        });

        // Step 2: Promote 3rd year sem 2 → 4th year sem 1
        await db.execute({ sql: "UPDATE users SET year = '4th', semester = '1' WHERE institution = ? AND year = '3rd' AND semester = '2' AND role IN ('voter','contestant')", args: [institution] });
        // Step 3: Promote 3rd year sem 1 → sem 2
        await db.execute({ sql: "UPDATE users SET semester = '2' WHERE institution = ? AND year = '3rd' AND semester = '1' AND role IN ('voter','contestant')", args: [institution] });
        // Step 4: Promote 2nd year sem 2 → 3rd year sem 1
        await db.execute({ sql: "UPDATE users SET year = '3rd', semester = '1' WHERE institution = ? AND year = '2nd' AND semester = '2' AND role IN ('voter','contestant')", args: [institution] });
        // Step 5: Promote 2nd year sem 1 → sem 2
        await db.execute({ sql: "UPDATE users SET semester = '2' WHERE institution = ? AND year = '2nd' AND semester = '1' AND role IN ('voter','contestant')", args: [institution] });
        // Step 6: Promote 1st year sem 2 → 2nd year sem 1
        await db.execute({ sql: "UPDATE users SET year = '2nd', semester = '1' WHERE institution = ? AND year = '1st' AND semester = '2' AND role IN ('voter','contestant')", args: [institution] });
        // Step 7: Promote 1st year sem 1 → sem 2
        await db.execute({ sql: "UPDATE users SET semester = '2' WHERE institution = ? AND year = '1st' AND (semester = '1' OR semester IS NULL) AND role IN ('voter','contestant')", args: [institution] });

        res.json({ success: true, deleted: Number(delResult.rowsAffected || 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────
if (process.env.VERCEL !== '1') {
    // ─────────────────────────────────────────
//  LEDGER VERIFICATION (Anonymized)
// ─────────────────────────────────────────
app.get('/api/ledger/verify/:hash', async (req, res) => {
    try {
        const { hash } = req.params;
        const result = await db.execute({
            sql: `SELECT timestamp, institution, electionCode FROM publicLedger WHERE receiptHash = ?`,
            args: [hash]
        });
        if (result.rows.length === 0) return res.status(404).json({ error: 'Receipt hash not found in ledger' });
        
        // Return only non-sensitive audit data
        res.json({
            verified: true,
            timestamp: result.rows[0].timestamp,
            institution: result.rows[0].institution,
            electionCode: result.rows[0].electionCode,
            message: "This vote hash is officially recorded in the tamper-proof ledger."
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VANGUARD] Node/Express backend running on port ${PORT}`);
});
}

module.exports = app;

const { createClient } = require('@libsql/client');
require('dotenv').config();

const turso = createClient({ 
    url: process.env.TURSO_DATABASE_URL, 
    authToken: process.env.TURSO_AUTH_TOKEN 
});

async function run() {
    try {
        console.log("Starting Migration...");
        
        // 1. Rename existing table
        try {
            await turso.execute('ALTER TABLE users RENAME TO users_old');
            console.log('✅ Renamed users to users_old');
        } catch (e) {
            console.warn('⚠️ users_old might already exist or renaming failed:', e.message);
        }

        // 2. Create new table with Composite Primary Key
        await turso.execute(`
            CREATE TABLE IF NOT EXISTS users (
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
                createdAt TEXT,
                PRIMARY KEY (regNum, institution)
            )
        `);
        console.log('✅ Created new users table with composite PRIMARY KEY (regNum, institution)');

        // 3. Migrate data
        const usersOld = await turso.execute('SELECT * FROM users_old');
        console.log(`📊 Found ${usersOld.rows.length} users to migrate.`);

        for (const u of usersOld.rows) {
            try {
                await turso.execute({
                    sql: `INSERT INTO users (
                        regNum, institution, password, role, name, email, status, 
                        branch, class, managedBy, canVote, hasVoted, votedFor, 
                        votedAt, votePhoto, voteStatus, voteReceiptHash, 
                        voteFingerprint, isBanned, portrait, webcamReg, 
                        deviceFingerprint, inviteCode, campaignPoints
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        u.regNum, 
                        u.institution || 'Unknown', 
                        u.password, 
                        u.role, 
                        u.name, 
                        u.email, 
                        u.status, 
                        u.branch, 
                        u.class, 
                        u.managedBy, 
                        u.canVote || 0, 
                        u.hasVoted || 0, 
                        u.votedFor, 
                        u.votedAt, 
                        u.votePhoto, 
                        u.voteStatus, 
                        u.voteReceiptHash, 
                        u.voteFingerprint, 
                        u.isBanned || 0, 
                        u.portrait, 
                        u.webcamReg, 
                        u.deviceFingerprint, 
                        u.inviteCode, 
                        u.campaignPoints || 0
                    ]
                });
                console.log(`➡️ Migrated user: ${u.regNum} (${u.institution || 'Unknown'})`);
            } catch (err) {
                console.error(`❌ Failed to migrate ${u.regNum}:`, err.message);
            }
        }

        console.log("✨ Migration SUCCESSFUL!");
    } catch (e) {
        console.error("❌ CRITICAL MIGRATION ERROR:", e);
    }
}

run();

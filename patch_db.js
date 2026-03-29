const { createClient } = require('@libsql/client/web');
require('dotenv').config();

async function run() {
    const turso = createClient({
        url: process.env.TURSO_DATABASE_URL || "libsql://dummy",
        authToken: process.env.TURSO_AUTH_TOKEN || "dummy",
    });

    try {
        const passwordBase64 = Buffer.from('Rohith121$').toString('base64');
        const snap = await turso.execute("SELECT * FROM users WHERE regNum IN ('SADMIN001', 'OVSADM001') AND role = 'superadmin'");
        if (snap.rows.length > 0) {
            await turso.execute({
                sql: "UPDATE users SET regNum = 'SADMIN001', password = ? WHERE regNum IN ('SADMIN001', 'OVSADM001')",
                args: [passwordBase64]
            });
            console.log("Updated existing Super Admin to SADMIN001 with requested password.");
        } else {
            await turso.execute({
                sql: `INSERT INTO users (regNum, password, role, name, email, status, institution) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                args: ['SADMIN001', passwordBase64, 'superadmin', 'Super Admin', 'admin@example.com', 'active', 'Default Institution']
            });
            console.log("Inserted new Super Admin SADMIN001 with requested password.");
        }
    } catch(e) {
        console.error(e);
    }
}
run();

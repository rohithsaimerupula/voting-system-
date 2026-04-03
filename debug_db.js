require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
    try {
        const adminRes = await db.execute("SELECT * FROM users WHERE role = 'subadmin'");
        console.log("SubAdmins:", adminRes.rows);

        const voterRes = await db.execute("SELECT * FROM users WHERE regNum = '25L31A05X1'");
        console.log("Voter:", voterRes.rows);
    } catch(e) {
        console.error(e);
    }
}
run();

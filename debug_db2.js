require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
    try {
        const voterRes = await db.execute("SELECT regNum, class, branch, role, name FROM users WHERE regNum = '25L31A05X1'");
        console.log("Voter:", voterRes.rows);
    } catch(e) {
        console.error(e);
    }
}
run();

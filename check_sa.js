const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function check() {
    try {
        const r = await db.execute("SELECT regNum, email, role, institution FROM users WHERE role = 'superadmin'");
        console.log(JSON.stringify(r.rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}
check();

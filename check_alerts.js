const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function check() {
    try {
        const r = await db.execute("SELECT * FROM system_alerts ORDER BY timestamp DESC LIMIT 20");
        console.log(JSON.stringify(r.rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}
check();

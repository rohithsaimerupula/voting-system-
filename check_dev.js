const { createClient } = require('@libsql/client');
require('dotenv').config();

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function check() {
    try {
        const r = await db.execute("SELECT regNum, name, email, role, institution, password FROM users WHERE role = 'developer'");
        if (!r.rows.length) { console.log('No developer account found.'); return; }
        r.rows.forEach(u => {
            console.log('-----------------------------');
            console.log('Developer ID  :', u.regNum);
            console.log('Name          :', u.name);
            console.log('Email         :', u.email);
            console.log('Institution   :', u.institution);
            console.log('Password Hash :', u.password);
        });
    } catch (e) {
        console.error(e);
    }
}
check();

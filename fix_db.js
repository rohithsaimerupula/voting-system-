require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
    try {
        const admins = await db.execute("SELECT regNum, branch, class FROM users WHERE role = 'subadmin'");
        let count = 0;
        for (const admin of admins.rows) {
            if (admin.class && admin.branch && !admin.class.startsWith(admin.branch)) {
                const newClass = admin.branch + '-' + admin.class;
                await db.execute({
                    sql: "UPDATE users SET class = ? WHERE regNum = ?",
                    args: [newClass, admin.regNum]
                });
                count++;
            }
        }
        console.log(`Fixed ${count} sub-admins.`);
    } catch(e) {
        console.error(e);
    }
}
run();

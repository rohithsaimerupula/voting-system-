import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
    try {
        console.log("Fetching config...");
        const res = await db.execute("SELECT value FROM config WHERE key = 'institution_codes'");
        if (res.rows.length > 0) {
            const codes = JSON.parse(res.rows[0].value);
            console.log("Current codes:", codes);
            
            // Delete the stale code if it exists
            if (codes['VIIT2026']) {
                delete codes['VIIT2026'];
            }
            // Delete the stale institution if it exists under another code
            for (const key in codes) {
                if (codes[key].includes("Vignan's")) {
                    delete codes[key];
                }
            }
            
            console.log("Updating config...");
            await db.execute({
                sql: "UPDATE config SET value = ? WHERE key = 'institution_codes'",
                args: [JSON.stringify(codes)]
            });
            console.log("Cleanup complete!");
        } else {
            console.log("No config found.");
        }
    } catch (e) {
        console.error(e);
    }
}
run();

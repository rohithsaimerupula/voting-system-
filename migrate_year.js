require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
});

async function run() {
    try {
        console.log("Adding 'year' column to 'users' table...");
        await db.execute("ALTER TABLE users ADD COLUMN year TEXT");
        console.log("Column 'year' added successfully.");
    } catch(e) {
        if (e.message.includes("already exists")) {
            console.log("Column 'year' already exists.");
        } else {
            console.error("Migration failed:", e);
        }
    }
}
run();

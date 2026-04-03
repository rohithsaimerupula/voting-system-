const fetch = require('node-fetch');

const API = "http://localhost:3000/api";
const institution = "Test Institution";

async function verify() {
    try {
        console.log("1. Adding test students...");
        await fetch(`${API}/users/add?institution=${encodeURIComponent(institution)}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                regNum: "TEST1ST", name: "1st Year Student", role: "voter",
                class: "CSE-5", year: "1st", institution
            })
        });
        await fetch(`${API}/users/add?institution=${encodeURIComponent(institution)}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                regNum: "TEST2ND", name: "2nd Year Student", role: "voter",
                class: "CSE-5", year: "2nd", institution
            })
        });

        console.log("2. Verifying 'by-class' without year (legacy/all)...");
        const resAll = await fetch(`${API}/voters/by-class/CSE-5?institution=${encodeURIComponent(institution)}`).then(r => r.json());
        console.log(`Found ${resAll.length} students (Expected 2)`);

        console.log("3. Verifying 'by-class' with '1st' year...");
        const res1st = await fetch(`${API}/voters/by-class/CSE-5?institution=${encodeURIComponent(institution)}&year=1st`).then(r => r.json());
        console.log(`Found ${res1st.length} students (Expected 1)`);
        console.log(`Student name: ${res1st[0]?.name}`);

        console.log("4. Verifying 'by-class' with '2nd' year...");
        const res2nd = await fetch(`${API}/voters/by-class/CSE-5?institution=${encodeURIComponent(institution)}&year=2nd`).then(r => r.json());
        console.log(`Found ${res2nd.length} students (Expected 1)`);
        console.log(`Student name: ${res2nd[0]?.name}`);

        console.log("Cleaning up...");
        await fetch(`${API}/users/TEST1ST?institution=${encodeURIComponent(institution)}`, { method: 'DELETE' });
        await fetch(`${API}/users/TEST2ND?institution=${encodeURIComponent(institution)}`, { method: 'DELETE' });

    } catch (e) {
        console.error("Verification failed:", e);
    }
}

verify();

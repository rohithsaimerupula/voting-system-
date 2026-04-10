require('dotenv').config();
const nodemailer = require('nodemailer');

async function verify() {
    console.log("-----------------------------------------");
    console.log("🔍 OVS SMTP Connection Verifier");
    console.log("-----------------------------------------");
    console.log(`User: ${process.env.SMTP_USER}`);
    console.log(`Host: ${process.env.SMTP_HOST || 'smtp.gmail.com'}`);
    console.log(`Port: ${process.env.SMTP_PORT || 587}`);
    console.log("-----------------------------------------");

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    try {
        await transporter.verify();
        console.log("✅ SUCCESS: Your SMTP configuration is valid!");
        console.log("You are ready to send real OTPs.");
    } catch (error) {
        console.error("❌ FAILED: Could not connect to SMTP server.");
        console.error(`Error Message: ${error.message}`);
        
        if (error.message.includes('Invalid login') || error.responseCode === 535) {
            console.log("\n💡 TIP: Authentication failed.");
            console.log("1. Double-check your SMTP_USER in .env");
            console.log("2. Ensure SMTP_PASS is a 16-character 'App Password' from Google.");
            console.log("3. Remove any spaces if you copied them (though usually they are fine).");
        }
    }
    console.log("-----------------------------------------");
}

verify();

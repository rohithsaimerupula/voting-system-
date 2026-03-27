# 🗳️ Secure Online Voting System (OVS)

A modern, secure, and feature-rich online voting application built with vanilla HTML, CSS, JavaScript, and Firebase Cloud Firestore (simulated persistence). Designed for college or organizational elections with a premium "Aurora Glass" UI.

## ✨ Features

### 🔐 Security & Auth
- **Role-Based Login:** Separate portals for Voters and Admins.
- **Password Hashing:** SHA-256 local hashing for secure password storage.
- **Forgot Password:** Self-service password recovery flow with simulated email OTP.
- **Admin Verification:** Voters must upload ID and Photo; Admins approve/reject accounts manually.
- **Smart Rejection:** Rejection includes reason logging and simulated email feedback.

### 🗳️ Voting Experience
- **Live Voting:** Secure one-time voting mechanism.
- **Candidate Profiles:** View candidate manifestos, photos, and slogans before voting.
- **Vote Receipts:** Downloadable verified PDF receipt after casting a vote.
- **Announcements Ticker:** Real-time scrolling news bar for election updates.
- **Status Checks:** Voting is blocked automatically if outside the election schedule.

### 🛠️ Admin Dashboard
- **Advanced Analytics:** Real-time Chart.js dashboards (Participation & Results).
- **Election Control:** Activity Log, Schedule Management (Start/End Times), and Panic Buttons (Reset).
- **User Management:** Verify pending voters, manage candidates, and remove users.
- **Activity Logs:** Audit trail of all critical system actions with timestamps.

### 🎨 UI/UX
- **Aurora Glass Theme:** Premium dark/light themes with neon accents and glassmorphism.
- **Dark/Light Toggle:** One-click theme switching with persistence.
- **Responsive Design:** Fully optimized for desktop and mobile devices.

## 🚀 Setup & Deployment

### Local Development
1. Clone the repository or download the files.
2. Open `index.html` in your browser.
3. No build server required! (Uses vanilla JS).

### Deployment (GitHub Pages)
1. Upload all files to a GitHub repository.
2. Go to **Settings > Pages**.
3. Select `main` branch and `/root` folder.
4. Save. Your site will be live in minutes!

## 🔧 Configuration

### Admin Credentials (Default)
- **Admin ID:** `ADMIN001`
- **Password:** `admin123`
*(Change this immediately after login in the Admin Dashboard)*

### Firebase / Storage
This system uses `storage.js` to handle data. Currently configured for **Firebase Firestore**.
- To use your own database, update the `firebaseConfig` object in `storage.js`.

## 📜 License
This project is open-source and available for educational and organizational use.

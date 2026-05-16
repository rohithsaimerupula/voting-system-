const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = path.join(__dirname, 'Manuals');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
}

const template = (title, content) => `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; max-width: 900px; margin: 0 auto; padding: 40px; background: #fff; }
        h1 { color: #4c1d95; border-bottom: 3px solid #8b5cf6; padding-bottom: 10px; font-size: 2.5em; margin-bottom: 10px; }
        h2 { color: #6d28d9; margin-top: 40px; font-size: 1.8em; }
        h3 { color: #334155; }
        p.desc { font-size: 1.1em; color: #475569; margin-bottom: 30px; }
        .step { background: #f8fafc; border-left: 5px solid #8b5cf6; padding: 20px; margin-bottom: 25px; border-radius: 0 8px 8px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .step h3 { margin-top: 0; color: #4338ca; }
        .mermaid { margin: 30px 0; display: flex; justify-content: center; background: #fff; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; }
        code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
        @media print {
            body { max-width: 100%; padding: 0; }
            .step, .mermaid { page-break-inside: avoid; }
            h2 { page-break-after: avoid; }
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({ startOnLoad: true, theme: 'base', themeVariables: { primaryColor: '#f3e8ff', primaryBorderColor: '#8b5cf6', primaryTextColor: '#1e293b', lineColor: '#64748b' } });
        window.addEventListener('load', () => { setTimeout(() => { window.mermaidRendered = true; }, 1500); });
    </script>
</head>
<body>
${content}
</body>
</html>`;

const manuals = [
    {
        name: '1_Student_Portal_Manual',
        title: 'Student / Voter Portal Manual',
        content: `<h1>Student / Voter Portal Manual</h1>
<p class="desc">This manual provides a detailed, step-by-step workflow for students and voters using the Online Voting System (OVS).</p>
<h2>1. Registration Workflow</h2>
<div class="mermaid">
graph TD
    A[Visit Home Page] --> B[Click Registration]
    B --> C[Enter Class Code]
    C --> D[Fill Details & Get OTP via Email]
    D --> E[Verify OTP]
    E --> F[Upload Student ID Card]
    F --> G[Liveness Check: Blink Detection]
    G --> H[Live Photo Capture]
    H --> I{AI Match > 40%?}
    I -->|Yes| J[Submit for Admin Approval]
    I -->|No| K[Retake / Manual Review Flag]
</div>
<div class="step">
    <h3>Step 1: Access Registration</h3>
    <p>Navigate to the Home Gateway and select the <strong>Registration</strong> portal. You will be prompted to enter the unique <code>Class Code</code> provided by your Class Admin.</p>
</div>
<div class="step">
    <h3>Step 2: OTP Verification</h3>
    <p>Fill out your basic details (Name, Registration Number). Enter your College Email and click <strong>Get OTP</strong>. Enter the 6-digit code received in your email to verify your identity.</p>
</div>
<div class="step">
    <h3>Step 3: Biometric Verification & ID Scan</h3>
    <p>Upload a clear photo of your Student ID Card. The AI will extract your face. Next, open your webcam. The system will perform a <strong>Liveness Check</strong>—you must blink naturally. Once liveness is confirmed, the system will capture your photo and compare it against your ID card. A match of >40% is required.</p>
</div>
<div class="step">
    <h3>Step 4: Submission</h3>
    <p>Click <strong>Complete Registration</strong>. Your account will be created with a status of <em>Pending</em> until your Class Admin approves it.</p>
</div>
<h2>2. Login & Voting Workflow</h2>
<div class="mermaid">
sequenceDiagram
    participant Student
    participant Portal
    participant AI
    participant Blockchain Ledger
    
    Student->>Portal: Enter Student ID & Password
    Portal->>AI: Trigger Webcam Login
    AI-->>Portal: Face Match Verified
    Portal-->>Student: Access Granted to Dashboard
    Student->>Portal: View Live Elections
    Student->>Portal: Select Candidate & Cast Vote
    Portal->>Blockchain Ledger: Encrypt & Store Vote
    Blockchain Ledger-->>Student: Vote Confirmation Receipt
</div>
<div class="step">
    <h3>Step 1: Secure Biometric Login</h3>
    <p>Go to the Login portal. Enter your Registration Number and Password. You will be prompted to scan your face via the webcam. The AI ensures the person logging in matches the registered profile.</p>
</div>
<div class="step">
    <h3>Step 2: Casting a Vote</h3>
    <p>Once inside the Student Dashboard, navigate to the <strong>Live Elections</strong> tab. Select your preferred candidate and click <strong>Vote</strong>. The system will cryptographically secure your vote and ensure you cannot vote twice.</p>
</div>`
    },
    {
        name: '2_Class_Admin_Manual',
        title: 'Class Admin (Sub-Admin) Portal Manual',
        content: `<h1>Class Admin (Sub-Admin) Portal Manual</h1>
<p class="desc">Class Admins manage their specific class sections. They are responsible for approving student registrations and running localized class elections.</p>
<h2>1. Overall Navigation Flow</h2>
<div class="mermaid">
graph LR
    A[Login] --> B[Class Admin Dashboard]
    B --> C[Student Approvals Tab]
    B --> D[Election Management Tab]
    B --> E[Class Analytics Tab]
</div>
<h2>2. Accepting & Managing Students</h2>
<div class="mermaid">
graph TD
    A[Student Submits Registration] --> B[Appears in Pending Approvals]
    B --> C{Class Admin Reviews Details}
    C -->|Approve| D[Student Status: ACTIVE]
    C -->|Reject| E[Student Status: REJECTED]
    D --> F[Student Can Login & Vote]
</div>
<div class="step">
    <h3>Step 1: Review Pending Registrations</h3>
    <p>Log in using your Admin credentials. Navigate to the <strong>Student Approvals</strong> tab. Here, you will see a list of all students who registered using your Class Code.</p>
</div>
<div class="step">
    <h3>Step 2: Approve or Reject</h3>
    <p>Review the student's ID and captured photo. Click <strong>Approve</strong> to activate their account, or <strong>Reject</strong> if the data is invalid. Only approved students can participate in elections.</p>
</div>
<h2>3. Starting & Managing an Election</h2>
<div class="mermaid">
sequenceDiagram
    participant Class Admin
    participant System
    participant Students
    
    Class Admin->>System: Configure Election (Title, Time, Candidates)
    Class Admin->>System: Click "Start Election"
    System-->>Students: Election Appears in Dashboards
    Students->>System: Cast Votes
    Class Admin->>System: Click "End Election"
    System->>Class Admin: Generate & Display Results
</div>
<div class="step">
    <h3>Step 1: Configuration</h3>
    <p>Go to the <strong>Election Management</strong> tab. Define the election parameters (e.g., "Class Representative 2026"). Ensure your candidates have registered under the "Candidate" role.</p>
</div>
<div class="step">
    <h3>Step 2: Execution & Results</h3>
    <p>Start the election. You can monitor live voter turnout analytics. Once the deadline is reached, click <strong>End Election</strong> to tally the votes and declare the winner.</p>
</div>`
    },
    {
        name: '3_Branch_Admin_Manual',
        title: 'Branch Admin Portal Manual',
        content: `<h1>Branch Admin Portal Manual</h1>
<p class="desc">Branch Admins oversee an entire department (e.g., Computer Science). They create Class Admins and monitor elections across all years and sections within their branch.</p>
<h2>1. Creating a Class Admin</h2>
<div class="mermaid">
graph TD
    A[Branch Admin Dashboard] --> B[Manage Class Admins]
    B --> C[Generate Credentials]
    C --> D[Assign Year & Section]
    D --> E[Class Admin Account Created]
    E --> F[Class Admin Logs In]
</div>
<div class="step">
    <h3>Step 1: Access Management Tab</h3>
    <p>Log in using your Branch Admin credentials. Navigate to the <strong>Manage Admins</strong> tab.</p>
</div>
<div class="step">
    <h3>Step 2: Assign Credentials</h3>
    <p>Enter the new Class Admin's email, assign them a specific Year and Section (e.g., Year 2, Section A), and generate a temporary password. Provide these credentials to the respective faculty member or representative.</p>
</div>
<h2>2. Branch-Wide Monitoring</h2>
<div class="step">
    <h3>Live Analytics</h3>
    <p>From your main dashboard, you can view aggregate data across your entire branch. This includes total registered students, pending approvals across all classes, and active branch-wide elections.</p>
</div>`
    },
    {
        name: '4_Super_Admin_Manual',
        title: 'Super Admin Portal Manual',
        content: `<h1>Super Admin Portal Manual</h1>
<p class="desc">The Super Admin has absolute global control over the system. They manage institutions, branches, and system-wide configurations.</p>
<h2>1. Creating a Branch Admin</h2>
<div class="mermaid">
sequenceDiagram
    participant Super Admin
    participant System
    participant Branch Admin
    
    Super Admin->>System: Add New Branch (e.g., ECE)
    Super Admin->>System: Generate Branch Admin Credentials
    System-->>Super Admin: Creation Successful
    Super Admin->>Branch Admin: Deliver Credentials
    Branch Admin->>System: Login & Manage Branch
</div>
<div class="step">
    <h3>Step 1: Branch Setup</h3>
    <p>Log into the Super Admin portal. Navigate to the <strong>Institutions & Branches</strong> configuration tab. Add a new Branch identifier.</p>
</div>
<div class="step">
    <h3>Step 2: Admin Creation</h3>
    <p>Assign a Branch Admin to the newly created branch. Set their username and password. This user will now have authority over all classes within that branch.</p>
</div>
<h2>2. System Overrides & Data Wipes</h2>
<div class="mermaid">
graph TD
    A[Super Admin] -->|Deletes Branch Admin| B[Cascading Deletion Triggered]
    B --> C[All Class Admins in Branch Deleted]
    C --> D[All Students in Classes Deleted]
    D --> E[All Votes Cast by Students Invalidated]
    E --> F[Zero Orphan Data Left]
</div>
<div class="step">
    <h3>Global Operations</h3>
    <p>As Super Admin, any destructive action cascades down the hierarchy. If you delete a Branch Admin, the system will automatically purge all Class Admins, students, and vote ledgers associated with that branch to ensure strict data privacy compliance.</p>
</div>`
    }
];

// Write HTML files
manuals.forEach(m => {
    fs.writeFileSync(path.join(dir, m.name + '.html'), template(m.title, m.content));
});

console.log('Installing puppeteer (this may take a minute)...');
try {
    execSync('npm install puppeteer', { stdio: 'inherit' });
} catch (e) {
    console.error('Failed to install puppeteer.');
    process.exit(1);
}

const puppeteer = require('puppeteer');

(async () => {
    console.log('Generating PDFs...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    for (const m of manuals) {
        const filePath = 'file://' + path.join(dir, m.name + '.html');
        console.log('Loading ' + m.name + '...');
        await page.goto(filePath, { waitUntil: 'networkidle0' });
        
        try {
            await page.waitForFunction('window.mermaidRendered === true', { timeout: 15000 });
        } catch(e) {
            console.log('Timeout waiting for mermaid (or rendered instantly).');
        }
        
        const pdfPath = path.join(dir, m.name + '.pdf');
        await page.pdf({ 
            path: pdfPath, 
            format: 'A4', 
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        console.log('✅ Generated PDF: ' + pdfPath);
    }
    
    await browser.close();
    console.log('Done!');
})();

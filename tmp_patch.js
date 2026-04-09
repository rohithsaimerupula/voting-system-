const fs = require('fs');

const path = 'c:\\Users\\rohit\\voting project\\voter_dashboard.html';
let html = fs.readFileSync(path, 'utf8');

// 1. Insert Lobby HTML before ELECTION STATUS / TIMER SKELETON
const lobbyHtml = `        <!-- LOBBY SECTION -->
        <div id="lobby-section" style="display:none; margin-top:2rem;">
            <div style="text-align:center; padding:2rem; margin-bottom:1rem;">
                <h1 style="font-family: var(--font-heading); color:white; font-size:2.5rem; text-shadow: 0 0 15px rgba(6,182,212,0.5);">Active Elections</h1>
                <p style="color:var(--text-muted);">Select an election below to cast your secure ballot.</p>
            </div>
            <div id="elections-lobby-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:1.5rem;">
                <!-- Populated by JS -->
            </div>
        </div>

        <!-- ELECTION CODE MODAL -->
        <div id="election-code-modal" class="modal">
            <div class="glass-panel modal-content" style="width: 90%; max-width: 400px; padding: 2.5rem; text-align:center;">
                <h2 style="font-family: var(--font-heading); margin-bottom:1rem;">Access Required</h2>
                <p class="text-muted" style="margin-bottom:1.5rem;">Enter the 6-digit access code for <strong id="unlock-election-name" style="color:white;"></strong>.</p>
                <input type="text" id="election-access-code" placeholder="XXXXXX" maxlength="6" style="text-align:center; font-size:1.5rem; letter-spacing:5px; margin-bottom:1.5rem; text-transform:uppercase; background:rgba(0,0,0,0.3); border:1px solid var(--glass-border); color:white; border-radius:8px;">
                <p id="code-error" class="text-danger hidden" style="margin-bottom:1rem;"></p>
                <div style="display:flex; gap:1rem;">
                    <button class="submit-btn" style="background:transparent; border:1px solid var(--glass-border); color:white;" onclick="document.getElementById('election-code-modal').classList.remove('visible')">Cancel</button>
                    <button class="submit-btn" id="unlock-election-btn" style="background:linear-gradient(135deg, var(--neon-cyan), var(--neon-blue));">Unlock 🔓</button>
                </div>
            </div>
        </div>
`;

if (!html.includes('id="lobby-section"')) {
    html = html.replace('<!-- ELECTION STATUS / TIMER SKELETON -->', lobbyHtml + '\n        <!-- ELECTION STATUS / TIMER SKELETON -->');
}

// 2. Add globals
const globals = `        let currentElectionCode = null;
        let currentElectionData = null;
        let myElections = [];`;
html = html.replace('let selectedCandidateId = null;', globals + '\n        let selectedCandidateId = null;');

// 3. Prevent 'ALREADY VOTED' global block if we use lobbies
html = html.replace('if (user.hasVoted === 1 || user.hasVoted === true) {', 'if (false) { // Disabled global lock out for multi-tier support');

// 4. Change init() call from checkElectionStatus() to loadLobby()
html = html.replace('checkElectionStatus();', 'loadLobby();');

// 5. Add loadLobby and attemptEnterElection logic
const newJs = `        async function loadLobby() {
            const grid = document.getElementById('elections-lobby-grid');
            document.getElementById('lobby-section').style.display = 'block';
            document.getElementById('voting-section').classList.add('hidden');
            document.getElementById('status-banner').classList.add('hidden');
            document.getElementById('election-timer-container').classList.add('hidden');

            try {
                grid.innerHTML = '<p class="text-muted text-center" style="grid-column:1/-1;">Loading available elections...</p>';
                myElections = await StorageManager.fetchMyElections(currentUser.regNum, currentUser.institution);
                grid.innerHTML = '';
                
                if(myElections.length === 0) {
                    grid.innerHTML = \`
                        <div class="glass-panel text-center" style="grid-column:1/-1; padding:3rem;">
                            <div style="font-size:3rem; margin-bottom:1rem; opacity:0.5;">📭</div>
                            <h2>No Active Polls</h2>
                            <p class="text-muted">There are currently no active elections that require your vote.</p>
                        </div>
                    \`;
                    return;
                }

                myElections.forEach(elec => {
                    const card = document.createElement('div');
                    card.className = "glass-panel";
                    card.style.padding = "2rem";
                    card.style.position = "relative";
                    card.style.transition = "transform 0.3s ease, box-shadow 0.3s ease";
                    card.style.cursor = elec.hasVoted ? "default" : "pointer";
                    card.onmouseover = () => { if(!elec.hasVoted) card.style.transform = "translateY(-5px)"; };
                    card.onmouseout = () => { card.style.transform = "none"; };

                    if (elec.hasVoted) {
                        card.innerHTML = \`
                            <div style="position:absolute; top:1rem; right:1rem; background:rgba(16,185,129,0.2); color:var(--success); padding:4px 10px; border-radius:8px; font-size:0.75rem; font-weight:bold;">Voted ✅</div>
                            <h3 style="color:var(--text-muted); font-family:var(--font-heading); margin-right:60px;">\${elec.name}</h3>
                            <p class="text-muted" style="font-size:0.85rem; margin-top:0.5rem; text-transform:uppercase; letter-spacing:1px; color:var(--neon-cyan);">\${elec.type} tier</p>
                            <p style="margin-top:1.5rem; color:var(--text-muted); font-size:0.9rem;">Your vote is secure in the ledger.</p>
                        \`;
                    } else {
                        card.innerHTML = \`
                            <div style="position:absolute; top:1rem; right:1rem; background:rgba(6,182,212,0.2); color:var(--neon-cyan); padding:4px 10px; border-radius:8px; font-size:0.75rem; font-weight:bold; animation: pulse 2s infinite;">LIVE 🟢</div>
                            <h3 style="color:white; font-family:var(--font-heading); margin-right:60px;">\${elec.name}</h3>
                            <p class="text-muted" style="font-size:0.85rem; margin-top:0.5rem; text-transform:uppercase; letter-spacing:1px; color:var(--neon-cyan);">\${elec.type} tier</p>
                            <button class="submit-btn" style="margin-top:2rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">Enter Ballot ➔</button>
                        \`;
                        card.onclick = () => attemptEnterElection(elec);
                    }
                    grid.appendChild(card);
                });
            } catch(e) { console.error(e); }
        }

        function attemptEnterElection(elec) {
            if (elec.electionCode !== 'global') {
                document.getElementById('unlock-election-name').innerText = elec.name;
                document.getElementById('election-access-code').value = '';
                document.getElementById('code-error').classList.add('hidden');
                
                const btn = document.getElementById('unlock-election-btn');
                btn.onclick = () => {
                    const input = document.getElementById('election-access-code').value.toUpperCase().trim();
                    if(input === elec.electionCode) {
                        document.getElementById('election-code-modal').classList.remove('visible');
                        enterBallot(elec);
                    } else {
                        document.getElementById('code-error').innerText = "Incorrect Access Code";
                        document.getElementById('code-error').classList.remove('hidden');
                    }
                };
                
                document.getElementById('election-code-modal').classList.add('visible');
            } else {
                enterBallot(elec);
            }
        }

        function enterBallot(elec) {
            currentElectionCode = elec.electionCode;
            currentElectionData = elec;
            
            document.getElementById('lobby-section').style.display = 'none';
            document.getElementById('voting-section').classList.remove('hidden');
            document.getElementById('election-timer-container').classList.remove('hidden');
            
            let bb = document.getElementById('back-to-lobby-btn');
            if(!bb) {
                bb = document.createElement('button');
                bb.id = 'back-to-lobby-btn';
                bb.className = 'btn-outline';
                bb.innerHTML = '⬅️ Back to Lobbies';
                bb.style.marginBottom = '2rem';
                bb.onclick = () => { location.reload(); };
                document.getElementById('voting-section').prepend(bb);
            }

            // Hacked Timer implementation for Multi-Tier
            checkElectionStatusForTier(elec);
        }

        function checkElectionStatusForTier(electionObj) {
            const timerContainer = document.getElementById('election-timer-container');
            const overlay = document.getElementById('hard-close-overlay');
            const skeleton = document.getElementById('voting-skeleton-loader');
            
            let currentStatus = null;
            
            const updateTimer = () => {
                const now = new Date().getTime();
                const startT = electionObj.startTime ? new Date(electionObj.startTime).getTime() : 0;
                const endT = electionObj.endTime ? new Date(electionObj.endTime).getTime() : 0;
                
                let targetDate, labelText, statusText, colorClass = "var(--neon-cyan)", statusKey;
                let isLive = false;

                if (!startT || !endT) { currentStatus = 'closed'; return; }

                if (now < startT) {
                    targetDate = startT; labelText = "Election Starts In"; statusText = "Prepare to cast your vote"; statusKey = 'upcoming';
                } else if (now < endT) {
                    targetDate = endT; labelText = "Election Ends In"; statusText = "Polls are open — Cast your vote!"; colorClass = "var(--success)"; isLive = true; statusKey = 'live';
                } else { statusKey = 'closed'; }

                if (currentStatus !== statusKey) {
                    timerContainer.innerHTML = \`
                        <div class="election-timer-banner" style="border-color: \${colorClass}44; background: \${colorClass}08;">
                            <div class="timer-label">
                                <h4 style="color: \${colorClass};">\${labelText}</h4>
                                <p>\${statusText}</p>
                            </div>
                            <div class="timer-display">
                                <div class="time-block"><div id="elec-days" class="time-value">0</div><div class="time-unit">D</div></div>
                                <div class="time-block"><div id="elec-hours" class="time-value">0</div><div class="time-unit">H</div></div>
                                <div class="time-block"><div id="elec-mins" class="time-value">0</div><div class="time-unit">M</div></div>
                                <div class="time-block"><div id="elec-secs" class="time-value">0</div><div class="time-unit">S</div></div>
                            </div>
                        </div>
                    \`;
                    currentStatus = statusKey;
                }

                if(!isLive && statusKey === 'closed') {
                    overlay.classList.remove('hidden'); return;
                }

                const diff = targetDate - now;
                document.getElementById('elec-days').textContent = Math.floor(diff / (1000 * 60 * 60 * 24));
                document.getElementById('elec-hours').textContent = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                document.getElementById('elec-mins').textContent = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                document.getElementById('elec-secs').textContent = Math.floor((diff % (1000 * 60)) / 1000);

                if (isLive) {
                    overlay.classList.add('hidden');
                    skeleton.classList.add('hidden');
                    if (document.getElementById('candidates-grid').children.length === 0) {
                        loadCandidates(electionObj);
                    }
                }
            };
            updateTimer();
            setInterval(updateTimer, 1000);
        }`;

if(!html.includes('loadLobby()')) {
    html = html.replace('async function checkElectionStatus() {', newJs + '\n\n        async function checkElectionStatus() {');
}

// 6. Overwrite loadCandidates definition to take (elec) and filter
html = html.replace('async function loadCandidates() {', 'async function loadCandidates(elecObj) {');
html = html.replace('candidates = fetchedCandidates.filter(c => c.institution === currentUser.institution); // Strictly confine candidates to voter\'s institution', `candidates = fetchedCandidates.filter(c => c.institution === currentUser.institution);
            
            // MULTI-TIER SCOPE FILTER
            if (elecObj && elecObj.electionCode !== 'global') {
                let scope = {};
                try { scope = JSON.parse(elecObj.scope); } catch(e){}
                candidates = candidates.filter(c => {
                    if (elecObj.type === 'class') {
                        return c.branch === scope.branch && c.class === scope.class;
                    } else if (elecObj.type === 'branch') {
                        return c.branch === scope.branch;
                    }
                    return true;
                });
            }`);

// 7. Change the final vote submit in startVoteFlow to pass currentElectionCode to StorageManager.vote
html = html.replace('const hash = await StorageManager.vote(currentUser.regNum, candidatePayload, voteWebcamPhoto);', 
                    'const hash = await StorageManager.vote(currentUser.regNum, candidatePayload, voteWebcamPhoto, currentElectionCode);');

// 8. Overwrite final Success screen to reset to lobby? Actually, location.reload() is fine on success.
html = html.replace('showToast("Vote Submitted Successfully! Generating Receipt...", "success");', 
`showToast("Vote Submitted Successfully! Generating Receipt...", "success");
                    setTimeout(() => { location.reload(); }, 6000); // Send back to lobby`);

fs.writeFileSync(path, html, 'utf8');
console.log("Successfully patched voter_dashboard.html");

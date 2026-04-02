// API Configuration
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '') ? 'http://localhost:3001/api' : '/api';

// Shared utilities
async function fetchApi(path, options = {}, retries = 2) {
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });
        if (!res.ok) {
            let err;
            try { err = await res.json(); } catch(e) { err = { error: res.statusText }; }
            throw new Error(err.error || "API Request Failed");
        }
        return await res.json();
    } catch (e) {
        if (retries > 0 && e.message !== "Not found" && !e.message.includes("exists")) {
            console.warn(`[OVS Network] Fetch failed: ${e.message}. Retrying... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 600)); // wait 600ms before retry
            return fetchApi(path, options, retries - 1);
        }
        throw e;
    }
}

const StorageManager = {
    saveSession(user) {
        localStorage.setItem('ovs_currentUser', JSON.stringify(user));
    },

    getCurrentUser() {
        const user = localStorage.getItem('ovs_currentUser');
        return user ? JSON.parse(user) : null;
    },

    logout() {
        this.logAudit("User logged out", this.getCurrentUser()?.regNum || "Unknown");
        localStorage.removeItem('ovs_currentUser');
    },

    async logAudit(action, userRegNum, details = "") {
        try {
            const currentUser = this.getCurrentUser();
            const institution = currentUser ? currentUser.institution : "Unknown";
            await fetchApi('/auditLogs', {
                method: 'POST',
                body: JSON.stringify({ action, user: userRegNum, details, timestamp: new Date().toISOString(), institution })
            });
        } catch(e) { console.error("Audit Log Failure: ", e); }
    },

    async getAuditLogs() {
        try {
            const currentUser = this.getCurrentUser();
            const inst = currentUser ? currentUser.institution : "";
            return await fetchApi(`/auditLogs?institution=${encodeURIComponent(inst)}`);
        } catch(e) { console.error(e); return []; }
    },

    async getDeviceFingerprint() {
        const screenRes = `${window.screen.width}x${window.screen.height}`;
        const colorDepth = window.screen.colorDepth;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const language = navigator.language;
        const userAgent = navigator.userAgent;
        const rawString = `${screenRes}|${colorDepth}|${timezone}|${language}|${userAgent}`;
        
        let hash = 0;
        for (let i = 0; i < rawString.length; i++) {
            const char = rawString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; 
        }
        return `FP-${Math.abs(hash).toString(16).toUpperCase()}`;
    },

    async checkAndLogFingerprint(action, regNum) {
        const fp = await this.getDeviceFingerprint();
        
        try {
            let fpData;
            try {
                fpData = await fetchApi(`/deviceFingerprints/${fp}`);
            } catch (e) {
                fpData = null; // not found
            }

            if (fpData) {
                const counts = fpData.counts || {};
                
                if (!counts[regNum]) counts[regNum] = { registrations: 0, votes: 0 };

                if (action === 'register') {
                    counts[regNum].registrations++;
                    if (Object.keys(counts).length > 3) {
                         this.logAudit("Multiple Accounts Flag", regNum, `Device Fingerprint ${fp} has ${Object.keys(counts).length} users.`);
                    }
                } else if (action === 'vote') {
                    counts[regNum].votes++;
                     if (Object.keys(counts).length > 5) {
                         this.logAudit("Multiple Votes Flag", regNum, `Device Fingerprint ${fp} used for ${Object.keys(counts).length} votes.`);
                    }
                }
                await fetchApi('/deviceFingerprints', {
                    method: 'POST',
                    body: JSON.stringify({ fingerprint: fp, firstSeen: fpData.firstSeen, lastActive: new Date().toISOString(), counts })
                });
            } else {
                const counts = {};
                counts[regNum] = { registrations: action === 'register' ? 1 : 0, votes: action === 'vote' ? 1 : 0 };
                await fetchApi('/deviceFingerprints', {
                    method: 'POST',
                    body: JSON.stringify({ fingerprint: fp, firstSeen: new Date().toISOString(), lastActive: new Date().toISOString(), counts })
                });
            }
            return fp;
        } catch (e) {
            console.error("Fingerprint Error:", e);
            return fp;
        }
    },

    async hashPassword(password) {
        return btoa(password); 
    },

    // --- OFFLINE/FIRESTORE IMAGE COMPRESSION ---
    async compressImage(base64Str, maxWidth = 500, maxHeight = 500, quality = 0.5) {
        if (!base64Str || !base64Str.startsWith('data:image')) return base64Str; 
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressedString = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedString);
            };
            img.onerror = () => {
                resolve(base64Str);
            };
        });
    },

    // --- REGISTRATION ---
    async addUser(user) {
        if (user.password) {
            user.password = await this.hashPassword(user.password);
        }
        
        if (user.aiVerified === true) {
            user.status = 'active';
            this.logAudit("AI Auto-Approved Registration", user.regNum);
        } else {
            user.status = 'pending';
        }
        delete user.aiVerified; // Clean up before POST

        user.hasVoted = false;
        user.isBanned = false;

        if (user.portrait) user.portrait = await this.compressImage(user.portrait, 400, 400, 0.4);
        if (user.webcamReg) user.webcamReg = await this.compressImage(user.webcamReg, 400, 400, 0.4);
        
        try {
            // Check if user exists
            let existingUser;
            try {
                existingUser = await fetchApi(`/users/${user.regNum}`);
            } catch (e) { existingUser = null; }

            if (existingUser) {
                if (existingUser.isBanned || existingUser.isBanned === 1) {
                    throw new Error("This Registration Number is permanently BANNED and cannot register again.");
                }
                throw new Error("Registration Number already exists.");
            }

            if (user.role === 'voter' && user.inviteCode) {
                // If invite code used, find candidate
                const candidates = await this.getCandidates();
                const cand = candidates.find(c => c.inviteCode === user.inviteCode);
                if (cand) {
                    await fetchApi(`/users/${cand.regNum}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ campaignPoints: (cand.campaignPoints || 0) + 1 })
                    });
                }
            }

            if (user.role === 'contestant') user.campaignPoints = 0;

            const fp = await this.checkAndLogFingerprint('register', user.regNum);
            user.deviceFingerprint = fp;

            await fetchApi('/users/add', {
                method: 'POST',
                body: JSON.stringify(user)
            });
            return true;
        } catch (error) {
            console.error("Add User Error: ", error);
            throw new Error(error.message);
        }
    },

    // --- LOGIN ---
    async login(regNum, password, skip2FA = false) {
        try {
            let userData;
            try {
                userData = await fetchApi(`/users/${regNum}`);
            } catch (e) {
                if (e.message === "Not found") return null;
                throw new Error(`Backend connection failed: ${e.message}. If on Vercel, ensure TURSO DB variables are set.`);
            }

            if (!userData) return null;

            if (userData.isBanned || userData.isBanned === 1) throw new Error("This account has been banned by the Administrator.");
            if (userData.status === 'pending') throw new Error("Your registration is pending Admin Approval.");

            // Enforce Institution Isolation for all roles except Developer
            const activeInst = localStorage.getItem('ovs_inst_name');
            if (userData.role !== 'developer' && activeInst && userData.institution !== activeInst) {
                // Ignore empty institutions to preserve backwards compatibility during migration
                if (userData.institution && userData.institution !== 'Unknown') {
                    throw new Error("User does not belong to this Institution.");
                }
            }

            const hashedPwd = await this.hashPassword(password);
            const isMatch = (userData.password === password || userData.password === hashedPwd);

            if (!isMatch) throw new Error("Invalid credentials.");

            if (!skip2FA && userData.role === 'superadmin') {
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                await this.sendEmailOtp(userData.email, userData.name, otp, "Super Admin 2FA Login");
                return { requires2FA: true, otpRequired: otp, userObj: userData };
            }

            // Convert booleans for client consistency
            if (userData.hasVoted === 1) userData.hasVoted = true;
            if (userData.hasVoted === 0) userData.hasVoted = false;
            if (userData.canVote === 1) userData.canVote = true;
            if (userData.canVote === 0) userData.canVote = false;
            if (userData.isBanned === 1) userData.isBanned = true;
            if (userData.isBanned === 0) userData.isBanned = false;
            
            this.saveSession(userData);
            this.logAudit(`${userData.role.toUpperCase()} Login Success`, regNum);
            return userData;
        } catch (error) {
            console.error("Login Error: ", error);
            throw new Error(error.message);
        }
    },

    async resetPassword(regNum, newPassword) {
        let doc;
        try { doc = await fetchApi(`/users/${regNum}`); } catch(e) { throw new Error("User not found"); }
        if (!doc) throw new Error("User not found");

        const hashedPwd = await this.hashPassword(newPassword);
        await fetchApi(`/users/${regNum}`, {
            method: 'PATCH',
            body: JSON.stringify({ password: hashedPwd })
        });
        return true;
    },

    async updateUserDetails(regNum, updates) {
        if (updates.password) {
            updates.password = await this.hashPassword(updates.password);
        }

        await fetchApi(`/users/${regNum}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
        
        const current = this.getCurrentUser();
        if (current && current.regNum === regNum) {
            this.saveSession({ ...current, ...updates });
        }
        this.logAudit("Profile Updated", regNum);
        return true;
    },

    async sendResetOtp(regNum) {
        console.log(`[StorageManager] Attempting password reset for: ${regNum}`);
        try {
            let userData;
            try { userData = await fetchApi(`/users/${regNum}`); } catch(e) { }
            
            if (!userData) {
                console.warn(`[StorageManager] Reset failed: User ID ${regNum} not found.`);
                return { success: false, error: `ID "${regNum}" is not registered.` };
            }

            if (!userData.email) {
                console.warn(`[StorageManager] Reset failed: User ${regNum} has no email.`);
                return { success: false, error: "Account exists but has no recovery email." };
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            console.log(`[StorageManager] OTP for ${regNum} is ${otp}`); 
            
            const maskedEmail = userData.email.replace(/^(.{2})(.*)(@.*)$/, "$1***$3");
            
            try {
                await this.sendEmailOtp(userData.email, userData.name, otp, "Password Reset Request");
                return { success: true, otp: otp, maskedEmail: maskedEmail };
            } catch (emailErr) {
                console.error("[StorageManager] Email sending failed, providing fallback:", emailErr);
                return { 
                    success: true, 
                    otp: otp, 
                    maskedEmail: maskedEmail, 
                    warning: "Email service unavailable. Using local fallback. (Check console or use 123456 as test code if this is a development environment)" 
                };
            }
        } catch (err) {
            console.error("[StorageManager] sendResetOtp Critical Error:", err);
            return { success: false, error: err.message };
        }
    },

    async sendEmailOtp(email, name, otp, context) {
         console.log(`[EmailSystem] Sending ${context} OTP to ${email}`);
         const PUBLIC_KEY = "Iv4IKpLnL_2v-p5Ne"; 
         const SERVICE_ID = "service_emwze5b";
         const TEMPLATE_ID = "template_vcrerg5";
         
         if (typeof emailjs === 'undefined') {
             throw new Error("EmailJS library not loaded. Check your connection.");
         }

         try {
             await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
                 name: name,
                 otp: otp,
                 context: context,
                 to_email: email
             }, PUBLIC_KEY);
             console.log("[EmailSystem] Success: Email sent via EmailJS");
             return true;
         } catch (error) {
             console.error("[EmailSystem] EmailJS Error:", error);
             throw error;
         }
    },

    // --- VOTING ---
    async getElectionStatus() {
        try {
            const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
            return await fetchApi(`/config/election_${inst}`);
        } catch (e) {
            return { isActive: false, isCompleted: false, startTime: null, endTime: null };
        }
    },

    async setElectionTimes(startTime, endTime) {
        const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
        await fetchApi(`/config/election_${inst}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { startTime, endTime } })
        });
    },

    async pauseElection(diff) {
        const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
        await fetchApi(`/config/election_${inst}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { isActive: false, frozenRemaining: diff } })
        });
    },

    async resumeElection() {
        const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
        await fetchApi(`/config/election_${inst}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { isActive: true, frozenRemaining: null } })
        });
    },

    async setElectionCompletion(isCompleted) {
        const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
        await fetchApi(`/config/election_${inst}`, {
            method: 'POST',
            body: JSON.stringify({ merge: true, data: { isCompleted: isCompleted, isActive: false } })
        });
    },

    async resetElection() {
        const inst = localStorage.getItem('ovs_inst_name') || 'Unknown';
        await fetchApi('/election/reset', { 
            method: 'POST',
            body: JSON.stringify({ institution: inst })
        });
    },

    async getCandidates() {
        return await fetchApi('/candidates');
    },

    async generateVoteHash(voterRegNum, candidateRegNum) {
        const str = voterRegNum + candidateRegNum + Date.now().toString() + Math.random().toString();
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; 
        }
        return "VOTE-RECEIPT-" + Math.abs(hash).toString(16).toUpperCase() + "-" + Date.now().toString().slice(-4);
    },

    async vote(voterRegNum, candidateRegNum, webcamPhoto) {
        const finalVotePhoto = webcamPhoto ? await this.compressImage(webcamPhoto, 400, 400, 0.4) : null;
        const secureHash = await this.generateVoteHash(voterRegNum, candidateRegNum);
        const fp = await this.checkAndLogFingerprint('vote', voterRegNum);

        await fetchApi('/vote', {
            method: 'POST',
            body: JSON.stringify({
                voterRegNum,
                candidateRegNum,
                votePhoto: finalVotePhoto,
                secureHash,
                fp,
                timestamp: new Date().toISOString()
            })
        });

        let voterData = await fetchApi(`/users/${voterRegNum}`);
        this.saveSession({ ...voterData, hasVoted: true, votedFor: candidateRegNum, voteReceiptHash: secureHash, voteStatus: 'pending' });
        this.logAudit("Vote Cast (Pending)", voterRegNum, `Receipt: ${secureHash}`);
        return secureHash;
    },

    // --- REALTIME LISTENERS (Replaced with Polling) ---
    _processStatsSnapshot(users) {
        let stats = {
            totalVoters: 0, totalContestants: 0, votesCast: 0, votesPending: 0, votesNotCast: 0,
            voters: [], contestants: [], candidateVotes: {}
        };
        users.forEach(user => {
            // Check for sqlite boolean representations
            if (user.hasVoted === 1) user.hasVoted = true;
            if (user.hasVoted === 0) user.hasVoted = false;
            if (user.canVote === 1) user.canVote = true;
            if (user.canVote === 0) user.canVote = false;
            if (user.isBanned === 1) user.isBanned = true;
            if (user.isBanned === 0) user.isBanned = false;

            if (user.role === 'voter') {
                stats.totalVoters++;
                stats.voters.push(user);
                if (user.hasVoted) {
                    if (user.voteStatus === 'pending' || user.status === 'pending_vote_verification') {
                         stats.votesPending++;
                    } else {
                         stats.votesCast++;
                         if (!stats.candidateVotes[user.votedFor]) stats.candidateVotes[user.votedFor] = 0;
                         stats.candidateVotes[user.votedFor]++;
                    }
                } else {
                    stats.votesNotCast++;
                }
            } else if (user.role === 'contestant') {
                stats.totalContestants++;
                stats.contestants.push(user);
                if (!stats.candidateVotes[user.regNum]) stats.candidateVotes[user.regNum] = 0;
            }
        });
        return stats;
    },

    listenToStats(callback) {
        let lastDataStr = "";
        const poll = async () => {
            try {
                const allUsers = await fetchApi('/users');
                // Filter strictly to active institution only
                const activeInst = localStorage.getItem('ovs_inst_name');
                const users = activeInst
                    ? allUsers.filter(u => u.institution === activeInst || u.role === 'superadmin' && u.institution === activeInst)
                    : allUsers;
                const stats = this._processStatsSnapshot(users);
                const newDataStr = JSON.stringify(stats);
                if (newDataStr !== lastDataStr) {
                    lastDataStr = newDataStr;
                    callback(stats);
                }
            } catch (e) { console.error("Stats poll error:", e); }
        };
        poll();
        const interval = setInterval(poll, 3000); // 3 sec polling
        return () => clearInterval(interval); // Unsubscribe
    },

    listenToElection(callback) {
        let lastDataStr = "";
        const poll = async () => {
            try {
                const doc = await this.getElectionStatus();
                const newDataStr = JSON.stringify(doc);
                if (newDataStr !== lastDataStr) {
                    lastDataStr = newDataStr;
                    callback(doc);
                }
            } catch (e) {
                console.error("Election poll error:", e);
                callback({ isActive: false, isCompleted: false, startTime: null, endTime: null });
            }
        };
        poll();
        const interval = setInterval(poll, 3000);
        return () => clearInterval(interval);
    },

    // --- Q&A BOARD ---
    async submitQuestion(candidateRegNum, voterName, questionText) {
        await fetchApi('/questions', {
            method: 'POST',
            body: JSON.stringify({ candidateId: candidateRegNum, voterName, question: questionText, timestamp: new Date().toISOString() })
        });
    },
    async getQuestions(candidateRegNum) {
        return await fetchApi(`/questions/${candidateRegNum}`);
    },
    async answerQuestion(questionId, answerText) {
        await fetchApi(`/questions/${questionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ answer: answerText })
        });
    },

    // --- ADMIN ACTIONS ---
    async updateAdminId(oldRegNum, newRegNum) {
        let oldDoc;
        try { oldDoc = await fetchApi(`/users/${oldRegNum}`); } catch (e) { throw new Error("Admin user not found"); }
        if (!oldDoc) throw new Error("Admin user not found");

        let newDocExists = false;
        try { const d = await fetchApi(`/users/${newRegNum}`); if(d) newDocExists = true; } catch(e) {}
        if (newDocExists) throw new Error("New Admin ID already taken");

        oldDoc.regNum = newRegNum;
        await fetchApi('/users/add', { method: 'POST', body: JSON.stringify(oldDoc) });
        await fetchApi(`/users/${oldRegNum}`, { method: 'DELETE' });

        await this.logAudit("Changed Admin ID", oldRegNum, `New ID: ${newRegNum}`);
    },

    async getUsers() {
        return await fetchApi('/users');
    },
    async clearUsersByRole(role) {
        await fetchApi(`/users/role/${role}`, { method: 'DELETE' });
    },
    async getAnnouncement() {
        try {
            const doc = await fetchApi('/config/announcement');
            return doc.message || null;
        } catch(e) { return null; }
    },
    async setAnnouncement(msg) {
        await fetchApi('/config/announcement', {
            method: 'POST',
            body: JSON.stringify({ merge: false, data: { message: msg } })
        });
    },
    async approveUser(regNum) {
        await fetchApi(`/users/${regNum}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
        this.logAudit("Approved User", regNum);
    },
    async rejectUser(regNum, reason) {
        await fetchApi(`/users/${regNum}`, { method: 'DELETE' });
        this.logAudit("Rejected User", regNum, reason);
    },
    async deleteUser(regNum) {
        await fetchApi(`/users/${regNum}`, { method: 'DELETE' });
        this.logAudit("Deleted User Account", regNum);
    },
    async banUser(regNum) {
        await fetchApi(`/users/${regNum}`, { method: 'PATCH', body: JSON.stringify({ isBanned: 1 }) });
        this.logAudit("Banned User", regNum);
    },
    async unbanUser(regNum) {
        await fetchApi(`/users/${regNum}`, { method: 'PATCH', body: JSON.stringify({ isBanned: 0 }) });
        this.logAudit("Unbanned User", regNum);
    },
    async verifyVote(regNum, isValid) {
        if (isValid) {
            await fetchApi(`/users/${regNum}`, { method: 'PATCH', body: JSON.stringify({ voteStatus: 'verified', status: 'active' }) });
        } else {
            await fetchApi(`/users/${regNum}`, { method: 'PATCH', body: JSON.stringify({ hasVoted: 0, votedFor: null, voteStatus: null, status: 'active' }) });
        }
    },

    // --- GLOBAL CHAT ---
    async sendGlobalMessage(voterName, messageText) {
        await fetchApi('/globalChat', {
            method: 'POST',
            body: JSON.stringify({ voterName, text: messageText, timestamp: new Date().toISOString() })
        });
    },
    listenToGlobalChat(callback) {
        let lastDataStr = "";
        const poll = async () => {
            try {
                const messages = await fetchApi('/globalChat');
                const newDataStr = JSON.stringify(messages);
                if (newDataStr !== lastDataStr) {
                    lastDataStr = newDataStr;
                    callback(messages.reverse()); // Reverse to match original behavior
                }
            } catch (e) { console.error("Chat poll error:", e); }
        };
        poll();
        const interval = setInterval(poll, 3000);
        return () => clearInterval(interval);
    }
};

// --- DYNAMIC PREMIUM THEME INJECTION ---
document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname.toLowerCase();
    let themeClass = 'theme-home'; // Default Home / Landing
    
    if (path.includes('login')) {
        themeClass = 'theme-login';
    } else if (path.includes('register')) {
        themeClass = 'theme-register';
    } else if (path.includes('voter_dashboard')) {
        themeClass = 'theme-voter';
    } else if (path.includes('admin_dashboard')) {
        themeClass = 'theme-admin';
    }
    
    document.body.classList.add(themeClass);
});

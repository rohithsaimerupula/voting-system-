const fs = require('fs');
let html = fs.readFileSync('subadmin_dashboard.html', 'utf8');

// The old create card (exactly as it appears now in the file)
const OLD = `      <div class="card" id="create-election-card">
        <h3>➕ Create Class Election</h3>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1.2rem;">Only students from your class can register and vote. A dynamic election code will be generated automatically.</p>
        <div class="form-grid">
          <div class="form-field"><label>Election Name</label><input type="text" id="my-elec-name" placeholder="e.g. CR Elections 2026"></div>
          <div class="form-field"><label>Start Date &amp; Time</label><input type="datetime-local" id="my-elec-start"></div>
          <div class="form-field"><label>End Date &amp; Time</label><input type="datetime-local" id="my-elec-end"></div>
        </div>
        <button class="btn btn-purple" style="margin-top:1rem" onclick="createMyElection()">🚀 Create Election &amp; Generate Code</button>
      </div>`;

const NEW = `      <div class="card" id="create-election-card">
        <h3>➕ Create Class Election</h3>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:1.5rem;">Create a class-level election with categories and candidates. A dynamic code will be generated automatically.</p>
        <div class="form-grid" style="margin-bottom:1.5rem;">
          <div class="form-field"><label>Election Name</label><input type="text" id="my-elec-name" placeholder="e.g. CR Elections 2026"></div>
          <div class="form-field"><label>Start Date &amp; Time</label><input type="datetime-local" id="my-elec-start"></div>
          <div class="form-field"><label>End Date &amp; Time</label><input type="datetime-local" id="my-elec-end"></div>
        </div>
        <!-- Category Builder -->
        <div style="border-top:1px solid var(--border);padding-top:1.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h3 style="margin:0;font-size:1rem;">📂 Categories &amp; Candidates</h3>
            <button class="btn-sm" onclick="addCategory()" style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);color:#c084fc;padding:0.4rem 0.9rem;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:0.85rem;font-weight:600;">+ Add Category</button>
          </div>
          <div id="category-builder" style="display:flex;flex-direction:column;gap:1.2rem;">
            <div style="text-align:center;padding:1.5rem;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:10px;">
              <p style="color:var(--muted);font-size:0.85rem;margin:0;">No categories yet. Click <strong style="color:#c084fc;">+ Add Category</strong> above (e.g. Boys CR, Girls CR).</p>
            </div>
          </div>
          <div style="margin-top:1rem;padding:0.8rem 1rem;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.15);border-radius:8px;font-size:0.82rem;color:#f59e0b;">
            ⚠️ Minimum 1 category with 2+ candidates required to create the election.
          </div>
        </div>
        <button class="btn btn-purple" style="margin-top:1.5rem;width:100%;" onclick="createMyElection()">🚀 Create Election &amp; Generate Code</button>
      </div>`;

if (html.includes(OLD)) {
  html = html.replace(OLD, NEW);
  fs.writeFileSync('subadmin_dashboard.html', html, 'utf8');
  console.log('SUCCESS: Category builder added to create election card');
} else {
  // Try finding partial match
  const idx = html.indexOf('id="create-election-card"');
  console.log('OLD not found. create-election-card position:', idx);
  // Show surrounding context
  if (idx > 0) console.log('Context:\n', html.substring(idx, idx+600));
}

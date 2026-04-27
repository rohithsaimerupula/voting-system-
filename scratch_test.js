const user = { name: "Rohit", role: "superadmin", institution: "KLU" };
const rawToken = btoa(unescape(encodeURIComponent(JSON.stringify(user))));
const token = encodeURIComponent(rawToken);

// Simulate URL Params
const url = `http://example.com/?sa_auth=${token}`;
const saToken = new URLSearchParams(url.split('?')[1]).get('sa_auth');

try {
  const saSession = JSON.parse(decodeURIComponent(escape(atob(saToken))));
  console.log("Success:", saSession);
} catch (e) {
  console.error("Error:", e);
}

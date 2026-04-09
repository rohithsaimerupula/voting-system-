const fs=require('fs');
const files=['login.html','admin_dashboard.html','subadmin_dashboard.html','superadmin_dashboard.html','register.html','developer.html','voter_dashboard.html'];
files.forEach(f=>{
  if(!fs.existsSync(f)) return;
  const content=fs.readFileSync(f,'utf8');
  const lines=content.split('\n');
  lines.forEach((l,i)=>{
    if(l.includes('document.getElementById') && (l.includes('.textContent') || l.includes('.innerHTML') || l.includes('innerText'))) {
      const match = l.match(/document\.getElementById\(['"]([^'"]+)['"]\)/);
      if(match) {
        const id = match[1];
        if(!content.includes('id="'+id+'"') && !content.includes("id='"+id+"'")) {
          console.log(`${f}:${i+1} Missing element id="${id}"`);
        }
      }
    }
  });
});

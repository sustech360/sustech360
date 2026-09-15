/* tools/bench.js — counts Google operations for the paths that run most often.
 * Run from the project folder:  node tools/bench.js
 * The numbers in docs/PERFORMANCE-PLAN.md come from here. */
/* Counts Google operations for the things that happen most often. */
const path=require("path");
process.chdir(require("path").join(__dirname, ".."));
const harness=require("../tests/harness");
const fs=require("fs");

// Instrument the sheet stub by wrapping SpreadsheetApp after build.
function instrument(s){
  const counts={getRange:0,setValue:0,setValues:0,getValues:0,appendRow:0,getLastRow:0,driveRead:0,driveWrite:0};
  
  const sheets=s.sheets;
  sheets.forEach((sh)=>{
    const gr=sh.getRange.bind(sh), ar=sh.appendRow.bind(sh), lr=sh.getLastRow.bind(sh);
    sh.getLastRow=()=>{counts.getLastRow++;return lr();};
    sh.appendRow=(r)=>{counts.appendRow++;return ar(r);};
    sh.getRange=(...a)=>{counts.getRange++;const rng=gr(...a);
      const sv=rng.setValue&&rng.setValue.bind(rng), svs=rng.setValues&&rng.setValues.bind(rng), gv=rng.getValues&&rng.getValues.bind(rng);
      if(sv) rng.setValue=(v)=>{counts.setValue++;return sv(v);};
      if(svs) rng.setValues=(v)=>{counts.setValues++;return svs(v);};
      if(gv) rng.getValues=()=>{counts.getValues++;return gv();};
      return rng;};
  });
  return counts;
}

const s=harness.build({ENV:"test",SPREADSHEET_ID:"x",DRIVE_FOLDER_ID:"y",PASSWORD_PEPPER:"p",TOKEN_PEPPER:"t",
  SITE_URL:"https://sustech360.com/",GITHUB_REPO:"o/r",GITHUB_TOKEN:"g",BOOTSTRAP_EMAIL:"sup@e.test"});
s.setup();
const call=(a,p,t)=>{const r=s.doPost({postData:{contents:JSON.stringify({action:a,token:t||null,payload:p||{}})}});
  const o=JSON.parse(r.getContent()); if(!o.ok) throw new Error(o.error); return o.data;};
const pw=(s.outbox.find(m=>/Temporary password/.test(m.body)).body.match(/Temporary password: (\S+)/))[1];
const sup=call("login",{email:"sup@e.test",password:pw});

const counts=instrument(s);
const snap=()=>JSON.parse(JSON.stringify(counts));
const diff=(a,b)=>Object.keys(b).reduce((o,k)=>{if(b[k]-a[k])o[k]=b[k]-a[k];return o;},{});

// 1. A reader reporting one ad impression and five vitals — the commonest call.
let before=snap();
call("recordTelemetry",{vitals:[{m:"LCP",v:1800,p:"home",d:"mobile"},{m:"CLS",v:20,p:"home",d:"mobile"},
  {m:"INP",v:120,p:"home",d:"mobile"},{m:"FCP",v:900,p:"home",d:"mobile"},{m:"TTFB",v:300,p:"home",d:"mobile"}],
  ads:[{id:"CRE-1",i:1,c:0}]});
console.log("one visit, one beacon      :", JSON.stringify(diff(before,snap())));

before=snap();
for(let i=0;i<100;i++) call("recordTelemetry",{vitals:[{m:"LCP",v:1500+i,p:"home",d:"mobile"}],ads:[{id:"CRE-1",i:1,c:0}]});
console.log("100 more visits            :", JSON.stringify(diff(before,snap())));

before=snap();
console.log("then one flush             :", (function(){const r=s.flushTelemetry();const d=diff(before,snap());return JSON.stringify(d)+"  ("+r+")";})());

// 2. A single field update.
before=snap();
s.internals.Db.update("Users",{email:"sup@e.test"},{name:"Changed",institution:"IISc",country:"IN"});
console.log("one 3-field row update     :", JSON.stringify(diff(before,snap())));

// 3. Signing in.
before=snap();
call("login",{email:"sup@e.test",password:pw});
console.log("one sign-in                :", JSON.stringify(diff(before,snap())));

// 4. Opening the dashboard (what the studio does on every load).
before=snap();
call("studioDashboard",{},sup.token);
console.log("one dashboard load         :", JSON.stringify(diff(before,snap())));

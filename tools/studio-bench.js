/* tools/studio-bench.js — opens every studio screen and counts what each costs
 * in Apps Script executions and spreadsheet reads.
 *     npm install --no-save jsdom && node tools/studio-bench.js */
setTimeout(()=>{console.log("timed out");process.exit(1)},60000);
const fs=require("fs"),path=require("path");
process.chdir(require("path").join(__dirname, ".."));
const {build}=require("../tests/harness");
let JSDOM; try{JSDOM=require("/tmp/domtest/node_modules/jsdom").JSDOM}catch(e){JSDOM=require("jsdom").JSDOM}

const s=build({ENV:"production",SPREADSHEET_ID:"x",DRIVE_FOLDER_ID:"y",PASSWORD_PEPPER:"p",TOKEN_PEPPER:"t",
  SITE_URL:"https://sustech360.com/",GITHUB_REPO:"o/r",GITHUB_TOKEN:"g",BOOTSTRAP_EMAIL:"sup@e.test"});
s.setup();
const pw=(s.outbox.find(m=>/Temporary password/.test(m.body)).body.match(/Temporary password: (\S+)/))[1];

// count spreadsheet operations
const ops={getRange:0,getValues:0,setValues:0,setValue:0,appendRow:0,getLastRow:0};
s.sheets.forEach(sh=>{
  const gr=sh.getRange.bind(sh), lr=sh.getLastRow.bind(sh);
  sh.getLastRow=()=>{ops.getLastRow++;return lr();};
  sh.getRange=(...a)=>{ops.getRange++;const r=gr(...a);
    const gv=r.getValues&&r.getValues.bind(r), sv=r.setValues&&r.setValues.bind(r), s1=r.setValue&&r.setValue.bind(r);
    if(gv) r.getValues=()=>{ops.getValues++;return gv();};
    if(sv) r.setValues=v=>{ops.setValues++;return sv(v);};
    if(s1) r.setValue=v=>{ops.setValue++;return s1(v);};
    return r;};
});

let executions=0, calls=0;
const store={};
function studio(){
  const dom=new JSDOM(fs.readFileSync("admin/index.html","utf8"),
    {url:"https://sustech360.com/admin/",runScripts:"outside-only",pretendToBeVisual:true});
  const w=dom.window;
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
  w.MAG_ENDPOINT="https://engine.test/exec";
  Object.defineProperty(w,"localStorage",{value:{getItem:k=>(k in store?store[k]:null),
    setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},configurable:true});
  w.fetch=(u,o)=>{ executions++;   // one fetch = one Apps Script execution
    try { const b=JSON.parse(o.body); calls += b.action==="batch" ? b.payload.calls.length : 1; } catch(e){}
    return Promise.resolve({ok:true,status:200,
      json:()=>Promise.resolve(JSON.parse(s.doPost({postData:{contents:o.body}}).getContent()))}); };
  ["../assets/js/api.js","editorial.js","rulebook.js","siteadmin.js","ads-admin.js","comms.js",
   "issues-admin.js","performance.js","billing.js","email.js","published.js","admin.js"]
   .forEach(f=>{const p=f.startsWith("../")?f.replace("../",""):path.join("admin",f); w.eval(fs.readFileSync(p,"utf8"));});
  return w;
}
const w=studio(), d=w.document;
d.getElementById("email").value="sup@e.test"; d.getElementById("password").value=pw;
d.getElementById("signin").click();

function measure(label, open, then){
  const e0=executions, c0=calls, o0=JSON.parse(JSON.stringify(ops));
  open();
  setTimeout(()=>{
    console.log("  "+label.padEnd(26)+(calls-c0)+" calls -> "+(executions-e0)+" execution"+((executions-e0)===1?"":"s")+
      "   sheet reads: "+((ops.getValues-o0.getValues)));
    then();
  },500);
}
setTimeout(()=>{
  console.log("\nopening each screen in the studio\n");
  measure("dashboard", ()=>d.querySelector("#nav button[data-view=dashboard]").click(), ()=>
  measure("email centre", ()=>d.querySelector("#nav button[data-view=emails]").click(), ()=>
  measure("advertising", ()=>d.querySelector("#nav button[data-view=advertising]").click(), ()=>
  measure("billing", ()=>d.querySelector("#nav button[data-view=billing]").click(), ()=>
  measure("performance", ()=>d.querySelector("#nav button[data-view=performance]").click(), ()=>
  measure("navigation", ()=>d.querySelector("#nav button[data-view=menus]").click(), ()=>{
    console.log("\n  six screens: "+calls+" calls travelled in "+executions+" executions");
    process.exit(0);
  }))))));
},400);

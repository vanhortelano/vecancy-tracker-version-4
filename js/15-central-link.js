// js/15-central-link.js — Link this dormitory to the Super Admin's central platform.
// The central platform lives in a SEPARATE Firestore database ("central") of the same
// Firebase project. The compat SDK used by this app can't open a named database, so
// this file talks to it through Firestore's REST API with the signed-in user's token;
// central.rules still decides what is allowed.
const CL = {branch:null, pairing:null, timer:null, busy:false, lastPush:0, lastKey:"", error:""};

function clBase(){ return "https://firestore.googleapis.com/v1/projects/" + window.FIREBASE_CONFIG.projectId + "/databases/central/documents"; }
function clEnc(v){
  if (v instanceof Date) return {timestampValue:v.toISOString()};
  if (typeof v === "boolean") return {booleanValue:v};
  if (typeof v === "number") return Number.isInteger(v) ? {integerValue:String(v)} : {doubleValue:v};
  return {stringValue:String(v)};
}
function clDec(fields){
  const out = {};
  Object.keys(fields||{}).forEach(k=>{
    const x = fields[k];
    out[k] = x.stringValue !== undefined ? x.stringValue
      : x.integerValue !== undefined ? Number(x.integerValue)
      : x.booleanValue !== undefined ? x.booleanValue
      : x.timestampValue ? new Date(x.timestampValue) : x.doubleValue;
  });
  return out;
}
async function clReq(method, path, obj, opts){
  opts = opts || {};
  const token = await currentUser.getIdToken();
  const q = (opts.mask||[]).map(m=>"updateMask.fieldPaths=" + m);
  if (opts.createOnly) q.push("currentDocument.exists=false");
  const res = await fetch(clBase() + "/" + path + (q.length ? "?" + q.join("&") : ""), {
    method,
    headers:{Authorization:"Bearer " + token, "Content-Type":"application/json"},
    body: obj ? JSON.stringify({fields:Object.fromEntries(Object.entries(obj).map(([k,v])=>[k, clEnc(v)]))}) : undefined
  });
  const body = await res.json().catch(()=>({}));
  if (res.status === 404 && !/database/i.test((body.error && body.error.message)||"")) return null;
  if (!res.ok) throw new Error((body.error && body.error.message) || ("HTTP " + res.status));
  return body;
}
async function clAudit(action, detail){
  try{
    await clReq("POST", "audit", {actorUid:currentUser.uid, actorEmail:currentUser.email||"", action, branch:(CL.branch&&CL.branch.dormName)||"", detail:detail||"", at:new Date()});
  }catch(e){ /* audit is best effort */ }
}

async function clRefresh(){
  if (!currentUser || CL.busy) return;
  try{
    const doc = await clReq("GET", "branches/" + currentUser.uid);
    CL.branch = doc ? clDec(doc.fields) : null;
    if (CL.branch) CL.pairing = null;
    CL.error = "";
  }catch(e){ CL.error = e.message; }
  if (activeTab === "central") renderCentralLink();
}

function clSummary(){
  const s = {total:0, vacant:0, occupied:0, maleVacant:0, femaleVacant:0, studentVacant:0, revieweeVacant:0, acVacant:0, nonAcVacant:0};
  rooms.forEach(room=>{
    const v = roomVacancy(room);
    s.total += v.total; s.vacant += v.vacant;
    if (room.gender === "Male") s.maleVacant += v.vacant;
    if (room.gender === "Female") s.femaleVacant += v.vacant;
    if (room.demographic === "Students") s.studentVacant += v.vacant;
    if (room.demographic === "Reviewees") s.revieweeVacant += v.vacant;
    if (room.ac) s.acVacant += v.vacant; else s.nonAcVacant += v.vacant;
  });
  s.occupied = s.total - s.vacant;
  return s;
}

async function clSync(force){
  const b = CL.branch;
  if (!b || !currentUser || !assistantDataLoaded.rooms || CL.busy) return;
  const uid = currentUser.uid, s = clSummary(), key = JSON.stringify(s);
  try{
    if (b.dirStatus === "approved" && (force || key !== CL.lastKey || Date.now() - CL.lastPush > 10*60000)){
      await clReq("PATCH", "directory/" + uid, {ownerUid:uid, dormName:b.dormName, location:b.location || "", ...s, updatedAt:new Date()});
      CL.lastKey = key; CL.lastPush = Date.now();
    }
    if (b.analyticsStatus === "approved"){
      const k = "clSnap_" + uid, last = Number(localStorage.getItem(k) || 0);
      if (force || Date.now() - last >= 15*60000){
        await clReq("POST", "branches/" + uid + "/snapshots", {...s, capturedAt:new Date()});
        localStorage.setItem(k, String(Date.now()));
      }
    }
    CL.error = "";
  }catch(e){ CL.error = e.message; }
}

function clStart(){
  if (CL.timer || !window.FIREBASE_CONFIG) return;
  const tick = async()=>{ await clRefresh(); await clSync(false); };
  tick();
  CL.timer = setInterval(tick, 60000);
}
function clStop(){
  if (CL.timer) clearInterval(CL.timer);
  CL.timer = null; CL.branch = null; CL.pairing = null; CL.lastKey = ""; CL.lastPush = 0; CL.error = "";
}

function clCode(){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const c = Array.from(bytes, b=>chars[b % chars.length]).join("");
  return c.slice(0,4) + "-" + c.slice(4);
}

async function clGeneratePairing(){
  const name = document.getElementById("clDormName").value.trim();
  const location = document.getElementById("clLocation").value.trim();
  if (!name){ CL.error = "Enter your dormitory name first."; return renderCentralLink(); }
  const code = clCode(), expires = new Date(Date.now() + 10*60000);
  CL.busy = true;
  try{
    await clReq("PATCH", "pairing/" + code, {ownerUid:currentUser.uid, dormName:name, location, expiresAt:expires}, {createOnly:true});
    CL.pairing = {code, expires, name}; CL.error = "";
  }catch(e){ CL.error = "Could not create a code: " + e.message; }
  CL.busy = false;
  renderCentralLink();
}

async function clDecide(kind, decision){
  const word = decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "revoke";
  const text = decision === "revoked" ? "Revoke this permission? The Super Admin will stop receiving this data immediately."
    : "Are you sure you want to " + word + " this request?";
  if (!confirm(text)) return;
  const field = kind === "directory" ? "dirStatus" : "analyticsStatus";
  CL.busy = true;
  try{
    await clReq("PATCH", "branches/" + currentUser.uid, {[field]:decision, decidedAt:new Date()}, {mask:[field, "decidedAt"]});
    if (kind === "directory" && decision === "revoked"){ await clReq("DELETE", "directory/" + currentUser.uid).catch(()=>{}); CL.lastKey = ""; }
    await clAudit("PERMISSION_" + decision.toUpperCase(), kind === "directory" ? "Directory publishing" : "Historical analytics");
    CL.error = "";
  }catch(e){ CL.error = "Could not save your decision: " + e.message; }
  CL.busy = false;
  await clRefresh();
  if (decision === "approved") await clSync(true);
}

async function clDisconnect(){
  if (!confirm("Disconnect from the central platform? Both permissions end and the Super Admin must send a new request.")) return;
  CL.busy = true;
  try{ await clAudit("BRANCH_DISCONNECTED", ""); await clReq("DELETE", "directory/" + currentUser.uid).catch(()=>{}); await clReq("DELETE", "branches/" + currentUser.uid); CL.branch = null; CL.error = ""; }
  catch(e){ CL.error = "Could not disconnect: " + e.message; }
  CL.busy = false;
  renderCentralLink();
}

function clChip(status){
  const labels = {pending:"Pending", approved:"Approved", rejected:"Rejected", revoked:"Revoked"};
  return '<span class="cl-chip ' + escapeHtml(status) + '">' + (labels[status] || escapeHtml(status)) + '</span>';
}

function clRequestCard(kind, title, subtitle, text, purpose, status){
  const buttons = status === "pending"
    ? '<button class="btn btn-primary btn-sm" data-cl="' + kind + ':approved">Approve</button> <button class="btn btn-outline btn-sm" data-cl="' + kind + ':rejected">Reject</button>'
    : status === "approved" ? '<button class="btn btn-outline btn-sm" data-cl="' + kind + ':revoked">Revoke access</button>' : '<span class="va-note">Closed. Ask the Super Admin to send a new request.</span>';
  return '<div class="va-card cl-card"><div class="cl-head"><div><h3>' + title + '</h3><div class="va-note" style="margin:2px 0 0">' + subtitle + '</div></div>' + clChip(status) + '</div>'
    + '<p class="va-note">' + text + '</p><p class="va-note"><strong>Purpose:</strong> ' + purpose + '</p><div class="cl-actions">' + buttons + '</div></div>';
}

function renderCentralLink(){
  const panel = document.getElementById("centralLinkPanel");
  if (!panel) return;
  const err = CL.error ? '<p class="va-note" style="color:var(--overdue)">' + escapeHtml(CL.error) + '</p>' : "";
  if (!CL.branch){
    const p = CL.pairing && CL.pairing.expires > new Date() ? CL.pairing : null;
    const dormDefault = (p && p.name) || (viewerAccess && viewerAccess.dormName) || "";
    panel.innerHTML = '<div class="va-card"><h3>Link to the central platform</h3>'
      + '<p class="va-note">A Super Admin can ask to list your dormitory in a central directory and receive vacancy history for combined analytics. Nothing is shared until you approve it, and you can revoke it at any time. Your password is never shared.</p>'
      + '<div class="va-form"><div class="field"><label for="clDormName">Dormitory name</label><input id="clDormName" value="' + escapeHtml(dormDefault) + '"></div>'
      + '<div class="field"><label for="clLocation">Location (city)</label><input id="clLocation" placeholder="e.g. Cebu City"></div></div>'
      + '<button class="btn btn-primary" id="clGen" type="button">Generate pairing code</button>' + err
      + (p ? '<div class="cl-code"><span>Give this code to the Super Admin. It works once and expires at ' + p.expires.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) + '.</span><strong>' + escapeHtml(p.code) + '</strong></div>' : '')
      + '</div>';
    document.getElementById("clGen").onclick = clGeneratePairing;
    return;
  }
  const b = CL.branch;
  panel.innerHTML = '<div class="va-card"><h3>Connection request from the Super Admin</h3>'
    + '<p class="va-note">Two separate permissions. Approving one does not approve the other.</p>' + err
    + '<p class="va-note"><strong>Dormitory:</strong> ' + escapeHtml(b.dormName) + '</p></div>'
    + clRequestCard("directory", "Directory access", "Publish dormitory information",
        "Display your dormitory name, location and current vacancy counts (vacant, occupied, male/female, student/reviewee, aircon) in the central directory. No resident names are shared.", escapeHtml(b.purpose || "—"), b.dirStatus)
    + clRequestCard("analytics", "Analytics access", "Share vacancy analytics data",
        "Send the same aggregate counts about every 15 minutes so the Super Admin can chart trends and combined statistics. No resident names are shared.", escapeHtml(b.purpose || "—"), b.analyticsStatus)
    + '<div class="va-card"><button class="btn btn-outline btn-sm" data-cl="disconnect">Disconnect from central platform</button></div>';
}

document.addEventListener("click", event=>{
  const btn = event.target.closest("[data-cl]");
  if (!btn) return;
  if (btn.dataset.cl === "disconnect") return clDisconnect();
  const [kind, decision] = btn.dataset.cl.split(":");
  clDecide(kind, decision);
});

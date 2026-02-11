const STORAGE_KEY = "star_screenshot_progress_v2";
const TEACHER_PIN = "2026"; // change if you want

let cards = [];
let progress = loadProgress(); 
// progress = { students: { [name]: { totals:{got,close,miss}, byCard:{[cardId]:{got,close,miss,attempts,timeMs}} } } }

let currentStudent = "";
let selectedUnits = new Set();
let queue = [];
let idx = 0;

let cardStartTs = null; // for timing

const el = (id) => document.getElementById(id);

init();

async function init(){
  // Nav buttons
  el("modeStudent").onclick = () => showView("start");
  el("modeTeacher").onclick = () => {
    const pin = prompt("Teacher PIN:");
    if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");
    showView("teacher");
    renderTeacher();
  };

  // Student controls
  el("startBtn").onclick = start;
  el("changeBtn").onclick = () => { showView("start"); resetStudyUI(); };

  el("checkBtn").onclick = () => reveal();
  el("skipBtn").onclick = () => advance("skip"); // counts time/attempt but no rating

  el("rateGot").onclick = () => advance("got");
  el("rateClose").onclick = () => advance("close");
  el("rateMiss").onclick = () => advance("miss");

  // Teacher controls
  el("exportBtn").onclick = exportJSON;
  el("importFile").addEventListener("change", importJSON);
  el("resetBtn").onclick = resetAll;
  el("studentSelect").addEventListener("change", renderTeacherTableForSelectedStudent);

  // Load cards.json
  const res = await fetch("./cards.json");
  const json = await res.json();
  cards = (json.cards || []).map(c => ({ ...c, unit: Number(c.unit) }));

  buildUnitCheckboxes();
  showView("start");
}

/* ---------- Views ---------- */
function showView(which){
  el("startView").classList.toggle("hidden", which !== "start");
  el("studyView").classList.toggle("hidden", which !== "study");
  el("teacherView").classList.toggle("hidden", which !== "teacher");
}

/* ---------- Units UI ---------- */
function buildUnitCheckboxes(){
  const grid = el("unitGrid");
  grid.innerHTML = "";
  for (let u = 1; u <= 7; u++){
    const chip = document.createElement("label");
    chip.className = "unitChip";
    chip.innerHTML = `<input type="checkbox" value="${u}" checked> Unit ${u}`;
    grid.appendChild(chip);
  }
}

/* ---------- Student flow ---------- */
function start(){
  const name = el("studentName").value.trim();
  if (!name) return;

  currentStudent = name;
  ensureStudent(currentStudent);

  // collect units
  selectedUnits = new Set(
    Array.from(el("unitGrid").querySelectorAll('input[type="checkbox"]'))
      .filter(cb => cb.checked)
      .map(cb => Number(cb.value))
  );

  if (selectedUnits.size === 0){
    return alert("Please select at least one unit.");
  }

  const shuffle = el("shuffleToggle").checked;
  const onlyNeeds = el("onlyNeedsToggle").checked;

  queue = buildQueue({ shuffle, onlyNeeds });
  idx = 0;

  showView("study");
  renderCard();
}

function buildQueue({ shuffle, onlyNeeds }){
  let list = [...cards];

  // filter by units
  list = list.filter(c => selectedUnits.has(Number(c.unit)));

  // onlyNeeds practice filter
  if (onlyNeeds){
    const byCard = progress.students[currentStudent].byCard || {};
    list = list.filter(c => {
      const s = byCard[c.id];
      if (!s) return true; // unseen = needs
      return (s.miss + s.close) > s.got;
    });
  }

  if (shuffle) list = fisherYates(list);
  return list;
}

function renderCard(){
  if (queue.length === 0){
    el("questionImg").alt = "No cards found for these units.";
    el("questionImg").src = "";
    el("answerImg").src = "";
    el("studentPill").textContent = `Student: ${currentStudent}`;
    el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`;
    el("progressPill").textContent = "";
    el("cardStats").textContent = "";
    el("revealArea").classList.add("hidden");
    return;
  }

  const c = queue[idx % queue.length];

  el("studentPill").textContent = `Student: ${currentStudent}`;
  el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`;
  el("progressPill").textContent = `Card ${ (idx % queue.length) + 1 } / ${queue.length} (Unit ${c.unit})`;

  // Use your naming convention: 1aQ / 1aA
  el("questionImg").src = `./assets/${c.id}Q.png`;
  el("answerImg").src = `./assets/${c.id}A.png`;

  // Clear previous typed text when showing new card
  el("answerBox").value = "";

  // Hide answer area until check
  el("revealArea").classList.add("hidden");

  const s = progress.students[currentStudent].byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  el("cardStats").textContent =
    `This card — ✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}  | Attempts: ${s.attempts}  | Time: ${formatMs(s.timeMs)}`;

  // start timing now
  cardStartTs = Date.now();
}

function reveal(){
  el("revealArea").classList.remove("hidden");
  el("answerCol").classList.remove("hidden");
}


function resetStudyUI(){
  el("answerBox").value = "";
  el("revealArea").classList.add("hidden");
  el("answerCol").classList.add("hidden");
  
  

  cardStartTs = null;
}

/**
 * advance(mode)
 * mode = "got" | "close" | "miss" | "skip"
 * Records time + attempts always (including skip), and ratings if provided.
 */
function advance(mode){
  if (queue.length === 0) return;

  const c = queue[idx % queue.length];
  const stu = progress.students[currentStudent];

  // compute time on this card
  const now = Date.now();
  const dt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);

  // init card record
  if (!stu.byCard[c.id]) stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };

  // attempts/time always count when they leave the card
  stu.byCard[c.id].attempts += 1;
  stu.byCard[c.id].timeMs += dt;

  // rating counts only if got/close/miss
  if (mode === "got" || mode === "close" || mode === "miss"){
    stu.totals[mode] += 1;
    stu.byCard[c.id][mode] += 1;
  }

  saveProgress(progress);

  idx++;
  renderCard();
}

/* ---------- Progress storage ---------- */
function ensureStudent(name){
  if (!progress.students[name]){
    progress.students[name] = {
      totals: { got:0, close:0, miss:0 },
      byCard: {}
    };
    saveProgress(progress);
  }
}

function loadProgress(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { students:{} };
  }catch{
    return { students:{} };
  }
}

function saveProgress(obj){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/* ---------- Teacher dashboard ---------- */
function renderTeacher(){
  // populate student dropdown
  const sel = el("studentSelect");
  sel.innerHTML = "";

  const students = Object.keys(progress.students).sort((a,b)=>a.localeCompare(b));
  if (students.length === 0){
    sel.appendChild(new Option("No students yet", ""));
    el("teacherTable").innerHTML = "";
    return;
  }

  students.forEach(s => sel.appendChild(new Option(s, s)));
  sel.value = students[0];

  renderTeacherTableForSelectedStudent();
}

function renderTeacherTableForSelectedStudent(){
  const student = el("studentSelect").value;
  const body = el("teacherTable");
  body.innerHTML = "";

  if (!student || !progress.students[student]) return;

  const byCard = progress.students[student].byCard || {};

  // show rows for all cards in cards.json (even unseen)
  const sortedCards = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, {numeric:true});
  });

  for (const c of sortedCards){
    const s = byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
    const avg = s.attempts ? (s.timeMs / s.attempts) : 0;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${escapeHtml(c.id)}</b></td>
      <td>${c.unit}</td>
      <td>${s.got}</td>
      <td>${s.close}</td>
      <td>${s.miss}</td>
      <td>${s.attempts}</td>
      <td>${formatMs(s.timeMs)}</td>
      <td>${formatMs(avg)}</td>
    `;
    body.appendChild(tr);
  }
}

/* ---------- Export / Import / Reset ---------- */
function exportJSON(){
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "star-progress.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(e){
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try{
      const obj = JSON.parse(reader.result);
      if (!obj || typeof obj !== "object" || !obj.students) throw new Error("Invalid file.");
      progress = obj;
      saveProgress(progress);
      renderTeacher();
      alert("Imported!");
    }catch(err){
      alert("Import failed: " + err.message);
    }finally{
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

function resetAll(){
  if (!confirm("Reset all progress on this device?")) return;
  progress = { students:{} };
  saveProgress(progress);
  renderTeacher();
}

/* ---------- Helpers ---------- */
function fisherYates(arr){
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatMs(ms){
  ms = Number(ms) || 0;
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

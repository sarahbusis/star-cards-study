

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyke09fUi9ChB1ewAUU4EzCDquAPC1RLRcCJcQwfzPfQF78G1giSrMKSNw2Ydwm6VxW/exec";
const BACKEND_SECRET = "CHANGE_ME_TO_SOMETHING_LONG"; // must match SHARED_SECRET in Apps Script, or "" if disabled
const STUDENT_CODE = "spark2026"; // must match Code.gs

const STORAGE_KEY = "star_screenshot_progress_v3";
const TEACHER_PIN = "2026";

let cards = [];
let progress = loadProgress();

let currentStudent = "";
let selectedUnits = new Set();
let queue = [];
let idx = 0;

let cardStartTs = null;
let spanishMode = false;

// Safe getter
function el(id){
  const node = document.getElementById(id);
  if (!node) console.warn(`[STAR] Missing element id="${id}"`);
  return node;
}

document.addEventListener("DOMContentLoaded", async () => {
  wireUI();
  await loadCards();
  buildUnitCheckboxesUnchecked(); // units start UNCHECKED
  showView("start");
});

function wireUI(){
  el("modeStudent")?.addEventListener("click", () => showView("start"));

  el("modeTeacher")?.addEventListener("click", async () => {
    const pin = prompt("Teacher PIN:");
    if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");

    showView("teacher");

    // Try backend first (JSONP)
    const backend = await fetchBackendSummary(pin);
    if (backend && backend.ok && backend.students) {
      window.__teacherDataSource = "backend";
      window.__teacherBackendStudents = backend.students;
      renderTeacherFromBackend(backend.students);
      return;
    }

    // Fallback to local if backend fails
    window.__teacherDataSource = "local";
    renderTeacher();
    alert("Backend not reachable — showing only this device’s data.");
  });

  el("studentSelect")?.addEventListener("change", () => {
    if (window.__teacherDataSource === "backend") {
      const students = window.__teacherBackendStudents || {};
      renderTeacherSummaryFromBackend(students);
      renderTeacherTableForSelectedStudentFromBackend(students);
    } else {
      renderTeacherSummary();
      renderTeacherTableForSelectedStudent();
    }
  });
}
async function loadCards(){
  try{
    const res = await fetch("./cards.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`cards.json not found (HTTP ${res.status})`);

    const json = await res.json();

    // Support BOTH formats:
    // 1) Old: { cards: [...] }
    // 2) New: [ ... ]
    const arr = Array.isArray(json) ? json : (json.cards || []);

    cards = arr.map(c => ({
      ...c,
      unit: Number(c.unit),
      // Optional: default image paths if not provided
      q: c.q || `assets/${c.id}Q.png`,
      a: c.a || `assets/${c.id}A.png`,
      qsp: c.qsp || `assets/${c.id}Qsp.png`,
      asp: c.asp || `assets/${c.id}Asp.png`,
      text: c.text || "",
      answerText: c.answerText || "",
      textSp: c.textSp || "",
      answerTextSp: c.answerTextSp || ""
    }));
  }catch(err){
    console.error(err);
    alert("Could not load cards.json. Make sure it exists in the repo root.");
    cards = [];
  }
}

function showView(which){
  el("startView")?.classList.toggle("hidden", which !== "start");
  el("studyView")?.classList.toggle("hidden", which !== "study");
  el("studentDashView")?.classList.toggle("hidden", which !== "studentDash");
  el("teacherView")?.classList.toggle("hidden", which !== "teacher");
}

/* ---------- Units UI ---------- */
function buildUnitCheckboxesUnchecked(){
  const grid = el("unitGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let u = 1; u <= 7; u++){
    const chip = document.createElement("label");
    chip.className = "unitChip";
    chip.innerHTML = `<input type="checkbox" value="${u}"> Unit ${u}`;
    grid.appendChild(chip);
  }
}

/* ---------- Image paths (English vs Spanish) ---------- */
function imgPath(id, type){
  // type is "Q" or "A"

  if (!spanishMode){
    return `assets/${id}${type}.png`;
  }

  // Try Spanish version first
  const spPath = `assets/${id}${type}sp.png`;
  const enPath = `assets/${id}${type}.png`;

  // We can’t truly check existence synchronously,
  // so rely on browser error fallback
  return spPath;
}
/* ---------- Public functions (inline onclick) ---------- */
window.start = function start(){
  const name = (el("studentName")?.value || "").trim();
  if (!name) return alert("Please enter your name.");

  currentStudent = name;
  addRecentName(currentStudent);
renderRecentNamesSuggestions();
  window.currentStudent = currentStudent; // <-- make visible for debugging + consistency
  ensureStudent(currentStudent);

  spanishMode = !!el("spanishToggle")?.checked;
setSpanishMode(spanishMode); 
  const checks = Array.from(el("unitGrid")?.querySelectorAll('input[type="checkbox"]') || []);
  selectedUnits = new Set(checks.filter(c => c.checked).map(c => Number(c.value)));
  if (selectedUnits.size === 0) return alert("Please select at least one unit to study.");

  const shuffle = !!el("shuffleToggle")?.checked;
  const onlyNeeds = !!el("onlyNeedsToggle")?.checked;

  queue = buildQueue({ shuffle, onlyNeeds });
  idx = 0;

  showView("study");
  renderCard();
};

window.goToStart = function goToStart(){
  showView("start");
  resetStudyUI();
};

window.openStudentDashboard = async function openStudentDashboard(){
  let name = (currentStudent || "").trim();
  if (!name) name = (el("studentName")?.value || "").trim();
  if (!name) return alert("Enter your name first.");

  currentStudent = name;
  addRecentName(currentStudent);
renderRecentNamesSuggestions();
  window.currentStudent = currentStudent;
  ensureStudent(currentStudent);

  spanishMode = !!el("spanishToggle")?.checked;

  try{
    // Pull backend totals (all devices) and store them for dashboard rendering
    const backendStu = await fetchBackendStudent(currentStudent);
    window.__studentBackend = (backendStu && backendStu.ok) ? backendStu : null;

    renderStudentDashboard();   // we’ll update this next to prefer backend
    showView("studentDash");
  } catch (err){
    console.error("Student dashboard error:", err);
    alert("Student dashboard hit an error. Open Console to see details.");
  }
};
window.reveal = function reveal(){
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  if (!answerCol || !revealArea){
    alert('Missing "answerCol" or "revealArea" in index.html.');
    return;
  }
  answerCol.classList.remove("hidden");
  revealArea.classList.remove("hidden");
};

window.advance = function advance(mode){
  ttsStop();
  if (!queue.length) return;

  const c = queue[idx % queue.length];

  // Ensure student exists
  ensureStudent(currentStudent);
  const stu = progress.students[currentStudent];

  const now = Date.now();
  const dt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);

  // Ensure byCard entry
  if (!stu.byCard[c.id]) {
    stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  }
  const s = stu.byCard[c.id];

  // Always count an attempt + time for any advance (including skip)
  s.attempts += 1;
  s.timeMs += dt;

  // Update rating counts only if it was a real rating
  const rated = (mode === "got" || mode === "close" || mode === "miss");
  if (rated) {
    s[mode] += 1;

    // Optional overall totals (if you use them elsewhere)
    if (!stu.totals) stu.totals = { got:0, close:0, miss:0 };
    stu.totals[mode] += 1;
  }

  // Log for weekly totals
  if (!Array.isArray(stu.log)) stu.log = [];
  stu.log.push({
    ts: now,
    cardId: c.id,
    dtMs: dt,
    rating: rated ? mode : "skip"
  });
  if (stu.log.length > 5000) stu.log = stu.log.slice(stu.log.length - 5000);

  // Save locally (this is what powers the student dashboard tiles)
  saveProgress(progress);

  // Send to shared backend (all devices)
  sendEventToBackend({
    student: currentStudent,
    cardId: c.id,
    unit: c.unit,
    rating: rated ? mode : "skip",
    dtMs: dt,
    lang: spanishMode ? "sp" : "en"
  });

  // Move forward
  idx++;
  renderCard();
};
/* ---------- Queue building ---------- */
function buildQueue({ shuffle, onlyNeeds }){
  let list = [...cards];

  // unit filter
  list = list.filter(c => selectedUnits.has(Number(c.unit)));

  // onlyNeeds filter
  if (onlyNeeds){
    const byCard = progress.students[currentStudent].byCard || {};
    list = list.filter(c => {
      const s = byCard[c.id];
      if (!s) return true;
      return (s.miss + s.close) > s.got;
    });
  }

  if (shuffle) list = fisherYates(list);
  return list;
}

/* ---------- Study rendering ---------- */
function renderCard(){
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  const answerBox = el("answerBox");

  el("studentPill") && (el("studentPill").textContent = `Student: ${currentStudent}`);
  el("unitPill") && (el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`);
  el("langPill") && (el("langPill").textContent = spanishMode ? "Language: Español" : "Language: English");

  if (!queue.length){
    el("questionImg") && (el("questionImg").src = "");
    el("answerImg") && (el("answerImg").src = "");
    el("progressPill") && (el("progressPill").textContent = "");
    el("cardStats") && (el("cardStats").textContent = "No cards found for these filters.");
    revealArea?.classList.add("hidden");
    answerCol?.classList.add("hidden");
    return;
  }

  const c = queue[idx % queue.length];

  const hint = el("clickReadHint");
if (hint){
  hint.textContent = spanishMode ? "Haz clic para leer en voz alta." : "Click the card to read aloud.";
}

  el("progressPill") && (el("progressPill").textContent =
    `Card ${ (idx % queue.length) + 1 } / ${queue.length} (Unit ${c.unit})`
  );

  const q = el("questionImg");
  const a = el("answerImg");
// Stop any speech when a new card renders
ttsStop();

// Click image to read aloud (toggle on/off)
const qImg = el("questionImg");
const aImg = el("answerImg");

// Determine TTS text from cards.json fields
const qText = spanishMode ? (c.textSp || c.text || "") : (c.text || "");
const aText = spanishMode ? (c.answerTextSp || c.answerText || "") : (c.answerText || "");

if (qImg){
  qImg.style.cursor = "pointer";
  qImg.onclick = () => {
    const key = `${c.id}:Q:${spanishMode ? "sp" : "en"}`;
    // Include unit for clarity
    ttsSpeak(`Unit ${c.unit}. ${qText}`.trim(), key);
  };
}

if (aImg){
  aImg.style.cursor = "pointer";
  aImg.onclick = () => {
    const key = `${c.id}:A:${spanishMode ? "sp" : "en"}`;
    ttsSpeak(`Answer. ${aText}`.trim(), key);
  };
}
// Use image paths from cards.json (Spanish with fallback)
if (q){
  q.onerror = null;
  q.src = spanishMode ? (c.qsp || c.q) : (c.q || "");
  q.onerror = () => {
    if (spanishMode && c.q) {
      q.onerror = null;
      q.src = c.q; // fallback to English
    }
  };
}

if (a){
  a.onerror = null;
  a.src = spanishMode ? (c.asp || c.a) : (c.a || "");
  a.onerror = () => {
    if (spanishMode && c.a) {
      a.onerror = null;
      a.src = c.a; // fallback to English
    }
  };
}

  // Fallback to English if Spanish image missing
if (q){
  q.onerror = () => {
    q.onerror = null;
    q.src = `assets/${c.id}Q.png`;
  };
}

if (a){
  a.onerror = () => {
    a.onerror = null;
    a.src = `assets/${c.id}A.png`;
  };
}
  
  // clear typed answer
  if (answerBox) answerBox.value = "";

  // hide answer + rating until check
  revealArea?.classList.add("hidden");
  answerCol?.classList.add("hidden");

  const s = progress.students[currentStudent].byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  el("cardStats") && (el("cardStats").textContent =
    `This card — ✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}  | Attempts: ${s.attempts}  | Time: ${formatMs(s.timeMs)}`
  );

  cardStartTs = Date.now();
}

function resetStudyUI(){
  el("answerBox") && (el("answerBox").value = "");
  el("revealArea")?.classList.add("hidden");
  el("answerCol")?.classList.add("hidden");
  cardStartTs = null;
}

/* ---------- Student dashboard ---------- */
function renderStudentDashboard(){
  const localStu = progress.students[currentStudent] || null;

  // Prefer backend (all devices) if available
  const backend = window.__studentBackend;
  const usingBackend = !!(backend && backend.ok && backend.byCard);

  const byCard = usingBackend
    ? (backend.byCard || {})
    : (localStu?.byCard || {});

  const weekTotal = usingBackend
    ? (backend.timeWeek || 0)
    : (sumWeeklyTotal(localStu).total || 0);

  const pill1 = el("dashStudentPill");
  const pill2 = el("dashLangPill");
  const pill3 = el("dashWeekPill");
  const sumBox = el("dashSummary");
  const grid = el("dashGrid");

  pill1 && (pill1.textContent = `Student: ${currentStudent}`);
  pill2 && (pill2.textContent = spanishMode ? "Language: Español" : "Language: English");
  pill3 && (pill3.textContent =
    `This week: ${formatMs(weekTotal)}${usingBackend ? " (all devices)" : " (this device)"}`
  );

  if (sumBox){
    let got=0, close=0, miss=0, notYet=0, attempts=0, timeMs=0;

    for (const c of cards){
      const s = byCard[c.id];
      if (!s || (s.attempts || 0) === 0){
        notYet++;
        continue;
      }
      got += s.got || 0;
      close += s.close || 0;
      miss += s.miss || 0;
      attempts += s.attempts || 0;
      timeMs += s.timeMs || 0;
    }

    sumBox.innerHTML = `
      <div class="summaryChip">✓ ${got}</div>
      <div class="summaryChip">~ ${close}</div>
      <div class="summaryChip">✗ ${miss}</div>
      <div class="summaryChip">Not yet: ${notYet}</div>
      <div class="summaryChip">Attempts: ${attempts}</div>
      <div class="summaryChip">Time ever: ${formatMs(timeMs)}</div>
    `;
  }

  if (!grid) return;
  grid.innerHTML = "";

  const sorted = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sorted){
    const s = byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
    const st = statusForCard(s);

    const tile = document.createElement("div");
    tile.className = "dashCard";
    tile.style.background = st.color;

    tile.innerHTML = `<b>${escapeHtml(c.id)}</b><small>Unit ${c.unit}</small>`;

    tile.title =
      `${st.label}\n` +
      `✓ ${s.got || 0}  ~ ${s.close || 0}  ✗ ${s.miss || 0}\n` +
      `Attempts: ${s.attempts || 0}\n` +
      `Time: ${formatMs(s.timeMs || 0)}`;

    tile.addEventListener("click", () => {
      selectedUnits = new Set([Number(c.unit)]);
      queue = [c];
      idx = 0;
      showView("study");
      renderCard();
    });

    grid.appendChild(tile);
  }
}
/* ---------- Teacher dashboard ---------- */
function renderTeacher(){
  const sel = el("studentSelect");
  if (!sel) return;
  sel.innerHTML = "";

  const students = Object.keys(progress.students).sort((a,b)=>a.localeCompare(b));
  if (!students.length){
    sel.appendChild(new Option("No students yet", ""));
    el("teacherTable") && (el("teacherTable").innerHTML = "");
    return;
  }

  students.forEach(s => sel.appendChild(new Option(s, s)));
  sel.value = students[0];
  renderTeacherTableForSelectedStudent();
}

function renderTeacherTableForSelectedStudent(){
  const student = el("studentSelect")?.value;
  const body = el("teacherTable");
  if (!body) return;
  body.innerHTML = "";

  if (!student || !progress.students[student]) return;

  const byCard = progress.students[student].byCard || {};
  const sorted = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sorted){
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

/* ---------- Storage / Export / Import / Reset ---------- */
function ensureStudent(name){
  if (!progress.students[name]){
    progress.students[name] = { totals:{ got:0, close:0, miss:0 }, byCard:{} };
    saveProgress(progress);
  }
}

function loadProgress(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (!obj || typeof obj !== "object") return { students:{} };
    if (!obj.students || typeof obj.students !== "object") obj.students = {};
    return obj;
  } catch {
    return { students:{} };
  }
}

function saveProgress(obj){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e){
    console.warn("saveProgress failed:", e);
  }
}
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
async function sendEventToBackend(evt) {
  if (!BACKEND_URL) return;

  try {
    await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...evt,
        secret: BACKEND_SECRET,
        userAgent: navigator.userAgent
      })
    });
  } catch (e) {
    // Don’t block studying if internet is flaky
    console.warn("Backend send failed:", e);
  }
}
// ---- Weekly time helpers (needed for Student Dashboard + Teacher summary) ----
function startOfWeekLocalTs(nowTs){
  const d = new Date(nowTs);
  const day = d.getDay(); // 0=Sun,1=Mon...
  const diffToMonday = (day === 0) ? 6 : (day - 1);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - diffToMonday);
  return d.getTime();
}

function sumWeeklyTotal(stu){
  const weekStart = startOfWeekLocalTs(Date.now());
  let total = 0;
  if (!stu || !Array.isArray(stu.log)) return { weekStart, total: 0 };

  for (const e of stu.log){
    if ((e.ts || 0) >= weekStart) total += (e.dtMs || 0);
  }
  return { weekStart, total };
}
async function fetchBackendSummary(pin){
  if (!BACKEND_URL) return null;

  return new Promise((resolve) => {
    const cbName = "__star_cb_" + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    function cleanup(){
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    const url = `${BACKEND_URL}?pin=${encodeURIComponent(pin)}&mode=summary&callback=${encodeURIComponent(cbName)}`;
    script.src = url;
    script.onerror = () => {
      cleanup();
      resolve(null);
    };
    document.body.appendChild(script);
  });
}
async function fetchBackendStudent(studentName){
  if (!BACKEND_URL) return null;

  return new Promise((resolve) => {
    const cbName = "__star_stu_cb_" + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    function cleanup(){
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    const url =
      `${BACKEND_URL}?mode=student` +
      `&student=${encodeURIComponent(studentName)}` +
      `&code=${encodeURIComponent(STUDENT_CODE)}` +
      `&callback=${encodeURIComponent(cbName)}`;

    script.src = url;
    script.onerror = () => {
      cleanup();
      resolve(null);
    };
    document.body.appendChild(script);
  });
}
async function sendEventToBackend(evt){
  if (!BACKEND_URL) return;
  try {
    await fetch(BACKEND_URL, {
      method: "POST",
      mode: "no-cors", // <-- IMPORTANT
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...evt,
        secret: BACKEND_SECRET,
        userAgent: navigator.userAgent
      })
    });
  } catch (e) {
    console.warn("Backend send failed:", e);
  }
}
function renderTeacherFromBackend(studentsObj, pin){
  const sel = el("studentSelect");
  const body = el("teacherTable");
  const summaryBox = el("teacherSummary");

  if (!sel || !body || !summaryBox) return;

  const names = Object.keys(studentsObj || {}).sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = "";
  body.innerHTML = "";
  summaryBox.innerHTML = "";

  if (names.length === 0){
    sel.appendChild(new Option("No students yet", ""));
    summaryBox.innerHTML = `<div class="summaryChip">No backend data yet</div>`;
    return;
  }

  names.forEach(n => sel.appendChild(new Option(n, n)));
  sel.value = names[0];

  renderTeacherSummaryFromBackend(studentsObj);
  renderTeacherTableForSelectedStudentFromBackend(studentsObj);
}

function renderTeacherSummaryFromBackend(studentsObj){
  const student = el("studentSelect")?.value;
  const box = el("teacherSummary");
  if (!box) return;

  if (!student || !studentsObj[student]) {
    box.innerHTML = "";
    return;
  }

  const stu = studentsObj[student]; // { byCard, timeEver, timeWeek }
  const byCard = stu.byCard || {};
  const totalCards = cards.length;

  let knownCards = 0;
  let attemptedCards = 0;

  // Determine known based on the SAME rule you wanted:
  // got > close + miss on that card
  for (const c of cards){
    const s = byCard[c.id];
    if (!s || (s.attempts || 0) === 0) continue;
    attemptedCards++;
    const got = s.got || 0;
    const close = s.close || 0;
    const miss = s.miss || 0;
    if (got > (close + miss)) knownCards++;
  }

  const pctKnownAll = totalCards ? Math.round((knownCards / totalCards) * 100) : 0;
  const pctKnownAttempted = attemptedCards ? Math.round((knownCards / attemptedCards) * 100) : 0;

  const timeEver = stu.timeEver || 0;
  const timeWeek = stu.timeWeek || 0;

  box.innerHTML = `
    <div class="summaryChip"><b>${escapeHtml(student)}</b></div>
    <div class="summaryChip">Known (of all cards): <b>${pctKnownAll}%</b></div>
    <div class="summaryChip">Known (of attempted): <b>${pctKnownAttempted}%</b></div>
    <div class="summaryChip">Time ever: <b>${formatMs(timeEver)}</b></div>
    <div class="summaryChip">Time this week: <b>${formatMs(timeWeek)}</b></div>
    <div class="summaryChip">Source: <b>Backend (all devices)</b></div>
  `;
}

function renderTeacherTableForSelectedStudentFromBackend(studentsObj){
  const student = el("studentSelect")?.value;
  const body = el("teacherTable");
  if (!body) return;
  body.innerHTML = "";

  if (!student || !studentsObj[student]) return;

  const stu = studentsObj[student];
  const byCard = stu.byCard || {};

  const sorted = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sorted){
    const s = byCard[c.id] || { unit: c.unit, got:0, close:0, miss:0, attempts:0, timeMs:0, timeWeek:0 };
    const avg = s.attempts ? (s.timeMs / s.attempts) : 0;

    const { color, label, pillHtml } = statusForCardBackend(s);

    const tr = document.createElement("tr");
    tr.style.background = color;
    tr.title = label;

    tr.innerHTML = `
      <td><b>${escapeHtml(c.id)}</b></td>
      <td>${c.unit}</td>
      <td>${pillHtml}</td>
      <td>${s.got || 0}</td>
      <td>${s.close || 0}</td>
      <td>${s.miss || 0}</td>
      <td>${s.attempts || 0}</td>
      <td>${formatMs(s.timeMs || 0)}</td>
      <td>${formatMs(s.timeWeek || 0)}</td>
      <td>${formatMs(avg)}</td>
    `;
    body.appendChild(tr);
  }
}

/* Status coloring/pill for backend rows (same logic) */
function statusForCardBackend(s){
  if (!s || (s.attempts || 0) === 0){
    return {
      color: "var(--gray)",
      label: "Not attempted",
      pillHtml: `<span class="statusPill">Not yet</span>`
    };
  }

  const got = s.got || 0;
  const close = s.close || 0;
  const miss = s.miss || 0;

  if (miss > close && miss > got){
    return {
      color: "var(--red)",
      label: "Needs practice",
      pillHtml: `<span class="statusPill" style="background:var(--red)">✗ Practice</span>`
    };
  }
  if (close > got){
    return {
      color: "var(--yellow)",
      label: "Close",
      pillHtml: `<span class="statusPill" style="background:var(--yellow)">~ Close</span>`
    };
  }
  if (got > 0){
    return {
      color: "var(--green)",
      label: "Got it",
      pillHtml: `<span class="statusPill" style="background:var(--green)">✓ Got</span>`
    };
  }

  return {
    color: "var(--gray)",
    label: "Not attempted",
    pillHtml: `<span class="statusPill">Not yet</span>`
  };
}
// ---- Weekly time helpers (needed for Student Dashboard) ----
function startOfWeekLocalTs(nowTs){
  const d = new Date(nowTs);
  const day = d.getDay(); // 0=Sun,1=Mon...
  const diffToMonday = (day === 0) ? 6 : (day - 1);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - diffToMonday);
  return d.getTime();
}

function sumWeeklyTotal(stu){
  const weekStart = startOfWeekLocalTs(Date.now());
  let total = 0;
  if (!stu || !Array.isArray(stu.log)) return { weekStart, total: 0 };

  for (const e of stu.log){
    if ((e.ts || 0) >= weekStart) total += (e.dtMs || 0);
  }
  return { weekStart, total };
}

console.log("[STAR] helpers loaded:", typeof sumWeeklyTotal);

// ---- Card status helper (Student Dashboard) ----
function statusForCard(s){
  // Returns { color, label } for a student's per-card stats object
  if (!s || (s.attempts || 0) === 0){
    return { color: "var(--gray)", label: "Not attempted" };
  }

  const got = s.got || 0;
  const close = s.close || 0;
  const miss = s.miss || 0;

  if (miss > close && miss > got){
    return { color: "var(--red)", label: "Needs practice" };
  }
  if (close > got){
    return { color: "var(--yellow)", label: "Close" };
  }
  if (got > 0){
    return { color: "var(--green)", label: "Got it" };
  }

  return { color: "var(--gray)", label: "Not attempted" };
}

console.log("[STAR] statusForCard loaded:", typeof statusForCard);

// ---- Recent student names (local device only) ----
const RECENT_NAMES_KEY = "star_recent_students_v1";
const MAX_RECENT_NAMES = 25;

function loadRecentNames(){
  try{
    const raw = localStorage.getItem(RECENT_NAMES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRecentNames(arr){
  try{
    localStorage.setItem(RECENT_NAMES_KEY, JSON.stringify(arr));
  } catch (e){
    console.warn("saveRecentNames failed:", e);
  }
}

function addRecentName(name){
  const n = (name || "").trim();
  if (!n) return;

  let arr = loadRecentNames();

  // de-dupe (case-insensitive), keep most-recent first
  arr = arr.filter(x => String(x).toLowerCase() !== n.toLowerCase());
  arr.unshift(n);

  if (arr.length > MAX_RECENT_NAMES) arr = arr.slice(0, MAX_RECENT_NAMES);
  saveRecentNames(arr);
}

function renderRecentNamesSuggestions(){
  const dl = el("recentStudents");
  if (!dl) return;

  const arr = loadRecentNames();
  dl.innerHTML = "";
  for (const name of arr){
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  }
}

// ---- Initialize recent student suggestions on page load ----
document.addEventListener("DOMContentLoaded", () => {
  renderRecentNamesSuggestions();
});

// ---- Text-to-Speech (Web Speech API) ----
let ttsVoices = [];

function loadTtsVoices(){
  if (!("speechSynthesis" in window)) return;
  ttsVoices = window.speechSynthesis.getVoices() || [];
}

// Some browsers load voices async
if ("speechSynthesis" in window) {
  loadTtsVoices();
  window.speechSynthesis.onvoiceschanged = loadTtsVoices;
}

function pickVoiceForLang(lang){
  // lang: "en" or "sp"
  const want = (lang === "sp") ? ["es", "es-"] : ["en", "en-"];

  // Prefer a voice that matches language
  const v = ttsVoices.find(v => want.some(p => (v.lang || "").toLowerCase().startsWith(p)));
  return v || null;
}

function speak(text){
  if (!text) return;
  if (!("speechSynthesis" in window)) {
    alert("Text-to-speech is not supported in this browser.");
    return;
  }

  // Stop anything already speaking
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  const rate = getTtsRate();
  u.rate = Math.min(1.3, Math.max(0.7, rate));

  const v = pickVoiceForLang(spanishMode ? "sp" : "en");
  if (v) u.voice = v;

  window.speechSynthesis.speak(u);
}

// Reads the current card question (and optionally answer)
window.readCardNow = function readCardNow(includeAnswer=false){
  if (!queue.length) return;
  const c = queue[idx % queue.length];

  // Read the text we have in cards.json
  // (If you only have images and no text, see note below.)
  let txt = c.text || c.q || c.id || "Card";

  // If you want it to read the unit too:
  txt = `Unit ${c.unit}. ${txt}`;

  if (includeAnswer && (c.answerText || c.a)) {
    txt += `. Answer: ${c.answerText || c.a}`;
  }

  speak(txt);
};

// ---- TTS click-to-toggle helpers ----
let __ttsActive = false;
let __ttsLastKey = "";

function ttsStop(){
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  __ttsActive = false;
  __ttsLastKey = "";
}

function ttsSpeak(text, key){
  if (!text) return;

  if (!("speechSynthesis" in window)) {
    alert("Text-to-speech is not supported in this browser.");
    return;
  }

  // Toggle off if clicking the same thing while speaking
  const currentlySpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  if (currentlySpeaking && __ttsActive && __ttsLastKey === key){
    ttsStop();
    return;
  }

  // Otherwise start speaking this new text
  ttsStop();
  __ttsActive = true;
  __ttsLastKey = key;

  const u = new SpeechSynthesisUtterance(text);

  const rate = Number(el("ttsRate")?.value || 1.0);
  u.rate = Math.min(1.3, Math.max(0.7, rate));

  // Choose voice by language (re-uses your existing helper if present)
  if (typeof pickVoiceForLang === "function") {
    const v = pickVoiceForLang(spanishMode ? "sp" : "en");
    if (v) u.voice = v;
  }

  u.onend = () => {
    __ttsActive = false;
    __ttsLastKey = "";
  };
  u.onerror = () => {
    __ttsActive = false;
    __ttsLastKey = "";
  };

  window.speechSynthesis.speak(u);
}
// ---- Global language toggle (English/Spanish) ----
function setSpanishMode(on){
  spanishMode = !!on;

  // keep the global toggle synced
  const g = el("globalSpanishToggle");
  if (g) g.checked = spanishMode;

  // Re-render current view so images/text update immediately
  // Stop reading if switching language
  if (typeof ttsStop === "function") ttsStop();

  // If you track views, use that; otherwise safely try both
  try { renderCard(); } catch {}
  try { renderStudentDashboard(); } catch {}
  try { renderTeacher(); } catch {}
}

function wireGlobalLanguageToggle(){
  const g = el("globalSpanishToggle");
  if (!g) return;

  g.addEventListener("change", () => {
    setSpanishMode(g.checked);
  });
}
const TTS_RATE_KEY = "star_tts_rate_v1";

function getTtsRate(){
  // Prefer slider value if present; otherwise use saved value; fallback 1.0
  const slider = el("ttsRate");
  if (slider) {
    const v = Number(slider.value || 1.0);
    if (!Number.isNaN(v)) return v;
  }
  const saved = Number(localStorage.getItem(TTS_RATE_KEY) || 1.0);
  return Number.isNaN(saved) ? 1.0 : saved;
}

function wireTtsRatePersistence(){
  const slider = el("ttsRate");
  if (!slider) return;

  // load saved value into slider
  const saved = localStorage.getItem(TTS_RATE_KEY);
  if (saved !== null) slider.value = String(saved);

  slider.addEventListener("input", () => {
    localStorage.setItem(TTS_RATE_KEY, String(slider.value));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireTtsRatePersistence();
});

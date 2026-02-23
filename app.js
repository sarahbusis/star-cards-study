

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyke09fUi9ChB1ewAUU4EzCDquAPC1RLRcCJcQwfzPfQF78G1giSrMKSNw2Ydwm6VxW/exec";
const BACKEND_SECRET = "CHANGE_ME_TO_SOMETHING_LONG"; // must match SHARED_SECRET in Apps Script, or "" if disabled

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

  // Teacher mode now pulls from backend (all devices) with local fallback
  el("modeTeacher")?.addEventListener("click", async () => {
    const pin = prompt("Teacher PIN:");
    if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");

    showView("teacher");

    // Try backend first
    const backend = await fetchBackendSummary(pin);
    if (backend && backend.ok && backend.students) {
      window.__teacherDataSource = "backend";
      window.__teacherBackendStudents = backend.students;
      renderTeacherFromBackend(backend.students, pin);
      return;
    }

    // Fallback to local if backend fails
    window.__teacherDataSource = "local";
    renderTeacher();
    alert("Backend not reachable — showing only this device’s data.");
  });

  // Export/import/reset still operate on localStorage only (backend is a Google Sheet).
  el("exportBtn")?.addEventListener("click", exportJSON);
  el("importFile")?.addEventListener("change", importJSON);
  el("resetBtn")?.addEventListener("click", resetAll);

  // Student picker in teacher dashboard: backend or local
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
    cards = (json.cards || []).map(c => ({ ...c, unit: Number(c.unit) }));
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
function imgPath(cardId, kind){
  // English:
  // assets/1aQ.png
  // assets/1aA.png
  //
  // Spanish (your convention):
  // assets/1aQsp.png
  // assets/1aAsp.png
  if (spanishMode){
    return `./assets/${cardId}${kind}sp.png`;
  }
  return `./assets/${cardId}${kind}.png`;
}

/* ---------- Public functions (inline onclick) ---------- */
window.start = function start(){
  const name = el("studentName")?.value?.trim();
  if (!name) return alert("Please enter your name.");

  currentStudent = name;
  ensureStudent(currentStudent);

  spanishMode = !!el("spanishToggle")?.checked;

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

window.openStudentDashboard = function openStudentDashboard(){
  const name = el("studentName")?.value?.trim() || currentStudent;
  if (!name) return alert("Enter your name first.");

  currentStudent = name;
  ensureStudent(currentStudent);

  spanishMode = !!el("spanishToggle")?.checked;

  renderStudentDashboard();
  showView("studentDash");
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
  if (!queue.length) return;

  const c = queue[idx % queue.length];
  const stu = progress.students[currentStudent];

  const now = Date.now();
  const dt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);

  if (!stu.byCard[c.id]) stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };

  // time + attempts always count
  stu.byCard[c.id].attempts += 1;
  stu.byCard[c.id].timeMs += dt;
// Send to backend (all devices)
function sendEventToBackend(evt){
  if (!BACKEND_URL) return;

  const params = new URLSearchParams({
    mode: "log",
    student: evt.student,
    cardId: evt.cardId,
    unit: String(evt.unit ?? ""),
    rating: evt.rating || "skip",
    dtMs: String(evt.dtMs ?? 0),
    lang: evt.lang || "en",
    ua: navigator.userAgent
  });

  // Pixel GET (super reliable cross-origin)
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = `${BACKEND_URL}?${params.toString()}`;
}
  saveProgress(progress);

  idx++;
  renderCard();
sendEventToBackend({
  student: currentStudent,
  cardId: c.id,
  unit: c.unit,
  rating: (mode === "got" || mode === "close" || mode === "miss") ? mode : "skip",
  dtMs: dt,
  lang: spanishMode ? "sp" : "en"
});
  
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

  el("progressPill") && (el("progressPill").textContent =
    `Card ${ (idx % queue.length) + 1 } / ${queue.length} (Unit ${c.unit})`
  );

  const q = el("questionImg");
  const a = el("answerImg");

  if (q) q.src = imgPath(c.id, "Q");
  if (a) a.src = imgPath(c.id, "A");

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
  el("dashStudentPill") && (el("dashStudentPill").textContent = `Student: ${currentStudent}`);
  el("dashLangPill") && (el("dashLangPill").textContent = spanishMode ? "Language: Español" : "Language: English");

  const stu = progress.students[currentStudent];
  const byCard = stu.byCard || {};

  let got=0, close=0, miss=0, notYet=0, attempts=0, timeMs=0;

  for (const c of cards){
    const s = byCard[c.id];
    if (!s || s.attempts === 0){
      notYet++;
      continue;
    }
    got += s.got || 0;
    close += s.close || 0;
    miss += s.miss || 0;
    attempts += s.attempts || 0;
    timeMs += s.timeMs || 0;
  }

  const sum = el("dashSummary");
  if (sum){
    sum.innerHTML = `
      <div class="summaryChip">✓ ${got}</div>
      <div class="summaryChip">~ ${close}</div>
      <div class="summaryChip">✗ ${miss}</div>
      <div class="summaryChip">Not yet: ${notYet}</div>
      <div class="summaryChip">Attempts: ${attempts}</div>
      <div class="summaryChip">Time: ${formatMs(timeMs)}</div>
    `;
  }

  const grid = el("dashGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const sorted = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sorted){
    const s = byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };

    // determine color by "latest strongest" signal:
    // If any miss > close and miss > got => red
    // else if any close > got => yellow
    // else if got > 0 => green
    // else gray
    let bg = "var(--gray)";
    if ((s.miss || 0) > (s.close || 0) && (s.miss || 0) > (s.got || 0)) bg = "var(--red)";
    else if ((s.close || 0) > (s.got || 0)) bg = "var(--yellow)";
    else if ((s.got || 0) > 0) bg = "var(--green)";

    const tile = document.createElement("div");
    tile.className = "dashCard";
    tile.style.background = bg;
    tile.innerHTML = `<b>${c.id}</b> <small>Unit ${c.unit}</small>`;
    tile.title = `✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}\nAttempts: ${s.attempts}\nTime: ${formatMs(s.timeMs)}`;

    // Clicking a tile starts studying that single card (nice shortcut)
    tile.addEventListener("click", () => {
      // set selected units to that card's unit so it’s included
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
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { students:{} };
  }catch{
    return { students:{} };
  }
}

function saveProgress(obj){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
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

/* =========================
   STAR Cards Study — app.js
   Clean + unified version
   ========================= */

/* ---------- Config ---------- */
const LANG_KEY = "star_lang_v1";
let spanishMode = localStorage.getItem(LANG_KEY) === "sp";

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyke09fUi9ChB1ewAUU4EzCDquAPC1RLRcCJcQwfzPfQF78G1giSrMKSNw2Ydwm6VxW/exec";
const BACKEND_SECRET = "CHANGE_ME_TO_SOMETHING_LONG"; // match Apps Script SHARED_SECRET or "" if disabled
const STUDENT_CODE = "spark2026"; // must match Code.gs
const TEACHER_PIN = "2026";

const STORAGE_KEY = "star_screenshot_progress_v3";

/* ---------- DOM helper ---------- */
function el(id){ return document.getElementById(id); }

/* ---------- Local progress storage (must exist before state) ---------- */
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
function ensureStudent(name){
  if (!progress.students[name]){
    progress.students[name] = { byCard:{}, log:[] };
    saveProgress(progress);
  }
}

/* ---------- State ---------- */
let cards = [];
let progress = loadProgress();

let currentStudent = "";
let selectedUnits = new Set();
let queue = [];
let idx = 0;
let cardStartTs = null;

/* =====================================================
   QUIZ MODE STATE (global + toggle in study topbar)
   ===================================================== */
window.quizMode = window.quizMode ?? false;

function setQuizMode(on){
  window.quizMode = !!on;

  // Sync segmented UI (new)
  const studyBtn = el("segStudyBtn");
  const quizBtn  = el("segQuizBtn");
  if (studyBtn && quizBtn){
    const isQuiz = window.quizMode;
    studyBtn.classList.toggle("active", !isQuiz);
    quizBtn.classList.toggle("active", isQuiz);

    // Language labels
    studyBtn.textContent = spanishMode ? "📘 Modo estudio" : "📘 Study mode";
    quizBtn.textContent  = spanishMode ? "📝 Modo quiz"   : "📝 Quiz mode";
  }

  // when switching modes, reset per-card UI pieces
  el("quizFeedback")?.classList.add("hidden");
  el("nextBtn")?.classList.add("hidden");
  el("checkBtn")?.classList.remove("hidden");
  el("skipBtn")?.classList.remove("hidden");

  // rating area only used in study mode
  if (window.quizMode){
    el("revealArea")?.classList.add("hidden");
    el("answerCol")?.classList.add("hidden"); // keep hidden until check
  }
}
/* ---------- Quiz feedback box ---------- */
function setQuizFeedback(level, message){
  const box = el("quizFeedback");
  const verdict = el("quizVerdict");
  const msg = el("quizMessage");
  if (!box || !verdict || !msg) return;

  if (level === "correct"){
    verdict.textContent = spanishMode ? "¡Correcto!" : "Correct!";
  } else if (level === "almost"){
    verdict.textContent = spanishMode ? "Casi" : "Almost";
  } else {
    verdict.textContent = spanishMode ? "Incorrecto" : "Incorrect";
  }

  msg.textContent = message || "";
  box.classList.remove("hidden");
}

/* =====================================================
   QUIZ STATS STORAGE (separate from study self-rating)
   ===================================================== */
function ensureQuizCard(stu, cardId){
  if (!stu.quizByCard) stu.quizByCard = {};
  if (!stu.quizByCard[cardId]){
    stu.quizByCard[cardId] = {
      correct: 0,
      almost: 0,
      incorrect: 0,
      attempts: 0,
      lastLevel: null,
      lastTs: 0
    };
  }
  return stu.quizByCard[cardId];
}

function recordQuizResult(studentName, cardId, level){
  ensureStudent(studentName);
  const stu = progress.students[studentName];
  const s = ensureQuizCard(stu, cardId);

  s.attempts += 1;
  s.lastLevel = level;
  s.lastTs = Date.now();

  if (level === "correct") s.correct += 1;
  else if (level === "almost") s.almost += 1;
  else s.incorrect += 1;

  saveProgress(progress);
}

/* =====================================================
   DASHBOARD TOGGLE (ratings vs quiz)
   ===================================================== */
window.dashboardMode = window.dashboardMode ?? "ratings"; // "ratings" | "quiz"

function setDashboardMode(mode){
  window.dashboardMode = (mode === "quiz") ? "quiz" : "ratings";
  const isQuiz = (window.dashboardMode === "quiz");

  // sync both toggles if present
  const t1 = el("dashToggle");
  if (t1) t1.checked = isQuiz;

  const t2 = el("quizDashToggle");
  if (t2) t2.checked = isQuiz;

  showView(isQuiz ? "quizDash" : "studentDash");

  try{
    if (isQuiz) renderQuizDashboard();
    else renderStudentDashboard();
  } catch (e){
    console.warn("[dashboard] render error:", e);
  }
}

async function openDashboardDefault(){
  await openStudentDashboard();
  setDashboardMode("ratings");
}

/* =====================================================
   VIEWS
   ===================================================== */
function showView(which){
  const map = {
    start: "startView",
    study: "studyView",
    studentDash: "studentDashView",
    quizDash: "quizDashView",
    badges: "badgesView",
    teacher: "teacherView"
  };

  const targetId = map[which] || which;

  const all = ["startView","studyView","studentDashView","quizDashView","badgesView","teacherView"];
  for (const id of all){
    el(id)?.classList.toggle("hidden", id !== targetId);
  }
}

/* =====================================================
   LANGUAGE TOGGLE
   ===================================================== */
function setSpanishMode(on){
  spanishMode = !!on;
  localStorage.setItem(LANG_KEY, spanishMode ? "sp" : "en");

  const btn = el("langToggleBtn");
  if (btn) btn.textContent = spanishMode ? "English" : "Español";

  if (el("langPill")) el("langPill").textContent = spanishMode ? "Language: Español" : "Language: English";
  if (el("dashLangPill")) el("dashLangPill").textContent = spanishMode ? "Language: Español" : "Language: English";

  const hint = el("clickReadHint");
  if (hint) hint.textContent = spanishMode ? "Haz clic para leer en voz alta." : "Click the card to read aloud.";

  ttsStop();
  try { renderCard(); } catch {}
  try { renderStudentDashboard(); } catch {}
  try { renderQuizDashboard(); } catch {}
   try { setQuizMode(window.quizMode); } catch {}
}

/* =====================================================
   CARDS LOADING
   ===================================================== */
async function loadCards(){
  const res = await fetch("./cards.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`cards.json not found (HTTP ${res.status})`);

  const json = await res.json();
  const arr = Array.isArray(json) ? json : (json.cards || []);

  cards = arr.map(c => ({
    ...c,
    unit: Number(c.unit),
    q: c.q || `assets/${c.id}Q.png`,
    a: c.a || `assets/${c.id}A.png`,
    qsp: c.qsp || `assets/${c.id}Qsp.png`,
    asp: c.asp || `assets/${c.id}Asp.png`,
    text: c.text || "",
    answerText: c.answerText || "",
    textSp: c.textSp || "",
    answerTextSp: c.answerTextSp || ""
  }));

  window.__cards = cards;
  console.log("[cards] loaded", cards.length);
}

/* =====================================================
   UNITS UI
   ===================================================== */
function buildUnitUI(){
  const grid = el("unitGrid");
  if (!grid) return;

  const units = [...new Set(cards.map(c => Number(c.unit)).filter(n => Number.isFinite(n)))]
    .sort((a,b) => a-b);

  grid.innerHTML = "";

  if (!units.length){
    grid.innerHTML = `<div class="hint">No units found.</div>`;
    return;
  }

  for (const u of units){
    const label = document.createElement("label");
    label.className = "pill";
    label.style.margin = "6px";
    label.innerHTML = `<input type="checkbox" value="${u}"> Unit ${u}`;
    grid.appendChild(label);
  }
}

function readSelectedUnitsFromUI(){
  const grid = el("unitGrid");
  const set = new Set();
  if (!grid) return set;

  grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.checked) set.add(Number(cb.value));
  });
  return set;
}

/* =====================================================
   START / STUDY FLOW
   ===================================================== */
function start(){
  const name = (el("studentName")?.value || "").trim();
  if (!name) return alert(spanishMode ? "Escribe tu nombre." : "Please enter your name.");

  currentStudent = name;
  addRecentName(currentStudent);
  renderRecentNamesSuggestions();
  ensureStudent(currentStudent);

  selectedUnits = readSelectedUnitsFromUI();
  if (!selectedUnits.size){
    return alert(spanishMode ? "Selecciona al menos una unidad." : "Select at least one unit.");
  }

  const shuffle = !!el("shuffleToggle")?.checked;
  const onlyNeeds = !!el("onlyNeedsToggle")?.checked;

  queue = buildQueue({ shuffle, onlyNeeds });
  idx = 0;

  showView("study");
  renderCard();
}

function goToStart(){
  showView("start");
  resetStudyUI();
  ttsStop();
}

function resetStudyUI(){
  if (el("answerBox")) el("answerBox").value = "";
  el("revealArea")?.classList.add("hidden");
  el("answerCol")?.classList.add("hidden");
  el("quizFeedback")?.classList.add("hidden");
  el("nextBtn")?.classList.add("hidden");
  el("checkBtn")?.classList.remove("hidden");
  el("skipBtn")?.classList.remove("hidden");
  cardStartTs = null;
}

/* Reveal behavior depends on quiz vs study */
window.reveal = function reveal(){
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  if (!answerCol || !revealArea) return;
  if (!queue.length) return;

  const c = queue[idx % queue.length];

  // show answer image column
  answerCol.classList.remove("hidden");

  if (window.quizMode){
    // --- QUIZ MODE ---
    revealArea.classList.add("hidden");

    const typed = el("answerBox")?.value || "";
    const res = gradeAnswerForCard(c, typed, !!spanishMode);
    setQuizFeedback(res.level, res.message);
    recordQuizResult(currentStudent, c.id, res.level);

    el("checkBtn")?.classList.add("hidden");
    el("skipBtn")?.classList.add("hidden");
    el("nextBtn")?.classList.remove("hidden");
  } else {
    // --- STUDY MODE ---
    el("quizFeedback")?.classList.add("hidden");
    revealArea.classList.remove("hidden");

    el("checkBtn")?.classList.remove("hidden");
    el("skipBtn")?.classList.remove("hidden");
    el("nextBtn")?.classList.add("hidden");
  }
};

function advance(mode){
  ttsStop();
  if (!queue.length) return;

  const c = queue[idx % queue.length];
  ensureStudent(currentStudent);
  const stu = progress.students[currentStudent];

  const now = Date.now();
  const MAX_MS_PER_ADVANCE = 3 * 60 * 1000;
  const rawDt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);
  const dt = Math.min(rawDt, MAX_MS_PER_ADVANCE);

  if (!stu.byCard[c.id]) stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  const s = stu.byCard[c.id];

  // Always count attempt + time
  s.attempts += 1;
  s.timeMs += dt;

  const rated = (mode === "got" || mode === "close" || mode === "miss");
  if (rated) s[mode] += 1;

  if (!Array.isArray(stu.log)) stu.log = [];
  stu.log.push({ ts: now, cardId: c.id, dtMs: dt, rating: rated ? mode : "skip" });
  if (stu.log.length > 5000) stu.log = stu.log.slice(-5000);

  saveProgress(progress);

  // backend
  sendEventToBackend({
    student: currentStudent,
    cardId: c.id,
    unit: c.unit,
    rating: rated ? mode : "skip",
    dtMs: dt,
    capped: rawDt > dt,
    lang: spanishMode ? "sp" : "en"
  });

  checkForNewBadgesAndPopup();

  idx++;
  renderCard();
}

/* =====================================================
   QUEUE BUILDING
   ===================================================== */
function buildQueue({ shuffle, onlyNeeds }){
  let list = [...cards];

  list = list.filter(c => selectedUnits.has(Number(c.unit)));

  if (onlyNeeds){
    const byCard = progress.students[currentStudent]?.byCard || {};
    list = list.filter(c => {
      const s = byCard[c.id];
      if (!s) return true;
      return (Number(s.miss || 0) + Number(s.close || 0)) > Number(s.got || 0);
    });
  }

  if (shuffle) list = fisherYates(list);
  return list;
}

/* =====================================================
   RENDER STUDY CARD
   ===================================================== */
function renderCard(){
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  const answerBox = el("answerBox");

  if (el("studentPill")) el("studentPill").textContent = `Student: ${currentStudent}`;
  if (el("unitPill")) el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`;
  if (el("langPill")) el("langPill").textContent = spanishMode ? "Language: Español" : "Language: English";

  if (!queue.length){
    if (el("questionImg")) el("questionImg").src = "";
    if (el("answerImg")) el("answerImg").src = "";
    if (el("progressPill")) el("progressPill").textContent = "";
    if (el("cardStats")) el("cardStats").textContent = spanishMode ? "No hay tarjetas con estos filtros." : "No cards found for these filters.";
    revealArea?.classList.add("hidden");
    answerCol?.classList.add("hidden");
    return;
  }

  const c = queue[idx % queue.length];

  if (el("progressPill")){
    el("progressPill").textContent = `Card ${(idx % queue.length) + 1} / ${queue.length} (Unit ${c.unit})`;
  }

  setQuizMode(window.quizMode);

  const hint = el("clickReadHint");
  if (hint) hint.textContent = spanishMode ? "Haz clic para leer en voz alta." : "Click the card to read aloud.";

  ttsStop();

  const q = el("questionImg");
  const a = el("answerImg");

  if (q){
    q.onerror = null;
    q.src = spanishMode ? (c.qsp || c.q) : (c.q || "");
    q.onerror = () => {
      if (spanishMode && c.q){
        q.onerror = null;
        q.src = c.q;
      }
    };
  }

  if (a){
    a.onerror = null;
    a.src = spanishMode ? (c.asp || c.a) : (c.a || "");
    a.onerror = () => {
      if (spanishMode && c.a){
        a.onerror = null;
        a.src = c.a;
      }
    };
  }

  if (answerBox) answerBox.value = "";

  revealArea?.classList.add("hidden");
  answerCol?.classList.add("hidden");

  ensureStudent(currentStudent);
  const s = progress.students[currentStudent].byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  if (el("cardStats")){
    el("cardStats").textContent =
      `This card — ✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}  | Attempts: ${s.attempts}  | Time: ${formatMs(s.timeMs)}`;
  }

  const qText = spanishMode ? (c.textSp || c.text || "") : (c.text || "");
  const aText = spanishMode ? (c.answerTextSp || c.answerText || "") : (c.answerText || "");

  if (q){
    q.style.cursor = "pointer";
    q.onclick = () => ttsSpeak(`Unit ${c.unit}. ${qText}`.trim(), `${c.id}:Q:${spanishMode ? "sp" : "en"}`);
  }
  if (a){
    a.style.cursor = "pointer";
    a.onclick = () => ttsSpeak(`Answer. ${aText}`.trim(), `${c.id}:A:${spanishMode ? "sp" : "en"}`);
  }

  cardStartTs = Date.now();
}

/* =====================================================
   STUDENT DASHBOARD (ratings)
   ===================================================== */
async function openStudentDashboard(){
  let name = (currentStudent || "").trim();
  if (!name) name = (el("studentName")?.value || "").trim();
  if (!name) return alert(spanishMode ? "Escribe tu nombre primero." : "Enter your name first.");

  currentStudent = name;
  addRecentName(currentStudent);
  renderRecentNamesSuggestions();
  ensureStudent(currentStudent);

  try{
    const backendStu = await fetchBackendStudent(currentStudent);
    window.__studentBackend = (backendStu && backendStu.ok) ? backendStu : null;

    renderStudentDashboard();
    showView("studentDash");
  } catch (err){
    console.error("Student dashboard error:", err);
    alert("Student dashboard hit an error. Open Console to see details.");
  }
}

function renderStudentDashboard(){
  const localStu = progress.students[currentStudent] || null;

  const backend = window.__studentBackend;
  const usingBackend = !!(backend && backend.ok && backend.byCard);

  const byCard = usingBackend ? (backend.byCard || {}) : (localStu?.byCard || {});
  const weekTotal = usingBackend ? (backend.timeWeek || 0) : (sumWeeklyTotal(localStu).total || 0);

  if (el("dashStudentPill")) el("dashStudentPill").textContent = `Student: ${currentStudent}`;
  if (el("dashLangPill")) el("dashLangPill").textContent = spanishMode ? "Language: Español" : "Language: English";
  if (el("dashWeekPill")){
    el("dashWeekPill").textContent = `This week: ${formatMs(weekTotal)}${usingBackend ? " (all devices)" : " (this device)"}`;
  }

  const sumBox = el("dashSummary");
  const grid = el("dashGrid");

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

/* =====================================================
   QUIZ DASHBOARD VIEW
   ===================================================== */
function quizStatusColor(s){
  if (!s || !s.attempts) return "var(--gray)";
  if (s.lastLevel === "correct") return "var(--green)";
  if (s.lastLevel === "almost") return "var(--yellow)";
  return "var(--red)";
}

function renderQuizDashboard(){
  const stu = progress.students[currentStudent];
  if (!stu){
    console.warn("[quiz] no student data");
    return;
  }

  el("quizDashStudentPill") && (el("quizDashStudentPill").textContent = `Student: ${currentStudent}`);
  el("quizDashLangPill") && (el("quizDashLangPill").textContent = spanishMode ? "Idioma: Español" : "Language: English");

  const by = stu.quizByCard || {};

  let correct=0, almost=0, incorrect=0, attempts=0, attemptedCards=0;

  for (const c of cards){
    const s = by[c.id];
    if (!s || !s.attempts) continue;
    attemptedCards++;
    correct += s.correct || 0;
    almost += s.almost || 0;
    incorrect += s.incorrect || 0;
    attempts += s.attempts || 0;
  }

  const hint = el("quizDashHint");
  if (hint){
    hint.textContent = spanishMode
      ? "Colores = tu ÚLTIMO resultado en modo Quiz."
      : "Colors = your MOST RECENT Quiz result.";
  }

  const sum = el("quizDashSummary");
  if (sum){
    sum.innerHTML = `
      <div class="summaryChip">✅ ${correct}</div>
      <div class="summaryChip">🟨 ${almost}</div>
      <div class="summaryChip">❌ ${incorrect}</div>
      <div class="summaryChip">Attempts: <b>${attempts}</b></div>
      <div class="summaryChip">Cards quizzed: <b>${attemptedCards}</b> / ${cards.length}</div>
    `;
  }

  const grid = el("quizDashGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const sorted = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sorted){
    const s = by[c.id] || { attempts:0, correct:0, almost:0, incorrect:0, lastLevel:null };

    const tile = document.createElement("div");
    tile.className = "dashCard";
    tile.style.background = quizStatusColor(s);
    tile.style.opacity = s.attempts ? "1" : "0.6";

    tile.innerHTML = `
      <b>${escapeHtml(c.id)}</b>
      <small>Unit ${c.unit}</small>
      <small>${s.attempts ? `Quiz attempts: ${s.attempts}` : (spanishMode ? "No quiz todavía" : "Not quizzed yet")}</small>
    `;

    tile.title =
      `Quiz stats:\n` +
      `✅ ${s.correct || 0}  🟨 ${s.almost || 0}  ❌ ${s.incorrect || 0}\n` +
      `Attempts: ${s.attempts || 0}`;

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

/* =====================================================
   TEACHER DASHBOARD
   ===================================================== */
async function openTeacherDashboard(){
  const pin = prompt("Teacher PIN:");
  if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");

  showView("teacher");

  const backend = await fetchBackendSummary(pin);
  if (backend && backend.ok && backend.students){
    window.__teacherDataSource = "backend";
    window.__teacherBackendStudents = backend.students;
    renderTeacherFromBackend(backend.students);
    return;
  }

  window.__teacherDataSource = "local";
  renderTeacherLocal();
  alert("Backend not reachable — showing only this device’s data.");
}

function renderTeacherLocal(){
  const sel = el("studentSelect");
  const body = el("teacherTable");
  const summary = el("teacherSummary");
  if (!sel || !body || !summary) return;

  sel.innerHTML = "";
  body.innerHTML = "";
  summary.innerHTML = `<div class="summaryChip">Source: <b>Local device</b></div>`;

  const students = Object.keys(progress.students).sort((a,b)=>a.localeCompare(b));
  if (!students.length){
    sel.appendChild(new Option("No students yet", ""));
    return;
  }

  students.forEach(s => sel.appendChild(new Option(s, s)));
  sel.value = students[0];
  renderTeacherTableForSelectedStudentLocal();
}

function renderTeacherTableForSelectedStudentLocal(){
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
    const st = statusForCard(s);

    const tr = document.createElement("tr");
    tr.style.background = st.color;

    tr.innerHTML = `
      <td><b>${escapeHtml(c.id)}</b></td>
      <td>${c.unit}</td>
      <td>${escapeHtml(st.label)}</td>
      <td>${s.got || 0}</td>
      <td>${s.close || 0}</td>
      <td>${s.miss || 0}</td>
      <td>${s.attempts || 0}</td>
      <td>${formatMs(s.timeMs || 0)}</td>
      <td>${formatMs(0)}</td>
      <td>${formatMs(avg)}</td>
    `;
    body.appendChild(tr);
  }
}

/* =====================================================
   BACKEND CALLS (JSONP GET; POST events)
   ===================================================== */
function fetchBackendSummary(pin){
  if (!BACKEND_URL) return Promise.resolve(null);

  return new Promise((resolve) => {
    const cbName = "__star_cb_" + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 8000);

    let script = null;

    function cleanup(){
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      if (script) script.remove();
    }

    window[cbName] = (data) => { cleanup(); resolve(data); };

    script = document.createElement("script");
    script.src = `${BACKEND_URL}?pin=${encodeURIComponent(pin)}&mode=summary&callback=${encodeURIComponent(cbName)}`;
    script.onerror = () => { cleanup(); resolve(null); };
    document.body.appendChild(script);
  });
}

function fetchBackendStudent(studentName){
  if (!BACKEND_URL) return Promise.resolve(null);

  return new Promise((resolve) => {
    const cbName = "__star_stu_cb_" + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => { cleanup(); resolve(null); }, 8000);

    let script = null;

    function cleanup(){
      clearTimeout(timeout);
      try { delete window[cbName]; } catch {}
      if (script) script.remove();
    }

    window[cbName] = (data) => { cleanup(); resolve(data); };

    script = document.createElement("script");
    script.src =
      `${BACKEND_URL}?mode=student` +
      `&student=${encodeURIComponent(studentName)}` +
      `&code=${encodeURIComponent(STUDENT_CODE)}` +
      `&callback=${encodeURIComponent(cbName)}`;

    script.onerror = () => { cleanup(); resolve(null); };
    document.body.appendChild(script);
  });
}

async function sendEventToBackend(evt){
  if (!BACKEND_URL) return;

  try{
    await fetch(BACKEND_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...evt,
        secret: BACKEND_SECRET,
        userAgent: navigator.userAgent
      })
    });
  } catch (e){
    console.warn("Backend send failed:", e);
  }
}

/* ---------- Backend teacher renderers ---------- */
function renderTeacherFromBackend(studentsObj){
  const sel = el("studentSelect");
  const body = el("teacherTable");
  const summaryBox = el("teacherSummary");

  if (!sel || !body || !summaryBox) return;

  const names = Object.keys(studentsObj || {}).sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = "";
  body.innerHTML = "";
  summaryBox.innerHTML = "";

  if (!names.length){
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

  if (!student || !studentsObj[student]){
    box.innerHTML = "";
    return;
  }

  const stu = studentsObj[student];
  const byCard = stu.byCard || {};
  const totalCards = cards.length;

  let knownCards = 0;
  let attemptedCards = 0;

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

  box.innerHTML = `
    <div class="summaryChip"><b>${escapeHtml(student)}</b></div>
    <div class="summaryChip">Known (of all cards): <b>${pctKnownAll}%</b></div>
    <div class="summaryChip">Known (of attempted): <b>${pctKnownAttempted}%</b></div>
    <div class="summaryChip">Time ever: <b>${formatMs(stu.timeEver || 0)}</b></div>
    <div class="summaryChip">Time this week: <b>${formatMs(stu.timeWeek || 0)}</b></div>
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
    const s = byCard[c.id] || { unit:c.unit, got:0, close:0, miss:0, attempts:0, timeMs:0, timeWeek:0 };
    const avg = s.attempts ? (s.timeMs / s.attempts) : 0;

    const st = statusForCardBackend(s);

    const tr = document.createElement("tr");
    tr.style.background = st.color;
    tr.title = st.label;

    tr.innerHTML = `
      <td><b>${escapeHtml(c.id)}</b></td>
      <td>${c.unit}</td>
      <td>${st.pillHtml}</td>
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

/* =====================================================
   BADGE POPUP (overlay modal in index.html)
   ===================================================== */
function hideBadgePopup(){
  const p = el("badgePopup");
  if (!p) return;
  p.classList.add("hidden");
  document.body.style.overflow = "";
}

function showBadgePopup({ emoji="🏆", title=null, body="" } = {}){
  const p = el("badgePopup");
  if (!p) return;

  el("badgePopupEmoji") && (el("badgePopupEmoji").textContent = emoji);
  el("badgePopupTitle") && (el("badgePopupTitle").textContent =
    title || (spanishMode ? "¡Insignia ganada!" : "Badge earned!")
  );
  el("badgePopupBody") && (el("badgePopupBody").textContent = body);

  p.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function wireBadgePopup(){
  el("badgePopupCloseBtn")?.addEventListener("click", hideBadgePopup);

  el("badgePopup")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "badgePopup") hideBadgePopup();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideBadgePopup();
  });
}

/* =====================================================
   STATUS HELPERS
   ===================================================== */
function statusForCard(s){
  if (!s || (s.attempts || 0) === 0) return { color: "var(--gray)", label: "Not attempted" };

  const got = s.got || 0;
  const close = s.close || 0;
  const miss = s.miss || 0;

  if (miss > close && miss > got) return { color: "var(--red)", label: "Needs practice" };
  if (close > got) return { color: "var(--yellow)", label: "Close" };
  if (got > 0) return { color: "var(--green)", label: "Got it" };

  return { color: "var(--gray)", label: "Not attempted" };
}

function statusForCardBackend(s){
  if (!s || (s.attempts || 0) === 0){
    return { color:"var(--gray)", label:"Not attempted", pillHtml:`<span class="statusPill">Not yet</span>` };
  }
  const got = s.got || 0;
  const close = s.close || 0;
  const miss = s.miss || 0;

  if (miss > close && miss > got){
    return { color:"var(--red)", label:"Needs practice", pillHtml:`<span class="statusPill" style="background:var(--red)">✗ Practice</span>` };
  }
  if (close > got){
    return { color:"var(--yellow)", label:"Close", pillHtml:`<span class="statusPill" style="background:var(--yellow)">~ Close</span>` };
  }
  if (got > 0){
    return { color:"var(--green)", label:"Got it", pillHtml:`<span class="statusPill" style="background:var(--green)">✓ Got</span>` };
  }
  return { color:"var(--gray)", label:"Not attempted", pillHtml:`<span class="statusPill">Not yet</span>` };
}

/* =====================================================
   WEEKLY TOTALS (local)
   ===================================================== */
function startOfWeekLocalTs(nowTs){
  const d = new Date(nowTs);
  const day = d.getDay();
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

/* =====================================================
   RECENT STUDENT NAMES (device-only)
   ===================================================== */
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

/* =====================================================
   TTS
   ===================================================== */
let ttsVoices = [];
let __ttsActive = false;
let __ttsLastKey = "";

function loadTtsVoices(){
  if (!("speechSynthesis" in window)) return;
  ttsVoices = window.speechSynthesis.getVoices() || [];
}

function pickVoiceForLang(lang){
  const want = (lang === "sp") ? ["es", "es-"] : ["en", "en-"];
  return ttsVoices.find(v => want.some(p => (v.lang || "").toLowerCase().startsWith(p))) || null;
}

function ttsStop(){
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  __ttsActive = false;
  __ttsLastKey = "";
}

function getTtsRate(){
  const saved = Number(localStorage.getItem("star_tts_rate_v1") || 1.0);
  return Number.isNaN(saved) ? 1.0 : saved;
}

function ttsSpeak(text, key){
  if (!text) return;
  if (!("speechSynthesis" in window)) return;

  const currentlySpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  if (currentlySpeaking && __ttsActive && __ttsLastKey === key){
    ttsStop();
    return;
  }

  ttsStop();
  __ttsActive = true;
  __ttsLastKey = key;

  const u = new SpeechSynthesisUtterance(text);
  u.rate = Math.min(1.3, Math.max(0.7, getTtsRate()));

  const v = pickVoiceForLang(spanishMode ? "sp" : "en");
  if (v) u.voice = v;

  u.onend = () => { __ttsActive = false; __ttsLastKey = ""; };
  u.onerror = () => { __ttsActive = false; __ttsLastKey = ""; };

  window.speechSynthesis.speak(u);
}

/* =====================================================
   UTILITIES
   ===================================================== */
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

/* =====================================================
   QUIZ GRADING
   ===================================================== */
function norm(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textHasAny(haystackNorm, phraseNorm){
  if (!phraseNorm) return false;
  return haystackNorm.includes(phraseNorm);
}

function groupSatisfied(answerNorm, group){
  for (const raw of (group || [])){
    const p = norm(raw);
    if (!p) continue;
    if (textHasAny(answerNorm, p)) return true;
  }
  return false;
}

function gradeAnswerForCard(card, studentAnswerRaw, useSpanish){
  const langKey = useSpanish ? "sp" : "en";
  const rubric = card?.grade?.[langKey] || null;

  if (!rubric){
    const modelAns = useSpanish ? (card.answerTextSp || card.answerText || "") : (card.answerText || "");
    const a = norm(studentAnswerRaw);
    const b = norm(modelAns);
    const ok = (a && b && (a === b || (a.length >= 8 && b.includes(a)) || (b.length >= 8 && a.includes(b))));
    return {
      level: ok ? "correct" : "incorrect",
      score: ok ? 1 : 0,
      hit: [],
      missed: [],
      message: useSpanish ? (ok ? "Correcto." : "No todavía.") : (ok ? "Correct." : "Not yet.")
    };
  }

  const answerNorm = norm(studentAnswerRaw);
  const must = Array.isArray(rubric.must) ? rubric.must : [];
  const minMust = Number(rubric.minMustGroups || Math.max(1, Math.ceil(must.length * 0.6)));

  const hit = [];
  const missed = [];

  for (let i = 0; i < must.length; i++){
    const g = must[i];
    const ok = groupSatisfied(answerNorm, g);
    (ok ? hit : missed).push(g);
  }

  const hits = hit.length;
  const needed = Math.min(minMust, must.length);

  const correct = hits >= needed;
  const almost = !correct && hits >= Math.max(1, needed - 1);

  const level = correct ? "correct" : (almost ? "almost" : "incorrect");

  let message = "";
  if (useSpanish){
    if (level === "correct") message = "¡Correcto!";
    else if (level === "almost") message = "Casi. Te falta una idea clave.";
    else message = "No todavía. Intenta incluir las ideas clave.";
  } else {
    if (level === "correct") message = "Correct!";
    else if (level === "almost") message = "Almost. You’re missing one key idea.";
    else message = "Not yet. Try to include the key ideas.";
  }

  const missingHints = missed.slice(0, 2).map(g => (g || []).slice(0, 2).join(" / ")).filter(Boolean);
  if (missingHints.length){
    message += useSpanish
      ? `  Pista: incluye algo como ${missingHints.join(" + ")}.`
      : `  Hint: include something like ${missingHints.join(" + ")}.`;
  }

  return { level, score: must.length ? (hits / must.length) : (correct ? 1 : 0), hits, needed, hit, missed, message };
}

/* =====================================================
   BADGES
   ===================================================== */
const BADGES = [
  { minutes: 5,   cards: 3,   name: "Warm-Up",         emoji: "🔥" },
  { minutes: 15,  cards: 8,   name: "Getting Started", emoji: "⭐" },
  { minutes: 30,  cards: 15,  name: "Half-Hour Hero",  emoji: "🦸" },
  { minutes: 60,  cards: 25,  name: "One-Hour Champ",  emoji: "🏆" },
  { minutes: 120, cards: 40,  name: "Study Streaker",  emoji: "⚡" },
  { minutes: 240, cards: 60,  name: "Focused Fox",     emoji: "🦊" },
  { minutes: 500, cards: 90,  name: "STAR Master",     emoji: "👑" },
];

const BADGE_EARNED_KEY = "star_badges_earned_v1";

function badgeKey(student, badge){
  return `${student}::${badge.minutes}m::${badge.cards}c`;
}

function loadEarnedBadges(){
  try{
    const raw = localStorage.getItem(BADGE_EARNED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}

function saveEarnedBadges(obj){
  try{
    localStorage.setItem(BADGE_EARNED_KEY, JSON.stringify(obj));
  } catch {}
}

function totalMsLocalEverForStudent(stu){
  if (!stu || !stu.byCard) return 0;
  let total = 0;
  for (const id in stu.byCard){
    total += Number(stu.byCard[id]?.timeMs || 0);
  }
  return total;
}

function distinctCardsLocalAttempted(stu){
  if (!stu || !stu.byCard) return 0;
  let count = 0;
  for (const id in stu.byCard){
    if ((stu.byCard[id]?.attempts || 0) > 0) count++;
  }
  return count;
}

function checkForNewBadgesAndPopup(){
  if (!currentStudent) return;

  const stu = progress.students[currentStudent];
  if (!stu) return;

  const timeEverMs = totalMsLocalEverForStudent(stu);
  const minutes = Math.floor(timeEverMs / 60000);
  const cardsAttempted = distinctCardsLocalAttempted(stu);

  const earned = loadEarnedBadges();

  for (const b of BADGES){
    const meets = (minutes >= b.minutes && cardsAttempted >= b.cards);
    if (!meets) continue;

    const k = badgeKey(currentStudent, b);
    if (earned[k]) continue;

    earned[k] = { ts: Date.now(), minutes, cardsAttempted };
    saveEarnedBadges(earned);

    showBadgePopup({
      emoji: b.emoji,
      title: `${spanishMode ? "¡Insignia ganada!" : "Badge earned!"} ${b.name}`,
      body: spanishMode
        ? `Llegaste a ${minutes} minutos y ${cardsAttempted} tarjetas.`
        : `You reached ${minutes} minutes and ${cardsAttempted} cards.`
    });

    break;
  }
}

async function openBadges(){
  try{
    showView("badges");

    let name = (currentStudent || "").trim();
    if (!name) name = (el("studentName")?.value || "").trim();

    if (!name){
      currentStudent = "";
      el("badgesStudentPill") && (el("badgesStudentPill").textContent = spanishMode ? "Student: (escribe tu nombre)" : "Student: (enter your name first)");
      el("badgesTotalPill") && (el("badgesTotalPill").textContent = "");
      el("badgesSourcePill") && (el("badgesSourcePill").textContent = "");
      el("badgesNextHint") && (el("badgesNextHint").textContent = spanishMode ? "Regresa y escribe tu nombre para ver tus insignias." : "Go back and type your name to see your badges.");
      el("badgesSummary") && (el("badgesSummary").innerHTML = `<div class="summaryChip">${spanishMode ? "Ningún estudiante" : "No student selected"}</div>`);
      el("badgesGrid") && (el("badgesGrid").innerHTML = "");
      return;
    }

    currentStudent = name;
    addRecentName(currentStudent);
    renderRecentNamesSuggestions();
    ensureStudent(currentStudent);

    const localStu = progress.students[currentStudent];
    const localTimeEverMs = totalMsLocalEverForStudent(localStu);
    const localCardsAttempted = distinctCardsLocalAttempted(localStu);

    let sourceLabel = "This device";
    let timeEverMs = localTimeEverMs;
    let cardsAttempted = localCardsAttempted;

    try{
      const backendStu = await fetchBackendStudent(currentStudent);
      if (backendStu && backendStu.ok){
        const backendTime = (typeof backendStu.timeEver === "number") ? backendStu.timeEver : 0;

        let backendCards = 0;
        if (typeof backendStu.cardsAttempted === "number"){
          backendCards = backendStu.cardsAttempted;
        } else if (backendStu.byCard && typeof backendStu.byCard === "object"){
          backendCards = Object.values(backendStu.byCard).filter(s => (s.attempts || 0) > 0).length;
        }

        timeEverMs = Math.max(localTimeEverMs, backendTime);
        cardsAttempted = Math.max(localCardsAttempted, backendCards);

        if (backendTime || backendCards) sourceLabel = "All devices (best of backend + local)";
      }
    } catch (e){
      console.warn("[badges] backend fetch failed; using local", e);
    }

    renderBadgesPage({ timeEverMs, cardsAttempted, sourceLabel });
  } catch (err){
    console.error("[badges] openBadges crashed", err);
    alert("Badges page error. Open Console for details.");
  }
}

function renderBadgesPage({ timeEverMs, cardsAttempted, sourceLabel }){
  const totalMin = Math.floor((Number(timeEverMs) || 0) / 60000);
  const cardsN = Number(cardsAttempted) || 0;

  el("badgesStudentPill") && (el("badgesStudentPill").textContent = `Student: ${currentStudent}`);
  el("badgesTotalPill") && (el("badgesTotalPill").textContent = `Total: ${totalMin} min • ${cardsN} cards`);
  el("badgesSourcePill") && (el("badgesSourcePill").textContent = `Source: ${sourceLabel || ""}`);

  const hint = el("badgesNextHint");
  const sum = el("badgesSummary");
  const grid = el("badgesGrid");
  if (!grid) return;

  const earned = BADGES.filter(b => totalMin >= b.minutes && cardsN >= b.cards);
  const next = BADGES.find(b => !(totalMin >= b.minutes && cardsN >= b.cards)) || null;

  if (hint){
    if (!next){
      hint.textContent = spanishMode ? "¡Ganaste todas las insignias! 🥳" : "You earned every badge! 🥳";
    } else {
      const minLeft = Math.max(0, next.minutes - totalMin);
      const cardsLeft = Math.max(0, next.cards - cardsN);
      hint.textContent = spanishMode
        ? `Siguiente: ${next.emoji} ${next.name} — faltan ${minLeft} min y ${cardsLeft} tarjetas`
        : `Next badge: ${next.emoji} ${next.name} — ${minLeft} more min AND ${cardsLeft} more cards`;
    }
  }

  if (sum){
    sum.innerHTML = `
      <div class="summaryChip">Badges earned: <b>${earned.length}</b> / ${BADGES.length}</div>
      <div class="summaryChip">Minutes studied: <b>${totalMin}</b></div>
      <div class="summaryChip">Cards attempted: <b>${cardsN}</b></div>
    `;
  }

  grid.innerHTML = "";

  for (const b of BADGES){
    const got = (totalMin >= b.minutes && cardsN >= b.cards);

    const tile = document.createElement("div");
    tile.className = "dashCard";
    tile.style.background = got ? "var(--green)" : "var(--gray)";
    tile.style.opacity = got ? "1" : "0.6";

    tile.innerHTML = `
      <b style="font-size:22px;">${b.emoji}</b>
      <div style="font-weight:700;">${escapeHtml(b.name)}</div>
      <small>Need: ${b.minutes} min • ${b.cards} cards</small>
      <small>${got ? (spanishMode ? "Ganada" : "Earned!") : (spanishMode ? "Todavía no" : "Not yet")}</small>
    `;

    grid.appendChild(tile);
  }
}

function wireSegToggle(){
  // Event delegation so it works even if elements re-render
  document.addEventListener("click", (e) => {
    const studyBtn = e.target.closest("#segStudyBtn");
    const quizBtn  = e.target.closest("#segQuizBtn");

    if (studyBtn){
      setQuizMode(false);
    }
    if (quizBtn){
      setQuizMode(true);
    }
  }, true); // capture = true helps if something is swallowing bubbling
}

/* =====================================================
   WIRE EVERYTHING
   ===================================================== */
function wireEverything(){
  // badge popup
  el("badgePopupCloseBtn")?.addEventListener("click", hideBadgePopup);
  el("badgePopup")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "badgePopup") hideBadgePopup();
  });

  // top bar
  el("modeStudent")?.addEventListener("click", () => showView("start"));
  el("modeTeacher")?.addEventListener("click", openTeacherDashboard);
  el("langToggleBtn")?.addEventListener("click", () => setSpanishMode(!spanishMode));

  // start view
  el("startBtn")?.addEventListener("click", start);
  el("studentDashBtn")?.addEventListener("click", openDashboardDefault);
  el("badgesBtn")?.addEventListener("click", openBadges);

  // study view
  el("dashInStudyBtn")?.addEventListener("click", openDashboardDefault);
  el("badgesInStudyBtn")?.addEventListener("click", openBadges);
  el("homeBtn")?.addEventListener("click", goToStart);
// Segmented Study/Quiz buttons
el("segStudyBtn")?.addEventListener("click", () => setQuizMode(false));
el("segQuizBtn")?.addEventListener("click", () => setQuizMode(true));

  el("checkBtn")?.addEventListener("click", () => { ttsStop(); window.reveal(); });
  el("skipBtn")?.addEventListener("click", () => advance("skip"));
  el("nextBtn")?.addEventListener("click", () => {
    el("quizFeedback")?.classList.add("hidden");
    el("nextBtn")?.classList.add("hidden");
    el("checkBtn")?.classList.remove("hidden");
    el("skipBtn")?.classList.remove("hidden");
    advance("skip");
  });

  el("rateGot")?.addEventListener("click", () => advance("got"));
  el("rateClose")?.addEventListener("click", () => advance("close"));
  el("rateMiss")?.addEventListener("click", () => advance("miss"));

  // dashboard toggles
  el("dashToggle")?.addEventListener("change", (e) => setDashboardMode(e.target.checked ? "quiz" : "ratings"));
  el("quizDashToggle")?.addEventListener("change", (e) => setDashboardMode(e.target.checked ? "quiz" : "ratings"));

  // back buttons
  el("dashBackBtn")?.addEventListener("click", goToStart);
  el("quizDashBackBtn")?.addEventListener("click", goToStart);
  el("badgesBackBtn")?.addEventListener("click", goToStart);

  // teacher select
  el("studentSelect")?.addEventListener("change", () => {
    if (window.__teacherDataSource === "backend") {
      const students = window.__teacherBackendStudents || {};
      renderTeacherSummaryFromBackend(students);
      renderTeacherTableForSelectedStudentFromBackend(students);
    } else {
      renderTeacherTableForSelectedStudentLocal();
    }
  });
}

/* =====================================================
   INIT
   ===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  try{
    if ("speechSynthesis" in window){
      loadTtsVoices();
      window.speechSynthesis.onvoiceschanged = loadTtsVoices;
    }

    wireBadgePopup();
    hideBadgePopup();

    renderRecentNamesSuggestions();
    setSpanishMode(spanishMode);

    await loadCards();
    buildUnitUI();
    
    wireSegToggle();
    wireEverything();
     
    showView("start");

    console.log("[init] ready");
  } catch (e){
    console.error("[init] failed", e);
    alert("App failed to initialize. Open Console for details.");
  }
});

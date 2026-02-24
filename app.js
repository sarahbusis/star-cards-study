/* =========================
   STAR Cards Study — app.js
   (clean drop-in version)
   ========================= */

/* ---------- Config ---------- */
const LANG_KEY = "star_lang_v1";
let spanishMode = localStorage.getItem(LANG_KEY) === "sp";

const BACKEND_URL = "https://script.google.com/macros/s/AKfycbyke09fUi9ChB1ewAUU4EzCDquAPC1RLRcCJcQwfzPfQF78G1giSrMKSNw2Ydwm6VxW/exec";
const BACKEND_SECRET = "CHANGE_ME_TO_SOMETHING_LONG"; // must match SHARED_SECRET in Apps Script, or "" if disabled
const STUDENT_CODE = "spark2026"; // must match Code.gs
const TEACHER_PIN = "2026";

const STORAGE_KEY = "star_screenshot_progress_v3";

/* ---------- Local progress storage (MUST be above State) ---------- */
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

/* ---------- State ---------- */
let cards = [];
let progress = loadProgress();

let currentStudent = "";
let selectedUnits = new Set();

let queue = [];
let idx = 0;



let cardStartTs = null;

// --- Safety shims so wiring doesn't crash the whole app ---
window.openDashboardDefault = window.openDashboardDefault || function(){
  if (typeof openStudentDashboard === "function") openStudentDashboard();
};
window.setDashboardMode = window.setDashboardMode || function(){};
window.openQuizDashboard = window.openQuizDashboard || function(){
  alert("Quiz dashboard isn't installed yet.");
};

/* ---------- DOM helper ---------- */
function el(id){
  return document.getElementById(id);
}
// =====================================================
// QUIZ MODE + QUIZ DASHBOARD (DROP-IN BLOCK)
// =====================================================

// Global flag
window.quizMode = window.quizMode ?? false;

// --- Quiz toggle button ---
function openQuizMode(){
  window.quizMode = !window.quizMode;

  const btn = el("quizInStudyBtn");
  if (btn){
    btn.textContent = quizMode
      ? (spanishMode ? "Estudio" : "Study")
      : "Quiz";
  }

  // Hide old feedback whenever toggling
  el("quizFeedback")?.classList.add("hidden");
}

// --- Feedback box ---
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

// --- QUIZ stats storage (separate from self-rating study stats) ---
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
// ===============================
// DASHBOARD TOGGLE (ratings vs quiz)
// ===============================
window.dashboardMode = window.dashboardMode ?? "ratings"; // "ratings" | "quiz"

function setDashboardMode(mode){
  window.dashboardMode = (mode === "quiz") ? "quiz" : "ratings";

  const isQuiz = (window.dashboardMode === "quiz");

  // Sync BOTH toggles if present
  const t1 = el("dashToggle");
  if (t1) t1.checked = isQuiz;

  const t2 = el("quizDashToggle");
  if (t2) t2.checked = isQuiz;

  // Switch views
  showView(isQuiz ? "quizDash" : "studentDash");

  // Re-render the view we’re showing
  try {
    if (isQuiz) renderQuizDashboard();
    else renderStudentDashboard();
  } catch (e){
    console.warn("[dashboard] render error:", e);
  }
}

async function openDashboardDefault(){
  // Ensure we load student + backend data the same way as before
  await openStudentDashboard();
  setDashboardMode("ratings");
}
// --- Quiz dashboard view ---
function openQuizDashboard(){
  let name = (currentStudent || "").trim();
  if (!name) name = (el("studentName")?.value || "").trim();

  if (!name){
    alert(spanishMode ? "Escribe tu nombre primero." : "Enter your name first.");
    return;
  }

  currentStudent = name;
  ensureStudent(currentStudent);

  renderQuizDashboard();
  showView("quizDash");
}

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

    // Click tile to jump to that single card in study view
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
/* ---------- Views ---------- */
function showView(which){
  const map = {
    start: "startView",
    study: "studyView",
    studentDash: "studentDashView",
    badges: "badgesView",
    quizDash: "quizDashView",
    teacher: "teacherView"
  };

  const targetId = map[which] || which;

  const all = ["startView","studyView","studentDashView","badgesView","quizDashView","teacherView"];
  for (const id of all){
    el(id)?.classList.toggle("hidden", id !== targetId);
  }
}
/* ---------- Language toggle ---------- */
function setSpanishMode(on){
  spanishMode = !!on;
  localStorage.setItem(LANG_KEY, spanishMode ? "sp" : "en");

  // Button label flips so kids know how to switch back
  const btn = el("langToggleBtn");
  if (btn) btn.textContent = spanishMode ? "English" : "Español";

  // Pills if present
  if (el("langPill")) el("langPill").textContent = spanishMode ? "Language: Español" : "Language: English";
  if (el("dashLangPill")) el("dashLangPill").textContent = spanishMode ? "Language: Español" : "Language: English";

  // Update read hint if present
  const hint = el("clickReadHint");
  if (hint) hint.textContent = spanishMode ? "Haz clic para leer en voz alta." : "Click the card to read aloud.";

  // Stop any TTS and re-render if needed
  ttsStop();
  try { renderCard(); } catch {}
  try { renderStudentDashboard(); } catch {}
}

/* ---------- Cards loading ---------- */
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

  window.__cards = cards; // helpful for debugging
  console.log("[cards] loaded", cards.length);
}

/* ---------- Units UI ---------- */
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
    // Use your existing "pill" styling so it fits your site
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

/* ---------- Start / Study flow ---------- */
function start(){
  const name = (el("studentName")?.value || "").trim();
  if (!name) return alert("Please enter your name.");

  currentStudent = name;
  addRecentName(currentStudent);
  renderRecentNamesSuggestions();
  ensureStudent(currentStudent);

  selectedUnits = readSelectedUnitsFromUI();
  if (!selectedUnits.size){
    return alert("Select at least one unit.");
  }

  const shuffle = !!el("shuffleToggle")?.checked;
  const onlyNeeds = !!el("onlyNeedsToggle")?.checked;

  queue = buildQueue({ shuffle, onlyNeeds });
  idx = 0;

  if (!queue.length){
    showView("study");
    renderCard(); // will show "No cards found..."
    return;
  }

  showView("study");
  renderCard();
}

function goToStart(){
  showView("start");
  resetStudyUI();
  ttsStop();
}

window.reveal = function reveal(){
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  if (!answerCol || !revealArea) return;

  if (!queue.length) return;
  const c = queue[idx % queue.length];

  // Always show answer image column
  answerCol.classList.remove("hidden");

  if (window.quizMode){
    // --- QUIZ MODE ---
    // Hide self-rating area
    revealArea.classList.add("hidden");

    // Grade typed answer
    const typed = el("answerBox")?.value || "";
    const res = gradeAnswerForCard(c, typed, !!spanishMode);
    setQuizFeedback(res.level, res.message);

    recordQuizResult(currentStudent, c.id, res.level);

    // Swap buttons: hide Check/Skip, show Next
    el("checkBtn")?.classList.add("hidden");
    el("skipBtn")?.classList.add("hidden");
    el("nextBtn")?.classList.remove("hidden");

  } else {
    // --- STUDY MODE ---
    el("quizFeedback")?.classList.add("hidden");

    // Show rating choices
    revealArea.classList.remove("hidden");

    // Buttons: show Check/Skip, hide Next
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

  // ✅ 3-minute cap per advance to prevent idle-farming
  const MAX_MS_PER_ADVANCE = 3 * 60 * 1000; // 180,000 ms
  const rawDt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);
  const dt = Math.min(rawDt, MAX_MS_PER_ADVANCE);

  if (!stu.byCard[c.id]) stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  const s = stu.byCard[c.id];

  // Count attempt + time always
  s.attempts += 1;
  s.timeMs += dt;

  const rated = (mode === "got" || mode === "close" || mode === "miss");
  if (rated) s[mode] += 1;

  // Log for weekly totals (local)
  if (!Array.isArray(stu.log)) stu.log = [];
  stu.log.push({ ts: now, cardId: c.id, dtMs: dt, rating: rated ? mode : "skip" });
  if (stu.log.length > 5000) stu.log = stu.log.slice(-5000);

  saveProgress(progress);

  // Send to backend (all devices)
  sendEventToBackend({
    student: currentStudent,
    cardId: c.id,
    unit: c.unit,
    rating: rated ? mode : "skip",
    dtMs: dt,
    capped: rawDt > dt,              // optional: helps you audit idling later
    lang: spanishMode ? "sp" : "en"
  });

  // ✅ show badge popup if a new badge was earned
  checkForNewBadgesAndPopup();

  idx++;
  renderCard();
}

/* ---------- Queue building ---------- */
function buildQueue({ shuffle, onlyNeeds }){
  let list = [...cards];

  // Filter by units
  list = list.filter(c => selectedUnits.has(Number(c.unit)));

  // Filter by needs practice
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

/* ---------- Render study card ---------- */
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
    if (el("cardStats")) el("cardStats").textContent = "No cards found for these filters.";
    revealArea?.classList.add("hidden");
    answerCol?.classList.add("hidden");
    return;
  }

  const c = queue[idx % queue.length];

  if (el("progressPill")){
    el("progressPill").textContent = `Card ${(idx % queue.length) + 1} / ${queue.length} (Unit ${c.unit})`;
  }
  
try { setQuizMode(window.quizMode); } catch {}

  // Update hint language
  const hint = el("clickReadHint");
  if (hint) hint.textContent = spanishMode ? "Haz clic para leer en voz alta." : "Click the card to read aloud.";

  // Stop speech when new card shows
  ttsStop();

  // Images with Spanish fallback to English
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

  // Clear typed answer
  if (answerBox) answerBox.value = "";

  // Hide answer + rating
  revealArea?.classList.add("hidden");
  answerCol?.classList.add("hidden");

  // Card stats (local)
  ensureStudent(currentStudent);
  const s = progress.students[currentStudent].byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  if (el("cardStats")){
    el("cardStats").textContent =
      `This card — ✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}  | Attempts: ${s.attempts}  | Time: ${formatMs(s.timeMs)}`;
  }

  // Click-to-read (question + answer)
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

function resetStudyUI(){
  if (el("answerBox")) el("answerBox").value = "";
  el("revealArea")?.classList.add("hidden");
  el("answerCol")?.classList.add("hidden");
  cardStartTs = null;
}

/* ---------- Student dashboard ---------- */
async function openStudentDashboard(){
  let name = (currentStudent || "").trim();
  if (!name) name = (el("studentName")?.value || "").trim();
  if (!name) return alert("Enter your name first.");

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

    // Open single-card study when clicked
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

/* ---------- Teacher dashboard (backend preferred) ---------- */
async function openTeacherDashboard(){
  const pin = prompt("Teacher PIN:");
  if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");

  showView("teacher");

  // Try backend (all devices)
  const backend = await fetchBackendSummary(pin);
  if (backend && backend.ok && backend.students){
    window.__teacherDataSource = "backend";
    window.__teacherBackendStudents = backend.students;
    renderTeacherFromBackend(backend.students);
    return;
  }

  // Fallback local
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

/* ---------- Backend calls (JSONP for GET; POST for events) ---------- */
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

  const stu = studentsObj[student]; // { byCard, timeEver, timeWeek }
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
// ---- Quiz mode state (safe global) ----
window.quizMode = window.quizMode ?? false;

function setQuizMode(on){
  window.quizMode = !!on;

  // sync toggle UI
  const t = el("quizModeToggle");
  if (t) t.checked = window.quizMode;

  const lab = el("quizModeLabel");
  if (lab){
    lab.textContent = window.quizMode
      ? "Quiz"
      : (spanishMode ? "Estudio" : "Study");
  }

  // reset per-card UI bits when switching modes
  el("quizFeedback")?.classList.add("hidden");
  el("nextBtn")?.classList.add("hidden");
  el("checkBtn")?.classList.remove("hidden");
  el("skipBtn")?.classList.remove("hidden");

  // rating area only used in study mode
  if (window.quizMode){
    el("revealArea")?.classList.add("hidden");
    el("answerCol")?.classList.add("hidden");
  }
}

/* ===============================
   BADGE POPUP (single source of truth)
   =============================== */
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
  // Close button
  el("badgePopupCloseBtn")?.addEventListener("click", hideBadgePopup);

  // Click outside closes
  el("badgePopup")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "badgePopup") hideBadgePopup();
  });

  // Escape key closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideBadgePopup();
  });
}

/* ===============================
   QUIZ per-card storage (single copy)
   =============================== */
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
   ✅ WIRE EVERYTHING (matches your updated index.html)
   ===================================================== */
function wireEverything(){

  // ---------- Persistent top bar ----------
  el("modeStudent")?.addEventListener("click", () => showView("start"));
  el("modeTeacher")?.addEventListener("click", openTeacherDashboard);
  el("langToggleBtn")?.addEventListener("click", () => setSpanishMode(!spanishMode));

  // ---------- Start view ----------
  el("startBtn")?.addEventListener("click", start);

  // Dashboard buttons (open ratings by default)
  el("studentDashBtn")?.addEventListener("click", openDashboardDefault);

  el("badgesBtn")?.addEventListener("click", openBadges);

  // ---------- Study view ----------
  el("dashInStudyBtn")?.addEventListener("click", openDashboardDefault);
  el("badgesInStudyBtn")?.addEventListener("click", openBadges);

  // Home button
  el("homeBtn")?.addEventListener("click", goToStart);

  // Quiz mode toggle switch
  el("quizModeToggle")?.addEventListener("change", (e) => {
    setQuizMode(!!e.target.checked);
  });

  // Check / Skip / Next
  el("checkBtn")?.addEventListener("click", () => { ttsStop?.(); reveal(); });
  el("skipBtn")?.addEventListener("click", () => advance("skip"));

  el("nextBtn")?.addEventListener("click", () => {
    el("quizFeedback")?.classList.add("hidden");

    el("nextBtn")?.classList.add("hidden");
    el("checkBtn")?.classList.remove("hidden");
    el("skipBtn")?.classList.remove("hidden");

    advance("skip");
  });

  // Self-rating buttons (Study mode only; hidden in Quiz mode)
  el("rateGot")?.addEventListener("click", () => advance("got"));
  el("rateClose")?.addEventListener("click", () => advance("close"));
  el("rateMiss")?.addEventListener("click", () => advance("miss"));

  // ---------- Dashboard toggles (My ratings <-> Quiz scores) ----------
  el("dashToggle")?.addEventListener("change", (e) => {
    setDashboardMode(e.target.checked ? "quiz" : "ratings");
  });

  el("quizDashToggle")?.addEventListener("change", (e) => {
    setDashboardMode(e.target.checked ? "quiz" : "ratings");
  });

  // ---------- Student dashboard ----------
  el("dashBackBtn")?.addEventListener("click", goToStart);

  // ---------- Quiz dashboard ----------
  el("quizDashBackBtn")?.addEventListener("click", goToStart);

  // ---------- Badges view ----------
  el("badgesBackBtn")?.addEventListener("click", goToStart);

  // ---------- Teacher dashboard ----------
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
/* ---------- TTS (text-to-speech) ---------- */

let ttsVoices = [];
let __ttsActive = false;
let __ttsLastKey = "";

function loadTtsVoices(){
  if (!("speechSynthesis" in window)) return;
  ttsVoices = window.speechSynthesis.getVoices() || [];
}

function pickVoiceForLang(lang){
  const want = (lang === "sp") ? ["es", "es-"] : ["en", "en-"];
  return ttsVoices.find(v =>
    want.some(p => (v.lang || "").toLowerCase().startsWith(p))
  ) || null;
}

function ttsStop(){
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  __ttsActive = false;
  __ttsLastKey = "";
}

function ttsSpeak(text, key){
  if (!text) return;
  if (!("speechSynthesis" in window)) return;

  const currentlySpeaking =
    window.speechSynthesis.speaking ||
    window.speechSynthesis.pending;

  if (currentlySpeaking && __ttsActive && __ttsLastKey === key){
    ttsStop();
    return;
  }

  ttsStop();
  __ttsActive = true;
  __ttsLastKey = key;

  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoiceForLang(spanishMode ? "sp" : "en");
  if (v) u.voice = v;

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
/* ---------- Recent student names (device only) ---------- */
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
/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  try{
    // Voices (optional)
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

    wireEverything();

    // Ensure UI matches current quiz mode
    setQuizMode(window.quizMode);

    showView("start");
    console.log("[init] ready");
  } catch (e){
    console.error("[init] failed", e);
    alert("App failed to initialize. Open Console for details.");
  }
});

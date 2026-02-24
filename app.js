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

/* ---------- State ---------- */
let cards = [];
let progress = loadProgress();

let currentStudent = "";
let selectedUnits = new Set();
let queue = [];
let idx = 0;

let cardStartTs = null;

/* ---------- DOM helper ---------- */
function el(id){
  return document.getElementById(id);
}

/* ---------- Views ---------- */
function showView(which){
  const views = ["startView", "studyView", "studentDashView", "badgesView", "teacherView"];

  // Hide all
  for (const id of views){
    const v = el(id);
    if (v) v.classList.add("hidden");
  }

  // Show exactly one
  const map = {
    start: "startView",
    study: "studyView",
    studentDash: "studentDashView",
    badges: "badgesView",
     quizDash: "quizDashView",
    teacher: "teacherView",
  };

  const targetId = map[which];
  const target = targetId ? el(targetId) : null;

  if (target){
    target.classList.remove("hidden");
  } else {
    console.warn("[showView] unknown view:", which, "showing startView instead");
    el("startView")?.classList.remove("hidden");
  }

  console.log("[showView]", which, "=>", targetId,
    "badgesHidden?", el("badgesView")?.classList.contains("hidden"),
    "startHidden?", el("startView")?.classList.contains("hidden")
  );
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

function reveal(){
  el("answerCol")?.classList.remove("hidden");
  el("revealArea")?.classList.remove("hidden");
}

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

/* ---------- Status helpers ---------- */
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

/* ---------- Local progress storage ---------- */
function ensureStudent(name){
  if (!progress.students[name]){
    progress.students[name] = { byCard:{}, log:[] };
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

/* ---------- Weekly total helper (local) ---------- */
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

/* ---------- TTS (click-to-toggle) ---------- */
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
  // If you later add a slider, this will still work. For now default 1.0.
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

/* ---------- Utilities ---------- */
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
// -------- QUIZ: normalization + grading --------
function norm(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents: á->a
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFrom(s){
  const t = norm(s);
  return t ? t.split(" ") : [];
}

function textHasAny(haystackNorm, phraseNorm){
  // phraseNorm can be multi-word; check as substring for simplicity
  if (!phraseNorm) return false;
  return haystackNorm.includes(phraseNorm);
}

function groupSatisfied(answerNorm, group){
  // group is array of synonyms/phrases
  // true if any synonym phrase appears in normalized answer
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

  // If no rubric, fall back to simple similarity vs answerText
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
  const optional = Array.isArray(rubric.optional) ? rubric.optional : [];
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

  // Scoring + levels (moderately strict)
  // correct: hits >= needed
  // almost: hits >= max(1, needed-1)
  const correct = hits >= needed;
  const almost = !correct && hits >= Math.max(1, needed - 1);

  const level = correct ? "correct" : (almost ? "almost" : "incorrect");

  // Friendly feedback message (language-aware)
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

  // Build “missing ideas” text by showing 1–2 example keywords from missed groups
  const missingHints = missed.slice(0, 2).map(g => {
    // pick 1–2 representative phrases from each missed group
    const sample = (g || []).slice(0, 2).join(" / ");
    return sample;
  }).filter(Boolean);

  if (missingHints.length){
    message += useSpanish
      ? `  Pista: incluye algo como ${missingHints.join(" + ")}.`
      : `  Hint: include something like ${missingHints.join(" + ")}.`;
  }

  return {
    level,                       // "correct" | "almost" | "incorrect"
    score: must.length ? (hits / must.length) : (correct ? 1 : 0),
    hits,
    needed,
    hit,
    missed,
    message
  };
}
/* ---------- Badges (minutes studied) ---------- */
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
  // Unique per student + badge requirement
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

function showBadgePopup(badge, totals){
  const pop = el("badgePopup");
  if (!pop) return;

  el("badgePopupEmoji") && (el("badgePopupEmoji").textContent = badge.emoji);
  el("badgePopupTitle") && (el("badgePopupTitle").textContent = `Badge earned: ${badge.name}!`);
  el("badgePopupBody") && (el("badgePopupBody").textContent =
    `You reached ${totals.minutes} minutes and ${totals.cards} cards attempted. Keep going!`
  );

  // ✅ Bulletproof show (doesn't rely on .hidden CSS)
  pop.style.display = "flex";
  pop.classList.remove("hidden");
}

function hideBadgePopup(){
  const pop = el("badgePopup");
  if (!pop) return;

  // ✅ Bulletproof hide
  pop.style.display = "none";
  pop.classList.add("hidden");
}
function totalMsLocalEverForStudent(stu){
  if (!stu || !stu.byCard) return 0;
  let total = 0;
  for (const id in stu.byCard){
    total += Number(stu.byCard[id]?.timeMs || 0);
  }
  return total;
}
function checkForNewBadgesAndPopup(){
  if (!currentStudent) return;

  const stu = progress.students[currentStudent];
  if (!stu) return;

  const timeEverMs = totalMsLocalEverForStudent(stu);
  const minutes = Math.floor(timeEverMs / 60000);
  const cardsAttempted = distinctCardsLocalAttempted(stu);

  const earned = loadEarnedBadges();

  // Find the FIRST badge that is newly earned (in order)
  for (const b of BADGES){
    const meets = (minutes >= b.minutes && cardsAttempted >= b.cards);
    if (!meets) continue;

    const k = badgeKey(currentStudent, b);
    if (earned[k]) continue; // already celebrated

    // Mark as earned and show popup
    earned[k] = { ts: Date.now(), minutes, cardsAttempted };
    saveEarnedBadges(earned);

    showBadgePopup(b, { minutes, cards: cardsAttempted });
    break;
  }
}
function formatMinutesFromMs(ms){
  const mins = Math.floor((Number(ms) || 0) / 60000);
  return `${mins} min`;
}
function distinctCardsLocalAttempted(stu){
  if (!stu || !stu.byCard) return 0;
  let count = 0;
  for (const id in stu.byCard){
    if ((stu.byCard[id]?.attempts || 0) > 0) count++;
  }
  return count;
}
async function openBadges(){
  try{
    // Always switch to badges view immediately (so it never “looks like nothing happened”)
    showView("badges");

    // If we don't have a name, show a friendly message on the badges page
    let name = (currentStudent || "").trim();
    if (!name) name = (el("studentName")?.value || "").trim();

    if (!name){
      // Populate badges page with a prompt instead of leaving it blank
      currentStudent = "";
      el("badgesStudentPill") && (el("badgesStudentPill").textContent = "Student: (enter your name first)");
      el("badgesTotalPill") && (el("badgesTotalPill").textContent = "");
      el("badgesSourcePill") && (el("badgesSourcePill").textContent = "");
      el("badgesNextHint") && (el("badgesNextHint").textContent = "Go back and type your name to see your badges.");
      el("badgesSummary") && (el("badgesSummary").innerHTML = `<div class="summaryChip">No student selected</div>`);
      el("badgesGrid") && (el("badgesGrid").innerHTML = "");
      console.log("[badges] opened with no name -> showing prompt");
      return;
    }

    // Normal flow
    currentStudent = name;
    addRecentName(currentStudent);
    renderRecentNamesSuggestions();
    ensureStudent(currentStudent);

    // Local totals (instant)
    const localStu = progress.students[currentStudent];
    const localTimeEverMs = totalMsLocalEverForStudent(localStu);
    const localCardsAttempted = distinctCardsLocalAttempted(localStu);

    let sourceLabel = "This device";
    let timeEverMs = localTimeEverMs;
    let cardsAttempted = localCardsAttempted;

    // Backend (best-of backend+local)
    try{
      const backendStu = await fetchBackendStudent(currentStudent);
      if (backendStu && backendStu.ok){
        window.__studentBackend = backendStu;

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

    console.log("[badges] totals", { currentStudent, timeEverMs, cardsAttempted, sourceLabel });

    renderBadgesPage({ timeEverMs, cardsAttempted, sourceLabel });
  } catch (err){
    console.error("[badges] openBadges crashed", err);
    alert("Badges page error. Open Console for details.");
  }
}
function renderBadgesPage({ timeEverMs, cardsAttempted, sourceLabel }){
  // --- Debug (remove later if you want) ---
  console.log("[badges] render", { timeEverMs, cardsAttempted, sourceLabel, BADGES_type: typeof BADGES, BADGES_len: (typeof BADGES !== "undefined" && BADGES?.length) });

  const totalMin = Math.floor((Number(timeEverMs) || 0) / 60000);
  const cardsN = Number(cardsAttempted) || 0;

  el("badgesStudentPill") && (el("badgesStudentPill").textContent = `Student: ${currentStudent}`);
  el("badgesTotalPill") && (el("badgesTotalPill").textContent = `Total: ${totalMin} min • ${cardsN} cards`);
  el("badgesSourcePill") && (el("badgesSourcePill").textContent = `Source: ${sourceLabel || ""}`);

  // ✅ Guard: BADGES must exist
  const badgeList =
    (typeof BADGES !== "undefined" && Array.isArray(BADGES)) ? BADGES : [];

  const hint = el("badgesNextHint");
  const sum = el("badgesSummary");
  const grid = el("badgesGrid");
  if (!grid) return;

  // ✅ If BADGES is missing, show a helpful message instead of blank
  if (!badgeList.length){
    if (hint) hint.textContent = "No badge definitions found (BADGES array is missing).";
    if (sum) sum.innerHTML = `<div class="summaryChip">Fix needed: BADGES is not loaded.</div>`;
    grid.innerHTML = "";
    return;
  }

  const earned = badgeList.filter(b => totalMin >= b.minutes && cardsN >= b.cards);
  const next = badgeList.find(b => !(totalMin >= b.minutes && cardsN >= b.cards)) || null;

  if (hint){
    if (!next){
      hint.textContent = "You earned every badge! 🥳";
    } else {
      const minLeft = Math.max(0, next.minutes - totalMin);
      const cardsLeft = Math.max(0, next.cards - cardsN);
      if (minLeft > 0 && cardsLeft > 0){
        hint.textContent = `Next badge: ${next.emoji} ${next.name} — ${minLeft} more min AND ${cardsLeft} more cards to go!`;
      } else if (minLeft > 0){
        hint.textContent = `Next badge: ${next.emoji} ${next.name} — ${minLeft} more minutes to go!`;
      } else {
        hint.textContent = `Next badge: ${next.emoji} ${next.name} — ${cardsLeft} more cards to go!`;
      }
    }
  }

  if (sum){
    sum.innerHTML = `
      <div class="summaryChip">Badges earned: <b>${earned.length}</b> / ${badgeList.length}</div>
      <div class="summaryChip">Minutes studied: <b>${totalMin}</b></div>
      <div class="summaryChip">Cards attempted: <b>${cardsN}</b></div>
    `;
  }

  grid.innerHTML = "";

  // ✅ Guard: escapeHtml fallback (prevents crash)
  const safeEscape = (typeof escapeHtml === "function")
    ? escapeHtml
    : (s => String(s));

  for (const b of badgeList){
    const got = (totalMin >= b.minutes && cardsN >= b.cards);

    const tile = document.createElement("div");
    tile.className = "dashCard";
    tile.style.background = got ? "var(--green)" : "var(--gray)";
    tile.style.opacity = got ? "1" : "0.6";

    tile.innerHTML = `
      <b style="font-size:22px;">${b.emoji}</b>
      <div style="font-weight:700;">${safeEscape(b.name)}</div>
      <small>Need: ${b.minutes} min • ${b.cards} cards</small>
      <small>${got ? "Earned!" : "Not yet"}</small>
    `;

    grid.appendChild(tile);
  }
}

function wireBadgePopup(){
  // Close button
  el("badgePopupCloseBtn")?.addEventListener("click", hideBadgePopup);

  // Click outside the modal closes
  el("badgePopup")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "badgePopup") hideBadgePopup();
  });

  // ESC key closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideBadgePopup();
  });
}

// -------- QUIZ: per-card stats separate from study ratings --------
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

   el("badgePopupCloseBtn")?.addEventListener("click", hideBadgePopup);
el("badgePopup")?.addEventListener("click", (e) => {
  if (e.target && e.target.id === "badgePopup") hideBadgePopup(); // click outside closes
});
   el("badgesInStudyBtn")?.addEventListener("click", () => console.log("BADGES BUTTON CLICKED"));
  // Header buttons
  el("modeStudent")?.addEventListener("click", () => showView("start"));
  el("modeTeacher")?.addEventListener("click", openTeacherDashboard);
  el("langToggleBtn")?.addEventListener("click", () => setSpanishMode(!spanishMode));
el("quizInStudyBtn")?.addEventListener("click", () => openQuizMode());
el("quizDashBackBtn")?.addEventListener("click", () => showView("study"));
   el("quizDashBtn")?.addEventListener("click", openQuizDashboard);
   
  // Start view
  el("startBtn")?.addEventListener("click", start);
  el("studentDashBtn")?.addEventListener("click", openStudentDashboard);

  // Study view
  el("dashInStudyBtn")?.addEventListener("click", openStudentDashboard);
  el("changeBtn")?.addEventListener("click", goToStart);
  el("checkBtn")?.addEventListener("click", () => { ttsStop(); reveal(); });
  el("skipBtn")?.addEventListener("click", () => advance("skip"));
  el("rateGot")?.addEventListener("click", () => advance("got"));
  el("rateClose")?.addEventListener("click", () => advance("close"));
  el("rateMiss")?.addEventListener("click", () => advance("miss"));

// Badges buttons (start + study)
el("badgesBtn")?.addEventListener("click", openBadges);
el("badgesInStudyBtn")?.addEventListener("click", openBadges);

// Back button inside badges view
el("badgesBackBtn")?.addEventListener("click", () => showView("start"));
   


// Badges view
el("badgesBackBtn")?.addEventListener("click", goToStart);

   
  // Student dashboard
  el("dashBackBtn")?.addEventListener("click", goToStart);

  // Teacher dashboard
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

wireBadgePopup();
/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  try{
    // Voices (optional)
    if ("speechSynthesis" in window){
      loadTtsVoices();
      window.speechSynthesis.onvoiceschanged = loadTtsVoices;
    }
hideBadgePopup();
    renderRecentNamesSuggestions();
    setSpanishMode(spanishMode);

    await loadCards();
    buildUnitUI();

    wireEverything();

    showView("start");
    console.log("[init] ready");
  } catch (e){
    console.error("[init] failed", e);
    alert("App failed to initialize. Open Console for details.");
  }
});

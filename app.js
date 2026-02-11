const STORAGE_KEY = "star_screenshot_progress_v2";
const TEACHER_PIN = "2026"; // Teacher PIN is 2026

let cards = [];
let progress = loadProgress();

let currentStudent = "";
let selectedUnits = new Set();
let queue = [];
let idx = 0;

let cardStartTs = null;

// Safe element getter: warns instead of crashing
function el(id) {
  const node = document.getElementById(id);
  if (!node) console.warn(`[STAR] Missing element id="${id}"`);
  return node;
}

document.addEventListener("DOMContentLoaded", () => {
  wireUI();
  loadCards();
  buildUnitCheckboxes();
  showView("start");
});

function wireUI() {
  // These are extra (in addition to inline onclick). If they fail, onclick still works.
  el("modeStudent")?.addEventListener("click", () => showView("start"));
  el("modeTeacher")?.addEventListener("click", () => {
    const pin = prompt("Teacher PIN:");
    if (pin !== TEACHER_PIN) return alert("Incorrect PIN.");
    showView("teacher");
    renderTeacher();
  });

  el("changeBtn")?.addEventListener("click", goToStart);
  el("checkBtn")?.addEventListener("click", reveal);
  el("skipBtn")?.addEventListener("click", () => advance("skip"));

  el("rateGot")?.addEventListener("click", () => advance("got"));
  el("rateClose")?.addEventListener("click", () => advance("close"));
  el("rateMiss")?.addEventListener("click", () => advance("miss"));

  el("exportBtn")?.addEventListener("click", exportJSON);
  el("importFile")?.addEventListener("change", importJSON);
  el("resetBtn")?.addEventListener("click", resetAll);
  el("studentSelect")?.addEventListener("change", renderTeacherTableForSelectedStudent);
}

async function loadCards() {
  try {
    const res = await fetch("./cards.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`cards.json not found (HTTP ${res.status})`);
    const json = await res.json();
    cards = (json.cards || []).map(c => ({ ...c, unit: Number(c.unit) }));
  } catch (err) {
    console.error(err);
    alert("Could not load cards.json. Check that cards.json exists in the repo root and is committed.");
    cards = [];
  }
}

function showView(which) {
  el("startView")?.classList.toggle("hidden", which !== "start");
  el("studyView")?.classList.toggle("hidden", which !== "study");
  el("teacherView")?.classList.toggle("hidden", which !== "teacher");
}

function buildUnitCheckboxes() {
  const grid = el("unitGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let u = 1; u <= 7; u++) {
    const chip = document.createElement("label");
    chip.className = "unitChip";
    chip.innerHTML = `<input type="checkbox" value="${u}" checked> Unit ${u}`;
    grid.appendChild(chip);
  }
}

// Global functions used by inline onclick in HTML
window.start = function start() {
  const name = el("studentName")?.value?.trim();
  if (!name) return;

  currentStudent = name;
  ensureStudent(currentStudent);

  // collect selected units
  const checks = Array.from(el("unitGrid")?.querySelectorAll('input[type="checkbox"]') || []);
  selectedUnits = new Set(checks.filter(c => c.checked).map(c => Number(c.value)));

  if (selectedUnits.size === 0) return alert("Please select at least one unit.");

  const shuffle = !!el("shuffleToggle")?.checked;
  const onlyNeeds = !!el("onlyNeedsToggle")?.checked;

  queue = buildQueue({ shuffle, onlyNeeds });
  idx = 0;

  showView("study");
  renderCard();
};

window.goToStart = function goToStart() {
  showView("start");
  resetStudyUI();
};

function buildQueue({ shuffle, onlyNeeds }) {
  let list = [...cards];

  // filter by selected units
  list = list.filter(c => selectedUnits.has(Number(c.unit)));

  // onlyNeeds practice filter
  if (onlyNeeds) {
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

function renderCard() {
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");
  const answerBox = el("answerBox");

  if (!queue.length) {
    el("questionImg") && (el("questionImg").src = "");
    el("answerImg") && (el("answerImg").src = "");
    el("studentPill") && (el("studentPill").textContent = `Student: ${currentStudent}`);
    el("unitPill") && (el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`);
    el("progressPill") && (el("progressPill").textContent = "");
    el("cardStats") && (el("cardStats").textContent = "No cards found for these units.");
    revealArea?.classList.add("hidden");
    answerCol?.classList.add("hidden");
    return;
  }

  const c = queue[idx % queue.length];

  el("studentPill") && (el("studentPill").textContent = `Student: ${currentStudent}`);
  el("unitPill") && (el("unitPill").textContent = `Units: ${[...selectedUnits].sort().join(", ")}`);
  el("progressPill") && (el("progressPill").textContent = `Card ${ (idx % queue.length) + 1 } / ${queue.length} (Unit ${c.unit})`);

  const q = el("questionImg");
  const a = el("answerImg");

  if (q) q.src = `./assets/${c.id}Q.png`;
  if (a) a.src = `./assets/${c.id}A.png`;

  // Clear typed answer every new card
  if (answerBox) answerBox.value = "";

  // Hide answer/rating until check
  revealArea?.classList.add("hidden");
  answerCol?.classList.add("hidden");

  const s = progress.students[currentStudent].byCard[c.id] || { got:0, close:0, miss:0, attempts:0, timeMs:0 };
  el("cardStats") && (el("cardStats").textContent =
    `This card — ✓ ${s.got}  ~ ${s.close}  ✗ ${s.miss}  | Attempts: ${s.attempts}  | Time: ${formatMs(s.timeMs)}`
  );

  cardStartTs = Date.now();
}

window.reveal = function reveal() {
  const answerCol = el("answerCol");
  const revealArea = el("revealArea");

  // If these IDs don't exist in the live HTML, you'll get a clear message.
  if (!answerCol || !revealArea) {
    alert('Check failed: missing "answerCol" or "revealArea" in index.html. Replace index.html with the full version I sent.');
    return;
  }

  answerCol.classList.remove("hidden");
  revealArea.classList.remove("hidden");
};

window.advance = function advance(mode) {
  if (!queue.length) return;

  const c = queue[idx % queue.length];
  const stu = progress.students[currentStudent];

  const now = Date.now();
  const dt = (cardStartTs ? Math.max(0, now - cardStartTs) : 0);

  if (!stu.byCard[c.id]) stu.byCard[c.id] = { got:0, close:0, miss:0, attempts:0, timeMs:0 };

  // attempts/time always count when they leave the card
  stu.byCard[c.id].attempts += 1;
  stu.byCard[c.id].timeMs += dt;

  // rating counts only if got/close/miss
  if (mode === "got" || mode === "close" || mode === "miss") {
    stu.totals[mode] += 1;
    stu.byCard[c.id][mode] += 1;
  }

  saveProgress(progress);

  idx++;
  renderCard();
};

function resetStudyUI() {
  el("answerBox") && (el("answerBox").value = "");
  el("revealArea")?.classList.add("hidden");
  el("answerCol")?.classList.add("hidden");
  cardStartTs = null;
}

/* ---------- Progress storage ---------- */
function ensureStudent(name) {
  if (!progress.students[name]) {
    progress.students[name] = {
      totals: { got:0, close:0, miss:0 },
      byCard: {}
    };
    saveProgress(progress);
  }
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { students:{} };
  } catch {
    return { students:{} };
  }
}

function saveProgress(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/* ---------- Teacher dashboard ---------- */
function renderTeacher() {
  const sel = el("studentSelect");
  if (!sel) return;
  sel.innerHTML = "";

  const students = Object.keys(progress.students).sort((a,b)=>a.localeCompare(b));
  if (!students.length) {
    sel.appendChild(new Option("No students yet", ""));
    el("teacherTable") && (el("teacherTable").innerHTML = "");
    return;
  }

  students.forEach(s => sel.appendChild(new Option(s, s)));
  sel.value = students[0];
  renderTeacherTableForSelectedStudent();
}

function renderTeacherTableForSelectedStudent() {
  const student = el("studentSelect")?.value;
  const body = el("teacherTable");
  if (!body) return;
  body.innerHTML = "";

  if (!student || !progress.students[student]) return;

  const byCard = progress.students[student].byCard || {};
  const sortedCards = [...cards].sort((a,b)=>{
    if (a.unit !== b.unit) return a.unit - b.unit;
    return a.id.localeCompare(b.id, undefined, { numeric:true });
  });

  for (const c of sortedCards) {
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
function exportJSON() {
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

function importJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      if (!obj || typeof obj !== "object" || !obj.students) throw new Error("Invalid file.");
      progress = obj;
      saveProgress(progress);
      renderTeacher();
      alert("Imported!");
    } catch (err) {
      alert("Import failed: " + err.message);
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm("Reset all progress on this device?")) return;
  progress = { students:{} };
  saveProgress(progress);
  renderTeacher();
}

/* ---------- Helpers ---------- */
function fisherYates(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatMs(ms) {
  ms = Number(ms) || 0;
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

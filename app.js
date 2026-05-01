/* ───────────────────────────────────────────────────────────────
   Downtime Tracker — Bin Transfer Productivity
   Break-adjusted gap detection for warehouse bin transfers.
   ─────────────────────────────────────────────────────────────── */

// DOM refs
const fileInput       = document.getElementById("fileInput");
const uploadBox       = document.getElementById("uploadBox");
const uploadLabel     = document.getElementById("uploadLabel");
const processBtn      = document.getElementById("processBtn");
const pasteBtn        = document.getElementById("pasteBtn");
const demoBtn         = document.getElementById("demoBtn");
const clearBtn        = document.getElementById("clearBtn");
const thresholdInput  = document.getElementById("threshold");
const rawText         = document.getElementById("rawText");
const statusBanner    = document.getElementById("statusBanner");
const summaryCards    = document.getElementById("summaryCards");
const summaryBody     = document.querySelector("#summaryTable tbody");
const detailsBody     = document.querySelector("#detailsTable tbody");
const resultsSection  = document.getElementById("resultsSection");
const detailsSection  = document.getElementById("detailsSection");
const exportSummaryBtn = document.getElementById("exportSummaryBtn");
const exportDetailsBtn = document.getElementById("exportDetailsBtn");

let latestSummary = [];
let latestDetails = [];

/* ── Break schedule (minutes from midnight) ── */
const BREAKS = [
  { start: 8 * 60,       end: 8 * 60 + 15,  label: "Break 1" },   // 8:00-8:15
  { start: 10 * 60,      end: 10 * 60 + 15,  label: "Break 2" },   // 10:00-10:15
  { start: 12 * 60,      end: 12 * 60 + 30,  label: "Lunch" },     // 12:00-12:30
];

/* ── Helpers ── */
function esc(text) {
  return String(text ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function showStatus(msg, type = "info") {
  statusBanner.textContent = msg;
  statusBanner.className = `status-banner ${type}`;
  statusBanner.classList.remove("hidden");
}

function hideStatus() {
  statusBanner.classList.add("hidden");
}

function parseTimeToMinutes(text) {
  // Match HH:MM:SS or HH:MM, with optional AM/PM
  const m = String(text).match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?\b/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[4] ? m[4].toUpperCase() : null;

  if (ampm === "AM" && h === 12) h = 0;
  if (ampm === "PM" && h !== 12) h += 12;

  return h * 60 + min;
}

function minutesToDisplay(mins) {
  const h24 = Math.floor(mins / 60);
  const m   = mins % 60;
  const suf = h24 >= 12 ? "PM" : "AM";
  let h12   = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2,"0")} ${suf}`;
}

function formatGap(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function overlapWithBreaks(startMin, endMin) {
  let total = 0;
  for (const brk of BREAKS) {
    const os = Math.max(startMin, brk.start);
    const oe = Math.min(endMin, brk.end);
    if (os < oe) total += (oe - os);
  }
  return total;
}

/* ── Parsing ──
   Supports:
   1. CSV from SSRS (header row with Employee,…,XferTime,…)
   2. Tab-separated table copy-paste
   3. Simple "Name HH:MM:SS" per line
*/
function extractRecords(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // ── Attempt CSV parse ──
  const header = lines[0];
  const isCSV = /Employee/i.test(header) && /XferTime/i.test(header);

  if (isCSV) {
    return parseCSV(lines);
  }

  // ── Attempt tab-separated table ──
  if (header.includes("\t") && /Employee/i.test(header)) {
    return parseTSV(lines);
  }

  // ── Fall back to simple name+time format ──
  return parseSimple(lines);
}

function parseCSV(lines) {
  // Very lightweight CSV parse (no quoted commas in this data)
  const headers = lines[0].split(",").map(h => h.trim());
  const empIdx  = headers.findIndex(h => /^Employee$/i.test(h));
  const timeIdx = headers.findIndex(h => /^XferTime$/i.test(h));

  if (empIdx < 0 || timeIdx < 0) return [];

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const emp  = (cols[empIdx] || "").trim();
    const time = (cols[timeIdx] || "").trim();
    const mins = parseTimeToMinutes(time);
    if (emp && mins !== null) {
      records.push({ driver: emp, minutes: mins });
    }
  }
  return records;
}

function parseTSV(lines) {
  const headers = lines[0].split("\t").map(h => h.trim());
  const empIdx  = headers.findIndex(h => /Employee/i.test(h));
  const timeIdx = headers.findIndex(h => /Xfer\s*Time/i.test(h));
  if (empIdx < 0 || timeIdx < 0) return [];

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const emp  = (cols[empIdx] || "").trim();
    const time = (cols[timeIdx] || "").trim();
    const mins = parseTimeToMinutes(time);
    if (emp && mins !== null) {
      records.push({ driver: emp, minutes: mins });
    }
  }
  return records;
}

function parseSimple(lines) {
  const records = [];
  let carry = "";
  const timeRe = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\b/gi;

  for (const line of lines) {
    const matches = [...line.matchAll(timeRe)].map(m => m[0]);
    if (!matches.length) {
      const n = line.replace(/\s+/g," ").trim();
      if (/^[A-Za-z]/.test(n) && n.length <= 50 && !/\d/.test(n)) carry = n;
      continue;
    }
    const first = matches[0];
    const mins  = parseTimeToMinutes(first);
    if (mins === null) continue;

    let name = line.slice(0, line.indexOf(first)).replace(/\s+/g," ").trim();
    if (!name) name = carry;
    if (!name) continue;
    carry = name;
    records.push({ driver: name, minutes: mins });
  }
  return records;
}

/* ── Analysis ── */
function computeDowntime(records, threshold) {
  const grouped = {};
  for (const r of records) {
    const d = r.driver;
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(r.minutes);
  }

  const summary = [];
  const details = [];

  for (const [driver, times] of Object.entries(grouped)) {
    times.sort((a, b) => a - b);

    let downtimeGaps = 0, rawDowntime = 0, totalBreakDeducted = 0, longestAdj = 0;

    for (let i = 0; i < times.length - 1; i++) {
      const rawGap    = times[i + 1] - times[i];
      const breakOvlp = overlapWithBreaks(times[i], times[i + 1]);
      const adjGap    = rawGap - breakOvlp;
      const isDT      = adjGap > threshold;

      if (isDT) {
        downtimeGaps++;
        rawDowntime += rawGap;
        totalBreakDeducted += breakOvlp;
        if (adjGap > longestAdj) longestAdj = adjGap;
      }

      details.push({
        driver,
        from: minutesToDisplay(times[i]),
        to: minutesToDisplay(times[i + 1]),
        rawGap,
        breakDeducted: breakOvlp,
        adjGap,
        rawGapDisplay: formatGap(rawGap),
        adjGapDisplay: formatGap(adjGap),
        breakDisplay: breakOvlp > 0 ? `−${breakOvlp}m` : "—",
        isDT,
      });
    }

    const adjustedDowntime = rawDowntime - totalBreakDeducted;

    summary.push({
      driver,
      totalMoves: times.length,
      downtimeGaps,
      rawDowntime,
      rawDowntimeDisplay: formatGap(rawDowntime),
      breakDeducted: totalBreakDeducted,
      breakDeductedDisplay: totalBreakDeducted > 0 ? formatGap(totalBreakDeducted) : "—",
      adjustedDowntime,
      adjustedDowntimeDisplay: formatGap(adjustedDowntime),
      longestAdj,
      longestAdjDisplay: formatGap(longestAdj),
    });
  }

  summary.sort((a, b) => b.adjustedDowntime - a.adjustedDowntime || a.driver.localeCompare(b.driver));
  details.sort((a, b) => b.adjGap - a.adjGap || a.driver.localeCompare(b.driver));
  return { summary, details };
}

/* ── Rendering ── */
function renderCards(summary) {
  const drivers   = summary.length;
  const moves     = summary.reduce((s, r) => s + r.totalMoves, 0);
  const gaps      = summary.reduce((s, r) => s + r.downtimeGaps, 0);
  const adjMins   = summary.reduce((s, r) => s + r.adjustedDowntime, 0);
  const withDT    = summary.filter(r => r.downtimeGaps > 0).length;

  summaryCards.innerHTML = `
    <div class="summary-card">
      <div class="label">Employees</div>
      <div class="value">${drivers}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Moves</div>
      <div class="value">${moves}</div>
    </div>
    <div class="summary-card ${gaps > 0 ? "warn" : ""}">
      <div class="label">Downtime Gaps</div>
      <div class="value">${gaps}</div>
    </div>
    <div class="summary-card ${adjMins > 60 ? "danger" : adjMins > 0 ? "warn" : ""}">
      <div class="label">Total Adj. Downtime</div>
      <div class="value">${formatGap(adjMins)}</div>
    </div>`;
}

function renderTables(summary, details, threshold) {
  summaryBody.innerHTML = summary.map(r => `
    <tr class="${r.downtimeGaps > 0 ? "has-downtime" : ""}">
      <td>${esc(r.driver)}</td>
      <td>${r.totalMoves}</td>
      <td>${r.downtimeGaps || "—"}</td>
      <td>${esc(r.rawDowntimeDisplay)}</td>
      <td>${esc(r.breakDeductedDisplay)}</td>
      <td>${esc(r.adjustedDowntimeDisplay)}</td>
      <td>${esc(r.longestAdjDisplay)}</td>
    </tr>`).join("");

  detailsBody.innerHTML = details.map(r => `
    <tr class="${r.isDT ? "downtime-row" : ""}">
      <td>${esc(r.driver)}</td>
      <td>${esc(r.from)}</td>
      <td>${esc(r.to)}</td>
      <td>${esc(r.rawGapDisplay)}</td>
      <td>${esc(r.breakDisplay)}</td>
      <td>${esc(r.adjGapDisplay)}</td>
      <td><span class="badge ${r.isDT ? "badge-yes" : "badge-no"}">${r.isDT ? "YES" : "NO"}</span></td>
    </tr>`).join("");
}

/* ── CSV Export ── */
function downloadCSV(filename, rows) {
  if (!rows.length) { showStatus("Nothing to export yet.", "error"); return; }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g,'""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── File reading ── */
async function readFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return await file.text();
  }
  if (name.endsWith(".docx")) {
    if (typeof mammoth === "undefined") throw new Error("DOCX library not loaded.");
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    return res.value || "";
  }
  throw new Error("Unsupported file type. Use CSV, TXT, or DOCX.");
}

/* ── Main process ── */
async function processInput() {
  hideStatus();

  let text = rawText.value.trim();
  if (!text && fileInput.files.length) {
    try {
      text = await readFile(fileInput.files[0]);
      rawText.value = text;
    } catch (e) {
      showStatus(e.message, "error");
      return;
    }
  }
  if (!text) {
    showStatus("Paste report text or upload a file first.", "error");
    return;
  }

  const records = extractRecords(text);
  if (!records.length) {
    resultsSection.style.display = "none";
    detailsSection.style.display = "none";
    showStatus("No employee/time records found. Check the data format.", "error");
    return;
  }

  const threshold = Number(thresholdInput.value) || 25;
  const { summary, details } = computeDowntime(records, threshold);

  latestSummary = summary;
  latestDetails = details;

  renderCards(summary);
  renderTables(summary, details, threshold);

  resultsSection.style.display = "";
  detailsSection.style.display = "";

  const downtimeDrivers = summary.filter(s => s.downtimeGaps > 0).length;
  const totalGaps       = summary.reduce((s, r) => s + r.downtimeGaps, 0);

  if (totalGaps > 0) {
    showStatus(
      `✅ Analyzed ${records.length} records across ${summary.length} employees. Found ${totalGaps} downtime gaps (${downtimeDrivers} employees). Break time automatically deducted.`,
      "success"
    );
  } else {
    showStatus(
      `✅ Analyzed ${records.length} records across ${summary.length} employees. No downtime gaps detected!`,
      "success"
    );
  }
}

/* ── Demo data ── */
function loadDemo() {
  rawText.value = `Employee,ItemXferd,XferQty,FROMBIN,TOBIN,BinPriority,XferTime,TotalLinesXfers,HoursWorked,XferdPerHour,XferDate,Warehouse
Brandon Evanshine,101051,120,E-17-4,I-17-2,1,08:32:36,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,607341,18,E-38-3,B-33-1,1,08:44:55,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,607341,14,B-33-1,B-40-3,3,08:47:35,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,101063,5,E-53-3,G-33-2,1,09:05:15,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,101063,15,E-53-3,G-29-4,12,09:05:49,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,103312,2,E-60-1,E-53-3,3,09:06:53,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,353081,5,E-02-4,E-05-2,1,09:10:39,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,353081,17,E-02-4,E-05-2,1,09:12:34,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,163430,20,E-52-5,E-10-1,1,09:48:52,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,166011,42,F-04-4,E-11-1,1,09:55:39,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,479345,37,H-24-6,E-13-2,1,10:02:08,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,406015,290,E-24-4,E-14-1,1,10:04:10,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,163189,20,E-22-6,E-15-1,1,10:08:44,22,3,7.33,5/1/2026,OH01
Brandon Evanshine,353082,15,F-18-4,E-28-2,1,10:47:03,22,3,7.33,5/1/2026,OH01
Henry Chapman,401157,48,E-47-4,C-03-2,1,06:34:56,16,4,4.00,5/1/2026,OH01
Henry Chapman,352011,5,C-14-4,C-14-1,1,06:47:57,16,4,4.00,5/1/2026,OH01
Henry Chapman,607305,52,C-20-4,C-20-1,1,08:30:25,16,4,4.00,5/1/2026,OH01
Henry Chapman,607516,20,C-47-5,C-31-2,1,08:36:40,16,4,4.00,5/1/2026,OH01
Henry Chapman,305012,10,D-14-6,C-32-2,1,08:42:16,16,4,4.00,5/1/2026,OH01
Henry Chapman,606753,10,C-54-6,C-44-1,1,09:14:13,16,4,4.00,5/1/2026,OH01
Henry Chapman,604262,10,C-07-4,C-45-2,1,09:38:02,16,4,4.00,5/1/2026,OH01
Henry Chapman,304031,6,D-17-4,C-49-2,1,10:34:31,16,4,4.00,5/1/2026,OH01
Yussif Adam Keitu,463011,20,A-52-6,A-04-1,1,06:20:05,25,5,5.00,5/1/2026,OH01
Yussif Adam Keitu,465026,5,A-14-4,A-12-1,1,06:26:46,25,5,5.00,5/1/2026,OH01
Yussif Adam Keitu,462023,4,A-22-5,A-16-2,1,06:52:59,25,5,5.00,5/1/2026,OH01
Yussif Adam Keitu,462036,2,A-20-5,A-17-1,1,07:00:52,25,5,5.00,5/1/2026,OH01
Yussif Adam Keitu,461013,20,A-18-4,A-18-2,1,07:03:19,25,5,5.00,5/1/2026,OH01
Yussif Adam Keitu,461012,5,A-22-6,A-19-1,1,07:04:43,25,5,5.00,5/1/2026,OH01
Kristopher Mintier,107068,10,RB-41-3,RB-06-2,1,06:31:45,21,4,5.25,5/1/2026,OH01
Kristopher Mintier,107072,31,RB-41-3,RB-11-2,1,06:38:08,21,4,5.25,5/1/2026,OH01
Kristopher Mintier,107265,19,RB-41-3,RB-15-1,1,06:40:51,21,4,5.25,5/1/2026,OH01
Kristopher Mintier,107293,5,RB-41-3,RB-39-4,1,06:42:45,21,4,5.25,5/1/2026,OH01
Kristopher Mintier,107265,27,RB-41-3,RB-38-2,1,06:44:59,21,4,5.25,5/1/2026,OH01
Kristopher Mintier,163122,50,RB-41-3,RB-33-4,1,07:44:08,21,4,5.25,5/1/2026,OH01`;
  processInput();
}

function clearAll() {
  fileInput.value = "";
  rawText.value = "";
  uploadLabel.textContent = "📁 Click or drag file here";
  latestSummary = [];
  latestDetails = [];
  summaryCards.innerHTML = "";
  summaryBody.innerHTML = "";
  detailsBody.innerHTML = "";
  resultsSection.style.display = "none";
  detailsSection.style.display = "none";
  hideStatus();
}

/* ── Event listeners ── */
processBtn.addEventListener("click", processInput);
demoBtn.addEventListener("click", loadDemo);
clearBtn.addEventListener("click", clearAll);
exportSummaryBtn.addEventListener("click", () => downloadCSV("downtime_summary.csv", latestSummary));
exportDetailsBtn.addEventListener("click", () => downloadCSV("downtime_details.csv", latestDetails));

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      rawText.value = text;
      showStatus("Pasted from clipboard. Click Analyze to process.", "info");
    }
  } catch {
    showStatus("Clipboard access denied. Paste manually into the text area.", "error");
  }
});

// Upload box interaction
uploadBox.addEventListener("click", () => fileInput.click());
uploadBox.addEventListener("dragover", e => { e.preventDefault(); uploadBox.classList.add("dragover"); });
uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("dragover"));
uploadBox.addEventListener("drop", e => {
  e.preventDefault();
  uploadBox.classList.remove("dragover");
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    uploadLabel.textContent = `✅ ${e.dataTransfer.files[0].name}`;
  }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) {
    uploadLabel.textContent = `✅ ${fileInput.files[0].name}`;
  }
});

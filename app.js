const fileInput = document.getElementById("fileInput");
const processBtn = document.getElementById("processBtn");
const demoBtn = document.getElementById("demoBtn");
const clearBtn = document.getElementById("clearBtn");
const thresholdInput = document.getElementById("threshold");
const rawText = document.getElementById("rawText");
const statusEl = document.getElementById("status");
const summaryCards = document.getElementById("summaryCards");
const summaryTableBody = document.querySelector("#summaryTable tbody");
const detailsTableBody = document.querySelector("#detailsTable tbody");
const exportSummaryBtn = document.getElementById("exportSummaryBtn");
const exportDetailsBtn = document.getElementById("exportDetailsBtn");

let latestSummary = [];
let latestDetails = [];

function setStatus(message) {
  statusEl.textContent = message || "";
}

function normalizeName(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseTimeToMinutes(timeText) {
  const match = String(timeText).match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?\b/i);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[4] ? match[4].toUpperCase() : null;

  if (ampm) {
    if (ampm === "AM" && hour === 12) hour = 0;
    if (ampm === "PM" && hour !== 12) hour += 12;
  }

  return hour * 60 + minute;
}

function minutesToDisplay(mins) {
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatGap(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function extractRecordsFromText(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const records = [];
  let carryDriver = "";

  const timeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\b/gi;

  for (const line of lines) {
    const timeMatches = [...line.matchAll(timeRegex)].map(m => m[0]);

    if (!timeMatches.length) {
      const maybeName = normalizeName(line);
      if (/[A-Za-z]/.test(maybeName) && maybeName.length <= 50 && !/\d/.test(maybeName)) {
        carryDriver = maybeName;
      }
      continue;
    }

    const firstTime = timeMatches[0];
    const minutes = parseTimeToMinutes(firstTime);
    if (minutes === null) continue;

    let beforeTime = line.slice(0, line.indexOf(firstTime)).trim();
    let driver = normalizeName(beforeTime);

    if (!driver) {
      const lineWithoutTime = normalizeName(line.replace(firstTime, " "));
      const nameMatch = lineWithoutTime.match(/^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})/);
      if (nameMatch) driver = normalizeName(nameMatch[1]);
    }

    if (!driver) driver = carryDriver;
    if (!driver) continue;

    carryDriver = driver;

    records.push({
      driver,
      timeText: firstTime,
      minutes
    });
  }

  return records;
}

function computeDowntime(records, threshold) {
  const grouped = {};

  for (const record of records) {
    const driver = normalizeName(record.driver);
    if (!grouped[driver]) grouped[driver] = [];
    grouped[driver].push(record.minutes);
  }

  const summary = [];
  const details = [];

  for (const [driver, times] of Object.entries(grouped)) {
    times.sort((a, b) => a - b);

    let downtimeGaps = 0;
    let totalDowntime = 0;
    let longestGap = 0;

    for (let i = 0; i < times.length - 1; i++) {
      const gap = times[i + 1] - times[i];
      const isDowntime = gap > threshold;

      if (isDowntime) {
        downtimeGaps += 1;
        totalDowntime += gap;
        if (gap > longestGap) longestGap = gap;
      }

      details.push({
        driver,
        from: minutesToDisplay(times[i]),
        to: minutesToDisplay(times[i + 1]),
        gap,
        gapDisplay: formatGap(gap),
        downtime: isDowntime ? "YES" : "NO"
      });
    }

    summary.push({
      driver,
      totalMoves: times.length,
      downtimeGaps,
      totalDowntime,
      totalDowntimeDisplay: formatGap(totalDowntime),
      longestGap,
      longestGapDisplay: formatGap(longestGap)
    });
  }

  summary.sort((a, b) => b.totalDowntime - a.totalDowntime || a.driver.localeCompare(b.driver));
  details.sort((a, b) => b.gap - a.gap || a.driver.localeCompare(b.driver));

  return { summary, details };
}

function renderCards(summary) {
  const totalDrivers = summary.length;
  const totalMoves = summary.reduce((sum, row) => sum + row.totalMoves, 0);
  const totalDowntimeGaps = summary.reduce((sum, row) => sum + row.downtimeGaps, 0);
  const totalDowntimeMinutes = summary.reduce((sum, row) => sum + row.totalDowntime, 0);

  summaryCards.innerHTML = `
    <div class="summary-card">
      <div class="label">Drivers</div>
      <div class="value">${totalDrivers}</div>
    </div>
    <div class="summary-card">
      <div class="label">Moves Found</div>
      <div class="value">${totalMoves}</div>
    </div>
    <div class="summary-card">
      <div class="label">Downtime Gaps</div>
      <div class="value">${totalDowntimeGaps}</div>
    </div>
    <div class="summary-card">
      <div class="label">Downtime Minutes</div>
      <div class="value">${totalDowntimeMinutes}</div>
    </div>
  `;
}

function renderTables(summary, details, threshold) {
  summaryTableBody.innerHTML = summary.map(row => `
    <tr>
      <td>${escapeHtml(row.driver)}</td>
      <td>${row.totalMoves}</td>
      <td>${row.downtimeGaps}</td>
      <td>${escapeHtml(row.totalDowntimeDisplay)}</td>
      <td>${escapeHtml(row.longestGapDisplay)}</td>
    </tr>
  `).join("");

  detailsTableBody.innerHTML = details.map(row => `
    <tr ${row.gap > threshold ? 'class="downtime-row"' : ""}>
      <td>${escapeHtml(row.driver)}</td>
      <td>${escapeHtml(row.from)}</td>
      <td>${escapeHtml(row.to)}</td>
      <td>${escapeHtml(row.gapDisplay)}</td>
      <td><span class="${row.downtime === "YES" ? "badge-yes" : "badge-no"}">${row.downtime}</span></td>
    </tr>
  `).join("");
}

function downloadCSV(filename, rows) {
  if (!rows.length) {
    setStatus("Nothing to export yet.");
    return;
  }

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(header => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")
    )
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function readTxtFile(file) {
  return await file.text();
}

async function readDocxFile(file) {
  if (typeof mammoth === "undefined") {
    throw new Error("Mammoth library did not load.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

async function loadUploadedFile() {
  const file = fileInput.files[0];
  if (!file) return null;

  const name = file.name.toLowerCase();

  if (name.endsWith(".txt")) {
    return await readTxtFile(file);
  }

  if (name.endsWith(".docx")) {
    return await readDocxFile(file);
  }

  throw new Error("Unsupported file type. Use TXT or DOCX.");
}

async function processInput() {
  try {
    setStatus("Reading input...");

    let text = rawText.value.trim();

    if (!text && fileInput.files.length) {
      text = await loadUploadedFile();
      rawText.value = text;
    }

    if (!text) {
      setStatus("Paste text or upload a TXT / DOCX file first.");
      return;
    }

    const records = extractRecordsFromText(text);

    if (!records.length) {
      latestSummary = [];
      latestDetails = [];
      renderCards([]);
      renderTables([], [], Number(thresholdInput.value) || 25);
      setStatus("No usable driver/time records found.");
      return;
    }

    const threshold = Number(thresholdInput.value) || 25;
    const { summary, details } = computeDowntime(records, threshold);

    latestSummary = summary;
    latestDetails = details;

    renderCards(summary);
    renderTables(summary, details, threshold);
    setStatus(`Done. Found ${records.length} time records across ${summary.length} drivers.`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  }
}

function loadDemo() {
  const demoText = `
Brandon Evanshine 7:30 AM
Brandon Evanshine 7:48 AM
Brandon Evanshine 8:20 AM
Brandon Evanshine 8:31 AM
Henry Chapman 7:35 AM
Henry Chapman 7:55 AM
Henry Chapman 8:10 AM
Henry Chapman 8:50 AM
Kris Mintier 7:32 AM
Kris Mintier 8:05 AM
Kris Mintier 9:10 AM
Yussif Adam 7:40 AM
Yussif Adam 7:58 AM
Yussif Adam 8:15 AM
Yussif Adam 9:05 AM
  `.trim();

  rawText.value = demoText;
  processInput();
}

function clearAll() {
  fileInput.value = "";
  rawText.value = "";
  latestSummary = [];
  latestDetails = [];
  summaryCards.innerHTML = "";
  summaryTableBody.innerHTML = "";
  detailsTableBody.innerHTML = "";
  setStatus("Cleared.");
}

processBtn.addEventListener("click", processInput);
demoBtn.addEventListener("click", loadDemo);
clearBtn.addEventListener("click", clearAll);
exportSummaryBtn.addEventListener("click", () => downloadCSV("downtime_summary.csv", latestSummary));
exportDetailsBtn.addEventListener("click", () => downloadCSV("downtime_details.csv", latestDetails));

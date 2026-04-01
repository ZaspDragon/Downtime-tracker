// app.js
// Make sure index.html loads PDF.js BEFORE this file:
//
// <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js"></script>
// <script>
//   pdfjsLib.GlobalWorkerOptions.workerSrc =
//     "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";
// </script>
// <script src="app.js"></script>

document.addEventListener("DOMContentLoaded", () => {
  // ---------- PDF.js safety check ----------
  if (typeof window.pdfjsLib === "undefined") {
    console.error("PDF.js failed to load. pdfjsLib is undefined.");
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.textContent =
        "PDF library failed to load. Check your index.html script order.";
    }
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js";

  // ---------- Elements ----------
  const pdfFile = document.getElementById("pdfFile");
  const processBtn = document.getElementById("processBtn");
  const sampleBtn = document.getElementById("sampleBtn");
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

  // ---------- Helpers ----------
  function setStatus(message) {
    if (statusEl) statusEl.textContent = message || "";
  }

  function normalizeName(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseTimeToMinutes(t) {
    const m = String(t).match(/\b(\d{1,2}):(\d{2})(?:\s*([AP]M))?\b/i);
    if (!m) return null;

    let hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    const ampm = m[3] ? m[3].toUpperCase() : null;

    if (ampm) {
      if (ampm === "AM" && hour === 12) hour = 0;
      if (ampm === "PM" && hour !== 12) hour += 12;
    }

    return hour * 60 + minute;
  }

  function minutesToDisplay(mins) {
    const h24 = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h24 >= 12 ? "PM" : "AM";
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  }

  function formatGapMinutes(totalMinutes) {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  // ---------- Parsing ----------
  // This parser is designed to work with:
  // 1) freeform raw text with "Driver 8:05 AM"
  // 2) extracted table text from your productivity PDF where time appears as HH:MM:SS
  function extractRecordsFromLine(line, carryDriver = "") {
    const cleanLine = normalizeName(line);
    if (!cleanLine) return [];

    // Find all time values (HH:MM or HH:MM:SS, optionally with AM/PM)
    const timeMatches = [
      ...cleanLine.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\b/gi),
    ].map((m) => m[0]);

    if (!timeMatches.length) return [];

    // Use first time for row parsing
    const timeText = timeMatches[0];
    const hhmmOnly = timeText.slice(0, 5);
    const timeMinutes = parseTimeToMinutes(hhmmOnly);
    if (timeMinutes === null) return [];

    // Remove the time and obvious report junk
    let candidate = cleanLine
      .replace(timeText, " ")
      .replace(/\b(Bin Transfer Productivity Details|Employee|Item|Xferd|FROMBIN|TOBIN|Bin|Priority|Total|Lines|Hours|Worked|Per|Hour|Date|Whse|Qty|OH01|NEW|REC-FLOOR|BACK)\b/gi, " ")
      .replace(/[|,;:_]+/g, " ");

    // Try to get the employee name from the front of the row.
    // Most PDF rows look like:
    // Brandon Evanshine 163200 60 H-04-1 H-09-5 2 13:44:35 ...
    let driver = "";

    const nameMatch = candidate.match(/^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})\b/);
    if (nameMatch) {
      driver = normalizeName(nameMatch[1]);
    }

    // If line is weird, keep prior driver when possible
    if (!driver || /\d/.test(driver)) {
      driver = carryDriver;
    }

    // Reject obvious garbage rows
    if (!driver || driver.length < 2) return [];
    if (/^(today|yesterday|last week|downloads?)$/i.test(driver)) return [];

    return [
      {
        driver,
        timeText: hhmmOnly,
        minutes: timeMinutes,
      },
    ];
  }

  function parseRawTextToRecords(text) {
    const lines = String(text)
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

    const records = [];
    let carryDriver = "";

    for (const line of lines) {
      const items = extractRecordsFromLine(line, carryDriver);

      if (items.length) {
        carryDriver = items[0].driver;
        records.push(...items);
        continue;
      }

      const maybeName = normalizeName(line.replace(/[|,;:_-]+/g, " "));
      if (
        /[A-Za-z]/.test(maybeName) &&
        maybeName.length <= 40 &&
        !/\d{1,2}:\d{2}/.test(maybeName)
      ) {
        carryDriver = maybeName;
      }
    }

    return records;
  }

  function computeDowntime(records, threshold) {
    const byDriver = {};

    for (const record of records) {
      const driver = normalizeName(record.driver);
      if (!byDriver[driver]) byDriver[driver] = [];
      byDriver[driver].push(record.minutes);
    }

    const details = [];
    const summary = [];

    for (const [driver, times] of Object.entries(byDriver)) {
      times.sort((a, b) => a - b);

      let downtimeCount = 0;
      let downtimeMinutes = 0;
      let longestGap = 0;

      for (let i = 0; i < times.length - 1; i++) {
        const gap = times[i + 1] - times[i];
        const isDown = gap > threshold;

        if (isDown) {
          downtimeCount += 1;
          downtimeMinutes += gap;
          longestGap = Math.max(longestGap, gap);
        }

        details.push({
          driver,
          from: minutesToDisplay(times[i]),
          to: minutesToDisplay(times[i + 1]),
          gap,
          gapDisplay: formatGapMinutes(gap),
          downtime: isDown ? "YES" : "NO",
        });
      }

      summary.push({
        driver,
        totalMoves: times.length,
        downtimeGaps: downtimeCount,
        totalDowntime: downtimeMinutes,
        totalDowntimeDisplay: formatGapMinutes(downtimeMinutes),
        longestGap,
        longestGapDisplay: formatGapMinutes(longestGap),
      });
    }

    summary.sort(
      (a, b) => b.totalDowntime - a.totalDowntime || a.driver.localeCompare(b.driver)
    );
    details.sort((a, b) => b.gap - a.gap || a.driver.localeCompare(b.driver));

    return { summary, details };
  }

  // ---------- Rendering ----------
  function renderCards(summary) {
    const totalDrivers = summary.length;
    const totalMoves = summary.reduce((n, x) => n + x.totalMoves, 0);
    const totalDowntimeGaps = summary.reduce((n, x) => n + x.downtimeGaps, 0);
    const totalDowntimeMinutes = summary.reduce((n, x) => n + x.totalDowntime, 0);

    if (!summaryCards) return;

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
    if (summaryTableBody) {
      summaryTableBody.innerHTML = summary
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.driver)}</td>
            <td>${row.totalMoves}</td>
            <td>${row.downtimeGaps}</td>
            <td>${row.totalDowntimeDisplay}</td>
            <td>${row.longestGapDisplay}</td>
          </tr>
        `
        )
        .join("");
    }

    if (detailsTableBody) {
      detailsTableBody.innerHTML = details
        .map(
          (row) => `
          <tr ${row.gap > threshold ? 'class="downtime-row"' : ""}>
            <td>${escapeHtml(row.driver)}</td>
            <td>${escapeHtml(row.from)}</td>
            <td>${escapeHtml(row.to)}</td>
            <td>${escapeHtml(row.gapDisplay)}</td>
            <td>
              <span class="${row.downtime === "YES" ? "badge-yes" : "badge-no"}">
                ${row.downtime}
              </span>
            </td>
          </tr>
        `
        )
        .join("");
    }
  }

  function downloadCSV(filename, rows) {
    if (!rows.length) {
      setStatus("Nothing to export yet.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const csv = [headers.join(",")]
      .concat(
        rows.map((row) =>
          headers
            .map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`)
            .join(",")
        )
      )
      .join("\n");

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

  // ---------- PDF Extraction ----------
  async function extractTextFromPdf(file) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    let text = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // Join each page line-ish enough for parser
      const strings = content.items.map((item) => item.str);
      text += strings.join(" ") + "\n";
    }

    return text;
  }

  async function processPdfFile(file) {
    setStatus("Reading PDF...");

    const text = await extractTextFromPdf(file);
    if (rawText) rawText.value = text;

    const records = parseRawTextToRecords(text);

    if (!records.length) {
      latestSummary = [];
      latestDetails = [];
      renderCards([]);
      renderTables([], [], Number(thresholdInput?.value) || 25);
      setStatus("No driver/time records found. Check extracted text.");
      return;
    }

    const threshold = Number(thresholdInput?.value) || 25;
    const { summary, details } = computeDowntime(records, threshold);

    latestSummary = summary;
    latestDetails = details;

    renderCards(summary);
    renderTables(summary, details, threshold);

    setStatus(
      `Done. Found ${records.length} time records across ${summary.length} drivers.`
    );
  }

  // ---------- Demo / Clear ----------
  function loadDemo() {
    const demoText = `
John Smith 8:05 AM
John Smith 8:21 AM
John Smith 8:58 AM
John Smith 9:14 AM
Mike Ross 8:11 AM
Mike Ross 8:30 AM
Mike Ross 8:44 AM
Mike Ross 9:20 AM
Sara Lee 8:02 AM
Sara Lee 8:24 AM
Sara Lee 8:48 AM
Sara Lee 9:40 AM
    `.trim();

    if (rawText) rawText.value = demoText;

    const records = parseRawTextToRecords(demoText);
    const threshold = Number(thresholdInput?.value) || 25;
    const { summary, details } = computeDowntime(records, threshold);

    latestSummary = summary;
    latestDetails = details;

    renderCards(summary);
    renderTables(summary, details, threshold);
    setStatus("Demo data loaded.");
  }

  function clearAll() {
    if (pdfFile) pdfFile.value = "";
    if (rawText) rawText.value = "";

    latestSummary = [];
    latestDetails = [];

    if (summaryCards) summaryCards.innerHTML = "";
    if (summaryTableBody) summaryTableBody.innerHTML = "";
    if (detailsTableBody) detailsTableBody.innerHTML = "";

    setStatus("Cleared.");
  }

  // ---------- Events ----------
  if (processBtn) {
    processBtn.addEventListener("click", async () => {
      const file = pdfFile?.files?.[0];

      if (!file) {
        setStatus("Choose a PDF first.");
        return;
      }

      try {
        await processPdfFile(file);
      } catch (err) {
        console.error("PDF processing error:", err);
        setStatus("Could not process that PDF. Check console and script order.");
      }
    });
  }

  if (sampleBtn) sampleBtn.addEventListener("click", loadDemo);
  if (clearBtn) clearBtn.addEventListener("click", clearAll);

  if (exportSummaryBtn) {
    exportSummaryBtn.addEventListener("click", () =>
      downloadCSV("downtime_summary.csv", latestSummary)
    );
  }

  if (exportDetailsBtn) {
    exportDetailsBtn.addEventListener("click", () =>
      downloadCSV("downtime_details.csv", latestDetails)
    );
  }

  console.log("App loaded. PDF.js available:", typeof pdfjsLib);
});

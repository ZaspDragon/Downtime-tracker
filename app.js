pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';

const pdfFile = document.getElementById('pdfFile');
const processBtn = document.getElementById('processBtn');
const sampleBtn = document.getElementById('sampleBtn');
const clearBtn = document.getElementById('clearBtn');
const thresholdInput = document.getElementById('threshold');
const rawText = document.getElementById('rawText');
const statusEl = document.getElementById('status');
const summaryCards = document.getElementById('summaryCards');
const summaryTableBody = document.querySelector('#summaryTable tbody');
const detailsTableBody = document.querySelector('#detailsTable tbody');
const exportSummaryBtn = document.getElementById('exportSummaryBtn');
const exportDetailsBtn = document.getElementById('exportDetailsBtn');

let latestSummary = [];
let latestDetails = [];

function setStatus(message) {
  statusEl.textContent = message || '';
}

function normalizeName(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function parseTimeToMinutes(t) {
  const m = t.match(/\b(\d{1,2}):(\d{2})(?:\s*([AP]M))?\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const ampm = m[3] ? m[3].toUpperCase() : null;

  if (ampm) {
    if (ampm === 'AM' && hour === 12) hour = 0;
    if (ampm === 'PM' && hour !== 12) hour += 12;
  }
  return hour * 60 + minute;
}

function minutesToDisplay(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  let hr12 = h % 12;
  if (hr12 === 0) hr12 = 12;
  return `${hr12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function extractDriverAndTimes(line, carryDriver = '') {
  const timeMatches = [...line.matchAll(/\b\d{1,2}:\d{2}(?:\s*[AP]M)?\b/gi)].map(m => m[0]);
  if (!timeMatches.length) return [];

  let candidate = line;
  timeMatches.forEach(t => { candidate = candidate.replace(t, ' '); });
  candidate = candidate.replace(/[|,;:_-]+/g, ' ').replace(/\b(move|moves|qty|count|driver id|employee id|report)\b/gi, ' ');
  candidate = normalizeName(candidate);

  let driver = candidate;
  if (!driver || /^\d+$/.test(driver)) driver = carryDriver;
  if (!driver) return [];

  return timeMatches.map(t => ({ driver, timeText: t, minutes: parseTimeToMinutes(t) })).filter(x => x.minutes !== null);
}

function parseRawTextToRecords(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const records = [];
  let carryDriver = '';

  for (const line of lines) {
    const items = extractDriverAndTimes(line, carryDriver);
    if (items.length) {
      carryDriver = items[0].driver;
      records.push(...items);
      continue;
    }

    const maybeName = normalizeName(line.replace(/[|,;:_-]+/g, ' '));
    if (/[A-Za-z]/.test(maybeName) && maybeName.length <= 40 && !/\d{1,2}:\d{2}/.test(maybeName)) {
      carryDriver = maybeName;
    }
  }

  return records;
}

function computeDowntime(records, threshold) {
  const byDriver = {};
  records.forEach(r => {
    const driver = normalizeName(r.driver);
    if (!byDriver[driver]) byDriver[driver] = [];
    byDriver[driver].push(r.minutes);
  });

  const details = [];
  const summary = [];

  Object.entries(byDriver).forEach(([driver, times]) => {
    times.sort((a, b) => a - b);
    let downtimeCount = 0;
    let downtimeMinutes = 0;
    let longestGap = 0;

    for (let i = 0; i < times.length - 1; i++) {
      const gap = times[i + 1] - times[i];
      const isDown = gap >= threshold;
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
        downtime: isDown ? 'YES' : 'NO'
      });
    }

    summary.push({
      driver,
      totalMoves: times.length,
      downtimeGaps: downtimeCount,
      totalDowntime: downtimeMinutes,
      longestGap
    });
  });

  summary.sort((a, b) => b.totalDowntime - a.totalDowntime || a.driver.localeCompare(b.driver));
  details.sort((a, b) => b.gap - a.gap || a.driver.localeCompare(b.driver));

  return { summary, details };
}

function renderCards(summary, details) {
  const totalDrivers = summary.length;
  const totalMoves = summary.reduce((n, x) => n + x.totalMoves, 0);
  const totalDowntimeGaps = summary.reduce((n, x) => n + x.downtimeGaps, 0);
  const totalDowntimeMinutes = summary.reduce((n, x) => n + x.totalDowntime, 0);

  summaryCards.innerHTML = `
    <div class="summary-card"><div class="label">Drivers</div><div class="value">${totalDrivers}</div></div>
    <div class="summary-card"><div class="label">Moves Found</div><div class="value">${totalMoves}</div></div>
    <div class="summary-card"><div class="label">Downtime Gaps</div><div class="value">${totalDowntimeGaps}</div></div>
    <div class="summary-card"><div class="label">Downtime Minutes</div><div class="value">${totalDowntimeMinutes}</div></div>
  `;
}

function renderTables(summary, details) {
  summaryTableBody.innerHTML = summary.map(row => `
    <tr>
      <td>${row.driver}</td>
      <td>${row.totalMoves}</td>
      <td>${row.downtimeGaps}</td>
      <td>${row.totalDowntime}</td>
      <td>${row.longestGap || 0}</td>
    </tr>
  `).join('');

  detailsTableBody.innerHTML = details.map(row => `
    <tr>
      <td>${row.driver}</td>
      <td>${row.from}</td>
      <td>${row.to}</td>
      <td>${row.gap}</td>
      <td><span class="${row.downtime === 'YES' ? 'badge-yes' : 'badge-no'}">${row.downtime}</span></td>
    </tr>
  `).join('');
}

function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map(row => headers.map(h => `"${String(row[h]).replaceAll('"', '""')}"`).join(',')))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function extractTextFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    text += strings.join(' ') + '\n';
  }
  return text;
}

async function processPdfFile(file) {
  setStatus('Reading PDF...');
  const text = await extractTextFromPdf(file);
  rawText.value = text;

  const records = parseRawTextToRecords(text);
  if (!records.length) {
    setStatus('No driver/time records found. Check the raw extracted text.');
    latestSummary = [];
    latestDetails = [];
    renderCards([], []);
    renderTables([], []);
    return;
  }

  const threshold = Number(thresholdInput.value) || 25;
  const { summary, details } = computeDowntime(records, threshold);
  latestSummary = summary;
  latestDetails = details;
  renderCards(summary, details);
  renderTables(summary, details);
  setStatus(`Done. Found ${records.length} moves across ${summary.length} drivers.`);
}

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

  rawText.value = demoText;
  const records = parseRawTextToRecords(demoText);
  const threshold = Number(thresholdInput.value) || 25;
  const { summary, details } = computeDowntime(records, threshold);
  latestSummary = summary;
  latestDetails = details;
  renderCards(summary, details);
  renderTables(summary, details);
  setStatus('Demo data loaded.');
}

function clearAll() {
  pdfFile.value = '';
  rawText.value = '';
  latestSummary = [];
  latestDetails = [];
  summaryCards.innerHTML = '';
  summaryTableBody.innerHTML = '';
  detailsTableBody.innerHTML = '';
  setStatus('Cleared.');
}

processBtn.addEventListener('click', async () => {
  const file = pdfFile.files[0];
  if (!file) {
    setStatus('Choose a PDF first.');
    return;
  }
  try {
    await processPdfFile(file);
  } catch (err) {
    console.error(err);
    setStatus('Could not process that PDF. Try a cleaner export or check the raw text panel.');
  }
});

sampleBtn.addEventListener('click', loadDemo);
clearBtn.addEventListener('click', clearAll);
exportSummaryBtn.addEventListener('click', () => downloadCSV('downtime_summary.csv', latestSummary));
exportDetailsBtn.addEventListener('click', () => downloadCSV('downtime_details.csv', latestDetails));

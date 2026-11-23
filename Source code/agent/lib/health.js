// How each printer is doing, read from Windows or macOS every minute, so the
// printing page can say "Canon: paper jam" instead of people blaming
// PrintBridge. Also clears out printouts that have been stuck in a printer's
// own queue so long that they would come out hours later, out of nowhere.

const { run, runPowerShell, IS_WINDOWS } = require("./printers");

const STALE_MINUTES = 30; // a printout older than this in the queue is cancelled
const STUCK_MINUTES = 10; // the first printout waiting this long means the printer is stuck

// Windows' own words for a printer's state, in plain English. Low toner is
// left out: it still prints.
const PROBLEMS = [
  [/PaperJam|media-jam/i, "Paper jam"],
  [/PaperOut|NoPaper|media-empty|media-needed/i, "Out of paper"],
  [/PaperProblem|ManualFeed/i, "Paper problem"],
  [/NoToner|OutOfToner|toner-empty|marker-supply-empty/i, "Out of toner or ink"],
  [/DoorOpen|door-open|cover-open/i, "A cover or door is open"],
  [/Offline|NotAvailable|not responding|unable to (connect|locate)|printer is busy/i, "Switched off or not connected"],
  [/Paused/i, "Paused on its computer"],
  [/OutputBinFull/i, "Output tray is full"],
  [/Error|UserIntervention|Blocked/i, "Needs attention"],
];

function describe(states) {
  for (const [pattern, text] of PROBLEMS) if (pattern.test(states)) return text;
  return "";
}

// --- Windows --------------------------------------------------------------

async function windowsHealth() {
  const script = `
$now = Get-Date
$out = foreach ($p in Get-Printer) {
  $jobs = @(Get-PrintJob -PrinterName $p.Name -ErrorAction SilentlyContinue)
  # Only jobs that are stuck, never one that is printing normally (a long job on a slow printer).
  $old = @($jobs | Where-Object { $_.SubmittedTime -lt $now.AddMinutes(-${STALE_MINUTES}) -and -not ("$($_.JobStatus)" -match 'Printing' -and $_.PagesPrinted -gt 0) })
  foreach ($j in $old) { Remove-PrintJob -InputObject $j -ErrorAction SilentlyContinue }
  $left = @($jobs | Where-Object { $old -notcontains $_ })
  $first = $left | Sort-Object SubmittedTime | Select-Object -First 1
  [pscustomobject]@{
    n = $p.Name
    s = "$($p.PrinterStatus)," + (($left | ForEach-Object { "$($_.JobStatus)" }) -join ',')
    w = $left.Count
    m = if ($first) { [int](($now - $first.SubmittedTime).TotalMinutes) } else { 0 }
    r = $old.Count
  }
}
@($out) | ConvertTo-Json -Compress`;
  const r = await runPowerShell(script, { timeout: 60000 });
  if (!r.ok) return null;
  let list;
  try { list = JSON.parse(r.stdout || "[]"); } catch (err) { return null; }
  if (!Array.isArray(list)) list = [list];
  return list.filter(Boolean).map((x) => ({
    name: String(x.n), states: String(x.s || ""), waiting: x.w | 0, oldestMinutes: x.m | 0, removed: x.r | 0,
  }));
}

async function windowsClear(printerName) {
  const r = await runPowerShell("Get-PrintJob -PrinterName $env:PB_PRINTER -ErrorAction Stop | Remove-PrintJob; 'ok'", { env: { PB_PRINTER: String(printerName) } });
  return r.ok;
}

// --- macOS (CUPS) ------------------------------------------------------------

// CUPS doesn't give a job's age in a form that is easy to read, so each job
// is timed from when this program first saw it.
const firstSeen = new Map();

async function macHealth() {
  const p = await run("lpstat", ["-p"], { timeout: 15000 });
  const o = await run("lpstat", ["-o"], { timeout: 15000 });
  if (!p.ok) return null;
  const now = Date.now();
  const printers = new Map();
  let current = null;
  for (const line of String(p.stdout).split("\n")) {
    const m = line.match(/^printer (\S+) (.*)$/);
    if (m) {
      current = { name: m[1], states: /disabled/.test(m[2]) ? "Paused" : "", waiting: 0, oldestMinutes: 0, removed: 0, jobs: [] };
      printers.set(current.name, current);
    } else if (current && line.trim()) {
      current.states += "," + line.trim(); // the reason CUPS gives, e.g. "media-empty-error"
    }
  }
  const seen = new Set();
  for (const line of String(o.stdout || "").split("\n")) {
    const id = (line.trim().split(/\s+/)[0]) || "";
    const dash = id.lastIndexOf("-");
    const printer = printers.get(id.slice(0, dash));
    if (!printer) continue;
    seen.add(id);
    if (!firstSeen.has(id)) firstSeen.set(id, now);
    const minutes = Math.floor((now - firstSeen.get(id)) / 60000);
    // A job CUPS is processing is printing: leave it, however long it takes.
    if (minutes >= STALE_MINUTES && !/processing/i.test(line)) {
      await run("cancel", [id], { timeout: 15000 });
      printer.removed++;
    } else {
      printer.waiting++;
      printer.oldestMinutes = Math.max(printer.oldestMinutes, minutes);
    }
  }
  for (const id of firstSeen.keys()) if (!seen.has(id)) firstSeen.delete(id);
  return [...printers.values()].map(({ jobs, ...rest }) => rest);
}

async function macClear(printerName) {
  const r = await run("cancel", ["-a", printerName], { timeout: 15000 });
  return r.ok;
}

// --- what the agent calls ---------------------------------------------------

// [{ name, problem, waiting, removed }] for every printer, or null if the
// computer couldn't be asked this time.
async function printerHealth() {
  const raw = await (IS_WINDOWS ? windowsHealth() : macHealth()).catch(() => null);
  if (!raw) return null;
  return raw.map((x) => {
    let problem = describe(x.states.replace(/^Normal,?/i, ""));
    if (!problem && x.waiting && x.oldestMinutes >= STUCK_MINUTES) problem = "Not printing - check it for a jam, paper or an error light";
    return { name: x.name, problem, waiting: x.waiting, removed: x.removed };
  });
}

// Cancels everything in that printer's own queue on this computer.
function clearPrinterQueue(printerName) {
  return (IS_WINDOWS ? windowsClear(printerName) : macClear(printerName)).catch(() => false);
}

module.exports = { printerHealth, clearPrinterQueue, describe, STALE_MINUTES };

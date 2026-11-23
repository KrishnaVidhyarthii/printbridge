// Sending a PDF to a real printer.
//
// macOS and Linux : the `lp` command, which is part of the system.
// Windows         : SumatraPDF (free, open source) if it is installed,
//                   otherwise Ghostscript. Both are given the PDF and the
//                   printer name on the command line.

const fs = require("fs");
const path = require("path");
const { run, runPowerShell, IS_WINDOWS } = require("./printers");
const durable = require("./durable");

// Stopped part-way: some pages may be out, so it must not be printed again
// in full on another printer (noFailover tells the main computer so).
function partlyPrinted(what) {
  const err = new Error(what + " Part of it may have printed - check the printer before printing it again.");
  err.noFailover = true;
  return err;
}

// --- macOS and Linux ----------------------------------------------------

function lpArguments(printerName, filePath, options) {
  const args = ["-d", printerName];

  if (options.copies && options.copies > 1) args.push("-n", String(options.copies));
  // One word only: lp splits -o values on spaces, so anything else could add other options.
  if (options.paper && /^[\w.-]+$/.test(options.paper)) args.push("-o", "media=" + options.paper);

  args.push(
    "-o",
    "print-color-mode=" + (options.color === "color" ? "color" : "monochrome")
  );
  args.push("-o", "sides=" + (options.sides || "one-sided"));

  if (options.pageRanges) args.push("-o", "page-ranges=" + options.pageRanges);

  // 3 = portrait, 4 = landscape; left out, CUPS turns each page to fit.
  if (options.orientation === "portrait") args.push("-o", "orientation-requested=3");
  if (options.orientation === "landscape") args.push("-o", "orientation-requested=4");
  args.push("-o", "print-scaling=" + (options.scaling === "actual" ? "none" : "fit"));

  args.push(filePath);
  return args;
}

async function printWithLp(printerName, filePath, options) {
  const result = await run("lp", lpArguments(printerName, filePath, options), {
    timeout: 120000,
  });

  if (!result.ok) {
    if (result.error && result.error.killed) throw partlyPrinted("The print command took more than 2 minutes, so it was stopped.");
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "The lp command failed.");
  }

  // lp answers with: request id is TestPrinter-7 (1 file(s))
  const match = result.stdout.match(/request id is (\S+)/);
  return { nativeJobId: match ? match[1] : "", detail: result.stdout.trim() };
}

// --- Windows: SumatraPDF ------------------------------------------------

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      /* ignore */
    }
  }
  return null;
}

function findSumatra(config) {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  // config.baseDir is the real folder this program runs from - the exe's
  // own folder when packaged, or the agent folder when run with `node`.
  // __dirname is NOT used here because inside a packaged .exe it points
  // into the read-only bundle, not next to the real file on disk.
  const baseDir = config.baseDir || path.join(__dirname, "..");

  return firstExisting([
    config.sumatraPath,
    // Right next to PrintAgent.exe itself - the simplest, most obvious
    // place to drop it, so this is checked first.
    path.join(baseDir, "SumatraPDF.exe"),
    path.join(baseDir, "tools", "SumatraPDF.exe"),
    path.join(programFiles, "SumatraPDF", "SumatraPDF.exe"),
    path.join(programFilesX86, "SumatraPDF", "SumatraPDF.exe"),
    localAppData && path.join(localAppData, "SumatraPDF", "SumatraPDF.exe"),
  ]);
}

function findGhostscript(config) {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const candidates = [config.ghostscriptPath];

  // Ghostscript installs into a version-numbered folder, so look inside.
  try {
    const base = path.join(programFiles, "gs");
    for (const version of fs.readdirSync(base)) {
      candidates.push(path.join(base, version, "bin", "gswin64c.exe"));
      candidates.push(path.join(base, version, "bin", "gswin32c.exe"));
    }
  } catch (err) {
    /* Ghostscript is not installed there */
  }

  return firstExisting(candidates);
}

// SumatraPDF takes one comma-separated settings string.
function sumatraSettings(options) {
  const parts = [];

  if (options.pageRanges) parts.push(options.pageRanges);
  if (options.copies && options.copies > 1) parts.push(options.copies + "x");

  if (options.sides === "two-sided-long-edge") parts.push("duplexlong");
  else if (options.sides === "two-sided-short-edge") parts.push("duplexshort");
  else parts.push("simplex");

  parts.push(options.color === "color" ? "color" : "monochrome");

  // A comma would split the paper name into two settings.
  if (options.paper) parts.push("paper=" + String(options.paper).replace(/,/g, " ").trim());
  // Without portrait/landscape, SumatraPDF turns each page to suit the paper.
  if (options.orientation === "portrait") parts.push("portrait");
  if (options.orientation === "landscape") parts.push("landscape");
  parts.push(options.scaling === "actual" ? "noscale" : "fit");

  return parts.join(",");
}

async function printWithSumatra(exe, printerName, filePath, options) {
  const result = await run(
    exe,
    [
      "-print-to",
      printerName,
      "-print-settings",
      sumatraSettings(options),
      "-silent",
      "-exit-when-done",
      filePath,
    ],
    // Long enough for a big job (many pages or copies) to finish handing
    // itself to Windows. At 3 minutes such a job was stopped part-way,
    // reported as failed, and - with "try another printer" ticked - then
    // printed again in full on a second printer.
    { timeout: 15 * 60 * 1000 }
  );

  if (!result.ok) {
    if (result.error && result.error.killed) {
      throw partlyPrinted("SumatraPDF took more than 15 minutes, so it was stopped.");
    }
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "SumatraPDF could not print the file.");
  }
  return { nativeJobId: "", detail: "Sent to the printer queue with SumatraPDF." };
}

async function printWithGhostscript(exe, printerName, filePath, options) {
  // Ghostscript ignores the sides setting: better to say so than print one side silently.
  if (options.sides && options.sides !== "one-sided") {
    throw new Error("Both sides needs SumatraPDF, which this computer doesn't have. Run PrintBridge Setup again to restore it, or print on one side.");
  }
  const args = [
    "-dPrinted",
    "-dBATCH",
    "-dNOPAUSE",
    "-dSAFER", // files come from anyone on the network
    "-q",
    "-dNumCopies=" + (options.copies || 1),
    "-sDEVICE=mswinpr2",
    '-sOutputFile=%printer%' + printerName,
  ];

  // Ghostscript only understands a single first/last page range.
  const simpleRange = /^(\d+)(?:-(\d+))?$/.exec(options.pageRanges || "");
  if (simpleRange) {
    args.push("-dFirstPage=" + simpleRange[1]);
    args.push("-dLastPage=" + (simpleRange[2] || simpleRange[1]));
  } else if (/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(options.pageRanges || "")) {
    args.push("-sPageList=" + options.pageRanges); // "1,3,5-7" (Ghostscript 9.20 and newer)
  }

  args.push(filePath);

  const result = await run(exe, args, { timeout: 180000 });
  if (!result.ok) {
    if (result.error && result.error.killed) throw partlyPrinted("Ghostscript took more than 3 minutes, so it was stopped.");
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Ghostscript could not print the file.");
  }
  return { nativeJobId: "", detail: "Printed with Ghostscript." };
}

// Some drivers (Canon's, for one) ignore the both-sides setting SumatraPDF
// sends and use the printer's own default instead. So the default is set
// to this job's sides while it is handed over, then put back. Best effort:
// without the rights to change it, the job still prints.
//
// What has to be put back is written to a file first, so a power cut or an
// update that stops this program mid-job can't leave the printer changed:
// the next start puts it back (restorePendingDuplex).
const DUPLEXING = { "one-sided": "OneSided", "two-sided-long-edge": "TwoSidedLongEdge", "two-sided-short-edge": "TwoSidedShortEdge" };
const DUPLEX_MODES = new Set(Object.values(DUPLEXING));

// The printer's name and the mode arrive as $env:PB_PRINTER and $env:PB_MODE,
// never inside this text. Only a printer whose current setting is one of the
// three known ones is changed, so something that can't be put back isn't touched.
function duplexScript() {
  return "$old = [string](Get-PrintConfiguration -PrinterName $env:PB_PRINTER -ErrorAction Stop).DuplexingMode; " +
    "if ($old -match '^(OneSided|TwoSidedLongEdge|TwoSidedShortEdge)$' -and $old -ne $env:PB_MODE) { " +
    "Set-PrintConfiguration -PrinterName $env:PB_PRINTER -DuplexingMode $env:PB_MODE -ErrorAction Stop }; $old";
}

// Makes the printer's default "mode"; answers what it was, or null if it
// couldn't be read or changed.
async function applyDuplexing(printerName, mode) {
  if (!DUPLEX_MODES.has(mode)) return null;
  const r = await runPowerShell(duplexScript(), { timeout: 60000, env: { PB_PRINTER: String(printerName), PB_MODE: mode } });
  const old = String(r.stdout || "").trim().split(/\r?\n/).pop();
  if (!r.ok || !DUPLEX_MODES.has(old)) {
    console.log("Couldn't set " + printerName + "'s sides to " + mode + " (" + (r.stderr || "").trim().split(/\r?\n/)[0] + ").");
    return null;
  }
  return old;
}

let duplexStateFile = null;
function useDuplexStateFile(file) { duplexStateFile = file; }
function loadPendingDuplex() {
  const list = duplexStateFile ? durable.readJson(duplexStateFile) : null;
  return Array.isArray(list) ? list.filter((e) => e && e.printer && DUPLEX_MODES.has(e.old)) : [];
}
function savePendingDuplex(list) {
  if (!duplexStateFile) return;
  try {
    if (list.length) durable.writeJson(duplexStateFile, list);
    else durable.removeJson(duplexStateFile);
  } catch (err) {
    console.log("Couldn't note which printer setting to put back: " + err.message);
  }
}

// Puts back what an interrupted job changed. Called once when the program starts.
async function restorePendingDuplex() {
  if (!IS_WINDOWS) return;
  const left = [];
  for (const entry of loadPendingDuplex()) {
    if (await applyDuplexing(entry.printer, entry.old).catch(() => null) === null) left.push(entry);
    else console.log("Put " + entry.printer + "'s sides setting back after an interrupted job.");
  }
  savePendingDuplex(left);
}

async function printOnWindows(printerName, filePath, options, config) {
  const sumatra = findSumatra(config);
  if (sumatra) {
    const mode = DUPLEXING[options.sides] || "OneSided";
    const old = await applyDuplexing(printerName, mode).catch(() => null);
    const changed = old && old !== mode ? old : null; // what to put back, if anything changed
    if (changed) savePendingDuplex(loadPendingDuplex().filter((e) => e.printer !== printerName).concat({ printer: printerName, old: changed }));
    console.log("Printing with SumatraPDF: " + sumatraSettings(options));
    try {
      return await printWithSumatra(sumatra, printerName, filePath, options);
    } finally {
      if (changed) {
        // SumatraPDF is done once Windows has the job; the driver may only read
        // the default when it renders, so wait for the queue to empty first.
        await waitUntilPrinterIdle(printerName, 2 * 60 * 1000).catch(() => null);
        let back = await applyDuplexing(printerName, changed).catch(() => null);
        if (back === null) back = await applyDuplexing(printerName, changed).catch(() => null);
        if (back !== null) savePendingDuplex(loadPendingDuplex().filter((e) => e.printer !== printerName));
        else console.log("Couldn't put " + printerName + "'s sides setting back; it will be tried again when this program starts.");
      }
    }
  }

  const ghostscript = findGhostscript(config);
  if (ghostscript) return printWithGhostscript(ghostscript, printerName, filePath, options);

  throw new Error(
    "No PDF printing program found. Run PrintBridge Setup again on this computer to restore SumatraPDF " +
      "(or install SumatraPDF or Ghostscript yourself, or set sumatraPath in config.json)."
  );
}

// --- waiting for the printer to finish -----------------------------------
//
// Handing a job to Windows or macOS is quick; the printer then works
// through it for minutes. Sending the next job only once the printer's own
// queue is empty means two people's pages never come out mixed together.

// How many jobs are in the printer's queue on this computer, or null if
// that can't be found out (then nobody waits on it).
async function jobsInQueue(printerName) {
  if (IS_WINDOWS) {
    const r = await runPowerShell("@(Get-PrintJob -PrinterName $env:PB_PRINTER -ErrorAction Stop).Count",
      { timeout: 60000, env: { PB_PRINTER: String(printerName) } });
    const n = parseInt(String(r.stdout || "").trim(), 10);
    return r.ok && Number.isFinite(n) ? n : null;
  }
  const r = await run("lpstat", ["-o", printerName], { timeout: 15000 });
  if (!r.ok && (r.stderr || "").trim()) return null;
  return String(r.stdout || "").split("\n").filter((line) => line.trim()).length;
}

// Resolves once the printer's queue is empty, or after maxMs (a jammed
// printer must not hold up every other job for ever). Returns how it ended.
async function waitUntilPrinterIdle(printerName, maxMs, everyMs) {
  const until = Date.now() + (maxMs || 10 * 60 * 1000);
  for (;;) {
    const n = await jobsInQueue(printerName).catch(() => null);
    if (n === null) return "unknown";
    if (n === 0) return "idle";
    if (Date.now() >= until) return "timeout";
    // Windows starts PowerShell for every look: not too often.
    await new Promise((resolve) => setTimeout(resolve, everyMs || (IS_WINDOWS ? 10000 : 3000)));
  }
}

// --- the one function the agent calls -----------------------------------

async function printFile(printerName, filePath, options, config) {
  if (config.dryRun) {
    const preview = IS_WINDOWS
      ? "SumatraPDF -print-to " + printerName + " -print-settings " + sumatraSettings(options)
      : "lp " + lpArguments(printerName, filePath, options).join(" ");
    return { nativeJobId: "dry-run", detail: "Dry run, nothing printed: " + preview };
  }

  if (IS_WINDOWS) return printOnWindows(printerName, filePath, options, config);
  return printWithLp(printerName, filePath, options);
}

module.exports = { printFile, sumatraSettings, lpArguments, waitUntilPrinterIdle, duplexScript, useDuplexStateFile, restorePendingDuplex };

// Both sides on Windows: the printer's own default is set to the job's sides
// (some drivers ignore SumatraPDF's setting), a printer's name can never change
// what the command does, programs that only pretend to be printers are never
// offered, and both sides by hand splits the pages the right way.
const path = require("path"), fs = require("fs"), vm = require("vm"), assert = require("assert");
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log("  ok -", m); };

const ROOT = path.join(__dirname, "..");
const print = require(path.join(ROOT, "agent", "lib", "print.js"));
const printers = require(path.join(ROOT, "agent", "lib", "printers.js"));

const s = print.duplexScript();
ok(/Set-PrintConfiguration -PrinterName \$env:PB_PRINTER -DuplexingMode \$env:PB_MODE/.test(s), "the printer and the sides come in as variables, not as text inside the command");
ok(/\$old$/.test(s), "answers with the old setting, so it can be put back");
ok(/-match '\^\(OneSided\|TwoSidedLongEdge\|TwoSidedShortEdge\)\$'/.test(s), "a printer whose current setting isn't a known one is left alone");
ok(print.sumatraSettings({ sides: "two-sided-long-edge" }).includes("duplexlong") &&
  print.sumatraSettings({ sides: "one-sided" }).includes("simplex"), "SumatraPDF is still told the sides as well");

if (process.platform === "win32") {
  const evil = "x'; Write-Output PWNED; '\u2019; Write-Output PWNED2; \u2018";
  printers.runPowerShell(s, { env: { PB_PRINTER: evil, PB_MODE: "OneSided" } }).then((r) => {
    ok(!/PWNED/.test(r.stdout), "a printer name with quotes (even curly ones) is only a name: nothing in it runs");
    done();
  });
} else {
  done();
}

function done() {
  for (const name of ["AnyDesk Printer", "PDF24", "Adobe PDF", "Microsoft Print to PDF", "OneNote (Desktop)"]) {
    ok(printers.isPretendPrinter({ Name: name, PortName: "LPT1:" }), name + " is not offered as a printer");
  }
  for (const name of ["HP LaserJet Professional P1102", "Canon LBP6230/6240", "EPSON LQ-310"]) {
    ok(!printers.isPretendPrinter({ Name: name, PortName: "USB001" }), name + " is offered");
  }

  // The page's both-sides-by-hand split, taken straight from the page's code.
  const page = fs.readFileSync(path.join(ROOT, "server", "public", "app.js"), "utf8");
  const src = page.match(/function handFlipHalves\(entry\) \{[\s\S]*?\n\}/)[0];
  const halves = vm.runInNewContext(src + "; handFlipHalves");
  let h = halves({ chosen: new Set(), pageCount: 5 });
  ok(h.fronts.join() === "1,3,5" && h.backs.join() === "4,2", "5 pages: fronts 1,3,5, then backs 4,2 (last first, so the stack comes out in order)");
  h = halves({ chosen: new Set([2, 3, 6, 7]), pageCount: 8 });
  ok(h.fronts.join() === "2,6" && h.backs.join() === "7,3", "chosen pages 2,3,6,7: fronts 2,6, backs 7,3");
  h = halves({ chosen: new Set(), pageCount: 1 });
  ok(h.fronts.join() === "1" && h.backs.length === 0, "one page has no back to turn over");

  console.log(n + " checks passed");
}

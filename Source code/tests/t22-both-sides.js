// Both sides on Windows: the printer's own default is set to the job's sides
// (some drivers ignore SumatraPDF's setting), printer names are quoted safely,
// and printers that only pretend to print are never offered.
const path = require("path"), assert = require("assert");
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log("  ok -", m); };

const print = require(path.join(__dirname, "..", "agent", "lib", "print.js"));

const s = print.duplexScript("Canon LBP6230/6240", "TwoSidedLongEdge");
ok(/Set-PrintConfiguration -PrinterName \$p -DuplexingMode TwoSidedLongEdge/.test(s), "sets the printer's default to long-edge both sides");
ok(/\[string\]\$old$/.test(s), "answers with the old setting, so it can be put back");
ok(print.duplexScript("Bob's printer", "OneSided").includes("'Bob''s printer'"), "a quote in a printer name can't break out of the command");
ok(print.sumatraSettings({ sides: "two-sided-long-edge" }).includes("duplexlong") &&
  print.sumatraSettings({ sides: "one-sided" }).includes("simplex"), "SumatraPDF is still told the sides as well");

console.log(n + " checks passed");

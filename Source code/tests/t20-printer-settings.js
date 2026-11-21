// Printers & setup: both sides set by hand, printer problems shown on the print page, clearing a printer's queue.
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert"), http = require("http"), { fork } = require("child_process");
const ROOT = path.join(__dirname, "..");
const NODE_PATH = [path.join(ROOT, "agent", "node_modules"), path.join(ROOT, "server", "node_modules"), process.env.NODE_PATH || ""].join(path.delimiter);
const WebSocket = require(path.join(ROOT, "server", "node_modules", "ws"));
const PORT = 3720;
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log("  ok -", m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, p, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: { "content-type": "application/json" } }, (r) => {
      let d = ""; r.on("data", (c) => d += c); r.on("end", () => resolve({ status: r.statusCode, body: d }));
    });
    req.on("error", () => resolve(null));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const managed = async () => JSON.parse((await request("GET", "/api/manage/printers")).body).find((p) => p.name === "Office");

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbt-"));
  const web = fork(path.join(ROOT, "server", "server.js"), [], {
    silent: true,
    env: Object.assign({}, process.env, { NODE_PATH, PORT: String(PORT), PRINT_DATA_DIR: dir, PRINT_UPLOAD_DIR: path.join(dir, "up"), NO_DISCOVERY: "1" }),
  });
  let ws, sseReq;
  try {
    for (let i = 0; i < 50 && !(await request("GET", "/api/office-printing")); i++) await sleep(200);
    const added = JSON.parse((await request("POST", "/api/manage/computers", { name: "Test" })).body);
    ws = new WebSocket("ws://127.0.0.1:" + PORT + "/agent");
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "hello", token: added.token, printers: [{ name: "Office", capabilities: { color: false, duplex: false } }] }));
    await sleep(400);

    let p = await managed();
    ok(p && p.duplexMode === "auto" && p.reportedDuplex === false && p.capabilities.duplex === false, "starts as what the computer says (no)");
    ok((await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/duplex", { mode: "yes" })).status === 200, "can be set to yes");
    p = await managed();
    ok(p.capabilities.duplex === true && p.capabilities.color === false, "yes overrules the computer, colour is left alone");
    ws.send(JSON.stringify({ type: "printers", printers: [{ name: "Office", capabilities: { color: false, duplex: false } }] }));
    await sleep(300);
    ok((await managed()).capabilities.duplex === true, "still yes after the computer reports its printers again");
    await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/duplex", { mode: "no" });
    ok((await managed()).capabilities.duplex === false, "can be set to no");
    await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/duplex", { mode: "hand" });
    const hand = (await managed()).capabilities;
    ok(hand.duplex === false && hand.duplexByHand === true, "can be set to by hand (no automatic both sides, so the page offers turning it over)");
    await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/duplex", { mode: "no" });
    ok((await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/duplex", { mode: "maybe" })).status === 400, "anything else is refused");

    // A printer's computer says it is jammed: everyone sees it, then it clears.
    const got = [];
    ws.on("message", (m) => got.push(JSON.parse(m)));
    const sseQueues = [];
    let sseBuf = "";
    sseReq = http.get("http://127.0.0.1:" + PORT + "/api/stream", (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        sseBuf += chunk;
        let idx;
        while ((idx = sseBuf.indexOf("\n\n")) !== -1) {
          const frame = sseBuf.slice(0, idx);
          sseBuf = sseBuf.slice(idx + 2);
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (frame.includes("event: queue\n") && dataLine) sseQueues.push(JSON.parse(dataLine.slice(6)));
        }
      });
    });
    sseReq.on("error", () => {});
    const waitFor = async (fn) => {
      for (let i = 0; i < 40; i++) { if (fn()) return true; await sleep(50); }
      return false;
    };
    await waitFor(() => sseQueues.length >= 1);

    const form = new FormData();
    form.append("printerId", p.id);
    form.append("file", new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }), "a.pdf");
    const sent = await fetch("http://127.0.0.1:" + PORT + "/api/print", { method: "POST", body: form });
    ok(sent.ok, "a job waits on the printer");
    await waitFor(() => sseQueues.some((q) => q.length === 1));

    const beforeJam = sseQueues.length;
    ws.send(JSON.stringify({ type: "health", printers: [{ name: "Office", problem: "Paper jam", waiting: 2 }, { name: "Not mine", problem: "x" }, null] }));
    await sleep(300);
    const listed = () => request("GET", "/api/printers").then((r) => JSON.parse(r.body).find((x) => x.name === "Office"));
    ok((await listed()).problem === "Paper jam", "a jam reported by the printer's computer shows on the print page");
    ok(await waitFor(() => sseQueues.slice(beforeJam).some((q) => q.some((j) => j.printerProblem === "Paper jam"))), "live queue update shows the jam right away");
    const beforeClear = sseQueues.length;
    ws.send(JSON.stringify({ type: "health", printers: [{ name: "Office", problem: "", waiting: 0 }] }));
    await sleep(300);
    ok((await listed()).problem === "", "and goes away once it is fixed");
    ok(await waitFor(() => sseQueues.slice(beforeClear).some((q) => q.length && q.every((j) => j.printerProblem === ""))), "clearing the jam broadcasts to the live queue too");

    // Clearing the queue cancels what waits for it and tells its computer.
    const cleared = JSON.parse((await request("POST", "/api/manage/printers/" + encodeURIComponent(p.id) + "/clear-queue")).body);
    await sleep(300);
    ok(cleared.ok && cleared.cancelled === 1 && cleared.computerOnline === true, "clearing a queue answers ok");
    ok(got.some((m) => m.type === "clear-queue" && m.printer === "Office"), "the printer's computer is told to empty its own queue");

    // Removing a computer from Manage closes its live connection right away.
    const closed = new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    const removed = await request("DELETE", "/api/manage/computers/" + encodeURIComponent(added.computer.id));
    const closeCode = await Promise.race([closed, sleep(1500).then(() => null)]);
    ok(removed.status === 200 && closeCode === 4003, "removing a computer disconnects its agent immediately");
  } finally {
    if (sseReq) sseReq.destroy();
    if (ws) ws.terminate();
    web.kill();
    // The website may still be saving as it stops; a leftover temp folder is not a failed check.
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (err) { /* left in the temp folder */ }
  }
  console.log(n + " checks passed");
})().catch((err) => { console.error(err); process.exit(1); });

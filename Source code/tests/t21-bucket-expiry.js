// The bucket belongs to one device, and nothing waits more than an hour:
// held files, bucket files, queued jobs and printouts waiting for approval.
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbb-"));
process.env.PRINT_DATA_DIR = dir;
process.env.PRINT_UPLOAD_DIR = path.join(dir, "u");
fs.mkdirSync(process.env.PRINT_UPLOAD_DIR);
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log("  ok -", m); };

const S = path.join(__dirname, "..", "server");
const { db } = require(S + "/lib/store");
const agents = require(S + "/lib/agents");
const jobs = require(S + "/lib/jobs");
const held = require(S + "/lib/held");
const remote = require(S + "/lib/remote");

const file = (name) => { const p = path.join(dir, "u", name); fs.writeFileSync(p, "%PDF-1.4"); return p; };
const MIN = 60 * 1000;

// --- the bucket
const a = held.create({ storedPath: file("a.pdf"), originalName: "a.pdf", size: 8 });
const b = held.create({ storedPath: file("b.pdf"), originalName: "b.pdf", size: 8 });
ok(held.addToBucket(a.id, "dev_aaaaaaaa") && held.addToBucket(b.id, "dev_aaaaaaaa"), "two files go in my bucket");
ok(!held.addToBucket(a.id, "dev_bbbbbbbb"), "someone else can't take a file out of my bucket into theirs");
ok(held.bucketFor("dev_aaaaaaaa").length === 2 && held.bucketFor("dev_bbbbbbbb").length === 0, "each device sees only its own bucket");
held.take(a.id);
ok(held.bucketFor("dev_aaaaaaaa").map((e) => e.id).join() === b.id, "a printed file leaves the bucket");

// --- held files: over an hour old are deleted, bucket or not
b.createdAt = Date.now() - 61 * MIN;
const fresh = held.create({ storedPath: file("c.pdf"), originalName: "c.pdf", size: 8 });
fresh.createdAt = Date.now() - 59 * MIN;
held.sweep();
ok(!held.get(b.id) && !fs.existsSync(b.storedPath), "bucket file held 61 minutes is thrown away, file deleted");
ok(held.get(fresh.id), "file held 59 minutes is kept");

// --- queued jobs
agents.isOnline = () => false; // printer's computer is off: jobs wait
db.printers.push({ id: "p1", agentId: "a1", name: "HP LaserJet", hidden: false, capabilities: null });
const newJob = (name) => jobs.createJob({ deviceId: "dev_aaaaaaaa", label: "x", file: { originalName: name, storedPath: file(name) }, printer: db.printers[0], options: {} });
const old = newJob("old.pdf"), young = newJob("young.pdf"), sentOld = newJob("sent.pdf");
jobs.dispatch(old); jobs.dispatch(young);
old.createdAt = sentOld.createdAt = Date.now() - 61 * MIN;
young.createdAt = Date.now() - 59 * MIN;
sentOld.sentAt = Date.now() - 60 * MIN;
jobs.expireOld();
ok(old.status === "cancelled" && /over an hour/.test(old.statusMessage) && !old.storedFile, "job waiting 61 minutes is cancelled and its file deleted");
ok(young.status === "queued", "job waiting 59 minutes keeps waiting");
ok(sentOld.status === "cancelled" && /may still come out/.test(sentOld.statusMessage), "one already sent says honestly it may still come out");

// --- printouts from anywhere waiting for approval
remote.expireOld(); // not started yet: nothing to do, no crash
const stateFile = path.join(dir, "remote.json");
const pendingFile = (name) => file(name);
fs.writeFileSync(stateFile, JSON.stringify({ pending: [
  { relayId: "r1", fileName: "x.pdf", filePath: pendingFile("x.pdf"), at: Date.now() - 61 * MIN },
  { relayId: "r2", fileName: "y.pdf", filePath: pendingFile("y.pdf"), at: Date.now() - 5 * MIN },
], log: [{ relayId: "r1", result: "held" }] }));
remote.start({ file: stateFile, uploadDir: path.join(dir, "u"), db });
remote.stop();
remote.expireOld();
const after = remote.pendingFiles();
ok(after.length === 1 && after[0] === "y.pdf", "printout waiting 61 minutes for approval is dropped, newer one kept");
setTimeout(() => {
  ok(!fs.existsSync(path.join(dir, "u", "x.pdf")), "its file is deleted");
  console.log(n + " checks passed");
  process.exit(0);
}, 300);

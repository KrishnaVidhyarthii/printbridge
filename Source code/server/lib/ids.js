// Helpers for random ids and tokens.

const crypto = require("crypto");

// A short, readable id for database rows.
function newId(prefix) {
  return prefix + "_" + crypto.randomBytes(9).toString("hex");
}

// A long secret string, used for session cookies, agent tokens and
// one-time file links. 32 random bytes is plenty.
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

// We never store raw tokens in the database. We store this hash instead,
// so a leaked database file does not hand out working tokens.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { newId, newToken, hashToken };

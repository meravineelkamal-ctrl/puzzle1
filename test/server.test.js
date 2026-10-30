const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../server");
const testWinningCode = "123789";

function makeDb({ users = {}, winner = null, privateWinner = null } = {}) {
  const documents = {
    "gameState/currentWinner": winner,
    "privateWinners/current": privateWinner,
    ...Object.fromEntries(Object.entries(users).map(([uid, user]) => [`users/${uid}`, user]))
  };
  const db = {
    doc(path) {
      return {
        path,
        async get() {
          const value = documents[path];
          return { exists: value !== undefined && value !== null, data: () => value };
        },
        async set(value, options) {
          documents[path] = options && options.merge ? { ...documents[path], ...value } : value;
        }
      };
    },
    async runTransaction(callback) {
      const run = async () => {
        const transaction = {
          async get(ref) {
            const value = documents[ref.path];
            return { exists: value !== undefined && value !== null, data: () => value };
          },
          create(ref, value) {
            if (documents[ref.path]) throw new Error("already exists");
            documents[ref.path] = value;
          },
          set(ref, value, options) {
            documents[ref.path] = options && options.merge ? { ...documents[ref.path], ...value } : value;
          },
          update(ref, value) {
            documents[ref.path] = { ...documents[ref.path], ...value };
          }
        };
        return callback(transaction);
      };
      const current = transactionQueue.then(run);
      transactionQueue = current.catch(() => {});
      return current;
    },
    documents
  };
  return db;
}

let transactionQueue = Promise.resolve();

function makeApp({ db = makeDb(), identities = {} } = {}) {
  const app = createApp({
    db,
    verifyIdToken: async (token) => {
      if (!identities[token]) throw new Error("invalid token");
      return identities[token];
    },
    winningCode: testWinningCode,
    adminEmail: "admin@example.com",
    webConfig: { apiKey: "test-key", authDomain: "test.firebaseapp.com", projectId: "test", appId: "test-app" }
  });
  return { app, db };
}

const player = { uid: "player-1", email: "player@example.com", email_verified: true };
const admin = { uid: "admin-1", email: "admin@example.com", email_verified: true };
const profile = { username: "Player", email: player.email, mobile: "+919876543210", upiId: "player@bank" };

test("unauthenticated users cannot register or submit codes", async () => {
  const { app } = makeApp();
  const register = await request(app).post("/api/register").send({});
  const submit = await request(app).post("/api/submit-code").send({ code: "123456" });
  assert.equal(register.status, 401);
  assert.equal(submit.status, 401);
});

test("registration validates and stores contact data only for the authenticated UID", async () => {
  const { app, db } = makeApp({ identities: { player } });
  const response = await request(app)
    .post("/api/register")
    .set("Authorization", "Bearer player")
    .send({ username: "Player", mobile: "+91 98765 43210", upiId: "Player@Bank" });
  assert.equal(response.status, 200);
  assert.equal(db.documents["users/player-1"].email, player.email);
  assert.equal(db.documents["users/player-1"].mobile, "+919876543210");
  assert.equal(db.documents["users/player-1"].upiId, "player@bank");
});

test("public Firebase configuration does not expose the winning code", async () => {
  const { app } = makeApp();
  const response = await request(app).get("/api/config");
  assert.equal(response.body.winningCode, undefined);
  assert.equal(JSON.stringify(response.body).includes(testWinningCode), false);
});

test("home page serves inline CSS and JavaScript with matching CSP nonces", async () => {
  const { app } = makeApp();
  const response = await request(app).get("/");
  const scriptNonce = response.text.match(/<script nonce="([^"]+)">/);
  const styleNonce = response.text.match(/<style nonce="([^"]+)">/);
  assert.equal(response.status, 200);
  assert.ok(response.text.includes(":root {"));
  assert.ok(response.text.includes("firebase.initializeApp(config)"));
  assert.ok(scriptNonce);
  assert.ok(styleNonce);
  assert.equal(scriptNonce[1], styleNonce[1]);
  assert.ok(response.headers["content-security-policy"].includes(`'nonce-${scriptNonce[1]}'`));
  assert.equal(response.text.includes('src="/app.js"'), false);
  assert.equal(response.text.includes('href="/styles.css"'), false);
});

test("incorrect and malformed codes never claim the winner", async () => {
  const { app, db } = makeApp({
    db: makeDb({ users: { "player-1": profile } }),
    identities: { player }
  });
  const malformed = await request(app).post("/api/submit-code").set("Authorization", "Bearer player").send({ code: "12x456" });
  const incorrect = await request(app).post("/api/submit-code").set("Authorization", "Bearer player").send({ code: "123456" });
  assert.equal(malformed.status, 400);
  assert.equal(incorrect.body.error, "incorrect_code");
  assert.equal(db.documents["gameState/currentWinner"], null);
});

test("a correct code requires complete registration", async () => {
  const { app } = makeApp({ identities: { player } });
  const response = await request(app).post("/api/submit-code").set("Authorization", "Bearer player").send({ code: testWinningCode });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "registration_required");
});

test("simultaneous correct submissions select exactly one winner", async () => {
  const users = {
    "player-1": profile,
    "player-2": { ...profile, username: "Second", email: "second@example.com" }
  };
  const identities = {
    first: player,
    second: { uid: "player-2", email: "second@example.com", email_verified: true }
  };
  const { app, db } = makeApp({ db: makeDb({ users }), identities });
  const [first, second] = await Promise.all([
    request(app).post("/api/submit-code").set("Authorization", "Bearer first").send({ code: testWinningCode }),
    request(app).post("/api/submit-code").set("Authorization", "Bearer second").send({ code: testWinningCode })
  ]);
  assert.equal([first, second].filter((response) => response.status === 201).length, 1);
  assert.equal([first, second].filter((response) => response.status === 409).length, 1);
  assert.equal(db.documents["gameState/currentWinner"].prizeAmount, 1000);
  assert.equal(db.documents["privateWinners/current"].prizeAmount, 1000);
});

test("duplicate correct submissions cannot replace the original winner", async () => {
  const { app, db } = makeApp({
    db: makeDb({ users: { "player-1": profile } }),
    identities: { player }
  });
  const send = () => request(app).post("/api/submit-code").set("Authorization", "Bearer player").send({ code: testWinningCode });
  const first = await send();
  const duplicate = await send();
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.equal(db.documents["gameState/currentWinner"].username, "Player");
});

test("the public winner endpoint omits private contact information", async () => {
  const winner = { username: "Player", prizeAmount: 1000, wonAt: new Date("2026-01-01T00:00:00Z") };
  const { app } = makeApp({ db: makeDb({ winner }) });
  const response = await request(app).get("/api/game-state");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.winner, {
    username: "Player",
    prizeAmount: 1000,
    wonAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(response.body.winner.email, undefined);
  assert.equal(response.body.winner.mobile, undefined);
  assert.equal(response.body.winner.upiId, undefined);
});

test("admin details require the configured verified email", async () => {
  const db = makeDb({ privateWinner: { ...profile, uid: "player-1", prizeAmount: 1000, paid: false } });
  const { app } = makeApp({ db, identities: { player, admin, unverified: { ...admin, email_verified: false } } });
  const denied = await request(app).get("/api/admin/winner").set("Authorization", "Bearer player");
  const unverified = await request(app).get("/api/admin/winner").set("Authorization", "Bearer unverified");
  const allowed = await request(app).get("/api/admin/winner").set("Authorization", "Bearer admin");
  assert.equal(denied.status, 403);
  assert.equal(unverified.status, 403);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.winner.mobile, profile.mobile);
});

test("winner details remain available after the public game state closes", async () => {
  const winner = { username: "Player", prizeAmount: 1000, wonAt: new Date("2026-01-01T00:00:00Z") };
  const { app } = makeApp({ db: makeDb({ winner }), identities: { player } });
  const response = await request(app).get("/api/game-state");
  assert.equal(response.body.open, false);
  assert.equal(response.body.winner.username, "Player");
});

test("mark-paid requires confirmation and records an audit identity", async () => {
  const db = makeDb({ privateWinner: { ...profile, uid: "player-1", paid: false } });
  const { app } = makeApp({ db, identities: { admin } });
  const headers = { Authorization: "Bearer admin" };
  const missing = await request(app).post("/api/admin/mark-paid").set(headers).send({});
  const confirmed = await request(app).post("/api/admin/mark-paid").set(headers).send({ confirmed: true });
  assert.equal(missing.status, 400);
  assert.equal(confirmed.status, 200);
  assert.equal(db.documents["privateWinners/current"].paidBy, admin.email);
  assert.ok(db.documents["privateWinners/current"].paidAt instanceof Date);
});

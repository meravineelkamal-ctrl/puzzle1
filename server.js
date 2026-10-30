const path = require("node:path");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { cert, getApp, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { claimWinner, isRegistrationComplete } = require("./winner-service");

const publicDirectory = path.join(__dirname, "public");

function createApp({ db, verifyIdToken, winningCode, adminEmail, webConfig, serverTimestamp = () => new Date() }) {
  const app = express();
  const origin = process.env.ALLOWED_ORIGIN || "http://localhost:10000";

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(18).toString("base64");
    next();
  });
  app.use(helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://www.gstatic.com",
          (_req, res) => `'nonce-${res.locals.cspNonce}'`
        ],
        styleSrc: ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://www.googleapis.com"],
        frameSrc: ["https://*.firebaseapp.com", "https://accounts.google.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: null
      }
    }
  }));
  app.use(cors({ origin, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
  app.use(express.json({ limit: "10kb" }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limit_exceeded", message: "Too many requests. Please try again shortly." }
  });
  const submitLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 8,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limit_exceeded", message: "Too many code attempts. Please wait a minute." }
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  }, apiLimiter);

  async function requireUser(req, res, next) {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: "authentication_required", message: "Sign in to continue." });
    }
    try {
      req.user = await verifyIdToken(match[1]);
      return next();
    } catch (error) {
      return res.status(401).json({ error: "invalid_token", message: "Your session is invalid or expired. Sign in again." });
    }
  }

  function requireAdmin(req, res, next) {
    if (!req.user.email || req.user.email_verified !== true ||
        req.user.email.toLowerCase() !== adminEmail.toLowerCase()) {
      return res.status(403).json({ error: "admin_required", message: "Administrator access is required." });
    }
    return next();
  }

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/config", (_req, res) => res.json(webConfig));

  app.get("/api/game-state", async (_req, res, next) => {
    try {
      const snapshot = await db.doc("gameState/currentWinner").get();
      res.json({
        open: !snapshot.exists,
        winner: snapshot.exists ? publicWinner(snapshot.data()) : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/me", requireUser, async (req, res, next) => {
    try {
      const snapshot = await db.doc(`users/${req.user.uid}`).get();
      const profile = snapshot.exists ? snapshot.data() : null;
      res.json({
        registered: isRegistrationComplete(profile),
        username: profile && profile.username
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/register", requireUser, async (req, res, next) => {
    try {
      const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
      const mobile = typeof req.body.mobile === "string" ? req.body.mobile.replace(/[\s()-]/g, "") : "";
      const upiId = typeof req.body.upiId === "string" ? req.body.upiId.trim().toLowerCase() : "";
      if (username.length < 2 || username.length > 40 ||
          /[\u0000-\u001f\u007f]/.test(username) ||
          !/^\+?[1-9]\d{7,14}$/.test(mobile) ||
          !/^[a-z0-9._-]{2,256}@[a-z0-9.-]{2,64}$/.test(upiId)) {
        return res.status(400).json({
          error: "invalid_registration",
          message: "Enter a username (2–40 characters), valid mobile number, and valid UPI ID."
        });
      }
      if (!req.user.email || req.user.email_verified !== true) {
        return res.status(400).json({ error: "verified_email_required", message: "Use a Google account with a verified email." });
      }
      const registered = await db.runTransaction(async (transaction) => {
        const winnerSnapshot = await transaction.get(db.doc("gameState/currentWinner"));
        if (winnerSnapshot.exists) return false;
        transaction.set(db.doc(`users/${req.user.uid}`), {
          username,
          email: req.user.email,
          mobile,
          upiId,
          updatedAt: new Date()
        }, { merge: true });
        return true;
      });
      if (!registered) {
        return res.status(409).json({ error: "game_closed", message: "The winner has already been selected." });
      }
      return res.json({ registered: true, username });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/submit-code", requireUser, submitLimiter, async (req, res, next) => {
    if (typeof req.body.code !== "string" || !/^\d{6}$/.test(req.body.code)) {
      return res.status(400).json({ error: "invalid_code_format", message: "Enter exactly six digits." });
    }
    try {
      const result = await claimWinner({
        db,
        uid: req.user.uid,
        submittedCode: req.body.code,
        winningCode,
        serverTimestamp
      });
      if (result.status === "incorrect") {
        return res.status(400).json({ error: "incorrect_code", message: "That code is not correct. Try again." });
      }
      if (result.status === "registration_required") {
        return res.status(409).json({ error: "registration_required", message: "Complete your registration before submitting a code." });
      }
      if (result.status === "already_selected") {
        return res.status(409).json({ error: "winner_already_selected", message: "The winner has already been selected." });
      }
      return res.status(201).json({ won: true, prizeAmount: 1000 });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/admin/winner", requireUser, requireAdmin, async (_req, res, next) => {
    try {
      const snapshot = await db.doc("privateWinners/current").get();
      if (!snapshot.exists) {
        return res.json({ winner: null });
      }
      return res.json({ winner: privateWinner(snapshot.data()) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/admin/mark-paid", requireUser, requireAdmin, async (req, res, next) => {
    if (req.body.confirmed !== true) {
      return res.status(400).json({ error: "payment_confirmation_required", message: "Confirm that payment has actually been made." });
    }
    try {
      const winnerRef = db.doc("privateWinners/current");
      const result = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(winnerRef);
        if (!snapshot.exists) return { status: "no_winner" };
        if (snapshot.data().paid) return { status: "already_paid" };
        transaction.update(winnerRef, {
          paid: true,
          paidAt: serverTimestamp(),
          paidBy: req.user.email
        });
        return { status: "paid" };
      });
      if (result.status === "no_winner") {
        return res.status(404).json({ error: "no_winner", message: "There is no winner to update." });
      }
      return res.json({ paid: true, alreadyPaid: result.status === "already_paid" });
    } catch (error) {
      return next(error);
    }
  });

  app.use(express.static(publicDirectory, { index: false, maxAge: "1h" }));
  app.get("/admin", (_req, res) => res.sendFile(path.join(publicDirectory, "admin.html")));
  app.get("/", async (_req, res, next) => {
    try {
      const html = await fs.readFile(path.join(publicDirectory, "index.html"), "utf8");
      res.set("Cache-Control", "no-store");
      res.type("html").send(html.replaceAll("__CSP_NONCE__", res.locals.cspNonce));
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error("Request failed:", error);
    if (res.headersSent) return;
    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body")) {
      return res.status(400).json({ error: "invalid_json", message: "Request body must be valid JSON." });
    }
    res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
  });
  return app;
}

function publicWinner(winner) {
  return {
    username: winner.username,
    prizeAmount: winner.prizeAmount,
    wonAt: toIsoString(winner.wonAt)
  };
}

function privateWinner(winner) {
  return {
    uid: winner.uid,
    username: winner.username,
    email: winner.email,
    mobile: winner.mobile,
    upiId: winner.upiId,
    prizeAmount: winner.prizeAmount,
    wonAt: toIsoString(winner.wonAt),
    paid: winner.paid === true,
    paidAt: winner.paidAt ? toIsoString(winner.paidAt) : null,
    paidBy: winner.paidBy || null
  };
}

function toIsoString(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value instanceof Date ? value.toISOString() : null;
}

function loadConfig() {
  const required = [
    "WINNING_CODE", "ADMIN_EMAIL", "FIREBASE_PROJECT_ID",
    "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_WEB_API_KEY",
    "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_ID"
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  if (!/^\d{6}$/.test(process.env.WINNING_CODE)) {
    throw new Error("WINNING_CODE must contain exactly six digits.");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON.");
  }
  return { serviceAccount };
}

function start() {
  const { serviceAccount } = loadConfig();
  const firebaseApp = getApps().length ? getApp() : initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  const app = createApp({
    db: getFirestore(firebaseApp),
    verifyIdToken: (token) => getAuth(firebaseApp).verifyIdToken(token, true),
    winningCode: process.env.WINNING_CODE,
    adminEmail: process.env.ADMIN_EMAIL,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    webConfig: {
      apiKey: process.env.FIREBASE_WEB_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      appId: process.env.FIREBASE_APP_ID
    }
  });
  const port = Number(process.env.PORT) || 10000;
  app.listen(port, () => console.log(`Code Hunt listening on port ${port}`));
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createApp };

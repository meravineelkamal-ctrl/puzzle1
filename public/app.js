import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const $ = (selector) => document.querySelector(selector);
const status = $("#game-status");
const signinPanel = $("#signin-panel");
const registrationForm = $("#registration-form");
const codeForm = $("#code-form");
const winnerPanel = $("#winner-panel");
const message = $("#message");
let auth;
let currentUser = null;
let gameOpen = true;

async function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (currentUser) headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || "Request failed. Please try again.");
    error.code = data.error;
    error.status = response.status;
    throw error;
  }
  return data;
}

function showMessage(text, success = false) {
  message.textContent = text;
  message.classList.toggle("success", success);
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
  message.textContent = "";
  message.classList.remove("success");
}

async function refreshGameState() {
  const state = await request("/api/game-state");
  gameOpen = state.open;
  status.hidden = true;
  if (!state.open) {
    signinPanel.hidden = true;
    registrationForm.hidden = true;
    codeForm.hidden = true;
    winnerPanel.hidden = false;
    $("#winner-name").textContent = state.winner.username;
    $("#winner-time").textContent = formatDate(state.winner.wonAt);
    $("#winner-time").dateTime = state.winner.wonAt || "";
    clearMessage();
  } else {
    winnerPanel.hidden = true;
    await renderSignedInState();
  }
}

async function checkGameStatus() {
  if (!gameOpen) return;
  try {
    const state = await request("/api/game-state");
    if (!state.open) await refreshGameState();
  } catch (error) {
    console.error("Could not refresh game status:", error);
    if (!document.hidden) showMessage("Unable to refresh game status. Check your connection.");
  }
}

async function renderSignedInState() {
  if (!gameOpen) return;
  signinPanel.hidden = Boolean(currentUser);
  registrationForm.hidden = true;
  codeForm.hidden = true;
  if (!currentUser) return;
  try {
    const profile = await request("/api/me");
    if (profile.registered) {
      $("#player-name").textContent = profile.username;
      codeForm.hidden = false;
    } else {
      registrationForm.hidden = false;
    }
  } catch (error) {
    showMessage(error.message);
  }
}

function formatDate(value) {
  if (!value) return "just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "just now" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function initialize() {
  try {
    const config = await request("/api/config");
    auth = getAuth(initializeApp(config));
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    $("#signin-button").addEventListener("click", async () => {
      clearMessage();
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        showMessage(error.code === "auth/popup-closed-by-user" ? "Sign-in was cancelled." : "Google sign-in failed. Please try again.");
      }
    });
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      if (user) {
        try {
          await user.getIdToken();
          await refreshGameState();
        } catch (error) {
          showMessage(error.message);
        }
      } else {
        await refreshGameState();
      }
    });
  } catch (error) {
    status.textContent = error.message || "Unable to connect. Please refresh the page.";
  }
}

registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  const button = registrationForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const data = Object.fromEntries(new FormData(registrationForm));
    await request("/api/register", { method: "POST", body: JSON.stringify(data) });
    registrationForm.reset();
    await renderSignedInState();
    showMessage("Registration saved. You're ready to play.", true);
  } catch (error) {
    showMessage(error.message);
    if (error.code === "game_closed") await refreshGameState();
  } finally {
    button.disabled = false;
    button.textContent = "Save and continue";
  }
});

$("#code").addEventListener("input", (event) => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
});

codeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();
  const button = $("#submit-code");
  button.disabled = true;
  button.textContent = "Checking…";
  try {
    const result = await request("/api/submit-code", {
      method: "POST",
      body: JSON.stringify({ code: $("#code").value })
    });
    if (result.won) {
      $("#success-dialog").showModal();
      $("#close-dialog").focus();
      await refreshGameState();
    }
  } catch (error) {
    if (error.code === "incorrect_code") {
      $("#error-dialog").showModal();
      $("#try-again").focus();
    } else {
      showMessage(error.message);
    }
    if (error.code === "winner_already_selected") await refreshGameState();
  } finally {
    button.disabled = false;
    button.innerHTML = 'Submit code <span aria-hidden="true">→</span>';
  }
});

$("#close-dialog").addEventListener("click", () => $("#success-dialog").close());
$("#close-error-dialog").addEventListener("click", () => $("#error-dialog").close());
$("#try-again").addEventListener("click", () => {
  $("#error-dialog").close();
  $("#code").focus();
});
window.setInterval(checkGameStatus, 10000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkGameStatus();
});
initialize();

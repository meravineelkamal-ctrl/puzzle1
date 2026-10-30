import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const $ = (selector) => document.querySelector(selector);
const message = $("#admin-message");
let auth;
let user;

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function displayDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

async function loadWinner() {
  $("#winner-details").hidden = true;
  $("#mark-paid").hidden = true;
  try {
    const data = await api("/api/admin/winner");
    if (!data.winner) {
      showMessage("No winner has been selected yet.");
      return;
    }
    const winner = data.winner;
    $("#winner-username").textContent = winner.username;
    $("#winner-email").textContent = winner.email;
    $("#winner-mobile").textContent = winner.mobile;
    $("#winner-upi").textContent = winner.upiId;
    $("#winner-uid").textContent = winner.uid;
    $("#winner-prize").textContent = `₹${winner.prizeAmount.toLocaleString("en-IN")}`;
    $("#winner-won-at").textContent = displayDate(winner.wonAt);
    $("#winner-paid").textContent = winner.paid ? "Paid" : "Unpaid";
    $("#winner-paid-at").textContent = displayDate(winner.paidAt);
    $("#mark-paid").hidden = winner.paid;
    $("#winner-details").hidden = false;
    message.hidden = true;
  } catch (error) {
    showMessage(error.message);
  }
}

async function initialize() {
  try {
    const configResponse = await fetch("/api/config");
    if (!configResponse.ok) throw new Error("Unable to load Firebase configuration.");
    auth = getAuth(initializeApp(await configResponse.json()));
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    $("#signin-button").addEventListener("click", async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch {
        showMessage("Google sign-in failed. Please try again.");
      }
    });
    $("#signout-button").addEventListener("click", () => signOut(auth));
    $("#mark-paid").addEventListener("click", async () => {
      if (!window.confirm("Confirm that the ₹1,000 prize has actually been paid?")) return;
      try {
        await api("/api/admin/mark-paid", {
          method: "POST",
          body: JSON.stringify({ confirmed: true })
        });
        await loadWinner();
      } catch (error) {
        showMessage(error.message);
      }
    });
    onAuthStateChanged(auth, async (currentUser) => {
      user = currentUser;
      $("#signin-button").hidden = Boolean(user);
      $("#signout-button").hidden = !user;
      $("#winner-details").hidden = true;
      if (user) await loadWinner();
    });
  } catch (error) {
    showMessage(error.message);
  }
}

initialize();

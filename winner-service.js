async function claimWinner({ db, uid, submittedCode, winningCode, serverTimestamp }) {
  return db.runTransaction(async (transaction) => {
    const winnerRef = db.doc("gameState/currentWinner");
    const userRef = db.doc(`users/${uid}`);
    const winnerSnapshot = await transaction.get(winnerRef);

    if (winnerSnapshot.exists) {
      return { status: "already_selected" };
    }

    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists || !isRegistrationComplete(userSnapshot.data())) {
      return { status: "registration_required" };
    }

    if (submittedCode !== winningCode) {
      return { status: "incorrect" };
    }

    const user = userSnapshot.data();
    const wonAt = serverTimestamp();
    transaction.create(winnerRef, {
      username: user.username,
      prizeAmount: 1000,
      wonAt
    });
    transaction.create(db.doc("privateWinners/current"), {
      uid,
      email: user.email,
      username: user.username,
      mobile: user.mobile,
      upiId: user.upiId,
      prizeAmount: 1000,
      wonAt,
      paid: false,
      paidAt: null
    });
    return { status: "won" };
  });
}

function isRegistrationComplete(user) {
  return Boolean(user &&
    typeof user.username === "string" && user.username.trim() &&
    typeof user.email === "string" && user.email.trim() &&
    typeof user.mobile === "string" && user.mobile.trim() &&
    typeof user.upiId === "string" && user.upiId.trim());
}

module.exports = { claimWinner, isRegistrationComplete };

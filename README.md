# Code Hunt

A single-page, mobile-friendly code hunt backed by an Express API, Firebase Authentication, and Cloud Firestore. The first valid correct submission claims one permanent winner slot inside a Firestore transaction. The Node service also serves the static frontend, so one Render Web Service hosts both the UI and API.

## Easy setup (Hindi / Hinglish)

`public/index.html` mein website ka CSS aur browser-side JavaScript inline hai. Isliye is page ke liye alag `styles.css` ya `app.js` host karne ki zarurat nahi. Google sign-in ke liye Firebase ki compatible browser library `gstatic.com` se load hoti hai. **Sirf HTML page static hosting par rakhna kaafi nahi hoga**: login, registration, secret code checking aur winner selection ke liye isi project ka Node backend bhi chalna chahiye. Sabse aasaan setup ek hi Render Web Service par frontend aur backend dono deploy karna hai.

### Firebase setup

1. Firebase Console mein naya project banayein: [console.firebase.google.com](https://console.firebase.google.com/).
2. **Project settings → General → Your apps → Web app** se Firebase Web App banayein. Aapke diye hue **Web API Key**, **Project ID**, **Auth domain**, aur **App ID** `.env.example` mein pehle se set hain. Agar Firebase console mein ye values alag dikh rahi hain, apne console wali values ko `.env`/Render settings mein use karein.
3. **Authentication → Sign-in method** mein jaakar **Google** provider enable karein.
4. **Authentication → Settings → Authorized domains** mein local test ke liye `localhost` add karein. Render deploy ke baad Render ka asal domain bhi yahan add karein, jaise `your-service.onrender.com` (domain value `https://` ke bina).
5. **Firestore Database** banayein. Is project mein browser se Firestore directly access nahi hota: saari sensitive reads/writes backend ke zariye hoti hain. [`firestore.rules`](./firestore.rules) ke deny-all rules publish karein.
6. **Project settings → Service accounts → Generate new private key** se service-account JSON lein. Ise kisi public jagah ya GitHub par kabhi upload na karein.
7. Admin ke liye us Google account ka verified email rakhein jise admin panel kholna hai.

### Render par deploy

1. Is poore project ko apne **private GitHub repository** mein push karein. `.env` aur service-account JSON commit na hon; `.gitignore` unhein exclude karta hai.
2. Render Dashboard mein **New → Web Service** chunein aur repository connect karein. **Static Site mat banayein**—backend bhi isi service mein chalta hai.
3. **Build Command:** `npm install`  
   **Start Command:** `npm start`
4. Render ke **Environment** tab mein neeche diye variables add karein. Firebase web config ki public values `.env.example` mein aapke diye config ke mutabiq bhari hui hain; Firebase server key aur game secret private rakhein:

   | Variable | Value kahan se milegi |
   |---|---|
   | `WINNING_CODE` | Aapka chuna hua 6-digit secret. Sirf Render/local `.env` mein; HTML ya browser JavaScript mein nahi. |
   | `ADMIN_EMAIL` | Admin ke verified Google account ka email |
   | `FIREBASE_PROJECT_ID` | `puzzle-1-43129` (Firebase console se confirm karein) |
   | `FIREBASE_WEB_API_KEY` | Aapke Web App config ki API key |
   | `FIREBASE_AUTH_DOMAIN` | `puzzle-1-43129.firebaseapp.com` |
   | `FIREBASE_APP_ID` | Aapke Web App config ka App ID |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account ki poori JSON; Render mein secret value ke roop mein |
   | `ALLOWED_ORIGIN` | Aapki live website ka exact origin, jaise `https://your-service.onrender.com` |

   `PORT` Render khud set karta hai; local run ke liye `.env.example` ka `PORT=10000` theek hai. Render ko apna runtime `PORT` use karne dein.
5. **Create Web Service / Deploy** karein. Deploy hone par Render jo asal URL de, use `ALLOWED_ORIGIN` mein bina trailing slash set karein aur service redeploy karein.
6. Firebase ke **Authorized domains** mein bhi wahi live hostname add karein (sirf hostname, `https://` nahi). Firebase aur Render dono changes ke baad login check karein.
7. `https://Aapka-Asal-Render-Domain/api/health` kholkar `{"status":"ok"}` check karein. Phir site par Google login, registration aur incorrect-code flow test karein. Winner test karne ke liye do alag Google accounts/browser profiles use karein.

### Local computer par run karna

PowerShell mein project folder ke andar:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

`.env` mein Firebase ke upar wale web config values, poora private service-account JSON, apna `WINNING_CODE`, `ADMIN_EMAIL`, aur `ALLOWED_ORIGIN=http://localhost:10000` set karein. Browser mein `http://localhost:10000` kholein. Firebase Authorized domains mein `localhost` hona zaruri hai. Test chalane ke liye `npm test` run karein.

**Yaad rahe:** Firebase project/key banana, apna admin email aur secret set karna, GitHub par private repo push karna, aur Render deploy karna aapke apne accounts mein karna hoga. Project mein koi real Firebase key ya deployment URL hardcode nahi hai.

## Requirements

- Node.js 20 or newer and npm.
- A Firebase project with Google Authentication and Firestore enabled.
- A Firebase service account key for the backend. Treat this as a secret.
- One Google account with a verified email for the administrator.

No Firebase server credentials/service-account key, production URL, or winning code are included in this repository. The Firebase web-app config you supplied is prefilled in `.env.example`; it is public client configuration, not a service-account credential. Firebase configuration is read from the service environment; `/api/config` returns only the public web-app values, never the service account or winning code. Firebase Analytics (`measurementId`) is not used by this app.

## Run locally

1. Copy `.env.example` to `.env` and replace every placeholder with values from your Firebase project. Set `WINNING_CODE` to your chosen six-digit secret only in your private local `.env` and the private Render environment. Never put the secret in source files or commit it.
2. Set `ALLOWED_ORIGIN=http://localhost:10000`.
3. Keep the Firebase service-account JSON in the single-line `FIREBASE_SERVICE_ACCOUNT_JSON` variable. Do not commit `.env` or the service-account key.
4. Install and start:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:10000`. For Google sign-in locally, add `localhost` to Firebase Authentication's authorized domains.

Run the automated tests with `npm test`. Tests use an in-memory Firestore substitute and stub token verification; they do not need credentials or contact Firebase.

## Create and configure Firebase

1. In the [Firebase console](https://console.firebase.google.com/), create a project.
2. Add a Web App under Project settings → General. Copy its Web API Key, project ID, auth domain, and App ID into `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, and `FIREBASE_APP_ID`. These web-app settings are public identifiers, not credentials.
3. Under Authentication → Sign-in method, enable **Google** and choose the support email.
4. Under Authentication → Settings → Authorized domains, add `localhost` for local testing and the exact deployed Render domain (or your own custom frontend domain).
5. Create Cloud Firestore in production mode. The server will use these collections:
   - `users/{firebaseUid}`: private registration profile.
   - `gameState/currentWinner`: the one public-safe winner record.
   - `privateWinners/current`: the winner's private contact information and payment audit fields.
6. Publish the contents of [`firestore.rules`](./firestore.rules). They deny all browser reads and writes. The Express service uses the Admin SDK, which bypasses client rules. Do not loosen these rules to make the client work.
7. In Project settings → Service accounts, generate a private key. Store the complete JSON securely as `FIREBASE_SERVICE_ACCOUNT_JSON`; set `FIREBASE_PROJECT_ID` to the same project. Never put this JSON in the frontend, Git, screenshots, issue trackers, or a public deployment setting.
8. Set `ADMIN_EMAIL` to the exact Google account email that should administer the game. The backend checks both that email and Firebase's verified-email claim on every admin request.

## Registration, privacy, and security

- Users authenticate with Google; the backend verifies Firebase ID tokens (including revocation checking) on every protected request.
- Registration requires a display username, international-format mobile number, and UPI ID. Do not enter a UPI PIN, bank password, or OTP.
- Registration and the winning record are kept in private Firestore collections. The public game-state endpoint returns only the username, prize, and timestamp. It never returns email, phone, UPI ID, or UID.
- User-provided values are displayed as text, not HTML. API inputs are validated server-side; the code endpoint is rate-limited.
- Security headers and same-origin CORS are enabled. Set `ALLOWED_ORIGIN` to the exact public website origin, without a trailing slash. This setup serves UI and API from one origin; if you separate them, update CORS and the browser's API URL deliberately.
- Firestore transactions protect the winner slot. The browser cannot inspect or reset it. Firestore Admin SDK access is privileged, so secure the service account and Render access.
- The optional admin payment action only records the admin's confirmation and timestamp; it does not send money. Use it only after payment is actually complete.

## Deploy to Render

1. Push this project to a **private** GitHub repository. Check that `.env` and all service-account files are excluded before pushing.
2. In Render, create **New → Web Service** and connect the repository.
3. Choose a Node runtime. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
4. Add these environment variables in Render's Environment settings:
   - `PORT`: `10000` (Render provides a port; the app also reads its runtime `PORT`).
   - `WINNING_CODE`: the private six-digit code chosen for this competition.
   - `ADMIN_EMAIL`: the verified administrator account email.
   - `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`.
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete service account JSON as a protected secret.
   - `ALLOWED_ORIGIN`: the exact deployed site origin, such as `https://your-service.onrender.com` after Render assigns it. Do not paste that example as if it were your real deployment URL.
5. Deploy. Add the assigned host (or your custom domain) to Firebase Authentication's authorized domains, then redeploy if you changed frontend/API settings.
6. Visit `/api/health` on your deployed host; it should return `{"status":"ok"}`. Visit the site and test Google login, registration, and an incorrect code.
7. Test a winner using two separate Google accounts in separate browser profiles. Verify that only the first accepted correct submission receives a win response, refresh the site to verify winner persistence, and confirm the public page reveals no private contact details. Do not use the real prize flow unless you intend to run the competition.

The Firebase credentials, Firebase project setup, Google authorized domains, Render environment configuration, GitHub repository, and actual deployment are actions you must complete with your own accounts. The project intentionally does not invent these values.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/health` | Public | Non-sensitive health check |
| `GET /api/config` | Public | Firebase web-app config only |
| `GET /api/game-state` | Public | Game availability and safe winner summary |
| `GET /api/me` | Firebase user | Current user's registration state |
| `POST /api/register` | Firebase user | Validate and save the user's private profile |
| `POST /api/submit-code` | Registered Firebase user | Validate code and atomically claim the winner slot |
| `GET /api/admin/winner` | Configured verified admin | Read private winner and payment status |
| `POST /api/admin/mark-paid` | Configured verified admin | Record confirmed payment with audit timestamp |

## Clues

The first two clues link to the supplied Google Maps coordinates. No coordinates were supplied for clue 3, so the page shows its text without fabricating a map location.

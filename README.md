# CBT Practice Arena

A JAMB style CBT practice website for a 100 level class. Everyone opens the same link on their phone, writes practice tests and sees **one shared live leaderboard**.

- 5 courses: Use of English (GNS), Primary Health Care (PHC), General Chemistry (CHM), Action and Use of Medicine (AUM) and Physics (PHY)
- 1,358 questions (GNS 332, PHC 303, CHM 311, AUM 314, PHY 98), each with an explanation. Physics comes word for word from the class PHY 111 question file.
- Students choose the courses for each exam: one, several or all. 45 questions and 30 minutes per course.
- Leaderboards: one per course, plus an Overall leaderboard (average of best course scores, after 4 courses)
- A student never sees the same question again until they have gone through the whole bank for that course
- Live class leaderboard (Firebase), corrections with explanations, works on any phone

You can set everything up **using only a phone**. Follow the steps in order. It takes about 20 minutes.

---

## What is in this folder

| File | What it is |
|---|---|
| `single-file/index.html` | **The whole website in ONE file.** This is the easiest one to upload from a phone. |
| `index.html`, `css/`, `js/` | The same website as separate files (easier to edit on a computer). |
| `js/config.js` | Settings and Firebase keys (in the one-file version they are at the very top of the file). |
| `js/questions/*.js` | One question file per course. |
| `firestore.rules` | Security rules you paste into Firebase. |
| `tools/`, `tests/` | Optional checks for developers. You do not need them. |

Before you add Firebase keys, the site works in **demo mode**: a small banner says "Demo mode: scores are saved only on this device." Everything works, but the leaderboard is not shared. Steps 1 to 3 below fix that.

**Tip for every step:** in Chrome on your phone, tap the three dots (top right) and tick **Desktop site**. Firebase and GitHub are much easier to use that way. Zoom in with two fingers when you need to.

---

## Step 1. Create the Firebase project and database

1. Open **console.firebase.google.com** in Chrome (Desktop site ON) and sign in with your Google account.
2. Tap **Create a project** (or **Get started with a Firebase project**).
3. Type a name, for example `class-cbt`. Tick the box to accept the terms and tap **Continue**.
4. When asked about Google Analytics, switch it **off** and tap **Create project**. Wait, then tap **Continue**.
5. In the menu on the left, tap **Build**, then **Firestore Database**.
6. Tap **Create database**.
   - **Location:** pick one close to Nigeria, for example `europe-west2 (London)` or `africa-south1 (Johannesburg)`. You cannot change this later. Tap **Next**.
   - Choose **Start in production mode**. Tap **Create**.
7. Wait until you see an empty database. Done.

## Step 2. Paste the security rules

The rules protect the leaderboard: nobody can delete records, change their name or matric number, lower a best score or set a score above 100%.

1. Open the file `firestore.rules` from this project and copy **all** of it.
   - On GitHub: tap the file, tap **Raw**, long-press the text, tap **Select all**, then **Copy**.
2. In Firebase, still in **Firestore Database**, tap the **Rules** tab at the top.
3. Long-press inside the box, **Select all**, and delete everything that is there.
4. Paste the rules you copied.
5. Tap **Publish**. You should see "Rules published" (or the new date at the top).

## Step 3. Get your Firebase keys and paste them into the website

1. In Firebase, tap the **gear icon** (next to "Project Overview", top left), then **Project settings**.
2. Scroll down to **Your apps**. Tap the **web icon**: it looks like `</>`.
3. Type a nickname (for example `cbt-web`). Do **not** tick Firebase Hosting. Tap **Register app**.
4. You will see code that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "class-cbt.firebaseapp.com",
     projectId: "class-cbt",
     storageBucket: "class-cbt.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

   Keep this page open (you can find it again any time under Project settings > Your apps).
5. Open the website file you are going to upload (`single-file/index.html`, or `js/config.js` if you use the full folder). Near the top you will see:

   ```js
   firebase: {   /* PASTE KEYS below */
     apiKey: "",
     authDomain: "",
     projectId: "",
     storageBucket: "",
     messagingSenderId: "",
     appId: ""
   },
   ```

6. Copy each value from Firebase **between the quotes**. Keep the quotes and the commas. It should end up like:

   ```js
   firebase: {   /* PASTE KEYS below */
     apiKey: "AIzaSy...",
     authDomain: "class-cbt.firebaseapp.com",
     projectId: "class-cbt",
     storageBucket: "class-cbt.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   },
   ```

> These keys are not passwords. They are meant to be inside a website. Your data is protected by the rules from Step 2.

The easiest way on a phone is to upload the file first (Step 4) and then paste the keys using GitHub's built-in editor (Step 4, part C).

## Step 4. Put the website online with GitHub Pages (from your phone)

### A. Create the repository
1. Open **github.com** in Chrome (Desktop site ON). Sign up or log in.
2. Tap the **+** (top right), then **New repository**.
3. Repository name: `cbt` (or any short name). Choose **Public**. Tick **Add a README file**. Tap **Create repository**.

### B. Upload the one-file website
1. Download `single-file/index.html` from this project to your phone. Its name must be exactly `index.html`.
2. In your new repository, tap **Add file**, then **Upload files**.
3. Tap **choose your files** and pick `index.html`.
4. Scroll down and tap **Commit changes**.

### C. Paste your Firebase keys on GitHub (skip if you already did it in Step 3)
1. In the repository, tap `index.html`.
2. Tap the **pencil icon** (Edit this file).
3. The Firebase keys block is near the very top (look for `PASTE KEYS`). Paste your values between the quotes as shown in Step 3.
4. Tap **Commit changes**, then **Commit changes** again.

### D. Turn on GitHub Pages
1. In the repository, tap **Settings** (top menu; scroll the menu sideways if needed).
2. In the left menu, tap **Pages**.
3. Under **Build and deployment**, Source: **Deploy from a branch**. Branch: **main**, folder **/ (root)**. Tap **Save**.
4. Wait 1 to 2 minutes and refresh. A link appears at the top, like `https://your-username.github.io/cbt/`. **This is the link you share with the class.**

Every time you edit `index.html` on GitHub, the site updates by itself within a couple of minutes.

> **Netlify instead of GitHub?** On a computer you can drag the whole folder onto **app.netlify.com/drop**. Either way works; the site is fully static.

## Step 5. Test with two phones that the leaderboard is shared

1. **Phone 1:** open your link. You should **not** see the "Demo mode" banner. If you do, the keys were not pasted correctly (check the quotes and commas).
2. Phone 1: tap **Sign up**, enter a full name and a matric number. Start an exam, answer a few questions, tap **Submit**, then **Yes, submit**. You should see "You're currently #1 on the leaderboard".
3. **Phone 2:** open the same link. Sign up with a **different** matric number. On the dashboard, the leaderboard should show Phone 1's student, with a green **Live** dot.
4. Leave Phone 1 on the dashboard. On Phone 2, take an exam and submit. Within a few seconds, **Phone 1's leaderboard changes by itself**, without refreshing.
5. Optional: log out on Phone 2 and log in with Phone 1's matric number. Their best score, attempts and "questions seen" all come along, and they get **new** questions.

If something fails, see **Troubleshooting** below.

---

## Changing settings

All settings are in the settings block (`js/config.js`, or at the top of `single-file/index.html`):

| Setting | What it does | Default |
|---|---|---|
| `siteName` | Name at the top of the site | `CBT Practice Arena` |
| `className` | Text under the name | `100 Level` |
| `questionsPerCourse` | Questions per course in each exam | `45` |
| `minutesPerCourse` | Time per chosen course (1 course = 30 min, 4 courses = 120 min) | `30` |
| `overallMinCourses` | Courses a student must take before appearing on the Overall leaderboard | `4` |
| `warnAtMinutes` | Timer turns amber with a warning | `10` |
| `dangerAtMinutes` | Timer turns red and blinks | `5` |
| `requirePin` | `true` = students choose a 4 digit PIN at sign up and need it to log in | `false` |
| `leaderboardSize` | How many students the live leaderboard shows | `100` |
| `courses` | The courses students can choose, in order | GNS, PHC, CHM, AUM, PHY |

**About the PIN:** decide before you share the link. With `requirePin: false`, anyone who knows a matric number can log in as that student. With `requirePin: true`, they also need the PIN. Accounts created while the PIN was off have no PIN and can still log in with the matric number only.

## Adding or editing questions

Each course has its own file in `js/questions/` (in the one-file version, the questions are inside `index.html`; use the editor's search to find an ID such as `PHC-120`). Each question is **one line**:

```js
{"id": "PHC-120", "topic": "Alma-Ata Declaration", "q": "The Alma-Ata Declaration was signed in", "options": ["1978", "1948", "1988", "2000"], "answer": 0, "explain": "The conference took place from 6 to 12 September 1978."},
```

- `options`: exactly 4 choices, each in quotes, separated by commas.
- `answer`: the position of the correct option, counting from **0**: `0` = first, `1` = second, `2` = third, `3` = fourth.
- `id`: must be unique and must **never change** (the site uses it to remember which questions each student has seen). For a new question, use the next unused number, for example `PHC-304`.
- `topic`: use one of the topic names already in that file so exams stay balanced across topics.
- Options are shuffled for every student, so never write "All of the above", "None of the above" or "A and B".
- Keep the comma at the end of the line.

To **edit**, change the text inside the quotes. To **remove** a question, delete its whole line (students who already saw it are not affected).

On a computer you can check all the files with `node tools/validate-questions.js` (it finds missing answers, wrong option counts, duplicate IDs and near duplicate questions), and rebuild the one-file version with `node tools/build-bundle.js`.

---

## How it works (in plain words)

- **Different questions for every student.** Each exam picks 45 questions per course at random, spread evenly over all the topics. Question order and the order of options A to D are shuffled for every student.
- **No repeats.** The IDs of the questions a student has seen are saved in Firebase (and on the phone as a backup). New exams only use questions they have not seen. When they have seen the whole bank for a course, it starts a fresh round.
- **Refresh safe.** Answers and the timer are saved on the phone during the exam, so a refresh or a closed tab does not lose anything. When time runs out, the exam is submitted automatically.
- **Offline submit.** If the internet drops at the moment of submitting, the score is kept on the phone and sent to the leaderboard automatically the next time the site is opened with internet.
- **Choosing courses.** When a student taps Start exam, they tick the courses they want. Each course adds 45 questions and 30 minutes.
- **Leaderboards.** Each course has its own leaderboard, ranked by each student's best score in that course. The Overall leaderboard ranks the average of a student's best course scores, and only includes students who have taken at least 4 courses (so nobody tops it by taking only their easiest course). Ties: whoever reached the score first ranks higher.
- **Physics.** The 98 Physics questions are copied exactly from the PHY 111 file (2 word-for-word repeats in the file were kept only once). Because the bank is smaller, Physics questions start repeating after about 2 exams, once a student has seen them all.

## Will it stay free?

Firebase's free plan allows 50,000 reads and 20,000 writes per day. Roughly, each time a student opens the dashboard it reads about `leaderboardSize` records (100), plus a few more for sign in and exams, and each submitted exam costs every phone currently on the dashboard one read. A class of 250 opening the site once or twice a day stays within the free plan. If Firebase ever warns you about the limit, set `leaderboardSize` to `50`.

## Honest limits

- There are no passwords (only matric number and an optional PIN), so this is for practice, not for official grades.
- Scores are worked out on the student's phone. The rules stop the obvious cheating (no scores above 100%, no deleting, no lowering scores, attempts only go up by one), but a determined, technical student could still send a fake score. Treat the leaderboard as friendly competition.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Demo mode" banner after adding keys | A key is missing or a quote or comma was deleted. Compare with the example in Step 3. |
| "The server refused this request..." | The rules were not published. Repeat Step 2 and tap **Publish**. |
| "We could not reach the server..." | Check the phone's internet. Try again. |
| "No account found for this matric number" | Check the matric number, or tap **Sign up**. |
| Leaderboard says "Offline" | The phone lost internet. It reconnects by itself. |
| Site not updating after an edit | Wait 2 minutes, then refresh. GitHub Pages takes a moment. |

---

## For developers (optional)

```bash
node tools/validate-questions.js       # check all question banks (1,260 questions, no near duplicates)
node tools/build-bundle.js             # rebuild single-file/index.html (needs: cd tests && npm install)
cd tests && npm install
node engine.test.cjs                   # exam picking simulations (repeats, randomness, marking)
npm run rules                          # Firestore rules tests on the emulator (needs Java)
npm run e2e                            # full browser tests incl. two phones on one live leaderboard
```

Designed by Faruk Dynova.

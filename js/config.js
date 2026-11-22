/*
 * =====================================================================
 *  CBT PRACTICE: SETTINGS FILE
 *  This is the ONLY file you need to edit to connect Firebase and to
 *  change exam settings. Keep the quotes "" and commas , exactly as
 *  they are and only change the values.
 * =====================================================================
 */
window.CBT_CONFIG = {

  /* -------------------------------------------------------------------
   * 1. FIREBASE KEYS
   * Paste the values from: Firebase console > Project settings (gear icon)
   * > General > Your apps > SDK setup and configuration > Config.
   *
   * While apiKey and projectId are empty, the site runs in DEMO MODE:
   * everything works, but scores are saved only on that one phone and
   * the leaderboard is NOT shared. Fill these in to share it with the class.
   * ------------------------------------------------------------------- */
  firebase: {
    apiKey: "AIzaSyCJbk1d_cdvpZxkC8WWs-O29lFhg0878VA",
    authDomain: "class-cbt.firebaseapp.com",
    projectId: "class-cbt",
    storageBucket: "class-cbt.firebasestorage.app",
    messagingSenderId: "644155723404",
    appId: "1:644155723404:web:d6433658019f9abdcf5a9"
  },

  /* -------------------------------------------------------------------
   * 2. EXAM SETTINGS
   * ------------------------------------------------------------------- */
  siteName: "CBT Practice Arena",       // shown at the top of every page
  className: "100 Level",               // shown under the site name
  questionsPerCourse: 45,               // questions per course in each exam (45 x 4 = 180, like JAMB)
  examMinutes: 120,                     // total time for ALL courses together
  warnAtMinutes: 10,                    // timer turns amber and shows a warning
  dangerAtMinutes: 5,                   // timer turns red and blinks

  /* Courses in the order the tabs appear. The code must match the code
   * inside the question file (js/questions/xxx.js). */
  courses: [
    { code: "GST", title: "Use of English" },
    { code: "PHC", title: "Primary Health Care" },
    { code: "CHM", title: "General Chemistry" },
    { code: "AUM", title: "Action and Use of Medicine" }
  ],

  /* -------------------------------------------------------------------
   * 3. LOGIN SETTINGS
   * requirePin: true  = students choose a 4 digit PIN at sign up and must
   *                     type it to log in (stops people logging in as others).
   * requirePin: false = log in with matric number only.
   * Decide this BEFORE sharing the link. Accounts created while it was
   * false have no PIN and can still log in with matric number only.
   * ------------------------------------------------------------------- */
  requirePin: false,

  /* -------------------------------------------------------------------
   * 4. LEADERBOARD SETTINGS
   * leaderboardSize: how many students are loaded and shown live.
   * Each phone that opens the dashboard reads this many records once,
   * so lower it (e.g. 50) if you ever get close to the free Firebase limit.
   * ------------------------------------------------------------------- */
  leaderboardSize: 100,

  /* Footer credit on the login and dashboard pages */
  credit: "Designed by Faruk Dynova"
};

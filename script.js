import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  doc,
  setDoc,
  collection,
  onSnapshot,
  addDoc,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFKAnb3hipbmCFOujKIpdh3jbp18RFGlE",
  authDomain: "sharenet-reimagined.firebaseapp.com",
  projectId: "sharenet-reimagined",
  storageBucket: "sharenet-reimagined.firebasestorage.app",
  messagingSenderId: "28034797053",
  appId: "1:28034797053:web:1c448f7fa2ad3ae5cbdd94",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Force long-polling instead of Firestore's default fetch-streaming
// transport — Safari (and some privacy extensions) block the streaming
// connection with an "access control checks" fetch error, which silently
// breaks every realtime listener on the page. Falls back gracefully if
// another script on this page already initialized Firestore first.
let db;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
  });
} catch (e) {
  db = getFirestore(app);
}

const authModal = document.getElementById("authModal");
const authNavBtn = document.getElementById("authNavBtn");
const closeModal = document.getElementById("closeModal");
const authForm = document.getElementById("authForm");
const modalTitle = document.getElementById("modalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const toggleAuthMode = document.getElementById("toggleAuthMode");
const toggleMsg = document.getElementById("toggleMsg");
const counterDisplay = document.querySelector(".member-counter h2");

const notificationBellBtn = document.getElementById("notificationBellBtn");
const navNotificationsLink = document.getElementById("navNotificationsLink");
const notificationBadge = document.getElementById("notificationBadge");
const navProfileAvatar = document.getElementById("navProfileAvatar");

let isLoginMode = true;

if (notificationBellBtn) {
  notificationBellBtn.addEventListener("click", () => {
    window.location.href = "notifications.html";
  });
}
if (navNotificationsLink) {
  navNotificationsLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "notifications.html";
  });
}

if (authNavBtn) {
  authNavBtn.addEventListener("click", () => {
    if (auth.currentUser) {
      signOut(auth)
        .then(() => alert("Signed out successfully!"))
        .catch((error) => alert(error.message));
    } else {
      authModal.style.display = "flex";
    }
  });
}
if (closeModal)
  closeModal.addEventListener("click", () => {
    authModal.style.display = "none";
  });

if (toggleAuthMode) {
  toggleAuthMode.addEventListener("click", (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    modalTitle.innerText = isLoginMode ? "Log In" : "Sign Up";
    authSubmitBtn.innerText = isLoginMode ? "Log In" : "Sign Up";
    toggleMsg.innerText = isLoginMode
      ? "Don't have an account?"
      : "Already have an account?";
    toggleAuthMode.innerText = isLoginMode ? "Sign Up" : "Log In";
  });
}

if (authForm) {
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    if (isLoginMode) {
      signInWithEmailAndPassword(auth, email, password)
        .then(() => {
          authModal.style.display = "none";
          authForm.reset();
        })
        .catch((error) => alert("Login Error: " + error.message));
    } else {
      createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
          const user = userCredential.user;
          const targetName = email.split("@")[0];

          setDoc(doc(db, "users", user.uid), {
            email: user.email,
            createdAt: new Date(),
          }).then(() => {
            addDoc(collection(db, "notifications"), {
              title: "New Account Creation",
              message: `Welcome to the community! User "${targetName}" has registered a profile.`,
              type: "account_creation",
              createdAt: new Date(),
              viewedBy: [],
            });
            authModal.style.display = "none";
            authForm.reset();
            alert("Account created successfully!");
          });
        })
        .catch((error) => alert("Signup Error: " + error.message));
    }
  });
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    authNavBtn.innerText = "Sign Out";
    if (authModal) authModal.style.display = "none";
    const username = user.email.split("@")[0];
    if (navProfileAvatar)
      navProfileAvatar.innerText = username.charAt(0).toUpperCase();
  } else {
    authNavBtn.innerText = "Log In";
    if (navProfileAvatar) navProfileAvatar.innerText = "?";
  }
  syncNavNotificationBadgeOnly();
});

if (counterDisplay) {
  onSnapshot(collection(db, "users"), (snapshot) => {
    counterDisplay.innerText = `~${snapshot.size}`;
  });
}

function syncNavNotificationBadgeOnly() {
  const q = query(
    collection(db, "notifications"),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snapshot) => {
    let unreadCount = 0;
    snapshot.forEach((itemDoc) => {
      const entry = itemDoc.data();

      // SHIELD: Skip counting if current user created the notification
      if (auth.currentUser && entry.createdBy === auth.currentUser.uid) {
        return;
      }

      const viewedArray = entry.viewedBy || [];
      if (auth.currentUser && !viewedArray.includes(auth.currentUser.uid)) {
        unreadCount++;
      }
    });

    if (notificationBadge) {
      if (unreadCount > 0) {
        notificationBadge.innerText = unreadCount;
        notificationBadge.style.display = "block";
      } else {
        notificationBadge.style.display = "none";
      }
    }
  });
}

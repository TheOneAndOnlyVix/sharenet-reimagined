import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { computePermissions, waitForRoles, onRolesUpdated } from "./permissions.js";

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
const db = getFirestore(app);

// DOM Target Selectors
const authModal = document.getElementById("authModal");
const authNavBtn = document.getElementById("authNavBtn");
const closeModal = document.getElementById("closeModal");
const authForm = document.getElementById("authForm");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const modalTitle = document.getElementById("modalTitle");
const toggleAuthMode = document.getElementById("toggleAuthMode");
const toggleMsg = document.getElementById("toggleMsg");

const navProfileAvatar = document.getElementById("navProfileAvatar");
const notificationBadge = document.getElementById("notificationBadge");
const notificationsContainer = document.getElementById(
  "notificationsContainer"
);

let isSignUpMode = false;
let unsubscribeNotifications = null; // Track snapshot listener to prevent duplicates

if (authNavBtn) {
  authNavBtn.addEventListener("click", () => {
    if (auth.currentUser) {
      signOut(auth).then(() => alert("Signed Out!"));
    } else {
      isSignUpMode = false;
      modalTitle.innerText = "Log In";
      authSubmitBtn.innerText = "Log In";
      toggleMsg.innerText = "Don't have an account?";
      toggleAuthMode.innerText = "Sign Up";
      authModal.style.display = "flex";
    }
  });
}

if (closeModal) {
  closeModal.addEventListener("click", () => {
    authModal.style.display = "none";
  });
}

if (toggleAuthMode) {
  toggleAuthMode.addEventListener("click", (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    if (isSignUpMode) {
      modalTitle.innerText = "Sign Up";
      authSubmitBtn.innerText = "Register";
      toggleMsg.innerText = "Already registered?";
      toggleAuthMode.innerText = "Log In";
    } else {
      modalTitle.innerText = "Log In";
      authSubmitBtn.innerText = "Log In";
      toggleMsg.innerText = "Don't have an account?";
      toggleAuthMode.innerText = "Sign Up";
    }
  });
}

if (authForm) {
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    if (isSignUpMode) {
      createUserWithEmailAndPassword(auth, email, password)
        .then((credential) => {
          authModal.style.display = "none";
          authForm.reset();
        })
        .catch((error) => alert("Signup error: " + error.message));
    } else {
      signInWithEmailAndPassword(auth, email, password)
        .then(() => {
          authModal.style.display = "none";
          authForm.reset();
        })
        .catch((error) => alert("Login error: " + error.message));
    }
  });
}

let currentNotifUserData = null;
let notifMyPermissions = computePermissions(null, null);

// Global Auth State Observer with Safe Guard Routing
onAuthStateChanged(auth, async (user) => {
  if (user) {
    if (authNavBtn) authNavBtn.innerText = "Sign Out";
    if (authModal) authModal.style.display = "none";
    const baseName = user.email.split("@")[0];
    if (navProfileAvatar) {
      navProfileAvatar.innerText = baseName.charAt(0).toUpperCase();
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      currentNotifUserData = snap.exists() ? snap.data() : null;
    } catch (e) {
      currentNotifUserData = null;
    }
    await waitForRoles();
    notifMyPermissions = computePermissions(user, currentNotifUserData);

    if (notifMyPermissions.permissions.canViewNotifications) {
      // Safe to initialize now that user context exists
      initializeLiveNotificationsEngine();
    } else {
      if (unsubscribeNotifications) {
        unsubscribeNotifications();
        unsubscribeNotifications = null;
      }
      if (notificationBadge) notificationBadge.style.display = "none";
      showRestrictedNotifications();
    }
  } else {
    if (authNavBtn) authNavBtn.innerText = "Log In";
    if (navProfileAvatar) navProfileAvatar.innerText = "?";
    if (notificationBadge) notificationBadge.style.display = "none";
    currentNotifUserData = null;
    notifMyPermissions = computePermissions(null, null);

    // Detach any previous engine streams safely
    if (unsubscribeNotifications) {
      unsubscribeNotifications();
      unsubscribeNotifications = null;
    }

    // Inform user they must authenticate to see alerts instead of infinite loading/crashing
    if (notificationsContainer) {
      notificationsContainer.innerHTML = `
        <div style="text-align: center; padding: 40px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color);">
          <h3 style="color: var(--accent-purple); margin-bottom: 10px;">Authentication Required</h3>
          <p style="color: var(--text-muted); font-size: 14px;">Please Log In or Create an Account to track workspace stream alerts.</p>
        </div>
      `;
    }
  }
});

function showRestrictedNotifications() {
  if (notificationsContainer) {
    notificationsContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color);">
        <h3 style="color: var(--accent-purple); margin-bottom: 10px;">Notifications Restricted</h3>
        <p style="color: var(--text-muted); font-size: 14px;">Your account role does not currently allow you to view notifications.</p>
      </div>
    `;
  }
}

// Re-evaluate live if the signed-in user's role changes while this page
// is open (e.g. an admin toggles canViewNotifications on/off).
onRolesUpdated(() => {
  if (!auth.currentUser) return;
  notifMyPermissions = computePermissions(auth.currentUser, currentNotifUserData);
  if (notifMyPermissions.permissions.canViewNotifications) {
    initializeLiveNotificationsEngine();
  } else {
    if (unsubscribeNotifications) {
      unsubscribeNotifications();
      unsubscribeNotifications = null;
    }
    if (notificationBadge) notificationBadge.style.display = "none";
    showRestrictedNotifications();
  }
});

// Live Updates Engine with Safe Guard
function initializeLiveNotificationsEngine() {
  // If we already have a live stream open, don't double bind it
  if (unsubscribeNotifications) return;

  const q = query(
    collection(db, "notifications"),
    orderBy("createdAt", "desc")
  );

  unsubscribeNotifications = onSnapshot(q, (snapshot) => {
    if (!auth.currentUser) return; // Prevent background execution if user signs out mid-stream

    if (notificationsContainer) {
      notificationsContainer.innerHTML = "";
    }

    let unreadCount = 0;

    if (snapshot.empty) {
      if (notificationsContainer) {
        notificationsContainer.innerHTML = `<p class="loading-text">No workspace stream alerts found.</p>`;
      }
      if (notificationBadge) notificationBadge.style.display = "none";
      return;
    }

    snapshot.forEach((itemDoc) => {
      const entry = itemDoc.data();

      // SHIELD: Skip if you created this notification
      if (auth.currentUser && entry.createdBy === auth.currentUser.uid) {
        return;
      }

      // ITEM 6 — Don't show post/comment notifications for groups the
      // current user isn't a member of (groupMembers null = global/no group = show to all)
      if (
        entry.groupMembers !== null &&
        entry.groupMembers !== undefined &&
        Array.isArray(entry.groupMembers) &&
        !entry.groupMembers.includes(auth.currentUser.uid)
      ) {
        return;
      }

      const viewedArray = entry.viewedBy || [];

      if (!viewedArray.includes(auth.currentUser.uid)) {
        unreadCount++;
        const docRef = doc(db, "notifications", itemDoc.id);
        updateDoc(docRef, {
          viewedBy: arrayUnion(auth.currentUser.uid),
        }).catch((err) =>
          console.error("Failed updating badge read array state: ", err)
        );
      }

      if (notificationsContainer) {
        let timeFormatted = "Just now";
        if (entry.createdAt && entry.createdAt.toDate) {
          timeFormatted = entry.createdAt.toDate().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
        }

        let notifTypeClass = "notif-default";
        if (entry.type && entry.type.includes("deletion")) {
          notifTypeClass = "notif-deletion";
        } else if (entry.type && entry.type.includes("creation")) {
          notifTypeClass = "notif-creation";
        }

        // Build a link to the source if we have enough info
        let sourceHref = null;
        if (entry.postId && entry.groupId) {
          sourceHref = `groups.html?group=${entry.groupId}&post=${entry.postId}`;
        } else if (entry.postId) {
          sourceHref = `groups.html?post=${entry.postId}`;
        } else if (entry.groupId) {
          sourceHref = `groups.html?group=${entry.groupId}`;
        }

        // Preview snippet
        const previewHtml = entry.preview
          ? `<p class="notif-preview">"${entry.preview}${entry.preview.length >= 120 ? "…" : ""}"</p>`
          : "";

        const notificationCard = document.createElement(sourceHref ? "a" : "div");
        notificationCard.className = `update-card notif-card ${notifTypeClass}${sourceHref ? " notif-card-link" : ""}`;
        if (sourceHref) {
          notificationCard.href = sourceHref;
          notificationCard.style.textDecoration = "none";
          notificationCard.style.display = "block";
          notificationCard.style.color = "inherit";
        }

        notificationCard.innerHTML = `
          <h4 class="notif-title">${entry.title || "System Notification"}</h4>
          <p class="notif-message">${entry.message || ""}</p>
          ${previewHtml}
          <small class="notif-time">${timeFormatted}</small>
        `;
        notificationsContainer.appendChild(notificationCard);
      }
    });

    // Handle badge rendering elements across layout
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

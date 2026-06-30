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
  doc,
  getDoc,
  collection,
  onSnapshot,
  deleteDoc,
  addDoc,
  updateDoc,
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
const db = getFirestore(app);

const SITE_ADMIN_EMAIL = "ogheneovieumebese@gmail.com";
let currentGlobalRole = "member"; // Track current user's DB role

// DOM Elements
const authModal = document.getElementById("authModal");
const authNavBtn = document.getElementById("authNavBtn");
const closeModal = document.getElementById("closeModal");
const authForm = document.getElementById("authForm");
const modalTitle = document.getElementById("modalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const toggleAuthMode = document.getElementById("toggleAuthMode");
const toggleMsg = document.getElementById("toggleMsg");
const membersGrid = document.getElementById("membersGrid");

const notificationBellBtn = document.getElementById("notificationBellBtn");
const navNotificationsLink = document.getElementById("navNotificationsLink");
const notificationBadge = document.getElementById("notificationBadge");
const navProfileAvatar = document.getElementById("navProfileAvatar");

// Admin Panel Elements
const membersAdminPanel = document.getElementById("membersAdminPanel");
const userSelectDropdown = document.getElementById("userSelectDropdown");
const promoteToAdminBtn = document.getElementById("promoteToAdminBtn");
const demoteToMemberBtn = document.getElementById("demoteToMemberBtn");

let isLoginMode = true;

// Fix Modals flashing on load
document.addEventListener("DOMContentLoaded", () => {
  if (authModal) authModal.style.display = "none";
});

// Notifications Routing
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

// Auth UI Logic
if (authNavBtn) {
  authNavBtn.addEventListener("click", () => {
    if (auth.currentUser) {
      signOut(auth)
        .then(() => alert("Signed out successfully!"))
        .catch((err) => alert(err.message));
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
        .catch((err) => alert("Login Error: " + err.message));
    } else {
      createUserWithEmailAndPassword(auth, email, password)
        .then((cred) => {
          setDoc(doc(db, "users", cred.user.uid), {
            email: cred.user.email,
            role: "member", // Default role
            createdAt: new Date(),
          }).then(() => {
            authModal.style.display = "none";
            authForm.reset();
            alert("Account created successfully!");
          });
        })
        .catch((err) => alert("Registration Error: " + err.message));
    }
  });
}

// Global Auth State Observer
onAuthStateChanged(auth, async (user) => {
  if (user) {
    authNavBtn.innerText = "Sign Out";
    if (authModal) authModal.style.display = "none";
    const username = user.email.split("@")[0];
    if (navProfileAvatar) {
      navProfileAvatar.innerText = username.charAt(0).toUpperCase();
      navProfileAvatar.style.display = "flex";
    }

    // Fetch user role from DB
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentGlobalRole = userDoc.data().role || "member";
      }
    } catch (e) {
      console.error("Failed fetching user role:", e);
    }

    // Evaluate Admin Panel Visibility
    if (user.email === SITE_ADMIN_EMAIL || currentGlobalRole === "admin") {
      if (membersAdminPanel) membersAdminPanel.style.display = "block";
    } else {
      if (membersAdminPanel) membersAdminPanel.style.display = "none";
    }
  } else {
    authNavBtn.innerText = "Log In";
    if (navProfileAvatar) navProfileAvatar.style.display = "none";
    if (membersAdminPanel) membersAdminPanel.style.display = "none";
    currentGlobalRole = "member";
  }
  renderMembersDirectory();
  syncNavNotificationBadgeOnly();
});

// Admin Controls Logic
if (promoteToAdminBtn) {
  promoteToAdminBtn.addEventListener("click", () => {
    const targetUid = userSelectDropdown.value;
    if (!targetUid) return alert("Select a user first.");
    updateDoc(doc(db, "users", targetUid), { role: "admin" })
      .then(() => alert("User successfully promoted to Admin!"))
      .catch((err) => alert("Error: " + err.message));
  });
}

if (demoteToMemberBtn) {
  demoteToMemberBtn.addEventListener("click", () => {
    const targetUid = userSelectDropdown.value;
    if (!targetUid) return alert("Select a user first.");
    updateDoc(doc(db, "users", targetUid), { role: "member" })
      .then(() => alert("User demoted to Member."))
      .catch((err) => alert("Error: " + err.message));
  });
}

// Render the Directory and populate Admin Dropdown
function renderMembersDirectory() {
  if (!membersGrid) return;
  onSnapshot(collection(db, "users"), (snapshot) => {
    membersGrid.innerHTML = "";
    if (userSelectDropdown)
      userSelectDropdown.innerHTML =
        '<option value="">Select a user...</option>';

    if (snapshot.empty) {
      membersGrid.innerHTML = `<p class="loading-text">No registered community members found.</p>`;
      return;
    }

    snapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      const userDocId = userDoc.id;
      const emailString = userData.email || "anonymous@school.edu";
      const username = emailString.split("@")[0];
      const displayName = userData.displayName || ""; // Set only if the user chose one
      const photoUrl = userData.photoUrl || "";
      const initial = (displayName || username).charAt(0).toUpperCase();
      const userRole = userData.role === "admin" ? "Admin" : "Member";

      // Populate Admin Dropdown
      if (userSelectDropdown && emailString !== SITE_ADMIN_EMAIL) {
        userSelectDropdown.innerHTML += `<option value="${userDocId}">${
          displayName || username
        } (${userRole})</option>`;
      }

      const isMe = auth.currentUser && auth.currentUser.uid === userDocId;
      const isAdmin =
        auth.currentUser &&
        (auth.currentUser.email === SITE_ADMIN_EMAIL ||
          currentGlobalRole === "admin");

      const deleteActionHTML =
        isMe || isAdmin
          ? `<button class="delete-btn" id="del-user-${userDocId}">Remove Account</button>`
          : "";

      const roleBadgeStyle =
        userRole === "Admin"
          ? 'style="color: #bb86fc; background: rgba(187, 134, 252, 0.1); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase;"'
          : 'style="color: #94a3b8; font-size: 13px;"';

      // Avatar: photo if available, otherwise initial letter
      const avatarInner = photoUrl
        ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : initial;

      // Only show display name row if the user has set one (and it differs from username)
      const displayNameRow =
        displayName && displayName !== username
          ? `<p class="member-display-name">${displayName}</p>`
          : "";

      const cardHTML = `
        <div class="member-card">
          <div class="member-card-avatar">${avatarInner}</div>
          <h3 class="member-name">@${username}</h3>
          ${displayNameRow}
          <p ${roleBadgeStyle}>${userRole}</p>
          <div style="margin-top: auto; width: 100%; padding-top: 16px;">
            ${deleteActionHTML}
          </div>
        </div>
      `;
      membersGrid.innerHTML += cardHTML;

      if (isMe || isAdmin) {
        setTimeout(() => {
          const btn = document.getElementById(`del-user-${userDocId}`);
          if (btn) {
            btn.onclick = () => {
              if (
                confirm(
                  `Are you sure you want to remove the profile record for ${username}?`
                )
              ) {
                addDoc(collection(db, "notifications"), {
                  title: "Account Deletion",
                  message: `The user account for "${username}" was removed from the system registry.`,
                  type: "account_deletion",
                  createdBy: auth.currentUser.uid, // Global Filter Ignore Logic
                  createdAt: new Date(),
                  viewedBy: [],
                }).then(() => {
                  deleteDoc(doc(db, "users", userDocId)).then(() => {
                    if (isMe) signOut(auth);
                  });
                });
              }
            };
          }
        }, 50);
      }
    });
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
      if (auth.currentUser && entry.createdBy === auth.currentUser.uid) return;

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

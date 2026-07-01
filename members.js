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
  getDocs,
  setDoc,
  collection,
  onSnapshot,
  deleteDoc,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  PERMISSION_DEFS,
  computePermissions,
  getRolesCache,
  onRolesUpdated,
  waitForRoles,
} from "./permissions.js";

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

let currentGlobalRole = "member"; // Legacy field, kept for back-compat
let currentUserData = null; // Full users/{uid} doc for the signed-in user
let currentPermissions = computePermissions(null, null); // Live permission set

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

// Management panel elements
const membersAdminPanel = document.getElementById("membersAdminPanel");
const manageRolesBtn = document.getElementById("manageRolesBtn");
const manageBadgesBtn = document.getElementById("manageBadgesBtn");

// Role Manager elements
const roleManagerModal = document.getElementById("roleManagerModal");
const closeRoleManagerModal = document.getElementById("closeRoleManagerModal");
const roleManagerList = document.getElementById("roleManagerList");
const openCreateRoleBtn = document.getElementById("openCreateRoleBtn");

// Create/Edit Role elements
const createRoleModal = document.getElementById("createRoleModal");
const closeCreateRoleModal = document.getElementById("closeCreateRoleModal");
const createRoleModalTitle = document.getElementById("createRoleModalTitle");
const roleNameInput = document.getElementById("roleNameInput");
const rolePermissionsGrid = document.getElementById("rolePermissionsGrid");
const deleteRoleBtn = document.getElementById("deleteRoleBtn");
const submitRoleBtn = document.getElementById("submitRoleBtn");

// Member Actions popup elements
const memberActionsModal = document.getElementById("memberActionsModal");
const closeMemberActionsModal = document.getElementById("closeMemberActionsModal");
const memberActionsTitle = document.getElementById("memberActionsTitle");
const memberActionsSubtitle = document.getElementById("memberActionsSubtitle");
const memberActionsBody = document.getElementById("memberActionsBody");

// Badge System Elements
const badgeManagerModal = document.getElementById("badgeManagerModal");
const closeBadgeManagerModal = document.getElementById("closeBadgeManagerModal");
const badgeManagerList = document.getElementById("badgeManagerList");
const openCreateBadgeBtn = document.getElementById("openCreateBadgeBtn");
const createBadgeModal = document.getElementById("createBadgeModal");
const closeCreateBadgeModal = document.getElementById("closeCreateBadgeModal");
const badgeTitleInput = document.getElementById("badgeTitleInput");
const badgeTextColorInput = document.getElementById("badgeTextColorInput");
const badgeBgColorInput = document.getElementById("badgeBgColorInput");
const badgeIconTabs = document.querySelectorAll(".badge-icon-tab");
const badgeIconLibraryPanel = document.getElementById("badgeIconLibraryPanel");
const badgeIconUploadPanel = document.getElementById("badgeIconUploadPanel");
const badgeIconGrid = document.getElementById("badgeIconGrid");
const badgeIconDropzone = document.getElementById("badgeIconDropzone");
const badgeIconFileInput = document.getElementById("badgeIconFileInput");
const badgeLivePreview = document.getElementById("badgeLivePreview");
const badgeLivePreviewIcon = document.getElementById("badgeLivePreviewIcon");
const badgeLivePreviewText = document.getElementById("badgeLivePreviewText");
const submitCreateBadgeBtn = document.getElementById("submitCreateBadgeBtn");
const badgeOverflowModal = document.getElementById("badgeOverflowModal");
const closeBadgeOverflowModal = document.getElementById("closeBadgeOverflowModal");
const badgeOverflowList = document.getElementById("badgeOverflowList");
const awardBadgeModal = document.getElementById("awardBadgeModal");
const closeAwardBadgeModal = document.getElementById("closeAwardBadgeModal");
const awardBadgeTargetLabel = document.getElementById("awardBadgeTargetLabel");
const awardBadgePickerList = document.getElementById("awardBadgePickerList");

// Curated Material Symbols icon set for the badge library
const BADGE_ICON_LIBRARY = [
  "military_tech", "star", "verified", "emoji_events", "local_fire_department",
  "bolt", "favorite", "diamond", "rocket_launch", "shield",
  "workspace_premium", "auto_awesome", "celebration", "groups", "psychology",
  "forum", "campaign", "trophy", "handshake", "thumb_up",
  "school", "music_note", "palette", "sports_esports", "code",
  "camera_alt", "edit", "lightbulb", "public", "volunteer_activism",
];

// In-memory cache of badge docs, keyed by badge ID — populated by the
// badges live listener and read by all rendering functions below.
let currentBadgesMap = {};
let selectedIconType = "symbol"; // "symbol" | "image"
let selectedIconValue = "military_tech"; // symbol name OR base64 image data
let isCreatingBadge = false;

// Role editor state
let editingRoleId = null; // null = creating a new role

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
            role: "member", // Default legacy role
            roleId: null,
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

    // Fetch full user doc so we can compute the live permission set
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      currentUserData = userDoc.exists() ? userDoc.data() : null;
      currentGlobalRole = (currentUserData && currentUserData.role) || "member";
    } catch (e) {
      console.error("Failed fetching user role:", e);
      currentUserData = null;
    }

    await waitForRoles();
    refreshCurrentPermissions(user);
  } else {
    authNavBtn.innerText = "Log In";
    if (navProfileAvatar) navProfileAvatar.style.display = "none";
    currentGlobalRole = "member";
    currentUserData = null;
    refreshCurrentPermissions(null);
  }
  renderMembersDirectory();
  syncNavNotificationBadgeOnly();
});

// Recompute the signed-in user's permission set and sync panel visibility.
// Re-run whenever auth changes AND whenever the live roles cache updates
// (in case an admin edits/deletes the role currently assigned to us).
function refreshCurrentPermissions(user) {
  currentPermissions = computePermissions(user, currentUserData);
  const perms = currentPermissions.permissions;

  const showRolesBtn = perms.makeRoles || perms.deleteRoles;
  const showBadgesBtn = perms.makeBadges || perms.deleteBadges;

  if (manageRolesBtn) manageRolesBtn.style.display = showRolesBtn ? "inline-block" : "none";
  if (manageBadgesBtn) manageBadgesBtn.style.display = showBadgesBtn ? "inline-block" : "none";
  if (membersAdminPanel) {
    membersAdminPanel.style.display = showRolesBtn || showBadgesBtn ? "block" : "none";
  }
  if (openCreateRoleBtn) {
    openCreateRoleBtn.style.display = perms.makeRoles ? "inline-block" : "none";
  }
}

onRolesUpdated(() => {
  refreshCurrentPermissions(auth.currentUser);
  renderMembersDirectory();
  if (roleManagerModal && roleManagerModal.style.display === "flex") {
    renderRoleManagerList();
  }
});

function isCurrentUserAdmin() {
  return currentPermissions.isOwner || currentPermissions.isLegacyAdmin;
}

// =============================================================================
//  ROLE SYSTEM
//  Data model:
//    roles/{roleId}     → { name, permissions: {key: bool, ...}, createdAt }
//    users/{uid}.roleId → id of the role assigned to that user (or null)
// =============================================================================

if (manageRolesBtn) {
  manageRolesBtn.addEventListener("click", () => {
    renderRoleManagerList();
    roleManagerModal.style.display = "flex";
  });
}
if (closeRoleManagerModal) {
  closeRoleManagerModal.addEventListener("click", () => {
    roleManagerModal.style.display = "none";
  });
}

function countUsersWithRole(roleId, callback) {
  getDocs(collection(db, "users")).then((snap) => {
    let count = 0;
    snap.forEach((d) => {
      if (d.data().roleId === roleId) count++;
    });
    callback(count);
  });
}

function renderRoleManagerList() {
  if (!roleManagerList) return;
  const roles = Object.values(getRolesCache());

  if (roles.length === 0) {
    roleManagerList.innerHTML = `<p class="loading-text">No custom roles created yet.</p>`;
    return;
  }

  const perms = currentPermissions.permissions;

  roleManagerList.innerHTML = roles
    .map((r) => {
      const permCount = Object.values(r.permissions || {}).filter(Boolean).length;
      return `
      <div class="badge-manager-row role-manager-row" data-role-row="${r.id}">
        <span class="role-pill" style="background: var(--accent-purple);">${r.name}</span>
        <div class="badge-manager-row-info">
          <span class="badge-manager-row-meta">${permCount} permission${permCount !== 1 ? "s" : ""}</span>
        </div>
        ${
          perms.makeRoles
            ? `<button type="button" class="badge-manager-delete-btn" data-edit-role-id="${r.id}" title="Edit role">
                 <span class="material-symbols-outlined" style="font-size:18px;">edit</span>
               </button>`
            : ""
        }
        ${
          perms.deleteRoles
            ? `<button type="button" class="badge-manager-delete-btn" data-delete-role-id="${r.id}" title="Delete role">
                 <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
               </button>`
            : ""
        }
      </div>
    `;
    })
    .join("");

  roleManagerList.querySelectorAll("[data-edit-role-id]").forEach((btn) => {
    btn.onclick = () => openRoleEditor(btn.getAttribute("data-edit-role-id"));
  });
  roleManagerList.querySelectorAll("[data-delete-role-id]").forEach((btn) => {
    btn.onclick = () => {
      const roleId = btn.getAttribute("data-delete-role-id");
      const role = getRolesCache()[roleId];
      if (!confirm(`Delete the "${role ? role.name : "role"}" role? Anyone currently assigned it will lose those permissions.`))
        return;
      deleteRoleEverywhere(roleId);
    };
  });
}

async function deleteRoleEverywhere(roleId) {
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const removalPromises = [];
    usersSnap.forEach((userDoc) => {
      if (userDoc.data().roleId === roleId) {
        removalPromises.push(
          updateDoc(doc(db, "users", userDoc.id), { roleId: null })
        );
      }
    });
    await Promise.all(removalPromises);
    await deleteDoc(doc(db, "roles", roleId));
  } catch (err) {
    alert("Error deleting role: " + err.message);
  }
}

// Build the permission checkbox grid once
if (rolePermissionsGrid) {
  rolePermissionsGrid.innerHTML = PERMISSION_DEFS.map(
    (p) => `
      <label class="role-permission-check">
        <input type="checkbox" data-perm-key="${p.key}" />
        <span class="role-permission-check-text">
          <strong>${p.label}</strong>
          <small>${p.hint}</small>
        </span>
      </label>
    `
  ).join("");
}

if (openCreateRoleBtn) {
  openCreateRoleBtn.addEventListener("click", () => openRoleEditor(null));
}
if (closeCreateRoleModal) {
  closeCreateRoleModal.addEventListener("click", () => {
    createRoleModal.style.display = "none";
  });
}

function openRoleEditor(roleId) {
  editingRoleId = roleId;
  const role = roleId ? getRolesCache()[roleId] : null;

  createRoleModalTitle.innerText = role ? "Edit Role" : "Create Role";
  submitRoleBtn.innerText = role ? "Save Changes" : "Create Role";
  roleNameInput.value = role ? role.name : "";

  const rolePerms = (role && role.permissions) || {};
  rolePermissionsGrid.querySelectorAll("input[data-perm-key]").forEach((cb) => {
    cb.checked = !!rolePerms[cb.getAttribute("data-perm-key")];
  });

  deleteRoleBtn.style.display =
    role && currentPermissions.permissions.deleteRoles ? "inline-block" : "none";

  createRoleModal.style.display = "flex";
}

if (deleteRoleBtn) {
  deleteRoleBtn.addEventListener("click", () => {
    if (!editingRoleId) return;
    const role = getRolesCache()[editingRoleId];
    if (!confirm(`Delete the "${role ? role.name : "role"}" role? Anyone currently assigned it will lose those permissions.`))
      return;
    deleteRoleEverywhere(editingRoleId).then(() => {
      createRoleModal.style.display = "none";
    });
  });
}

if (submitRoleBtn) {
  submitRoleBtn.addEventListener("click", async () => {
    const name = roleNameInput.value.trim();
    if (!name) {
      alert("Please enter a role name.");
      return;
    }

    const permissions = {};
    rolePermissionsGrid.querySelectorAll("input[data-perm-key]").forEach((cb) => {
      permissions[cb.getAttribute("data-perm-key")] = cb.checked;
    });

    submitRoleBtn.disabled = true;
    try {
      if (editingRoleId) {
        if (!currentPermissions.permissions.makeRoles) {
          alert("You don't have permission to edit roles.");
          return;
        }
        await updateDoc(doc(db, "roles", editingRoleId), { name, permissions });
      } else {
        if (!currentPermissions.permissions.makeRoles) {
          alert("You don't have permission to create roles.");
          return;
        }
        await addDoc(collection(db, "roles"), {
          name,
          permissions,
          createdAt: new Date(),
          createdBy: auth.currentUser ? auth.currentUser.uid : null,
        });
      }
      createRoleModal.style.display = "none";
      renderRoleManagerList();
      roleManagerModal.style.display = "flex";
    } catch (err) {
      alert("Error saving role: " + err.message);
    } finally {
      submitRoleBtn.disabled = false;
    }
  });
}

// =============================================================================
//  BADGES SYSTEM
//  Data model:
//    badges/{badgeId}      → { title, iconType: 'symbol'|'image', icon,
//                               textColor, bgColor, createdAt }
//    users/{uid}.badgeIds  → array of badge IDs awarded to that user
// =============================================================================

// Renders the small icon markup for a single badge (used everywhere a
// badge is displayed: pills, manager list, live preview, overflow popup)
function renderBadgeIconMarkup(badge) {
  if (!badge) return "";
  if (badge.iconType === "image" && badge.icon) {
    return `<img src="${badge.icon}" alt="" />`;
  }
  return `<span class="material-symbols-outlined">${
    badge.icon || "military_tech"
  }</span>`;
}

// Renders a single badge pill with its custom colors
function renderBadgePillMarkup(badge) {
  if (!badge) return "";
  const textColor = badge.textColor || "#ffffff";
  const bgColor = badge.bgColor || "#a855f7";
  return `
    <span class="user-badge-pill" style="color:${textColor}; background:${bgColor};" title="${badge.title}">
      <span class="user-badge-icon">${renderBadgeIconMarkup(badge)}</span>
      <span>${badge.title}</span>
    </span>
  `;
}

// Given an array of badge IDs for a user, returns the HTML for a badge
// row: the first (most recently awarded) badge pill, plus a "+N" trigger
// if the user has more than one. Used on member cards, posts, comments.
// `containerIdPrefix` must be unique per render context to avoid DOM id
// collisions across multiple cards on the same page.
function renderUserBadgeRow(badgeIds, containerIdPrefix) {
  if (!badgeIds || badgeIds.length === 0) return "";

  // Most recently awarded badge is the one shown inline (array push order)
  const primaryId = badgeIds[badgeIds.length - 1];
  const primaryBadge = currentBadgesMap[primaryId];
  if (!primaryBadge) return "";

  const overflowCount = badgeIds.length - 1;
  const overflowTrigger =
    overflowCount > 0
      ? `<button type="button" class="badge-overflow-trigger" data-badge-ids="${badgeIds.join(
          ","
        )}" id="${containerIdPrefix}-overflow">+${overflowCount}</button>`
      : "";

  return `
    <span class="user-badge-row">
      ${renderBadgePillMarkup(primaryBadge)}
      ${overflowTrigger}
    </span>
  `;
}

// Wires up click handlers for all ".badge-overflow-trigger" buttons
// currently in the DOM. Safe to call repeatedly after re-renders.
function bindBadgeOverflowTriggers() {
  document.querySelectorAll(".badge-overflow-trigger").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const ids = (btn.getAttribute("data-badge-ids") || "")
        .split(",")
        .filter(Boolean);
      openBadgeOverflowPopup(ids);
    };
  });
}

function openBadgeOverflowPopup(badgeIds) {
  if (!badgeOverflowList || !badgeOverflowModal) return;
  badgeOverflowList.innerHTML = badgeIds
    .map((id) => {
      const b = currentBadgesMap[id];
      if (!b) return "";
      return `<div class="badge-overflow-item">${renderBadgePillMarkup(
        b
      )}</div>`;
    })
    .join("");
  badgeOverflowModal.style.display = "flex";
}

if (closeBadgeOverflowModal) {
  closeBadgeOverflowModal.addEventListener("click", () => {
    badgeOverflowModal.style.display = "none";
  });
}

// ── Live badge catalog listener — runs for everyone (logged in or not)
//    so badge pills can render correctly across the whole site ──
onSnapshot(collection(db, "badges"), (snapshot) => {
  const updated = {};
  snapshot.forEach((d) => {
    updated[d.id] = { id: d.id, ...d.data() };
  });
  currentBadgesMap = updated;

  // Re-render whatever's currently visible so badge edits/deletes reflect live
  renderMembersDirectory();
  if (badgeManagerModal && badgeManagerModal.style.display === "flex") {
    renderBadgeManagerList();
  }
});

// ── Badge Manager modal open/close ──
if (manageBadgesBtn) {
  manageBadgesBtn.addEventListener("click", () => {
    const perms = currentPermissions.permissions;
    if (!perms.makeBadges && !perms.deleteBadges) return;
    renderBadgeManagerList();
    badgeManagerModal.style.display = "flex";
  });
}
if (closeBadgeManagerModal) {
  closeBadgeManagerModal.addEventListener("click", () => {
    badgeManagerModal.style.display = "none";
  });
}

function renderBadgeManagerList() {
  if (!badgeManagerList) return;
  const badgeEntries = Object.values(currentBadgesMap);
  const perms = currentPermissions.permissions;

  if (openCreateBadgeBtn) {
    openCreateBadgeBtn.style.display = perms.makeBadges ? "inline-block" : "none";
  }

  if (badgeEntries.length === 0) {
    badgeManagerList.innerHTML = `<p class="loading-text">No badges created yet.</p>`;
    return;
  }

  badgeManagerList.innerHTML = badgeEntries
    .map(
      (b) => `
      <div class="badge-manager-row">
        ${renderBadgePillMarkup(b)}
        <div class="badge-manager-row-info">
          <span class="badge-manager-row-meta">${b.title}</span>
        </div>
        ${
          perms.deleteBadges
            ? `<button type="button" class="badge-manager-delete-btn" data-delete-badge-id="${b.id}" title="Delete badge">
                 <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
               </button>`
            : ""
        }
      </div>
    `
    )
    .join("");

  badgeManagerList.querySelectorAll("[data-delete-badge-id]").forEach((btn) => {
    btn.onclick = () => {
      const badgeId = btn.getAttribute("data-delete-badge-id");
      const badge = currentBadgesMap[badgeId];
      if (
        !confirm(
          `Delete the "${
            badge ? badge.title : "badge"
          }" badge? This will remove it from everyone who has it.`
        )
      )
        return;
      deleteBadgeEverywhere(badgeId);
    };
  });
}

// Deletes a badge doc AND removes it from every user who currently has it,
// so no orphaned badge IDs linger on user records.
async function deleteBadgeEverywhere(badgeId) {
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const removalPromises = [];
    usersSnap.forEach((userDoc) => {
      const data = userDoc.data();
      if (data.badgeIds && data.badgeIds.includes(badgeId)) {
        removalPromises.push(
          updateDoc(doc(db, "users", userDoc.id), {
            badgeIds: arrayRemove(badgeId),
          })
        );
      }
    });
    await Promise.all(removalPromises);
    await deleteDoc(doc(db, "badges", badgeId));
  } catch (err) {
    alert("Error deleting badge: " + err.message);
  }
}

// ── Create Badge modal ──
if (openCreateBadgeBtn) {
  openCreateBadgeBtn.addEventListener("click", () => {
    if (!currentPermissions.permissions.makeBadges) return;
    resetCreateBadgeForm();
    createBadgeModal.style.display = "flex";
  });
}
if (closeCreateBadgeModal) {
  closeCreateBadgeModal.addEventListener("click", () => {
    createBadgeModal.style.display = "none";
  });
}

function resetCreateBadgeForm() {
  if (badgeTitleInput) badgeTitleInput.value = "";
  if (badgeTextColorInput) badgeTextColorInput.value = "#ffffff";
  if (badgeBgColorInput) badgeBgColorInput.value = "#a855f7";
  selectedIconType = "symbol";
  selectedIconValue = BADGE_ICON_LIBRARY[0];
  switchIconTab("library");
  highlightSelectedIconOption();
  updateBadgeLivePreview();
}

// Populate the icon library grid once on load
if (badgeIconGrid) {
  badgeIconGrid.innerHTML = BADGE_ICON_LIBRARY.map(
    (iconName) => `
      <button type="button" class="badge-icon-option" data-icon-name="${iconName}">
        <span class="material-symbols-outlined">${iconName}</span>
      </button>
    `
  ).join("");

  badgeIconGrid.querySelectorAll(".badge-icon-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedIconType = "symbol";
      selectedIconValue = btn.getAttribute("data-icon-name");
      highlightSelectedIconOption();
      updateBadgeLivePreview();
    });
  });
}

function highlightSelectedIconOption() {
  if (!badgeIconGrid) return;
  badgeIconGrid.querySelectorAll(".badge-icon-option").forEach((btn) => {
    btn.classList.toggle(
      "selected",
      selectedIconType === "symbol" &&
        btn.getAttribute("data-icon-name") === selectedIconValue
    );
  });
}

// Icon tab switching (Library vs Upload)
badgeIconTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    switchIconTab(tab.getAttribute("data-tab"));
  });
});

function switchIconTab(tabName) {
  badgeIconTabs.forEach((t) =>
    t.classList.toggle("active", t.getAttribute("data-tab") === tabName)
  );
  if (badgeIconLibraryPanel)
    badgeIconLibraryPanel.style.display = tabName === "library" ? "block" : "none";
  if (badgeIconUploadPanel)
    badgeIconUploadPanel.style.display = tabName === "upload" ? "block" : "none";
}

// Image upload — click to browse
if (badgeIconDropzone && badgeIconFileInput) {
  badgeIconDropzone.addEventListener("click", () => badgeIconFileInput.click());

  badgeIconFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleBadgeIconFile(file);
  });

  // Drag and drop support
  ["dragenter", "dragover"].forEach((evt) => {
    badgeIconDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      badgeIconDropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    badgeIconDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      badgeIconDropzone.classList.remove("drag-over");
    });
  });
  badgeIconDropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleBadgeIconFile(file);
  });
}

function handleBadgeIconFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  const MAX_BYTES = 100 * 1024; // 100KB cap — badge icons are tiny
  if (file.size > MAX_BYTES) {
    alert(
      `Image is too large (${(file.size / 1024).toFixed(
        0
      )} KB). Please use an image under 100 KB.`
    );
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    selectedIconType = "image";
    selectedIconValue = reader.result;
    updateBadgeLivePreview();
    badgeIconDropzone.innerHTML = `
      <img src="${reader.result}" style="width:40px;height:40px;object-fit:cover;border-radius:50%;" />
      <p>Image selected — click to change</p>
    `;
  };
  reader.onerror = () => alert("Could not read that image. Please try again.");
  reader.readAsDataURL(file);
}

// Live preview updates
function updateBadgeLivePreview() {
  if (!badgeLivePreview) return;
  const title = (badgeTitleInput && badgeTitleInput.value.trim()) || "Badge Title";
  const textColor = (badgeTextColorInput && badgeTextColorInput.value) || "#ffffff";
  const bgColor = (badgeBgColorInput && badgeBgColorInput.value) || "#a855f7";

  badgeLivePreview.style.color = textColor;
  badgeLivePreview.style.background = bgColor;
  badgeLivePreviewText.innerText = title;
  badgeLivePreviewIcon.innerHTML =
    selectedIconType === "image"
      ? `<img src="${selectedIconValue}" alt="" />`
      : `<span class="material-symbols-outlined">${selectedIconValue}</span>`;
}

[badgeTitleInput, badgeTextColorInput, badgeBgColorInput].forEach((el) => {
  if (el) el.addEventListener("input", updateBadgeLivePreview);
});

// Submit — create the badge doc
if (submitCreateBadgeBtn) {
  submitCreateBadgeBtn.addEventListener("click", async () => {
    if (isCreatingBadge) return; // prevent double-submit
    const title = badgeTitleInput ? badgeTitleInput.value.trim() : "";
    if (!title) {
      alert("Please enter a badge title.");
      return;
    }
    if (!currentPermissions.permissions.makeBadges) {
      alert("You don't have permission to create badges.");
      return;
    }

    isCreatingBadge = true;
    submitCreateBadgeBtn.disabled = true;
    submitCreateBadgeBtn.innerText = "Creating...";

    try {
      await addDoc(collection(db, "badges"), {
        title,
        iconType: selectedIconType,
        icon: selectedIconValue,
        textColor: badgeTextColorInput.value,
        bgColor: badgeBgColorInput.value,
        createdAt: new Date(),
        createdBy: auth.currentUser ? auth.currentUser.uid : null,
      });
      createBadgeModal.style.display = "none";
      // Re-open the manager so the admin sees their new badge in the list
      renderBadgeManagerList();
      badgeManagerModal.style.display = "flex";
    } catch (err) {
      alert("Error creating badge: " + err.message);
    } finally {
      isCreatingBadge = false;
      submitCreateBadgeBtn.disabled = false;
      submitCreateBadgeBtn.innerText = "Create Badge";
    }
  });
}

// ── Award Badge picker — opened from the member actions popup, targeting
//    whichever user's "..." menu it was triggered from ──
function openAwardBadgeModal(targetUid, targetLabel) {
  if (!awardBadgeModal || !awardBadgePickerList) return;

  const badgeEntries = Object.values(currentBadgesMap);
  if (badgeEntries.length === 0) {
    alert("No badges exist yet. Create one first via Manage Badges.");
    return;
  }

  if (awardBadgeTargetLabel)
    awardBadgeTargetLabel.innerText = `Awarding to: ${targetLabel}`;

  awardBadgePickerList.innerHTML = badgeEntries
    .map(
      (b) => `
      <div class="badge-overflow-item badge-pickable" data-award-badge-id="${b.id}">
        ${renderBadgePillMarkup(b)}
      </div>
    `
    )
    .join("");

  awardBadgePickerList.querySelectorAll("[data-award-badge-id]").forEach((row) => {
    row.onclick = () => {
      const badgeId = row.getAttribute("data-award-badge-id");
      const badge = currentBadgesMap[badgeId];
      updateDoc(doc(db, "users", targetUid), {
        badgeIds: arrayUnion(badgeId),
      })
        .then(() => {
          awardBadgeModal.style.display = "none";
          alert(`Awarded "${badge ? badge.title : "badge"}"!`);
        })
        .catch((err) => alert("Error: " + err.message));
    };
  });

  awardBadgeModal.style.display = "flex";
}

if (closeAwardBadgeModal) {
  closeAwardBadgeModal.addEventListener("click", () => {
    awardBadgeModal.style.display = "none";
  });
}

// =============================================================================
//  MEMBER ACTIONS POPUP — opened via the "..." button on a member card.
//  Contents are built dynamically based on the signed-in user's permissions
//  and the target member's current status.
// =============================================================================

if (closeMemberActionsModal) {
  closeMemberActionsModal.addEventListener("click", () => {
    memberActionsModal.style.display = "none";
  });
}

function openMemberActionsModal(targetUid, userData) {
  if (!memberActionsModal || !memberActionsBody) return;

  const emailString = userData.email || "anonymous@school.edu";
  const username = emailString.split("@")[0];
  const displayLabel = userData.displayName || username;
  const isMe = auth.currentUser && auth.currentUser.uid === targetUid;
  const targetPerms = computePermissions({ email: emailString }, userData);
  const myPerms = currentPermissions.permissions;

  memberActionsTitle.innerText = displayLabel;
  memberActionsSubtitle.innerText = `@${username}`;

  const sections = [];

  // ── Role assignment ──
  if (myPerms.assignRoles && !targetPerms.isOwner) {
    const roles = Object.values(getRolesCache());
    const roleOptions = roles
      .map(
        (r) =>
          `<option value="${r.id}" ${userData.roleId === r.id ? "selected" : ""}>${r.name}</option>`
      )
      .join("");
    sections.push(`
      <div class="member-actions-section">
        <h4>Role</h4>
        ${
          roles.length === 0
            ? `<p class="member-actions-empty">No custom roles exist yet.</p>`
            : `
          <div class="member-actions-row">
            <select id="assignRoleSelect">
              <option value="">No Role (Member)</option>
              ${roleOptions}
            </select>
            <button id="saveAssignRoleBtn" class="action-btn" style="white-space:nowrap;">Save</button>
          </div>
        `
        }
      </div>
    `);
  }

  // ── Badges ──
  if (myPerms.assignBadges) {
    const badgeIds = userData.badgeIds || [];
    const currentBadgesHTML = badgeIds.length
      ? badgeIds
          .map((bId) => {
            const b = currentBadgesMap[bId];
            if (!b) return "";
            return `
              <div class="badge-overflow-item" style="justify-content:space-between;">
                ${renderBadgePillMarkup(b)}
                <button type="button" class="badge-manager-delete-btn" data-revoke-badge="${bId}" title="Revoke">
                  <span class="material-symbols-outlined" style="font-size:16px;">close</span>
                </button>
              </div>
            `;
          })
          .join("")
      : `<p class="member-actions-empty">No badges awarded yet.</p>`;

    sections.push(`
      <div class="member-actions-section">
        <h4>Badges</h4>
        <div class="badge-overflow-list" style="margin-bottom:10px;">${currentBadgesHTML}</div>
        <button id="openAwardBadgeFromPopupBtn" class="secondary-btn-style" style="width:100%;">
          + Award a Badge
        </button>
      </div>
    `);
  }

  // ── Account ──
  const canRemove = isMe || (myPerms.removeAccounts && !targetPerms.isOwner);
  if (canRemove) {
    sections.push(`
      <div class="member-actions-section">
        <h4>Account</h4>
        <button id="removeAccountFromPopupBtn" class="delete-btn" style="margin-top:0;">
          ${isMe ? "Remove My Account" : "Remove Account"}
        </button>
      </div>
    `);
  }

  memberActionsBody.innerHTML = sections.length
    ? sections.join("")
    : `<p class="member-actions-empty">No actions available for this member.</p>`;

  // Wire section handlers
  const saveRoleBtn = document.getElementById("saveAssignRoleBtn");
  if (saveRoleBtn) {
    saveRoleBtn.onclick = () => {
      const select = document.getElementById("assignRoleSelect");
      const newRoleId = select.value || null;
      updateDoc(doc(db, "users", targetUid), { roleId: newRoleId })
        .then(() => {
          memberActionsModal.style.display = "none";
          alert(newRoleId ? "Role assigned!" : "Role cleared — member has no custom role now.");
        })
        .catch((err) => alert("Error: " + err.message));
    };
  }

  memberActionsBody.querySelectorAll("[data-revoke-badge]").forEach((btn) => {
    btn.onclick = () => {
      const bId = btn.getAttribute("data-revoke-badge");
      if (!confirm("Revoke this badge from this user?")) return;
      updateDoc(doc(db, "users", targetUid), {
        badgeIds: arrayRemove(bId),
      })
        .then(() => openMemberActionsModal(targetUid, { ...userData, badgeIds: (userData.badgeIds || []).filter((x) => x !== bId) }))
        .catch((err) => alert("Error: " + err.message));
    };
  });

  const awardBtn = document.getElementById("openAwardBadgeFromPopupBtn");
  if (awardBtn) {
    awardBtn.onclick = () => openAwardBadgeModal(targetUid, displayLabel);
  }

  const removeBtn = document.getElementById("removeAccountFromPopupBtn");
  if (removeBtn) {
    removeBtn.onclick = () => {
      if (
        !confirm(`Are you sure you want to remove the profile record for ${username}?`)
      )
        return;
      addDoc(collection(db, "notifications"), {
        title: "Account Deletion",
        message: `The user account for "${username}" was removed from the system registry.`,
        type: "account_deletion",
        createdBy: auth.currentUser.uid,
        createdAt: new Date(),
        viewedBy: [],
      }).then(() => {
        deleteDoc(doc(db, "users", targetUid)).then(() => {
          memberActionsModal.style.display = "none";
          if (isMe) signOut(auth);
        });
      });
    };
  }

  memberActionsModal.style.display = "flex";
}

// Render the Directory
let unsubscribeMembersDirectory = null;

function renderMembersDirectory() {
  if (!membersGrid) return;

  // Detach any previous listener before creating a new one — this function
  // is now called both on auth changes AND on every badge/role catalog
  // update, so without this, listeners would stack up indefinitely.
  if (unsubscribeMembersDirectory) {
    unsubscribeMembersDirectory();
    unsubscribeMembersDirectory = null;
  }

  unsubscribeMembersDirectory = onSnapshot(collection(db, "users"), (snapshot) => {
    membersGrid.innerHTML = "";

    if (snapshot.empty) {
      membersGrid.innerHTML = `<p class="loading-text">No registered community members found.</p>`;
      return;
    }

    const myPerms = currentPermissions.permissions;

    snapshot.forEach((userDoc) => {
      const userData = userDoc.data();
      const userDocId = userDoc.id;
      const emailString = userData.email || "anonymous@school.edu";
      const username = emailString.split("@")[0];
      const displayName = userData.displayName || ""; // Set only if the user chose one
      const photoUrl = userData.photoUrl || "";
      const initial = (displayName || username).charAt(0).toUpperCase();

      const targetPerms = computePermissions({ email: emailString }, userData);
      let roleLabel = "Member";
      let roleBadgeStyle =
        'style="color: #94a3b8; font-size: 13px;"';
      if (targetPerms.isOwner) {
        roleLabel = "Owner";
        roleBadgeStyle =
          'style="color: #bb86fc; background: rgba(187, 134, 252, 0.1); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase;"';
      } else if (targetPerms.isLegacyAdmin) {
        roleLabel = "Admin";
        roleBadgeStyle =
          'style="color: #bb86fc; background: rgba(187, 134, 252, 0.1); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase;"';
      } else if (targetPerms.roleName) {
        roleLabel = targetPerms.roleName;
        roleBadgeStyle =
          'style="color: #38bdf8; background: rgba(56, 189, 248, 0.1); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase;"';
      }

      const isMe = auth.currentUser && auth.currentUser.uid === userDocId;
      const canManageCard =
        isMe ||
        (myPerms.assignRoles && !targetPerms.isOwner) ||
        myPerms.assignBadges ||
        (myPerms.removeAccounts && !targetPerms.isOwner);

      const cardMenuHTML = canManageCard
        ? `<button type="button" class="member-card-menu-btn" id="menu-btn-${userDocId}" title="Manage member">
             <span class="material-symbols-outlined">more_vert</span>
           </button>`
        : "";

      // Avatar: photo if available, otherwise initial letter — wrapped in a
      // link so clicking navigates to that member's profile page.
      const avatarInner = photoUrl
        ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : initial;

      const avatarMarkup = `
        <a href="profile.html?uid=${userDocId}" class="member-card-avatar-link" title="View profile">
          <div class="member-card-avatar">${avatarInner}</div>
        </a>`;

      // Only show display name row if the user has set one (and it differs from username)
      const displayNameRow =
        displayName && displayName !== username
          ? `<p class="member-display-name">${displayName}</p>`
          : "";

      const badgeIds = userData.badgeIds || [];
      const badgeRowHTML = renderUserBadgeRow(badgeIds, `card-${userDocId}`);

      const cardHTML = `
        <div class="member-card">
          ${cardMenuHTML}
          ${avatarMarkup}
          <h3 class="member-name">@${username}</h3>
          ${displayNameRow}
          ${badgeRowHTML ? `<div class="member-card-badges">${badgeRowHTML}</div>` : ""}
          <p ${roleBadgeStyle}>${roleLabel}</p>
        </div>
      `;
      membersGrid.innerHTML += cardHTML;

      if (canManageCard) {
        setTimeout(() => {
          const btn = document.getElementById(`menu-btn-${userDocId}`);
          if (btn) {
            btn.onclick = () => openMemberActionsModal(userDocId, userData);
          }
        }, 0);
      }
    });

    bindBadgeOverflowTriggers();
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

// Initial render for logged-out visitors (auth listener also renders,
// but this ensures the grid isn't blank while Firebase auth resolves)
renderMembersDirectory();

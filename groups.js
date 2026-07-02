// Import Firebase core, Authentication, Firestore, and Storage SDKs
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
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  computePermissions,
  onRolesUpdated,
  waitForRoles,
} from "./permissions.js";
import { renderEmojiGrid } from "./emoji-library.js";

// Your Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDFKAnb3hipbmCFOujKIpdh3jbp18RFGlE",
  authDomain: "sharenet-reimagined.firebaseapp.com",
  projectId: "sharenet-reimagined",
  storageBucket: "sharenet-reimagined.firebasestorage.app",
  messagingSenderId: "28034797053",
  appId: "1:28034797053:web:1c448f7fa2ad3ae5cbdd94",
};

// Initialize Firebase services
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

const storage = getStorage(app);

// Permission checks now flow through myPermissions (see permissions.js)

// =============================================================================
//  Content Moderation — calls the ShareNet Worker's /moderate endpoint.
//  The Worker holds the OpenAI key server-side (env.OPENAI_API_KEY) and
//  proxies to OpenAI's free /v1/moderations API. No API keys are ever
//  exposed to the browser. Fails open (allows the post) on any network
//  or server error so a Worker outage never blocks people from posting.
// =============================================================================
const MODERATION_ENDPOINT =
  "https://sharenet-assistant.ogheneovieumebese.workers.dev/moderate";

async function checkContent(text) {
  if (!text || !text.trim()) return { allowed: true };

  try {
    const res = await fetch(MODERATION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) return { allowed: true }; // fail open

    const data = await res.json();
    if (data && data.allowed === false) {
      return {
        allowed: false,
        reason: data.reason || "This message was flagged as harmful content.",
      };
    }
    return { allowed: true };
  } catch (err) {
    console.error("Moderation request failed:", err);
    return { allowed: true }; // fail open — never block users on a network error
  }
}
// =============================================================================

// Active State Machine
let currentActiveGroupId = "global";
let currentGroupsDataMap = {};
let stagingEmbeddedHtmlCode = "";
let masterPostsCache = [];
let openCommentSectionsMap = {};
const activeCommentSubscribersMap = {};

// ── Deep-link support: notifications.js sends links like
//    groups.html?group=<id>&post=<id> — we need to land on that exact
//    group + post/comment instead of always defaulting to the main feed.
const _deepLinkParams = new URLSearchParams(window.location.search);
let pendingDeepLinkGroupId = _deepLinkParams.get("group");
let pendingDeepLinkPostId = _deepLinkParams.get("post");
let deepLinkGroupHandled = false;
let activeGroupReqListener = null; // Tracks local group member requests
let activePostsListenerUnsubscribe = null; // NEW: Tracks the active posts feed

// --- Scroll Visibility & View Cooldown Tracking State ---
let postVisibilityObserver = null;
const activeVisibilityTimers = {};
const sessionViewedPosts = new Set();

// Attachment State Pipeline Tracker
let stagingAttachmentUrl = "";
let stagingAttachmentType = "";
let stagingAttachmentName = "";

// Wix-style Inline Staging Poll Tracking
let stagingPollType = "";

// Current user profile cache
let currentUserProfile = { displayName: "", photoUrl: "" };

// Live permission set for the signed-in user (custom roles system —
// see permissions.js). Refreshed on auth changes and whenever the roles
// catalog itself changes (in case our assigned role gets edited).
let currentUserData = null;
let myPermissions = computePermissions(null, null);

function refreshMyPermissions(user) {
  myPermissions = computePermissions(user, currentUserData);
  if (adminPanel) {
    adminPanel.style.display = myPermissions.permissions.manageGroupRequests
      ? "block"
      : "none";
  }
  // Instantly reflect the new permission set on the group sidebar's
  // edit/delete icons, rather than waiting for the next "groups" snapshot.
  refreshGroupSidebarPermissionIcons();
}

onRolesUpdated(() => {
  refreshMyPermissions(auth.currentUser);
  if (evaluateGroupVisibility()) {
    evaluateComposerVisibility();
  }
});

// =============================================================================
//  BADGES — read-only here. Mirrors the data model owned by members.js:
//    badges/{badgeId}     → { title, iconType, icon, textColor, bgColor }
//    users/{uid}.badgeIds → array of badge IDs that user has been awarded
//  Both are kept live so badge pills on posts/comments stay current even
//  if an admin awards/revokes a badge while someone's viewing the feed.
// =============================================================================
let currentBadgesMap = {};
let userBadgeIdsMap = {}; // uid -> array of badge ids
let userDataMap = {}; // uid -> full users/{uid} doc data

onSnapshot(collection(db, "badges"), (snapshot) => {
  const updated = {};
  snapshot.forEach((d) => {
    updated[d.id] = { id: d.id, ...d.data() };
  });
  currentBadgesMap = updated;
  refreshAllVisibleAuthorBadges();
});

onSnapshot(collection(db, "users"), (snapshot) => {
  const updated = {};
  const dataMap = {};
  snapshot.forEach((d) => {
    const data = d.data();
    dataMap[d.id] = data;
    if (data.badgeIds && data.badgeIds.length > 0) {
      updated[d.id] = data.badgeIds;
    }
  });
  userBadgeIdsMap = updated;
  userDataMap = dataMap;
  refreshAllVisibleAuthorBadges();
});

function renderBadgeIconMarkup(badge) {
  if (!badge) return "";
  if (badge.iconType === "image" && badge.icon) {
    return `<img src="${badge.icon}" alt="" />`;
  }
  return `<span class="material-symbols-outlined">${
    badge.icon || "military_tech"
  }</span>`;
}

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

// Returns badge-row HTML for a given author UID, or "" if they have none.
// `idPrefix` must be unique per rendered element (post id / comment id)
// to avoid duplicate-id collisions when multiple cards are on screen.
function renderAuthorBadgeRow(authorUid, idPrefix) {
  const badgeIds = userBadgeIdsMap[authorUid];
  if (!badgeIds || badgeIds.length === 0) return "";

  // Respect the author's own canDisplayBadges restriction, if any.
  const authorData = userDataMap[authorUid];
  const authorPerms = computePermissions(
    authorData ? { email: authorData.email } : null,
    authorData || null
  );
  if (!authorPerms.permissions.canDisplayBadges) return "";

  const primaryId = badgeIds[badgeIds.length - 1];
  const primaryBadge = currentBadgesMap[primaryId];
  if (!primaryBadge) return "";

  const overflowCount = badgeIds.length - 1;
  const overflowTrigger =
    overflowCount > 0
      ? `<button type="button" class="badge-overflow-trigger" data-badge-ids="${badgeIds.join(
          ","
        )}" id="${idPrefix}-overflow">+${overflowCount}</button>`
      : "";

  return `
    <span class="user-badge-row">
      ${renderBadgePillMarkup(primaryBadge)}
      ${overflowTrigger}
    </span>
  `;
}

function bindBadgeOverflowTriggers(scopeEl) {
  const root = scopeEl || document;
  root.querySelectorAll(".badge-overflow-trigger").forEach((btn) => {
    if (btn._badgeBound) return; // avoid rebinding the same node repeatedly
    btn._badgeBound = true;
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
  const modal = document.getElementById("badgeOverflowModal");
  const list = document.getElementById("badgeOverflowList");
  if (!modal || !list) return;
  list.innerHTML = badgeIds
    .map((id) => {
      const b = currentBadgesMap[id];
      if (!b) return "";
      return `<div class="badge-overflow-item">${renderBadgePillMarkup(b)}</div>`;
    })
    .join("");
  modal.style.display = "flex";
}

const closeBadgeOverflowModalBtn = document.getElementById(
  "closeBadgeOverflowModal"
);
if (closeBadgeOverflowModalBtn) {
  closeBadgeOverflowModalBtn.addEventListener("click", () => {
    document.getElementById("badgeOverflowModal").style.display = "none";
  });
}

// Re-applies badge rows to every author-name element currently rendered
// in the DOM, without rebuilding entire post/comment cards. Cheaper than
// a full re-render and avoids disrupting open comment sections / scroll.
function refreshAllVisibleAuthorBadges() {
  document.querySelectorAll("[data-badge-author-uid]").forEach((el) => {
    const uid = el.getAttribute("data-badge-author-uid");
    const idPrefix = el.getAttribute("data-badge-id-prefix") || uid;
    el.innerHTML = renderAuthorBadgeRow(uid, idPrefix);
  });
  bindBadgeOverflowTriggers();
}

// DOM Query Bindings
const authModal = document.getElementById("authModal");
const authNavBtn = document.getElementById("authNavBtn");
const closeModal = document.getElementById("closeModal");
const authForm = document.getElementById("authForm");
const modalTitle = document.getElementById("modalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const toggleAuthMode = document.getElementById("toggleAuthMode");
const toggleMsg = document.getElementById("toggleMsg");

const adminPanel = document.getElementById("adminPanel");
const adminDropdownBtn = document.getElementById("adminDropdownBtn");
const adminDropdownContent = document.getElementById("adminDropdownContent");
const adminReqCount = document.getElementById("adminReqCount");

const groupModal = document.getElementById("groupModal");
const openCreateGroupModalBtn = document.getElementById(
  "openCreateGroupModalBtn"
);
const closeGroupModal = document.getElementById("closeGroupModal");
const groupForm = document.getElementById("groupForm");

// Wix Composer DOM Elements
const createPostBox = document.getElementById("createPostBox");
const openComposerBtn = document.getElementById("openComposerBtn");
const composerModal = document.getElementById("composerModal");
const closeComposerModal = document.getElementById("closeComposerModal");
const cancelComposerBtn = document.getElementById("cancelComposerBtn");
const publishPostBtn = document.getElementById("publishPostBtn");

const postTitleInput = document.getElementById("postTitleInput");
const postTextInput = document.getElementById("postTextInput");

const compAvatar = document.getElementById("compAvatar");
const compUser = document.getElementById("compUser");
const compTargetGroup = document.getElementById("compTargetGroup");

// Media Tool & Hidden Input Bindings
const toolBtnImage = document.getElementById("toolBtnImage");
const toolBtnVideo = document.getElementById("toolBtnVideo");
const toolBtnFile = document.getElementById("toolBtnFile");
const toolBtnEmoji = document.getElementById("toolBtnEmoji");
const toolBtnPoll = document.getElementById("toolBtnPoll");

const hiddenImageInput = document.getElementById("hiddenImageInput");
const hiddenVideoInput = document.getElementById("hiddenVideoInput");
const hiddenFileInput = document.getElementById("hiddenFileInput");

let composerAttachmentPreview = document.getElementById(
  "composerAttachmentPreview"
);
const attachmentLoadingOverlay = document.getElementById(
  "attachmentLoadingOverlay"
);
const attachmentRenderArea = document.getElementById("attachmentRenderArea");
const clearAttachmentBtn = document.getElementById("clearAttachmentBtn");

// Emoji Element Bindings
const emojiPickerPanel = document.getElementById("emojiPickerPanel");
const emojiGridScrollArea = document.getElementById("emojiGridScrollArea");
const closeEmojiPanelBtn = document.getElementById("closeEmojiPanelBtn");
const emojiSearchField = document.getElementById("emojiSearchField");

// Plugin Tray Elements
const togglePluginSubmenu = document.getElementById("togglePluginSubmenu");
const pluginSubmenu = document.getElementById("pluginSubmenu");
const btnTriggerHtmlPlugin = document.getElementById("btnTriggerHtmlPlugin");

const htmlPluginModal = document.getElementById("htmlPluginModal");
const closeHtmlModal = document.getElementById("closeHtmlModal");
const cancelHtmlModal = document.getElementById("cancelHtmlModal");
const saveHtmlModal = document.getElementById("saveHtmlModal");
const htmlPluginCodeArea = document.getElementById("htmlPluginCodeArea");
const attachedHtmlPreview = document.getElementById("attachedHtmlPreview");
const removeAttachedHtml = document.getElementById("removeAttachedHtml");

const postsStream = document.getElementById("postsStream");
const groupsScrollList = document.getElementById("groupsScrollList");
const feedTitle = document.getElementById("feedTitle");
const feedDescription = document.getElementById("feedDescription");

// Unified Omnibar Search Binding
const globalFeedSearchBar = document.getElementById("globalFeedSearchBar");

// Global Header Notification Direct Navigation Bindings
const notificationBellBtn = document.getElementById("notificationBellBtn");
const navNotificationsLink = document.getElementById("navNotificationsLink");
const notificationBadge = document.getElementById("notificationBadge");
const navProfileAvatar = document.getElementById("navProfileAvatar");

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

// Fix for Popups flashing on opening
document.addEventListener("DOMContentLoaded", () => {
  if (authModal) authModal.style.display = "none";
  if (groupModal) groupModal.style.display = "none";
  if (composerModal) composerModal.style.display = "none";
  if (htmlPluginModal) htmlPluginModal.style.display = "none";
  const pollPlug = document.getElementById("pollModal");
  if (pollPlug) pollPlug.style.display = "none";
});

let isLoginMode = true;

// --- Shared Navbar Authentication Logic ---
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
    if (isLoginMode) {
      modalTitle.innerText = "Log In";
      authSubmitBtn.innerText = "Log In";
      toggleMsg.innerText = "Don't have an account?";
      toggleAuthMode.innerText = "Sign Up";
    } else {
      modalTitle.innerText = "Sign Up";
      authSubmitBtn.innerText = "Sign Up";
      toggleMsg.innerText = "Already have an account?";
      toggleAuthMode.innerText = "Log In";
    }
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

// Global Auth State Observer
onAuthStateChanged(auth, async (user) => {
  if (user) {
    authNavBtn.innerText = "Sign Out";
    if (authModal) authModal.style.display = "none";

    // Load profile + full user doc (for permission computation) from Firestore
    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) {
        const d = userSnap.data();
        currentUserData = d;
        currentUserProfile.displayName =
          d.displayName || user.email.split("@")[0];
        currentUserProfile.photoUrl = d.photoUrl || "";
      } else {
        currentUserData = null;
        currentUserProfile.displayName = user.email.split("@")[0];
        currentUserProfile.photoUrl = "";
      }
    } catch (e) {
      currentUserData = null;
      currentUserProfile.displayName = user.email.split("@")[0];
      currentUserProfile.photoUrl = "";
    }
    updateNavAvatar();

    await waitForRoles();
    refreshMyPermissions(user);
  } else {
    authNavBtn.innerText = "Log In";
    currentUserData = null;
    refreshMyPermissions(null);
    if (navProfileAvatar) {
      navProfileAvatar.innerHTML = "?";
      navProfileAvatar.style.display = "none";
    }
    currentUserProfile = { displayName: "", photoUrl: "" };
  }

  // Only stream posts if the user passes the privacy gate
  if (evaluateGroupVisibility()) {
    evaluateComposerVisibility();
    streamActivePosts();
  }
  syncNavNotificationBadgeOnly();
});

function updateNavAvatar() {
  if (!navProfileAvatar) return;
  navProfileAvatar.style.display = "flex";
  if (currentUserProfile.photoUrl) {
    navProfileAvatar.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    navProfileAvatar.innerHTML =
      currentUserProfile.displayName.charAt(0).toUpperCase() || "?";
  }
}

// Profile modal is handled by shared.js — no duplicate binding needed here

// --- Admin System Requests Logic ---
if (adminDropdownBtn) {
  adminDropdownBtn.addEventListener("click", () => {
    adminDropdownContent.classList.toggle("show");
  });
}

onSnapshot(
  query(collection(db, "groupRequests"), where("status", "==", "pending")),
  (snapshot) => {
    if (adminReqCount) adminReqCount.innerText = snapshot.size;
    adminDropdownContent.innerHTML = "";

    if (snapshot.empty) {
      adminDropdownContent.innerHTML = `<p class="empty-msg">No pending group requests.</p>`;
      return;
    }

    snapshot.forEach((docSnap) => {
      const reqData = docSnap.data();
      const reqId = docSnap.id;

      const requestItemHTML = `
            <div class="request-item">
                <div>
                    <strong>${reqData.name}</strong> (${reqData.accessibility})<br>
                    <small>${reqData.description}</small><br>
                    <small>Requested by: ${reqData.requestedBy}</small>
                </div>
                <div class="btn-group">
                    <button class="accept-btn" id="accept-grp-${reqId}">Accept</button>
                    <button class="decline-btn" id="decline-grp-${reqId}">Decline</button>
                </div>
            </div>
        `;
      adminDropdownContent.innerHTML += requestItemHTML;

      setTimeout(() => {
        const accBtn = document.getElementById(`accept-grp-${reqId}`);
        const decBtn = document.getElementById(`decline-grp-${reqId}`);
        if (accBtn) accBtn.onclick = () => approveGroupRequest(reqId, reqData);
        if (decBtn) {
          decBtn.onclick = () => {
            updateDoc(doc(db, "groupRequests", reqId), { status: "declined" });
          };
        }
      }, 50);
    });
  }
);

function approveGroupRequest(requestId, data) {
  updateDoc(doc(db, "groupRequests", requestId), { status: "approved" });
  addDoc(collection(db, "groups"), {
    name: data.name,
    banner: data.banner || "",
    iconUrl: data.iconUrl || "",
    accessibility: data.accessibility,
    description: data.description,
    creatorId: data.creatorUid,
    creatorEmail: data.requestedBy,
    members: [data.creatorUid],
  }).then(() => {
    addDoc(collection(db, "notifications"), {
      title: "New Group Approved",
      message: `A new group was created: "${data.name}" (${data.accessibility}).`,
      type: "group_creation",
      createdAt: new Date(),
      viewedBy: [],
    });
    alert(`Group "${data.name}" successfully created!`);
  });
}

// --- Group Form Window Toggles ---
if (openCreateGroupModalBtn) {
  openCreateGroupModalBtn.addEventListener("click", () => {
    if (!auth.currentUser) {
      alert("Please log in to submit group creation requests!");
      return;
    }
    if (!myPermissions.permissions.canRequestGroups) {
      alert("Your account role does not allow you to request new groups.");
      return;
    }
    groupModal.style.display = "flex";
  });
}
if (closeGroupModal)
  closeGroupModal.addEventListener("click", () => {
    groupModal.style.display = "none";
  });

if (groupForm) {
  groupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Handle group icon file -> base64 if a file was staged
    let iconDataUrl = window._stagingGroupIconBase64 || "";

    const newGroup = {
      name: document.getElementById("groupName").value,
      banner: document.getElementById("groupBanner").value,
      iconUrl: iconDataUrl,
      accessibility: document.getElementById("groupAccessibility").value,
      description: document.getElementById("groupDesc").value,
      status: "pending",
      requestedBy: auth.currentUser.email,
      creatorUid: auth.currentUser.uid,
      createdAt: new Date(),
    };

    addDoc(collection(db, "groupRequests"), newGroup).then(() => {
      alert("Your group request has been submitted!");
      groupModal.style.display = "none";
      groupForm.reset();
      // Reset icon staging
      window._stagingGroupIconBase64 = "";
      const preview = document.getElementById("groupIconPreview");
      if (preview) {
        preview.style.display = "none";
        preview.src = "";
      }
    });
  });
}

// --- Render/Stream Group Sidebar Navigation Rows ---
// Live permission checks for a given group — always read the CURRENT
// myPermissions at call time (never a value baked in at render time), so
// a role change takes effect immediately, and so the actual edit/delete
// actions can never succeed after permission is revoked even if the icon
// itself is momentarily stale.
function groupCanEdit(group) {
  if (!group) return false;
  const isOwnerOfGroup =
    auth.currentUser && auth.currentUser.uid === group.creatorId;
  return (
    (isOwnerOfGroup && myPermissions.permissions.canManageOwnGroups) ||
    myPermissions.isOwner ||
    myPermissions.permissions.editGroups
  );
}
function groupCanDelete(group) {
  if (!group) return false;
  const isOwnerOfGroup =
    auth.currentUser && auth.currentUser.uid === group.creatorId;
  return (
    (isOwnerOfGroup && myPermissions.permissions.canManageOwnGroups) ||
    myPermissions.isOwner ||
    myPermissions.permissions.deleteContent
  );
}

// Re-applies edit/delete icon visibility for every group currently in the
// sidebar, based on the live permission set. Called whenever myPermissions
// changes (auth change or role edit) so the UI never shows a stale action.
function refreshGroupSidebarPermissionIcons() {
  Object.entries(currentGroupsDataMap).forEach(([id, group]) => {
    const editBtn = document.getElementById(`edit-group-${id}`);
    const delBtn = document.getElementById(`del-group-${id}`);
    if (editBtn) editBtn.style.display = groupCanEdit(group) ? "inline-flex" : "none";
    if (delBtn) delBtn.style.display = groupCanDelete(group) ? "inline-flex" : "none";
  });
}

onSnapshot(collection(db, "groups"), (snapshot) => {
  groupsScrollList.innerHTML = `<div class="group-item ${
    currentActiveGroupId === "global" ? "active" : ""
  }" id="target-grp-global" data-group-id="global"><span style="display:flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Main Feed</span></div>`;

  currentGroupsDataMap = {};
  snapshot.forEach((docSnap) => {
    const group = docSnap.data();
    const id = docSnap.id;
    currentGroupsDataMap[id] = group;

    // Both icons are always rendered in the DOM (never conditionally
    // included) so visibility can be toggled live via refreshGroupSidebar-
    // PermissionIcons() the instant permissions change, rather than only
    // updating the next time the "groups" collection itself changes.
    const trashBtnHTML = `
      <span class="material-symbols-outlined edit-group-icon" id="edit-group-${id}" style="font-size:16px; color:var(--accent-purple); cursor:pointer; display:none;" title="Edit group">edit</span>
      <span class="material-symbols-outlined delete-group-icon" id="del-group-${id}" style="font-size:18px; margin-left:2px; color:#cf6679; cursor:pointer; display:none;">delete</span>
    `;

    const iconHtml = group.iconUrl
      ? `<img src="${group.iconUrl}" class="group-sidebar-icon" />`
      : group.accessibility === "private"
      ? `<svg class="group-sidebar-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
      : `<svg class="group-sidebar-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const memberCount = (group.members || []).length;
    const accessIcon = group.accessibility === "private"
      ? `<span class="material-symbols-outlined group-access-icon">lock</span>`
      : `<span class="material-symbols-outlined group-access-icon">public</span>`;

    const itemHTML = `
      <div class="group-item ${
        currentActiveGroupId === id ? "active" : ""
      }" id="target-grp-${id}" data-group-id="${id}">
        <span class="group-item-label">${iconHtml}${group.name}<span style="margin-left:auto;display:flex;gap:2px;">${trashBtnHTML}</span></span>
        <span class="group-item-meta">${accessIcon}${memberCount} member${memberCount !== 1 ? "s" : ""}</span>
      </div>`;
    groupsScrollList.innerHTML += itemHTML;

    setTimeout(() => {
      const editBtn = document.getElementById(`edit-group-${id}`);
      const tBtn = document.getElementById(`del-group-${id}`);

      // Handlers are always bound (regardless of current permission) —
      // each one re-checks live permission the instant it's clicked, so
      // there's no window where a stale-but-still-present icon can be
      // used to sneak an edit/delete through.
      if (editBtn) {
        editBtn.onclick = (e) => {
          e.stopPropagation();
          const currentGroupData = currentGroupsDataMap[id] || group;
          if (!groupCanEdit(currentGroupData)) {
            alert("You no longer have permission to edit this group.");
            refreshGroupSidebarPermissionIcons();
            return;
          }
          openEditGroupModal(id, currentGroupData);
        };
      }

      if (tBtn) {
        tBtn.onclick = (e) => {
          e.stopPropagation();
          const currentGroupData = currentGroupsDataMap[id] || group;
          if (!groupCanDelete(currentGroupData)) {
            alert("You no longer have permission to delete this group.");
            refreshGroupSidebarPermissionIcons();
            return;
          }
          if (
            confirm(`Are you sure you would like to remove "${currentGroupData.name}"?`)
          ) {
            addDoc(collection(db, "notifications"), {
              title: "Group Removed",
              message: `"${currentGroupData.name}" was removed.`,
              type: "group_deletion",
              createdBy: auth.currentUser.uid,
              createdAt: new Date(),
              viewedBy: [],
            }).then(() => {
              deleteDoc(doc(db, "groups", id)).then(() => {
                if (currentActiveGroupId === id) {
                  switchGroupContext(
                    "global",
                    "Main Feed",
                    "Displaying all global posts and public group content."
                  );
                }
              });
            });
          }
        };
      }

      refreshGroupSidebarPermissionIcons();
    }, 50);
  });

  // ── Deep-link: land directly on the group a notification pointed at ──
  if (!deepLinkGroupHandled && pendingDeepLinkGroupId) {
    deepLinkGroupHandled = true;
    if (pendingDeepLinkGroupId === "global") {
      // already the default context — nothing to switch
    } else {
      const targetGroup = currentGroupsDataMap[pendingDeepLinkGroupId];
      if (targetGroup) {
        switchGroupContext(
          pendingDeepLinkGroupId,
          targetGroup.name,
          targetGroup.description
        );
      }
      // If the group isn't found (deleted, private & not a member, etc.)
      // we simply stay on the main feed — the post-scroll step below will
      // just no-op if the post never renders there either.
    }
  }
});

// ── Edit Group Modal ───────────────────────────────────────────────────────────
function openEditGroupModal(groupId, groupData) {
  const modal = document.getElementById("editGroupModal");
  const nameInput = document.getElementById("editGroupNameInput");
  const iconPreview = document.getElementById("editGroupIconPreview");
  const iconFileInput = document.getElementById("editGroupIconFileInput");
  const saveBtn = document.getElementById("saveEditGroupBtn");
  const closeBtn = document.getElementById("closeEditGroupModal");
  if (!modal) return;

  nameInput.value = groupData.name || "";
  iconPreview.innerHTML = groupData.iconUrl
    ? `<img src="${groupData.iconUrl}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;" />`
    : `<span class="material-symbols-outlined" style="font-size:40px;color:var(--text-muted)">image</span>`;

  let pendingIconBase64 = null;

  iconFileInput.onchange = () => {
    const file = iconFileInput.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 300 * 1024) { alert("Icon image must be under 300 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pendingIconBase64 = reader.result;
      iconPreview.innerHTML = `<img src="${reader.result}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;" />`;
    };
    reader.readAsDataURL(file);
  };

  saveBtn.onclick = async () => {
    // Re-check live, at the moment of saving — not just at the moment the
    // modal was opened — so a permission revoked while the modal is open
    // (or a stale icon click) can never actually persist a change.
    const liveGroupData = currentGroupsDataMap[groupId] || groupData;
    if (!groupCanEdit(liveGroupData)) {
      alert("You no longer have permission to edit this group.");
      modal.style.display = "none";
      refreshGroupSidebarPermissionIcons();
      return;
    }

    const newName = nameInput.value.trim();
    if (!newName) { alert("Group name can't be empty."); return; }
    const updates = { name: newName };
    if (pendingIconBase64) updates.iconUrl = pendingIconBase64;
    try {
      await updateDoc(doc(db, "groups", groupId), updates);
      modal.style.display = "none";
    } catch (err) { alert("Error saving: " + err.message); }
  };

  closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.style.display = "flex";
}

// =============================================================================
//  POST EDITING + EDIT HISTORY
//  Each save pushes the pre-edit {title, text, editedAt} into the post's
//  editHistory array before applying the new content, so "edited" always
//  shows every prior version, oldest edits included.
// =============================================================================

function openEditPostModal(postId, postData) {
  const modal = document.getElementById("editPostModal");
  const titleInput = document.getElementById("editPostTitleInput");
  const textInput = document.getElementById("editPostTextInput");
  const saveBtn = document.getElementById("saveEditPostBtn");
  const closeBtn = document.getElementById("closeEditPostModal");
  if (!modal) return;

  titleInput.value = postData.title || "";
  textInput.value = postData.text || "";

  saveBtn.onclick = async () => {
    // Live re-check at save-time too — same defense-in-depth pattern used
    // for group edits, so a permission change mid-edit can't sneak through.
    const livePost = masterPostsCache.find((p) => p.id === postId) || postData;
    const isAuthorNow = auth.currentUser && livePost.authorId === auth.currentUser.uid;
    if (!isAuthorNow || !myPermissions.permissions.canEditOwnPosts) {
      alert("You no longer have permission to edit this post.");
      modal.style.display = "none";
      return;
    }

    const newTitle = titleInput.value.trim();
    const newText = textInput.value.trim();
    if (!newTitle && !newText) {
      alert("Post can't be completely empty.");
      return;
    }

    // ── Content moderation on the edited text ──
    const combinedText = [newTitle, newText].filter(Boolean).join(" ");
    const filterResult = await checkContent(combinedText);
    if (!filterResult.allowed) {
      alert(`Edit blocked: ${filterResult.reason}`);
      return;
    }

    const previousVersion = {
      title: livePost.title || "",
      text: livePost.text || "",
      editedAt: new Date(),
    };

    try {
      await updateDoc(doc(db, "posts", postId), {
        title: newTitle,
        text: newText,
        lastEditedAt: new Date(),
        editHistory: arrayUnion(previousVersion),
      });
      modal.style.display = "none";
    } catch (err) {
      alert("Error saving edit: " + err.message);
    }
  };

  closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.style.display = "flex";
}

function openPostHistoryModal(postId) {
  const modal = document.getElementById("postHistoryModal");
  const list = document.getElementById("postHistoryList");
  const closeBtn = document.getElementById("closePostHistoryModal");
  if (!modal || !list) return;

  const post = masterPostsCache.find((p) => p.id === postId);
  const history = (post && post.editHistory) || [];

  if (history.length === 0) {
    list.innerHTML = `<p class="loading-text">No previous versions found.</p>`;
  } else {
    // Most recent previous version first
    const ordered = [...history].reverse();
    list.innerHTML = ordered
      .map((v) => {
        const when = v.editedAt && v.editedAt.toDate
          ? v.editedAt.toDate().toLocaleString()
          : v.editedAt && v.editedAt.seconds
          ? new Date(v.editedAt.seconds * 1000).toLocaleString()
          : "Unknown time";
        return `
          <div class="post-history-entry">
            <div class="post-history-entry-time">${when}</div>
            ${v.title ? `<h4 class="post-history-entry-title">${v.title}</h4>` : ""}
            <p class="post-history-entry-text">${v.text || ""}</p>
          </div>
        `;
      })
      .join("");
  }

  if (closeBtn) closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.style.display = "flex";
}

if (groupsScrollList) {
  groupsScrollList.addEventListener("click", (event) => {
    if (event.target.classList.contains("delete-group-icon")) return;
    if (event.target.classList.contains("edit-group-icon")) return;
    const clickedItem = event.target.closest(".group-item");
    if (!clickedItem) return;

    const groupId = clickedItem.getAttribute("data-group-id");

    if (groupId === "global") {
      switchGroupContext(
        "global",
        "Main Feed",
        "Displaying all global posts and public group content."
      );
    } else {
      const groupData = currentGroupsDataMap[groupId];
      if (groupData) {
        switchGroupContext(groupId, groupData.name, groupData.description);
      }
    }
  });
}

// --- VISIBILITY ARCHITECTURE MATRIX ---
function evaluateGroupVisibility() {
  const gateUi = document.getElementById("groupGateUi");
  const publicJoinUi = document.getElementById("publicGroupJoinUi");
  const requestsPanel = document.getElementById("groupRequestsPanel");
  const restrictedUi = document.getElementById("restrictedFeedUi");

  // Reset UI
  if (gateUi) gateUi.style.display = "none";
  if (publicJoinUi) publicJoinUi.style.display = "none";
  if (requestsPanel) requestsPanel.style.display = "none";
  if (restrictedUi) restrictedUi.style.display = "none";
  postsStream.style.display = "flex";

  // A role can fully restrict a member from viewing any content at all.
  if (auth.currentUser && !myPermissions.permissions.canView) {
    postsStream.style.display = "none";
    if (createPostBox) createPostBox.style.display = "none";
    if (restrictedUi) restrictedUi.style.display = "block";
    return false;
  }

  if (currentActiveGroupId === "global") return true;

  const group = currentGroupsDataMap[currentActiveGroupId];
  if (!group) return true;

  const isMember =
    auth.currentUser && group.members?.includes(auth.currentUser.uid);
  const isAdminOrOwner =
    auth.currentUser &&
    (myPermissions.isOwner ||
      myPermissions.permissions.manageGroupRequests ||
      group.creatorId === auth.currentUser.uid);

  // Show member request panel for owners/admins
  if (isAdminOrOwner && requestsPanel) {
    requestsPanel.style.display = "block";
    loadGroupJoinRequests(currentActiveGroupId);
  }

  if (group.accessibility === "private") {
    if (!isMember && !isAdminOrOwner) {
      postsStream.style.display = "none";
      if (createPostBox) createPostBox.style.display = "none";
      if (gateUi) gateUi.style.display = "block";
      return false;
    }
  } else if (
    group.accessibility === "public" &&
    !isMember &&
    auth.currentUser
  ) {
    if (publicJoinUi) publicJoinUi.style.display = "block";
  }

  return true;
}

function switchGroupContext(groupId, title, description) {
  currentActiveGroupId = groupId;
  feedTitle.innerText = title;
  feedDescription.innerText = description;

  document
    .querySelectorAll(".group-item")
    .forEach((el) => el.classList.remove("active"));
  const targetEl = document.getElementById(`target-grp-${groupId}`);
  if (targetEl) targetEl.classList.add("active");

  if (globalFeedSearchBar) globalFeedSearchBar.value = "";

  const canView = evaluateGroupVisibility();
  evaluateComposerVisibility();

  if (canView) {
    streamActivePosts();
  }
}

// Localized Group Member Requests Pipeline
function loadGroupJoinRequests(groupId) {
  if (activeGroupReqListener) activeGroupReqListener();
  const q = query(
    collection(db, "memberRequests"),
    where("groupId", "==", groupId),
    where("status", "==", "pending")
  );

  activeGroupReqListener = onSnapshot(q, (snapshot) => {
    const countEl = document.getElementById("groupReqCount");
    const grpReqDropdownContent = document.getElementById(
      "groupRequestsDropdownContent"
    );

    if (countEl) countEl.innerText = snapshot.size;
    if (grpReqDropdownContent) {
      grpReqDropdownContent.innerHTML = "";
      if (snapshot.empty) {
        grpReqDropdownContent.innerHTML = `<p class="empty-msg">No pending requests.</p>`;
        return;
      }
      snapshot.forEach((docSnap) => {
        const req = docSnap.data();
        const reqId = docSnap.id;
        grpReqDropdownContent.innerHTML += `
            <div class="request-item">
              <div><strong>${
                req.userEmail.split("@")[0]
              }</strong> wants to join</div>
              <div class="btn-group">
                <button class="accept-btn" id="acc-mem-${reqId}">Accept</button>
                <button class="decline-btn" id="dec-mem-${reqId}">Decline</button>
              </div>
            </div>
        `;
        setTimeout(() => {
          const aBtn = document.getElementById(`acc-mem-${reqId}`);
          const dBtn = document.getElementById(`dec-mem-${reqId}`);
          if (aBtn) {
            aBtn.onclick = async () => {
              await updateDoc(doc(db, "groups", groupId), {
                members: arrayUnion(req.userId),
              });
              await updateDoc(doc(db, "memberRequests", reqId), {
                status: "approved",
              });
            };
          }
          if (dBtn) {
            dBtn.onclick = async () => {
              await updateDoc(doc(db, "memberRequests", reqId), {
                status: "declined",
              });
            };
          }
        }, 50);
      });
    }
  });
}

// Join buttons wiring
const reqJoinBtn = document.getElementById("requestJoinGroupBtn");
const cancelJoinBtn = document.getElementById("cancelJoinGroupBtn");
const joinPublicBtn = document.getElementById("joinPublicGroupBtn");
const grpReqDropdownBtn = document.getElementById("groupRequestsDropdownBtn");
const grpReqDropdownContent = document.getElementById(
  "groupRequestsDropdownContent"
);

if (grpReqDropdownBtn) {
  grpReqDropdownBtn.addEventListener("click", () => {
    if (grpReqDropdownContent) grpReqDropdownContent.classList.toggle("show");
  });
}

if (reqJoinBtn) {
  reqJoinBtn.addEventListener("click", async () => {
    if (!auth.currentUser) return alert("Log in to request access.");
    if (!myPermissions.permissions.canJoinGroups) {
      return alert("Your account role does not allow you to join groups.");
    }
    await addDoc(collection(db, "memberRequests"), {
      groupId: currentActiveGroupId,
      groupName: currentGroupsDataMap[currentActiveGroupId].name,
      userId: auth.currentUser.uid,
      userEmail: auth.currentUser.email,
      status: "pending",
      createdAt: new Date(),
    });
    alert("Request sent to the group creator!");
    reqJoinBtn.innerText = "Request Sent";
    reqJoinBtn.disabled = true;
  });
}
if (cancelJoinBtn) {
  cancelJoinBtn.addEventListener("click", () => {
    switchGroupContext(
      "global",
      "Main Feed",
      "Displaying all global posts and public group content."
    );
  });
}
if (joinPublicBtn) {
  joinPublicBtn.addEventListener("click", async () => {
    if (!auth.currentUser) return alert("Log in to join.");
    if (!myPermissions.permissions.canJoinGroups) {
      return alert("Your account role does not allow you to join groups.");
    }
    const grpRef = doc(db, "groups", currentActiveGroupId);
    await updateDoc(grpRef, { members: arrayUnion(auth.currentUser.uid) });
    alert("Joined group successfully!");
    joinPublicBtn.style.display = "none";
    if (currentGroupsDataMap[currentActiveGroupId]) {
      currentGroupsDataMap[currentActiveGroupId].members.push(
        auth.currentUser.uid
      );
    }
    evaluateGroupVisibility();
    evaluateComposerVisibility();
    streamActivePosts();
  });
}

function evaluateComposerVisibility() {
  if (!createPostBox) return;
  if (!auth.currentUser) {
    createPostBox.style.display = "none";
    return;
  }
  if (!myPermissions.permissions.canPost) {
    createPostBox.style.display = "none";
    return;
  }
  // Always show for global feed
  if (currentActiveGroupId === "global") {
    createPostBox.style.display = "block";
    return;
  }
  const currentGroup = currentGroupsDataMap[currentActiveGroupId];
  if (currentGroup) {
    if (currentGroup.accessibility === "public") {
      // Any logged-in user can post in public groups
      createPostBox.style.display = "block";
    } else if (
      currentGroup.members &&
      currentGroup.members.includes(auth.currentUser.uid)
    ) {
      // Private group — only members
      createPostBox.style.display = "block";
    } else {
      // Private group — user is not a member yet
      createPostBox.style.display = "none";
    }
  } else {
    createPostBox.style.display = "none";
  }
}

// --- Dynamic Reactive Client Search System ---
if (globalFeedSearchBar) {
  globalFeedSearchBar.addEventListener("input", (e) => {
    const queryTerm = e.target.value.toLowerCase().trim();
    filterAndRenderPosts(queryTerm);
  });
}

// Global Core Real-time Sync Data Stream Pipe

function streamActivePosts() {
  if (activePostsListenerUnsubscribe) activePostsListenerUnsubscribe();

  const postsRef = collection(db, "posts");
  let targetQuery;

  if (currentActiveGroupId === "global") {
    targetQuery = query(postsRef, orderBy("createdAt", "desc"));
  } else {
    targetQuery = query(
      postsRef,
      where("groupId", "==", currentActiveGroupId),
      orderBy("createdAt", "desc")
    );
  }

  activePostsListenerUnsubscribe = onSnapshot(
    targetQuery,
    (snapshot) => {
      masterPostsCache = [];
      snapshot.forEach((docSnap) => {
        const postData = { id: docSnap.id, ...docSnap.data() };

        // ── Main Feed Visibility Filter ─────────────────
        // === STRICT GROUP VISIBILITY RULES ===
        if (currentActiveGroupId === "global" && postData.groupId) {
          const groupData = currentGroupsDataMap[postData.groupId];
          if (!groupData) return;

          // Private group posts NEVER appear in Main Feed
          if (groupData.accessibility === "private") return;

          // Public group posts only appear in Main Feed if user has joined
          const isMember =
            auth.currentUser &&
            groupData.members &&
            groupData.members.includes(auth.currentUser.uid);

          if (!isMember) return;
        }

        masterPostsCache.push(postData);
      });

      const initialSearchVal = globalFeedSearchBar
        ? globalFeedSearchBar.value.toLowerCase().trim()
        : "";
      filterAndRenderPosts(initialSearchVal);
    },
    (err) => {
      console.error("Firestore stream intercept break: ", err);
    }
  );
}

// Processes internal query filters and reconciles current view with Zero-Blink granular targeting updates
function filterAndRenderPosts(filterQuery) {
  if (postVisibilityObserver) postVisibilityObserver.disconnect();
  Object.keys(activeVisibilityTimers).forEach((postId) => {
    clearTimeout(activeVisibilityTimers[postId]);
    delete activeVisibilityTimers[postId];
  });

  postsStream.style.display = "flex";
  postsStream.style.flexDirection = "column";
  postsStream.style.flexWrap = "nowrap";
  postsStream.style.overflowX = "hidden";

  const filtered = masterPostsCache.filter((post) => {
    if (!filterQuery) return true;
    const titleMatch = post.title
      ? post.title.toLowerCase().includes(filterQuery)
      : false;
    const bodyMatch = post.text
      ? post.text.toLowerCase().includes(filterQuery)
      : false;
    const authorMatch = post.authorEmail
      ? post.authorEmail.toLowerCase().includes(filterQuery)
      : false;
    return titleMatch || bodyMatch || authorMatch;
  });

  if (filtered.length === 0) {
    postsStream.innerHTML = `<div class="empty-feed-placeholder">No matching structural posts found in this feed view.</div>`;
    return;
  }

  const placeholder = postsStream.querySelector(".empty-feed-placeholder");
  if (placeholder) placeholder.remove();

  const filteredIdsSet = new Set(filtered.map((p) => p.id));

  const currentDomCards = postsStream.querySelectorAll(".post-card");
  currentDomCards.forEach((card) => {
    const cardPostId = card.getAttribute("data-post-id");
    if (!filteredIdsSet.has(cardPostId)) {
      card.remove();
      if (activeCommentSubscribersMap[cardPostId]) {
        activeCommentSubscribersMap[cardPostId]();
        delete activeCommentSubscribersMap[cardPostId];
      }
    }
  });

  filtered.forEach((post) => {
    const existingCard = document.getElementById(`card-${post.id}`);

    if (existingCard) {
      const viewLbl = document.getElementById(`view-counter-lbl-${post.id}`);
      if (viewLbl) viewLbl.innerText = `${post.viewsCount || 0} Views`;

      const commLbl = document.getElementById(`comment-counter-lbl-${post.id}`);
      if (commLbl) commLbl.innerText = `${post.commentsCount || 0} Comments`;

      const pollContainer = document.getElementById(
        `poll-container-${post.id}`
      );
      if (pollContainer) {
        pollContainer.innerHTML = buildPollMarkup(post);
        bindPollVoteListeners(pollContainer, post.id);
      }

      const reactionsBar = document.getElementById(`reactions-bar-${post.id}`);
      if (reactionsBar) {
        reactionsBar.innerHTML = buildReactionsMarkup(post);
        bindReactionPillListeners(reactionsBar, post.id);
      }

      postsStream.appendChild(existingCard);
    } else {
      const displayName =
        post.authorDisplayName ||
        (post.authorEmail ? post.authorEmail.split("@")[0] : "Anonymous");
      const photoUrl = post.authorPhotoUrl || "";
      const userBadgeLetter = displayName.charAt(0).toUpperCase();
      const avatarInner = photoUrl
        ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : userBadgeLetter;

      let mediaTemplate = "";
      if (post.attachmentUrl) {
        if (post.attachmentType?.startsWith("image/")) {
          mediaTemplate = `<div class="post-media-wrap"><img src="${post.attachmentUrl}" alt="Attachment Image" class="post-img-attachment"/></div>`;
        } else if (post.attachmentType?.startsWith("video/")) {
          mediaTemplate = `<div class="post-media-wrap"><video src="${post.attachmentUrl}" controls class="post-video-attachment"></video></div>`;
        } else {
          mediaTemplate = `<div class="post-file-wrap">📁 <a href="${
            post.attachmentUrl
          }" target="_blank" download>${
            post.attachmentName || "Download Resource Asset"
          }</a></div>`;
        }
      }

      let htmlTemplate = "";
      if (post.embeddedHtml) {
        // Render embedded HTML in a sandboxed iframe so any <style> or
        // global CSS inside the user's HTML cannot bleed into the page.
        // allow-scripts is intentionally omitted to block JS execution.
        const escapedHtml = post.embeddedHtml
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;");
        htmlTemplate = `
          <iframe
            class="post-custom-plugin-sandbox"
            srcdoc="${escapedHtml}"
            sandbox="allow-same-origin allow-forms allow-popups"
            loading="lazy"
            style="width:100%;border:none;min-height:120px;border-radius:8px;background:#fff;"
            onload="this.style.height=(this.contentDocument.body.scrollHeight+16)+'px'"
          ></iframe>`;
      }

      const isAuthor =
        auth.currentUser && post.authorId === auth.currentUser.uid;
      const isAdmin =
        auth.currentUser &&
        (myPermissions.isOwner || myPermissions.permissions.deleteContent);
      const canEditThisPost =
        isAuthor && myPermissions.permissions.canEditOwnPosts;

      const editBtnHTML = canEditThisPost
        ? `<span class="material-symbols-outlined edit-post-trigger-btn" data-post-id="${post.id}" title="Edit post" style="font-size:16px; color:var(--accent-purple); cursor:pointer; margin-right:8px;">edit</span>`
        : "";

      const actionsTemplate = `${editBtnHTML}${
        isAuthor || isAdmin
          ? `<button class="delete-post-trigger-btn" data-post-id="${post.id}" style="background:none; border:none; color:#ff4d4d; font-size:12px; cursor:pointer;">Delete Post</button>`
          : ""
      }`;

      const initialCommentsCount = post.commentsCount || 0;
      const viewsCount = post.viewsCount || 0;
      const commentPanelDisplay = openCommentSectionsMap[post.id]
        ? "block"
        : "none";

      const cardHTML = `
        <div class="post-card" id="card-${post.id}" data-post-id="${post.id}">
          <div class="post-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="post-author-avatar">${avatarInner}</div>
              <div class="post-meta-details">
                <span style="display:flex; align-items:center;">
                  <a href="profile.html?uid=${post.authorId || ""}" class="author-name author-name-link">${displayName}</a>
                  <span class="user-badge-row-slot" data-badge-author-uid="${
                    post.authorId || ""
                  }" data-badge-id-prefix="post-${post.id}">${renderAuthorBadgeRow(
        post.authorId,
        `post-${post.id}`
      )}</span>
                </span>
                <span class="post-timestamp">${
                  post.createdAt
                    ? new Date(
                        post.createdAt.seconds * 1000
                      ).toLocaleDateString()
                    : "Just Now"
                }</span>
              </div>
            </div>
            <div class="header-actions-wrap">${actionsTemplate}</div>
          </div>
          
          <div class="post-body-content">
            ${
              post.title
                ? `<h3 class="post-render-title">${post.title}</h3>`
                : ""
            }
            <p class="post-render-text">${post.text || ""}</p>
            ${mediaTemplate}
            ${htmlTemplate}
            <div id="poll-container-${post.id}">${buildPollMarkup(post)}</div>
            ${
              post.lastEditedAt
                ? `<button type="button" class="post-edited-indicator" data-post-id="${post.id}">edited</button>`
                : ""
            }
          </div>

          <div class="post-reactions-bar" id="reactions-bar-${post.id}">
            ${buildReactionsMarkup(post)}
          </div>

          <div class="post-engagement-bar">
            <button class="toggle-comments-trigger-btn" data-post-id="${
              post.id
            }">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span id="comment-counter-lbl-${
                post.id
              }">${initialCommentsCount} Comments</span>
            </button>
            <div class="view-counter-lbl">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <span id="view-counter-lbl-${post.id}">${viewsCount} Views</span>
            </div>
          </div>

          <div class="post-comments-drawer-panel" id="comments-drawer-${
            post.id
          }" style="display:${commentPanelDisplay};">
            <div class="loaded-comments-stream-list" id="comments-list-${
              post.id
            }"></div>
            <div class="comment-input-form-row">
              <input type="text" class="comment-message-input-field" id="comment-field-${
                post.id
              }" placeholder="Write a comment..." />
              <button class="submit-comment-action-btn" data-post-id="${
                post.id
              }">Send</button>
            </div>
          </div>
        </div>
      `;

      const tempWrap = document.createElement("div");
      tempWrap.innerHTML = cardHTML;
      const cardNode = tempWrap.firstElementChild;
      postsStream.appendChild(cardNode);

      bindCardEventListeners(cardNode, post.id);
      bindBadgeOverflowTriggers(cardNode);

      if (openCommentSectionsMap[post.id]) {
        bindRealTimeCommentsStream(post.id);
      }
    }
  });

  setupPostVisibilityObserver();
  handlePendingPostDeepLink();
}

// Scrolls to + highlights the post a notification linked to, and opens
// its comments drawer (comment notifications only carry a postId, not a
// distinct comment id, so opening the drawer is the closest we can get
// to "take me to that exact comment"). Runs once per page load.
function handlePendingPostDeepLink() {
  if (!pendingDeepLinkPostId) return;
  const card = document.getElementById(`card-${pendingDeepLinkPostId}`);
  if (!card) return; // not rendered in this view yet/at all — nothing to do

  const targetPostId = pendingDeepLinkPostId;
  pendingDeepLinkPostId = null; // only do this once

  setTimeout(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("post-deep-link-highlight");
    setTimeout(() => card.classList.remove("post-deep-link-highlight"), 2600);

    // Open the comments drawer too, in case this came from a comment
    // notification — closest available anchor since comments don't have
    // their own addressable id in the URL scheme.
    const drawer = document.getElementById(`comments-drawer-${targetPostId}`);
    if (drawer && drawer.style.display === "none") {
      openCommentSectionsMap[targetPostId] = true;
      drawer.style.display = "block";
      bindRealTimeCommentsStream(targetPostId);
    }
  }, 100);
}

// Generates structural HTML templates for inline post voting widgets
function buildPollMarkup(post) {
  if (!post.pollData) return "";
  const p = post.pollData;
  let optionsMarkup = "";
  const totalVotes = p.options.reduce(
    (acc, opt) => acc + (opt.voters ? opt.voters.length : 0),
    0
  );
  const hasVoted =
    auth.currentUser &&
    p.options.some(
      (opt) => opt.voters && opt.voters.includes(auth.currentUser.uid)
    );

  if (p.type === "grid") {
    optionsMarkup = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">`;
    p.options.forEach((opt) => {
      const optVotes = opt.voters ? opt.voters.length : 0;
      const percent =
        totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
      if (hasVoted || !auth.currentUser) {
        optionsMarkup += `
          <div style="border:1px solid #ddd; border-radius:6px; background:#2c3545; overflow:hidden; text-align:center; position:relative; padding-bottom:8px;">
            <img src="${
              opt.image || "https://via.placeholder.com/150x100?text=No+Image"
            }" style="width:100%; height:100px; object-fit:cover;" />
            <div style="font-weight:bold; font-size:13px; margin-top:6px; position:relative; z-index:2; color:#fff;">${
              opt.text
            }</div>
            <div style="font-size:12px; color:#38bdf8; font-weight:bold; margin-top:4px; position:relative; z-index:2;">${percent}% (${optVotes})</div>
            <div style="position:absolute; bottom:0; left:0; right:0; height:4px; background:#0078d4; width:${percent}%;"></div>
          </div>`;
      } else {
        optionsMarkup += `
          <div class="poll-vote-action-btn" data-option-id="${
            opt.id
          }" data-post-id="${
          post.id
        }" style="border:1px solid #475569; border-radius:6px; background:#252f3f; overflow:hidden; text-align:center; padding-bottom:8px; cursor:pointer; transition:transform 0.15s, border-color 0.15s;">
            <img src="${
              opt.image || "https://via.placeholder.com/150x100?text=No+Image"
            }" style="width:100%; height:100px; object-fit:cover; pointer-events:none;" />
            <div style="font-weight:bold; font-size:13px; margin-top:6px; color:#38bdf8; pointer-events:none;">${
              opt.text
            }</div>
          </div>`;
      }
    });
    optionsMarkup += `</div>`;
  } else {
    optionsMarkup = `<div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">`;
    p.options.forEach((opt) => {
      const optVotes = opt.voters ? opt.voters.length : 0;
      const percent =
        totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
      if (hasVoted || !auth.currentUser) {
        optionsMarkup += `
          <div style="padding:10px; border:1px solid #475569; border-radius:6px; background:#252f3f; font-size:13px; position:relative; overflow:hidden;">
            <div style="position:absolute; top:0; left:0; bottom:0; width:${percent}%; background:#0078d4; opacity:0.3; transition:width 0.3s;"></div>
            <div style="display:flex; justify-content:space-between; position:relative; font-weight:500; color:#fff;">
              <span>${opt.text}</span>
              <span style="color:#38bdf8; font-weight:bold;">${percent}% (${optVotes})</span>
            </div>
          </div>`;
      } else {
        optionsMarkup += `
          <button class="poll-vote-action-btn" data-option-id="${
            opt.id
          }" data-post-id="${
          post.id
        }" style="width:100%; text-align:left; padding:10px; border:1px solid #475569; border-radius:6px; background:#1e293b; color:#fff; font-size:13px; cursor:pointer; transition:background 0.2s;">
            ${
              p.type === "image"
                ? `<img src="${
                    opt.image || "https://via.placeholder.com/40"
                  }" style="width:30px; height:30px; object-fit:cover; vertical-align:middle; margin-right:8px; border-radius:4px;" />`
                : ""
            }
            ${opt.text}
          </button>`;
      }
    });
    optionsMarkup += `</div>`;
  }

  return `<div class="poll-widget-frame" style="margin-top:12px; background:#131922; padding:12px; border-radius:6px; border:1px solid #2d3748;">
            <div style="font-weight:600; font-size:14px; color:#f8fafc; margin-bottom:4px;">📊 ${p.question}</div>
            ${optionsMarkup}
          </div>`;
}

// Intercepts and assigns event actions to targeted poll options
function bindPollVoteListeners(container, postId) {
  container.querySelectorAll(".poll-vote-action-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      if (!auth.currentUser) {
        alert("Please login to cast votes");
        return;
      }

      const optionId = btn.getAttribute("data-option-id");
      const postRef = doc(db, "posts", postId);
      const post = masterPostsCache.find((p) => p.id === postId);

      if (post && post.pollData) {
        const updatedOptions = post.pollData.options.map((opt) => {
          if (opt.id === optionId) {
            const votersList = opt.voters || [];
            if (!votersList.includes(auth.currentUser.uid))
              votersList.push(auth.currentUser.uid);
            opt.voters = votersList;
          }
          return opt;
        });

        updateDoc(postRef, { "pollData.options": updatedOptions });
      }
    };
  });
}

// Binds functional listeners inside individual template cards explicitly
function bindCardEventListeners(card, postId) {
  const delBtn = card.querySelector(".delete-post-trigger-btn");
  if (delBtn) {
    delBtn.onclick = () => {
      if (confirm("Are you sure you want to completely delete this post?")) {
        const post = masterPostsCache.find((p) => p.id === postId);
        const chanName = post ? post.groupName || "Main Feed" : "Main Feed";
        addDoc(collection(db, "notifications"), {
          title: "Post Deleted",
          message: `A published post inside "${chanName}" was deleted.`,
          type: "post_deletion",
          createdAt: new Date(),
          viewedBy: [],
        }).then(() => {
          deleteDoc(doc(db, "posts", postId));
        });
      }
    };
  }

  const toggleCommentsBtn = card.querySelector(".toggle-comments-trigger-btn");
  if (toggleCommentsBtn) {
    toggleCommentsBtn.onclick = () => {
      const drawer = document.getElementById(`comments-drawer-${postId}`);
      if (drawer.style.display === "none") {
        drawer.style.display = "block";
        openCommentSectionsMap[postId] = true;
        bindRealTimeCommentsStream(postId);
      } else {
        drawer.style.display = "none";
        openCommentSectionsMap[postId] = false;
        if (activeCommentSubscribersMap[postId]) {
          activeCommentSubscribersMap[postId]();
          delete activeCommentSubscribersMap[postId];
        }
      }
    };
  }

  const sendCommentBtn = card.querySelector(".submit-comment-action-btn");
  if (sendCommentBtn) {
    sendCommentBtn.onclick = () => dispatchNewComment(postId);
  }

  const commentField = document.getElementById(`comment-field-${postId}`);
  if (commentField) {
    commentField.onkeydown = (e) => {
      if (e.key === "Enter") dispatchNewComment(postId);
    };
  }

  const pollContainer = document.getElementById(`poll-container-${postId}`);
  if (pollContainer) bindPollVoteListeners(pollContainer, postId);

  const editBtn = card.querySelector(".edit-post-trigger-btn");
  if (editBtn) {
    editBtn.onclick = () => {
      const post = masterPostsCache.find((p) => p.id === postId);
      if (!post) return;
      // Live re-check — never trust that the pencil icon itself is current.
      const isAuthorNow = auth.currentUser && post.authorId === auth.currentUser.uid;
      if (!isAuthorNow || !myPermissions.permissions.canEditOwnPosts) {
        alert("You no longer have permission to edit this post.");
        return;
      }
      openEditPostModal(postId, post);
    };
  }

  const editedIndicator = card.querySelector(".post-edited-indicator");
  if (editedIndicator) {
    editedIndicator.onclick = () => openPostHistoryModal(postId);
  }

  const reactionsBar = document.getElementById(`reactions-bar-${postId}`);
  if (reactionsBar) bindReactionPillListeners(reactionsBar, postId);
}

// =============================================================================
//  POST REACTIONS — { emoji: [uid, uid, ...] } stored on the post doc.
//  Multiple distinct emoji reactions per person are allowed (Discord-style);
//  clicking an emoji you've already used toggles it back off.
// =============================================================================

function buildReactionsMarkup(post) {
  const reactions = post.reactions || {};
  const myUid = auth.currentUser ? auth.currentUser.uid : null;

  const pillsHTML = Object.entries(reactions)
    .filter(([, uids]) => Array.isArray(uids) && uids.length > 0)
    .map(([emoji, uids]) => {
      const mine = myUid && uids.includes(myUid);
      return `
        <button type="button" class="reaction-pill${mine ? " reaction-pill-mine" : ""}" data-post-id="${post.id}" data-emoji="${emoji}">
          <span class="reaction-pill-emoji">${emoji}</span>
          <span class="reaction-pill-count">${uids.length}</span>
        </button>
      `;
    })
    .join("");

  const addBtnHTML = `
    <button type="button" class="reaction-add-btn" data-post-id="${post.id}" title="Add a reaction">
      <span class="material-symbols-outlined" style="font-size:16px;">add_reaction</span>
      Add Reaction
    </button>
  `;

  return pillsHTML + addBtnHTML;
}

function bindReactionPillListeners(container, postId) {
  container.querySelectorAll(".reaction-pill").forEach((pill) => {
    pill.onclick = () => {
      const emoji = pill.getAttribute("data-emoji");
      toggleReaction(postId, emoji);
    };
  });

  const addBtn = container.querySelector(".reaction-add-btn");
  if (addBtn) {
    addBtn.onclick = () => openReactionPickerModal(postId);
  }
}

async function toggleReaction(postId, emoji) {
  if (!auth.currentUser) {
    alert("Please log in to react to posts.");
    return;
  }
  if (!myPermissions.permissions.canReactToPosts) {
    alert("Your account role does not allow you to react to posts.");
    return;
  }

  const post = masterPostsCache.find((p) => p.id === postId);
  const existingUids = (post && post.reactions && post.reactions[emoji]) || [];
  const alreadyReacted = existingUids.includes(auth.currentUser.uid);

  const fieldPath = `reactions.${emoji}`;
  try {
    await updateDoc(doc(db, "posts", postId), {
      [fieldPath]: alreadyReacted
        ? arrayRemove(auth.currentUser.uid)
        : arrayUnion(auth.currentUser.uid),
    });
  } catch (err) {
    alert("Error reacting: " + err.message);
  }
}

function openReactionPickerModal(postId) {
  if (!auth.currentUser) {
    alert("Please log in to react to posts.");
    return;
  }
  if (!myPermissions.permissions.canReactToPosts) {
    alert("Your account role does not allow you to react to posts.");
    return;
  }

  const modal = document.getElementById("reactionPickerModal");
  const grid = document.getElementById("reactionEmojiGrid");
  const searchField = document.getElementById("reactionSearchField");
  const closeBtn = document.getElementById("closeReactionPickerModal");
  if (!modal || !grid) return;

  const renderGrid = (term) => {
    renderEmojiGrid(grid, term, (char) => {
      toggleReaction(postId, char);
      modal.style.display = "none";
    });
  };

  if (searchField) {
    searchField.value = "";
    searchField.oninput = (e) => renderGrid(e.target.value);
  }
  renderGrid("");

  if (closeBtn) closeBtn.onclick = () => { modal.style.display = "none"; };
  modal.style.display = "flex";
}

// Connects sub-collection data snapshot sync bindings for comment tracking
function bindRealTimeCommentsStream(postId) {
  if (activeCommentSubscribersMap[postId]) return;

  const listContainer = document.getElementById(`comments-list-${postId}`);
  const commentsQuery = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "asc")
  );

  activeCommentSubscribersMap[postId] = onSnapshot(
    commentsQuery,
    (snapshot) => {
      if (!listContainer) return;
      listContainer.innerHTML = "";

      snapshot.forEach((docSnap) => {
        const comm = docSnap.data();
        const cId = docSnap.id;
        const displayAuthor =
          comm.authorDisplayName ||
          (comm.authorEmail ? comm.authorEmail.split("@")[0] : "Anonymous");
        const commentPhotoUrl = comm.authorPhotoUrl || "";
        const userLetter = displayAuthor.charAt(0).toUpperCase();
        const commentAvatar = commentPhotoUrl
          ? `<img src="${commentPhotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
          : userLetter;

        const isCommentOwner =
          auth.currentUser && auth.currentUser.uid === comm.authorUid;
        const isAdmin =
          auth.currentUser &&
          (myPermissions.isOwner || myPermissions.permissions.deleteContent);
        const commentDelBtn =
          isCommentOwner || isAdmin
            ? `<span class="material-symbols-outlined" id="del-comm-${postId}-${cId}" style="font-size:14px; color:#cf6679; cursor:pointer; margin-left:auto;">delete</span>`
            : "";

        const commentItem = document.createElement("div");
        commentItem.className = "comment-item";
        commentItem.innerHTML = `
        <div class="comment-avatar">${commentAvatar}</div>
        <div style="display:flex;flex-direction:column;flex:1;">
          <span style="display:flex; align-items:center;">
            <a href="profile.html?uid=${comm.authorUid || ""}" class="comment-author-name comment-author-name-link">${displayAuthor}</a>
            <span class="user-badge-row-slot" data-badge-author-uid="${
              comm.authorUid || ""
            }" data-badge-id-prefix="comment-${cId}">${renderAuthorBadgeRow(
        comm.authorUid,
        `comment-${cId}`
      )}</span>
          </span>
          <span class="comment-body-text">${comm.text}</span>
        </div>
        ${commentDelBtn}
      `;
        listContainer.appendChild(commentItem);
        bindBadgeOverflowTriggers(commentItem);

        if (isCommentOwner || isAdmin) {
          const dcBtn = document.getElementById(`del-comm-${postId}-${cId}`);
          if (dcBtn) {
            dcBtn.onclick = () => {
              if (confirm("Remove your comment?")) {
                addDoc(collection(db, "notifications"), {
                  title: "Comment Deleted",
                  message: `A comment was deleted.`,
                  type: "comment_deletion",
                  createdBy: auth.currentUser.uid,
                  createdAt: new Date(),
                  viewedBy: [],
                }).then(() => {
                  deleteDoc(doc(db, "posts", postId, "comments", cId)).then(
                    () => {
                      const post = masterPostsCache.find(
                        (p) => p.id === postId
                      );
                      const currentCommentsCount = post
                        ? post.commentsCount || 0
                        : 1;
                      updateDoc(doc(db, "posts", postId), {
                        commentsCount: Math.max(0, currentCommentsCount - 1),
                      });
                    }
                  );
                });
              }
            };
          }
        }
      });

      listContainer.scrollTop = listContainer.scrollHeight;
    }
  );
}

// Writes fresh feedback responses safely into nested targets
async function dispatchNewComment(postId) {
  if (!auth.currentUser) {
    alert("Please sign in to add content.");
    return;
  }
  if (!myPermissions.permissions.canComment) {
    alert("Your account role does not allow you to comment.");
    return;
  }

  const field = document.getElementById(`comment-field-${postId}`);
  const txt = field ? field.value.trim() : "";
  if (!txt) return;

  // ── Content moderation ──────────────────────────────────────────────────
  const filterResult = await checkContent(txt);
  if (!filterResult.allowed) {
    alert(`Comment blocked: ${filterResult.reason}`);
    return;
  }
  // ────────────────────────────────────────────────────────────────────────

  const commentAuthorName =
    currentUserProfile.displayName || auth.currentUser.email.split("@")[0];

  addDoc(collection(db, "posts", postId, "comments"), {
    text: txt,
    authorUid: auth.currentUser.uid,
    authorEmail: auth.currentUser.email,
    authorDisplayName: commentAuthorName,
    authorPhotoUrl: currentUserProfile.photoUrl || "",
    createdAt: new Date(),
  }).then(() => {
    const currentPost = masterPostsCache.find((p) => p.id === postId);
    addDoc(collection(db, "notifications"), {
      title: "New Comment",
      message: `${commentAuthorName} commented on a post in "${currentPost?.groupName || "Main Feed"}".`,
      preview: txt.substring(0, 120),
      type: "comment_creation",
      postId: postId,
      groupId: currentPost?.groupId || null,
      groupName: currentPost?.groupName || null,
      groupMembers: currentPost?.groupId
        ? (currentGroupsDataMap[currentPost.groupId]?.members || [])
        : null,
      createdBy: auth.currentUser.uid,
      createdAt: new Date(),
      viewedBy: [],
    });

    const updatedCount = currentPost ? (currentPost.commentsCount || 0) + 1 : 1;

    updateDoc(doc(db, "posts", postId), { commentsCount: updatedCount }).then(
      () => {
        if (field) field.value = "";
      }
    );
  });
}

// --- Wix Composer Window View Event Listeners Configuration ---
if (openComposerBtn) {
  openComposerBtn.addEventListener("click", () => {
    if (!auth.currentUser) {
      alert("Please login to make a post.");
      return;
    }
    composerModal.style.display = "flex";
    compUser.innerText =
      currentUserProfile.displayName || auth.currentUser.email.split("@")[0];
    if (currentUserProfile.photoUrl) {
      compAvatar.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
      compAvatar.innerText = (
        currentUserProfile.displayName || auth.currentUser.email.split("@")[0]
      )
        .charAt(0)
        .toUpperCase();
    }
    if (currentActiveGroupId === "global") {
      compTargetGroup.innerText = "Main Feed";
    } else {
      const currentGroup = currentGroupsDataMap[currentActiveGroupId];
      compTargetGroup.innerText = currentGroup
        ? currentGroup.name
        : "Main Feed";
    }
  });
}

function shutdownComposerWindow() {
  composerModal.style.display = "none";
  postTitleInput.value = "";
  postTextInput.value = "";
  stagingAttachmentUrl = "";
  stagingAttachmentType = "";
  stagingAttachmentName = "";
  stagingEmbeddedHtmlCode = "";
  stagingPollType = "";
  window.stagingPollDataBlueprint = null;
  if (toolBtnPoll) { toolBtnPoll.style.color = ""; toolBtnPoll.title = "Add Poll"; }
  composerAttachmentPreview.style.display = "none";
  if (attachmentLoadingOverlay) attachmentLoadingOverlay.style.display = "none";
  attachmentRenderArea.innerHTML = "";
  attachedHtmlPreview.style.display = "none";
  attachedHtmlPreview.innerText = "";
  if (publishPostBtn) publishPostBtn.disabled = false;
}

if (closeComposerModal)
  closeComposerModal.addEventListener("click", shutdownComposerWindow);
if (cancelComposerBtn)
  cancelComposerBtn.addEventListener("click", shutdownComposerWindow);

// Media Input Attachment Interceptors
if (toolBtnImage)
  toolBtnImage.addEventListener("click", () => hiddenImageInput.click());
if (toolBtnVideo)
  toolBtnVideo.addEventListener("click", () => hiddenVideoInput.click());
if (toolBtnFile)
  toolBtnFile.addEventListener("click", () => hiddenFileInput.click());

if (hiddenImageInput)
  hiddenImageInput.addEventListener("change", (e) =>
    executeAttachmentUpload(e.target.files[0])
  );
if (hiddenVideoInput)
  hiddenVideoInput.addEventListener("change", (e) =>
    executeAttachmentUpload(e.target.files[0])
  );
if (hiddenFileInput)
  hiddenFileInput.addEventListener("change", (e) =>
    executeAttachmentUpload(e.target.files[0])
  );

// Converts a File to a base64 data URL — purely local, no network needed
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function executeAttachmentUpload(file) {
  if (!file) return;

  // Cap at 700 KB: base64 inflates ~33%, keeping the Firestore doc under 1 MB
  const MAX_BYTES = 700 * 1024;
  if (file.size > MAX_BYTES) {
    alert(
      `File is too large (${(file.size / 1048576).toFixed(
        1
      )} MB). Please use a file under 700 KB. Compress large images before attaching.`
    );
    return;
  }

  // ── Phase 1: Instant blob-URL preview ───────────────────────────────────
  const blobUrl = URL.createObjectURL(file);
  composerAttachmentPreview.style.display = "block";
  attachmentRenderArea.innerHTML = "";

  if (file.type.startsWith("image/")) {
    attachmentRenderArea.innerHTML = `
      <div class="media-preview-widget">
        <img src="${blobUrl}" alt="Image preview" class="preview-media-img" />
      </div>`;
  } else if (file.type.startsWith("video/")) {
    attachmentRenderArea.innerHTML = `
      <div class="media-preview-widget">
        <video src="${blobUrl}" controls class="preview-media-video"></video>
      </div>`;
  } else {
    const sizeLabel =
      file.size > 1048576
        ? `${(file.size / 1048576).toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(1)} KB`;
    attachmentRenderArea.innerHTML = `
      <div class="file-attachment-tag">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        <span class="file-name-label">${file.name}</span>
        <span class="file-size-label">${sizeLabel}</span>
      </div>`;
  }

  // ── Phase 2: Convert to base64 (local FileReader, instant, no network) ──
  if (attachmentLoadingOverlay) attachmentLoadingOverlay.style.display = "flex";
  if (publishPostBtn) publishPostBtn.disabled = true;

  try {
    const base64Url = await fileToBase64(file);
    stagingAttachmentUrl = base64Url;
    stagingAttachmentType = file.type;
    stagingAttachmentName = file.name;

    // Swap blob URL for base64 so the post stores the real data
    if (file.type.startsWith("image/")) {
      const img = attachmentRenderArea.querySelector(".preview-media-img");
      if (img) img.src = base64Url;
    } else if (file.type.startsWith("video/")) {
      const vid = attachmentRenderArea.querySelector(".preview-media-video");
      if (vid) vid.src = base64Url;
    }
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error("File read error:", err);
    stagingAttachmentUrl = "";
    const warnEl = document.createElement("p");
    warnEl.className = "upload-error-msg";
    warnEl.innerText = "⚠️ Could not read file. Please try again.";
    attachmentRenderArea.appendChild(warnEl);
  } finally {
    if (attachmentLoadingOverlay)
      attachmentLoadingOverlay.style.display = "none";
    if (publishPostBtn) publishPostBtn.disabled = false;
  }
}

if (clearAttachmentBtn) {
  clearAttachmentBtn.addEventListener("click", () => {
    stagingAttachmentUrl = "";
    stagingAttachmentType = "";
    stagingAttachmentName = "";
    attachmentRenderArea.innerHTML = "";
    composerAttachmentPreview.style.display = "none";
  });
}

// Emoji Tool Bindings
if (toolBtnEmoji) {
  toolBtnEmoji.addEventListener("click", () => {
    emojiPickerPanel.style.display =
      emojiPickerPanel.style.display === "block" ? "none" : "block";
  });
}
if (closeEmojiPanelBtn)
  closeEmojiPanelBtn.addEventListener("click", () => {
    emojiPickerPanel.style.display = "none";
  });

// Plugin Tray Toggles
if (togglePluginSubmenu) {
  togglePluginSubmenu.addEventListener("click", () => {
    pluginSubmenu.style.display =
      pluginSubmenu.style.display === "block" ? "none" : "block";
  });
}

// HTML Plugin Panel Controls
if (btnTriggerHtmlPlugin) {
  btnTriggerHtmlPlugin.addEventListener("click", () => {
    htmlPluginModal.style.display = "flex";
    pluginSubmenu.style.display = "none";
  });
}
if (closeHtmlModal)
  closeHtmlModal.addEventListener("click", () => {
    htmlPluginModal.style.display = "none";
  });
if (cancelHtmlModal)
  cancelHtmlModal.addEventListener("click", () => {
    htmlPluginModal.style.display = "none";
  });

if (saveHtmlModal) {
  saveHtmlModal.addEventListener("click", () => {
    const code = htmlPluginCodeArea.value.trim();
    if (code) {
      stagingEmbeddedHtmlCode = code;
      attachedHtmlPreview.style.display = "block";
      attachedHtmlPreview.innerText = "Custom HTML Snippet Included";
    }
    htmlPluginModal.style.display = "none";
  });
}
if (removeAttachedHtml) {
  removeAttachedHtml.addEventListener("click", () => {
    stagingEmbeddedHtmlCode = "";
    attachedHtmlPreview.style.display = "none";
    attachedHtmlPreview.innerText = "";
  });
}

// Inline Poll Composition — opens a real modal instead of prompt() chain
if (toolBtnPoll) {
  toolBtnPoll.addEventListener("click", () => {
    openPollCreatorModal();
  });
}

function openPollCreatorModal() {
  const modal = document.getElementById("pollCreatorModal");
  if (!modal) return;

  // Reset form
  document.getElementById("pollQuestionInput").value = "";
  document.getElementById("pollOptionsContainer").innerHTML = "";
  document.getElementById("pollTypeSelect").value = "simple";
  addPollOptionRow(); addPollOptionRow(); // start with 2 empty options

  modal.style.display = "flex";
}

function addPollOptionRow(value = "") {
  const container = document.getElementById("pollOptionsContainer");
  const idx = container.children.length + 1;
  const row = document.createElement("div");
  row.className = "poll-option-row";
  row.innerHTML = `
    <input type="text" class="poll-option-input" placeholder="Option ${idx}" value="${value}" maxlength="80" />
    <button type="button" class="poll-option-remove-btn" title="Remove">
      <span class="material-symbols-outlined" style="font-size:16px;">close</span>
    </button>`;
  row.querySelector(".poll-option-remove-btn").onclick = () => {
    if (container.children.length > 2) row.remove();
    else alert("Polls need at least 2 options.");
  };
  container.appendChild(row);
}

const pollCreatorModal = document.getElementById("pollCreatorModal");
if (pollCreatorModal) {
  document.getElementById("closePollCreatorModal").onclick = () => {
    pollCreatorModal.style.display = "none";
  };
  document.getElementById("addPollOptionBtn").onclick = () => {
    if (document.getElementById("pollOptionsContainer").children.length >= 10) {
      alert("Maximum 10 options.");
      return;
    }
    addPollOptionRow();
  };
  document.getElementById("confirmPollBtn").onclick = () => {
    const question = document.getElementById("pollQuestionInput").value.trim();
    if (!question) { alert("Please enter a question."); return; }
    const type = document.getElementById("pollTypeSelect").value;
    const inputs = [...document.querySelectorAll(".poll-option-input")];
    const options = inputs.map((inp, i) => ({
      id: `opt_${Date.now()}_${i}`,
      text: inp.value.trim() || `Option ${i + 1}`,
      image: "",
      voters: [],
    }));
    if (options.length < 2) { alert("Need at least 2 options."); return; }
    stagingPollType = type;
    window.stagingPollDataBlueprint = { question, type, options };
    pollCreatorModal.style.display = "none";
    // Show a small confirmation badge on the poll button
    toolBtnPoll.style.color = "var(--accent-purple)";
    toolBtnPoll.title = `Poll ready: "${question}"`;
  };
}

// Publish Post Submission Actions
if (publishPostBtn) {
  publishPostBtn.addEventListener("click", async () => {
    if (!auth.currentUser) return;
    if (!myPermissions.permissions.canPost) {
      alert("Your account role does not allow you to post.");
      return;
    }
    const txt = postTextInput.value.trim();
    const title = postTitleInput.value.trim();

    if (
      !txt &&
      !stagingAttachmentUrl &&
      !stagingEmbeddedHtmlCode &&
      !window.stagingPollDataBlueprint
    ) {
      alert("Cannot publish an empty post");
      return;
    }

    // ── Content moderation ──────────────────────────────────────────────
    const combinedText = [title, txt].filter(Boolean).join(" ");
    if (combinedText) {
      const filterResult = await checkContent(combinedText);
      if (!filterResult.allowed) {
        alert(`Post blocked: ${filterResult.reason}`);
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────

    const payload = {
      title: title || "",
      text: txt || "",
      groupId: currentActiveGroupId === "global" ? null : currentActiveGroupId,
      groupName:
        currentActiveGroupId === "global"
          ? "Main Feed"
          : currentGroupsDataMap[currentActiveGroupId]?.name || "Main Feed",
      groupAccessibility:
        currentActiveGroupId === "global"
          ? "public"
          : currentGroupsDataMap[currentActiveGroupId]?.accessibility ||
            "public",
      authorId: auth.currentUser.uid,
      authorEmail: auth.currentUser.email,
      authorDisplayName:
        currentUserProfile.displayName || auth.currentUser.email.split("@")[0],
      authorPhotoUrl: currentUserProfile.photoUrl || "",
      createdAt: new Date(),
      commentsCount: 0,
      viewsCount: 0,
    };

    if (stagingAttachmentUrl) {
      payload.attachmentUrl = stagingAttachmentUrl;
      payload.attachmentType = stagingAttachmentType;
      payload.attachmentName = stagingAttachmentName;
    }
    if (stagingEmbeddedHtmlCode) payload.embeddedHtml = stagingEmbeddedHtmlCode;
    if (window.stagingPollDataBlueprint) {
      payload.pollData = window.stagingPollDataBlueprint;
      window.stagingPollDataBlueprint = null;
    }

    try {
      const addedPostRef = await addDoc(collection(db, "posts"), payload);
      const authorName =
        currentUserProfile.displayName || auth.currentUser.email.split("@")[0];

      addDoc(collection(db, "notifications"), {
        title: "New Post Published",
        message: `${authorName} posted in "${payload.groupName}".`,
        preview: (payload.text || payload.title || "").substring(0, 120),
        type: "post_creation",
        postId: addedPostRef ? addedPostRef.id : null,
        groupId: payload.groupId || null,
        groupName: payload.groupName || null,
        groupMembers: payload.groupId
          ? (currentGroupsDataMap[payload.groupId]?.members || [])
          : null,
        createdBy: auth.currentUser.uid,
        createdAt: new Date(),
        viewedBy: [],
      });

      shutdownComposerWindow();
    } catch (err) {
      alert("Failed to submit entry data: " + err.message);
    }
  });
}

// --- Scroll Visibility Observer Implementation ---
function setupPostVisibilityObserver() {
  if (!("IntersectionObserver" in window)) return;

  const config = { root: null, rootMargin: "0px", threshold: 0.5 };

  postVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const postId = entry.target.getAttribute("data-post-id");
      if (!postId) return;

      if (entry.isIntersecting) {
        if (
          !sessionViewedPosts.has(postId) &&
          !activeVisibilityTimers[postId]
        ) {
          activeVisibilityTimers[postId] = setTimeout(() => {
            handlePostViewIncrement(postId);
          }, 2000);
        }
      } else {
        if (activeVisibilityTimers[postId]) {
          clearTimeout(activeVisibilityTimers[postId]);
          delete activeVisibilityTimers[postId];
        }
      }
    });
  }, config);

  document.querySelectorAll(".post-card").forEach((card) => {
    postVisibilityObserver.observe(card);
  });
}

function handlePostViewIncrement(postId) {
  sessionViewedPosts.add(postId);
  delete activeVisibilityTimers[postId];

  const activeUserKeyId = auth.currentUser ? auth.currentUser.uid : "anonymous";
  const localStorageCacheKey = `view_history_${activeUserKeyId}`;

  let localViewHistory = {};
  try {
    const historicalPayload = localStorage.getItem(localStorageCacheKey);
    if (historicalPayload) localViewHistory = JSON.parse(historicalPayload);
  } catch (err) {
    console.error("Local Storage history state decode failure: ", err);
  }

  const timestampNow = Date.now();
  const historicalRecordTime = localViewHistory[postId] || 0;
  const fiveMinutesLockoutDuration = 5 * 60 * 1000;

  if (timestampNow - historicalRecordTime >= fiveMinutesLockoutDuration) {
    const targetedPost = masterPostsCache.find((p) => p.id === postId);
    if (targetedPost) {
      const liveCounterValue = targetedPost.viewsCount || 0;

      updateDoc(doc(db, "posts", postId), { viewsCount: liveCounterValue + 1 })
        .then(() => {
          localViewHistory[postId] = timestampNow;
          localStorage.setItem(
            localStorageCacheKey,
            JSON.stringify(localViewHistory)
          );
        })
        .catch((err) => {
          console.error("Firestore view updating failure: ", err);
        });
    }
  }
}

// --- Sync Nav Notification Badge Metrics ---
function syncNavNotificationBadgeOnly() {
  const q = query(
    collection(db, "notifications"),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snapshot) => {
    let unreadCount = 0;
    snapshot.forEach((itemDoc) => {
      const entry = itemDoc.data();
      // Skip notifications created by the current user
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

// --- Emoji picker: dataset & grid renderer now live in emoji-library.js ---
if (emojiSearchField) {
  emojiSearchField.addEventListener("input", (e) => {
    filterAndRenderEmojiGrid(e.target.value.toLowerCase().trim());
  });
}

function filterAndRenderEmojiGrid(term = "") {
  renderEmojiGrid(emojiGridScrollArea, term, (char) => {
    if (postTextInput) {
      postTextInput.value += char;
      postTextInput.focus();
    }
  });
}

// Initialize components defaults
filterAndRenderEmojiGrid();
console.log("Groups Core Engine Live System Component Registered.");

// =============================================================================
//  DRAG-AND-DROP + PASTE IMAGE UPLOAD — groups.js additions
// =============================================================================

/**
 * Makes any element a drag-and-drop / paste drop zone that produces a base64
 * data URL, then calls onFile(base64, file) when a valid image lands.
 *
 * @param {HTMLElement} zone      – the element to watch for drag/drop/paste
 * @param {Function}   onFile    – callback(base64String, File)
 * @param {number}     maxBytes  – file size limit in bytes (default 700 KB)
 */
function enableImageDropZone(zone, onFile, maxBytes = 700 * 1024) {
  if (!zone) return;

  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      alert("Please drop an image file.");
      return;
    }
    if (file.size > maxBytes) {
      alert(`Image must be under ${Math.round(maxBytes / 1024)} KB.`);
      return;
    }
    const b64 = await fileToBase64(file);
    onFile(b64, file);
  });

  // Paste from clipboard (works when zone or a child is focused)
  zone.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        if (file.size > maxBytes) {
          alert(`Image must be under ${Math.round(maxBytes / 1024)} KB.`);
          return;
        }
        const b64 = await fileToBase64(file);
        onFile(b64, file);
        return;
      }
    }
  });
}

// ── Composer drop zone (post image attachment) ────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const composerBody = document.querySelector(".composer-body");
  enableImageDropZone(
    composerBody,
    (b64, file) => {
      // Reuse the existing attachment pipeline
      const fakeFile = new File([file], file.name, { type: file.type });
      Object.defineProperty(fakeFile, "size", { value: file.size });
      executeAttachmentUpload(file);
    },
    700 * 1024
  );

  // ── Profile picture drop zone ─────────────────────────────────────────────
  // Works on both the groups-page inline modal and shared.js modal
  function wireProfilePicDropZone(previewId) {
    const preview = document.getElementById(previewId);
    enableImageDropZone(
      preview,
      async (b64) => {
        currentUserProfile.photoUrl = b64;
        if (preview) {
          preview.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        }
      },
      300 * 1024
    );
    if (preview) {
      preview.title = "Drag an image here or paste from clipboard";
      preview.style.cursor = "pointer";
    }
  }
  wireProfilePicDropZone("profilePicPreview");

  // ── Group icon drop zone ──────────────────────────────────────────────────
  const groupIconDropZone = document.getElementById("groupIconDropZone");
  const groupIconPreview = document.getElementById("groupIconPreview");
  const groupIconInput = document.getElementById("groupIconInput");

  if (groupIconDropZone) {
    enableImageDropZone(
      groupIconDropZone,
      (b64) => {
        window._stagingGroupIconBase64 = b64;
        if (groupIconPreview) {
          groupIconPreview.src = b64;
          groupIconPreview.style.display = "block";
        }
        groupIconDropZone.classList.add("has-image");
      },
      300 * 1024
    );
  }

  if (groupIconInput) {
    groupIconInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 300 * 1024) {
        alert("Group icon must be under 300 KB.");
        return;
      }
      const b64 = await fileToBase64(file);
      window._stagingGroupIconBase64 = b64;
      if (groupIconPreview) {
        groupIconPreview.src = b64;
        groupIconPreview.style.display = "block";
      }
      if (groupIconDropZone) groupIconDropZone.classList.add("has-image");
    });
  }
  if (groupIconDropZone) {
    groupIconDropZone.addEventListener("click", () => groupIconInput?.click());
  }
});

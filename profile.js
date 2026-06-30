// =============================================================================
//  profile.js — ShareNet Individual Profile Page
//
//  URL format: profile.html?uid=<firestore-user-uid>
//
//  Features:
//    - Displays avatar, display name, @username, role badge, badges row
//    - Follower / following counts (clickable → popup list)
//    - Follow / Unfollow toggle for other users
//    - "Edit Profile" button for own profile (opens shared settings modal)
//    - Join date
//    - About section (editable inline by profile owner)
//    - "Groups I Own" (auto-populated from Firestore groups collection)
//    - Full badge grid
// =============================================================================

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
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
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Firebase (reuse existing app instance) ────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDFKAnb3hipbmCFOujKIpdh3jbp18RFGlE",
  authDomain: "sharenet-reimagined.firebaseapp.com",
  projectId: "sharenet-reimagined",
  storageBucket: "sharenet-reimagined.firebasestorage.app",
  messagingSenderId: "28034797053",
  appId: "1:28034797053:web:1c448f7fa2ad3ae5cbdd94",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Constants ─────────────────────────────────────────────────────────────────
const SITE_ADMIN_EMAIL = "ogheneovieumebese@gmail.com";

// ── DOM refs ──────────────────────────────────────────────────────────────────
const authModal       = document.getElementById("authModal");
const authNavBtn      = document.getElementById("authNavBtn");
const closeModal      = document.getElementById("closeModal");
const authForm        = document.getElementById("authForm");
const authSubmitBtn   = document.getElementById("authSubmitBtn");
const modalTitle      = document.getElementById("modalTitle");
const toggleAuthMode  = document.getElementById("toggleAuthMode");
const toggleMsg       = document.getElementById("toggleMsg");
const navProfileAvatar = document.getElementById("navProfileAvatar");
const notificationBellBtn = document.getElementById("notificationBellBtn");
const notificationBadge   = document.getElementById("notificationBadge");

const profileLoadingState = document.getElementById("profileLoadingState");
const profileNotFound     = document.getElementById("profileNotFound");
const profileContent      = document.getElementById("profileContent");

const profileAvatar      = document.getElementById("profileAvatar");
const profileDisplayName = document.getElementById("profileDisplayName");
const profileUsername    = document.getElementById("profileUsername");
const profileRoleBadge   = document.getElementById("profileRoleBadge");
const profileBadgeRow    = document.getElementById("profileBadgeRow");
const followersBtn       = document.getElementById("followersBtn");
const followingBtn       = document.getElementById("followingBtn");
const followersCount     = document.getElementById("followersCount");
const followingCount     = document.getElementById("followingCount");
const followBtn          = document.getElementById("followBtn");
const editProfileBtn     = document.getElementById("editProfileBtn");
const profileJoinDate    = document.getElementById("profileJoinDate");
const editAboutBtn       = document.getElementById("editAboutBtn");
const profileAboutContent  = document.getElementById("profileAboutContent");
const profileAboutEditor   = document.getElementById("profileAboutEditor");
const profileAboutTextarea = document.getElementById("profileAboutTextarea");
const saveAboutBtn         = document.getElementById("saveAboutBtn");
const cancelAboutBtn       = document.getElementById("cancelAboutBtn");
const profileGroupsOwned   = document.getElementById("profileGroupsOwned");
const profileBadgesFull    = document.getElementById("profileBadgesFull");

const followListModal   = document.getElementById("followListModal");
const followListTitle   = document.getElementById("followListTitle");
const followListContent = document.getElementById("followListContent");
const closeFollowListModal = document.getElementById("closeFollowListModal");

const badgeOverflowModal = document.getElementById("badgeOverflowModal");
const badgeOverflowList  = document.getElementById("badgeOverflowList");
const closeBadgeOverflowModal = document.getElementById("closeBadgeOverflowModal");

// ── State ─────────────────────────────────────────────────────────────────────
let profileUid = null;       // UID of the profile being viewed
let profileData = null;      // Firestore data of the profile user
let currentUser = null;      // Logged-in user (may be null)
let currentBadgesMap = {};   // Live badge catalog
let isLoginMode = true;

// ── Auth modal wiring (standard pattern, same as every other page) ─────────────
if (notificationBellBtn) {
  notificationBellBtn.addEventListener("click", () => {
    window.location.href = "notifications.html";
  });
}

if (authNavBtn) {
  authNavBtn.addEventListener("click", () => {
    if (auth.currentUser) {
      signOut(auth).catch((e) => alert(e.message));
    } else {
      authModal.style.display = "flex";
    }
  });
}
if (closeModal) closeModal.addEventListener("click", () => { authModal.style.display = "none"; });
if (toggleAuthMode) {
  toggleAuthMode.addEventListener("click", (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    modalTitle.innerText     = isLoginMode ? "Log In"   : "Sign Up";
    authSubmitBtn.innerText  = isLoginMode ? "Log In"   : "Sign Up";
    toggleMsg.innerText      = isLoginMode ? "Don't have an account?" : "Already have an account?";
    toggleAuthMode.innerText = isLoginMode ? "Sign Up"  : "Log In";
  });
}
if (authForm) {
  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email    = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const fn = isLoginMode
      ? signInWithEmailAndPassword(auth, email, password)
      : createUserWithEmailAndPassword(auth, email, password);
    fn.then(() => { authModal.style.display = "none"; authForm.reset(); })
      .catch((err) => alert(err.message));
  });
}

// ── Follow list modal close ────────────────────────────────────────────────────
if (closeFollowListModal) {
  closeFollowListModal.addEventListener("click", () => {
    followListModal.style.display = "none";
  });
}

// ── Badge overflow modal close ────────────────────────────────────────────────
if (closeBadgeOverflowModal) {
  closeBadgeOverflowModal.addEventListener("click", () => {
    badgeOverflowModal.style.display = "none";
  });
}

// =============================================================================
//  BADGE RENDERING HELPERS (mirrors the copies in members.js / groups.js)
// =============================================================================
function renderBadgeIconMarkup(badge) {
  if (!badge) return "";
  if (badge.iconType === "image" && badge.icon) {
    return `<img src="${badge.icon}" alt="" />`;
  }
  return `<span class="material-symbols-outlined">${badge.icon || "military_tech"}</span>`;
}

function renderBadgePillMarkup(badge) {
  if (!badge) return "";
  const textColor = badge.textColor || "#ffffff";
  const bgColor   = badge.bgColor   || "#a855f7";
  return `
    <span class="user-badge-pill" style="color:${textColor};background:${bgColor};" title="${badge.title}">
      <span class="user-badge-icon">${renderBadgeIconMarkup(badge)}</span>
      <span>${badge.title}</span>
    </span>`;
}

function openBadgeOverflowPopup(badgeIds) {
  if (!badgeOverflowModal || !badgeOverflowList) return;
  badgeOverflowList.innerHTML = badgeIds
    .map((id) => {
      const b = currentBadgesMap[id];
      return b ? `<div class="badge-overflow-item">${renderBadgePillMarkup(b)}</div>` : "";
    })
    .join("");
  badgeOverflowModal.style.display = "flex";
}

// ── Live badge catalog listener ───────────────────────────────────────────────
onSnapshot(collection(db, "badges"), (snapshot) => {
  const updated = {};
  snapshot.forEach((d) => { updated[d.id] = { id: d.id, ...d.data() }; });
  currentBadgesMap = updated;
  if (profileData) renderProfileBadges(profileData.badgeIds || []);
});

// =============================================================================
//  LOAD PROFILE
// =============================================================================
async function loadProfile(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) {
      showNotFound();
      return;
    }
    profileData = { id: snap.id, ...snap.data() };
    renderProfile(profileData);
    loadGroupsOwned(uid);
  } catch (err) {
    console.error("Error loading profile:", err);
    showNotFound();
  }
}

function showNotFound() {
  if (profileLoadingState) profileLoadingState.style.display = "none";
  if (profileNotFound)     profileNotFound.style.display     = "flex";
}

function showProfile() {
  if (profileLoadingState) profileLoadingState.style.display = "none";
  if (profileContent)      profileContent.style.display      = "block";
}

// =============================================================================
//  RENDER PROFILE
// =============================================================================
function renderProfile(data) {
  const email       = data.email || "";
  const username    = email.split("@")[0];
  const displayName = data.displayName || username;
  const photoUrl    = data.photoUrl || "";
  const role        = data.role === "admin" || email === SITE_ADMIN_EMAIL ? "admin" : "member";

  document.title = `${displayName} | ShareNet`;

  // Avatar
  if (profileAvatar) {
    if (photoUrl) {
      profileAvatar.innerHTML = `<img src="${photoUrl}" alt="${displayName}" />`;
    } else {
      profileAvatar.innerText = displayName.charAt(0).toUpperCase();
    }
  }

  // Name + username
  if (profileDisplayName) profileDisplayName.innerText = displayName;
  if (profileUsername)     profileUsername.innerText    = `@${username}`;

  // Role badge
  if (profileRoleBadge) {
    if (role === "admin") {
      profileRoleBadge.innerHTML = `<span class="profile-role-pill profile-role-admin">Admin</span>`;
    } else {
      profileRoleBadge.innerHTML = `<span class="profile-role-pill profile-role-member">Member</span>`;
    }
  }

  // Follow counts
  const followers = data.followers || [];
  const following = data.following || [];
  if (followersCount) followersCount.innerText = followers.length;
  if (followingCount) followingCount.innerText = following.length;

  // Followers/following clickable popups
  if (followersBtn) {
    followersBtn.onclick = () => openFollowListModal("Followers", followers);
  }
  if (followingBtn) {
    followingBtn.onclick = () => openFollowListModal("Following", following);
  }

  // Join date
  if (profileJoinDate && data.createdAt) {
    const date = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
    profileJoinDate.innerText = `Joined ${date.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    })}`;
  } else if (profileJoinDate) {
    profileJoinDate.innerText = "Join date unknown";
  }

  // About section
  renderAbout(data.about || "");

  // Badges
  renderProfileBadges(data.badgeIds || []);

  // Wire follow button and edit button now that we know who's viewing
  updateActionButtons();

  showProfile();
}

// ── About ─────────────────────────────────────────────────────────────────────
function renderAbout(text) {
  if (!profileAboutContent) return;
  if (text && text.trim()) {
    profileAboutContent.innerHTML = `<p class="profile-about-text">${escapeHtml(text)}</p>`;
  } else {
    profileAboutContent.innerHTML = `<p class="profile-about-empty">Nothing here yet.</p>`;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

if (editAboutBtn) {
  editAboutBtn.addEventListener("click", () => {
    if (profileAboutTextarea) {
      profileAboutTextarea.value = (profileData && profileData.about) || "";
    }
    profileAboutContent.style.display = "none";
    profileAboutEditor.style.display  = "block";
    profileAboutTextarea.focus();
  });
}

if (cancelAboutBtn) {
  cancelAboutBtn.addEventListener("click", () => {
    profileAboutContent.style.display = "block";
    profileAboutEditor.style.display  = "none";
  });
}

if (saveAboutBtn) {
  saveAboutBtn.addEventListener("click", async () => {
    if (!currentUser || currentUser.uid !== profileUid) return;
    const text = profileAboutTextarea.value.trim();
    try {
      await updateDoc(doc(db, "users", profileUid), { about: text });
      if (profileData) profileData.about = text;
      renderAbout(text);
      profileAboutContent.style.display = "block";
      profileAboutEditor.style.display  = "none";
    } catch (err) {
      alert("Couldn't save: " + err.message);
    }
  });
}

// ── Badges ────────────────────────────────────────────────────────────────────
function renderProfileBadges(badgeIds) {
  // Inline row in the header (primary + overflow trigger)
  if (profileBadgeRow) {
    if (badgeIds.length === 0) {
      profileBadgeRow.innerHTML = "";
    } else {
      const primaryId    = badgeIds[badgeIds.length - 1];
      const primaryBadge = currentBadgesMap[primaryId];
      const overflowCount = badgeIds.length - 1;
      const overflowTrigger = overflowCount > 0
        ? `<button type="button" class="badge-overflow-trigger" data-badge-ids="${badgeIds.join(",")}" id="profile-header-overflow">+${overflowCount}</button>`
        : "";
      profileBadgeRow.innerHTML = primaryBadge
        ? `<span class="user-badge-row">${renderBadgePillMarkup(primaryBadge)}${overflowTrigger}</span>`
        : "";

      // Bind overflow trigger
      const overflowBtn = document.getElementById("profile-header-overflow");
      if (overflowBtn) {
        overflowBtn.onclick = (e) => {
          e.stopPropagation();
          openBadgeOverflowPopup(badgeIds);
        };
      }
    }
  }

  // Full badges grid at the bottom of the page
  if (profileBadgesFull) {
    if (badgeIds.length === 0) {
      profileBadgesFull.innerHTML = `<p class="profile-about-empty">No badges yet.</p>`;
    } else {
      profileBadgesFull.innerHTML = badgeIds
        .map((id) => {
          const b = currentBadgesMap[id];
          if (!b) return "";
          return `
            <div class="profile-badge-card">
              ${renderBadgePillMarkup(b)}
            </div>`;
        })
        .join("");
    }
  }
}

// ── Groups Owned ──────────────────────────────────────────────────────────────
async function loadGroupsOwned(uid) {
  if (!profileGroupsOwned) return;
  try {
    const q = query(collection(db, "groups"), where("creatorId", "==", uid));
    const snap = await getDocs(q);
    if (snap.empty) {
      profileGroupsOwned.innerHTML = `<p class="profile-about-empty">No groups owned.</p>`;
      return;
    }
    const names = [];
    snap.forEach((d) => names.push(d.data().name));
    profileGroupsOwned.innerHTML = `<p class="profile-groups-list">${names.map((n) => escapeHtml(n)).join(", ")}</p>`;
  } catch (err) {
    console.error("Error loading groups owned:", err);
    profileGroupsOwned.innerHTML = `<p class="profile-about-empty">Couldn't load groups.</p>`;
  }
}

// ── Follow/Unfollow ───────────────────────────────────────────────────────────
function updateActionButtons() {
  if (!currentUser || !profileUid) return;

  const isOwnProfile = currentUser.uid === profileUid;

  if (editProfileBtn) {
    editProfileBtn.style.display = isOwnProfile ? "inline-flex" : "none";
    editProfileBtn.onclick = () => {
      // Fire the shared profile settings modal (injected by shared.js)
      const modal = document.getElementById("sharedProfileModal");
      if (modal) {
        modal.style.display = "flex";
      }
    };
  }

  if (editAboutBtn) {
    editAboutBtn.style.display = isOwnProfile ? "inline-flex" : "none";
  }

  if (followBtn) {
    if (isOwnProfile) {
      followBtn.style.display = "none";
    } else {
      followBtn.style.display = "inline-block";
      const followers = profileData?.followers || [];
      const isFollowing = followers.includes(currentUser.uid);
      setFollowBtnState(isFollowing);

      followBtn.onclick = () => toggleFollow();
    }
  }
}

function setFollowBtnState(isFollowing) {
  if (!followBtn) return;
  if (isFollowing) {
    followBtn.innerText = "Following";
    followBtn.classList.add("profile-follow-btn--following");
  } else {
    followBtn.innerText = "Follow";
    followBtn.classList.remove("profile-follow-btn--following");
  }
}

async function toggleFollow() {
  if (!currentUser || !profileUid || !profileData) return;
  const myUid = currentUser.uid;
  const followers = profileData.followers || [];
  const isFollowing = followers.includes(myUid);

  try {
    if (isFollowing) {
      // Unfollow: remove myUid from target's followers, remove profileUid from my following
      await updateDoc(doc(db, "users", profileUid), { followers: arrayRemove(myUid) });
      await updateDoc(doc(db, "users", myUid), { following: arrayRemove(profileUid) });
      profileData.followers = followers.filter((id) => id !== myUid);
    } else {
      // Follow: add myUid to target's followers, add profileUid to my following
      await updateDoc(doc(db, "users", profileUid), { followers: arrayUnion(myUid) });
      await updateDoc(doc(db, "users", myUid), { following: arrayUnion(profileUid) });
      profileData.followers = [...followers, myUid];
    }
    if (followersCount) followersCount.innerText = (profileData.followers || []).length;
    setFollowBtnState(!isFollowing);
  } catch (err) {
    alert("Couldn't update follow: " + err.message);
  }
}

// ── Followers / Following popup ───────────────────────────────────────────────
async function openFollowListModal(title, uids) {
  if (!followListModal || !followListContent) return;
  followListTitle.innerText = `${title} (${uids.length})`;
  followListContent.innerHTML = `<p class="loading-text">Loading...</p>`;
  followListModal.style.display = "flex";

  if (uids.length === 0) {
    followListContent.innerHTML = `<p class="profile-about-empty">Nobody here yet.</p>`;
    return;
  }

  try {
    // Fetch each user doc in parallel (Firestore doesn't support IN queries on UIDs > 10 well)
    const fetches = uids.map((uid) => getDoc(doc(db, "users", uid)));
    const docs = await Promise.all(fetches);
    followListContent.innerHTML = docs
      .map((d) => {
        if (!d.exists()) return "";
        const data      = d.data();
        const email     = data.email || "";
        const username  = email.split("@")[0];
        const name      = data.displayName || username;
        const photoUrl  = data.photoUrl || "";
        const avatarInner = photoUrl
          ? `<img src="${photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
          : name.charAt(0).toUpperCase();
        return `
          <a href="profile.html?uid=${d.id}" class="follow-list-item">
            <div class="follow-list-avatar">${avatarInner}</div>
            <div>
              <div class="follow-list-name">${escapeHtml(name)}</div>
              <div class="follow-list-username">@${escapeHtml(username)}</div>
            </div>
          </a>`;
      })
      .join("");
  } catch (err) {
    followListContent.innerHTML = `<p class="profile-about-empty">Error loading users.</p>`;
  }
}

// =============================================================================
//  NOTIFICATION BADGE SYNC (same mini-pattern as other pages)
// =============================================================================
function syncNavNotificationBadge() {
  const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    let unread = 0;
    snapshot.forEach((d) => {
      const entry = d.data();
      if (auth.currentUser && entry.createdBy === auth.currentUser.uid) return;
      const viewed = entry.viewedBy || [];
      if (auth.currentUser && !viewed.includes(auth.currentUser.uid)) unread++;
    });
    if (notificationBadge) {
      notificationBadge.style.display = unread > 0 ? "block" : "none";
      notificationBadge.innerText = unread;
    }
  });
}

// =============================================================================
//  BOOT — auth state, then load profile
// =============================================================================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    if (authNavBtn)    authNavBtn.innerText = "Sign Out";
    if (authModal)     authModal.style.display = "none";
    const username = user.email.split("@")[0];
    if (navProfileAvatar) {
      // Load photo from Firestore
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists() && snap.data().photoUrl) {
          navProfileAvatar.innerHTML = `<img src="${snap.data().photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
        } else {
          navProfileAvatar.innerText = username.charAt(0).toUpperCase();
        }
      } catch {
        navProfileAvatar.innerText = username.charAt(0).toUpperCase();
      }
    }
    syncNavNotificationBadge();
  } else {
    if (authNavBtn)       authNavBtn.innerText = "Log In";
    if (navProfileAvatar) { navProfileAvatar.innerText = "?"; }
  }

  // Once we know the current user, update the action buttons if profile is already loaded
  if (profileData) updateActionButtons();
});

// ── Parse UID from query string and kick off load ─────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  profileUid = params.get("uid");

  if (!profileUid) {
    showNotFound();
    return;
  }

  loadProfile(profileUid);
});

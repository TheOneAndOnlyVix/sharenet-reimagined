// ============================================================
//  messenger.js — ShareNet Direct Messaging System
//  Firebase Firestore real-time chat channels
// ============================================================
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
  getDocs,
  serverTimestamp,
  limit,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { computePermissions, waitForRoles, onRolesUpdated } from "./permissions.js";
import { renderEmojiGrid } from "./emoji-library.js";

// ── Firebase Config ────────────────────────────────────────────
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

// =============================================================================
//  Inlined Content Moderation (no external module import needed)
// =============================================================================
const BLOCKED_PATTERNS = [
  /\bn[i1!|]+g+[e3]r/i,
  /\bn[i1!|]+gg[a@]/i,
  /\bk[i1]+k[e3]/i,
  /\bsp[i1]+c/i,
  /\bch[i1]+nk/i,
  /\bgook/i,
  /\bwetback/i,
  /\bcr[a@]cker/i,
  /\btr[a@]nny/i,
  /\bf[a@4]gg[o0]t/i,
  /\bd[y1]k[e3]/i,
  /\bretard/i,
  /\bcr[i1]pple/i,
  /\bsp[a@]z/i,
  /\bf+[u\*]+c+k/i,
  /\bsh[i1!]+t/i,
  /\ba+[s\$]+h[o0]l[e3]/i,
  /\bb[i1!]+tch/i,
  /\bc[u\*]nt/i,
  /\bd[i1!]+ck/i,
  /\bc[o0]ck/i,
  /\bp[u\*]+ss[y1]/i,
  /\bwh[o0]r[e3]/i,
  /\bsl[u\*]t/i,
  /\bb[a@]st[a@]rd/i,
  /\bd[a@]mn/i,
  /\bh[e3]ll\b/i,
  /\bcr[a@]p/i,
  /\bkill\s+(your?self|him|her|them|you|me)\b/i,
  /\bi('ll|will)\s+(kill|murder|stab|shoot|hurt)\b/i,
  /\bkys\b/i,
  /\bgys\b/i,
];

function _localCheck(text) {
  const n = text
    .replace(/[@]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[\$]/g, "s")
    .replace(/[+]/g, "t");
  for (const p of BLOCKED_PATTERNS) {
    if (p.test(n) || p.test(text)) {
      return {
        blocked: true,
        reason:
          "Your message contains language that isn't allowed on ShareNet. Please keep it respectful.",
      };
    }
  }
  return { blocked: false };
}

const _AI_MOD_PROMPT = `You are a strict content moderation assistant for a school community platform called ShareNet.
Analyse the user message and decide whether it violates any of these rules:
- Hate speech or slurs targeting any group
- Threats of violence or self-harm
- Severe harassment or bullying directed at an individual
- Explicit sexual content
- Encouragement of illegal activity
Reply with EXACTLY ONE of:
  ALLOWED
  BLOCKED: <one-sentence plain-English reason>
Do not add any other text. If in doubt, lean toward ALLOWED for normal teenage conversation.`;

async function _aiCheck(text) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        system: _AI_MOD_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!res.ok) return { blocked: false };
    const data = await res.json();
    const reply = (data?.content?.[0]?.text || "").trim();
    if (reply.startsWith("BLOCKED:")) {
      return {
        blocked: true,
        reason:
          reply.replace(/^BLOCKED:\s*/i, "").trim() ||
          "This message was flagged as harmful content.",
      };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

async function checkContent(text, { aiEnabled = true } = {}) {
  if (!text || !text.trim()) return { allowed: true };
  const local = _localCheck(text);
  if (local.blocked) return { allowed: false, reason: local.reason };
  if (aiEnabled && text.trim().split(/\s+/).length >= 6) {
    const ai = await _aiCheck(text);
    if (ai.blocked) return { allowed: false, reason: ai.reason };
  }
  return { allowed: true };
}
// =============================================================================

// ── State ───────────────────────────────────────────────────────
let currentUser = null;
let currentUserProfile = { displayName: "", photoUrl: "" };
let currentUserData = null;
let myPermissions = computePermissions(null, null);
let activeChannelId = null;
let activeMessageUnsubscribe = null;
let conversationUnsubscribe = null;
let allUsers = []; // cache of all registered users
let userDataMap = {}; // uid -> user data map
const selectedNewChatUids = new Set(); // multi-select state for New Chat modal
let pendingGroupIconBase64 = null;

// ── DOM Bindings ────────────────────────────────────────────────
const messengerAuthWall = document.getElementById("messengerAuthWall");
const messengerApp = document.getElementById("messengerApp");
const openAuthFromMsg = document.getElementById("openAuthFromMessenger");

const conversationsList = document.getElementById("conversationsList");
const conversationSearch = document.getElementById("conversationSearchInput");
const newChatBtn = document.getElementById("newChatBtn");
const newChatModal = document.getElementById("newChatModal");
const closeNewChatModal = document.getElementById("closeNewChatModal");
const userPickerSearch = document.getElementById("userPickerSearch");
const userPickerList = document.getElementById("userPickerList");
const groupSetupPanel = document.getElementById("groupSetupPanel");
const groupChatNameInput = document.getElementById("groupChatNameInput");
const groupChatIconPreview = document.getElementById("groupChatIconPreview");
const groupChatIconFileInput = document.getElementById("groupChatIconFileInput");
const startChatBtn = document.getElementById("startChatBtn");

const emptyChatState = document.getElementById("emptyChatState");
const activeChatView = document.getElementById("activeChatView");
const chatHeader = document.getElementById("chatHeader");
const chatRecipientAvatar = document.getElementById("chatRecipientAvatar");
const chatRecipientName = document.getElementById("chatRecipientName");
const messagesContainer = document.getElementById("messagesContainer");
const messageInput = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const messageComposeBar = document.getElementById("messageComposeBar");
const msgImageBtn = document.getElementById("msgImageBtn");
const msgImageFileInput = document.getElementById("msgImageFileInput");
const msgEmojiBtn = document.getElementById("msgEmojiBtn");
const msgEmojiPickerPanel = document.getElementById("msgEmojiPickerPanel");
const closeMsgEmojiPanelBtn = document.getElementById("closeMsgEmojiPanelBtn");
const msgEmojiSearchField = document.getElementById("msgEmojiSearchField");
const msgEmojiGrid = document.getElementById("msgEmojiGrid");

const authModal = document.getElementById("authModal");
const closeModal = document.getElementById("closeModal");
const authForm = document.getElementById("authForm");
const modalTitle = document.getElementById("modalTitle");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const toggleAuthMode = document.getElementById("toggleAuthMode");
const toggleMsg = document.getElementById("toggleMsg");
const authNavBtn = document.getElementById("authNavBtn");
const navProfileAvatar = document.getElementById("navProfileAvatar");
const notificationBadge = document.getElementById("notificationBadge");
const notificationBellBtn = document.getElementById("notificationBellBtn");
const navNotificationsLink = document.getElementById("navNotificationsLink");

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Build a stable channel ID from two user UIDs (always sorted so
 * both directions produce the same string).
 */
function buildChannelId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString();
}

function avatarHtml(profile, size = 38) {
  if (profile.photoUrl) {
    return `<img src="${profile.photoUrl}"
      style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  }
  return (profile.displayName || "?").charAt(0).toUpperCase();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Auth ────────────────────────────────────────────────────────
let isLoginMode = true;

if (authNavBtn) {
  authNavBtn.addEventListener("click", () => {
    if (auth.currentUser) {
      signOut(auth).catch((e) => alert(e.message));
    } else {
      authModal.style.display = "flex";
    }
  });
}
if (closeModal)
  closeModal.addEventListener(
    "click",
    () => (authModal.style.display = "none")
  );

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
        .catch((err) => alert("Login Error: " + err.message));
    } else {
      createUserWithEmailAndPassword(auth, email, password)
        .then(async (cred) => {
          const user = cred.user;
          const name = email.split("@")[0];
          await setDoc(doc(db, "users", user.uid), {
            email: user.email,
            displayName: name,
            photoUrl: "",
            createdAt: new Date(),
          });
          authModal.style.display = "none";
          authForm.reset();
          alert("Account created!");
        })
        .catch((err) => alert("Signup Error: " + err.message));
    }
  });
}

if (openAuthFromMsg) {
  openAuthFromMsg.addEventListener("click", () => {
    messengerAuthWall.style.display = "none";
    authModal.style.display = "flex";
  });
}

if (notificationBellBtn) {
  notificationBellBtn.addEventListener(
    "click",
    () => (window.location.href = "notifications.html")
  );
}
if (navNotificationsLink) {
  navNotificationsLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "notifications.html";
  });
}

// ── Auth State Observer ─────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (user) {
    authNavBtn.innerText = "Sign Out";
    authModal.style.display = "none";

    // Load profile
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        currentUserData = d;
        currentUserProfile.displayName =
          d.displayName || user.email.split("@")[0];
        currentUserProfile.photoUrl = d.photoUrl || "";
      } else {
        currentUserData = null;
        currentUserProfile.displayName = user.email.split("@")[0];
        currentUserProfile.photoUrl = "";
      }
    } catch {
      currentUserData = null;
      currentUserProfile.displayName = user.email.split("@")[0];
      currentUserProfile.photoUrl = "";
    }

    updateNavAvatar();
    await waitForRoles();
    myPermissions = computePermissions(user, currentUserData);

    if (myPermissions.permissions.canUseMessenger) {
      showMessengerApp();
      loadAllUsers();
      listenForConversations();
      syncNotificationBadge();
    } else {
      showRestrictedWall();
      if (conversationUnsubscribe) {
        conversationUnsubscribe();
        conversationUnsubscribe = null;
      }
    }
  } else {
    authNavBtn.innerText = "Log In";
    if (navProfileAvatar) {
      navProfileAvatar.innerHTML = "?";
      navProfileAvatar.style.display = "none";
    }
    currentUserData = null;
    myPermissions = computePermissions(null, null);
    showAuthWall();
    if (conversationUnsubscribe) {
      conversationUnsubscribe();
      conversationUnsubscribe = null;
    }
  }
});

onRolesUpdated(() => {
  if (!currentUser) return;
  myPermissions = computePermissions(currentUser, currentUserData);
  if (myPermissions.permissions.canUseMessenger) {
    showMessengerApp();
    loadAllUsers();
    listenForConversations();
    syncNotificationBadge();
  } else {
    showRestrictedWall();
    if (conversationUnsubscribe) {
      conversationUnsubscribe();
      conversationUnsubscribe = null;
    }
  }
});

function updateNavAvatar() {
  if (!navProfileAvatar) return;
  navProfileAvatar.style.display = "flex";
  navProfileAvatar.innerHTML = avatarHtml(currentUserProfile, 38);
}

function showAuthWall() {
  const title = document.getElementById("messengerAuthWallTitle");
  const msg = document.getElementById("messengerAuthWallMsg");
  const btn = document.getElementById("openAuthFromMessenger");
  if (title) title.innerText = "Sign in to use Messenger";
  if (msg) msg.innerText = "Direct messaging is only available to logged-in members.";
  if (btn) btn.style.display = "inline-block";
  if (messengerAuthWall) messengerAuthWall.style.display = "flex";
  if (messengerApp) messengerApp.style.display = "none";
}

function showRestrictedWall() {
  const title = document.getElementById("messengerAuthWallTitle");
  const msg = document.getElementById("messengerAuthWallMsg");
  const btn = document.getElementById("openAuthFromMessenger");
  if (title) title.innerText = "Messenger Restricted";
  if (msg) msg.innerText = "Your account role does not currently allow you to use Messenger.";
  if (btn) btn.style.display = "none";
  if (messengerAuthWall) messengerAuthWall.style.display = "flex";
  if (messengerApp) messengerApp.style.display = "none";
}

function showMessengerApp() {
  if (messengerAuthWall) messengerAuthWall.style.display = "none";
  if (messengerApp) messengerApp.style.display = "flex";
}

// ── Load All Users for New-Chat Picker ──────────────────────────
async function loadAllUsers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    allUsers = [];
    userDataMap = {};
    snap.forEach((d) => {
      const data = { uid: d.id, ...d.data() };
      userDataMap[d.id] = data;
      if (d.id !== currentUser.uid) {
        allUsers.push(data);
      }
    });
  } catch (err) {
    console.error("Could not load users:", err);
  }
}
// ── Conversations Sidebar ───────────────────────────────────────
function listenForConversations() {
  if (conversationUnsubscribe) conversationUnsubscribe();

  // Query without orderBy so new channels (with pending server timestamps)
  // appear immediately. We sort client-side after fetching.
  const q = query(
    collection(db, "dmChannels"),
    where("participants", "array-contains", currentUser.uid)
  );

  conversationUnsubscribe = onSnapshot(q, (snap) => {
    // Sort descending by lastMessageAt client-side
    const sorted = [...snap.docs].sort((a, b) => {
      const aTs = a.data().lastMessageAt?.seconds || 0;
      const bTs = b.data().lastMessageAt?.seconds || 0;
      return bTs - aTs;
    });
    renderConversationList(sorted);
  });
}

async function renderConversationList(docs, filter = "") {
  if (!conversationsList) return;

  // Build the list in memory first to prevent layout flashing
  const fragment = document.createDocumentFragment();

  if (docs.length === 0) {
    conversationsList.innerHTML = `
        <div class="conversations-empty">
          <p>No messages yet.</p>
          <p style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
            Click + to start a conversation.
          </p>
        </div>`;
    return;
  }

  for (const docSnap of docs) {
    const data = docSnap.data();
    const channelId = docSnap.id;
    const isGroup = !!data.isGroup;

    let displayName = "Unknown User";
    let displayPhoto = "";
    let otherUid = null; // only meaningful for DMs

    if (isGroup) {
      const memberCount = (data.participants || []).length;
      displayName = data.groupName || "Group Chat";
      displayPhoto = data.groupIconUrl || "";
      if (filter && !displayName.toLowerCase().includes(filter.toLowerCase()))
        continue;

      const lastMsg = data.lastMessage || "";
      const lastTime = data.lastMessageAt ? formatTimestamp(data.lastMessageAt) : "";
      const unread = data.unreadCount?.[currentUser.uid] || 0;
      const avatarContent = displayPhoto
        ? `<img src="${displayPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
        : `<span class="material-symbols-outlined" style="font-size:18px;">groups</span>`;

      const item = document.createElement("div");
      item.className = `conversation-item${activeChannelId === channelId ? " active" : ""}`;
      item.dataset.channelId = channelId;
      item.dataset.otherName = displayName;
      item.innerHTML = `
        <div class="conv-avatar">${avatarContent}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${displayName} <span style="color:var(--text-muted);font-weight:400;font-size:11px;">(${memberCount})</span></span>
            <span class="conv-time">${lastTime}</span>
          </div>
          <div class="conv-preview">${
            lastMsg
              ? escapeHtml(lastMsg.substring(0, 55)) + (lastMsg.length > 55 ? "…" : "")
              : "Say hi!"
          }</div>
        </div>
        ${unread > 0 ? `<span class="conv-unread-badge">${unread}</span>` : ""}
        <button class="conv-delete-btn" data-channel-id="${channelId}" title="Leave group">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      `;

      item.querySelector(".conv-delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Leave "${displayName}"? You can be re-added by another member later.`))
          return;
        await leaveOrDeleteChannel(channelId, data);
      });

      item.addEventListener("click", (e) => {
        if (e.target.closest(".conv-delete-btn")) return;
        openChat(channelId, { isGroup: true, name: displayName, photo: displayPhoto });
      });

      fragment.appendChild(item);
      continue;
    }

    // ── Direct message (existing behavior) ──
    otherUid = data.participants.find((id) => id !== currentUser.uid);
    if (!otherUid) continue;

    // Pull from the cached array first (Instant render!)
    const cachedUser = allUsers.find((u) => u.uid === otherUid);
    if (cachedUser) {
      displayName = cachedUser.displayName || cachedUser.email?.split("@")[0] || "User";
      displayPhoto = cachedUser.photoUrl || "";
    } else {
      // Fallback network fetch if user is somehow missing from cache
      try {
        const userSnap = await getDoc(doc(db, "users", otherUid));
        if (userSnap.exists()) {
          const ud = userSnap.data();
          displayName = ud.displayName || ud.email?.split("@")[0] || "User";
          displayPhoto = ud.photoUrl || "";
          allUsers.push({ uid: otherUid, ...ud });
        }
      } catch {}
    }

    if (filter && !displayName.toLowerCase().includes(filter.toLowerCase()))
      continue;

    const lastMsg = data.lastMessage || "";
    const lastTime = data.lastMessageAt
      ? formatTimestamp(data.lastMessageAt)
      : "";
    const unread = data.unreadCount?.[currentUser.uid] || 0;

    const avatarContent = displayPhoto
      ? `<img src="${displayPhoto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
      : displayName.charAt(0).toUpperCase();

    const item = document.createElement("div");
    item.className = `conversation-item${
      activeChannelId === channelId ? " active" : ""
    }`;
    item.dataset.channelId = channelId;
    item.dataset.otherUid = otherUid;
    item.dataset.otherName = displayName;
    item.dataset.otherPhoto = displayPhoto;
    item.innerHTML = `
        <div class="conv-avatar">${avatarContent}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${displayName}</span>
            <span class="conv-time">${lastTime}</span>
          </div>
          <div class="conv-preview">${
            lastMsg
              ? escapeHtml(lastMsg.substring(0, 55)) +
                (lastMsg.length > 55 ? "…" : "")
              : "Say hi!"
          }</div>
        </div>
        ${unread > 0 ? `<span class="conv-unread-badge">${unread}</span>` : ""}
        <button class="conv-delete-btn" data-channel-id="${channelId}" title="Delete conversation">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      `;

    item
      .querySelector(".conv-delete-btn")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        if (
          !confirm(
            "Delete this conversation? This only removes it from your view — the other person's copy is unaffected."
          )
        )
          return;
        await leaveOrDeleteChannel(channelId, data);
      });

    item.addEventListener("click", (e) => {
      if (e.target.closest(".conv-delete-btn")) return;
      openChat(channelId, { isGroup: false, name: displayName, photo: displayPhoto, otherUid });
    });

    fragment.appendChild(item);
  }

  // Wipe the old list only once the new elements are completely ready
  conversationsList.innerHTML = "";
  conversationsList.appendChild(fragment);
}

// Shared leave/delete logic for both DMs and group chats — removes the
// current user from participants, deleting the channel doc entirely once
// nobody is left in it.
async function leaveOrDeleteChannel(channelId, data) {
  try {
    const channelRef = doc(db, "dmChannels", channelId);
    const remaining = (data.participants || []).filter((id) => id !== currentUser.uid);
    if (remaining.length === 0) {
      await deleteDoc(channelRef);
    } else {
      await updateDoc(channelRef, { participants: remaining });
    }
    if (activeChannelId === channelId) {
      activeChannelId = null;
      if (activeChatView) activeChatView.style.display = "none";
      if (emptyChatState) emptyChatState.style.display = "flex";
    }
  } catch (err) {
    console.error("Leave/delete conversation error:", err);
    alert("Could not update this conversation.");
  }
}

// ── Conversation Search ─────────────────────────────────────────
if (conversationSearch) {
  conversationSearch.addEventListener("input", (e) => {
    const filter = e.target.value.trim();
    // Re-fetch from Firestore state isn't cheap; scan the rendered items instead
    document.querySelectorAll(".conversation-item").forEach((item) => {
      const name = item.dataset.otherName || "";
      item.style.display = name.toLowerCase().includes(filter.toLowerCase())
        ? "flex"
        : "none";
    });
  });
}

// ── Open / Activate a Chat ──────────────────────────────────────
// meta: { isGroup, name, photo, otherUid? }
function openChat(channelId, meta) {
  activeChannelId = channelId;

  // Update sidebar active state
  document.querySelectorAll(".conversation-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.channelId === channelId);
  });

  // Update header
  const avatarInner = meta.photo
    ? `<img src="${meta.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
    : meta.isGroup
    ? `<span class="material-symbols-outlined" style="font-size:20px;">groups</span>`
    : meta.name.charAt(0).toUpperCase();
  if (chatRecipientAvatar) chatRecipientAvatar.innerHTML = avatarInner;
  if (chatRecipientName) chatRecipientName.innerText = meta.name;
  const subtitleEl = chatRecipientName?.nextElementSibling;
  if (subtitleEl) subtitleEl.innerText = meta.isGroup ? "Group chat" : "ShareNet member";

  // Show the chat view
  if (emptyChatState) emptyChatState.style.display = "none";
  if (activeChatView) {
    activeChatView.style.display = "flex";
  }

  // Focus input
  if (messageInput) messageInput.focus();

  // Mark messages as read
  markChannelRead(channelId);

  // Subscribe to messages
  if (activeMessageUnsubscribe) activeMessageUnsubscribe();
  listenForMessages(channelId);
}

// ── Real-time Message Stream ────────────────────────────────────
function listenForMessages(channelId) {
  if (!messagesContainer) return;
  messagesContainer.innerHTML = `<div class="messages-loading">Loading messages…</div>`;

  const q = query(
    collection(db, "dmChannels", channelId, "messages"),
    orderBy("sentAt", "asc"),
    limit(200)
  );

  activeMessageUnsubscribe = onSnapshot(q, (snap) => {
    messagesContainer.innerHTML = "";
    let lastDate = "";

    snap.forEach((docSnap) => {
      const msg = docSnap.data();
      const isMine = msg.senderId === currentUser.uid;

      // Date separator
      const msgDate = msg.sentAt
        ? new Date(msg.sentAt.seconds * 1000).toLocaleDateString()
        : "";
      if (msgDate && msgDate !== lastDate) {
        lastDate = msgDate;
        const sep = document.createElement("div");
        sep.className = "msg-date-separator";
        sep.innerText = msgDate;
        messagesContainer.appendChild(sep);
      }

      // Sender info
      const sender = userDataMap[msg.senderId];
      let senderName = 'Unknown';
      let avatarHTML = '';
      if (sender) {
        senderName = sender.displayName || (sender.email ? sender.email.split('@')[0] : '');
        if (sender.photoUrl) {
          avatarHTML = `<img src="${sender.photoUrl}" alt="${senderName}" class="msg-sender-avatar" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
        } else {
          const initial = senderName ? senderName.charAt(0).toUpperCase() : '?';
          avatarHTML = `<span class="msg-sender-avatar" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;background:#e0e0e0;border-radius:50%;font-size:12px;">${initial}</span>`;
        }
      }
      const senderDiv = document.createElement('div');
      senderDiv.className = 'msg-sender';
      senderDiv.style.display = 'flex';
      senderDiv.style.alignItems = 'center';
      senderDiv.style.marginBottom = '4px';
      senderDiv.innerHTML = `${avatarHTML}<span class="msg-sender-name" style="margin-left:8px;font-size:14px;">${senderName}</span>`;
      messagesContainer.appendChild(senderDiv);

      const timeStr = msg.sentAt
        ? new Date(msg.sentAt.seconds * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";

      const bubble = document.createElement("div");
      bubble.className = `msg-row ${
        isMine ? "msg-row-mine" : "msg-row-theirs"
      }`;
      const imageHTML = msg.imageUrl
        ? `<img src="${msg.imageUrl}" class="msg-image" alt="Sent image" />`
        : "";
      const textHTML = msg.text
        ? `<div class="msg-text">${escapeHtml(msg.text)}</div>`
        : "";
      bubble.innerHTML = `
        <div class="msg-bubble ${
          isMine ? "msg-bubble-mine" : "msg-bubble-theirs"
        }">
          ${imageHTML}
          ${textHTML}
          <div class="msg-time">${timeStr}</div>
        </div>
      `;
      messagesContainer.appendChild(bubble);
    });

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}
// ── Send Message ────────────────────────────────────────────────
// `imageUrl`, when provided, sends an image message (optionally with
// caption text typed alongside it).
async function sendMessage(imageUrl = null) {
  if (!currentUser || !activeChannelId) return;
  const text = messageInput?.value.trim() || "";
  if (!text && !imageUrl) return;

  if (!myPermissions.permissions.canUseMessenger) {
    alert("Your account role does not allow you to use Messenger.");
    return;
  }

  // ── Content moderation (text only — images aren't scanned) ─────────────
  if (text) {
    const filterResult = await checkContent(text);
    if (!filterResult.allowed) {
      alert(`Message blocked: ${filterResult.reason}`);
      return;
    }
  }
  // ──────────────────────────────────────────────────────────────────────

  messageInput.value = "";

  const channelRef = doc(db, "dmChannels", activeChannelId);
  const msgRef = collection(db, "dmChannels", activeChannelId, "messages");

  try {
    const payload = {
      senderId: currentUser.uid,
      senderName: currentUserProfile.displayName,
      senderPhoto: currentUserProfile.photoUrl || "",
      sentAt: serverTimestamp(),
    };
    if (text) payload.text = text;
    if (imageUrl) payload.imageUrl = imageUrl;

    await addDoc(msgRef, payload);

    // Get channel doc so we can bump unread counts for every OTHER
    // participant — works the same for a 2-person DM or a group chat.
    const channelSnap = await getDoc(channelRef);
    const channelData = channelSnap.data();
    const otherParticipants = (channelData.participants || []).filter(
      (id) => id !== currentUser.uid
    );

    const unreadUpdates = {};
    otherParticipants.forEach((uid) => {
      const currentUnread = channelData.unreadCount?.[uid] || 0;
      unreadUpdates[`unreadCount.${uid}`] = currentUnread + 1;
    });

    await updateDoc(channelRef, {
      lastMessage: imageUrl ? (text ? text : "📷 Image") : text,
      lastMessageAt: serverTimestamp(),
      ...unreadUpdates,
    });
  } catch (err) {
    console.error("Message send failed:", err);
    alert("Failed to send message. Please try again.");
    if (text) messageInput.value = text; // restore
  }
}

if (sendMessageBtn) sendMessageBtn.addEventListener("click", () => sendMessage());
if (messageInput) {
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ── Emoji picker ──────────────────────────────────────────────
function renderMsgEmojiGrid(term) {
  renderEmojiGrid(msgEmojiGrid, term, (char) => {
    if (messageInput) {
      messageInput.value += char;
      messageInput.focus();
    }
  });
}

if (msgEmojiBtn) {
  msgEmojiBtn.addEventListener("click", () => {
    if (!msgEmojiPickerPanel) return;
    const showing = msgEmojiPickerPanel.style.display === "block";
    if (showing) {
      msgEmojiPickerPanel.style.display = "none";
    } else {
      if (msgEmojiSearchField) msgEmojiSearchField.value = "";
      renderMsgEmojiGrid("");
      msgEmojiPickerPanel.style.display = "block";
    }
  });
}
if (closeMsgEmojiPanelBtn) {
  closeMsgEmojiPanelBtn.addEventListener("click", () => {
    msgEmojiPickerPanel.style.display = "none";
  });
}
if (msgEmojiSearchField) {
  msgEmojiSearchField.addEventListener("input", (e) => {
    renderMsgEmojiGrid(e.target.value);
  });
}

// ── Image sending (button + drag & drop onto the compose bar) ───
async function sendImageFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  const MAX_BYTES = 2 * 1024 * 1024; // 2MB cap on chat images
  if (file.size > MAX_BYTES) {
    alert(`Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please use an image under 2 MB.`);
    return;
  }
  if (!activeChannelId) {
    alert("Select a conversation first.");
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    await sendMessage(base64);
  } catch (err) {
    alert("Could not send that image: " + err.message);
  }
}

if (msgImageBtn && msgImageFileInput) {
  msgImageBtn.addEventListener("click", () => msgImageFileInput.click());
  msgImageFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) sendImageFile(file);
    msgImageFileInput.value = "";
  });
}

if (messageComposeBar) {
  ["dragenter", "dragover"].forEach((evt) => {
    messageComposeBar.addEventListener(evt, (e) => {
      e.preventDefault();
      messageComposeBar.classList.add("compose-drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    messageComposeBar.addEventListener(evt, (e) => {
      e.preventDefault();
      messageComposeBar.classList.remove("compose-drag-over");
    });
  });
  messageComposeBar.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) sendImageFile(file);
  });
}

// ── Mark Channel as Read ────────────────────────────────────────
async function markChannelRead(channelId) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, "dmChannels", channelId), {
      [`unreadCount.${currentUser.uid}`]: 0,
    });
  } catch {}
}

// ── New Chat Modal (multi-select: 1 = DM, 2+ = group) ───────────
if (newChatBtn) {
  newChatBtn.addEventListener("click", async () => {
    newChatModal.style.display = "flex";
    userPickerSearch.value = "";
    selectedNewChatUids.clear();
    pendingGroupIconBase64 = null;
    if (groupChatNameInput) groupChatNameInput.value = "";
    if (groupChatIconPreview) groupChatIconPreview.innerHTML = "";
    updateNewChatModalState();
    await loadAllUsers();
    renderUserPicker("");
  });
}

if (closeNewChatModal) {
  closeNewChatModal.addEventListener("click", () => {
    newChatModal.style.display = "none";
  });
}

if (userPickerSearch) {
  userPickerSearch.addEventListener("input", (e) => {
    renderUserPicker(e.target.value.trim());
  });
}

function renderUserPicker(filter) {
  if (!userPickerList) return;
  userPickerList.innerHTML = "";

  const filtered = allUsers.filter((u) => {
    const name = u.displayName || u.email?.split("@")[0] || "";
    return !filter || name.toLowerCase().includes(filter.toLowerCase());
  });

  if (filtered.length === 0) {
    userPickerList.innerHTML = `<p style="color:var(--text-muted); padding:12px; font-size:13px;">No users found.</p>`;
    return;
  }

  filtered.forEach((u) => {
    const name = u.displayName || u.email?.split("@")[0] || "User";
    const avatarInner = u.photoUrl
      ? `<img src="${u.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`
      : name.charAt(0).toUpperCase();

    const item = document.createElement("div");
    item.className = `user-picker-item${selectedNewChatUids.has(u.uid) ? " selected" : ""}`;
    item.innerHTML = `
      <div class="user-picker-avatar">${avatarInner}</div>
      <div class="user-picker-name">${name}</div>
      <span class="material-symbols-outlined user-picker-check">check_circle</span>
    `;
    item.addEventListener("click", () => {
      if (selectedNewChatUids.has(u.uid)) {
        selectedNewChatUids.delete(u.uid);
        item.classList.remove("selected");
      } else {
        selectedNewChatUids.add(u.uid);
        item.classList.add("selected");
      }
      updateNewChatModalState();
    });
    userPickerList.appendChild(item);
  });
}

// Toggles the group-setup panel and updates the start button label based
// on how many members are currently selected.
function updateNewChatModalState() {
  const count = selectedNewChatUids.size;
  if (groupSetupPanel) groupSetupPanel.style.display = count >= 2 ? "block" : "none";

  if (!startChatBtn) return;
  if (count === 0) {
    startChatBtn.disabled = true;
    startChatBtn.innerText = "Select members to continue";
  } else if (count === 1) {
    startChatBtn.disabled = false;
    startChatBtn.innerText = "Start Direct Message";
  } else {
    startChatBtn.disabled = false;
    startChatBtn.innerText = `Create Group Chat (${count} members)`;
  }
}

if (groupChatIconFileInput) {
  groupChatIconFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 300 * 1024) {
      alert("Group icon must be under 300 KB.");
      return;
    }
    pendingGroupIconBase64 = await fileToBase64(file);
    if (groupChatIconPreview) {
      groupChatIconPreview.innerHTML = `<img src="${pendingGroupIconBase64}" style="width:100%;height:100%;object-fit:cover;" />`;
    }
  });
}

if (startChatBtn) {
  startChatBtn.addEventListener("click", async () => {
    if (selectedNewChatUids.size === 0) return;

    if (selectedNewChatUids.size === 1) {
      const uid = [...selectedNewChatUids][0];
      const otherUser = allUsers.find((u) => u.uid === uid);
      if (otherUser) await startOrOpenDM(otherUser);
      return;
    }

    const groupName = (groupChatNameInput?.value || "").trim();
    if (!groupName) {
      alert("Please name your group chat.");
      return;
    }
    await createGroupChat([...selectedNewChatUids], groupName, pendingGroupIconBase64);
  });
}

async function startOrOpenDM(otherUser) {
  if (!currentUser) return;
  newChatModal.style.display = "none";

  const channelId = buildChannelId(currentUser.uid, otherUser.uid);
  const channelRef = doc(db, "dmChannels", channelId);
  const channelSnap = await getDoc(channelRef);

  if (!channelSnap.exists()) {
    // Create the channel document
    await setDoc(channelRef, {
      participants: [currentUser.uid, otherUser.uid],
      isGroup: false,
      createdAt: serverTimestamp(),
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unreadCount: {
        [currentUser.uid]: 0,
        [otherUser.uid]: 0,
      },
    });
  }

  const otherName =
    otherUser.displayName || otherUser.email?.split("@")[0] || "User";
  openChat(channelId, { isGroup: false, name: otherName, photo: otherUser.photoUrl || "", otherUid: otherUser.uid });
}

async function createGroupChat(memberUids, groupName, iconBase64) {
  if (!currentUser) return;
  newChatModal.style.display = "none";

  const allParticipants = [currentUser.uid, ...memberUids];
  const unreadCount = {};
  allParticipants.forEach((uid) => (unreadCount[uid] = 0));

  try {
    const channelRef = await addDoc(collection(db, "dmChannels"), {
      participants: allParticipants,
      isGroup: true,
      groupName,
      groupIconUrl: iconBase64 || "",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      unreadCount,
    });
    openChat(channelRef.id, { isGroup: true, name: groupName, photo: iconBase64 || "" });
  } catch (err) {
    alert("Error creating group chat: " + err.message);
  }
}

// ── Notification Badge Sync ─────────────────────────────────────
function syncNotificationBadge() {
  const q = query(
    collection(db, "notifications"),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snap) => {
    let count = 0;
    snap.forEach((d) => {
      const entry = d.data();
      if (auth.currentUser && entry.createdBy === auth.currentUser.uid) return;
      const viewed = entry.viewedBy || [];
      if (auth.currentUser && !viewed.includes(auth.currentUser.uid)) count++;
    });
    if (notificationBadge) {
      if (count > 0) {
        notificationBadge.innerText = count;
        notificationBadge.style.display = "block";
      } else {
        notificationBadge.style.display = "none";
      }
    }
  });
}

// ── Utility ─────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

console.log("ShareNet Messenger Engine Online.");

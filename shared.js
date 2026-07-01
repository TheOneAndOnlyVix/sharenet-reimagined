// =============================================================================
//  shared.js — ShareNet Shared Module
//  Provides profile settings modal + AI chatbot on every page.
//  Add <script type="module" src="shared.js"></script> to any page that has:
//    - #navProfileAvatar
//    - #authNavBtn  (for sign-out detection)
// =============================================================================

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Firebase (reuse existing app if already initialized by the page's own JS) ─
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

// ── Profile cache (shared with any page that imports this module) ─────────────
let currentUserProfile = { displayName: "", photoUrl: "" };

// ── Inject shared HTML into the page ─────────────────────────────────────────
function injectSharedHtml() {
  if (document.getElementById("sharedProfileModal")) return;

  const html = `
        <div id="sharedProfileModal" class="modal-overlay" style="display:none">
          <div class="modal-box profile-modal-box">
            <span id="sharedCloseProfileModal" class="close-btn">&times;</span>
            <h2>Profile Settings</h2>
            <div class="profile-pic-section">
              <div id="sharedProfilePicPreview" class="profile-pic-preview image-drop-zone-round" title="Drag an image here or paste from clipboard">?</div>
              <button id="sharedChangePicBtn" class="change-pic-btn">Change Photo</button>
              <input type="file" id="sharedHiddenProfilePicInput" accept="image/*" style="display:none" />
              <p class="profile-pic-hint">Max 300 KB · JPG, PNG, GIF</p>
            </div>
            <div class="input-group">
              <label>Display Name</label>
              <input type="text" id="sharedProfileDisplayNameInput" placeholder="Your display name" maxlength="40" />
            </div>
            <div class="input-group">
              <label>Email (read-only)</label>
              <input type="text" id="sharedProfileEmailDisplay" readonly style="opacity:0.5;cursor:not-allowed;" />
            </div>
            <div class="input-group" style="margin-top:14px;">
              <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
                <span>Dark Mode</span>
                <label class="theme-toggle-switch">
                  <input type="checkbox" id="sharedDarkModeToggle" checked />
                  <span class="theme-toggle-slider"></span>
                </label>
              </label>
              <p style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
                Off = ShareNet Pink &amp; Sky Blue theme
              </p>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
              <button id="sharedViewProfileBtn" class="secondary-btn-style" style="margin:0">View My Profile</button>
              <button id="sharedSaveProfileBtn" class="submit-btn" style="margin:0">Save Changes</button>
            </div>
          </div>
        </div>
    
        <button id="sharedChatbotToggleBtn" class="chatbot-fab" title="ShareNet Assistant">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
    
        <div id="sharedChatbotPanel" class="chatbot-panel" style="display:none">
          <div class="chatbot-panel-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="chatbot-avatar-dot"></div>
              <span style="font-weight:700;font-size:14px;">ShareNet Assistant</span>
            </div>
            <button id="sharedCloseChatbotBtn" class="chatbot-close-btn">&times;</button>
          </div>
          <div id="sharedChatbotMessages" class="chatbot-messages">
            <div class="chatbot-msg chatbot-msg-assistant">
              Hi! I'm your ShareNet assistant. Ask me how to use any feature on the site or to help you draft community posts!
            </div>
          </div>
          <div class="chatbot-input-row">
            <input type="text" id="sharedChatbotInput" class="chatbot-input" placeholder="Ask me anything about ShareNet..." />
            <button id="sharedChatbotSendBtn" class="chatbot-send-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
}

// ── Avatar helpers ────────────────────────────────────────────────────────────
function updateNavAvatar() {
  const navAvatar = document.getElementById("navProfileAvatar");
  if (!navAvatar) return;
  navAvatar.style.display = "flex";
  if (currentUserProfile.photoUrl) {
    navAvatar.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    navAvatar.innerHTML = (currentUserProfile.displayName || "?")
      .charAt(0)
      .toUpperCase();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Open profile modal ────────────────────────────────────────────────────────
function openProfileModal() {
  const modal = document.getElementById("sharedProfileModal");
  const nameInput = document.getElementById("sharedProfileDisplayNameInput");
  const emailDisp = document.getElementById("sharedProfileEmailDisplay");
  const picPrev = document.getElementById("sharedProfilePicPreview");

  if (!modal) return;

  if (nameInput) nameInput.value = currentUserProfile.displayName;
  if (emailDisp) emailDisp.value = auth.currentUser?.email || "";
  if (picPrev) {
    if (currentUserProfile.photoUrl) {
      picPrev.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
      picPrev.innerHTML = (currentUserProfile.displayName || "?")
        .charAt(0)
        .toUpperCase();
    }
  }

  modal.style.display = "flex";
}

// ── Bind profile modal events ─────────────────────────────────────────────────
function bindProfileModal() {
  const modal = document.getElementById("sharedProfileModal");
  const closeBtn = document.getElementById("sharedCloseProfileModal");
  const changePic = document.getElementById("sharedChangePicBtn");
  const picInput = document.getElementById("sharedHiddenProfilePicInput");
  const picPrev = document.getElementById("sharedProfilePicPreview");
  const saveBtn = document.getElementById("sharedSaveProfileBtn");
  const navAvatar = document.getElementById("navProfileAvatar");

  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.style.display = "none";
    });

  const viewProfileBtn = document.getElementById("sharedViewProfileBtn");
  if (viewProfileBtn) {
    viewProfileBtn.addEventListener("click", () => {
      if (auth.currentUser) {
        window.location.href = `profile.html?uid=${auth.currentUser.uid}`;
      }
    });
  }

  if (navAvatar) {
    navAvatar.addEventListener("click", () => {
      if (!auth.currentUser) return;
      openProfileModal();
    });
  }

  if (changePic && picInput) {
    changePic.addEventListener("click", () => picInput.click());
    picInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 300 * 1024) {
        alert("Profile picture must be under 300 KB.");
        return;
      }
      const base64 = await fileToBase64(file);
      currentUserProfile.photoUrl = base64;
      if (picPrev) {
        picPrev.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!auth.currentUser) return;
      const newName = document
        .getElementById("sharedProfileDisplayNameInput")
        ?.value.trim();
      if (!newName) {
        alert("Display name cannot be empty.");
        return;
      }
      if (newName.length > 40) {
        alert("Display name must be 40 characters or less.");
        return;
      }
      currentUserProfile.displayName = newName;

      // Persist dark mode preference
      const darkToggle = document.getElementById("sharedDarkModeToggle");
      const isDark = darkToggle ? darkToggle.checked : true;
      applyTheme(isDark);
      localStorage.setItem("sharenet_dark_mode", isDark ? "1" : "0");

      try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          displayName: newName,
          photoUrl: currentUserProfile.photoUrl,
        });
      } catch {
        await setDoc(doc(db, "users", auth.currentUser.uid), {
          email: auth.currentUser.email,
          displayName: newName,
          photoUrl: currentUserProfile.photoUrl,
          createdAt: new Date(),
        });
      }

      updateNavAvatar();
      modal.style.display = "none";
      alert("Profile updated!");
    });
  }

  // Sync toggle state when modal opens
  if (modal) {
    const observer = new MutationObserver(() => {
      if (modal.style.display !== "none") {
        const darkToggle = document.getElementById("sharedDarkModeToggle");
        if (darkToggle) {
          const stored = localStorage.getItem("sharenet_dark_mode");
          darkToggle.checked = stored === null ? true : stored === "1";
        }
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["style"] });
  }

  // Profile pic: drag-and-drop + paste
  if (picPrev) {
    picPrev.addEventListener("dragover", (e) => {
      e.preventDefault();
      picPrev.classList.add("drag-over");
    });
    picPrev.addEventListener("dragleave", () =>
      picPrev.classList.remove("drag-over")
    );
    picPrev.addEventListener("drop", async (e) => {
      e.preventDefault();
      picPrev.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (file.size > 300 * 1024) {
        alert("Image must be under 300 KB.");
        return;
      }
      const b64 = await fileToBase64(file);
      currentUserProfile.photoUrl = b64;
      picPrev.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    });
    picPrev.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file || file.size > 300 * 1024) {
            alert("Image must be under 300 KB.");
            return;
          }
          const b64 = await fileToBase64(file);
          currentUserProfile.photoUrl = b64;
          picPrev.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
          return;
        }
      }
    });
    picPrev.setAttribute("tabindex", "0");
    picPrev.title = "Drag or paste an image here";
  }
}

// ── Chatbot Frontend Logic ───────────────────────────────────────────────────
function bindChatbot() {
  const toggleBtn = document.getElementById("sharedChatbotToggleBtn");
  const panel = document.getElementById("sharedChatbotPanel");
  const closeBtn = document.getElementById("sharedCloseChatbotBtn");
  const sendBtn = document.getElementById("sharedChatbotSendBtn");
  const input = document.getElementById("sharedChatbotInput");
  const messages = document.getElementById("sharedChatbotMessages");

  if (!toggleBtn) return;

  // Real URL to your verified Cloudflare Worker backend
  const CHATBOT_PROXY_URL =
    "https://sharenet-assistant.ogheneovieumebese.workers.dev";

  // local array to maintain context while the panel is active
  const conversationHistory = [];

  toggleBtn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    if (panel.style.display === "flex" && input) input.focus();
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }

  async function sendMessage() {
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";

    appendMessage("user", text);
    conversationHistory.push({ role: "user", content: text });

    const thinkingId = appendMessage("assistant", "● ● ●");

    try {
      const response = await fetch(CHATBOT_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Worker Error Response:", errorData);
        updateMessage(
          thinkingId,
          `Error: ${errorData.details || "Couldn't reach assistant."}`
        );
        return;
      }

      const data = await response.json();
      const reply =
        data.choices?.[0]?.message?.content ||
        "Sorry, I didn't get a proper response.";

      conversationHistory.push({ role: "assistant", content: reply });
      updateMessage(thinkingId, reply);
    } catch (err) {
      console.error("Chatbot fetch error:", err);
      updateMessage(
        thinkingId,
        "Sorry, something went wrong on the server connection."
      );
    }
  }

  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });
  }

  function appendMessage(role, text) {
    const id = `cbmsg-${Date.now()}-${Math.random()}`;
    const el = document.createElement("div");
    el.id = id;
    el.className = `chatbot-msg chatbot-msg-${role}`;
    el.innerText = text;
    messages?.appendChild(el);
    if (messages) messages.scrollTop = messages.scrollHeight;
    return id;
  }

  function updateMessage(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }
}

// ── Theme / Dark Mode ────────────────────────────────────────────────────────
function applyTheme(isDark) {
  document.documentElement.classList.toggle("theme-light", !isDark);
}

function initTheme() {
  const stored = localStorage.getItem("sharenet_dark_mode");
  const isDark = stored === null ? true : stored === "1";
  applyTheme(isDark);
}

// ── Auth state — load profile and wire up avatar ──────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        currentUserProfile.displayName =
          d.displayName || user.email.split("@")[0];
        currentUserProfile.photoUrl = d.photoUrl || "";
      } else {
        currentUserProfile.displayName = user.email.split("@")[0];
        currentUserProfile.photoUrl = "";
      }
    } catch {
      currentUserProfile.displayName = user.email.split("@")[0];
      currentUserProfile.photoUrl = "";
    }
    updateNavAvatar();
  } else {
    currentUserProfile = { displayName: "", photoUrl: "" };
    const navAvatar = document.getElementById("navProfileAvatar");
    if (navAvatar) {
      navAvatar.innerHTML = "?";
      navAvatar.style.display = "none";
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  injectSharedHtml();
  bindProfileModal();
  bindChatbot();
});const db = getFirestore(app);

// ── Profile cache (shared with any page that imports this module) ─────────────
let currentUserProfile = { displayName: "", photoUrl: "" };

// ── Inject shared HTML into the page ─────────────────────────────────────────
function injectSharedHtml() {
  if (document.getElementById("sharedProfileModal")) return;

  const html = `
        <div id="sharedProfileModal" class="modal-overlay" style="display:none">
          <div class="modal-box profile-modal-box">
            <span id="sharedCloseProfileModal" class="close-btn">&times;</span>
            <h2>Profile Settings</h2>
            <div class="profile-pic-section">
              <div id="sharedProfilePicPreview" class="profile-pic-preview image-drop-zone-round" title="Drag an image here or paste from clipboard">?</div>
              <button id="sharedChangePicBtn" class="change-pic-btn">Change Photo</button>
              <input type="file" id="sharedHiddenProfilePicInput" accept="image/*" style="display:none" />
              <p class="profile-pic-hint">Max 300 KB · JPG, PNG, GIF</p>
            </div>
            <div class="input-group">
              <label>Display Name</label>
              <input type="text" id="sharedProfileDisplayNameInput" placeholder="Your display name" maxlength="40" />
            </div>
            <div class="input-group">
              <label>Email (read-only)</label>
              <input type="text" id="sharedProfileEmailDisplay" readonly style="opacity:0.5;cursor:not-allowed;" />
            </div>
            <div class="input-group" style="margin-top:14px;">
              <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
                <span>Dark Mode</span>
                <label class="theme-toggle-switch">
                  <input type="checkbox" id="sharedDarkModeToggle" checked />
                  <span class="theme-toggle-slider"></span>
                </label>
              </label>
              <p style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
                Off = ShareNet Pink &amp; Sky Blue theme
              </p>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
              <button id="sharedViewProfileBtn" class="secondary-btn-style" style="margin:0">View My Profile</button>
              <button id="sharedSaveProfileBtn" class="submit-btn" style="margin:0">Save Changes</button>
            </div>
          </div>
        </div>
    
        <button id="sharedChatbotToggleBtn" class="chatbot-fab" title="ShareNet Assistant">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
    
        <div id="sharedChatbotPanel" class="chatbot-panel" style="display:none">
          <div class="chatbot-panel-header">
            <div style="display:flex;align-items:center;gap:10px;">
              <div class="chatbot-avatar-dot"></div>
              <span style="font-weight:700;font-size:14px;">ShareNet Assistant</span>
            </div>
            <button id="sharedCloseChatbotBtn" class="chatbot-close-btn">&times;</button>
          </div>
          <div id="sharedChatbotMessages" class="chatbot-messages">
            <div class="chatbot-msg chatbot-msg-assistant">
              Hi! I'm your ShareNet assistant. Ask me how to use any feature on the site or to help you draft community posts!
            </div>
          </div>
          <div class="chatbot-input-row">
            <input type="text" id="sharedChatbotInput" class="chatbot-input" placeholder="Ask me anything about ShareNet..." />
            <button id="sharedChatbotSendBtn" class="chatbot-send-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);
}

// ── Avatar helpers ────────────────────────────────────────────────────────────
function updateNavAvatar() {
  const navAvatar = document.getElementById("navProfileAvatar");
  if (!navAvatar) return;
  navAvatar.style.display = "flex";
  if (currentUserProfile.photoUrl) {
    navAvatar.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    navAvatar.innerHTML = (currentUserProfile.displayName || "?")
      .charAt(0)
      .toUpperCase();
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Open profile modal ────────────────────────────────────────────────────────
function openProfileModal() {
  const modal = document.getElementById("sharedProfileModal");
  const nameInput = document.getElementById("sharedProfileDisplayNameInput");
  const emailDisp = document.getElementById("sharedProfileEmailDisplay");
  const picPrev = document.getElementById("sharedProfilePicPreview");

  if (!modal) return;

  if (nameInput) nameInput.value = currentUserProfile.displayName;
  if (emailDisp) emailDisp.value = auth.currentUser?.email || "";
  if (picPrev) {
    if (currentUserProfile.photoUrl) {
      picPrev.innerHTML = `<img src="${currentUserProfile.photoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    } else {
      picPrev.innerHTML = (currentUserProfile.displayName || "?")
        .charAt(0)
        .toUpperCase();
    }
  }

  modal.style.display = "flex";
}

// ── Bind profile modal events ─────────────────────────────────────────────────
function bindProfileModal() {
  const modal = document.getElementById("sharedProfileModal");
  const closeBtn = document.getElementById("sharedCloseProfileModal");
  const changePic = document.getElementById("sharedChangePicBtn");
  const picInput = document.getElementById("sharedHiddenProfilePicInput");
  const picPrev = document.getElementById("sharedProfilePicPreview");
  const saveBtn = document.getElementById("sharedSaveProfileBtn");
  const navAvatar = document.getElementById("navProfileAvatar");

  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.style.display = "none";
    });

  const viewProfileBtn = document.getElementById("sharedViewProfileBtn");
  if (viewProfileBtn) {
    viewProfileBtn.addEventListener("click", () => {
      if (auth.currentUser) {
        window.location.href = `profile.html?uid=${auth.currentUser.uid}`;
      }
    });
  }

  if (navAvatar) {
    navAvatar.addEventListener("click", () => {
      if (!auth.currentUser) return;
      openProfileModal();
    });
  }

  if (changePic && picInput) {
    changePic.addEventListener("click", () => picInput.click());
    picInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 300 * 1024) {
        alert("Profile picture must be under 300 KB.");
        return;
      }
      const base64 = await fileToBase64(file);
      currentUserProfile.photoUrl = base64;
      if (picPrev) {
        picPrev.innerHTML = `<img src="${base64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      if (!auth.currentUser) return;
      const newName = document
        .getElementById("sharedProfileDisplayNameInput")
        ?.value.trim();
      if (!newName) {
        alert("Display name cannot be empty.");
        return;
      }
      if (newName.length > 40) {
        alert("Display name must be 40 characters or less.");
        return;
      }
      currentUserProfile.displayName = newName;

      // Persist dark mode preference
      const darkToggle = document.getElementById("sharedDarkModeToggle");
      const isDark = darkToggle ? darkToggle.checked : true;
      applyTheme(isDark);
      localStorage.setItem("sharenet_dark_mode", isDark ? "1" : "0");

      try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          displayName: newName,
          photoUrl: currentUserProfile.photoUrl,
        });
      } catch {
        await setDoc(doc(db, "users", auth.currentUser.uid), {
          email: auth.currentUser.email,
          displayName: newName,
          photoUrl: currentUserProfile.photoUrl,
          createdAt: new Date(),
        });
      }

      updateNavAvatar();
      modal.style.display = "none";
      alert("Profile updated!");
    });
  }

  // Sync toggle state when modal opens
  if (modal) {
    const observer = new MutationObserver(() => {
      if (modal.style.display !== "none") {
        const darkToggle = document.getElementById("sharedDarkModeToggle");
        if (darkToggle) {
          const stored = localStorage.getItem("sharenet_dark_mode");
          darkToggle.checked = stored === null ? true : stored === "1";
        }
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["style"] });
  }

  // Profile pic: drag-and-drop + paste
  if (picPrev) {
    picPrev.addEventListener("dragover", (e) => {
      e.preventDefault();
      picPrev.classList.add("drag-over");
    });
    picPrev.addEventListener("dragleave", () =>
      picPrev.classList.remove("drag-over")
    );
    picPrev.addEventListener("drop", async (e) => {
      e.preventDefault();
      picPrev.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith("image/")) return;
      if (file.size > 300 * 1024) {
        alert("Image must be under 300 KB.");
        return;
      }
      const b64 = await fileToBase64(file);
      currentUserProfile.photoUrl = b64;
      picPrev.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    });
    picPrev.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file || file.size > 300 * 1024) {
            alert("Image must be under 300 KB.");
            return;
          }
          const b64 = await fileToBase64(file);
          currentUserProfile.photoUrl = b64;
          picPrev.innerHTML = `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
          return;
        }
      }
    });
    picPrev.setAttribute("tabindex", "0");
    picPrev.title = "Drag or paste an image here";
  }
}

// ── Chatbot Frontend Logic ───────────────────────────────────────────────────
function bindChatbot() {
  const toggleBtn = document.getElementById("sharedChatbotToggleBtn");
  const panel = document.getElementById("sharedChatbotPanel");
  const closeBtn = document.getElementById("sharedCloseChatbotBtn");
  const sendBtn = document.getElementById("sharedChatbotSendBtn");
  const input = document.getElementById("sharedChatbotInput");
  const messages = document.getElementById("sharedChatbotMessages");

  if (!toggleBtn) return;

  // Real URL to your verified Cloudflare Worker backend
  const CHATBOT_PROXY_URL =
    "https://sharenet-assistant.ogheneovieumebese.workers.dev";

  // local array to maintain context while the panel is active
  const conversationHistory = [];

  toggleBtn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "flex" ? "none" : "flex";
    if (panel.style.display === "flex" && input) input.focus();
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
    });
  }

  async function sendMessage() {
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";

    appendMessage("user", text);
    conversationHistory.push({ role: "user", content: text });

    const thinkingId = appendMessage("assistant", "● ● ●");

    try {
      const response = await fetch(CHATBOT_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversationHistory,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Worker Error Response:", errorData);
        updateMessage(
          thinkingId,
          `Error: ${errorData.details || "Couldn't reach assistant."}`
        );
        return;
      }

      const data = await response.json();
      const reply =
        data.choices?.[0]?.message?.content ||
        "Sorry, I didn't get a proper response.";

      conversationHistory.push({ role: "assistant", content: reply });
      updateMessage(thinkingId, reply);
    } catch (err) {
      console.error("Chatbot fetch error:", err);
      updateMessage(
        thinkingId,
        "Sorry, something went wrong on the server connection."
      );
    }
  }

  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });
  }

  function appendMessage(role, text) {
    const id = `cbmsg-${Date.now()}-${Math.random()}`;
    const el = document.createElement("div");
    el.id = id;
    el.className = `chatbot-msg chatbot-msg-${role}`;
    el.innerText = text;
    messages?.appendChild(el);
    if (messages) messages.scrollTop = messages.scrollHeight;
    return id;
  }

  function updateMessage(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }
}

// ── Theme / Dark Mode ────────────────────────────────────────────────────────
function applyTheme(isDark) {
  document.documentElement.classList.toggle("theme-light", !isDark);
}

function initTheme() {
  const stored = localStorage.getItem("sharenet_dark_mode");
  const isDark = stored === null ? true : stored === "1";
  applyTheme(isDark);
}

// ── Auth state — load profile and wire up avatar ──────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d = snap.data();
        currentUserProfile.displayName =
          d.displayName || user.email.split("@")[0];
        currentUserProfile.photoUrl = d.photoUrl || "";
      } else {
        currentUserProfile.displayName = user.email.split("@")[0];
        currentUserProfile.photoUrl = "";
      }
    } catch {
      currentUserProfile.displayName = user.email.split("@")[0];
      currentUserProfile.photoUrl = "";
    }
    updateNavAvatar();
  } else {
    currentUserProfile = { displayName: "", photoUrl: "" };
    const navAvatar = document.getElementById("navProfileAvatar");
    if (navAvatar) {
      navAvatar.innerHTML = "?";
      navAvatar.style.display = "none";
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  injectSharedHtml();
  bindProfileModal();
  bindChatbot();
});

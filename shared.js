// =============================================================================
//  shared.js — ShareNet Shared Module
//  Provides profile settings modal + AI chatbot + background music on every page.
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
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { computePermissions, waitForRoles, onRolesUpdated } from "./permissions.js";

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

// ── Profile cache (shared with any page that imports this module) ─────────────
let currentUserProfile = { displayName: "", photoUrl: "" };
let currentUserDataFull = null;
let sharedMyPermissions = computePermissions(null, null);

onRolesUpdated(() => {
  sharedMyPermissions = computePermissions(auth.currentUser, currentUserDataFull);
  applyProfileEditRestrictions();
});

// =============================================================================
//  BACKGROUND MUSIC — state
//  Data model:
//    soundtracks/{soundtrackId}                → { name, ownerId, createdAt }
//    soundtracks/{soundtrackId}/tracks/{trackId} → {
//        type: "file" | "youtube",
//        name,
//        data (base64, "file" tracks only),
//        youtubeId ("youtube" tracks only),
//        addedAt
//      }
//  Preferences (enabled / autoplay / volume / active soundtrack) are kept in
//  localStorage, same pattern as the dark-mode toggle — no login required to
//  simply hear whatever soundtrack is already selected.
// =============================================================================
let musicEnabled = false;
let musicAutoplay = false;
let musicVolume = 50; // 0–100
let activeSoundtrackId = localStorage.getItem("sharenet_active_soundtrack") || "";
let mySoundtracks = []; // cached list for the currently signed-in owner
let editingSoundtrackId = null; // soundtrack currently open in the editor modal
let tracksUnsubscribe = null; // live listener for the editor's track list

let bgAudioEl = null;
let ytPlayer = null;
let ytApiReady = false;
let ytApiLoading = false;
let currentPlaylist = [];
let currentTrackIndex = -1;

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

            <div class="input-group music-settings-group">
              <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;">
                <span>Background Music</span>
                <label class="theme-toggle-switch">
                  <input type="checkbox" id="sharedMusicEnabledToggle" />
                  <span class="theme-toggle-slider"></span>
                </label>
              </label>

              <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-top:10px;">
                <span style="font-size:12px;color:var(--text-secondary);">Play automatically on startup</span>
                <label class="theme-toggle-switch">
                  <input type="checkbox" id="sharedMusicAutoplayToggle" />
                  <span class="theme-toggle-slider"></span>
                </label>
              </label>

              <div class="music-volume-row">
                <span class="material-symbols-outlined" style="font-size:18px;color:var(--text-muted);">volume_up</span>
                <input type="range" id="sharedMusicVolumeSlider" min="0" max="100" value="50" />
              </div>

              <button id="sharedManageSoundtracksBtn" type="button" class="secondary-btn-style music-manage-btn">
                <span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;">library_music</span>
                Manage Soundtracks
              </button>
            </div>

            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
              <button id="sharedViewProfileBtn" class="secondary-btn-style" style="margin:0">View My Profile</button>
              <button id="sharedSaveProfileBtn" class="submit-btn" style="margin:0">Save Changes</button>
            </div>
          </div>
        </div>

        <!-- ── Soundtrack Manager modal — list of up to 3 soundtracks ── -->
        <div id="sharedSoundtrackModal" class="modal-overlay" style="display:none">
          <div class="modal-box badge-manager-box">
            <span id="sharedCloseSoundtrackModal" class="close-btn">&times;</span>
            <h2>Background Music Soundtracks</h2>
            <p class="subtitle" style="margin-bottom:18px;">
              Create up to 3 soundtracks and pick one to play in the background.
            </p>
            <button id="sharedOpenCreateSoundtrackBtn" class="action-btn" style="margin-bottom:18px;">
              + Create Soundtrack
            </button>
            <div id="sharedSoundtrackList" class="badge-manager-list">
              <p class="loading-text">Loading soundtracks...</p>
            </div>
          </div>
        </div>

        <!-- ── Create/Edit Soundtrack modal — name + track management ── -->
        <div id="sharedSoundtrackEditorModal" class="modal-overlay" style="display:none">
          <div class="modal-box soundtrack-editor-box">
            <span id="sharedCloseSoundtrackEditorModal" class="close-btn">&times;</span>
            <h2 id="sharedSoundtrackEditorTitle">Create Soundtrack</h2>

            <div class="input-group">
              <label>Soundtrack Name</label>
              <div style="display:flex;gap:8px;">
                <input type="text" id="sharedSoundtrackNameInput" placeholder="e.g. Study Vibes" maxlength="40" />
                <button id="sharedSaveSoundtrackNameBtn" class="secondary-btn-style" style="white-space:nowrap;">Save</button>
              </div>
            </div>

            <div id="sharedSoundtrackTracksSection" style="display:none;">
              <div class="input-group">
                <label>Tracks</label>
                <div id="sharedSoundtrackTracksList" class="badge-manager-list" style="margin-bottom:14px;"></div>
              </div>

              <div class="input-group">
                <label>Add Audio File <span style="color:var(--text-muted);font-size:12px;">(max 800 KB)</span></label>
                <div id="sharedTrackFileDropzone" class="badge-icon-dropzone">
                  <span class="material-symbols-outlined" style="font-size:26px;">audio_file</span>
                  <p>Drag &amp; drop an audio file, or click to browse</p>
                  <p style="font-size:11px;color:var(--text-secondary);">Short/compressed clips work best</p>
                  <input type="file" id="sharedTrackFileInput" accept="audio/*" hidden />
                </div>
              </div>

              <div class="input-group">
                <label>Add YouTube Link</label>
                <div style="display:flex;gap:8px;">
                  <input type="text" id="sharedTrackYoutubeInput" placeholder="https://youtube.com/watch?v=..." />
                  <button id="sharedAddYoutubeTrackBtn" class="secondary-btn-style" style="white-space:nowrap;">Add</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Hidden playback engines — one <audio> for files, one iframe target for YouTube ── -->
        <audio id="sharedBgAudioPlayer" style="display:none"></audio>
        <div id="sharedYtPlayerContainer" style="position:fixed;bottom:0;left:0;width:0;height:0;overflow:hidden;"></div>

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
  applyProfileEditRestrictions();
}

// Disable/hide profile edit controls the signed-in user's role restricts.
function applyProfileEditRestrictions() {
  const nameInput = document.getElementById("sharedProfileDisplayNameInput");
  const changePic = document.getElementById("sharedChangePicBtn");
  const perms = sharedMyPermissions.permissions;

  if (nameInput) {
    nameInput.disabled = !perms.canChangeDisplayName;
    nameInput.title = perms.canChangeDisplayName
      ? ""
      : "Your account role does not allow changing your display name.";
  }
  if (changePic) {
    changePic.disabled = !perms.canHaveProfilePicture;
    changePic.style.display = perms.canHaveProfilePicture ? "inline-block" : "none";
  }

  applyChatbotRestriction();
}

// Hides the ShareNet Assistant launcher entirely when restricted, and
// closes the panel live if a role change revokes access mid-conversation.
function applyChatbotRestriction() {
  const toggleBtn = document.getElementById("sharedChatbotToggleBtn");
  const panel = document.getElementById("sharedChatbotPanel");
  const allowed = sharedMyPermissions.permissions.canUseAssistant;

  if (toggleBtn) toggleBtn.style.display = allowed ? "flex" : "none";
  if (!allowed && panel) panel.style.display = "none";
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
    changePic.addEventListener("click", () => {
      if (!sharedMyPermissions.permissions.canHaveProfilePicture) {
        alert("Your account role does not allow having a profile picture.");
        return;
      }
      picInput.click();
    });
    picInput.addEventListener("change", async (e) => {
      if (!sharedMyPermissions.permissions.canHaveProfilePicture) {
        alert("Your account role does not allow having a profile picture.");
        return;
      }
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
      const perms = sharedMyPermissions.permissions;
      const nameField = document.getElementById("sharedProfileDisplayNameInput");
      const typedName = nameField ? nameField.value.trim() : "";

      // If the role restricts display name changes, keep whatever name is
      // already saved rather than trusting the (disabled, but still
      // client-editable) input value.
      const newName = perms.canChangeDisplayName
        ? typedName
        : currentUserProfile.displayName;

      if (!newName) {
        alert("Display name cannot be empty.");
        return;
      }
      if (newName.length > 40) {
        alert("Display name must be 40 characters or less.");
        return;
      }
      if (perms.canChangeDisplayName) {
        currentUserProfile.displayName = newName;
      }

      // If the role restricts profile pictures, don't persist a staged
      // photo change even if one snuck through via drag/drop or paste.
      const photoUrlToSave = perms.canHaveProfilePicture
        ? currentUserProfile.photoUrl
        : "";
      if (!perms.canHaveProfilePicture) currentUserProfile.photoUrl = "";

      // Persist dark mode preference
      const darkToggle = document.getElementById("sharedDarkModeToggle");
      const isDark = darkToggle ? darkToggle.checked : true;
      applyTheme(isDark);
      localStorage.setItem("sharenet_dark_mode", isDark ? "1" : "0");

      try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          displayName: newName,
          photoUrl: photoUrlToSave,
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

  // Sync toggle state when modal opens (dark mode + music settings)
  if (modal) {
    const observer = new MutationObserver(() => {
      if (modal.style.display !== "none") {
        const darkToggle = document.getElementById("sharedDarkModeToggle");
        if (darkToggle) {
          const stored = localStorage.getItem("sharenet_dark_mode");
          darkToggle.checked = stored === null ? true : stored === "1";
        }
        const musicToggle = document.getElementById("sharedMusicEnabledToggle");
        if (musicToggle) musicToggle.checked = musicEnabled;
        const autoplayToggle = document.getElementById("sharedMusicAutoplayToggle");
        if (autoplayToggle) autoplayToggle.checked = musicAutoplay;
        const volSlider = document.getElementById("sharedMusicVolumeSlider");
        if (volSlider) volSlider.value = musicVolume;
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
    if (!sharedMyPermissions.permissions.canUseAssistant) {
      alert("Your account role does not allow you to use the ShareNet Assistant.");
      return;
    }
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

// =============================================================================
//  BACKGROUND MUSIC — settings wiring (toggle / autoplay / volume)
// =============================================================================
function bindMusicSettings() {
  const enabledToggle = document.getElementById("sharedMusicEnabledToggle");
  const autoplayToggle = document.getElementById("sharedMusicAutoplayToggle");
  const volumeSlider = document.getElementById("sharedMusicVolumeSlider");

  if (enabledToggle) {
    enabledToggle.addEventListener("change", (e) => {
      musicEnabled = e.target.checked;
      localStorage.setItem("sharenet_music_enabled", musicEnabled ? "1" : "0");
      if (musicEnabled && activeSoundtrackId) {
        startPlaybackForSoundtrack(activeSoundtrackId);
      } else {
        stopPlayback();
      }
    });
  }

  if (autoplayToggle) {
    autoplayToggle.addEventListener("change", (e) => {
      musicAutoplay = e.target.checked;
      localStorage.setItem("sharenet_music_autoplay", musicAutoplay ? "1" : "0");
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener("input", (e) => {
      musicVolume = parseInt(e.target.value, 10) || 0;
      localStorage.setItem("sharenet_music_volume", String(musicVolume));
      if (bgAudioEl) bgAudioEl.volume = musicVolume / 100;
      if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(musicVolume);
    });
  }
}

// Reads saved preferences and, if enabled + autoplay + a soundtrack is
// selected, kicks off playback. Called once on page load.
function initMusicPrefs() {
  musicEnabled = localStorage.getItem("sharenet_music_enabled") === "1";
  musicAutoplay = localStorage.getItem("sharenet_music_autoplay") === "1";
  const storedVol = localStorage.getItem("sharenet_music_volume");
  musicVolume = storedVol !== null ? parseInt(storedVol, 10) : 50;
  activeSoundtrackId = localStorage.getItem("sharenet_active_soundtrack") || "";

  bgAudioEl = document.getElementById("sharedBgAudioPlayer");
  if (bgAudioEl) {
    bgAudioEl.addEventListener("ended", () => playNextTrack());
  }

  if (musicEnabled && musicAutoplay && activeSoundtrackId) {
    startPlaybackForSoundtrack(activeSoundtrackId);
  }
}

// =============================================================================
//  BACKGROUND MUSIC — Soundtrack Manager modal (list of up to 3 soundtracks)
// =============================================================================
function bindSoundtrackManager() {
  const manageBtn = document.getElementById("sharedManageSoundtracksBtn");
  const modal = document.getElementById("sharedSoundtrackModal");
  const closeBtn = document.getElementById("sharedCloseSoundtrackModal");
  const createBtn = document.getElementById("sharedOpenCreateSoundtrackBtn");

  if (manageBtn) {
    manageBtn.addEventListener("click", () => {
      if (!auth.currentUser) {
        alert("Please log in to manage soundtracks.");
        return;
      }
      if (modal) modal.style.display = "flex";
      loadMySoundtracks();
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  if (createBtn) {
    createBtn.addEventListener("click", () => {
      if (mySoundtracks.length >= 3) {
        alert("You can only have up to 3 soundtracks. Delete one first.");
        return;
      }
      openSoundtrackEditor(null);
    });
  }
}

async function loadMySoundtracks() {
  const listEl = document.getElementById("sharedSoundtrackList");
  const createBtn = document.getElementById("sharedOpenCreateSoundtrackBtn");
  if (!listEl || !auth.currentUser) return;

  listEl.innerHTML = `<p class="loading-text">Loading soundtracks...</p>`;

  try {
    const q = query(
      collection(db, "soundtracks"),
      where("ownerId", "==", auth.currentUser.uid)
    );
    const snap = await getDocs(q);
    mySoundtracks = [];
    snap.forEach((d) => mySoundtracks.push({ id: d.id, ...d.data() }));

    if (createBtn) {
      createBtn.style.display = mySoundtracks.length >= 3 ? "none" : "inline-block";
    }

    if (mySoundtracks.length === 0) {
      listEl.innerHTML = `<p class="loading-text">No soundtracks yet. Create one to get started.</p>`;
      return;
    }

    listEl.innerHTML = mySoundtracks
      .map((s) => {
        const isActive = s.id === activeSoundtrackId;
        return `
          <div class="badge-manager-row">
            <span class="role-pill" style="background:${
              isActive ? "var(--accent-success)" : "var(--accent-purple)"
            };">${isActive ? "▶ " : ""}${s.name}</span>
            <div class="badge-manager-row-info">
              <span class="badge-manager-row-meta">${
                isActive ? "Currently active" : "Not active"
              }</span>
            </div>
            <button type="button" class="badge-manager-delete-btn" data-set-active-soundtrack="${
              s.id
            }" title="${isActive ? "Currently active" : "Set as active"}">
              <span class="material-symbols-outlined" style="font-size:18px;">${
                isActive ? "check_circle" : "play_circle"
              }</span>
            </button>
            <button type="button" class="badge-manager-delete-btn" data-edit-soundtrack="${
              s.id
            }" title="Edit">
              <span class="material-symbols-outlined" style="font-size:18px;">edit</span>
            </button>
            <button type="button" class="badge-manager-delete-btn" data-delete-soundtrack="${
              s.id
            }" title="Delete">
              <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
            </button>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll("[data-set-active-soundtrack]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-set-active-soundtrack");
        activeSoundtrackId = id;
        localStorage.setItem("sharenet_active_soundtrack", id);
        if (musicEnabled) startPlaybackForSoundtrack(id);
        loadMySoundtracks();
      };
    });
    listEl.querySelectorAll("[data-edit-soundtrack]").forEach((btn) => {
      btn.onclick = () => openSoundtrackEditor(btn.getAttribute("data-edit-soundtrack"));
    });
    listEl.querySelectorAll("[data-delete-soundtrack]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-delete-soundtrack");
        const st = mySoundtracks.find((s) => s.id === id);
        if (
          !confirm(
            `Delete "${st ? st.name : "this soundtrack"}"? This removes all of its tracks too.`
          )
        )
          return;
        try {
          const tracksSnap = await getDocs(collection(db, "soundtracks", id, "tracks"));
          const deletions = [];
          tracksSnap.forEach((td) =>
            deletions.push(deleteDoc(doc(db, "soundtracks", id, "tracks", td.id)))
          );
          await Promise.all(deletions);
          await deleteDoc(doc(db, "soundtracks", id));

          if (activeSoundtrackId === id) {
            activeSoundtrackId = "";
            localStorage.removeItem("sharenet_active_soundtrack");
            stopPlayback();
          }
          loadMySoundtracks();
        } catch (err) {
          alert("Error deleting soundtrack: " + err.message);
        }
      };
    });
  } catch (err) {
    listEl.innerHTML = `<p class="loading-text">Couldn't load soundtracks.</p>`;
    console.error("Error loading soundtracks:", err);
  }
}

// =============================================================================
//  BACKGROUND MUSIC — Create/Edit Soundtrack modal (name + tracks)
// =============================================================================
function openSoundtrackEditor(soundtrackId) {
  editingSoundtrackId = soundtrackId;
  const modal = document.getElementById("sharedSoundtrackEditorModal");
  const title = document.getElementById("sharedSoundtrackEditorTitle");
  const nameInput = document.getElementById("sharedSoundtrackNameInput");
  const tracksSection = document.getElementById("sharedSoundtrackTracksSection");
  if (!modal) return;

  if (tracksUnsubscribe) {
    tracksUnsubscribe();
    tracksUnsubscribe = null;
  }

  if (soundtrackId) {
    const st = mySoundtracks.find((s) => s.id === soundtrackId);
    if (title) title.innerText = "Edit Soundtrack";
    if (nameInput) nameInput.value = st ? st.name : "";
    if (tracksSection) tracksSection.style.display = "block";
    listenForTracks(soundtrackId);
  } else {
    if (title) title.innerText = "Create Soundtrack";
    if (nameInput) nameInput.value = "";
    if (tracksSection) tracksSection.style.display = "none";
  }

  modal.style.display = "flex";
}

function listenForTracks(soundtrackId) {
  if (tracksUnsubscribe) tracksUnsubscribe();
  const listEl = document.getElementById("sharedSoundtrackTracksList");

  tracksUnsubscribe = onSnapshot(
    collection(db, "soundtracks", soundtrackId, "tracks"),
    (snap) => {
      if (!listEl) return;
      if (snap.empty) {
        listEl.innerHTML = `<p class="loading-text">No tracks yet. Add one below.</p>`;
        return;
      }
      const rows = [];
      snap.forEach((d) => {
        const t = d.data();
        const icon = t.type === "youtube" ? "smart_display" : "audio_file";
        rows.push(`
          <div class="badge-manager-row">
            <span class="material-symbols-outlined" style="color:var(--accent-purple);">${icon}</span>
            <div class="badge-manager-row-info">
              <span class="badge-manager-row-meta">${
                t.name || (t.type === "youtube" ? "YouTube Track" : "Audio Track")
              }</span>
            </div>
            <button type="button" class="badge-manager-delete-btn" data-remove-track="${
              d.id
            }" title="Remove">
              <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
            </button>
          </div>
        `);
      });
      listEl.innerHTML = rows.join("");
      listEl.querySelectorAll("[data-remove-track]").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await deleteDoc(
              doc(db, "soundtracks", soundtrackId, "tracks", btn.getAttribute("data-remove-track"))
            );
          } catch (err) {
            alert("Error removing track: " + err.message);
          }
        };
      });
    }
  );
}

function bindSoundtrackEditor() {
  const modal = document.getElementById("sharedSoundtrackEditorModal");
  const closeBtn = document.getElementById("sharedCloseSoundtrackEditorModal");
  const saveNameBtn = document.getElementById("sharedSaveSoundtrackNameBtn");
  const fileDropzone = document.getElementById("sharedTrackFileDropzone");
  const fileInput = document.getElementById("sharedTrackFileInput");
  const ytInput = document.getElementById("sharedTrackYoutubeInput");
  const addYtBtn = document.getElementById("sharedAddYoutubeTrackBtn");

  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
      if (tracksUnsubscribe) {
        tracksUnsubscribe();
        tracksUnsubscribe = null;
      }
      loadMySoundtracks();
    });
  }

  if (saveNameBtn) {
    saveNameBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("sharedSoundtrackNameInput");
      const name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        alert("Please enter a name.");
        return;
      }
      if (!auth.currentUser) {
        alert("Please log in.");
        return;
      }

      try {
        if (editingSoundtrackId) {
          await updateDoc(doc(db, "soundtracks", editingSoundtrackId), { name });
          const cached = mySoundtracks.find((s) => s.id === editingSoundtrackId);
          if (cached) cached.name = name;
          alert("Name updated!");
        } else {
          if (mySoundtracks.length >= 3) {
            alert("You can only have up to 3 soundtracks.");
            return;
          }
          const newDoc = await addDoc(collection(db, "soundtracks"), {
            name,
            ownerId: auth.currentUser.uid,
            createdAt: new Date(),
          });
          editingSoundtrackId = newDoc.id;
          mySoundtracks.push({ id: newDoc.id, name, ownerId: auth.currentUser.uid });

          const title = document.getElementById("sharedSoundtrackEditorTitle");
          const tracksSection = document.getElementById("sharedSoundtrackTracksSection");
          if (title) title.innerText = "Edit Soundtrack";
          if (tracksSection) tracksSection.style.display = "block";
          listenForTracks(newDoc.id);
        }
      } catch (err) {
        alert("Error saving: " + err.message);
      }
    });
  }

  if (fileDropzone && fileInput) {
    fileDropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) handleTrackFile(file);
      fileInput.value = "";
    });
    ["dragenter", "dragover"].forEach((evt) => {
      fileDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        fileDropzone.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      fileDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        fileDropzone.classList.remove("drag-over");
      });
    });
    fileDropzone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) handleTrackFile(file);
    });
  }

  if (addYtBtn) {
    addYtBtn.addEventListener("click", async () => {
      const url = ytInput ? ytInput.value.trim() : "";
      if (!url) return;
      const videoId = extractYoutubeId(url);
      if (!videoId) {
        alert("Couldn't find a valid YouTube video in that link.");
        return;
      }
      if (!editingSoundtrackId) {
        alert("Save the soundtrack name first.");
        return;
      }
      try {
        await addDoc(collection(db, "soundtracks", editingSoundtrackId, "tracks"), {
          type: "youtube",
          youtubeId: videoId,
          name: "YouTube Track",
          addedAt: new Date(),
        });
        if (ytInput) ytInput.value = "";
      } catch (err) {
        alert("Error adding track: " + err.message);
      }
    });
  }
}

function extractYoutubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function handleTrackFile(file) {
  if (!file.type.startsWith("audio/")) {
    alert("Please choose an audio file.");
    return;
  }
  const MAX_BYTES = 800 * 1024;
  if (file.size > MAX_BYTES) {
    alert(
      `Audio file is too large (${(file.size / 1024).toFixed(
        0
      )} KB). Please use a file under 800 KB — short clips or heavily compressed audio work best.`
    );
    return;
  }
  if (!editingSoundtrackId) {
    alert("Save the soundtrack name first.");
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    await addDoc(collection(db, "soundtracks", editingSoundtrackId, "tracks"), {
      type: "file",
      data: base64,
      name: file.name,
      addedAt: new Date(),
    });
  } catch (err) {
    alert("Error adding track: " + err.message);
  }
}

// =============================================================================
//  BACKGROUND MUSIC — playback engine
//  Builds a shuffled queue from the active soundtrack's tracks, plays them
//  back to back, and reshuffles + loops forever once the queue is exhausted.
// =============================================================================
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startPlaybackForSoundtrack(soundtrackId) {
  stopPlayback();
  if (!soundtrackId) return;
  try {
    const tracksSnap = await getDocs(collection(db, "soundtracks", soundtrackId, "tracks"));
    const tracks = [];
    tracksSnap.forEach((d) => tracks.push({ id: d.id, ...d.data() }));
    if (tracks.length === 0) return;
    currentPlaylist = shuffleArray(tracks);
    currentTrackIndex = -1;
    playNextTrack();
  } catch (err) {
    console.error("Could not load soundtrack tracks:", err);
  }
}

function stopPlayback() {
  if (bgAudioEl) {
    bgAudioEl.pause();
    bgAudioEl.removeAttribute("src");
  }
  if (ytPlayer && ytPlayer.stopVideo) {
    try {
      ytPlayer.stopVideo();
    } catch {
      /* player may not be ready yet — safe to ignore */
    }
  }
  currentPlaylist = [];
  currentTrackIndex = -1;
}

function playNextTrack() {
  if (!musicEnabled || currentPlaylist.length === 0) return;
  currentTrackIndex++;
  if (currentTrackIndex >= currentPlaylist.length) {
    // Reached the end — reshuffle and loop forever.
    currentPlaylist = shuffleArray(currentPlaylist);
    currentTrackIndex = 0;
  }
  playTrack(currentPlaylist[currentTrackIndex]);
}

function playTrack(track) {
  if (track.type === "youtube") {
    playYoutubeTrack(track.youtubeId);
  } else {
    playFileTrack(track.data);
  }
}

function playFileTrack(dataUrl) {
  if (!bgAudioEl) bgAudioEl = document.getElementById("sharedBgAudioPlayer");
  if (!bgAudioEl || !dataUrl) return;

  if (ytPlayer && ytPlayer.pauseVideo) {
    try {
      ytPlayer.pauseVideo();
    } catch {
      /* ignore */
    }
  }

  bgAudioEl.src = dataUrl;
  bgAudioEl.volume = musicVolume / 100;
  bgAudioEl.play().catch((err) => {
    console.warn("Background music autoplay was blocked:", err.message);
    setupAutoplayUnlock();
  });
}

function playYoutubeTrack(videoId) {
  if (!videoId) return;
  if (bgAudioEl) bgAudioEl.pause();

  loadYoutubeApi(() => {
    if (!ytPlayer) {
      ytPlayer = new window.YT.Player("sharedYtPlayerContainer", {
        height: "0",
        width: "0",
        videoId,
        playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
        events: {
          onReady: (e) => {
            e.target.setVolume(musicVolume);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.ENDED) playNextTrack();
          },
        },
      });
    } else {
      ytPlayer.loadVideoById(videoId);
      ytPlayer.setVolume(musicVolume);
    }
  });
}

function loadYoutubeApi(callback) {
  if (ytApiReady && window.YT && window.YT.Player) {
    callback();
    return;
  }
  const prevReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    if (typeof prevReady === "function") prevReady();
    callback();
  };
  if (!ytApiLoading) {
    ytApiLoading = true;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }
}

// Browsers block audio playback that isn't triggered by user interaction.
// If that happens, quietly wait for the first click anywhere on the page
// and resume playback then, rather than failing silently forever.
function setupAutoplayUnlock() {
  const unlock = () => {
    if (bgAudioEl && bgAudioEl.paused && bgAudioEl.src) {
      bgAudioEl.play().catch(() => {});
    }
    document.removeEventListener("click", unlock);
  };
  document.addEventListener("click", unlock, { once: true });
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
        currentUserDataFull = d;
        currentUserProfile.displayName =
          d.displayName || user.email.split("@")[0];
        currentUserProfile.photoUrl = d.photoUrl || "";
      } else {
        currentUserDataFull = null;
        currentUserProfile.displayName = user.email.split("@")[0];
        currentUserProfile.photoUrl = "";
      }
    } catch {
      currentUserDataFull = null;
      currentUserProfile.displayName = user.email.split("@")[0];
      currentUserProfile.photoUrl = "";
    }
    await waitForRoles();
    sharedMyPermissions = computePermissions(user, currentUserDataFull);
    applyProfileEditRestrictions();
    updateNavAvatar();
  } else {
    currentUserProfile = { displayName: "", photoUrl: "" };
    currentUserDataFull = null;
    sharedMyPermissions = computePermissions(null, null);
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
  applyChatbotRestriction();
  bindMusicSettings();
  bindSoundtrackManager();
  bindSoundtrackEditor();
  initMusicPrefs();
});

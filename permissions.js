// =============================================================================
//  permissions.js — ShareNet Custom Roles & Permissions Module
//  Shared by members.js, groups.js, profile.js (and anywhere else that needs
//  to know what the current — or any other — user is allowed to do).
//
//  Data model:
//    roles/{roleId}        → { name, permissions: { <key>: bool, ... },
//                               createdAt, createdBy }
//    users/{uid}.roleId    → id of the custom role assigned to that user
//                             (or missing/null if they have none)
//    users/{uid}.role      → LEGACY field, "admin" | "member". Kept for
//                             backwards compatibility — accounts already
//                             marked "admin" keep full permissions forever.
//
//  The site owner (SITE_ADMIN_EMAIL) always has every permission and this
//  can never be revoked through the UI.
// =============================================================================

import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  initializeFirestore,
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFKAnb3hipbmCFOujKIpdh3jbp18RFGlE",
  authDomain: "sharenet-reimagined.firebaseapp.com",
  projectId: "sharenet-reimagined",
  storageBucket: "sharenet-reimagined.firebasestorage.app",
  messagingSenderId: "28034797053",
  appId: "1:28034797053:web:1c448f7fa2ad3ae5cbdd94",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Safari (and some privacy-focused browsers/extensions) block Firestore's
// default fetch-streaming transport with an "access control checks" fetch
// error, which breaks every realtime listener on the page. Forcing
// long-polling avoids that entirely and works everywhere. If some other
// script on this page already initialized Firestore first, fall back to
// the existing instance instead of throwing.
let permissionsDb;
try {
  permissionsDb = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
  });
} catch (e) {
  permissionsDb = getFirestore(app);
}
export { permissionsDb };

export const SITE_ADMIN_EMAIL = "ogheneovieumebese@gmail.com";

// The full permission catalog — order here drives the order checkboxes
// render in the Create/Edit Role UI.
//
// GRANT permissions: things members *cannot* do by default. A role only
// adds ability by checking these on — unchecked (the default) grants
// nothing extra.
export const GRANT_PERMISSION_DEFS = [
  { key: "makeRoles", label: "Making Roles", hint: "Create new custom roles." },
  { key: "assignRoles", label: "Assigning Roles", hint: "Give roles to other members." },
  { key: "deleteRoles", label: "Deleting Roles", hint: "Remove existing roles." },
  { key: "makeBadges", label: "Making Badges", hint: "Create new profile badges." },
  { key: "assignBadges", label: "Assigning Badges", hint: "Award or revoke badges on members." },
  { key: "deleteBadges", label: "Deleting Badges", hint: "Permanently remove badges." },
  { key: "deleteContent", label: "Deleting Other User Content", hint: "Remove posts, comments, and groups made by others." },
  { key: "manageGroupRequests", label: "Managing Group Requests", hint: "View and approve/decline new group requests." },
  { key: "removeAccounts", label: "Removing Accounts", hint: "Delete other members' accounts." },
  { key: "editGroups", label: "Editing Groups", hint: "Edit the name/icon of existing groups." },
];

// RESTRICTION permissions: baseline abilities every member has by
// default. A role only takes ability *away* by unchecking these —
// checked (the default) leaves the member's normal ability intact.
export const RESTRICTION_PERMISSION_DEFS = [
  { key: "canPost", label: "Post", hint: "Create new posts." },
  { key: "canView", label: "View Posts/Comments", hint: "See posts and comments across the site." },
  { key: "canComment", label: "Comment", hint: "Leave comments on posts." },
  { key: "canJoinGroups", label: "Join Groups", hint: "Join public groups / request to join private ones." },
  { key: "canRequestGroups", label: "Request to Make Groups", hint: "Submit new group creation requests." },
  { key: "canManageOwnGroups", label: "Manage Own Groups", hint: "Edit or delete groups they created." },
  { key: "canDeleteOwnAccount", label: "Delete Own Account", hint: "Remove their own account." },
  { key: "canUseMessenger", label: "Use Messenger", hint: "Send and receive direct messages." },
  { key: "canDisplayBadges", label: "Have Badges Displayed", hint: "Show earned badges on their account." },
  { key: "canChangeDisplayName", label: "Change Display Name", hint: "Edit their profile display name." },
  { key: "canHaveProfilePicture", label: "Have a Profile Picture", hint: "Set/change their profile picture." },
  { key: "canViewNotifications", label: "View Notifications", hint: "See the site activity/notifications feed." },
  { key: "canViewMembers", label: "View Members Page", hint: "See the community members directory." },
  { key: "canUseAssistant", label: "Use ShareNet Assistant", hint: "Chat with the ShareNet AI assistant." },
  { key: "canEditOwnPosts", label: "Edit Own Posts", hint: "Edit posts after publishing them." },
  { key: "canReactToPosts", label: "React to Posts", hint: "Add emoji reactions to posts." },
];

// Combined list — handy for anything that just needs every known key
// (e.g. building a full default-permissions object for a brand new role).
export const PERMISSION_DEFS = [...GRANT_PERMISSION_DEFS, ...RESTRICTION_PERMISSION_DEFS];

export const EMPTY_GRANT_PERMISSIONS = Object.fromEntries(
  GRANT_PERMISSION_DEFS.map((p) => [p.key, false])
);
export const ALL_GRANT_PERMISSIONS = Object.fromEntries(
  GRANT_PERMISSION_DEFS.map((p) => [p.key, true])
);
export const FULL_RESTRICTION_PERMISSIONS = Object.fromEntries(
  RESTRICTION_PERMISSION_DEFS.map((p) => [p.key, true])
);

// Legacy aliases some callers still import.
export const EMPTY_PERMISSIONS = { ...EMPTY_GRANT_PERMISSIONS, ...FULL_RESTRICTION_PERMISSIONS };
export const ALL_PERMISSIONS = { ...ALL_GRANT_PERMISSIONS, ...FULL_RESTRICTION_PERMISSIONS };

// ── Live roles cache — a single onSnapshot listener shared by every page
//    that imports this module ──────────────────────────────────────────────
let rolesCache = {};
let rolesReady = false;
let rolesReadyWaiters = [];
const rolesUpdateListeners = new Set();

onSnapshot(collection(permissionsDb, "roles"), (snapshot) => {
  const updated = {};
  snapshot.forEach((d) => {
    updated[d.id] = { id: d.id, ...d.data() };
  });
  rolesCache = updated;
  rolesReady = true;
  rolesReadyWaiters.forEach((resolve) => resolve());
  rolesReadyWaiters = [];
  rolesUpdateListeners.forEach((cb) => {
    try {
      cb(rolesCache);
    } catch (e) {
      console.error("permissions.js role listener error:", e);
    }
  });
});

export function getRolesCache() {
  return rolesCache;
}

export function onRolesUpdated(callback) {
  rolesUpdateListeners.add(callback);
  return () => rolesUpdateListeners.delete(callback);
}

export function waitForRoles() {
  if (rolesReady) return Promise.resolve();
  return new Promise((resolve) => rolesReadyWaiters.push(resolve));
}

// ── Core permission computation ─────────────────────────────────────────────
// authUser: the Firebase Auth `user` object (or null)
// userData: that person's Firestore users/{uid} doc data (or null)
//
// Semantics:
//  - GRANT permissions default to false. A role only ever turns them ON.
//  - RESTRICTION permissions default to true (normal member ability). A
//    role only ever turns them OFF — an explicit `false` in the role's
//    permissions map overrides the default and restricts that member.
//    A key that's simply absent from the role doc (e.g. an older role
//    created before this permission existed) is treated as `true`
//    (not restricted), so nothing is retroactively locked down.
export function computePermissions(authUser, userData) {
  const isOwner = !!authUser && authUser.email === SITE_ADMIN_EMAIL;
  const isLegacyAdmin = !!userData && userData.role === "admin";

  let roleId = (userData && userData.roleId) || null;
  let roleName = null;
  const permissions = { ...EMPTY_GRANT_PERMISSIONS, ...FULL_RESTRICTION_PERMISSIONS };

  if (isOwner || isLegacyAdmin) {
    Object.assign(permissions, ALL_GRANT_PERMISSIONS, FULL_RESTRICTION_PERMISSIONS);
    roleName = isOwner ? "Site Owner" : "Admin";
  } else if (roleId && rolesCache[roleId]) {
    const rolePerms = rolesCache[roleId].permissions || {};

    GRANT_PERMISSION_DEFS.forEach((p) => {
      permissions[p.key] = !!rolePerms[p.key];
    });
    RESTRICTION_PERMISSION_DEFS.forEach((p) => {
      permissions[p.key] = rolePerms[p.key] === false ? false : true;
    });

    roleName = rolesCache[roleId].name || null;
  } else {
    roleId = null;
  }

  const hasAnyPermission = GRANT_PERMISSION_DEFS.some((p) => permissions[p.key]);
  const hasAnyRestriction = RESTRICTION_PERMISSION_DEFS.some((p) => !permissions[p.key]);

  return {
    isOwner,
    isLegacyAdmin,
    roleId,
    roleName,
    permissions,
    hasAnyPermission,
    hasAnyRestriction,
  };
}

export function hasPermission(authUser, userData, key) {
  return computePermissions(authUser, userData).permissions[key] === true;
}

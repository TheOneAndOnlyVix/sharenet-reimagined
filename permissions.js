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
export const permissionsDb = getFirestore(app);

export const SITE_ADMIN_EMAIL = "ogheneovieumebese@gmail.com";

// The full permission catalog — order here drives the order checkboxes
// render in the Create/Edit Role UI.
export const PERMISSION_DEFS = [
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

export const EMPTY_PERMISSIONS = Object.fromEntries(
  PERMISSION_DEFS.map((p) => [p.key, false])
);

export const ALL_PERMISSIONS = Object.fromEntries(
  PERMISSION_DEFS.map((p) => [p.key, true])
);

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
export function computePermissions(authUser, userData) {
  const isOwner = !!authUser && authUser.email === SITE_ADMIN_EMAIL;
  const isLegacyAdmin = !!userData && userData.role === "admin";

  let roleId = (userData && userData.roleId) || null;
  let roleName = null;
  const permissions = { ...EMPTY_PERMISSIONS };

  if (isOwner || isLegacyAdmin) {
    Object.assign(permissions, ALL_PERMISSIONS);
    roleName = isOwner ? "Site Owner" : "Admin";
  } else if (roleId && rolesCache[roleId]) {
    const rolePerms = rolesCache[roleId].permissions || {};
    Object.keys(permissions).forEach((k) => {
      if (rolePerms[k]) permissions[k] = true;
    });
    roleName = rolesCache[roleId].name || null;
  } else {
    roleId = null;
  }

  const hasAnyPermission = Object.values(permissions).some(Boolean);

  return { isOwner, isLegacyAdmin, roleId, roleName, permissions, hasAnyPermission };
}

export function hasPermission(authUser, userData, key) {
  return computePermissions(authUser, userData).permissions[key] === true;
}

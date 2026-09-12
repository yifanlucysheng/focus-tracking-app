import { getFirebaseAuth, getFirebaseDb } from "./firebaseClient.js";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

const usernameCache = new Map();
/** @type {Array<() => void>} */
let unsubs = [];
const watchingChats = new Set();

function clearUnsubs() {
  unsubs.forEach((fn) => {
    try {
      fn();
    } catch {
      // Already gone.
    }
  });
  unsubs = [];
  watchingChats.clear();
}

async function usernameFor(uid) {
  if (usernameCache.has(uid)) return usernameCache.get(uid);
  try {
    const snap = await getDoc(doc(getFirebaseDb(), "users", uid));
    const name = snap.exists() ? String(snap.data().username || "friend") : "friend";
    usernameCache.set(uid, name);
    return name;
  } catch {
    return "friend";
  }
}

function emitAdded(uid, change, onBubble) {
  if (change.type !== "added") return;
  const data = change.doc.data() || {};
  if (data.fromUid === uid) return;
  const text = String(data.text || "").trim();
  if (!text) return;
  void usernameFor(data.fromUid).then((fromUsername) => {
    onBubble({
      fromUid: data.fromUid,
      fromUsername,
      text,
      messageId: change.doc.id,
    });
  });
}

function watchMessages(uid, chatId, onBubble) {
  if (watchingChats.has(chatId)) return;
  watchingChats.add(chatId);
  const messages = query(
    collection(getFirebaseDb(), "chats", chatId, "messages"),
    orderBy("createdAt", "asc")
  );
  let primed = false;
  const unsub = onSnapshot(messages, (snap) => {
    if (!primed) {
      primed = true;
      const cutoff = Date.now() - 8000;
      snap.docs.forEach((item) => {
        const data = item.data() || {};
        if (data.fromUid === uid) return;
        if (Number(data.createdAt) < cutoff) return;
        const text = String(data.text || "").trim();
        if (!text) return;
        void usernameFor(data.fromUid).then((fromUsername) => {
          onBubble({
            fromUid: data.fromUid,
            fromUsername,
            text,
            messageId: item.id,
          });
        });
      });
      return;
    }
    snap.docChanges().forEach((change) => emitAdded(uid, change, onBubble));
  });
  unsubs.push(unsub);
}

/**
 * @param {(payload: { fromUid: string, fromUsername: string, text: string, messageId: string }) => void} onBubble
 * @returns {() => void}
 */
export function startIncomingChatWatch(onBubble) {
  let auth;
  try {
    auth = getFirebaseAuth();
  } catch {
    return () => {};
  }

  const unsubAuth = onAuthStateChanged(auth, (user) => {
    clearUnsubs();
    if (!user) return;
    const uid = user.uid;
    const chatsQuery = query(
      collection(getFirebaseDb(), "chats"),
      where("members", "array-contains", uid)
    );
    const unsubChats = onSnapshot(chatsQuery, (snap) => {
      snap.docs.forEach((item) => watchMessages(uid, item.id, onBubble));
    });
    unsubs.push(unsubChats);
  });
  unsubs.push(unsubAuth);

  return () => {
    unsubAuth();
    clearUnsubs();
  };
}

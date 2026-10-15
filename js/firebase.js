// ===== FIREBASE CONFIG & INIT =====
// NOTE: This file exposes Firebase config. For production, move apiKey to environment variable
// and use a backend proxy for sensitive operations.
const firebaseConfig = {
  apiKey: "AIzaSyAnRpA__mbCYfUW6z_h_agGdU96DmpkIpU",
  authDomain: "quan-ly-ban-hang-aba9c.firebaseapp.com",
  databaseURL: "https://quan-ly-ban-hang-aba9c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "quan-ly-ban-hang-aba9c",
  storageBucket: "quan-ly-ban-hang-aba9c.firebasestorage.app",
  messagingSenderId: "286311813480",
  appId: "1:286311813480:web:ca9d58c35391c5bc3e86dd",
  measurementId: "G-J5RR51VWXN"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, getDocs, deleteDoc, writeBatch, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const _app = initializeApp(firebaseConfig);
const _auth = getAuth(_app);
const _db = getFirestore(_app);
const _provider = new GoogleAuthProvider();
let _storage = null;
try { _storage = getStorage(_app); } catch(e) { console.warn('Storage init lỗi', e); }

window.fb = {
  auth: _auth,
  db: _db,
  provider: _provider,
  storage: _storage,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  getDocs,
  deleteDoc,
  writeBatch,
  query,
  where,
  updateDoc,
  storageRef,
  uploadString,
  getDownloadURL,
  deleteObject
};

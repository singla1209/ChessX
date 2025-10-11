
 // 1) Imports (ES modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, sendSignInLinkToEmail, isSignInWithEmailLink,
  signInWithEmailLink, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot,
  serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// 2) Firebase config (exact values from Console)
const firebaseConfig = {
   apiKey: "AIzaSyAh7spDeQk7nG0qzrXf2iA6vK2A2Cztyng",
  authDomain: "chessx-c94e2.firebaseapp.com",
  projectId: "chessx-c94e2",
  storageBucket: "chessx-c94e2.firebasestorage.app",
  messagingSenderId: "881392331293",
  appId: "1:881392331293:web:39c747febf59e9321b34f4",
  measurementId: "G-J4V0NH3HC8"
};

// 3) Initialize SDKs
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const urlEl = document.getElementById('game-url');
function setGameUrl(u){
  if (!urlEl) return;
  if (u) { urlEl.textContent = u; urlEl.style.display = 'inline'; }
  else { urlEl.textContent = ''; urlEl.style.display = 'none'; }
}
// hide initially
setGameUrl('');

// 4) Build return URL ONCE (GitHub Pages friendly)
const returnUrl = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
const actionCodeSettings = { url: returnUrl, handleCodeInApp: true };

// 5) Panels and auth state UI toggle
const authPanel = document.getElementById('auth-panel');
const gamePanel = document.getElementById('game-panel');
onAuthStateChanged(auth, (user) => {
  const signedIn = !!user;
  if (authPanel && gamePanel) {
    authPanel.style.display = signedIn ? 'none' : 'block';
    gamePanel.style.display = signedIn ? 'block' : 'none';
  }
});

// 6) Email link handlers (Send / Complete)
const sendBtn = document.getElementById('send-link');
const completeBtn = document.getElementById('complete-link');
const emailInput = document.getElementById('email');

sendBtn?.addEventListener('click', async () => {
  try {
    const email = emailInput.value.trim();
    if(!email) return alert('Enter email');
    localStorage.setItem('emailForSignIn', email);
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    alert('Sign-in link sent');
  } catch (e) {
    console.error('sendSignInLinkToEmail failed:', e);
    alert(e?.code || e?.message || 'Failed to send link');
  }
});

completeBtn?.addEventListener('click', async () => {
  if (isSignInWithEmailLink(auth, window.location.href)) {
    let email = localStorage.getItem('emailForSignIn');
    if (!email) email = prompt('Confirm email for sign-in');
    await signInWithEmailLink(auth, email, window.location.href);
    localStorage.removeItem('emailForSignIn');
    alert('Signed in');
  } else {
    alert('No email link detected');
  }
});




  // 4) Game creation / join + real-time sync
  const createBtn = document.getElementById('create-game');
  const joinBtn = document.getElementById('join-game');
  const joinId = document.getElementById('join-id');
  const gameUrlEl = document.getElementById('game-url');

  let gameRef = null;
  let unsub = null;
  let selfUid = null;

  // helper: auth state
  auth.onAuthStateChanged(u => { selfUid = u ? u.uid : null; });

  // Replace these with the app’s board state functions/variables
  // board: array[64], whiteToMove: boolean, render(): re-draw board
  // movePiece(from, to): already updates board & toggles turn locally

  async function createGame() {
    if(!selfUid) return alert('Sign in first');
    const id = crypto.randomUUID();
    gameRef = doc(db, 'games', id);

    // Initial payload: include minimal state needed to reconstruct the board
    const payload = {
      createdAt: serverTimestamp(),
      ownerUid: selfUid,
      players: { white: selfUid, black: null },
      turn: 'white',
      board, // assumes global board array exists
      lastMove: null,
      lastUpdateBy: selfUid,
      status: 'waiting'
    };
    await setDoc(gameRef, payload);
    startSync(id);
    const url = `${returnUrl}?game=${id}`;
    gameUrlEl.textContent = url;
    // Optional: auto-open email client with invite
    // location.href = `mailto:?subject=Chess%20Invite&body=Join:%20${encodeURIComponent(url)}`;
  }

  async function joinGame(rawId) {
  const id = (rawId || new URLSearchParams(location.search).get('game') || '').trim();
  if (!id) return alert('Enter Game ID or open the invite link');

  try {
    gameRef = doc(db, 'games', id);
    const snap = await getDoc(gameRef);
    if (!snap.exists()) {
      alert('Game not found');
      return;
    }
    const data = snap.data();

    // Claim black seat if free
    if (selfUid && (!data.players?.black || data.players.black === selfUid)) {
      await updateDoc(gameRef, { 'players.black': selfUid, status: 'live' });
    }

    startSync(id);
    setGameUrl(`${returnUrl}?game=${id}`);
    alert('Joined game');
  } catch (e) {
    console.error('joinGame error:', e);
    alert(e?.code || e?.message || 'Join failed');
  }
}


  function startSync(id) {
    // Stop previous listener
    if(unsub) unsub();
    gameRef = doc(db, 'games', id);
    unsub = onSnapshot(gameRef, (snap) => {
      if(!snap.exists()) return;
      const data = snap.data();
      // Ignore echoes of own last write
      if (data.lastUpdateBy && data.lastUpdateBy === selfUid) return;

      // Apply remote state to local game
      if(Array.isArray(data.board)) {
        board = data.board.slice();
      }
      whiteToMove = (data.turn === 'white');
      // Optionally show lastMove etc.
      render();
    });
  }

  // Call this inside local move handler after updating local board/turn
  async function pushMove(from, to) {
    if(!gameRef) return;
    const payload = {
      board, // current board after local move
      turn: whiteToMove ? 'white' : 'black',
      lastMove: { from, to, at: Date.now() },
      lastUpdateBy: selfUid
    };
    await updateDoc(gameRef, payload);
  }

  // Example: wrap the existing move function to also push to Firestore
  const originalMovePiece = window.movePiece;
  window.movePiece = function(from, to){
    originalMovePiece(from, to);   // performs local move and sounds/status
    pushMove(from, to);            // sync to Firestore
  };

  // Wire buttons
  createBtn.addEventListener('click', createGame);
  joinBtn.addEventListener('click', () => {
    const id = new URLSearchParams(location.search).get('game') || joinId.value.trim();
    if(!id) return alert('Enter Game ID or open link with ?game=');
    joinGame(id);
  });

  // Auto-join if ?game=ID present
  const qsGame = new URLSearchParams(location.search).get('game');
  if(qsGame) joinGame(qsGame);








// firebase.js (module)
// IMPORTANT: Replace firebaseConfig with your project's config
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  projectId: "REPLACE_ME",
  // ... fill the rest
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// UI elements
const authPanel = document.getElementById('auth-panel');
const emailInput = document.getElementById('email');
const sendLinkBtn = document.getElementById('send-link');
const completeLinkBtn = document.getElementById('complete-link');
const signedAs = document.getElementById('signed-as');
const presenceStatus = document.getElementById('presence-status');

const playersPanel = document.getElementById('players-panel');
const playersListEl = document.getElementById('players-list');

const requestsPanel = document.getElementById('requests-panel');
const incomingRequestsEl = document.getElementById('incoming-requests');

const gamePanel = document.getElementById('game-panel');
const notSigned = document.getElementById('not-signed');

const createGameBtn = document.getElementById('create-game');
const joinIdInput = document.getElementById('join-id');
const joinGameBtn = document.getElementById('join-game');
const gameUrlSpan = document.getElementById('game-url');
const currentGameIdEl = document.getElementById('current-game-id');
const myColourEl = document.getElementById('my-colour');
const leaveGameBtn = document.getElementById('leave-game');

let currentUser = null;
let userUnsubPresence = null;
let playersUnsub = null;
let requestsUnsub = null;
let gameUnsub = null;
let currentGameRef = null;

// EMAIL LINK: send link
sendLinkBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if(!email) return alert('Enter email');
  const actionCodeSettings = {
    // The URL you want to redirect to after email link click (your site)
    url: window.location.href,
    handleCodeInApp: true
  };
  try{
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
    alert('Sent sign-in link to ' + email + '. Check your inbox.');
  }catch(err){
    console.error(err);
    alert('Error sending link: ' + err.message);
  }
});

// EMAIL LINK: complete
completeLinkBtn.addEventListener('click', async () => {
  try{
    if(isSignInWithEmailLink(auth, window.location.href)){
      let email = window.localStorage.getItem('emailForSignIn');
      if(!email) email = prompt('Please provide your email for confirmation');
      await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
    } else {
      alert('No sign-in link detected in URL. Click the link from your email first.');
    }
  }catch(err){
    console.error(err);
    alert('Sign-in failed: ' + err.message);
  }
});

// AUTH state listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    signedAs.textContent = `Signed in as ${user.email}`;
    presenceStatus.textContent = 'Signing you in...';
    authPanel.style.display = 'block';
    playersPanel.style.display = 'block';
    requestsPanel.style.display = 'block';
    gamePanel.style.display = 'block';
    notSigned.style.display = 'none';
    // ensure user doc exists and mark online
    await setDoc(doc(db,'users',user.uid), {
      email: user.email,
      online: true,
      lastActive: serverTimestamp(),
      currentGameId: null
    }, { merge: true });

    presenceStatus.textContent = 'Online';
    // start listeners
    startPlayersListener();
    startIncomingRequestsListener();
    // mark offline on unload
    window.addEventListener('beforeunload', handleDisconnect);
  } else {
    signedAs.textContent = '';
    presenceStatus.textContent = 'Not signed in';
    playersPanel.style.display = 'none';
    requestsPanel.style.display = 'none';
    gamePanel.style.display = 'none';
    notSigned.style.display = 'block';

    // unsubscribe listeners
    if(playersUnsub) playersUnsub();
    if(requestsUnsub) requestsUnsub();
    if(gameUnsub) gameUnsub();
  }
});

// when leaving page
async function handleDisconnect(){
  if(currentUser){
    try{
      await setDoc(doc(db,'users',currentUser.uid), { online:false, lastActive: serverTimestamp() }, { merge:true });
    }catch(e){ console.warn('disconnect failed', e) }
  }
}

// PLAYER LIST (show online players)
function startPlayersListener(){
  if(playersUnsub) playersUnsub();
  const q = query(collection(db,'users'), where('online','==',true));
  playersUnsub = onSnapshot(q, snapshot => {
    playersListEl.innerHTML = '';
    let any = false;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if(docSnap.id === currentUser.uid) return;
      any = true;
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<div>${data.email || docSnap.id}</div>`;
      const btn = document.createElement('button');
      btn.className = 'small-btn';
      btn.textContent = 'Challenge';
      btn.onclick = () => sendChallenge(docSnap.id, data.email || 'Opponent');
      row.appendChild(btn);
      playersListEl.appendChild(row);
    });
    if(!any) playersListEl.innerHTML = '<div class="muted">No other players online</div>';
  });
}

// SEND CHALLENGE (creates request doc)
async function sendChallenge(targetUid, targetEmail){
  if(!currentUser) return alert('Sign in first');
  const req = {
    from: currentUser.uid,
    to: targetUid,
    fromEmail: currentUser.email || '',
    createdAt: serverTimestamp(),
    status: 'pending'
  };
  try{
    const d = await addDoc(collection(db,'requests'), req);
    alert('Challenge sent!');
  }catch(err){
    console.error(err);
    alert('Failed to send challenge: ' + err.message);
  }
}

// LISTEN FOR INCOMING REQUESTS
function startIncomingRequestsListener(){
  if(requestsUnsub) requestsUnsub();
  const q = query(collection(db,'requests'), where('to','==', currentUser.uid));
  requestsUnsub = onSnapshot(q, snap => {
    incomingRequestsEl.innerHTML = '';
    let any = false;
    snap.forEach(docSnap => {
      const r = docSnap.data();
      if(r.status !== 'pending') return;
      any = true;
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<div><strong>${r.fromEmail || r.from}</strong></div>`;
      const accept = document.createElement('button');
      accept.className = 'small-btn';
      accept.textContent = 'Accept';
      accept.onclick = () => acceptRequest(docSnap.id, r);
      const reject = document.createElement('button');
      reject.className = 'small-btn';
      reject.textContent = 'Reject';
      reject.onclick = () => rejectRequest(docSnap.id);
      row.appendChild(accept);
      row.appendChild(reject);
      incomingRequestsEl.appendChild(row);
    });
    if(!any) incomingRequestsEl.innerHTML = '<div class="muted">No requests</div>';
  });
}

// accept: create game and update request + users
async function acceptRequest(requestId, requestData){
  try{
    // create game doc
    const initialBoard = window.board || [
      'r','n','b','q','k','b','n','r',
      'p','p','p','p','p','p','p','p',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      'P','P','P','P','P','P','P','P',
      'R','N','B','Q','K','B','N','R'
    ];
    const game = {
      playerWhite: requestData.from, // challenger will be white
      playerBlack: requestData.to,
      board: initialBoard,
      turnWhite: true,
      status: 'active',
      createdAt: serverTimestamp()
    };
    const gameRef = await addDoc(collection(db,'games'), game);

    // mark request accepted and save gameId
    await updateDoc(doc(db,'requests',requestId), { status:'accepted', gameId: gameRef.id });
    // update users currentGameId
    await updateDoc(doc(db,'users',requestData.from), { currentGameId: gameRef.id });
    await updateDoc(doc(db,'users',requestData.to), { currentGameId: gameRef.id });

    // open game locally
    openGame(gameRef.id);
  }catch(err){
    console.error(err); alert('Accept failed: ' + err.message);
  }
}

async function rejectRequest(requestId){
  try{
    await updateDoc(doc(db,'requests',requestId), { status:'rejected' });
  }catch(e){ console.warn(e); }
}

// CREATE GAME (manually by user)
createGameBtn.addEventListener('click', async () => {
  if(!currentUser) return alert('Sign in first');
  try{
    const initialBoard = window.board;
    const g = {
      playerWhite: currentUser.uid,
      playerBlack: null,
      board: initialBoard,
      turnWhite: true,
      status: 'waiting',
      createdAt: serverTimestamp()
    };
    const gameRef = await addDoc(collection(db,'games'), g);
    // set currentGameId for creator
    await updateDoc(doc(db,'users',currentUser.uid), { currentGameId: gameRef.id });
    openGame(gameRef.id);
  }catch(err){ console.error(err); alert('Create game failed: ' + err.message); }
});

// JOIN GAME by id input
joinGameBtn.addEventListener('click', async () => {
  const id = joinIdInput.value.trim();
  if(!id) return alert('Enter game id');
  try{
    const gref = doc(db,'games',id);
    const gsnap = await getDoc(gref);
    if(!gsnap.exists()) return alert('Game not found');
    const gd = gsnap.data();
    if(gd.playerBlack && gd.playerWhite && gd.playerBlack !== currentUser.uid && gd.playerWhite !== currentUser.uid){
      return alert('Game already full');
    }
    // if joiner is taking black and playerBlack is null -> set
    if(!gd.playerBlack && gd.playerWhite !== currentUser.uid){
      await updateDoc(gref, { playerBlack: currentUser.uid, status:'active' });
    } else if(!gd.playerWhite && gd.playerBlack !== currentUser.uid){
      await updateDoc(gref, { playerWhite: currentUser.uid, status:'active' });
    }
    // update user's currentGameId
    await updateDoc(doc(db,'users',currentUser.uid), { currentGameId: id });
    openGame(id);
  }catch(err){ console.error(err); alert('Join failed: ' + err.message); }
});

// OPEN GAME: start listening for game doc updates
async function openGame(gameId){
  // unsubscribe previous
  if(gameUnsub) gameUnsub();
  currentGameRef = doc(db,'games',gameId);
  currentGameIdEl.textContent = gameId;
  gameUrlSpan.textContent = `Share this ID: ${gameId}`;
  gamePanel.style.display = 'block';

  // find my colour
  const snapshot = await getDoc(currentGameRef);
  if(snapshot.exists()){
    const g = snapshot.data();
    if(g.playerWhite === currentUser.uid) myColourEl.textContent = 'White';
    else if(g.playerBlack === currentUser.uid) myColourEl.textContent = 'Black';
    else myColourEl.textContent = 'Observer';
    // apply current state to local board
    if(g.board) { window.board = g.board.slice(); window.whiteToMove = !!g.turnWhite; window.render(); }
  }

  // listen live
  gameUnsub = onSnapshot(currentGameRef, docSnap => {
    if(!docSnap.exists()) return;
    const gd = docSnap.data();
    if(gd.board){
      window.board = gd.board.slice();
      window.whiteToMove = !!gd.turnWhite;
      window.render();
    }
    // update UI
    if(gd.playerWhite === currentUser.uid) myColourEl.textContent = 'White';
    else if(gd.playerBlack === currentUser.uid) myColourEl.textContent = 'Black';
    else myColourEl.textContent = 'Observer';
    currentGameIdEl.textContent = docSnap.id;
  });
}

// LEAVE game
leaveGameBtn.addEventListener('click', async () => {
  if(!currentGameRef) return;
  try{
    // clear user's currentGameId
    await updateDoc(doc(db,'users',currentUser.uid), { currentGameId: null });
    if(gameUnsub) { gameUnsub(); gameUnsub = null; }
    currentGameRef = null;
    currentGameIdEl.textContent = '-';
    myColourEl.textContent = '-';
    gamePanel.style.display = 'none';
  }catch(e){ console.warn(e); }
});

// Expose helper so app.js can update the game doc when a move is made
export async function pushMoveToServer(boardArr, turnWhite){
  if(!currentGameRef) return;
  try{
    await updateDoc(currentGameRef, { board: boardArr, turnWhite: !!turnWhite, lastUpdated: serverTimestamp() });
  }catch(e){ console.error('pushMoveToServer failed', e) }
}

// helper to get current game info
export async function getCurrentGameDoc(){
  if(!currentGameRef) return null;
  const g = await getDoc(currentGameRef);
  return g.exists() ? { id: g.id, ...g.data() } : null;
}

// sign out helper (optional)
export async function signOutUser(){
  if(currentUser){
    await updateDoc(doc(db,'users',currentUser.uid), { online:false, lastActive: serverTimestamp(), currentGameId: null });
    await signOut(auth);
  }
}

window.pushMoveToServer = pushMoveToServer;
window.getCurrentGameDoc = getCurrentGameDoc;

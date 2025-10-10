/* app.js (module)
   - Your original chess logic is preserved verbatim at the top.
   - Firebase Realtime DB + Email-link auth multiplayer code follows.
*/

/* ------------------------------
   BEGIN: ORIGINAL CHESS LOGIC (UNCHANGED)
   ------------------------------ */
const boardEl = document.getElementById('chessboard');
const turnEl = document.getElementById('turn');
const statusEl = document.getElementById('status');

// Unicode for display
const PIECES = {
  'r':'♜','n':'♞','b':'♝','q':'♛','k':'♚','p':'♟',
  'R':'♖','N':'♘','B':'♗','Q':'♕','K':'♔','P':'♙'
};

// 0..63 board, initial setup
let board = [
  'r','n','b','q','k','b','n','r',
  'p','p','p','p','p','p','p','p',
  '','','','','','','','',
  '','','','','','','','',
  '','','','','','','','',
  '','','','','','','','',
  'P','P','P','P','P','P','P','P',
  'R','N','B','Q','K','B','N','R'
];


// --------- Sound Manager ---------
const SFX = {
  move: new Audio('sounds/move-self.mp3'),
  capture: new Audio('sounds/capture.mp3'),
  check: new Audio('sounds/check.mp3'),
  gameStart: new Audio('sounds/game-start.mp3'),
  gameEnd: new Audio('sounds/game-end.mp3'),
  illegal: new Audio('sounds/illegal.mp3') // optional
};

// Preload and default volume
let muted = false;
let volume = 0.6;
for (const k in SFX){
  SFX[k].preload = 'auto';
  SFX[k].volume = volume;
}

function setMuted(m){
  muted = m;
  for (const k in SFX) SFX[k].muted = muted;
}
function setVolume(v){
  volume = v;
  for (const k in SFX) SFX[k].volume = volume;
}

function playSfx(name){
  const a = SFX[name];
  if(!a || muted) return;
  try { a.currentTime = 0; a.play(); } catch(e) { /* ignore */ }
}

// Autoplay unlock: call after any user gesture
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
  // Attempt a silent prime to satisfy autoplay policies
  const a = SFX.move;
  const wasMuted = a.muted;
  a.muted = true;
  a.play().then(()=>{
    a.pause();
    a.currentTime = 0;
    a.muted = wasMuted;
    audioUnlocked = true;
    playSfx('gameStart');
  }).catch(()=>{
    // Fallback: mark unlocked after gesture even if play promise rejected
    audioUnlocked = true;
    playSfx('gameStart');
  });
}

// Wire controls
const btnEnable = document.getElementById('enable-audio');
const toggleMute = document.getElementById('mute-toggle');
const vol = document.getElementById('vol');

btnEnable?.addEventListener('click', unlockAudioOnce);
document.addEventListener('pointerdown', unlockAudioOnce, { once: true });

toggleMute?.addEventListener('change', e => setMuted(e.target.checked));
vol?.addEventListener('input', e => setVolume(parseFloat(e.target.value)));


let whiteToMove = true;
let selected = null;
let legalTargets = new Set();
let gameOver = false;

function rc(i){ return [Math.floor(i/8), i%8]; }
function idx(r,c){ return r*8 + c; }
function inB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function isWhite(pc){ return pc && pc === pc.toUpperCase(); }
function isBlack(pc){ return pc && pc === pc.toLowerCase(); }
function sameColor(a,b){ if(!a || !b) return false; return isWhite(a) === isWhite(b); }
function empty(i){ return !board[i]; }
function isKing(pc){ return pc === 'K' || pc === 'k'; }

function render(){
  boardEl.innerHTML = '';
  for(let i=0;i<64;i++){
    const [r,c] = rc(i);
    const sq = document.createElement('div');
    sq.className = 'square ' + (((r+c)&1)===0 ? 'light' : 'dark');
    sq.dataset.index = i;

    if(i === selected) sq.classList.add('selected');

    if(board[i]){
      const piece = document.createElement('div');
      piece.className = 'piece';
      piece.textContent = PIECES[board[i]];
      sq.appendChild(piece);
    }

    if(legalTargets.has(i)){
      const hint = document.createElement('div');
      hint.className = 'hint ' + (board[i] ? 'capture' : 'move');
      sq.appendChild(hint);
    }

    sq.addEventListener('click', onSquareClick);
    boardEl.appendChild(sq);
  }
  turnEl.textContent = 'Turn: ' + (whiteToMove ? 'White' : 'Black');
}

function onSquareClick(e){
  if(gameOver) return;
  const i = parseInt(e.currentTarget.dataset.index,10);

  if(selected !== null && legalTargets.has(i)){
    movePiece(selected, i);
    clearSelection();
    render();
    return;
  }

  // If clicking a non-legal target while something is selected, play illegal
  if(selected !== null && !legalTargets.has(i)){
    playSfx('illegal');
  }

  const pc = board[i];
  if(pc && ((whiteToMove && isWhite(pc)) || (!whiteToMove && isBlack(pc)))){
    selected = i;
    legalTargets = new Set(legalMoves(i));
    statusEl.textContent = legalTargets.size ? 'Select a highlighted square to move' : 'No legal moves for this piece';
    render();
    return;
  }

  clearSelection();
  render();
}


function clearSelection(){
  selected = null;
  legalTargets.clear();
  if(!gameOver) statusEl.textContent = 'Select a piece';
}

function movePiece(from, to){
  const moving = board[from];
  const captured = board[to];

  board[to] = moving;
  board[from] = '';
  whiteToMove = !whiteToMove;

  // Play capture or move sound first
  if(captured) playSfx('capture');
  else playSfx('move');

  const oppWhite = whiteToMove;
  const oppInCheck = inCheck(oppWhite);
  const oppHasMoves = sideHasAnyLegalMoves(oppWhite);

  if(!oppHasMoves && oppInCheck){
    const winner = oppWhite ? 'Black' : 'White';
    statusEl.textContent = 'Checkmate — ' + winner + ' wins';
    playSfx('gameEnd');
    gameOver = true;
    return;
  }
  if(!oppHasMoves && !oppInCheck){
    statusEl.textContent = 'Stalemate — Draw';
    playSfx('gameEnd');
    gameOver = true;
    return;
  }

  // If game continues, play check if applicable
  if(oppInCheck) playSfx('check');

  statusEl.textContent = oppInCheck ? 'Check!' : 'Moved';
}


// ---------- Move generation and rule checks ----------

function legalMoves(i){
  const pc = board[i];
  if(!pc) return [];
  const white = isWhite(pc);

  const pseudo = generatePseudoMoves(i);
  const results = [];

  for(const j of pseudo){
    // forbid capturing a king explicitly
    if(board[j] && isKing(board[j])) continue;

    const moving = board[i];
    const captured = board[j];
    board[j] = moving;
    board[i] = '';

    const stillInCheck = inCheck(white);

    board[i] = moving;
    board[j] = captured;

    if(!stillInCheck) results.push(j);
  }
  return results;
}

function sideHasAnyLegalMoves(whiteSide){
  for(let i=0;i<64;i++){
    const pc = board[i];
    if(!pc) continue;
    if(whiteSide && !isWhite(pc)) continue;
    if(!whiteSide && !isBlack(pc)) continue;
    if(legalMoves(i).length) return true;
  }
  return false;
}

function findKingIndex(whiteSide){
  const target = whiteSide ? 'K' : 'k';
  for(let i=0;i<64;i++) if(board[i] === target) return i;
  return -1;
}

function inCheck(whiteSide){
  const k = findKingIndex(whiteSide);
  if(k === -1) return true; // should never happen due to no-king-capture rule
  return squareAttackedBy(k, !whiteSide);
}

// Is square i attacked by side byWhite?
function squareAttackedBy(i, byWhite){
  const [r,c] = rc(i);

  // Pawn attacks
  if(byWhite){
    const pr = r+1;
    for(const dc of [-1,1]){
      const cc = c+dc;
      if(inB(pr,cc) && board[idx(pr,cc)] === 'P') return true;
    }
  }else{
    const pr = r-1;
    for(const dc of [-1,1]){
      const cc = c+dc;
      if(inB(pr,cc) && board[idx(pr,cc)] === 'p') return true;
    }
  }

  // Knight attacks
  const kD = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for(const [dr,dc] of kD){
    const rr=r+dr, cc=c+dc;
    if(!inB(rr,cc)) continue;
    const p = board[idx(rr,cc)];
    if(byWhite ? p==='N' : p==='n') return true;
  }

  // King attacks (adjacent)
  for(let dr=-1;dr<=1;dr++){
    for(let dc=-1;dc<=1;dc++){
      if(dr===0 && dc===0) continue;
      const rr=r+dr, cc=c+dc;
      if(!inB(rr,cc)) continue;
      const p = board[idx(rr,cc)];
      if(byWhite ? p==='K' : p==='k') return true;
    }
  }

  // Sliding: bishops/queens (diagonals)
  const diag = [[-1,-1],[-1,1],[1,-1],[1,1]];
  for(const [dr,dc] of diag){
    let rr=r+dr, cc=c+dc;
    while(inB(rr,cc)){
      const p = board[idx(rr,cc)];
      if(p){
        if(byWhite ? (p==='B' || p==='Q') : (p==='b' || p==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }

  // Sliding: rooks/queens (orthogonals)
  const ortho = [[-1,0],[1,0],[0,-1],[0,1]];
  for(const [dr,dc] of ortho){
    let rr=r+dr, cc=c+dc;
    while(inB(rr,cc)){
      const p = board[idx(rr,cc)];
      if(p){
        if(byWhite ? (p==='R' || p==='Q') : (p==='r' || p==='q')) return true;
        break;
      }
      rr+=dr; cc+=dc;
    }
  }

  return false;
}

// Pseudo-legal moves (no self-check filtering)
function generatePseudoMoves(i){
  const pc = board[i];
  if(!pc) return [];
  const white = isWhite(pc);
  const [r,c] = rc(i);
  const t = pc.toLowerCase();
  let moves = [];

  if(t === 'p'){
    const dir = white ? -1 : 1;
    const startRank = white ? 6 : 1;
    if(inB(r+dir,c) && empty(idx(r+dir,c))){
      moves.push(idx(r+dir,c));
      if(r === startRank && empty(idx(r+2*dir,c))) moves.push(idx(r+2*dir,c));
    }
    for(const dc of [-1,1]){
      const rr = r+dir, cc = c+dc;
      if(!inB(rr,cc)) continue;
      const j = idx(rr,cc);
      if(board[j] && !sameColor(pc, board[j])) moves.push(j);
    }
  }

  if(t === 'n'){
    const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for(const [dr,dc] of deltas){
      const rr=r+dr, cc=c+dc;
      if(!inB(rr,cc)) continue;
      const j = idx(rr,cc);
      if(!board[j] || !sameColor(pc, board[j])) moves.push(j);
    }
  }

  if(t === 'k'){
    for(let dr=-1; dr<=1; dr++){
      for(let dc=-1; dc<=1; dc++){
        if(dr===0 && dc===0) continue;
        const rr=r+dr, cc=c+dc;
        if(!inB(rr,cc)) continue;
        const j = idx(rr,cc);
        if(!board[j] || !sameColor(pc, board[j])) moves.push(j);
      }
    }
  }

  if(t === 'b' || t === 'r' || t === 'q'){
    const dirs = [];
    if(t==='b' || t==='q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
    if(t==='r' || t==='q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
    for(const [dr,dc] of dirs){
      let rr=r+dr, cc=c+dc;
      while(inB(rr,cc)){
        const j = idx(rr,cc);
        if(!board[j]){
          moves.push(j);
        }else{
          if(!sameColor(pc, board[j])) moves.push(j);
          break;
        }
        rr+=dr; cc+=dc;
      }
    }
  }

  // disallow landing on a king square at the pseudo level
  moves = moves.filter(j => !board[j] || !isKing(board[j]));
  return moves;
}

window.board = board;
window.whiteToMove = whiteToMove;
window.render = render;
window.movePiece = movePiece; // must exist before firebase code wraps it

render();
/* ------------------------------
   END: ORIGINAL CHESS LOGIC
   ------------------------------ */


/* ------------------------------
   BEGIN: FIREBASE REALTIME MULTIPLAYER
   ------------------------------ */

/*
  NOTES:
  - This section uses Firebase modular SDK (Realtime Database + Auth).
  - Replace firebaseConfig with your project's values.
  - The UI element IDs expected:
    send-link, complete-link, auth-panel, players-panel, players-list,
    requests-panel, incoming-requests, game-panel, create-game, join-id,
    join-game, game-url, current-game-id, my-colour, leave-game.
*/

// -- Firebase imports (ES module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  onDisconnect,
  get,
  child,
  remove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ---- CONFIG: replace the values below with YOUR firebase project config ----
const firebaseConfig = {
  apiKey: "AIzaSyAh7spDeQk7nG0qzrXf2iA6vK2A2Cztyng",
  authDomain: "chessx-c94e2.firebaseapp.com",
  projectId: "chessx-c94e2",
  storageBucket: "chessx-c94e2.firebasestorage.app",
  messagingSenderId: "881392331293",
  appId: "1:881392331293:web:39c747febf59e9321b34f4",
  measurementId: "G-J4V0NH3HC8"
};
// ----------------------------------------------------------------------------

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const rtdb = getDatabase(firebaseApp);

// UI references (match the HTML you used earlier)
const sendLinkBtn = document.getElementById('send-link');
const completeLinkBtn = document.getElementById('complete-link');
const authPanel = document.getElementById('auth-panel');

const playersPanel = document.getElementById('players-panel');
const playersListEl = document.getElementById('players-list');

const requestsPanel = document.getElementById('requests-panel');
const incomingRequestsEl = document.getElementById('incoming-requests');

const gamePanel = document.getElementById('game-panel');
const createGameBtn = document.getElementById('create-game');
const joinIdInput = document.getElementById('join-id');
const joinGameBtn = document.getElementById('join-game');
const gameUrlSpan = document.getElementById('game-url');
const currentGameIdEl = document.getElementById('current-game-id');
const myColourEl = document.getElementById('my-colour');
const leaveGameBtn = document.getElementById('leave-game');

// local multiplayer state
let currentUser = null;
let currentGameId = null;
let gameListenerUnsub = null;
let requestsListenerUnsub = null;
let playersListenerUnsub = null;
let suppressLocalPush = false; // to avoid echo loops when applying remote updates

// EMAIL LINK: send link
sendLinkBtn?.addEventListener('click', async () => {
  const emailInput = document.getElementById('email');
  const email = emailInput?.value?.trim();
  if(!email) return alert('Enter email');
  const actionCodeSettings = {
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
completeLinkBtn?.addEventListener('click', async () => {
  try{
    if(isSignInWithEmailLink(auth, window.location.href)){
      let email = window.localStorage.getItem('emailForSignIn');
      if(!email) email = prompt('Please provide your email for confirmation');
      await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForSignIn');
      alert('Signed in!');
    } else {
      alert('No sign-in link detected in URL. Click the link from your email first.');
    }
  }catch(err){
    console.error(err);
    alert('Sign-in failed: ' + err.message);
  }
});

// AUTH listener
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    // Show UI
    authPanel && (authPanel.style.display = 'block');
    playersPanel && (playersPanel.style.display = 'block');
    requestsPanel && (requestsPanel.style.display = 'block');
    gamePanel && (gamePanel.style.display = 'block');

    // mark online in RTDB with onDisconnect cleanup
    const userRef = ref(rtdb, `users/${user.uid}`);
    await set(userRef, { email: user.email || '', online: true, currentGame: null });
    // set onDisconnect to mark offline
    onDisconnect(userRef).set({ email: user.email || '', online: false, currentGame: null });

    // start listeners
    startPlayersListener();
    startRequestsListener();
  } else {
    // hide UI
    // (keep authPanel visible)
    playersPanel && (playersPanel.style.display = 'none');
    requestsPanel && (requestsPanel.style.display = 'none');
    gamePanel && (gamePanel.style.display = 'none');

    // cleanup listeners
    if(playersListenerUnsub) playersListenerUnsub();
    if(requestsListenerUnsub) requestsListenerUnsub();
    if(gameListenerUnsub){ gameListenerUnsub(); gameListenerUnsub = null;}
    currentGameId = null;
    currentUser = null;
  }
});

// PLAYERS: list online users (excluding self)
function startPlayersListener(){
  const usersRef = ref(rtdb, 'users');
  playersListenerUnsub = onValue(usersRef, (snap) => {
    const users = snap.val() || {};
    playersListEl && (playersListEl.innerHTML = '');
    let any = false;
    for(const uid in users){
      if(!Object.prototype.hasOwnProperty.call(users, uid)) continue;
      if(!users[uid].online) continue;
      if(currentUser && uid === currentUser.uid) continue;
      any = true;
      const u = users[uid];
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<div>${u.email || uid}</div>`;
      const btn = document.createElement('button');
      btn.className = 'small-btn';
      btn.textContent = 'Challenge';
      btn.onclick = () => sendChallenge(uid, u.email || uid);
      row.appendChild(btn);
      playersListEl.appendChild(row);
    }
    if(!any && playersListEl) playersListEl.innerHTML = '<div class="muted">No other players online</div>';
  });
}

// REQUESTS: send challenge
async function sendChallenge(targetUid, targetEmail){
  if(!currentUser) return alert('Sign in first');
  const reqRef = push(ref(rtdb, 'requests'));
  await set(reqRef, {
    from: currentUser.uid,
    to: targetUid,
    fromEmail: currentUser.email || '',
    status: 'pending',
    createdAt: Date.now()
  });
  alert('Challenge sent to ' + (targetEmail || targetUid));
}

// Listen incoming requests addressed to me
function startRequestsListener(){
  const reqRef = ref(rtdb, 'requests');
  requestsListenerUnsub = onValue(reqRef, (snap) => {
    const reqs = snap.val() || {};
    incomingRequestsEl && (incomingRequestsEl.innerHTML = '');
    let any = false;
    for(const rid in reqs){
      if(!Object.prototype.hasOwnProperty.call(reqs, rid)) continue;
      const r = reqs[rid];
      if(r.to !== (currentUser && currentUser.uid)) continue;
      if(r.status !== 'pending') continue;
      any = true;
      const row = document.createElement('div');
      row.className = 'player-row';
      row.innerHTML = `<div><strong>${r.fromEmail || r.from}</strong></div>`;
      const accept = document.createElement('button');
      accept.className = 'small-btn';
      accept.textContent = 'Accept';
      accept.onclick = () => acceptRequest(rid, r);
      const reject = document.createElement('button');
      reject.className = 'small-btn';
      reject.textContent = 'Reject';
      reject.onclick = () => rejectRequest(rid);
      row.appendChild(accept);
      row.appendChild(reject);
      incomingRequestsEl.appendChild(row);
    }
    if(!any && incomingRequestsEl) incomingRequestsEl.innerHTML = '<div class="muted">No requests</div>';
  });
}

// Accept request -> create game and update request/users
async function acceptRequest(requestId, requestData){
  try{
    // create a unique game id
    const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const gameRef = ref(rtdb, `games/${gameId}`);

    const initialBoard = window.board ? window.board.slice() : [
      'r','n','b','q','k','b','n','r',
      'p','p','p','p','p','p','p','p',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      'P','P','P','P','P','P','P','P',
      'R','N','B','Q','K','B','N','R'
    ];

    await set(gameRef, {
      playerWhite: requestData.from,
      playerBlack: requestData.to,
      board: initialBoard,
      turnWhite: true,
      status: 'active',
      createdAt: Date.now()
    });

    // mark request accepted
    await update(ref(rtdb, `requests/${requestId}`), { status: 'accepted', gameId });

    // put game id into both users
    await update(ref(rtdb, `users/${requestData.from}`), { currentGame: gameId });
    await update(ref(rtdb, `users/${requestData.to}`), { currentGame: gameId });

    openGame(gameId);
  }catch(err){
    console.error('acceptRequest failed', err);
    alert('Failed to accept: ' + err.message);
  }
}

async function rejectRequest(requestId){
  try{
    await update(ref(rtdb, `requests/${requestId}`), { status: 'rejected' });
  }catch(e){ console.warn(e); }
}

// CREATE GAME button: create a waiting game (others can join by ID)
createGameBtn?.addEventListener('click', async () => {
  if(!currentUser) return alert('Sign in first');
  try{
    const gameId = 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const initialBoard = window.board ? window.board.slice() : [
      'r','n','b','q','k','b','n','r',
      'p','p','p','p','p','p','p','p',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      '','','','','','','','',
      'P','P','P','P','P','P','P','P',
      'R','N','B','Q','K','B','N','R'
    ];
    await set(ref(rtdb, `games/${gameId}`), {
      playerWhite: currentUser.uid,
      playerBlack: null,
      board: initialBoard,
      turnWhite: true,
      status: 'waiting',
      createdAt: Date.now()
    });
    await update(ref(rtdb, `users/${currentUser.uid}`), { currentGame: gameId });
    openGame(gameId);
  }catch(err){
    console.error('create game failed', err);
    alert('Create game failed: ' + err.message);
  }
});

// JOIN game by ID input
joinGameBtn?.addEventListener('click', async () => {
  const id = (joinIdInput && joinIdInput.value || '').trim();
  if(!id) return alert('Enter game id');
  try{
    const gSnap = await get(child(ref(rtdb), `games/${id}`));
    if(!gSnap.exists()) return alert('Game not found');
    const gd = gSnap.val();
    // set playerBlack if empty
    if(!gd.playerBlack && gd.playerWhite !== currentUser.uid){
      await update(ref(rtdb, `games/${id}`), { playerBlack: currentUser.uid, status: 'active' });
    } else if(!gd.playerWhite && gd.playerBlack !== currentUser.uid){
      await update(ref(rtdb, `games/${id}`), { playerWhite: currentUser.uid, status: 'active' });
    }
    await update(ref(rtdb, `users/${currentUser.uid}`), { currentGame: id });
    openGame(id);
  }catch(err){
    console.error(err);
    alert('Join failed: ' + err.message);
  }
});

// OPEN a game locally: listen for changes
async function openGame(gameId){
  // cleanup previous listener
  if(gameListenerUnsub){ gameListenerUnsub(); gameListenerUnsub = null; }
  currentGameId = gameId;
  currentGameIdEl && (currentGameIdEl.textContent = gameId);
  gameUrlSpan && (gameUrlSpan.textContent = `Share ID: ${gameId}`);

  const gameRef = ref(rtdb, `games/${gameId}`);
  // fetch once to set initial board and my colour
  try{
    const snap = await get(gameRef);
    if(snap.exists()){
      const gd = snap.val();
      if(gd.board){
        suppressLocalPush = true;
        window.board = gd.board.slice();
        window.whiteToMove = !!gd.turnWhite;
        window.render();
        suppressLocalPush = false;
      }
      // set my colour label
      if(currentUser){
        if(gd.playerWhite === currentUser.uid) myColourEl && (myColourEl.textContent = 'White');
        else if(gd.playerBlack === currentUser.uid) myColourEl && (myColourEl.textContent = 'Black');
        else myColourEl && (myColourEl.textContent = 'Observer');
      }
    }
  }catch(e){ console.warn('initial game fetch failed', e); }

  // realtime listener
  gameListenerUnsub = onValue(gameRef, (snap) => {
    const gd = snap.val();
    if(!gd) return;
    // If received updated board from server, apply it
    if(gd.board){
      suppressLocalPush = true; // prevent pushing back the same change
      window.board = gd.board.slice();
      window.whiteToMove = !!gd.turnWhite;
      window.render();
      suppressLocalPush = false;
    }
    // update UI colour label
    if(currentUser){
      if(gd.playerWhite === currentUser.uid) myColourEl && (myColourEl.textContent = 'White');
      else if(gd.playerBlack === currentUser.uid) myColourEl && (myColourEl.textContent = 'Black');
      else myColourEl && (myColourEl.textContent = 'Observer');
    }
  });
}

// LEAVE game
leaveGameBtn?.addEventListener('click', async () => {
  if(!currentUser) return;
  if(!currentGameId) return;
  try{
    // clear user's currentGame
    await update(ref(rtdb, `users/${currentUser.uid}`), { currentGame: null });
    // stop listening locally
    if(gameListenerUnsub){ gameListenerUnsub(); gameListenerUnsub = null; }
    currentGameId = null;
    currentGameIdEl && (currentGameIdEl.textContent = '-');
    myColourEl && (myColourEl.textContent = '-');
    gamePanel && (gamePanel.style.display = 'none');
  }catch(e){ console.warn(e); }
});

// Utility: push board state to server for current game
async function pushBoardToServer(){
  if(!currentGameId) return;
  if(suppressLocalPush) return;
  try{
    await update(ref(rtdb, `games/${currentGameId}`), {
      board: window.board.slice(),
      turnWhite: !!window.whiteToMove,
      lastUpdated: Date.now()
    });
  }catch(e){ console.error('pushBoardToServer failed', e); }
}

// Wrap original movePiece to push to server after applying local move
// We must preserve the original movePiece logic; so store it and wrap.
const originalMovePiece = window.movePiece.bind(window);

window.movePiece = async function(from, to){
  // if in a multiplayer game, enforce turn ownership
  if(currentGameId && currentUser){
    // try to read current game players
    try{
      const gSnap = await get(ref(rtdb, `games/${currentGameId}`));
      if(gSnap.exists()){
        const gd = gSnap.val();
        const amWhite = gd.playerWhite === currentUser.uid;
        const amBlack = gd.playerBlack === currentUser.uid;
        // Determine if it's this client's turn
        if( (window.whiteToMove && !amWhite && (gd.playerWhite || gd.playerBlack)) ||
            (!window.whiteToMove && !amBlack && (gd.playerWhite || gd.playerBlack)) ){
          // Not allowed to move (either observer or wrong side)
          playSfx('illegal');
          return;
        }
      }
    }catch(e){ console.warn('checking ownership failed', e); }
  }

  // Call original local move (unchanged logic)
  originalMovePiece(from, to);

  // After performing the move locally, push to server if in a game
  await pushBoardToServer();
};

// Also push board when user manually creates or joins a game (handled in openGame/creation)

// Sign out helper — optional: you can wire this to a button if desired
async function signOutUser(){
  if(currentUser){
    try{
      await update(ref(rtdb, `users/${currentUser.uid}`), { online: false, currentGame: null });
      await signOut(auth);
    }catch(e){ console.warn('signOut failed', e); }
  }
}

/* ------------------------------
   END: FIREBASE REALTIME MULTIPLAYER
   ------------------------------ */



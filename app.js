const boardEl = document.getElementById('chessboard');
const turnEl = document.getElementById('turn');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start-game');
const restartBtn = document.getElementById('restart-game');
// Alias the UMD global exposed by the script tag
const JCE = window['js-chess-engine'];  // <- add here, near the top of app.js


// Unicode for display
const PIECES ={
  'r':'♜','n':'♞','b':'♝','q':'♛','k':'♚','p':'♟',
  'R':'♖','N':'♘','B':'♗','Q':'♕','K':'♔','P':'♙'
};

// Initial position
const START_BOARD = [
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
  illegal: new Audio('sounds/illegal.mp3')
};

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
  try { a.currentTime = 0; a.play(); } catch(e) {}
}

// Autoplay unlock
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
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
    audioUnlocked = true;
    playSfx('gameStart');
  });
}
document.getElementById('enable-audio')?.addEventListener('click', unlockAudioOnce);
document.addEventListener('pointerdown', unlockAudioOnce, { once: true });
document.getElementById('mute-toggle')?.addEventListener('change', e => setMuted(e.target.checked));
document.getElementById('vol')?.addEventListener('input', e => setVolume(parseFloat(e.target.value)));

// Game state
let board = START_BOARD.slice();
let whiteToMove = true;
let selected = null;
let legalTargets = new Set();
let gameOver = false;

// Castling rights (declare once here)
let canCastleWK = true; // White short (king side)
let canCastleWQ = true; // White long  (queen side)
let canCastleBK = true; // Black short
let canCastleBQ = true; // Black long

// Last move highlight
let lastFrom = null;
let lastTo = null;
// Promotion UI state
const promoEl = document.getElementById('promotion');
let promotionPending = false;
let pendingFrom = null;
let pendingTo = null;
let pendingIsWhite = null;





// AI config (local play only)
let gameStarted = false;       // Start button flips this
window.aiMode = false;         // AI off until Start
window.aiSide = 'black';       // AI plays Black
window.aiLevel = 2;            // 0..3

// js-chess-engine (UMD global) - created on Start/Restart
let aiGame = null;

// Timing controls for AI pacing
const AI_THINK_MS = 2000;        // pause before the AI selects a move (800–2000 feels natural)
const AI_AFTER_MOVE_MS = 1000;    // pause after the AI moves to let it be seen

// Small helper
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Optional: UI lock state
let engineThinking = false;




function rc(i){ return [Math.floor(i/8), i%8]; }
function idx(r,c){ return r*8 + c; }
function inB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function isWhite(pc){ return pc && pc === pc.toUpperCase(); }
function isBlack(pc){ return pc && pc === pc.toLowerCase(); }
function sameColor(a,b){ if(!a || !b) return false; return isWhite(a) === isWhite(b); }
function empty(i){ return !board[i]; }
function isKing(pc){ return pc === 'K' || pc === 'k'; }



function updateCastlingRights(from, to, moving, captured){
  // King moved
  if (moving === 'K') { canCastleWK = false; canCastleWQ = false; }
  if (moving === 'k') { canCastleBK = false; canCastleBQ = false; }

  // Rook moved from its original square
  const fromAlg = idxToAlg(from).toUpperCase();
  if (moving === 'R') {
    if (fromAlg === 'H1') canCastleWK = false;
    if (fromAlg === 'A1') canCastleWQ = false;
  }
  if (moving === 'r') {
    if (fromAlg === 'H8') canCastleBK = false;
    if (fromAlg === 'A8') canCastleBQ = false;
  }

  // Rook captured on its original square
  const toAlg = idxToAlg(to).toUpperCase();
  if (captured === 'R') {
    if (toAlg === 'H1') canCastleWK = false;
    if (toAlg === 'A1') canCastleWQ = false;
  }
  if (captured === 'r') {
    if (toAlg === 'H8') canCastleBK = false;
    if (toAlg === 'A8') canCastleBQ = false;
  }
}



function needsPromotion(from, to){
  const moving = board[from];
  if (moving !== 'P' && moving !== 'p') return false;
  const [tr] = rc(to);
  return (moving === 'P' && tr === 0) || (moving === 'p' && tr === 7);
}


// Promotion UI: open/close + finalize
function openPromotion(from, to){
  promotionPending = true;
  pendingFrom = from;
  pendingTo = to;
  pendingIsWhite = isWhite(board[from]);

  // Configure buttons per side (uppercase for White, lowercase for Black)
  const buttons = promoEl.querySelectorAll('.promo-btn');
  buttons.forEach(btn => {
    const base = btn.dataset.piece; // 'q','r','b','n'
    btn.dataset.apply = pendingIsWhite ? base.toUpperCase() : base.toLowerCase();
  });

  promoEl.style.display = 'flex';
  statusEl.textContent = 'Choose promotion piece';
}

function closePromotion(){
  promotionPending = false;
  pendingFrom = null;
  pendingTo = null;
  pendingIsWhite = null;
  promoEl.style.display = 'none';
}

// One delegated listener for all 4 buttons on the overlay
promoEl.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.classList.contains('promo-btn')) return;
  const letter = t.dataset.apply; // 'Q','R','B','N' or lowercase for Black
  finalizePromotion(letter);
});

function finalizePromotion(letter){
  if (!promotionPending) return;
  const from = pendingFrom;
  const to = pendingTo;

  // Apply the move with explicit promotion, then sync AI and redraw
  movePiece(from, to, letter);
  onHumanMoveApplied(from, to, letter);

  closePromotion();
  clearSelection();
  render();
}


function render(){
  boardEl.innerHTML = '';
  for(let i=0;i<64;i++){
    const [r,c] = rc(i);
    const sq = document.createElement('div');

 

    sq.className = 'square ' + (((r+c)&1)===0 ? 'light' : 'dark');

    if (i === lastFrom || i === lastTo) {
     sq.classList.add('last-move');
    }

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

  // Block clicks during AI delay/turn
  if (engineThinking) { 
    statusEl.textContent = 'Computer turn - please wait'; 
    return; 
  }

  const i = parseInt(e.currentTarget.dataset.index,10);

  // Valid move to a highlighted square
  if(selected !== null && legalTargets.has(i)){
    const fromBefore = selected;

    // If this move is a promotion, open UI and return
    if (needsPromotion(fromBefore, i)) {
    openPromotion(fromBefore, i);
    return;
  }

  // Normal (non-promotion) flow
    movePiece(selected, i);
    onHumanMoveApplied(fromBefore, i); // sync AI + maybe reply
    clearSelection();
    render();
    return;
  }

  // Clicking elsewhere while a square is selected
  if(selected !== null && !legalTargets.has(i)){
    playSfx('illegal');
  }

  // Select a piece
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

// Replace your existing movePiece with this promotion-aware version
function movePiece(from, to, promotion){
  const moving = board[from];
  const captured = board[to];

  // Last-move highlight
  lastFrom = from;
  lastTo = to;

  // Detect castling and move rook first
  const fromAlg = idxToAlg(from).toUpperCase();
  const toAlg   = idxToAlg(to).toUpperCase();
  if (moving === 'K' && fromAlg === 'E1' && toAlg === 'G1') {
    // White short: H1 -> F1
    const h1 = algToIdx('H1'), f1 = algToIdx('F1');
    board[f1] = board[h1];
    board[h1] = '';
  } else if (moving === 'K' && fromAlg === 'E1' && toAlg === 'C1') {
    // White long: A1 -> D1
    const a1 = algToIdx('A1'), d1 = algToIdx('D1');
    board[d1] = board[a1];
    board[a1] = '';
  } else if (moving === 'k' && fromAlg === 'E8' && toAlg === 'G8') {
    // Black short: H8 -> F8
    const h8 = algToIdx('H8'), f8 = algToIdx('F8');
    board[f8] = board[h8];
    board[h8] = '';
  } else if (moving === 'k' && fromAlg === 'E8' && toAlg === 'C8') {
    // Black long: A8 -> D8
    const a8 = algToIdx('A8'), d8 = algToIdx('D8');
    board[d8] = board[a8];
    board[a8] = '';
  }


  // Decide which piece ends up on the destination (handle promotion)
  let placed = moving;
  const [tr] = rc(to);
  const promoteWhite = (moving === 'P' && tr === 0);
  const promoteBlack = (moving === 'p' && tr === 7);
  if (promoteWhite || promoteBlack) {
    // If a promotion letter was provided (Q/R/B/N or q/r/b/n), use it; otherwise auto-queen
    placed = promotion ? String(promotion) : (moving === 'P' ? 'Q' : 'q');
  }

  // Apply move on board
  board[to] = placed;
  board[from] = '';

  // Update castling rights on king/rook moves or rook capture
  updateCastlingRights(from, to, moving, captured);

   // Toggle turn and finish as before
  whiteToMove = !whiteToMove;
  if (captured) playSfx('capture'); else playSfx('move');

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

  if(oppInCheck) playSfx('check');
  statusEl.textContent = oppInCheck ? 'Check!' : 'Moved';
}

 



// ---------- Rules ----------
function legalMoves(i){
  const pc = board[i];
  if(!pc) return [];
  const white = isWhite(pc);

  const pseudo = generatePseudoMoves(i);
  const results = [];

  for(const j of pseudo){
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
  if(k === -1) return true;
  return squareAttackedBy(k, !whiteSide);
}

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

  // Knight
  const kD = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for(const [dr,dc] of kD){
    const rr=r+dr, cc=c+dc;
    if(!inB(rr,cc)) continue;
    const p = board[idx(rr,cc)];
    if(byWhite ? p==='N' : p==='n') return true;
  }

  // King
  for(let dr=-1;dr<=1;dr++){
    for(let dc=-1;dc<=1;dc++){
      if(dr===0 && dc===0) continue;
      const rr=r+dr, cc=c+dc;
      if(!inB(rr,cc)) continue;
      const p = board[idx(rr,cc)];
      if(byWhite ? p==='K' : p==='k') return true;
    }
  }

  // Bishops/Queens (diagonals)
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

  // Rooks/Queens (orthogonals)
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

function generatePseudoMoves(i){
  const pc = board[i];
  if(!pc) return [];
  const white = isWhite(pc);
  const [r,c] = rc(i);
  const t = pc.toLowerCase();
  let moves = [];

  // Pawns
  if (t === 'p') {
    const dir = white ? -1 : 1;
    const startRank = white ? 6 : 1;
    // single push
    if (inB(r+dir,c) && empty(idx(r+dir,c))) {
      moves.push(idx(r+dir,c));
      // double push from start
      if (r === startRank && empty(idx(r+2*dir,c))) moves.push(idx(r+2*dir,c));
    }
    // captures
    for (const dc of [-1,1]) {
      const rr = r+dir, cc = c+dc;
      if (!inB(rr,cc)) continue;
      const j = idx(rr,cc);
      if (board[j] && !sameColor(pc, board[j])) moves.push(j);
    }
  }

  // Knights
  if (t === 'n') {
    const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr,dc] of deltas) {
      const rr = r+dr, cc = c+dc;
      if (!inB(rr,cc)) continue;
      const j = idx(rr,cc);
      if (!board[j] || !sameColor(pc, board[j])) moves.push(j);
    }
  }

  // King + Castling
  if (t === 'k') {
    // one-square king moves
    for (let dr=-1; dr<=1; dr++){
      for (let dc=-1; dc<=1; dc++){
        if (dr===0 && dc===0) continue;
        const rr = r+dr, cc = c+dc;
        if (!inB(rr,cc)) continue;
        const j = idx(rr,cc);
        if (!board[j] || !sameColor(pc, board[j])) moves.push(j);
      }
    }

    // Castling additions
    const whiteSide = white; // true if this is a White king
    const e = algToIdx(whiteSide ? 'E1' : 'E8');
    const f = algToIdx(whiteSide ? 'F1' : 'F8');
    const g = algToIdx(whiteSide ? 'G1' : 'G8');
    const d = algToIdx(whiteSide ? 'D1' : 'D8');
    const c2 = algToIdx(whiteSide ? 'C1' : 'C8'); // avoid clashing with outer 'c'
    const b2 = algToIdx(whiteSide ? 'B1' : 'B8');
    const h = algToIdx(whiteSide ? 'H1' : 'H8');
    const a = algToIdx(whiteSide ? 'A1' : 'A8');

    // Only from home square and not currently in check
    if (i === e && !inCheck(whiteSide)) {
      // Short castle: E -> G
      const rightsShort = whiteSide ? canCastleWK : canCastleBK;
      if (rightsShort &&
          empty(f) && empty(g) &&
          board[h] === (whiteSide ? 'R' : 'r') &&
          !squareAttackedBy(f, !whiteSide) &&
          !squareAttackedBy(g, !whiteSide)) {
        moves.push(g);
      }

      // Long castle: E -> C (B must also be empty)
      const rightsLong = whiteSide ? canCastleWQ : canCastleBQ;
      if (rightsLong &&
          empty(d) && empty(c2) && empty(b2) &&
          board[a] === (whiteSide ? 'R' : 'r') &&
          !squareAttackedBy(d, !whiteSide) &&
          !squareAttackedBy(c2, !whiteSide)) {
        moves.push(c2);
      }
    }
  } // closes king branch

  // Bishops / Rooks / Queens (sliders)
  if (t === 'b' || t === 'r' || t === 'q') {
    const dirs = [];
    if (t==='b' || t==='q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
    if (t==='r' || t==='q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
    for (const [dr,dc] of dirs){
      let rr = r+dr, cc = c+dc;
      while (inB(rr,cc)) {
        const j = idx(rr,cc);
        if (!board[j]) {
          moves.push(j);
        } else {
          if (!sameColor(pc, board[j])) moves.push(j);
          break;
        }
        rr += dr; cc += dc;
      }
    }
  }

  // Do not include moves that capture a king (keeps with your existing rule)
  moves = moves.filter(j => !board[j] || !isKing(board[j]));
  return moves;
}


/* ===== AI: js-chess-engine integration ===== */
const FILES = ['a','b','c','d','e','f','g','h'];
function idxToAlg(i){
  const r = Math.floor(i / 8);
  const c = i % 8;
  return FILES[c] + (8 - r);
}
function algToIdx(alg){
  const file = alg[0].toLowerCase();
  const rank = parseInt(alg[1], 10);
  const c = FILES.indexOf(file);
  const r = 8 - rank;
  return r * 8 + c;
}

function allLegalPairsForTurn(){
  const wantWhite = whiteToMove;
  const pairs = [];
  for (let i = 0; i < 64; i++) {
    const pc = board[i];
    if (!pc) continue;
    if (wantWhite && !isWhite(pc)) continue;
    if (!wantWhite && !isBlack(pc)) continue;
    const moves = legalMoves(i);
    for (const j of moves) pairs.push([i, j]);
  }
  return pairs;
}

function onHumanMoveApplied(fromIdx, toIdx, promotion){
  if (!aiGame) return; // no AI until Start is clicked
  const FROM = idxToAlg(fromIdx).toUpperCase();
  const TO   = idxToAlg(toIdx).toUpperCase();
  try {
    aiGame.move(FROM, TO, promotion ? String(promotion).toUpperCase() : undefined);
  } catch (e) {
    console.warn('AI sync warning:', e);
  }
  maybeAIMove();
}

async function maybeAIMove(){
  if (!window.aiMode || gameOver || engineThinking) return;
  const turnSide = whiteToMove ? 'white' : 'black';
  if (turnSide !== window.aiSide) return;

  engineThinking = true;
  boardEl.style.pointerEvents = 'none';
  statusEl.textContent = 'Computer thinking...';

  // Pre-move pause so the user sees it's the AI's turn
  await delay(AI_THINK_MS);

  const legalPairs = allLegalPairsForTurn();
  if (legalPairs.length === 0) {
    engineThinking = false;
    boardEl.style.pointerEvents = '';
    return;
  }

  // Pick a move via engine (or fallback)
  let chosen = null;
  try {
    const engineMap = aiGame.aiMove(window.aiLevel);     // { "E7": "E5" }
    const [[FROM, TO]] = Object.entries(engineMap);
    const fromIdx = algToIdx(FROM);
    const toIdx   = algToIdx(TO);
    if (legalPairs.some(([f,t]) => f===fromIdx && t===toIdx)) chosen = [fromIdx, toIdx];
  } catch (e) { /* fallback below */ }

  if (!chosen) {
    let capture = null;
    for (const [f, t] of legalPairs) { if (board[t]) { capture = [f, t]; break; } }
    chosen = capture || legalPairs[0];
    try {
      const FROM = idxToAlg(chosen[0]).toUpperCase();
      const TO   = idxToAlg(chosen[1]).toUpperCase();
      aiGame.move(FROM, TO);
    } catch (e) { /* ignore */ }
  }

  const [fromIdx, toIdx] = chosen;
  movePiece(fromIdx, toIdx);
  render();

  // Post-move pause so the user clearly sees the destination
  await delay(AI_AFTER_MOVE_MS);

  engineThinking = false;
  boardEl.style.pointerEvents = '';
  statusEl.textContent = 'Your turn';
}


// Start/Restart flows
function resetPosition(){
  board = START_BOARD.slice();
  whiteToMove = true;
  selected = null;
  legalTargets = new Set();
  gameOver = false;
  statusEl.textContent = 'Select a piece';

 // Reset castling rights
  canCastleWK = true;
  canCastleWQ = true;
  canCastleBK = true;
  canCastleBQ = true;
  
  // If you use last-move or promotion UI, also clear them here
  // Clear last-move highlight
  lastFrom = null;
  lastTo = null;
  // Close promotion overlay if open
  if (promotionPending) closePromotion();
  render();
}

// Button listeners (ensure engine script loaded first)
startBtn?.addEventListener('click', () => {
  if (typeof window['js-chess-engine'] === 'undefined') { alert('AI engine failed to load'); return; }
  gameStarted = true;
  window.aiMode = true;
  window.aiSide = 'black';
  window.aiLevel = 2;
  aiGame = new JCE.Game();   // was: new jsChessEngine.Game()
  resetPosition();
  playSfx('gameStart');
});

restartBtn?.addEventListener('click', () => {
  if (typeof window['js-chess-engine'] === 'undefined') { alert('AI engine failed to load'); return; }
  gameStarted = true;
  window.aiMode = true;
  aiGame = new JCE.Game();   // was: new jsChessEngine.Game()
  resetPosition();
  playSfx('gameStart');
});


// Initial render (board visible immediately; AI activates after Start)
render();

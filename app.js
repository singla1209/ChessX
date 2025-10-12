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

function rc(i){ return [Math.floor(i/8), i%8]; }
function idx(r,c){ return r*8 + c; }
function inB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
function isWhite(pc){ return pc && pc === pc.toUpperCase(); }
function isBlack(pc){ return pc && pc === pc.toLowerCase(); }
function sameColor(a,b){ if(!a || !b) return false; return isWhite(a) === isWhite(b); }
function empty(i){ return !board[i]; }
function isKing(pc){ return pc === 'K' || pc === 'k'; }

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

  // Toggle turn
  whiteToMove = !whiteToMove;

  // Sounds
  if (captured) playSfx('capture'); else playSfx('move');

  // Check/End detection
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
    // ASCII hyphens only (no Unicode minus)
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
  if (!window.aiMode || gameOver) return;
  const turnSide = whiteToMove ? 'white' : 'black';
  if (turnSide !== window.aiSide) return;

  const legalPairs = allLegalPairsForTurn();
  if (legalPairs.length === 0) return;

  await new Promise(r => setTimeout(r, 120));

  let chosen = null;

  try {
    const engineMap = aiGame.aiMove(window.aiLevel);   // e.g., { "E7": "E5" }
    const [[FROM, TO]] = Object.entries(engineMap);
    const fromIdx = algToIdx(FROM);
    const toIdx   = algToIdx(TO);
    if (legalPairs.some(([f,t]) => f===fromIdx && t===toIdx)) {
      chosen = [fromIdx, toIdx];
    }
  } catch (e) {
    // fall back below
  }

  if (!chosen) {
    let capture = null;
    for (const [f, t] of legalPairs) {
      if (board[t]) { capture = [f, t]; break; }
    }
    chosen = capture || legalPairs[0];
    try {
      const FROM = idxToAlg(chosen[0]).toUpperCase();
      const TO   = idxToAlg(chosen[1]).toUpperCase();
      aiGame.move(FROM, TO);
    } catch (e) {
      console.warn('AI fallback sync warning:', e);
    }
  }

  const [fromIdx, toIdx] = chosen;
  movePiece(fromIdx, toIdx);
  render();
}

// Start/Restart flows
function resetPosition(){
  board = START_BOARD.slice();
  whiteToMove = true;
  selected = null;
  legalTargets = new Set();
  gameOver = false;
  statusEl.textContent = 'Select a piece';
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

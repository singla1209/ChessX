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
window.movePiece = movePiece; // must exist before firebase.js wraps it




render();

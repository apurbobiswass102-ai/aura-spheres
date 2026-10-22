/**
 * AURA SPHERES — Full Multi-Player Game Engine (2–4 Players)
 * Supports: VS AI, Pass & Play (2-4 humans), All-AI Watch Mode
 */

// ─── AUDIO ENGINE ───
const AudioEngine = {
  ctx: null, enabled: true,
  init() { if (!this.ctx) { const A = window.AudioContext||window.webkitAudioContext; if(A) this.ctx=new A(); } },
  tone(f,t='sine',d=.15) {
    if(!this.enabled) return; this.init(); if(!this.ctx) return;
    try {
      const o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=t; o.frequency.setValueAtTime(f,this.ctx.currentTime);
      g.gain.setValueAtTime(.1,this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+d);
      o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+d);
    } catch(e) {}
  },
  roll()    { this.tone(320,'triangle',.08); setTimeout(()=>this.tone(480,'triangle',.08),80); setTimeout(()=>this.tone(640,'sine',.15),160); },
  move()    { this.tone(520,'sine',.18); },
  capture() { this.tone(200,'sawtooth',.3); },
  power()   { this.tone(740,'triangle',.2); setTimeout(()=>this.tone(880,'sine',.25),100); },
  score()   { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.tone(f,'sine',.25),i*140)); }
};

// ─── CONSTANTS ───
const GRID = 7, CENTER = 3;

const PLAYER_DEFS = [
  { id:'p1', name:'Player 1', title:'Sapphire Azure', sigil:'◈', color:'#00d2ff', cssClass:'p1', sanctuaryCells:[[0,0],[0,1],[1,0],[0,6]] },
  { id:'p2', name:'Player 2', title:'Ruby Radiant',   sigil:'⚡', color:'#ff3366', cssClass:'p2', sanctuaryCells:[[6,6],[6,5],[5,6],[6,0]] },
  { id:'p3', name:'Player 3', title:'Emerald Zenith', sigil:'⬡', color:'#00e676', cssClass:'p3', sanctuaryCells:[[0,3],[0,4],[0,5],[1,6]] },
  { id:'p4', name:'Player 4', title:'Obsidian Gold',  sigil:'▲', color:'#ffab00', cssClass:'p4', sanctuaryCells:[[6,3],[6,2],[6,1],[5,0]] }
];

let currentTokenSkin = 'prism'; // 'prism' | 'rune' | 'mecha' | 'astral'

const DICE_OUTCOMES = [
  {val:1, label:'1 Step',   icon:'1', type:'move'},
  {val:2, label:'2 Steps',  icon:'2', type:'move'},
  {val:3, label:'3 Steps',  icon:'3', type:'move'},
  {val:'SWAP',  label:'🔄 SWAP',  icon:'🔄', type:'swap'},
  {val:'PULSE', label:'⚡ PULSE', icon:'⚡', type:'pulse'},
  {val:'SHIELD',label:'🛡️ SHIELD',icon:'🛡️',type:'shield'}
];

const CARD_DEFS = [
  {
    id:'time_warp', name:'Time Warp', icon:'⏳',
    desc:'Take an extra roll immediately this turn.',
    action(state) { state.bonusRoll=true; AudioEngine.power(); log(`<strong>${pName(state)}</strong> cast Time Warp — extra roll!`); setHint('⏳ Extra roll activated! Click your die.'); }
  },
  {
    id:'gravity_surge', name:'Gravity Surge', icon:'🌌',
    desc:'Pull all your orbs 1 step closer to Solar Core.',
    action(state) {
      const p=state.currentTurn;
      state.spheres[p].forEach(s=>{
        if(s.inOrbit||s.inCore) return;
        const dr=CENTER-s.r, dc=CENTER-s.c;
        if(dr!==0) s.r+=Math.sign(dr); else if(dc!==0) s.c+=Math.sign(dc);
      });
      AudioEngine.power(); log(`<strong>${pName(state)}</strong> activated Gravity Surge!`); renderBoard();
    }
  },
  {
    id:'aegis', name:'Aegis Barrier', icon:'✨',
    desc:'Shield all your orbs against capture for one round.',
    action(state) {
      state.spheres[state.currentTurn].forEach(s=>{ if(!s.inOrbit&&!s.inCore) s.shielded=true; });
      AudioEngine.power(); log(`<strong>${pName(state)}</strong> raised Aegis Barrier!`); renderBoard(); updatePanels();
    }
  }
];

const RUNE_CELLS = [[2,2],[2,4],[4,2],[4,4]];

// ─── GAME STATE ───
let GS = {};   // populated in startGame()
let selectedPlayerCount = 2;
let currentMode = 'ai'; // 'ai' | 'pvp' | 'allai'
let aiPlayerIds = [];   // which player ids are AI controlled

// ─── DOM CACHE ───
const $ = id => document.getElementById(id);
const qAll = sel => document.querySelectorAll(sel);

const screenMenu = $('screen-menu');
const screenGame = $('screen-game');
const gridBoard  = $('grid-board');
const diceBtnEl  = $('dice-btn');
const diceCubeEl = $('dice-cube');
const diceFaceEl = $('dice-face');
const diceDescEl = $('dice-action-desc');
const hintBar    = $('action-hint');
const turnDotEl  = $('turn-dot');
const turnTextEl = $('turn-instruction-text');
const panelsTop  = $('panels-top');
const panelsRight= $('panels-right');
const panelsBot  = $('panels-bottom');
const rescueCountEl = $('rescue-count');
const btnRescue  = $('btn-rescue');
const btnSkip    = $('btn-skip-turn');
const logFeed    = document.createElement('div'); // shared log
const modalRules   = $('modal-rules');
const modalLore    = $('modal-lore');
const modalVictory = $('modal-victory');

// ─── HELPERS ───
function pName(state) { return activeDef(state.currentTurn).name; }
function activeDef(pid) { return PLAYER_DEFS.find(d=>d.id===pid); }
function setHint(html) { hintBar.innerHTML = html; }
function log(msg) {
  const el = document.createElement('div');
  el.className = 'log-line'; el.innerHTML = msg;
  logFeed.prepend(el);
}
function getCell(r,c) { return document.querySelector(`.grid-cell[data-r="${r}"][data-c="${c}"]`); }
function isRune(r,c)  { return RUNE_CELLS.some(([rr,cc])=>rr===r&&cc===c); }

// ─── INIT ───
window.addEventListener('DOMContentLoaded', ()=>{
  setupMenu();
  buildBoard();
  setupSharedDock();
  setupModals();
});

// ══════════════════════════════════
// MENU LOGIC
// ══════════════════════════════════
function setupMenu() {
  // Player count buttons
  qAll('.pcs-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      qAll('.pcs-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerCount = parseInt(btn.dataset.count);
      updateMenuNotes();
      updatePreviewOrbs();
    });
  });

  $('btn-menu-play-ai').addEventListener('click',  ()=>{ currentMode='ai';    startGame(); });
  $('btn-menu-play-pvp').addEventListener('click', ()=>{ currentMode='pvp';   startGame(); });
  $('btn-menu-play-allai').addEventListener('click',()=>{ currentMode='allai'; startGame(); });
  $('btn-menu-rules').addEventListener('click', ()=>modalRules.classList.remove('hidden'));
  $('btn-menu-lore').addEventListener('click',  ()=>modalLore.classList.remove('hidden'));

  updateMenuNotes();
  updatePreviewOrbs();
}

function updateMenuNotes() {
  const n = selectedPlayerCount;
  $('ai-note').textContent    = `(You vs ${n-1} AI${n-1>1?'s':''})`;
  $('pvp-note').textContent   = `(${n} Players Local)`;
  $('allai-note').textContent = `(${n} AI Bots)`;
}

function updatePreviewOrbs() {
  const preview = $('pcs-preview');
  preview.innerHTML = '';
  for(let i=0; i<selectedPlayerCount; i++) {
    const orb = document.createElement('div');
    orb.className = `pcs-orb orb-${PLAYER_DEFS[i].cssClass}-color pop`;
    orb.title = PLAYER_DEFS[i].name + ' – ' + PLAYER_DEFS[i].title;
    orb.innerHTML = `<span>${PLAYER_DEFS[i].sigil}</span>`;
    preview.appendChild(orb);
  }
}

// ══════════════════════════════════
// GAME START / RESET
// ══════════════════════════════════
function startGame() {
  const count = selectedPlayerCount;

  // Determine AI players
  if (currentMode === 'ai')    aiPlayerIds = PLAYER_DEFS.slice(1, count).map(d=>d.id);
  else if(currentMode==='allai') aiPlayerIds = PLAYER_DEFS.slice(0,count).map(d=>d.id);
  else                          aiPlayerIds = [];

  // Build initial spheres per player
  const spheres = {};
  PLAYER_DEFS.slice(0, count).forEach(def=>{
    spheres[def.id] = def.sanctuaryCells.map((pos,i)=>({
      id:`${def.id}_${i}`, r:pos[0], c:pos[1],
      inOrbit:false, inCore:false, shielded:false
    }));
  });

  GS = {
    count,
    players: PLAYER_DEFS.slice(0,count).map(d=>d.id),
    turnIndex: 0,
    currentTurn: PLAYER_DEFS[0].id,
    currentRoll: null,
    rollSpent: false,
    selectedOrb: null,
    bonusRoll: false,
    spheres,
    scores: Object.fromEntries(PLAYER_DEFS.slice(0,count).map(d=>[d.id,0])),
    cards:  Object.fromEntries(PLAYER_DEFS.slice(0,count).map((d,i)=>[d.id,[{...CARD_DEFS[i%CARD_DEFS.length]}]])),
    eliminated: new Set()
  };

  screenMenu.classList.add('hidden');
  screenGame.classList.remove('hidden');

  buildPlayerPanels();
  resetDiceUI();
  updateAll();
  log(`⚔️ ${count}-Player match started! Mode: <strong>${currentMode==='ai'?'vs Oracle AI':currentMode==='allai'?'All-AI Watch':'Pass & Play'}</strong>`);

  if (aiTimer) clearTimeout(aiTimer);
  aiBusy = false;

  if (aiPlayerIds.includes(GS.currentTurn)) {
    aiTimer = setTimeout(doAITurn, 1200);
  }
}

function returnToMenu() {
  if (aiTimer) clearTimeout(aiTimer);
  aiBusy = false;
  screenGame.classList.add('hidden');
  screenMenu.classList.remove('hidden');
}

function resetDiceUI() {
  diceFaceEl.textContent  = '🎲';
  diceDescEl.textContent  = 'CLICK TO ROLL';
  btnSkip.disabled = true;
  btnRescue.disabled = true;
}

// ══════════════════════════════════
// DYNAMIC PLAYER PANELS
// ══════════════════════════════════
function buildPlayerPanels() {
  panelsTop.innerHTML = '';
  panelsRight.innerHTML = '';
  panelsBot.innerHTML = '';

  GS.players.forEach((pid, idx)=>{
    const def = activeDef(pid);
    const panel = createPanelEl(pid, def);

    // Slot assignment: P1→top-left, P2→right, P3→bottom-left, P4→bottom-right
    if(idx===0) panelsTop.appendChild(panel);
    else if(idx===1) panelsRight.appendChild(panel);
    else panelsBot.appendChild(panel);
  });
}

function createPanelEl(pid, def) {
  const panel = document.createElement('aside');
  panel.className = `player-panel pp${def.cssClass.replace('p','')}`;
  panel.id = `panel-${pid}`;

  const isAI = aiPlayerIds.includes(pid);

  panel.innerHTML = `
    <div class="panel-header">
      <div class="sphere-avatar orb-${def.cssClass}-color">${def.sigil}</div>
      <div>
        <div class="player-name" style="color:${def.color}">${def.name}${isAI?' 🤖':''}</div>
        <span class="sphere-type">${def.title}</span>
      </div>
    </div>

    <div class="p-dice-widget" id="dice-widget-${pid}">
      <div class="p-dice-cube" id="dice-cube-${pid}" style="border-color:${def.color};box-shadow:0 0 14px ${def.color}66">
        <span class="p-dice-symbol" id="dice-face-${pid}">🎲</span>
      </div>
      <div>
        <span class="p-dice-label">${def.name.toUpperCase()} CATALYST</span>
        <strong class="p-dice-status" id="dice-status-${pid}">WAITING</strong>
      </div>
    </div>

    <div class="panel-stats" id="stats-${pid}">
      <div class="stat-row-mini"><span>Solar Core</span><strong class="stat-gold" id="score-${pid}">0 / 2</strong></div>
      <div class="stat-row-mini"><span>In Orbit</span><strong id="orbit-${pid}">0</strong></div>
      <div class="stat-row-mini"><span>Shield</span><strong id="shield-${pid}">No</strong></div>
    </div>

    <div class="panel-cards">
      <h4>AURA CARDS</h4>
      <div class="cards-rack-sm" id="cards-${pid}"></div>
    </div>

    ${idx_of(pid)===1?`<div class="panel-log"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><h4 style="font-size:10px;letter-spacing:2px;color:var(--border-gold-bright)">CHRONICLES</h4><span class="live-dot">● LIVE</span></div><div class="chronicles-feed" id="log-entries"></div></div>`:''}
  `;

  // Wire up personal dice click
  panel.querySelector(`#dice-widget-${pid}`).addEventListener('click', ()=>{
    if(GS.currentTurn===pid && !aiPlayerIds.includes(pid)) handleDiceClick();
  });

  return panel;
}

function idx_of(pid) { return GS.players.indexOf(pid); }

// ══════════════════════════════════
// BOARD BUILD
// ══════════════════════════════════
function buildBoard() {
  gridBoard.innerHTML = '';
  for(let r=0; r<GRID; r++) {
    for(let c=0; c<GRID; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.r = r; cell.dataset.c = c;

      if(r===CENTER && c===CENTER) {
        cell.classList.add('cell-solar-core');
        cell.innerHTML = `
          <div class="core-singularity">
            <div class="core-ring-outer"></div>
            <div class="core-ring-inner"></div>
            <div class="core-eye">✦</div>
          </div>
        `;
      }
      else if(isRune(r,c)) { cell.classList.add('cell-rune'); }
      else {
        // Mark sanctuary zones for each player
        PLAYER_DEFS.slice(0, selectedPlayerCount).forEach((def,i)=>{
          if(def.sanctuaryCells.some(([sr,sc])=>sr===r&&sc===c)) {
            cell.classList.add(`cell-s${i+1}`);
          }
        });
      }

      cell.addEventListener('click', ()=>handleCellClick(r,c));
      gridBoard.appendChild(cell);
    }
  }
}

// ══════════════════════════════════
// SHARED DOCK & MODAL EVENTS
// ══════════════════════════════════
function setupSharedDock() {
  diceBtnEl.addEventListener('click', handleDiceClick);
  btnSkip.addEventListener('click',    passTurn);
  btnRescue.addEventListener('click',  handleRescue);

  const skinSelect = $('select-token-skin');
  if(skinSelect) {
    skinSelect.addEventListener('change', e=>{
      currentTokenSkin = e.target.value;
      renderBoard();
    });
  }
}

function setupModals() {
  $('btn-ingame-rules').addEventListener('click',  ()=>modalRules.classList.remove('hidden'));
  $('btn-close-rules').addEventListener('click',   ()=>modalRules.classList.add('hidden'));
  $('btn-rules-start').addEventListener('click',   ()=>modalRules.classList.add('hidden'));
  $('btn-close-lore').addEventListener('click',    ()=>modalLore.classList.add('hidden'));
  $('btn-close-lore-bottom').addEventListener('click',()=>modalLore.classList.add('hidden'));
  $('btn-exit-to-menu').addEventListener('click',  returnToMenu);
  $('brand-home-trigger').addEventListener('click', returnToMenu);

  $('btn-ingame-sound').addEventListener('click', e=>{
    AudioEngine.enabled = !AudioEngine.enabled;
    e.currentTarget.textContent = AudioEngine.enabled ? '🔊':'🔇';
  });

  $('btn-victory-rematch').addEventListener('click',()=>{ modalVictory.classList.add('hidden'); startGame(); });
  $('btn-victory-menu').addEventListener('click',()=>{ modalVictory.classList.add('hidden'); returnToMenu(); });
}

// ══════════════════════════════════
// RENDER
// ══════════════════════════════════
function updateAll() {
  renderBoard();
  updatePanels();
  updateTurnHeader();
}

function renderBoard() {
  // Clear ALL existing orbs and highlights
  qAll('.orb').forEach(o => o.remove());
  qAll('.grid-cell').forEach(c => {
    c.classList.remove('cell-valid-move', 'cell-swap-target');
  });

  // Draw orbs for each player
  GS.players.forEach(pid => {
    const def = activeDef(pid);
    GS.spheres[pid].forEach(orb => {
      if (orb.inOrbit || orb.inCore) return;
      const cell = getCell(orb.r, orb.c);
      if (!cell) return;
      // Prevent double orb rendering inside the same cell
      if (cell.querySelector('.orb')) return;

      const el = document.createElement('div');
      el.className = `orb orb-${def.cssClass} skin-${currentTokenSkin}`;
      if (orb.shielded) el.classList.add('orb-shielded');
      const canSelect = GS.currentTurn === pid && !GS.rollSpent && GS.currentRoll && GS.currentRoll.type === 'move' && !GS.selectedOrb;
      if (canSelect) el.classList.add('orb-selectable');
      if (GS.selectedOrb?.id === orb.id) el.classList.add('orb-selected');

      el.innerHTML = `
        <div class="token-shadow"></div>
        <div class="token-ring"></div>
        <div class="token-body orb-${def.cssClass}-color">
          <span class="token-sigil">${def.sigil}</span>
        </div>
      `;

      el.addEventListener('click', e => { e.stopPropagation(); handleOrbClick(orb, pid); });
      cell.appendChild(el);
    });
  });

  // Ensure center singularity core is rendered
  const coreCell = getCell(CENTER, CENTER);
  if (coreCell && !coreCell.querySelector('.core-singularity')) {
    coreCell.innerHTML = `
      <div class="core-singularity">
        <div class="core-ring-outer"></div>
        <div class="core-ring-inner"></div>
        <div class="core-eye">✦</div>
      </div>
    `;
  }

  // Highlight move targets
  if(GS.selectedOrb && GS.currentRoll && !GS.rollSpent) {
    if(GS.currentRoll.type==='move') highlightMoves(GS.selectedOrb, GS.currentRoll.val);
    if(GS.currentRoll.type==='swap') highlightSwapTargets();
  }
}

function highlightMoves(orb, steps) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  dirs.forEach(([dr,dc])=>{
    const tr=orb.r+dr*steps, tc=orb.c+dc*steps;
    if(tr<0||tr>=GRID||tc<0||tc>=GRID) return;
    const friendly = GS.spheres[GS.currentTurn].some(s=>!s.inOrbit&&!s.inCore&&s.r===tr&&s.c===tc);
    if(!friendly) { const cell=getCell(tr,tc); if(cell) cell.classList.add('cell-valid-move'); }
  });
}

function highlightSwapTargets() {
  GS.players.filter(pid=>pid!==GS.currentTurn).forEach(pid=>{
    GS.spheres[pid].forEach(enemy=>{
      if(enemy.inOrbit||enemy.inCore||enemy.shielded) return;
      const cell=getCell(enemy.r,enemy.c);
      if(cell) cell.classList.add('cell-swap-target');
    });
  });
}

function updatePanels() {
  GS.players.forEach(pid=>{
    // Activate turn styling
    const panel = $(`panel-${pid}`);
    if(!panel) return;
    const isActive = GS.currentTurn===pid && !GS.eliminated.has(pid);
    panel.classList.toggle('active-turn', isActive);
    panel.classList.toggle('eliminated', GS.eliminated.has(pid));

    // Scores / stats
    const orbitCnt = GS.spheres[pid].filter(s=>s.inOrbit).length;
    const shielded = GS.spheres[pid].some(s=>s.shielded);
    $(`score-${pid}`).textContent  = `${GS.scores[pid]} / 2`;
    $(`orbit-${pid}`).textContent  = orbitCnt;
    $(`shield-${pid}`).textContent = shielded ? 'Yes 🛡️':'No';

    // Dice status
    const diceStatus = $(`dice-status-${pid}`);
    if(diceStatus) {
      if(GS.eliminated.has(pid)) diceStatus.textContent='ELIMINATED';
      else if(GS.currentTurn===pid) diceStatus.textContent = GS.rollSpent?'MOVED':'YOUR TURN — ROLL!';
      else diceStatus.textContent='WAITING';
    }

    // Cards
    renderCards(pid);

    // Rescue button for current player
    if(GS.currentTurn===pid) {
      rescueCountEl.textContent = orbitCnt;
      btnRescue.disabled = orbitCnt===0 || GS.rollSpent;
    }
  });

  // Insert log feed into P2's panel
  const logContainer = $('log-entries');
  if(logContainer && !logContainer.contains(logFeed)) {
    logContainer.appendChild(logFeed);
  }

  // P1 card count badge
  const p1Count = document.getElementById('p1-card-count');
  if(p1Count) p1Count.textContent = (GS.cards[GS.players[0]]||[]).length;
}

function renderCards(pid) {
  const rack = $(`cards-${pid}`);
  if(!rack) return;
  rack.innerHTML='';
  const cards = GS.cards[pid] || [];
  if(!cards.length) { rack.innerHTML=`<span style="font-size:10px;color:var(--text-dim)">No cards</span>`; return; }
  cards.forEach((card,i)=>{
    const el=document.createElement('div');
    el.className='aura-card-item';
    el.innerHTML=`<div class="ch"><span>${card.icon} ${card.name}</span><small style="color:var(--solar-gold)">USE</small></div><div class="cb">${card.desc}</div>`;
    el.addEventListener('click',()=>{
      if(GS.currentTurn===pid && !aiPlayerIds.includes(pid)) {
        GS.cards[pid].splice(i,1);
        card.action(GS);
        updateAll();
      }
    });
    rack.appendChild(el);
  });
}

function updateTurnHeader() {
  const def = activeDef(GS.currentTurn);
  if(!def) return;
  turnDotEl.style.background  = def.color;
  turnDotEl.style.boxShadow   = `0 0 10px ${def.color}aa`;
  const isAI = aiPlayerIds.includes(GS.currentTurn);
  turnTextEl.textContent = isAI
    ? `${def.name} (AI) is calculating...`
    : `${def.name}'s Turn — Roll your Quantum Catalyst!`;
}

// ══════════════════════════════════
// DICE CLICK (human players)
// ══════════════════════════════════
function handleDiceClick() {
  if(GS.rollSpent || aiPlayerIds.includes(GS.currentTurn)) return;
  doRoll();
}

function doRoll(callback) {
  AudioEngine.roll();
  diceCubeEl.classList.add('rolling');
  const pidCube = $(`dice-cube-${GS.currentTurn}`);
  if(pidCube) pidCube.classList.add('rolling');
  diceFaceEl.textContent = '🎲';
  diceDescEl.textContent = 'ROLLING...';
  setHint('⚡ Channeling Quantum Energy...');

  setTimeout(()=>{
    diceCubeEl.classList.remove('rolling');
    if(pidCube) pidCube.classList.remove('rolling');

    const outcome = DICE_OUTCOMES[Math.floor(Math.random()*DICE_OUTCOMES.length)];
    GS.currentRoll = outcome;

    diceFaceEl.textContent = outcome.icon;
    diceDescEl.textContent = outcome.label;
    const pFace = $(`dice-face-${GS.currentTurn}`);
    if(pFace) pFace.textContent = outcome.icon;

    log(`<strong style="color:${activeDef(GS.currentTurn).color}">${activeDef(GS.currentTurn).name}</strong> rolled <strong>${outcome.label}</strong>`);

    executeRoll(outcome);
    if(callback) callback(outcome);
  }, 450);
}

// ══════════════════════════════════
// EXECUTE ROLL
// ══════════════════════════════════
function executeRoll(outcome) {
  const pid = GS.currentTurn;

  if(outcome.type==='shield') {
    AudioEngine.power();
    GS.spheres[pid].forEach(s=>{ if(!s.inOrbit&&!s.inCore) s.shielded=true; });
    log(`🛡️ <strong>${activeDef(pid).name}</strong>'s orbs are shielded!`);
    setHint('🛡️ All spheres shielded for this round.');
    finishAction(); return;
  }

  if(outcome.type==='pulse') {
    AudioEngine.power();
    doPulse(pid);
    finishAction(); return;
  }

  if(outcome.type==='swap') {
    setHint('🔄 <strong>SWAP:</strong> Click your orb, then click any opponent orb to trade!');
    btnSkip.disabled=false;
    updateAll(); return;
  }

  // move
  setHint(`👉 <strong>STEP 2:</strong> Click one of your glowing spheres!`);
  btnSkip.disabled = false;
  updateAll();
}

function doPulse(pid) {
  const opponents = GS.players.filter(p=>p!==pid);
  let hits=0;
  GS.spheres[pid].forEach(mine=>{
    if(mine.inOrbit||mine.inCore) return;
    opponents.forEach(oid=>{
      GS.spheres[oid].forEach(enemy=>{
        if(enemy.inOrbit||enemy.inCore||enemy.shielded) return;
        const dr=Math.abs(mine.r-enemy.r), dc=Math.abs(mine.c-enemy.c);
        if(dr<=1&&dc<=1&&(dr+dc>0)) {
          const mr=enemy.r-mine.r, mc=enemy.c-mine.c;
          const tr=Math.max(0,Math.min(GRID-1,enemy.r+Math.sign(mr||1)*2));
          const tc=Math.max(0,Math.min(GRID-1,enemy.c+Math.sign(mc)*2));
          if(tr===CENTER && tc===CENTER) {
            enemy.r = Math.max(0, Math.min(GRID-1, tr > 0 ? tr - 1 : tr + 1));
            enemy.c = tc;
          } else {
            enemy.r = tr;
            enemy.c = tc;
          }
          hits++;
        }
      });
    });
  });
  log(`⚡ <strong>PULSE SHOCKWAVE</strong> — knocked back ${hits} enemy orbs!`);
  setHint(`⚡ Shockwave blasted ${hits} enemies away!`);
}

// ══════════════════════════════════
// ORB INTERACTIONS
// ══════════════════════════════════
function handleOrbClick(orb, pid) {
  if(!GS.currentRoll || GS.rollSpent) return;

  if(GS.currentRoll.type==='swap') {
    if(GS.selectedOrb && pid!==GS.currentTurn) { doSwap(GS.selectedOrb, orb); return; }
    if(pid===GS.currentTurn) {
      GS.selectedOrb = (GS.selectedOrb?.id===orb.id) ? null : orb;
      setHint(GS.selectedOrb ? '🔄 Now click any <strong>opponent orb</strong> to swap!' : '🔄 Pick your orb first.');
      updateAll(); return;
    }
    return;
  }

  if(pid===GS.currentTurn) {
    AudioEngine.move();
    GS.selectedOrb = (GS.selectedOrb?.id===orb.id) ? null : orb;
    setHint(GS.selectedOrb ? '✨ Sphere selected! Click a <strong>glowing tile</strong> to move.' : 'Select a sphere.');
    updateAll();
  }
}

let aiTimer = null;
let aiBusy = false;

function doSwap(myOrb, enemyOrb) {
  if(enemyOrb.shielded) {
    log('❌ Cannot swap with a shielded orb!');
    finishAction();
    return;
  }
  AudioEngine.power();
  [myOrb.r, enemyOrb.r] = [enemyOrb.r, myOrb.r];
  [myOrb.c, enemyOrb.c] = [enemyOrb.c, myOrb.c];
  log(`🔄 <strong>SWAP!</strong> ${activeDef(GS.currentTurn).name} exchanged positions with an opponent.`);
  GS.selectedOrb = null;
  finishAction();
}

function handleCellClick(r,c) {
  if(!GS.selectedOrb||!GS.currentRoll||GS.rollSpent) return;
  const cell=getCell(r,c);
  if(cell?.classList.contains('cell-valid-move')) doMove(r,c);
}

function doMove(r,c) {
  AudioEngine.move();
  const orb=GS.selectedOrb, pid=GS.currentTurn;

  orb.r=r; orb.c=c;

  // Solar Core?
  if(r===CENTER&&c===CENTER) {
    AudioEngine.score();
    orb.inCore=true; GS.scores[pid]++;
    log(`🌟 <strong>${activeDef(pid).name}</strong> scored! (${GS.scores[pid]}/2)`);
    if(GS.scores[pid]>=2) { GS.selectedOrb=null; updateAll(); setTimeout(()=>triggerVictory(pid),400); return; }
  } else {
    // Eclipse capture (check all opponents)
    GS.players.filter(p=>p!==pid).forEach(oid=>{
      const hit=GS.spheres[oid].find(e=>!e.inOrbit&&!e.inCore&&e.r===r&&e.c===c);
      if(hit) {
        if(hit.shielded) { log('🛡️ Shielded orb deflected capture!'); }
        else {
          AudioEngine.capture();
          hit.inOrbit=true;
          log(`🌌 <strong>ECLIPSE!</strong> ${activeDef(oid).name}'s orb banished to Starlight Orbit.`);
        }
      }
    });
    // Rune?
    if(isRune(r,c)) drawCard(pid);
  }

  GS.selectedOrb=null;
  finishAction();
}

function drawCard(pid) {
  AudioEngine.power();
  const card={...CARD_DEFS[Math.floor(Math.random()*CARD_DEFS.length)]};
  GS.cards[pid].push(card);
  log(`✨ ${activeDef(pid).name} drew <strong>${card.name}</strong>!`);
}

function handleRescue() {
  const pid=GS.currentTurn;
  const orb=GS.spheres[pid].find(o=>o.inOrbit);
  if(!orb) return;
  AudioEngine.power();
  orb.inOrbit=false;
  const home=activeDef(pid).sanctuaryCells[0];
  orb.r=home[0]; orb.c=home[1];
  log(`🚀 ${activeDef(pid).name} rescued an orb from Starlight Orbit!`);
  finishAction();
}

// ══════════════════════════════════
// TURN MANAGEMENT
// ══════════════════════════════════
function finishAction() {
  GS.rollSpent = true;
  btnSkip.disabled = false;

  if (GS.bonusRoll) {
    GS.bonusRoll = false;
    GS.rollSpent = false;
    GS.currentRoll = null;
    diceDescEl.textContent = 'EXTRA ROLL (TIME WARP)';
    setHint('⏳ <strong>TIME WARP</strong>: Bonus roll activated!');
    updateAll();

    // If AI's turn, immediately trigger the bonus roll!
    if (aiPlayerIds.includes(GS.currentTurn)) {
      if (aiTimer) clearTimeout(aiTimer);
      aiTimer = setTimeout(doAITurn, 1000);
    }
    return;
  }

  setHint('Turn complete...');
  updateAll();
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(passTurn, 800);
}

function passTurn() {
  if (aiTimer) clearTimeout(aiTimer);
  aiBusy = false;

  // remove shield for current player
  GS.spheres[GS.currentTurn].forEach(s=>s.shielded=false);

  // Advance turn index, skip eliminated
  let next = (GS.turnIndex+1) % GS.count;
  let attempts=0;
  while(GS.eliminated.has(GS.players[next]) && attempts<GS.count) {
    next=(next+1)%GS.count; attempts++;
  }
  GS.turnIndex  = next;
  GS.currentTurn = GS.players[next];
  GS.currentRoll = null;
  GS.rollSpent   = false;
  GS.selectedOrb = null;
  btnSkip.disabled = false; // Always allow manual pass to unblock

  diceFaceEl.textContent='🎲';
  diceDescEl.textContent='CLICK TO ROLL';

  updateAll();

  if(aiPlayerIds.includes(GS.currentTurn)) {
    setHint(`🤖 ${activeDef(GS.currentTurn).name} (AI) is calculating...`);
    aiTimer = setTimeout(doAITurn, 1000);
  } else {
    setHint(`👉 <strong>${activeDef(GS.currentTurn).name}</strong>, click your <strong>Quantum Catalyst</strong> to roll!`);
  }
}

// ══════════════════════════════════
// AI BRAIN
// ══════════════════════════════════
function doAITurn() {
  const pid = GS.currentTurn;
  if (!aiPlayerIds.includes(pid)) return;
  if (aiBusy) return;
  aiBusy = true;

  // Rescue first if possible
  const inOrbit = GS.spheres[pid].filter(o => o.inOrbit);
  if (inOrbit.length > 0 && Math.random() < 0.6) {
    aiBusy = false;
    handleRescue();
    return;
  }

  // Use card if available
  if (GS.cards[pid]?.length > 0 && Math.random() < 0.5) {
    const card = GS.cards[pid].pop();
    card.action(GS);
    updateAll();
  }

  doRoll(outcome => {
    // If shield or pulse, executeRoll already called finishAction()
    if (outcome.type === 'shield' || outcome.type === 'pulse') {
      aiBusy = false;
      return;
    }

    if (outcome.type === 'swap') {
      const myOrbs = GS.spheres[pid].filter(o => !o.inOrbit && !o.inCore);
      const allEnemy = GS.players.filter(p => p !== pid).flatMap(p => GS.spheres[p].filter(o => !o.inOrbit && !o.inCore && !o.shielded));
      if (myOrbs.length && allEnemy.length) {
        // Swap orb furthest from center with enemy closest to center
        setTimeout(() => {
          aiBusy = false;
          doSwap(myOrbs[0], allEnemy[0]);
        }, 700);
      } else {
        aiBusy = false;
        finishAction();
      }
      return;
    }

    // Move step: evaluate ALL active orbs
    const active = GS.spheres[pid].filter(o => !o.inOrbit && !o.inCore);
    if (!active.length) {
      aiBusy = false;
      finishAction();
      return;
    }

    const steps = outcome.val;
    const dirs = [[-steps, 0], [steps, 0], [0, -steps], [0, steps]];
    let bestMove = null;
    let bestOrb = null;
    let minCoreDist = 999;

    // Search every active orb for the optimal step towards center or capturing
    for (const orb of active) {
      dirs.forEach(([dr, dc]) => {
        const tr = orb.r + dr, tc = orb.c + dc;
        if (tr < 0 || tr >= GRID || tc < 0 || tc >= GRID) return;
        const friendly = GS.spheres[pid].some(s => !s.inOrbit && !s.inCore && s.r === tr && s.c === tc);
        if (friendly) return;

        let score = Math.abs(tr - CENTER) + Math.abs(tc - CENTER);
        // Bonus priority if landing on an enemy (eclipse capture)
        const canCapture = GS.players.filter(p => p !== pid).some(op => GS.spheres[op].some(e => !e.inOrbit && !e.inCore && !e.shielded && e.r === tr && e.c === tc));
        if (canCapture) score -= 3;

        if (score < minCoreDist) {
          minCoreDist = score;
          bestMove = { r: tr, c: tc };
          bestOrb = orb;
        }
      });
    }

    if (bestMove && bestOrb) {
      GS.selectedOrb = bestOrb;
      updateAll();
      setTimeout(() => {
        aiBusy = false;
        doMove(bestMove.r, bestMove.c);
      }, 700);
    } else {
      log(`${activeDef(pid).name} has no valid paths.`);
      aiBusy = false;
      finishAction();
    }
  });
}

// ══════════════════════════════════
// VICTORY
// ══════════════════════════════════
function triggerVictory(pid) {
  AudioEngine.score();
  const def=activeDef(pid);
  $('victory-title').textContent = `${def.name} VICTORIOUS!`;
  $('victory-desc').textContent  = `Two celestial spheres absorbed into the Solar Core. ${def.title} reigns supreme!`;
  modalVictory.classList.remove('hidden');
}

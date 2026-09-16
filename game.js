"use strict";
/* =========================================================================
   13 МОДНЫ ПОКЕР — MULTIPLAYER (Supabase: Postgres + Realtime + Anonymous Auth)
   ---------------------------------------------------------------------
   1. SUPABASE CONFIG            — эндээ өөрийн Supabase project-ийн URL/key тавина
   2. ТОГЛООМЫН ЦЭВЭР ЛОГИК      — карт, комбинаци, дийлэх дүрэм
   3. NETWORK LAYER              — өрөө, realtime sync, private hand sync, presence
   4. UI / RENDERING             — дэлгэц солих, карт зурах, event handler-ууд
   ========================================================================= */

/* =========================================================================
   1. SUPABASE CONFIG — ӨӨРИЙН УТГААР СОЛИНО!
   Supabase Dashboard → Project Settings → API хэсгээс copy хийнэ.
   ========================================================================= */
const SUPABASE_URL = "https://keiessfnzgfgarlpqycx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlaWVzc2ZuemdmZ2FybHBxeWN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTY5ODQsImV4cCI6MjEwNTEzMjk4NH0.UiMo5vMnAJovp47HCLEHtJkBMkgDfbgU4TtRy7-XrKs";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =========================================================================
   2. ТОГЛООМЫН ЦЭВЭР ЛОГИК (single-player хувилбартай ижил, туршигдсан)
   ========================================================================= */
const SUITS = ['♠','♥','♣','♦'];
const SUIT_POWER = {'♦':0,'♣':1,'♥':2,'♠':3}; // ♦ < ♣ < ♥ < ♠  (Гэл хамгийн хүчтэй)
const SUIT_NAME_MN = {'♠':'Гэл','♥':'Бунд','♣':'Цэцэг','♦':'Дөрвөлжин'};
const SUIT_CLASS = {'♠':'spade','♥':'heart','♣':'club','♦':'diamond'};
const RANK_ORDER = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RANK_VALUE = {}; RANK_ORDER.forEach((r,i)=>RANK_VALUE[r]=i+3);
const TYPE_LABEL_MN = {
  single:'Ганц', pair:'Хос', set:'Гурвал', straight:'Дараалал',
  flush:'Адил өнгө', poker:'Покер', straightflush:'Straight Flush'
};

function cardFromId(id){
  const suit = id.slice(-1);
  const rank = id.slice(0,-1);
  return {rank,suit,value:RANK_VALUE[rank],suitPower:SUIT_POWER[suit],id};
}
function idsToCards(ids){ return (ids||[]).map(cardFromId); }
function cardsToIds(cards){ return cards.map(c=>c.id); }

function createDeck(){
  const deck=[];
  for(const suit of SUITS) for(const rank of RANK_ORDER)
    deck.push({rank,suit,value:RANK_VALUE[rank],suitPower:SUIT_POWER[suit],id:rank+suit});
  return deck;
}
function shuffleDeck(deck){
  const d=deck.slice();
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
function sortHand(hand){ return hand.slice().sort((a,b)=>a.value-b.value||a.suitPower-b.suitPower); }
function combosOfSize(arr,k){
  const res=[]; const n=arr.length; if(k>n) return res;
  const idx=[]; for(let i=0;i<k;i++) idx.push(i);
  while(true){
    res.push(idx.map(i=>arr[i]));
    let i=k-1; while(i>=0 && idx[i]===n-k+i) i--;
    if(i<0) break;
    idx[i]++; for(let j=i+1;j<k;j++) idx[j]=idx[j-1]+1;
  }
  return res;
}
function getCombination(cards){
  if(!cards||cards.length===0) return null;
  const sorted=cards.slice().sort((a,b)=>a.value-b.value||a.suitPower-b.suitPower);
  const n=sorted.length;
  if(n===1) return {type:'single',cards:sorted,headCard:sorted[0]};
  if(n===2) return sorted[0].value===sorted[1].value ? {type:'pair',cards:sorted,headCard:sorted[1]} : null;
  if(n===3) return (sorted[0].value===sorted[1].value && sorted[1].value===sorted[2].value) ? {type:'set',cards:sorted,headCard:sorted[2]} : null;
  if(n===5){
    const byValue={}; sorted.forEach(c=>{ byValue[c.value]=byValue[c.value]||[]; byValue[c.value].push(c); });
    const groups=Object.values(byValue);
    const sizes=groups.map(g=>g.length).sort((a,b)=>b-a);
    const isFlush=sorted.every(c=>c.suit===sorted[0].suit);
    const isConsecutive=sorted.every((c,i)=>i===0||c.value===sorted[i-1].value+1);
    const allDistinct=groups.length===5;
    if(isConsecutive && allDistinct && isFlush) return {type:'straightflush',cards:sorted,headCard:sorted[4]};
    if(sizes[0]===4){
      const quadGroup=groups.find(g=>g.length===4);
      const head=quadGroup.slice().sort((a,b)=>a.suitPower-b.suitPower)[3];
      return {type:'poker',cards:sorted,headCard:head,quadValue:quadGroup[0].value};
    }
    if(isFlush) return {type:'flush',cards:sorted,headCard:sorted[4]};
    if(isConsecutive && allDistinct) return {type:'straight',cards:sorted,headCard:sorted[4]};
    return null;
  }
  return null;
}
function getCombinationRank(combo){ return combo.type==='poker' ? combo.quadValue : combo.headCard.value; }
function canBeat(prevCombo,newCombo){
  if(!newCombo) return false;
  if(!prevCombo) return true;
  if(prevCombo.type!==newCombo.type) return false;
  const diff=getCombinationRank(newCombo)-getCombinationRank(prevCombo);
  if(diff!==0) return diff>0;
  return newCombo.headCard.suitPower>prevCombo.headCard.suitPower;
}
function calculatePenalty(len){
  if(len>=1&&len<=9) return len;
  if(len===10) return 20; if(len===11) return 22; if(len===12) return 24;
  if(len===13) return 'INSTANT_LOSS';
  return 0;
}
function hasCard(cards,rank,suit){ return cards.some(c=>c.rank===rank&&c.suit===suit); }

/* =========================================================================
   3. NETWORK LAYER (Supabase)
   ========================================================================= */
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I адилхан харагддаг тэмдэгтийг хассан
function generateRoomCode(){
  let s='';
  for(let i=0;i<5;i++) s+=ROOM_CODE_CHARS[Math.floor(Math.random()*ROOM_CODE_CHARS.length)];
  return s;
}

const Net = {
  uid:null, name:'', roomId:null, mySeat:null, isHost:false,
  roomRow:null, playersRows:[], gameRow:null,
  room:null, myHand:[],
  channel:null, onlineUids:new Set()
};

function saveSession(){ try{ localStorage.setItem('poker13_roomId', Net.roomId||''); }catch(e){} }
function loadSession(){ try{ return localStorage.getItem('poker13_roomId')||null; }catch(e){ return null; } }
function clearSession(){ try{ localStorage.removeItem('poker13_roomId'); }catch(e){} }

async function authInit(cb){
  const { data:{ session } } = await supabase.auth.getSession();
  if(session){ Net.uid=session.user.id; cb(); return; }
  const { data, error } = await supabase.auth.signInAnonymously();
  if(error){ showFatal('Supabase холболт амжилтгүй: '+error.message+' (Anonymous sign-in идэвхжсэн эсэхийг шалгана уу)'); return; }
  Net.uid=data.user.id; cb();
}

function findFreeSeat(playersRows){
  const used=new Set(playersRows.map(p=>p.seat));
  for(let s=0;s<4;s++) if(!used.has(s)) return s;
  return -1;
}

async function createRoom(name){
  Net.name=name;
  for(let attempt=0; attempt<8; attempt++){
    const code=generateRoomCode();
    const { data:existing } = await supabase.from('rooms').select('id').eq('id',code).maybeSingle();
    if(existing) continue;
    const { error:roomErr } = await supabase.from('rooms').insert({ id:code, host_uid:Net.uid, status:'lobby', round:1 });
    if(roomErr) throw new Error(roomErr.message);
    const { error:playerErr } = await supabase.from('room_players').insert({ room_id:code, uid:Net.uid, name, seat:0, connected:true, is_host:true, hand_count:0, total_score:0 });
    if(playerErr) throw new Error(playerErr.message);
    Net.roomId=code; Net.mySeat=0; Net.isHost=true;
    saveSession();
    await enterRoom();
    return code;
  }
  throw new Error('Өрөөний код үүсгэж чадсангүй, дахин оролдоно уу.');
}

async function joinRoom(code, name){
  code=code.trim().toUpperCase();
  const { data:roomRow, error:roomErr } = await supabase.from('rooms').select('*').eq('id',code).maybeSingle();
  if(roomErr || !roomRow) throw new Error('Ийм кодтой өрөө олдсонгүй.');

  const { data:existingMe } = await supabase.from('room_players').select('*').eq('room_id',code).eq('uid',Net.uid).maybeSingle();
  if(existingMe){
    Net.roomId=code; Net.mySeat=existingMe.seat; Net.isHost=!!existingMe.is_host; Net.name=existingMe.name;
    await supabase.from('room_players').update({connected:true}).eq('room_id',code).eq('uid',Net.uid);
    saveSession(); await enterRoom();
    return code;
  }

  if(roomRow.status!=='lobby') throw new Error('Тоглоом аль хэдийн эхэлсэн тул нэвтрэх боломжгүй.');
  const { data:playersRows } = await supabase.from('room_players').select('*').eq('room_id',code);
  const seat=findFreeSeat(playersRows||[]);
  if(seat===-1) throw new Error('Өрөө дүүрсэн байна (4/4).');

  Net.name=name;
  const { error:insErr } = await supabase.from('room_players').insert({ room_id:code, uid:Net.uid, name, seat, connected:true, is_host:false, hand_count:0, total_score:0 });
  if(insErr) throw new Error(insErr.message);
  Net.roomId=code; Net.mySeat=seat; Net.isHost=false;
  saveSession(); await enterRoom();
  return code;
}

async function enterRoom(){
  await refreshAll();
  subscribeRealtime();
}

async function refreshAll(){
  const [{data:roomRow}, {data:players}, {data:gameRow}, {data:handRow}] = await Promise.all([
    supabase.from('rooms').select('*').eq('id',Net.roomId).maybeSingle(),
    supabase.from('room_players').select('*').eq('room_id',Net.roomId),
    supabase.from('room_game').select('*').eq('room_id',Net.roomId).maybeSingle(),
    supabase.from('room_hands').select('*').eq('room_id',Net.roomId).eq('uid',Net.uid).maybeSingle()
  ]);
  if(!roomRow){ onRoomDeleted(); return; }
  Net.roomRow=roomRow;
  Net.playersRows=players||[];
  Net.gameRow=gameRow||null;
  Net.myHand = idsToCards((handRow&&handRow.cards)||[]);
  renderHand();
  pushRoomUpdate();
}

function subscribeRealtime(){
  if(Net.channel) return;
  const channel = supabase.channel('room-'+Net.roomId, { config:{ presence:{ key:Net.uid } } });

  channel.on('postgres_changes', {event:'*', schema:'public', table:'rooms', filter:'id=eq.'+Net.roomId}, payload=>{
    if(payload.eventType==='DELETE'){ onRoomDeleted(); return; }
    Net.roomRow=payload.new; pushRoomUpdate();
  });
  channel.on('postgres_changes', {event:'*', schema:'public', table:'room_players', filter:'room_id=eq.'+Net.roomId}, payload=>{
    applyPlayerChange(payload); pushRoomUpdate();
  });
  channel.on('postgres_changes', {event:'*', schema:'public', table:'room_game', filter:'room_id=eq.'+Net.roomId}, payload=>{
    Net.gameRow=payload.new; pushRoomUpdate();
  });
  channel.on('postgres_changes', {event:'*', schema:'public', table:'room_hands', filter:'room_id=eq.'+Net.roomId}, payload=>{
    // RLS-ийн ачаар зөвхөн миний мөрийг л энд хүлээж авна (бусдын гар network-ээр ирэхгүй)
    if(payload.new && payload.new.uid===Net.uid){ Net.myHand=idsToCards(payload.new.cards||[]); renderHand(); }
  });
  channel.on('postgres_changes', {event:'INSERT', schema:'public', table:'room_chat', filter:'room_id=eq.'+Net.roomId}, payload=>{
    appendChatMessage(payload.new);
  });

  channel.on('presence', {event:'sync'}, ()=>{
    const state=channel.presenceState();
    const online=new Set();
    Object.values(state).forEach(arr=>arr.forEach(p=>online.add(p.uid)));
    Net.onlineUids=online;
    pushRoomUpdate();
  });
  channel.on('presence', {event:'join'}, ({newPresences})=>{
    newPresences.forEach(p=>{ if(p.uid!==Net.uid) pushSystemNoticeLocal((p.name||'Тоглогч')+' холбогдлоо'); });
  });
  channel.on('presence', {event:'leave'}, ({leftPresences})=>{
    leftPresences.forEach(p=>{ if(p.uid!==Net.uid) pushSystemNoticeLocal((p.name||'Тоглогч')+' холболт тасарлаа'); });
  });

  channel.subscribe(async status=>{
    if(status==='SUBSCRIBED'){
      await channel.track({uid:Net.uid, name:Net.name, seat:Net.mySeat});
      setConnIndicator(true);
    } else if(status==='CLOSED' || status==='CHANNEL_ERROR' || status==='TIMED_OUT'){
      setConnIndicator(false);
    }
  });

  Net.channel=channel;
}

function applyPlayerChange(payload){
  const row = payload.new || payload.old;
  if(payload.eventType==='DELETE'){
    Net.playersRows=Net.playersRows.filter(p=>p.uid!==row.uid);
  } else {
    const idx=Net.playersRows.findIndex(p=>p.uid===row.uid);
    if(idx>=0) Net.playersRows[idx]=payload.new; else Net.playersRows.push(payload.new);
  }
}

function assembleRoom(){
  if(!Net.roomRow) return null;
  const players={};
  Net.playersRows.forEach(p=>{
    players[p.uid]={
      name:p.name, seat:p.seat,
      connected: Net.onlineUids.size ? Net.onlineUids.has(p.uid) : p.connected,
      isHost:p.is_host, handCount:p.hand_count, totalScore:p.total_score
    };
  });
  let game=null;
  if(Net.gameRow){
    const g=Net.gameRow;
    game={
      currentPlayerSeat:g.current_player_seat, currentCombo:g.current_combo,
      lastPlayerSeat:g.last_player_seat, passedSeats:g.passed_seats,
      firstMoveOfRound:g.first_move_of_round, startingPlayerSeat:g.starting_player_seat,
      roundWinnerSeat:g.round_winner_seat, instantLoserSeat:g.instant_loser_seat, gameOverSeat:g.game_over_seat
    };
  }
  return { code:Net.roomRow.id, hostUid:Net.roomRow.host_uid, status:Net.roomRow.status, round:Net.roomRow.round, players, game };
}
function pushRoomUpdate(){
  Net.room=assembleRoom();
  if(!Net.room) return;
  onRoomUpdate(Net.room);
}

async function leaveRoom(){
  if(!Net.roomId) return;
  try{
    const room=Net.room;
    if(room && room.status==='lobby'){
      await supabase.from('room_players').delete().eq('room_id',Net.roomId).eq('uid',Net.uid);
    } else {
      await supabase.from('room_players').update({connected:false}).eq('room_id',Net.roomId).eq('uid',Net.uid);
      pushChat(Net.name+' тоглоомоос гарлаа', true);
    }
  }catch(e){}
  if(Net.channel){ await Net.channel.untrack(); supabase.removeChannel(Net.channel); Net.channel=null; }
  clearSession();
  Net.roomId=null; Net.mySeat=null; Net.isHost=false; Net.room=null; Net.myHand=[]; Net.onlineUids=new Set();
  showScreen('home');
}

/* ---------- host: тоглоом эхлүүлэх / шинэ раунд / шинэ тоглоом ---------- */
async function hostStartGame(){
  if(!Net.isHost) return;
  const players=Net.room.players||{};
  if(Object.keys(players).length<4){ setLobbyMessage('4 тоглогч бүрдээгүй байна.'); return; }
  await dealNewRound(1, resetScores(players));
}
function resetScores(players){ const upd={}; Object.keys(players).forEach(uid=>upd[uid]=0); return upd; }

async function dealNewRound(roundNum, scoreOverride){
  const players=Net.room.players||{};
  const seatToUid={};
  Object.entries(players).forEach(([uid,p])=>seatToUid[p.seat]=uid);

  const deck=shuffleDeck(createDeck());
  const hands=[[],[],[],[]];
  deck.forEach((c,i)=>hands[i%4].push(c.id));
  let startingSeat=0;
  for(let s=0;s<4;s++) if(hands[s].includes('3♦')) startingSeat=s;

  for(let s=0;s<4;s++){
    const uid=seatToUid[s];
    if(!uid) continue;
    await supabase.from('room_hands').upsert({room_id:Net.roomId, uid, cards:hands[s]});
    const upd={hand_count:13};
    if(scoreOverride) upd.total_score=scoreOverride[uid]||0;
    await supabase.from('room_players').update(upd).eq('room_id',Net.roomId).eq('uid',uid);
  }
  await supabase.from('room_game').upsert({
    room_id:Net.roomId,
    current_player_seat:startingSeat, current_combo:null, last_player_seat:null,
    passed_seats:{0:false,1:false,2:false,3:false}, first_move_of_round:true,
    starting_player_seat:startingSeat, round_winner_seat:null, instant_loser_seat:null, game_over_seat:null
  });
  await supabase.from('rooms').update({status:'playing', round:roundNum}).eq('id',Net.roomId);
}

/* ---------- play / pass (зөвхөн ээлжтэй тоглогч дуудна) ---------- */
async function submitPlay(cards, combo){
  const newHandIds=cardsToIds(Net.myHand.filter(c=>!cards.some(sc=>sc.id===c.id)));

  await supabase.from('room_hands').update({cards:newHandIds}).eq('room_id',Net.roomId).eq('uid',Net.uid);
  await supabase.from('room_players').update({hand_count:newHandIds.length}).eq('room_id',Net.roomId).eq('uid',Net.uid);

  const gameUpd={
    current_combo:{ type:combo.type, cardIds:cardsToIds(combo.cards), seat:Net.mySeat },
    last_player_seat:Net.mySeat,
    passed_seats:{0:false,1:false,2:false,3:false},
    first_move_of_round:false
  };

  if(newHandIds.length===0){
    gameUpd.round_winner_seat=Net.mySeat;
    let instantLoser=-1;
    const scoreUpdates=[];
    Object.entries(Net.room.players).forEach(([uid,p])=>{
      if(p.seat===Net.mySeat) return;
      const pen=calculatePenalty(p.handCount);
      if(pen==='INSTANT_LOSS') instantLoser=p.seat;
      else scoreUpdates.push({uid, total:(p.totalScore||0)+pen});
    });
    if(instantLoser>=0) gameUpd.instant_loser_seat=instantLoser;
    await supabase.from('rooms').update({status:'roundEnd'}).eq('id',Net.roomId);
    for(const su of scoreUpdates){
      await supabase.from('room_players').update({total_score:su.total}).eq('room_id',Net.roomId).eq('uid',su.uid);
    }
  } else {
    gameUpd.current_player_seat=nextActiveSeat(Net.mySeat);
  }
  await supabase.from('room_game').update(gameUpd).eq('room_id',Net.roomId);
}

async function submitPass(){
  const g=Net.room.game;
  const passed=Object.assign({}, g.passedSeats, {[Net.mySeat]:true});
  const passCount=Object.values(passed).filter(Boolean).length;
  let upd;
  if(passCount>=3){
    upd={ current_combo:null, passed_seats:{0:false,1:false,2:false,3:false}, current_player_seat:g.lastPlayerSeat };
  } else {
    upd={ passed_seats:passed, current_player_seat:nextActiveSeat(Net.mySeat) };
  }
  await supabase.from('room_game').update(upd).eq('room_id',Net.roomId);
}
function nextActiveSeat(seat){ return (seat+1)%4; }

async function hostContinueAfterRound(){
  if(!Net.isHost) return;
  const g=Net.room.game;
  if(g.instantLoserSeat!==null && g.instantLoserSeat!==undefined){
    await supabase.from('rooms').update({status:'gameOver'}).eq('id',Net.roomId);
    await supabase.from('room_game').update({game_over_seat:g.instantLoserSeat}).eq('room_id',Net.roomId);
    return;
  }
  const players=Net.room.players;
  let loserUid=null;
  Object.entries(players).forEach(([uid,p])=>{ if((p.totalScore||0)>=30){ if(!loserUid || p.totalScore>players[loserUid].totalScore) loserUid=uid; } });
  if(loserUid){
    await supabase.from('rooms').update({status:'gameOver'}).eq('id',Net.roomId);
    await supabase.from('room_game').update({game_over_seat:players[loserUid].seat}).eq('room_id',Net.roomId);
    return;
  }
  await dealNewRound((Net.room.round||1)+1, null);
}
async function hostRestartGame(){
  if(!Net.isHost) return;
  await dealNewRound(1, resetScores(Net.room.players));
}

/* ---------- host migration (presence ашиглан) ---------- */
async function maybeClaimHost(){
  if(!Net.room || !Net.roomId) return;
  const players=Net.room.players||{};
  const host=players[Net.room.hostUid];
  if(host && host.connected) return;
  const connected=Object.entries(players).filter(([uid,p])=>p.connected);
  if(connected.length===0) return;
  connected.sort((a,b)=>a[1].seat-b[1].seat);
  const [candidateUid]=connected[0];
  if(candidateUid===Net.uid){
    await supabase.from('rooms').update({host_uid:Net.uid}).eq('id',Net.roomId);
    await supabase.from('room_players').update({is_host:true}).eq('room_id',Net.roomId).eq('uid',Net.uid);
  }
}

/* ---------- chat ---------- */
function pushChat(text, systemOnly){
  supabase.from('room_chat').insert({
    room_id:Net.roomId, uid: systemOnly?'system':Net.uid, name: systemOnly?'':Net.name,
    text, system:!!systemOnly
  });
}

/* =========================================================================
   4. UI / RENDERING
   ========================================================================= */
const $ = id=>document.getElementById(id);
let selected=[];
let currentScreen='home';
let joinPanelOpen=false;

function showScreen(name){
  currentScreen=name;
  ['home','room','game'].forEach(s=>{
    const el=$('screen-'+s);
    if(el) el.classList.toggle('active', s===name);
  });
}
function showFatal(msg){ $('homeError').textContent=msg; }
function setLobbyMessage(msg){ $('roomError').textContent=msg||''; }
function setConnIndicator(online){
  const el=$('connIndicator');
  if(!el) return;
  el.textContent = online ? '🟢 ONLINE' : '🔴 CONNECTION LOST';
  el.className = 'conn-indicator '+(online?'online':'offline');
}

/* ---------- lobby home ---------- */
$('createRoomBtn').addEventListener('click', async ()=>{
  const name=$('nameInput').value.trim();
  if(!name){ showFatal('Нэрээ оруулна уу.'); return; }
  $('createRoomBtn').disabled=true;
  try{ await createRoom(name); }catch(e){ showFatal(e.message); }
  $('createRoomBtn').disabled=false;
});
$('showJoinBtn').addEventListener('click', ()=>{
  joinPanelOpen=!joinPanelOpen;
  $('joinPanel').classList.toggle('show', joinPanelOpen);
});
$('joinConfirmBtn').addEventListener('click', async ()=>{
  const name=$('nameInput').value.trim();
  const code=$('joinCodeInput').value.trim();
  if(!name){ showFatal('Нэрээ оруулна уу.'); return; }
  if(!code){ showFatal('Өрөөний кодоо оруулна уу.'); return; }
  $('joinConfirmBtn').disabled=true;
  try{ await joinRoom(code, name); }catch(e){ showFatal(e.message); }
  $('joinConfirmBtn').disabled=false;
});

/* ---------- room lobby ---------- */
$('copyCodeBtn').addEventListener('click', ()=>{
  const code=Net.roomId;
  if(!code) return;
  navigator.clipboard && navigator.clipboard.writeText(code).catch(()=>{});
  $('copyCodeBtn').textContent='Хуулсан ✓';
  setTimeout(()=>{ $('copyCodeBtn').textContent='КОД ХУУЛАХ'; },1500);
});
$('startGameBtn').addEventListener('click', ()=>hostStartGame());
$('leaveRoomBtnLobby').addEventListener('click', ()=>leaveRoom());

/* ---------- in-game ---------- */
$('leaveRoomBtnGame').addEventListener('click', ()=>{ if(confirm('Тоглолтын дунд гарах уу?')) leaveRoom(); });
$('playBtn').addEventListener('click', attemptPlay);
$('passBtn').addEventListener('click', attemptPass);
$('nextRoundBtn').addEventListener('click', ()=>hostContinueAfterRound());
$('restartBtn').addEventListener('click', ()=>hostRestartGame());
$('settingsBtn').addEventListener('click', ()=>$('helpOverlay').classList.add('show'));
$('closeHelpBtn').addEventListener('click', ()=>$('helpOverlay').classList.remove('show'));
$('helpOverlay').addEventListener('click', e=>{ if(e.target===$('helpOverlay')) $('helpOverlay').classList.remove('show'); });

$('chatSendBtn').addEventListener('click', sendChatFromInput);
$('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatFromInput(); });
function sendChatFromInput(){
  const val=$('chatInput').value.trim();
  if(!val) return;
  pushChat(val);
  $('chatInput').value='';
}
function appendChatMessage(msg){
  const box=$('chatMessages');
  const row=document.createElement('div');
  row.className='chat-row'+(msg.system?' system':'');
  if(msg.system) row.innerHTML='<span class="chat-sys">'+escapeHtml(msg.text)+'</span>';
  else row.innerHTML='<span class="chat-name">'+escapeHtml(msg.name)+':</span> <span class="chat-text">'+escapeHtml(msg.text)+'</span>';
  box.appendChild(row);
  box.scrollTop=box.scrollHeight;
}
function pushSystemNoticeLocal(text){
  const box=$('chatMessages');
  if(!box) return;
  const row=document.createElement('div');
  row.className='chat-row system';
  row.innerHTML='<span class="chat-sys">'+escapeHtml(text)+'</span>';
  box.appendChild(row);
  box.scrollTop=box.scrollHeight;
}
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- card element ---------- */
function cardEl(card){
  const d=document.createElement('div');
  d.className='card '+SUIT_CLASS[card.suit];
  d.innerHTML =
    '<div class="corner top"><div class="rank">'+card.rank+'</div><div class="suit-corner">'+card.suit+'</div></div>'+
    '<div class="suit-center">'+card.suit+'</div>'+
    '<div class="corner bottom"><div class="rank">'+card.rank+'</div><div class="suit-corner">'+card.suit+'</div></div>';
  return d;
}

/* ---------- main room update handler ---------- */
function onRoomUpdate(room){
  if(room.status==='lobby'){ showScreen('room'); renderLobbyRoom(room); }
  else { showScreen('game'); renderGameScreen(room); }
  maybeClaimHost();
}
function onRoomDeleted(){
  alert('Өрөө устгагдсан байна.');
  clearSession();
  showScreen('home');
}

/* ---------- lobby room rendering ---------- */
function renderLobbyRoom(room){
  $('roomCodeDisplay').textContent=room.code;
  const list=$('playerList');
  list.innerHTML='';
  const players=room.players||{};
  const bySeat=Object.entries(players).sort((a,b)=>a[1].seat-b[1].seat);
  bySeat.forEach(([uid,p])=>{
    const row=document.createElement('div');
    row.className='player-row'+(p.connected?'':' offline');
    row.innerHTML =
      '<span class="p-num">'+(p.seat+1)+'.</span>'+
      '<span class="p-name">'+escapeHtml(p.name)+(p.isHost?' — HOST':'')+'</span>'+
      '<span class="p-status">'+(p.connected?'READY':'ОФФЛАЙН')+'</span>';
    list.appendChild(row);
  });
  for(let i=bySeat.length;i<4;i++){
    const row=document.createElement('div');
    row.className='player-row empty';
    row.innerHTML='<span class="p-num">'+(i+1)+'.</span><span class="p-name">Хүлээж байна…</span>';
    list.appendChild(row);
  }
  $('startGameBtn').style.display = Net.isHost ? 'block' : 'none';
  $('startGameBtn').disabled = bySeat.length<4;
  $('waitingHostNote').style.display = (!Net.isHost && bySeat.length===4) ? 'block' : 'none';
}

/* ---------- relative seat mapping ---------- */
function relPos(seat){ const rel=(seat-Net.mySeat+4)%4; return ['bottom','right','top','left'][rel]; }
function seatOfPos(pos){ const order=['bottom','right','top','left']; return (Net.mySeat+order.indexOf(pos))%4; }
function playerBySeat(room,seat){
  const players=room.players||{};
  for(const uid of Object.keys(players)) if(players[uid].seat===seat) return {uid,...players[uid]};
  return null;
}

/* ---------- game screen rendering ---------- */
function renderGameScreen(room){
  const g=room.game;
  if(!g) return;
  $('roundNum').textContent=room.round;
  const curPlayer=playerBySeat(room,g.currentPlayerSeat);
  $('turnName').textContent = curPlayer ? (curPlayer.uid===Net.uid?'Таны ээлж':curPlayer.name+' ээлж') : '—';

  ['top','left','right'].forEach(pos=>{
    const seat=seatOfPos(pos);
    const p=playerBySeat(room,seat);
    const slot=$('slot-'+pos);
    if(!p){ slot.querySelector('.ai-name').textContent='—'; slot.querySelector('.card-count-badge').textContent='0 хөзөр'; return; }
    slot.querySelector('.ai-name').textContent=p.name+(p.connected?'':' (тасарсан)');
    slot.querySelector('.avatar-ring').textContent=(p.name||'?').charAt(0).toUpperCase();
    slot.querySelector('.card-count-badge').textContent=(p.handCount||0)+' хөзөр';
    slot.classList.toggle('active', g.currentPlayerSeat===seat);
    const pill=slot.querySelector('.status-pill');
    if(g.passedSeats && g.passedSeats[seat] && g.currentCombo){ pill.textContent='PASS'; pill.className='status-pill pass show'; }
    else if(g.lastPlayerSeat===seat && g.currentCombo){ pill.textContent='ТАВИЛАА'; pill.className='status-pill show'; }
    else pill.className='status-pill';
    slot.classList.toggle('offline', !p.connected);
  });

  const me=playerBySeat(room,Net.mySeat);
  $('humanCount').textContent=(me?me.handCount:Net.myHand.length)+' хөзөр';
  $('humanStrip').classList.toggle('active', g.currentPlayerSeat===Net.mySeat);

  const played=$('playedCards');
  played.innerHTML='';
  if(!g.currentCombo){
    played.innerHTML='<div class="empty-table-hint">'+(g.firstMoveOfRound?'3♦-тэй тоглогч эхэлнэ':'Шинэ тойрог — дурын комбинациар эхэлнэ')+'</div>';
    $('comboName').textContent='';
    $('lastPlayerLabel').textContent = g.firstMoveOfRound ? '' : 'Шинэ тойрог';
  } else {
    idsToCards(g.currentCombo.cardIds).forEach(c=>played.appendChild(cardEl(c)));
    $('comboName').textContent=TYPE_LABEL_MN[g.currentCombo.type];
    const p=playerBySeat(room,g.currentCombo.seat);
    $('lastPlayerLabel').textContent=(p&&p.uid===Net.uid?'Та':(p?p.name:''))+' тавьсан';
  }

  renderHand();
  renderControls(room);

  if(room.status==='roundEnd') showRoundResult(room); else $('roundOverlay').classList.remove('show');
  if(room.status==='gameOver') showGameOver(room); else $('gameOverOverlay').classList.remove('show');
}

function renderHand(){
  if(!Net.room || Net.room.status!=='playing'){ const hr=$('handRow'); if(hr) hr.innerHTML=''; return; }
  const hand=sortHand(Net.myHand);
  const row=$('handRow');
  row.innerHTML='';
  hand.forEach(card=>{
    const el=cardEl(card);
    if(selected.some(c=>c.id===card.id)) el.classList.add('selected');
    el.addEventListener('click', ()=>toggleSelect(card));
    row.appendChild(el);
  });
}
function toggleSelect(card){
  const idx=selected.findIndex(c=>c.id===card.id);
  if(idx>=0) selected.splice(idx,1); else selected.push(card);
  setMessage('');
  renderHand();
}
function setMessage(text,ok){
  const el=$('messageBar');
  el.textContent=text||'';
  el.classList.toggle('ok',!!ok);
}
function renderControls(room){
  const g=room.game;
  const myTurn = g.currentPlayerSeat===Net.mySeat && room.status==='playing';
  $('playBtn').disabled=!myTurn;
  $('passBtn').disabled=!myTurn || !g.currentCombo;
}

/* ---------- play / pass validation (client-side) ---------- */
function validationMessageFor(sel){
  const len=sel.length;
  if(len===0) return 'Хамгийн багадаа 1 хөзөр сонгоно уу';
  if(len===4) return '4 хөзөр сонгож болохгүй. Poker бол 5 хөзөр сонгоно уу';
  const combo=getCombination(sel);
  if(!combo){
    if(len===2) return 'Ижил утгатай 2 хөзөр сонгоно уу (Хос)';
    if(len===3) return 'Ижил утгатай 3 хөзөр сонгоно уу (Гурвал)';
    if(len===5) return '5 хөзөр нь Дараалал, Адил өнгө, Покер, Straight Flush-ийн аль нэг байх ёстой';
    return 'Буруу тооны хөзөр сонгосон байна (1, 2, 3 эсвэл 5)';
  }
  return null;
}
function attemptPlay(){
  const room=Net.room, g=room.game;
  if(g.currentPlayerSeat!==Net.mySeat){ setMessage('Таны ээлж биш байна'); return; }
  const err=validationMessageFor(selected);
  if(err){ setMessage(err); return; }
  const combo=getCombination(selected);
  if(g.firstMoveOfRound && Net.mySeat===g.startingPlayerSeat){
    if(!hasCard(selected,'3','♦')){ setMessage('3♦ агуулсан комбинаци сонгоно уу'); return; }
  }
  if(g.currentCombo){
    const prevCombo=getCombination(idsToCards(g.currentCombo.cardIds));
    if(combo.type!==g.currentCombo.type){ setMessage(TYPE_LABEL_MN[g.currentCombo.type]+' шаардлагатай'); return; }
    if(!canBeat(prevCombo,combo)){ setMessage('Өмнөх комбинацийг дийлэхгүй байна'); return; }
  }
  selected=[];
  setMessage('');
  submitPlay(combo.cards, combo).catch(e=>setMessage('Алдаа: '+e.message));
}
function attemptPass(){
  const room=Net.room, g=room.game;
  if(g.currentPlayerSeat!==Net.mySeat){ setMessage('Таны ээлж биш байна'); return; }
  if(!g.currentCombo){ setMessage('Шинэ тойргийг та эхлүүлэх ёстой тул PASS хийх боломжгүй'); return; }
  submitPass().catch(e=>setMessage('Алдаа: '+e.message));
}

/* ---------- round / game-over modals ---------- */
function showRoundResult(room){
  const g=room.game;
  const winner=playerBySeat(room,g.roundWinnerSeat);
  $('roundWinnerName').textContent=(winner&&winner.uid===Net.uid?'Та':(winner?winner.name:''))+' раундыг хожлоо';
  const box=$('roundResults'); box.innerHTML='';
  [0,1,2,3].map(s=>playerBySeat(room,s)).filter(Boolean).forEach(p=>{
    const row=document.createElement('div');
    const isWinner=p.seat===g.roundWinnerSeat;
    row.className='result-row'+(isWinner?' winner':'');
    row.innerHTML='<span class="name">'+escapeHtml(p.name)+'</span><span class="pts">'+(isWinner?'0 карт — 0 оноо':p.handCount+' карт (нийт '+p.totalScore+' оноо)')+'</span>';
    box.appendChild(row);
  });
  $('nextRoundBtn').style.display = Net.isHost ? 'block' : 'none';
  $('waitingHostRound').style.display = Net.isHost ? 'none' : 'block';
  $('roundOverlay').classList.add('show');
}
function showGameOver(room){
  const g=room.game;
  const loser=playerBySeat(room,g.gameOverSeat);
  $('loserName').textContent = loser ? loser.name : '—';
  $('loserScore').textContent = loser ? ('Нийт оноо: '+loser.totalScore) : '';
  const box=$('finalResults'); box.innerHTML='';
  [0,1,2,3].map(s=>playerBySeat(room,s)).filter(Boolean).forEach(p=>{
    const row=document.createElement('div');
    row.className='result-row';
    row.innerHTML='<span class="name">'+escapeHtml(p.name)+'</span><span class="pts">'+p.totalScore+' оноо</span>';
    box.appendChild(row);
  });
  $('restartBtn').style.display = Net.isHost ? 'block' : 'none';
  $('waitingHostOver').style.display = Net.isHost ? 'none' : 'block';
  $('gameOverOverlay').classList.add('show');
}

/* =========================================================================
   INIT
   ========================================================================= */
authInit(async ()=>{
  const savedRoomId=loadSession();
  if(savedRoomId){
    const { data:me } = await supabase.from('room_players').select('*').eq('room_id',savedRoomId).eq('uid',Net.uid).maybeSingle();
    if(me){
      Net.roomId=savedRoomId; Net.mySeat=me.seat; Net.isHost=!!me.is_host; Net.name=me.name;
      await supabase.from('room_players').update({connected:true}).eq('room_id',savedRoomId).eq('uid',Net.uid);
      await enterRoom();
      return;
    }
    clearSession();
  }
});

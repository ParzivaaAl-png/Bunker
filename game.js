// BUNKER Game Logic Engine

// Global State
let peer = null;
let hostConn = null; // Client's connection to the host
let clientConns = {}; // Host's connections to clients (peerId -> Connection)
let activeCalls = {}; // Active WebRTC calls (peerId -> Call)
let localStream = null;
let myPeerId = "";
let isHost = false;
let userMutedSelf = true; // By default, user starts muted
let gameTimerInterval = null;

let gameState = {
  roomCode: "",
  status: "lobby", // lobby, discussion_X, voting_X, defense, game_over
  players: [], // { id, nickname, isHost, isAlive, hasImmunity, cards, revealed, specials, vote, micMuted }
  catastrophe: null,
  bunker: null,
  round: 1,
  activeSpeakerId: "",
  activeSpeakerTime: 60,
  nominees: [], // players nominated for expulsion
  defenseIdx: 0, // index of nominee currently speaking
  votingActive: false,
  logs: []
};

// Available decks for host
let hostDecks = {};

// On window load
window.addEventListener("DOMContentLoaded", () => {
  initUIEvents();
  checkUrlHashForRoom();
  if (window.init3D) {
    window.init3D();
  }
});

// Check if room code is in the URL hash (e.g. #A7B8)
function checkUrlHashForRoom() {
  const hash = window.location.hash.substring(1).toUpperCase();
  if (hash && hash.length === 4) {
    document.getElementById("input-room-code").value = hash;
  }
}

// -----------------------------------------------------------------------------
// 1. PeerJS & NETWORK CONNECTION
// -----------------------------------------------------------------------------

function initPeer(role, nickname, roomCode) {
  const statusEl = document.getElementById("connection-status");
  statusEl.innerHTML = `<span class="status-dot connecting"></span> Подключение к серверу...`;
  statusEl.className = "connection-status";

  // Create Peer ID
  let peerId = "";
  if (role === "host") {
    peerId = `bunker-room-${roomCode}`;
    isHost = true;
  } else {
    // Random suffix to prevent ID conflicts on reconnection
    const rand = Math.floor(Math.random() * 1000);
    peerId = `bunker-player-${roomCode}-${nickname}-${rand}`;
    isHost = false;
  }

  myPeerId = peerId;

  // Initialize PeerJS
  peer = new Peer(peerId, {
    host: "0.peerjs.com",
    port: 443,
    secure: true,
    debug: 1 // Print only errors to console
  });

  peer.on("open", (id) => {
    console.log("Connected to PeerJS signaling server as:", id);
    statusEl.innerHTML = `<span class="status-dot online"></span> Подключено. Код: ${roomCode}`;
    
    // Auto request microphone access
    initMicrophone();

    if (isHost) {
      setupHostLobby(nickname, roomCode);
    } else {
      setupClientLobby(nickname, roomCode);
    }
  });

  peer.on("error", (err) => {
    console.error("PeerJS error:", err);
    if (err.type === "id-taken" && role === "host") {
      showNotification("Ошибка: Комната с таким кодом уже создана. Попробуйте войти как игрок.");
      statusEl.innerHTML = `<span class="status-dot offline"></span> Ошибка: комната занята`;
      resetConnection();
    } else if (err.type === "peer-unavailable") {
      showNotification("Ошибка: Комната не найдена. Проверьте код.");
      statusEl.innerHTML = `<span class="status-dot offline"></span> Комната не найдена`;
      resetConnection();
    } else {
      showNotification("Ошибка подключения: " + err.message);
      statusEl.innerHTML = `<span class="status-dot offline"></span> Сбой сети`;
    }
  });

  // Listen for incoming audio calls (mesh voice chat)
  peer.on("call", (call) => {
    console.log("Incoming WebRTC call from:", call.peer);
    call.answer(localStream);
    handleCall(call, call.peer);
  });
}

function resetConnection() {
  if (peer) {
    peer.destroy();
    peer = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  clearInterval(gameTimerInterval);
  hostConn = null;
  clientConns = {};
  activeCalls = {};
  myPeerId = "";
  isHost = false;
  
  // Clear audio DOM
  document.getElementById("audio-streams-container").innerHTML = "";

  // Reset UI screens
  document.getElementById("screen-lobby").className = "screen active";
  document.getElementById("screen-game").className = "screen";
  document.getElementById("lobby-waiting-panel").className = "lobby-card card-glass hidden";
}

// HOST SETUPS
function setupHostLobby(nickname, roomCode) {
  gameState.roomCode = roomCode;
  // Add host player
  gameState.players = [{
    id: myPeerId,
    nickname: nickname,
    isHost: true,
    isAlive: true,
    hasImmunity: false,
    cards: {},
    revealed: {},
    specials: [],
    vote: null,
    micMuted: true
  }];
  
  // Listen for client data connections
  peer.on("connection", (conn) => {
    setupHostConnection(conn);
  });

  updateLobbyUI();
  
  // Show Waiting Lobby details
  document.getElementById("lobby-waiting-panel").className = "lobby-card card-glass animate-fade-in";
  document.getElementById("lobby-room-code").textContent = roomCode;
  document.getElementById("lobby-role-badge").textContent = "Создатель / Админ";
  document.getElementById("admin-lobby-controls").className = "admin-controls-box";
  document.getElementById("player-lobby-controls").className = "player-controls-box hidden";
  
  // Add log
  addLocalLog("Создана комната выживания " + roomCode, "system");
}

function setupHostConnection(conn) {
  const onOpen = () => {
    console.log("Client connected via data channel:", conn.peer);
    clientConns[conn.peer] = conn;
    
    // Listen for data from client
    conn.on("data", (data) => {
      handleClientMessage(conn.peer, data, conn);
    });

    conn.on("close", () => {
      console.log("Client disconnected:", conn.peer);
      handlePlayerDisconnect(conn.peer);
    });
  };

  if (conn.open) {
    onOpen();
  } else {
    conn.on("open", onOpen);
  }
}

// CLIENT SETUPS
function setupClientLobby(nickname, roomCode) {
  const hostId = `bunker-room-${roomCode}`;
  hostConn = peer.connect(hostId);

  const onOpen = () => {
    console.log("Connected to Host data channel");
    
    // Send JOIN request
    sendToHost({
      type: "JOIN",
      nickname: nickname
    });

    // Listen for state from host
    hostConn.on("data", (data) => {
      handleHostMessage(data);
    });

    hostConn.on("close", () => {
      showNotification("Потеряно соединение с администратором комнаты.");
      resetConnection();
    });
  };

  if (hostConn.open) {
    onOpen();
  } else {
    hostConn.on("open", onOpen);
  }

  document.getElementById("lobby-waiting-panel").className = "lobby-card card-glass animate-fade-in";
  document.getElementById("lobby-room-code").textContent = roomCode;
  document.getElementById("lobby-role-badge").textContent = "Выживший";
  document.getElementById("admin-lobby-controls").className = "admin-controls-box hidden";
  document.getElementById("player-lobby-controls").className = "player-controls-box";
}

// -----------------------------------------------------------------------------
// 2. STATE SYNCHRONIZATION (MESSAGE HANDLERS)
// -----------------------------------------------------------------------------

// HOST receives from CLIENT
function handleClientMessage(clientPeerId, msg, conn) {
  console.log("Host received message:", msg, "from", clientPeerId);
  
  if (msg.type === "JOIN") {
    // Prevent double joins
    if (gameState.players.some(p => p.nickname === msg.nickname)) {
      conn.send({
        type: "ERROR",
        message: "Имя уже занято в этой комнате."
      });
      setTimeout(() => conn.close(), 1000);
      return;
    }
    
    if (gameState.players.length >= 16) {
      conn.send({
        type: "ERROR",
        message: "Комната переполнена (макс. 16 игроков)."
      });
      setTimeout(() => conn.close(), 1000);
      return;
    }

    if (gameState.status !== "lobby") {
      conn.send({
        type: "ERROR",
        message: "Игра уже запущена."
      });
      setTimeout(() => conn.close(), 1000);
      return;
    }

    // Save client connection (ensure it is in active list)
    clientConns[clientPeerId] = conn;

    // Register player
    gameState.players.push({
      id: clientPeerId,
      nickname: msg.nickname,
      isHost: false,
      isAlive: true,
      hasImmunity: false,
      cards: {},
      revealed: {},
      specials: [],
      vote: null,
      micMuted: true
    });

    addLocalLog(`Игрок ${msg.nickname} присоединился к лобби.`, "system");
    
    // Broadcast updated state and player list to trigger mesh audio calling
    broadcastState();
    updateLobbyUI();

    // Trigger calls from existing clients to this new client
    // By alphabetical check: if existing client ID < new client ID, existing client calls new client.
    // We broadcast the updated player list and the clients will handle the WebRTC calling dynamically.

  } else if (msg.type === "REVEAL_CARD") {
    const player = gameState.players.find(p => p.id === clientPeerId);
    if (player && player.isAlive) {
      player.revealed[msg.cardType] = true;
      const cardVal = player.cards[msg.cardType];
      addLocalLog(`Игрок ${player.nickname} раскрыл карту [${getCardCategoryLabel(msg.cardType)}]: "${cardVal}"`, "action");
      broadcastState();
    }
  } else if (msg.type === "PLAY_SPECIAL") {
    const player = gameState.players.find(p => p.id === clientPeerId);
    if (player && player.isAlive) {
      const card = player.specials[msg.index];
      if (card && !card.played) {
        card.played = true;
        addLocalLog(`🔥 Игрок ${player.nickname} разыграл Специальное Условие: "${card.title}" (${card.text})`, "action");
        broadcastState();
      }
    }
  } else if (msg.type === "SUBMIT_VOTE") {
    const voter = gameState.players.find(p => p.id === clientPeerId);
    if (voter && voter.isAlive && gameState.status.startsWith("voting")) {
      voter.vote = msg.candidateId;
      addLocalLog(`Игрок ${voter.nickname} проголосовал.`, "system");
      broadcastState();
    }
  } else if (msg.type === "MIC_STATUS") {
    const player = gameState.players.find(p => p.id === clientPeerId);
    if (player) {
      player.micMuted = msg.isMuted;
      broadcastState();
    }
  }
}

// CLIENT receives from HOST
function handleHostMessage(msg) {
  if (msg.type === "STATE_UPDATE") {
    gameState = msg.state;
    syncGameUI();
    manageVoiceMuteState();
    syncMeshCalls();
  } else if (msg.type === "ERROR") {
    showNotification("Ошибка: " + msg.message);
    resetConnection();
  }
}

function handlePlayerDisconnect(peerId) {
  const pIdx = gameState.players.findIndex(p => p.id === peerId);
  if (pIdx !== -1) {
    const nickname = gameState.players[pIdx].nickname;
    gameState.players.splice(pIdx, 1);
    delete clientConns[peerId];
    
    // Close active WebRTC call
    if (activeCalls[peerId]) {
      activeCalls[peerId].close();
    }

    addLocalLog(`Игрок ${nickname} покинул игру.`, "system");
    broadcastState();
    updateLobbyUI();
  }
}

// Broadcasting state (Host only)
function broadcastState() {
  if (!isHost) return;
  
  // Clean expired or broken client connections
  for (const pid in clientConns) {
    if (!clientConns[pid] || clientConns[pid].destroyed) {
      delete clientConns[pid];
    }
  }

  // Send tailored state to each client to prevent cheating
  gameState.players.forEach(p => {
    if (p.isHost) return; // Skip host self
    
    const conn = clientConns[p.id];
    if (conn && conn.open) {
      const sanitized = sanitizeStateForPlayer(gameState, p.id);
      conn.send({
        type: "STATE_UPDATE",
        state: sanitized
      });
    }
  });

  // Update Host's own view (which sees everything)
  syncGameUI();
  manageVoiceMuteState();
}

function sendToHost(data) {
  if (hostConn && hostConn.open) {
    hostConn.send(data);
  }
}

// Hiding private info in broadcast
function sanitizeStateForPlayer(state, playerPeerId) {
  const sanitized = JSON.parse(JSON.stringify(state)); // deep clone
  sanitized.players.forEach(p => {
    // Hide details for OTHER players if they are not revealed
    if (p.id !== playerPeerId) {
      for (const key in p.cards) {
        if (!p.revealed[key]) {
          p.cards[key] = "[Карта скрыта]";
        }
      }
      // Also hide specials in hand
      p.specials = p.specials.map(s => {
        return s.played ? s : { title: "Специальное условие соседа", text: "Характеристики скрыты до использования.", played: false };
      });
    }
  });
  return sanitized;
}

// -----------------------------------------------------------------------------
// 3. P2P WebRTC VOICE CHAT (MESH CALLS)
// -----------------------------------------------------------------------------

async function initMicrophone() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("Microphone accessed successfully");
    
    // Initially mute myself until the game loop unmutes me or lobby is open
    userMutedSelf = false; 
    manageVoiceMuteState();
  } catch (e) {
    console.error("Failed to access microphone:", e);
    showNotification("Предупреждение: Доступ к микрофону заблокирован. Вы сможете играть только текстом.");
    userMutedSelf = true;
    updateMicBtnUI(false, "Нет доступа");
  }
}

function handleCall(call, peerId) {
  console.log("Handling WebRTC call with peer:", peerId);
  activeCalls[peerId] = call;

  call.on("stream", (remoteStream) => {
    console.log("Received remote audio stream from:", peerId);
    playRemoteStream(peerId, remoteStream);
  });

  call.on("close", () => {
    console.log("Call closed with peer:", peerId);
    removeRemoteStream(peerId);
    delete activeCalls[peerId];
  });

  call.on("error", (err) => {
    console.error("Call WebRTC error with", peerId, err);
    removeRemoteStream(peerId);
    delete activeCalls[peerId];
  });
}

function playRemoteStream(peerId, stream) {
  let audioEl = document.getElementById(`audio-${peerId}`);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = `audio-${peerId}`;
    audioEl.autoplay = true;
    document.getElementById("audio-streams-container").appendChild(audioEl);
  }
  audioEl.srcObject = stream;
}

function removeRemoteStream(peerId) {
  const audioEl = document.getElementById(`audio-${peerId}`);
  if (audioEl) {
    audioEl.srcObject = null;
    audioEl.remove();
  }
}

// Synchronize mesh calls: call other peers that we aren't connected to yet
function syncMeshCalls() {
  if (!peer || peer.destroyed || !localStream) return;

  gameState.players.forEach(p => {
    if (p.id === myPeerId) return; // Skip self

    // Alphabetical check to prevent duplicate calls: only ID smaller calls ID larger
    if (myPeerId < p.id) {
      if (!activeCalls[p.id]) {
        console.log("Initiating WebRTC call from smaller ID to larger:", p.id);
        const call = peer.call(p.id, localStream);
        handleCall(call, p.id);
      }
    }
  });
}

// ENFORCE QUEUE MUTING SYSTEM
function manageVoiceMuteState() {
  if (!localStream) return;

  const myPlayer = gameState.players.find(p => p.id === myPeerId);
  if (!myPlayer) return;

  let shouldBeUnmuted = false;

  if (gameState.status === "lobby" || gameState.status === "game_over") {
    shouldBeUnmuted = true; // Everyone can talk in lobby and final reveal
  } else if (!myPlayer.isAlive) {
    shouldBeUnmuted = false; // Expelled players are permanently muted during gameplay
  } else if (gameState.status.startsWith("voting") || gameState.status === "defense") {
    shouldBeUnmuted = true; // All alive players can speak during voting debates
  } else if (gameState.status.startsWith("discussion")) {
    // Only the active speaker is allowed to talk
    shouldBeUnmuted = (gameState.activeSpeakerId === myPeerId);
  }

  // Apply mute/unmute to audio tracks
  const finalMuteState = !shouldBeUnmuted || userMutedSelf;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !finalMuteState;
  });

  updateMicBtnUI(!finalMuteState, userMutedSelf ? "Вручную выкл" : (!shouldBeUnmuted ? "Очередь выкл" : "Активен"));

  // Inform host of my mic state only if it actually changed to prevent infinite loops!
  if (!isHost) {
    if (myPlayer.micMuted !== finalMuteState) {
      sendToHost({
        type: "MIC_STATUS",
        isMuted: finalMuteState
      });
    }
  } else {
    myPlayer.micMuted = finalMuteState;
  }
}

function updateMicBtnUI(active, labelText) {
  const micBtn = document.getElementById("btn-toggle-mic");
  const micLabel = document.getElementById("mic-status-label");
  if (!micBtn || !micLabel) return;

  if (active) {
    micBtn.className = "btn-circle btn-mic-on";
    micBtn.innerHTML = `<i class="fa-solid fa-microphone"></i>`;
    micLabel.textContent = labelText;
    micLabel.className = "active";
  } else {
    micBtn.className = "btn-circle btn-mic-off";
    micBtn.innerHTML = `<i class="fa-solid fa-microphone-slash"></i>`;
    micLabel.textContent = labelText;
    micLabel.className = "muted";
  }
}

// -----------------------------------------------------------------------------
// 4. GAME SYSTEM & PHASES LOOP
// -----------------------------------------------------------------------------

function startGame() {
  if (!isHost) return;
  if (gameState.players.length < 4) {
    showNotification("Ошибка: Для запуска игры необходимо не менее 4 человек.");
    return;
  }

  // 1. Draw Global catastrophe
  const catIdx = Math.floor(Math.random() * CARD_DATABASE.catastrophes.length);
  gameState.catastrophe = CARD_DATABASE.catastrophes[catIdx];

  // 2. Draw 3 random bunker features
  const bunkerFeatures = [];
  const bunkerPool = [...CARD_DATABASE.bunkers];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * bunkerPool.length);
    bunkerFeatures.push(bunkerPool.splice(idx, 1)[0]);
  }
  gameState.bunker = {
    title: `Убежище №${Math.floor(Math.random() * 900 + 100)}`,
    description: bunkerFeatures.map(f => `• ${f.title}: ${f.text}`).join("<br>")
  };

  // 3. Shuffle card decks
  const decks = {
    profession: shuffleArray([...CARD_DATABASE.professions]),
    health: shuffleArray([...CARD_DATABASE.health]),
    biology: shuffleArray([...CARD_DATABASE.biology]),
    hobby: shuffleArray([...CARD_DATABASE.hobbies]),
    phobia: shuffleArray([...CARD_DATABASE.phobias]),
    baggage: shuffleArray([...CARD_DATABASE.baggage]),
    addInfo: shuffleArray([...CARD_DATABASE.addInfo]),
    quality: shuffleArray([...CARD_DATABASE.qualities]),
    special: shuffleArray([...CARD_DATABASE.specials])
  };

  // Assign cards to all players
  gameState.players.forEach(p => {
    p.isAlive = true;
    p.hasImmunity = false;
    p.cards = {
      profession: decks.profession.pop(),
      health: decks.health.pop(),
      biology: decks.biology.pop(),
      hobby: decks.hobby.pop(),
      phobia: decks.phobia.pop(),
      baggage: decks.baggage.pop(),
      addInfo: decks.addInfo.pop(),
      quality: decks.quality.pop()
    };
    // Initially all cards are face down
    p.revealed = {
      profession: false,
      health: false,
      biology: false,
      hobby: false,
      phobia: false,
      baggage: false,
      addInfo: false,
      quality: false
    };
    p.specials = [decks.special.pop(), decks.special.pop()];
    p.vote = null;
  });

  // Configure Phase 1: Round 1 Discussion
  gameState.status = "discussion_1";
  gameState.round = 1;
  gameState.activeSpeakerId = gameState.players[0].id;
  gameState.players[0].revealed.profession = true; // Auto reveal active speaker's profession
  gameState.activeSpeakerTime = 60; // 1 min

  gameState.logs = [];
  addLocalLog("СИСТЕМА: Запуск бункера... Игровые карты розданы выжившим.", "system");
  addLocalLog(`СИСТЕМА: Катастрофа: "${gameState.catastrophe.title}"!`, "system");
  addLocalLog(`СИСТЕМА: Первым выступает ${gameState.players[0].nickname}.`, "speech");

  broadcastState();
  startTimer();
}

function nextSpeakerOrPhase() {
  if (!isHost) return;

  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const currentSpeakerIdx = alivePlayers.findIndex(p => p.id === gameState.activeSpeakerId);

  // If in a speech/discussion phase
  if (gameState.status.startsWith("discussion")) {
    if (currentSpeakerIdx < alivePlayers.length - 1) {
      // Move to the next player
      const nextSpeaker = alivePlayers[currentSpeakerIdx + 1];
      gameState.activeSpeakerId = nextSpeaker.id;
      
      // Auto reveal Profession in Round 1
      if (gameState.status === "discussion_1") {
        nextSpeaker.revealed.profession = true;
      }

      gameState.activeSpeakerTime = gameState.status === "discussion_1" ? 60 : 30;
      addLocalLog(`След. спикер: ${nextSpeaker.nickname}. У него ${gameState.activeSpeakerTime} сек.`, "speech");
      broadcastState();
    } else {
      // Everyone in this round has spoken!
      advanceGamePhase();
    }
  } else if (gameState.status === "defense") {
    // Nominees defense speaking
    if (gameState.defenseIdx < gameState.nominees.length - 1) {
      gameState.defenseIdx++;
      const nextDef = gameState.players.find(p => p.id === gameState.nominees[gameState.defenseIdx]);
      gameState.activeSpeakerId = nextDef.id;
      gameState.activeSpeakerTime = 20; // 20s defense time
      addLocalLog(`Выступает кандидат на изгнание ${nextDef.nickname} (20 секунд).`, "speech");
      broadcastState();
    } else {
      // All nominees finished defense, open final vote
      gameState.status = "voting_final";
      gameState.activeSpeakerId = "";
      gameState.players.forEach(p => p.vote = null); // Clear previous votes
      addLocalLog(`СИСТЕМА: Выступления окончены. Начинается финальное голосование между номинантами!`, "system");
      broadcastState();
    }
  }
}

function prevSpeaker() {
  if (!isHost) return;

  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const currentSpeakerIdx = alivePlayers.findIndex(p => p.id === gameState.activeSpeakerId);

  if (gameState.status.startsWith("discussion") && currentSpeakerIdx > 0) {
    const prevSpeaker = alivePlayers[currentSpeakerIdx - 1];
    gameState.activeSpeakerId = prevSpeaker.id;
    gameState.activeSpeakerTime = gameState.status === "discussion_1" ? 60 : 30;
    addLocalLog(`Возврат хода к спикеру: ${prevSpeaker.nickname}.`, "speech");
    broadcastState();
  }
}

function advanceGamePhase() {
  if (!isHost) return;

  const roundNum = parseInt(gameState.status.split("_")[1]);
  const alivePlayers = gameState.players.filter(p => p.isAlive);

  if (roundNum === 1) {
    // Round 1 (Profession) finished -> Go directly to Round 2 (Health / Any card)
    gameState.status = "discussion_2";
    gameState.round = 2;
    gameState.activeSpeakerId = alivePlayers[0].id;
    gameState.activeSpeakerTime = 30;
    addLocalLog("СИСТЕМА: Начат Круг 2. Выберите одну закрытую карту для раскрытия и обоснуйте полезность (30 сек).", "system");
  } else if (roundNum === 2) {
    // Round 2 finished -> Voting 1
    startVotingPhase(1);
  } else if (roundNum === 3) {
    // Round 3 finished -> Go to Round 4
    gameState.status = "discussion_4";
    gameState.round = 4;
    gameState.activeSpeakerId = alivePlayers[0].id;
    gameState.activeSpeakerTime = 30;
    addLocalLog("СИСТЕМА: Начат Круг 4. Раскройте четвертую карту (30 сек).", "system");
  } else if (roundNum === 4) {
    // Round 4 finished -> Voting 2
    startVotingPhase(2);
  } else if (roundNum === 5) {
    // Round 5 finished -> Voting 3
    startVotingPhase(3);
  } else if (roundNum === 6) {
    // Round 6 finished -> Voting 4
    startVotingPhase(4);
  } else if (roundNum === 7) {
    // Round 7 finished -> Voting 5 (Expel 2 players!)
    startVotingPhase(5);
  }
  broadcastState();
}

function startVotingPhase(votingNum) {
  gameState.status = `voting_${votingNum}`;
  gameState.activeSpeakerId = "";
  gameState.players.forEach(p => p.vote = null); // reset votes
  addLocalLog(`🗳️ Начинается голосование №${votingNum}! Обсуждайте открыто. Выберите цель в панели справа.`, "system");
}

function finishVoting() {
  if (!isHost) return;

  // Calculate vote tallies
  const voteTallies = {}; // nomineeId -> count
  gameState.players.forEach(p => {
    if (p.isAlive && p.vote) {
      voteTallies[p.vote] = (voteTallies[p.vote] || 0) + 1;
    }
  });

  // Find max votes
  let maxVotes = 0;
  let nominees = [];

  for (const candId in voteTallies) {
    // Check if player is alive and doesn't have immunity
    const cand = gameState.players.find(p => p.id === candId);
    if (cand && cand.isAlive && !cand.hasImmunity) {
      if (voteTallies[candId] > maxVotes) {
        maxVotes = voteTallies[candId];
        nominees = [candId];
      } else if (voteTallies[candId] === maxVotes) {
        nominees.push(candId);
      }
    }
  }

  // Remove duplicates and logs
  if (nominees.length === 0) {
    addLocalLog("СИСТЕМА: Голоса не отданы или все цели имеют иммунитет. Изгнание отменено.", "system");
    advanceAfterExpulsion();
  } else {
    // Trigger defense round
    gameState.status = "defense";
    gameState.nominees = nominees;
    gameState.defenseIdx = 0;
    
    const activeDef = gameState.players.find(p => p.id === nominees[0]);
    gameState.activeSpeakerId = activeDef.id;
    gameState.activeSpeakerTime = 20;

    addLocalLog(`СИСТЕМА: Номинанты на изгнание: ${nominees.map(id => getPlayerNickname(id)).join(", ")}. Каждому дается 20 сек. на оправдание.`, "system");
    addLocalLog(`Оправдывается ${activeDef.nickname}.`, "speech");
    broadcastState();
  }
}

function finishFinalVoting() {
  if (!isHost) return;

  // Final voting determines who is kicked
  const voteTallies = {};
  gameState.players.forEach(p => {
    if (p.isAlive && p.vote && gameState.nominees.includes(p.vote)) {
      voteTallies[p.vote] = (voteTallies[p.vote] || 0) + 1;
    }
  });

  // Calculate max
  let maxVotes = 0;
  let tiedCandidates = [];
  for (const candId in voteTallies) {
    if (voteTallies[candId] > maxVotes) {
      maxVotes = voteTallies[candId];
      tiedCandidates = [candId];
    } else if (voteTallies[candId] === maxVotes) {
      tiedCandidates.push(candId);
    }
  }

  // If there's a tie, choose randomly from tied candidates
  let expelledId = "";
  if (tiedCandidates.length > 0) {
    const randIdx = Math.floor(Math.random() * tiedCandidates.length);
    expelledId = tiedCandidates[randIdx];
  } else {
    // If no final votes at all, pick first nominee
    expelledId = gameState.nominees[0];
  }

  // Perform Expulsion
  expelPlayer(expelledId);
}

function expelPlayer(playerId) {
  if (!isHost) return;

  const player = gameState.players.find(p => p.id === playerId);
  if (player) {
    player.isAlive = false;
    addLocalLog(`☠️ Игрок ${player.nickname} изгнан из Убежища и остается погибать в лесу!`, "vote");
    
    // In case of Voting 5 (last round), we expel 2 players.
    // If we need to expel a 2nd player and this is the first kick:
    const votePhase = gameState.status;
    if (votePhase === "voting_5" && gameState.nominees.length > 1) {
      // Remove this player from nominees and re-vote or kick the next one
      gameState.nominees = gameState.nominees.filter(id => id !== playerId);
      // Kick the next highest or next nominee directly to save time
      const secondExpelledId = gameState.nominees[0];
      const p2 = gameState.players.find(p => p.id === secondExpelledId);
      if (p2) {
        p2.isAlive = false;
        addLocalLog(`☠️ Также изгоняется второй игрок: ${p2.nickname}!`, "vote");
      }
    }

    advanceAfterExpulsion();
  }
}

function advanceAfterExpulsion() {
  if (!isHost) return;

  // Check how many survivors remain
  const alivePlayers = gameState.players.filter(p => p.isAlive);
  const targetCount = Math.ceil(gameState.players.length / 2);

  // Is game finished? Or is round finished?
  const currentVoteNum = gameState.status.startsWith("voting") ? parseInt(gameState.status.split("_")[1]) : null;

  if (alivePlayers.length <= targetCount || currentVoteNum === 5) {
    // Finish Game
    gameState.status = "game_over";
    gameState.activeSpeakerId = "";
    
    // Automatically reveal all remaining cards of surviving players
    gameState.players.forEach(p => {
      if (p.isAlive) {
        for (const k in p.revealed) {
          p.revealed[k] = true;
        }
      }
    });

    addLocalLog("🏆 ИГРА ОКОНЧЕНА! Финалисты вошли в Бункер. Оцените шансы выживания группы!", "system");
  } else {
    // Advance to next discussion round
    let nextRound = 3;
    if (currentVoteNum === 1) nextRound = 3;
    else if (currentVoteNum === 2) nextRound = 5;
    else if (currentVoteNum === 3) nextRound = 6;
    else if (currentVoteNum === 4) nextRound = 7;

    gameState.status = `discussion_${nextRound}`;
    gameState.round = nextRound;
    gameState.activeSpeakerId = alivePlayers[0].id;
    gameState.activeSpeakerTime = 30;

    addLocalLog(`СИСТЕМА: Начат Круг ${nextRound}. Раскройте следующую карту (30 сек).`, "system");
  }

  broadcastState();
}

// Timer loop
function startTimer() {
  clearInterval(gameTimerInterval);
  gameTimerInterval = setInterval(() => {
    if (!isHost) return;

    if (gameState.status.startsWith("discussion") || gameState.status === "defense") {
      if (gameState.activeSpeakerTime > 0) {
        gameState.activeSpeakerTime--;
        
        // Broadcast time updates occasionally (e.g. every second)
        // To save bandwidth, we broadcast state every second during timer
        broadcastState();
      } else {
        // Active speaker time finished! Move to next speaker
        nextSpeakerOrPhase();
      }
    }
  }, 1000);
}

// -----------------------------------------------------------------------------
// 5. UI UPDATING & RENDERING
// -----------------------------------------------------------------------------

function syncGameUI() {
  if (gameState.status === "lobby") {
    document.getElementById("screen-lobby").className = "screen active";
    document.getElementById("screen-game").className = "screen";
    updateLobbyUI();
  } else {
    document.getElementById("screen-lobby").className = "screen";
    document.getElementById("screen-game").className = "screen active";
    
    // Update global cards
    if (gameState.catastrophe) {
      document.getElementById("catastrophe-title").textContent = gameState.catastrophe.title;
      document.getElementById("catastrophe-desc").textContent = gameState.catastrophe.description;
      document.getElementById("catastrophe-climate").textContent = gameState.catastrophe.climate;
      document.getElementById("catastrophe-time").textContent = gameState.catastrophe.timeInBunker;
    }

    if (gameState.bunker) {
      document.getElementById("bunker-title").textContent = gameState.bunker.title;
      document.getElementById("bunker-desc").innerHTML = gameState.bunker.description;
    }

    // Update Room code
    document.getElementById("game-room-code").textContent = gameState.roomCode;

    // Update phase indicator
    updatePhaseLabels();

    // Update speaker indicator
    const speakerBox = document.getElementById("active-speaker-box");
    const speakerNameEl = document.getElementById("active-speaker-name");
    const speakerTipEl = document.getElementById("speaker-status-tip");

    if (gameState.activeSpeakerId) {
      const activeName = getPlayerNickname(gameState.activeSpeakerId);
      speakerBox.className = "active-speaker-box card-glass active";
      speakerNameEl.textContent = activeName;
      if (gameState.activeSpeakerId === myPeerId) {
        speakerTipEl.innerHTML = `<span class="neon-text animate-pulse">ВАШ ХОД! Вы говорите в эфире!</span>`;
      } else {
        speakerTipEl.textContent = "Слушайте спикера.";
      }
    } else {
      speakerBox.className = "active-speaker-box card-glass";
      speakerNameEl.textContent = "Общая дискуссия";
      speakerTipEl.textContent = "Свободное общение для всех выживших.";
    }

    // Update timer
    const timerBox = document.getElementById("timer-box");
    const timerLabel = document.getElementById("game-timer");
    
    if (gameState.status.startsWith("discussion") || gameState.status === "defense") {
      timerBox.className = gameState.activeSpeakerTime <= 10 ? "timer-box warning" : "timer-box";
      const m = Math.floor(gameState.activeSpeakerTime / 60).toString().padStart(2, '0');
      const s = (gameState.activeSpeakerTime % 60).toString().padStart(2, '0');
      timerLabel.textContent = `${m}:${s}`;
    } else {
      timerBox.className = "timer-box";
      timerLabel.textContent = "--:--";
    }

    // Update Admin controls visibility
    const adminPanel = document.getElementById("admin-game-dashboard");
    if (isHost) {
      adminPanel.className = "admin-game-dashboard card-glass";
      // Toggle button labels based on phase
      const startVoteBtn = document.getElementById("btn-admin-start-voting");
      const startDefBtn = document.getElementById("btn-admin-start-defense");
      const finishRoundBtn = document.getElementById("btn-admin-finish-round");

      if (gameState.status.startsWith("voting")) {
        startVoteBtn.className = "btn btn-warning hidden";
        startDefBtn.className = "btn btn-secondary";
        finishRoundBtn.className = "btn btn-danger hidden";
      } else if (gameState.status === "defense") {
        startVoteBtn.className = "btn btn-warning hidden";
        startDefBtn.className = "btn btn-secondary hidden";
        finishRoundBtn.className = "btn btn-danger hidden";
      } else if (gameState.status === "voting_final") {
        startVoteBtn.className = "btn btn-warning hidden";
        startDefBtn.className = "btn btn-secondary hidden";
        finishRoundBtn.className = "btn btn-danger";
        finishRoundBtn.textContent = "Изгнать игрока";
      } else {
        startVoteBtn.className = "btn btn-warning";
        startDefBtn.className = "btn btn-secondary hidden";
        finishRoundBtn.className = "btn btn-danger hidden";
      }
    } else {
      adminPanel.className = "admin-game-dashboard card-glass hidden";
    }

    // Update Player Grid
    renderPlayerGrid();

    // Update My Cards
    renderMyCards();

    // Update 3D Deck and Spotlight speaker card
    if (window.update3DDeck) {
      window.update3DDeck(gameState.players, myPeerId);
    }
    if (window.update3DSpotlight) {
      window.update3DSpotlight(gameState.activeSpeakerId, gameState.players, gameState.round);
    }

    // Render voting controls if voting phase is active
    renderVotingControls();

    // Sync log box
    renderLogs();
  }
}

function updatePhaseLabels() {
  const titleEl = document.getElementById("game-phase-title");
  const detailsEl = document.getElementById("game-phase-details");
  
  const status = gameState.status;
  if (status.startsWith("discussion")) {
    const round = status.split("_")[1];
    titleEl.textContent = `КРУГ ${round}: ${getCardCategoryLabel(getRoundCardType(round))}`;
    detailsEl.textContent = `Каждый игрок по очереди обосновывает полезность своей карты (${round == 1 ? "1 минута" : "30 секунд"}).`;
  } else if (status === "defense") {
    titleEl.textContent = "ФАЗА ОПРАВДАНИЯ";
    detailsEl.textContent = "Номинанты защищают себя перед группой. У каждого по 20 секунд.";
  } else if (status.startsWith("voting_final")) {
    titleEl.textContent = "ФИНАЛЬНОЕ ГОЛОСОВАНИЕ";
    detailsEl.textContent = "Все живые игроки отдают финальные голоса против номинантов.";
  } else if (status.startsWith("voting")) {
    const vNum = status.split("_")[1];
    titleEl.textContent = `ГОЛОСОВАНИЕ №${vNum}`;
    detailsEl.textContent = `Игроки обсуждают кандидатов и выдвигают цели на изгнание (${vNum == 5 ? "Изгоняются двое" : "Изгоняется один"}).`;
  } else if (status === "game_over") {
    titleEl.textContent = "БУНКЕР ЗАКРЫТ";
    detailsEl.textContent = "Обсудите итоги выживания. Все карты игроков раскрыты.";
  }
}

function updateLobbyUI() {
  const pCountEl = document.getElementById("lobby-player-count");
  const listEl = document.getElementById("lobby-player-list");
  const startBtn = document.getElementById("btn-start-game");

  pCountEl.textContent = gameState.players.length;

  const currentIds = gameState.players.map(p => p.id);
  const existingItems = Array.from(listEl.children);

  // Remove players who left
  existingItems.forEach(item => {
    const id = item.getAttribute("data-player-id");
    if (!currentIds.includes(id)) {
      item.remove();
    }
  });

  // Reconcile and append players
  gameState.players.forEach(p => {
    let li = Array.from(listEl.children).find(child => child.getAttribute("data-player-id") === p.id);
    let isNew = false;
    if (!li) {
      li = document.createElement("li");
      li.setAttribute("data-player-id", p.id);
      isNew = true;
    }
    
    let adminCrown = p.isHost ? `<i class="fa-solid fa-crown admin-crown" title="Администратор"></i>` : "";
    let statusLabel = p.id === myPeerId ? `<span class="badge">Вы</span>` : "";

    const innerHTML = `
      <div class="player-name-wrapper">
        <i class="fa-solid fa-user-astronaut"></i>
        <span class="player-name">${p.nickname}</span>
        ${adminCrown}
      </div>
      ${statusLabel}
    `;

    if (li.innerHTML !== innerHTML) {
      li.innerHTML = innerHTML;
    }

    if (isNew) {
      listEl.appendChild(li);
    }
  });

  // Enable/disable start button for admin
  if (isHost) {
    startBtn.disabled = gameState.players.length < 4;
  }
}

function renderPlayerGrid() {
  const grid = document.getElementById("players-grid");

  // Set counter labels
  const aliveCount = gameState.players.filter(p => p.isAlive).length;
  document.getElementById("game-alive-count").textContent = aliveCount;
  document.getElementById("game-total-count").textContent = gameState.players.length;

  const currentIds = gameState.players.map(p => p.id);
  const existingItems = Array.from(grid.children);

  // Remove players who left
  existingItems.forEach(item => {
    const id = item.getAttribute("data-player-id");
    if (!currentIds.includes(id)) {
      item.remove();
    }
  });

  gameState.players.forEach(p => {
    let cardEl = Array.from(grid.children).find(child => child.getAttribute("data-player-id") === p.id);
    let isNew = false;
    if (!cardEl) {
      cardEl = document.createElement("div");
      cardEl.setAttribute("data-player-id", p.id);
      isNew = true;
    }

    // Determine the desired classes
    let className = "player-card";
    if (p.id === gameState.activeSpeakerId) className += " active-speaker";
    if (!p.isAlive) className += " expelled";

    if (cardEl.className !== className) {
      cardEl.className = className;
    }

    // Mic Status Icon
    let micIcon = `<i class="fa-solid fa-microphone-slash player-mic-status muted" title="Микрофон выключен"></i>`;
    if (!p.micMuted) {
      micIcon = `<i class="fa-solid fa-microphone player-mic-status active" title="Микрофон активен"></i>`;
    }

    // Role Indicator
    let hostLabel = p.isHost ? `<i class="fa-solid fa-crown admin-crown" style="color:var(--neon-orange);" title="Администратор"></i>` : "";
    let immunityLabel = p.hasImmunity ? `<i class="fa-solid fa-shield-halved" style="color:var(--neon-cyan); margin-left: 5px;" title="Иммунитет"></i>` : "";

    // Generate list of characteristics
    let charListHtml = "";
    const cardCategories = ["profession", "health", "biology", "hobby", "phobia", "baggage", "addInfo", "quality"];
    
    cardCategories.forEach(cat => {
      const isRev = p.revealed[cat];
      const val = p.cards[cat];

      if (isRev) {
        charListHtml += `
          <div class="revealed-item">
            <span class="item-type">${getCardCategoryLabel(cat)}</span>
            <span class="item-value">${val}</span>
          </div>
        `;
      } else {
        charListHtml += `
          <div class="revealed-item unrevealed">
            <span class="item-type">${getCardCategoryLabel(cat)}</span>
            <span><i class="fa-solid fa-lock"></i> Закрыто</span>
          </div>
        `;
      }
    });

    // Special conditions played
    let specialsHtml = "";
    p.specials.forEach(s => {
      if (s.played) {
        specialsHtml += `
          <div class="revealed-item" style="border-color: rgba(3, 169, 244, 0.4); background: rgba(3, 169, 244, 0.05);">
            <span class="item-type" style="color:var(--neon-cyan);">Спец-карта</span>
            <span class="item-value" style="font-weight:bold;">"${s.title}"</span>
          </div>
        `;
      }
    });

    // Admin Tools on Player Card (Host only)
    let adminToolsHtml = "";
    if (isHost) {
      adminToolsHtml = `
        <div class="admin-card-tools" style="display:flex; gap:5px; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px; margin-top:5px; justify-content: space-between;">
          <button class="btn btn-secondary btn-small" onclick="togglePlayerAlive('${p.id}')" title="Убить/Воскресить">
            <i class="fa-solid ${p.isAlive ? 'fa-skull' : 'fa-heart'}"></i>
          </button>
          <button class="btn btn-secondary btn-small" onclick="togglePlayerImmunity('${p.id}')" title="Иммунитет">
            <i class="fa-solid fa-shield-halved"></i>
          </button>
          <button class="btn btn-secondary btn-small" onclick="adminRevealAll('${p.id}')" title="Раскрыть все">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button class="btn btn-secondary btn-small" onclick="adminChangeProfession('${p.id}')" title="Сменить проф.">
            <i class="fa-solid fa-rotate"></i>
          </button>
        </div>
      `;
    }

    const innerHTML = `
      <div class="player-card-header">
        <div class="player-info-meta">
          <div class="player-avatar">${p.nickname[0].toUpperCase()}</div>
          <span class="player-name">${p.nickname} ${hostLabel} ${immunityLabel}</span>
        </div>
        ${micIcon}
      </div>
      <div class="player-revealed-list">
        ${charListHtml}
        ${specialsHtml}
      </div>
      ${adminToolsHtml}
    `;

    if (cardEl.innerHTML !== innerHTML) {
      cardEl.innerHTML = innerHTML;
    }

    if (isNew) {
      grid.appendChild(cardEl);
    }
  });
}

function renderMyCards() {
  const container = document.getElementById("private-characteristics");
  container.innerHTML = "";

  const myPlayer = gameState.players.find(p => p.id === myPeerId);
  if (!myPlayer) return;

  const cardCategories = ["profession", "health", "biology", "hobby", "phobia", "baggage", "addInfo", "quality"];
  
  cardCategories.forEach(cat => {
    const isRev = myPlayer.revealed[cat];
    const val = myPlayer.cards[cat];

    const row = document.createElement("div");
    row.className = isRev ? "private-char-row revealed" : "private-char-row";

    let actionBtn = "";
    if (!isRev && myPlayer.isAlive && gameState.status !== "lobby" && gameState.status !== "game_over") {
      actionBtn = `<button class="btn btn-secondary btn-small" onclick="revealMyCard('${cat}')"><i class="fa-solid fa-eye"></i> Открыть</button>`;
    } else if (isRev) {
      actionBtn = `<span class="badge" style="color:var(--neon-green); border-color:var(--neon-green-glow);"><i class="fa-solid fa-check"></i> Открыто</span>`;
    }

    row.innerHTML = `
      <div class="char-row-meta">
        <span class="char-row-title">${getCardCategoryLabel(cat)}</span>
        <span class="char-row-content ${isRev ? '' : 'locked'}">${val}</span>
      </div>
      ${actionBtn}
    `;
    container.appendChild(row);
  });

  // Render special conditions
  const specialsContainer = document.getElementById("private-specials");
  specialsContainer.innerHTML = "";

  myPlayer.specials.forEach((s, idx) => {
    const div = document.createElement("div");
    div.className = s.played ? "special-card-item played" : "special-card-item";

    let btnHtml = "";
    if (!s.played && myPlayer.isAlive && gameState.status !== "lobby" && gameState.status !== "game_over") {
      btnHtml = `<button class="btn btn-primary btn-small" onclick="playMySpecial(${idx})"><i class="fa-solid fa-bolt"></i> Разыграть</button>`;
    } else if (s.played) {
      btnHtml = `<span class="badge" style="color:var(--text-muted);">Разыграно</span>`;
    }

    div.innerHTML = `
      <div class="special-card-header">
        <span class="special-card-title">${s.title}</span>
        ${btnHtml}
      </div>
      <p class="special-card-text">${s.text}</p>
    `;
    specialsContainer.appendChild(div);
  });
}

function renderVotingControls() {
  const box = document.getElementById("voting-box");
  const container = document.getElementById("voting-buttons-container");
  const myVoteLabel = document.getElementById("my-vote-status");

  const myPlayer = gameState.players.find(p => p.id === myPeerId);
  
  // Show voting box only if voting phase is active and player is alive
  if (!myPlayer || !myPlayer.isAlive || (!gameState.status.startsWith("voting") && gameState.status !== "defense" && gameState.status !== "voting_final")) {
    box.className = "voting-box card-glass hidden";
    return;
  }

  box.className = "voting-box card-glass";
  container.innerHTML = "";

  // Instruction text
  const instruction = document.getElementById("voting-instruction");
  if (gameState.status === "voting_final") {
    instruction.textContent = "Финальный выбор: проголосуйте за изгнание одного из номинантов:";
  } else {
    instruction.textContent = "Выберите выжившего для исключения из Бункера:";
  }

  // Generate vote buttons
  const candidates = gameState.players.filter(p => {
    // Cannot vote for dead players or hosts/themselves (usually can't vote for self)
    if (!p.isAlive || p.id === myPeerId) return false;
    
    // During final voting, can only vote for nominees
    if (gameState.status === "voting_final" && !gameState.nominees.includes(p.id)) return false;

    // Cannot vote for immune players
    if (p.hasImmunity) return false;

    return true;
  });

  candidates.forEach(c => {
    const btn = document.createElement("button");
    btn.className = "btn-vote";
    if (myPlayer.vote === c.id) btn.classList.add("selected");
    btn.textContent = c.nickname;
    btn.onclick = () => submitVote(c.id);
    container.appendChild(btn);
  });

  if (candidates.length === 0) {
    container.innerHTML = `<p style="font-style:italic; color:var(--text-muted);">Нет доступных кандидатов для голосования (все имеют иммунитет).</p>`;
  }

  if (myPlayer.vote) {
    const votedFor = getPlayerNickname(myPlayer.vote);
    myVoteLabel.textContent = `Ваш голос: против ${votedFor}`;
    myVoteLabel.style.color = "var(--neon-red)";
  } else {
    myVoteLabel.textContent = "Вы еще не проголосовали.";
    myVoteLabel.style.color = "var(--text-secondary)";
  }
}

function renderLogs() {
  const box = document.getElementById("game-log-box");
  box.innerHTML = "";
  
  gameState.logs.forEach(log => {
    const entry = document.createElement("div");
    entry.className = `log-entry ${log.type || 'system'}`;
    entry.innerHTML = `
      <span class="log-time">[${log.time}]</span>
      <span class="log-text">${log.text}</span>
    `;
    box.appendChild(entry);
  });
  
  // Auto scroll logs to bottom
  box.scrollTop = box.scrollHeight;

  // Premium Alert Badge logic: show notification badge if controls sidebar is closed!
  const sidebar = document.getElementById("controls-sidebar");
  if (sidebar && !sidebar.classList.contains("active")) {
    const badge = document.getElementById("logs-badge");
    if (badge) badge.style.display = "inline-block";
  }
}

// -----------------------------------------------------------------------------
// 6. ACTION & LOGIC SUBMITTERS (CLIENTS)
// -----------------------------------------------------------------------------

function revealMyCard(cardType) {
  if (isHost) {
    const p = gameState.players.find(p => p.id === myPeerId);
    if (p) {
      p.revealed[cardType] = true;
      const cardVal = p.cards[cardType];
      addLocalLog(`Игрок ${p.nickname} раскрыл карту [${getCardCategoryLabel(cardType)}]: "${cardVal}"`, "action");
      broadcastState();
    }
  } else {
    sendToHost({
      type: "REVEAL_CARD",
      cardType: cardType
    });
  }
}

function playMySpecial(index) {
  if (isHost) {
    const p = gameState.players.find(p => p.id === myPeerId);
    if (p) {
      const card = p.specials[index];
      if (card && !card.played) {
        card.played = true;
        addLocalLog(`🔥 Игрок ${p.nickname} разыграл Специальное Условие: "${card.title}" (${card.text})`, "action");
        broadcastState();
      }
    }
  } else {
    sendToHost({
      type: "PLAY_SPECIAL",
      index: index
    });
  }
}

function submitVote(candidateId) {
  const myPlayer = gameState.players.find(p => p.id === myPeerId);
  if (myPlayer.vote === candidateId) return; // already voted

  if (isHost) {
    myPlayer.vote = candidateId;
    addLocalLog(`Игрок ${myPlayer.nickname} проголосовал.`, "system");
    broadcastState();
  } else {
    sendToHost({
      type: "SUBMIT_VOTE",
      candidateId: candidateId
    });
  }
}

function toggleMic() {
  userMutedSelf = !userMutedSelf;
  manageVoiceMuteState();
}

// -----------------------------------------------------------------------------
// 7. ADMIN DASHBOARD OPERATIONS (HOST ONLY)
// -----------------------------------------------------------------------------

function togglePlayerAlive(peerId) {
  if (!isHost) return;
  const p = gameState.players.find(pl => pl.id === peerId);
  if (p) {
    p.isAlive = !p.isAlive;
    addLocalLog(`Администратор сменил статус ${p.nickname} на ${p.isAlive ? "ЖИВ" : "ИЗГНАН"}`, "system");
    broadcastState();
  }
}

function togglePlayerImmunity(peerId) {
  if (!isHost) return;
  const p = gameState.players.find(pl => pl.id === peerId);
  if (p) {
    p.hasImmunity = !p.hasImmunity;
    addLocalLog(`Администратор сменил иммунитет ${p.nickname} на ${p.hasImmunity ? "АКТИВЕН" : "НЕТ"}`, "system");
    broadcastState();
  }
}

function adminRevealAll(peerId) {
  if (!isHost) return;
  const p = gameState.players.find(pl => pl.id === peerId);
  if (p) {
    for (const k in p.revealed) {
      p.revealed[k] = true;
    }
    addLocalLog(`Администратор раскрыл все характеристики игрока ${p.nickname}.`, "system");
    broadcastState();
  }
}

function adminChangeProfession(peerId) {
  if (!isHost) return;
  const p = gameState.players.find(pl => pl.id === peerId);
  if (p) {
    const oldProf = p.cards.profession;
    const newProf = shuffleArray([...CARD_DATABASE.professions]).pop();
    p.cards.profession = newProf;
    addLocalLog(`Администратор сменил профессию ${p.nickname} с "${oldProf}" на "${newProf}".`, "system");
    broadcastState();
  }
}

// -----------------------------------------------------------------------------
// 8. HELPERS & EVENT REGISTRATION
// -----------------------------------------------------------------------------

function initUIEvents() {
  // Lobby buttons
  document.getElementById("btn-create-room").addEventListener("click", () => {
    const nick = document.getElementById("input-nickname").value.trim();
    if (!nick) {
      showNotification("Введите никнейм перед созданием лобби!");
      return;
    }
    const code = generateRoomCode();
    initPeer("host", nick, code);
  });

  document.getElementById("btn-join-room").addEventListener("click", () => {
    const nick = document.getElementById("input-nickname").value.trim();
    let code = document.getElementById("input-room-code").value.trim().toUpperCase();

    if (!nick) {
      showNotification("Введите никнейм перед входом!");
      return;
    }

    // Special nickname triggers admin redirection
    if (nick.toLowerCase() === "sherzodgold" && !code) {
      // Auto redirect to Host admin lobby creation!
      code = generateRoomCode();
      initPeer("host", nick, code);
      return;
    }

    if (!code || code.length !== 4) {
      showNotification("Введите валидный 4-значный код комнаты!");
      return;
    }

    initPeer("client", nick, code);
  });

  // Admin panels (Start game)
  document.getElementById("btn-start-game").addEventListener("click", () => {
    startGame();
  });

  // Voice controls
  document.getElementById("btn-toggle-mic").addEventListener("click", () => {
    toggleMic();
  });

  // Host dashboard controls
  document.getElementById("btn-admin-next-turn").addEventListener("click", () => {
    if (gameState.status.startsWith("discussion") || gameState.status === "defense") {
      nextSpeakerOrPhase();
    }
  });

  document.getElementById("btn-admin-prev-turn").addEventListener("click", () => {
    if (gameState.status.startsWith("discussion")) {
      prevSpeaker();
    }
  });

  document.getElementById("btn-admin-start-voting").addEventListener("click", () => {
    if (isHost && gameState.status.startsWith("discussion")) {
      // Go to voting matching current round
      const round = gameState.round;
      // Voting 1 is after Round 2, Voting 2 after Round 4, etc.
      let vNum = 1;
      if (round <= 2) vNum = 1;
      else if (round <= 4) vNum = 2;
      else if (round === 5) vNum = 3;
      else if (round === 6) vNum = 4;
      else vNum = 5;

      startVotingPhase(vNum);
      broadcastState();
    }
  });

  document.getElementById("btn-admin-start-defense").addEventListener("click", () => {
    if (isHost && gameState.status.startsWith("voting")) {
      finishVoting();
    }
  });

  document.getElementById("btn-admin-finish-round").addEventListener("click", () => {
    if (isHost) {
      if (gameState.status === "voting_final") {
        finishFinalVoting();
      }
    }
  });

  // Admin phase selection quick bypass
  document.getElementById("admin-select-phase").addEventListener("change", (e) => {
    if (!isHost) return;
    const val = e.target.value;
    
    if (val.startsWith("discussion")) {
      const rnd = parseInt(val.split("_")[1]);
      gameState.status = val;
      gameState.round = rnd;
      gameState.activeSpeakerId = gameState.players.filter(p => p.isAlive)[0].id;
      gameState.activeSpeakerTime = rnd === 1 ? 60 : 30;
      addLocalLog(`Администратор переключил фазу на Круг ${rnd}.`, "system");
    } else if (val.startsWith("voting")) {
      const vNum = parseInt(val.split("_")[1]);
      startVotingPhase(vNum);
    } else if (val === "game_over") {
      gameState.status = "game_over";
      gameState.activeSpeakerId = "";
      gameState.players.forEach(p => {
        for (const k in p.revealed) p.revealed[k] = true;
      });
      addLocalLog(`Администратор досрочно завершил игру. Итоги открыты.`, "system");
    }
    broadcastState();
  });
}

function switchControlTab(tabName) {
  const tabs = document.querySelectorAll(".tab-btn");
  const contents = document.querySelectorAll(".tab-content");

  tabs.forEach(t => t.classList.remove("active"));
  contents.forEach(c => c.classList.remove("active"));

  if (tabName === "my-cards") {
    tabs[0].classList.add("active");
    document.getElementById("tab-my-cards").classList.add("active");
  } else {
    tabs[1].classList.add("active");
    document.getElementById("tab-game-log").classList.add("active");
  }
}

// Card category labels in Russian
function getCardCategoryLabel(cat) {
  const labels = {
    profession: "Профессия",
    health: "Здоровье",
    biology: "Биология",
    hobby: "Хобби",
    phobia: "Фобия",
    baggage: "Багаж",
    addInfo: "Доп. инфо",
    quality: "Качества"
  };
  return labels[cat] || cat;
}

function getRoundCardType(round) {
  // Mapping round number to category index
  const categories = ["profession", "health", "biology", "hobby", "phobia", "baggage", "addInfo", "quality"];
  return categories[round - 1] || "profession";
}

function getPlayerNickname(peerId) {
  const p = gameState.players.find(pl => pl.id === peerId);
  return p ? p.nickname : "Неизвестный";
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars like O, I, 0, 1
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getFormattedTime() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function addLocalLog(text, type) {
  const log = {
    time: getFormattedTime(),
    type: type,
    text: text
  };
  gameState.logs.push(log);
  if (gameState.logs.length > 100) {
    gameState.logs.shift(); // keep last 100 logs
  }
}

// Notification Banner
function showNotification(text) {
  const banner = document.getElementById("notification-banner");
  banner.querySelector(".notification-text").textContent = text;
  banner.className = "notification-banner";
  setTimeout(() => {
    hideNotification();
  }, 5000);
}

function hideNotification() {
  const banner = document.getElementById("notification-banner");
  if (banner) {
    banner.className = "notification-banner hidden";
  }
}

// -----------------------------------------------------------------------------
// 9. NEW CINEMATIC INTERFACE SIDEBAR & MODAL TOGGLES
// -----------------------------------------------------------------------------

function toggleLeftSidebar() {
  const sidebar = document.getElementById("players-sidebar");
  if (sidebar) {
    sidebar.classList.toggle("active");
  }
}

function toggleRightSidebar() {
  const sidebar = document.getElementById("controls-sidebar");
  if (sidebar) {
    sidebar.classList.toggle("active");
    
    // Auto hide notification badge when log is opened
    const badge = document.getElementById("logs-badge");
    if (badge) badge.style.display = "none";
  }
}

function toggleApocalypseOverlay() {
  const overlay = document.getElementById("apocalypse-overlay");
  if (overlay) {
    overlay.classList.toggle("hidden");
  }
}

function switchSidebarTab(tabName) {
  const tabs = document.querySelectorAll(".sidebar-tab-btn");
  const contents = document.querySelectorAll(".sidebar-tab-content");

  tabs.forEach(t => t.classList.remove("active"));
  contents.forEach(c => c.classList.remove("active"));

  if (tabName === 'log-tab') {
    tabs[0].classList.add("active");
    document.getElementById("sidebar-tab-log").classList.add("active");
  } else {
    tabs[1].classList.add("active");
    document.getElementById("sidebar-tab-specials").classList.add("active");
  }
}

// Bind sidebar controls to global window for index.html onclick calls
window.toggleLeftSidebar = toggleLeftSidebar;
window.toggleRightSidebar = toggleRightSidebar;
window.toggleApocalypseOverlay = toggleApocalypseOverlay;
window.switchSidebarTab = switchSidebarTab;

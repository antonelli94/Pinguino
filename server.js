const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// --- CODICE DEL SITO (HTML + CSS + JS Client) ---
const PAGE_HTML = `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Poker Room</title>
    <style>
        body { background-color: #0f1923; color: #fff; font-family: sans-serif; margin: 0; padding: 0; text-align: center; }
        .hidden { display: none !important; }
        input { padding: 15px; width: 80%; margin: 10px 0; border-radius: 5px; border: none; font-size: 18px; }
        .btn-start { background: #ff4655; color: white; border: none; padding: 15px 40px; font-size: 20px; font-weight: bold; border-radius: 5px; cursor: pointer; }
        .top-bar { display: flex; justify-content: space-between; padding: 15px; background: #1f2731; border-bottom: 2px solid #ff4655; }
        .my-chips { color: #ffeb3b; font-weight: bold; font-size: 1.2em; }
        .pot-display { margin: 20px auto; width: 140px; height: 140px; background: #2c3e50; border-radius: 50%; border: 4px solid #27ae60; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .pot-amount { font-size: 32px; font-weight: bold; color: #fff; }
        #players-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; padding: 10px; padding-bottom: 80px; }
        .player-card { background: #333; padding: 10px; border-radius: 8px; min-width: 100px; border: 2px solid transparent; }
        .player-card.active-turn { border-color: #ff4655; background: #444; box-shadow: 0 0 10px #ff4655; }
        .player-card.folded { opacity: 0.4; text-decoration: line-through; }
        .player-chips { color: #ffeb3b; font-size: 0.9em; }
        #action-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: #111; padding: 10px; display: flex; gap: 5px; border-top: 1px solid #333; box-sizing: border-box; }
        .btn-game { padding: 15px 5px; font-size: 14px; border: none; border-radius: 5px; font-weight: bold; flex: 1; color: #000; cursor: pointer; }
        .btn-fold { background: #e74c3c; color: white; }
        .btn-check { background: #3498db; color: white; }
        .btn-raise { background: #2ecc71; }
        #admin-controls { background: #4a0000; padding: 10px; margin-bottom: 10px; }
        .admin-btn { background: #ff4655; color: white; border: none; padding: 8px; margin: 2px; border-radius: 4px; }
    </style>
</head>
<body>
    <div id="login-screen" style="padding-top:50px;">
        <h1>♠️ POKER ROOM</h1>
        <input type="text" id="username" placeholder="Tuo Nome">
        <input type="text" id="roomCode" placeholder="Nome Stanza" value="Tavolo1">
        <br><br>
        <button class="btn-start" onclick="enterGame()">ENTRA</button>
    </div>

    <div id="game-screen" class="hidden">
        <div class="top-bar">
            <span id="my-name">Io</span>
            <span class="my-chips">€ <span id="my-balance">0</span></span>
        </div>

        <div id="admin-controls" class="hidden">
            <p style="margin:0; font-size:12px; color:#aaa">BANCHIERE</p>
            <button class="admin-btn" onclick="startRound()">Nuova Mano (Ante 1€)</button>
        </div>

        <div class="pot-display">
            <span style="font-size:12px; color:#aaa;">PIATTO</span>
            <span class="pot-amount">€ <span id="pot-amount">0</span></span>
            <span style="font-size:12px; color:#aaa; margin-top:5px">Puntata Max: <span id="current-bet">0</span></span>
        </div>
        <div style="margin-bottom:10px; font-size:14px; color:#ff4655; font-weight:bold" id="turn-indicator">In attesa...</div>
        
        <div id="players-grid"></div>

        <div id="action-bar" class="hidden">
            <button class="btn-game btn-fold" onclick="doAction('FOLD')">FOLD</button>
            <button class="btn-game btn-check" id="btn-check-call" onclick="doAction('CHECK')">CHECK</button>
            <button class="btn-game btn-raise" onclick="doRaise()">RILANCIA</button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let myId = null; 
        let myRoom = null;
        let currentMaxBet = 0;
        let myBetInRound = 0;

        function enterGame() {
            const user = document.getElementById('username').value;
            const code = document.getElementById('roomCode').value;
            if(!user) return alert("Metti il nome!");
            myRoom = code;
            socket.emit('joinRoom', { username: user, roomCode: code });
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');
            document.getElementById('my-name').innerText = user;
        }

        socket.on('connect', () => { myId = socket.id; });

        socket.on('updateGame', (room) => {
            currentMaxBet = room.currentBet;
            const me = room.players.find(p => p.id === myId);
            if(me) {
                document.getElementById('my-balance').innerText = me.chips;
                myBetInRound = me.betInRound;
                if(me.isAdmin) document.getElementById('admin-controls').classList.remove('hidden');
            }

            document.getElementById('pot-amount').innerText = room.pot;
            document.getElementById('current-bet').innerText = room.currentBet;

            const grid = document.getElementById('players-grid');
            grid.innerHTML = '';
            
            const activePlayer = room.players[room.turnIndex];
            const isMyTurn = (activePlayer && activePlayer.id === myId && room.phase === 'BETTING');
            
            if(activePlayer) {
                document.getElementById('turn-indicator').innerText = isMyTurn ? "TOCCA A TE!" : "Tocca a " + activePlayer.username;
            }

            room.players.forEach(p => {
                const div = document.createElement('div');
                div.className = "player-card " + (p.id === activePlayer?.id ? 'active-turn ' : '') + (p.folded ? 'folded' : '');
                div.innerHTML = "<div style='font-weight:bold'>" + p.username + "</div><div class='player-chips'>€ " + p.chips + "</div><div style='font-size:12px; color:#aaa'>Puntato: " + p.betInRound + "</div>";
                
                if(me && me.isAdmin) {
                    div.onclick = () => {
                        if(confirm("Gestione " + p.username + ":\\nOK = ASSEGNA VITTORIA\\nANNULLA = RICARICA CONTO")) {
                            socket.emit('winner', { roomCode: myRoom, winnerId: p.id });
                        } else {
                            let am = prompt("Quanto ricarichi?");
                            if(am) socket.emit('addChips', { roomCode: myRoom, targetId: p.id, amount: am });
                        }
                    };
                }
                grid.appendChild(div);
            });

            const actionBar = document.getElementById('action-bar');
            const btnCheckCall = document.getElementById('btn-check-call');

            if(isMyTurn) {
                actionBar.classList.remove('hidden');
                const diff = currentMaxBet - myBetInRound;
                if(diff > 0) {
                    btnCheckCall.innerText = "VEDO (" + diff + ")";
                    btnCheckCall.onclick = () => socket.emit('playerAction', { roomCode: myRoom, action: 'CALL' });
                } else {
                    btnCheckCall.innerText = "CHECK";
                    btnCheckCall.onclick = () => socket.emit('playerAction', { roomCode: myRoom, action: 'CHECK' });
                }
            } else {
                actionBar.classList.add('hidden');
            }
        });

        function doAction(type) { socket.emit('playerAction', { roomCode: myRoom, action: type }); }
        
        function doRaise() {
            const raiseTo = prompt("A quanto porti la puntata TOTALE? (Attuale: " + currentMaxBet + ")");
            if(raiseTo && parseInt(raiseTo) > currentMaxBet) {
                socket.emit('playerAction', { roomCode: myRoom, action: 'RAISE', amount: raiseTo });
            }
        }

        function startRound() {
            const ante = prompt("Costo invito (Ante)?", "1");
            if(ante) socket.emit('startRound', { roomCode: myRoom, anteAmount: parseInt(ante) });
        }
    </script>
</body>
</html>
`;

// --- LOGICA SERVER ---
const rooms = {};

app.get('/', (req, res) => { res.send(PAGE_HTML); });

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ username, roomCode }) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) {
            rooms[roomCode] = { players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', adminId: socket.id };
        }
        const room = rooms[roomCode];
        const existing = room.players.find(p => p.username === username);
        if(!existing) {
            room.players.push({ id: socket.id, username, chips: 0, betInRound: 0, folded: false, isAdmin: socket.id === room.adminId });
        } else {
            existing.id = socket.id; 
            if(existing.isAdmin) room.adminId = socket.id;
        }
        io.to(roomCode).emit('updateGame', room);
    });

    socket.on('addChips', ({ roomCode, targetId, amount }) => {
        const room = rooms[roomCode];
        if(room && room.adminId === socket.id) {
            const p = room.players.find(pl => pl.id === targetId);
            if(p) { p.chips += parseInt(amount); io.to(roomCode).emit('updateGame', room); }
        }
    });

    socket.on('startRound', ({ roomCode, anteAmount }) => {
        const room = rooms[roomCode];
        if(room && room.adminId === socket.id) {
            room.pot = 0; room.currentBet = 0; room.phase = 'BETTING'; room.turnIndex = 0;
            room.players.forEach(p => {
                p.folded = false; p.betInRound = 0;
                if(p.chips >= anteAmount) { p.chips -= anteAmount; room.pot += anteAmount; }
            });
            io.to(roomCode).emit('updateGame', room);
        }
    });

    socket.on('playerAction', ({ roomCode, action, amount }) => {
        const room = rooms[roomCode];
        if(!room) return;
        const player = room.players.find(p => p.id === socket.id);
        const pIndex = room.players.findIndex(p => p.id === socket.id);
        
        if(pIndex !== room.turnIndex) return;

        if (action === 'FOLD') player.folded = true;
        else if (action === 'CHECK' && player.betInRound < room.currentBet) return;
        else if (action === 'CALL') {
            const toCall = room.currentBet - player.betInRound;
            if(player.chips >= toCall) { player.chips -= toCall; player.betInRound += toCall; room.pot += toCall; }
        }
        else if (action === 'RAISE') {
            const raiseTo = parseInt(amount);
            const diff = raiseTo - player.betInRound;
            if(raiseTo > room.currentBet && player.chips >= diff) {
                player.chips -= diff; player.betInRound += diff; room.pot += diff; room.currentBet = raiseTo;
            }
        }

        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loop = 0;
        while(room.players[nextIndex].folded && loop < room.players.length) {
            nextIndex = (nextIndex + 1) % room.players.length;
            loop++;
        }
        room.turnIndex = nextIndex;
        io.to(roomCode).emit('updateGame', room);
    });

    socket.on('winner', ({ roomCode, winnerId }) => {
        const room = rooms[roomCode];
        if(room && room.adminId === socket.id) {
            const winner = room.players.find(p => p.id === winnerId);
            if(winner) { winner.chips += room.pot; room.pot = 0; room.currentBet = 0; room.phase = 'WAITING'; io.to(roomCode).emit('updateGame', room); }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {});

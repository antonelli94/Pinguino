const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// --- CODICE CLIENT (HTML/CSS/JS) ---
const PAGE_HTML = `
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Poker Pro Table</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <style>
        :root { --bg: #121212; --table: #2e7d32; --accent: #ffab00; --text: #eee; --danger: #d32f2f; --surface: #1e1e1e; }
        body { background-color: var(--bg); color: var(--text); font-family: 'Roboto', sans-serif; margin: 0; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
        
        /* UTILS */
        .hidden { display: none !important; }
        .btn { border: none; border-radius: 8px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: transform 0.1s; }
        .btn:active { transform: scale(0.95); }
        .full-center { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }

        /* LOGIN */
        #login-screen { background: var(--bg); z-index: 100; position: absolute; top:0; left:0; width:100%; height:100%; }
        input { background: #333; border: 1px solid #555; color: white; padding: 15px; width: 80%; margin: 10px 0; border-radius: 8px; font-size: 18px; text-align: center; }
        .btn-start { background: var(--accent); color: black; padding: 15px 40px; font-size: 18px; margin-top: 20px; box-shadow: 0 4px 15px rgba(255, 171, 0, 0.3); }

        /* HEADER */
        .top-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: var(--surface); box-shadow: 0 2px 5px rgba(0,0,0,0.5); z-index: 10; }
        .my-info { display: flex; flex-direction: column; }
        .my-name { font-size: 0.8em; color: #aaa; }
        .my-chips { font-size: 1.2em; font-weight: bold; color: var(--accent); }
        .admin-toggle { background: #444; color: white; padding: 5px 10px; font-size: 20px; border-radius: 5px; }

        /* TABLE AREA */
        #game-area { flex: 1; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 20px; overflow-y: auto; }
        
        .poker-table-graphic {
            width: 280px; height: 140px;
            background: var(--table);
            border: 8px solid #1b5e20;
            border-radius: 100px;
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.5), 0 10px 30px rgba(0,0,0,0.5);
            margin-bottom: 20px; position: relative;
        }
        .pot-label { font-size: 0.8em; color: rgba(255,255,255,0.7); margin-bottom: 5px; }
        .pot-amount { font-size: 2em; font-weight: bold; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
        .current-bet-info { font-size: 0.8em; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 10px; margin-top: 5px; }

        /* PLAYERS GRID */
        #players-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; width: 95%; max-width: 400px; padding-bottom: 80px; }
        .player-card { background: var(--surface); padding: 10px; border-radius: 8px; border-left: 4px solid #555; position: relative; transition: all 0.3s; }
        .player-card.active-turn { background: #263238; border-left-color: var(--accent); box-shadow: 0 0 15px rgba(255, 171, 0, 0.2); transform: scale(1.02); }
        .player-card.folded { opacity: 0.5; filter: grayscale(1); }
        .p-name { font-weight: bold; font-size: 0.9em; }
        .p-chips { color: var(--accent); font-size: 0.9em; }
        .p-bet { font-size: 0.8em; color: #81c784; margin-top: 4px; }
        .dealer-badge { position: absolute; top: -5px; right: -5px; background: white; color: black; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.5); }

        /* ACTION BAR (BOTTOM) */
        #action-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: #111; padding: 15px; display: flex; gap: 10px; box-shadow: 0 -4px 10px rgba(0,0,0,0.5); z-index: 20; }
        .btn-game { flex: 1; padding: 15px; font-size: 14px; color: #000; }
        .btn-fold { background: var(--danger); color: white; }
        .btn-check { background: #2196f3; color: white; }
        .btn-call { background: var(--accent); }
        .btn-raise { background: #4caf50; color: white; }

        /* ADMIN OVERLAY */
        #admin-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 50; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box; overflow-y: auto; }
        .admin-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px; }
        .admin-section { margin-bottom: 30px; }
        .admin-section h3 { color: #aaa; font-size: 12px; text-transform: uppercase; margin-bottom: 10px; border-bottom: 1px solid #333; }
        .money-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
        .money-btn { background: #333; color: white; padding: 10px; border-radius: 4px; font-size: 12px; }
        .list-item { display: flex; justify-content: space-between; align-items: center; background: #222; padding: 10px; margin-bottom: 5px; border-radius: 4px; }
        .win-btn { background: var(--accent); padding: 5px 15px; color: black; font-size: 12px; }
        
        /* NOTIFICATIONS */
        .toast { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 15px 30px; border-radius: 30px; font-size: 1.2em; pointer-events: none; opacity: 0; transition: opacity 0.3s; z-index: 60; }
    </style>
</head>
<body>

    <!-- LOGIN -->
    <div id="login-screen" class="full-center">
        <h1 style="color:var(--accent); margin-bottom: 5px;">♣️ POKER PRO</h1>
        <p style="color:#777; margin-top:0;">Gestore Fiches 3.0</p>
        <input type="text" id="username" placeholder="Il tuo Nome">
        <input type="text" id="roomCode" placeholder="Nome Tavolo" value="Tavolo1">
        <button class="btn btn-start" onclick="login()">ENTRA</button>
        <p style="font-size:12px; color:#555; margin-top:20px">Se ricarichi la pagina non perdi i soldi.</p>
    </div>

    <!-- GIOCO -->
    <div id="game-screen" class="hidden" style="height:100%">
        <!-- Top Bar -->
        <div class="top-bar">
            <div class="my-info">
                <span class="my-name" id="display-name">Giocatore</span>
                <span class="my-chips">€ <span id="display-balance">0</span></span>
            </div>
            <button id="admin-btn" class="btn admin-toggle hidden" onclick="toggleAdmin()">👑 MENU CICCIO</button>
        </div>

        <!-- Area Tavolo -->
        <div id="game-area">
            <div class="poker-table-graphic">
                <div class="pot-label">PIATTO</div>
                <div class="pot-amount">€ <span id="pot-amount">0</span></div>
                <div class="current-bet-info">Puntata Attuale: € <span id="current-bet">0</span></div>
            </div>
            
            <div id="turn-indicator" style="margin-bottom:15px; font-weight:bold; color:var(--accent);">In attesa...</div>
            
            <div id="players-grid"></div>
        </div>

        <!-- Pulsantiera Giocatore -->
        <div id="action-bar" class="hidden">
            <button class="btn btn-game btn-fold" onclick="doAction('FOLD')">FOLD</button>
            <button class="btn btn-game btn-check" id="btn-check-call" onclick="doAction('CHECK')">CHECK</button>
            <button class="btn btn-game btn-raise" onclick="doRaise()">RILANCIA</button>
        </div>
    </div>

    <!-- ADMIN OVERLAY (Nascosto di base) -->
    <div id="admin-overlay" class="hidden">
        <div class="admin-header">
            <h2 style="margin:0">👑 Gestione Banco</h2>
            <button class="btn" style="background:transparent; color:white; font-size:20px" onclick="toggleAdmin()">✕</button>
        </div>

        <div class="admin-section">
            <h3>Nuova Mano</h3>
            <div style="display:flex; gap:10px;">
                <button class="btn" style="background:var(--table); color:white; flex:1; padding:15px;" onclick="startRound(1)">INIZIA (Ante 1€)</button>
                <button class="btn" style="background:#444; color:white; flex:1;" onclick="startRound(prompt('Costo Ante?'))">Altro...</button>
            </div>
        </div>

        <div class="admin-section">
            <h3>Assegna Vittoria (Chiude la mano)</h3>
            <div id="admin-player-list"></div>
        </div>

        <div class="admin-section">
            <h3>Cassa Centrale (Ricariche)</h3>
            <p style="font-size:12px; color:#777">Clicca un importo per dare soldi a TUTTI, oppure seleziona un giocatore sopra.</p>
            <div class="money-grid">
                <button class="btn money-btn" onclick="giveMoneyToAll(1)">+1€ Tutti</button>
                <button class="btn money-btn" onclick="giveMoneyToAll(5)">+5€ Tutti</button>
                <button class="btn money-btn" onclick="giveMoneyToAll(10)">+10€ Tutti</button>
                <button class="btn money-btn" style="background:var(--danger)" onclick="resetGame()">RESET TOTALE</button>
            </div>
        </div>
    </div>

    <div id="toast" class="toast">Messaggio</div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let myToken = localStorage.getItem('pokerToken');
        if(!myToken) {
            myToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
            localStorage.setItem('pokerToken', myToken);
        }

        let myId = null;
        let iamAdmin = false;
        let currentMaxBet = 0;
        let myBetInRound = 0;
        let myRoom = null;

        // Login con Token per persistenza
        function login() {
            const username = document.getElementById('username').value;
            const roomCode = document.getElementById('roomCode').value;
            if(!username) return alert("Inserisci il nome");
            
            myRoom = roomCode;
            socket.emit('joinGame', { username, roomCode, token: myToken });
            
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('game-screen').classList.remove('hidden');
            document.getElementById('display-name').innerText = username;
        }

        socket.on('connect', () => { myId = socket.id; });

        // AGGIORNAMENTO UI
        socket.on('updateGame', (room) => {
            currentMaxBet = room.currentBet;
            
            // Trova il mio player usando il token (più sicuro dell'ID socket)
            const me = room.players.find(p => p.token === myToken);
            if(me) {
                document.getElementById('display-balance').innerText = me.chips;
                myBetInRound = me.betInRound;
                iamAdmin = me.isAdmin;
                if(iamAdmin) document.getElementById('admin-btn').classList.remove('hidden');
                myId = me.socketId; // Aggiorna il socket ID corrente
            }

            // Aggiorna Tavolo
            document.getElementById('pot-amount').innerText = room.pot;
            document.getElementById('current-bet').innerText = room.currentBet;

            // Render Griglia Giocatori
            const grid = document.getElementById('players-grid');
            const adminList = document.getElementById('admin-player-list');
            grid.innerHTML = '';
            adminList.innerHTML = '';

            const activePlayer = room.players[room.turnIndex];
            const isMyTurn = (activePlayer && activePlayer.token === myToken && room.phase === 'BETTING');

            // Turn Indicator & Vibration
            const indicator = document.getElementById('turn-indicator');
            if(activePlayer) {
                if(isMyTurn) {
                    indicator.innerText = "TOCCA A TE!";
                    indicator.style.color = "var(--accent)";
                    if(navigator.vibrate) navigator.vibrate(200); // VIBRAZIONE!
                } else {
                    indicator.innerText = "Tocca a " + activePlayer.username;
                    indicator.style.color = "#777";
                }
            } else {
                indicator.innerText = "Mano finita. In attesa del Banchiere.";
            }

            room.players.forEach(p => {
                // Card Giocatore
                const el = document.createElement('div');
                el.className = "player-card " + (p.token === activePlayer?.token ? 'active-turn ' : '') + (p.folded ? 'folded' : '');
                
                let dealerHtml = (p.token === room.dealerToken) ? '<div class="dealer-badge">D</div>' : '';

                el.innerHTML = dealerHtml + `
                    <div class="p-name">${p.username}</div>
                    <div class="p-chips">€ ${p.chips}</div>
                    <div class="p-bet">Puntato: ${p.betInRound}</div>
                `;
                grid.appendChild(el);

                // Admin List Item
                const li = document.createElement('div');
                li.className = 'list-item';
                li.innerHTML = `
                    <span style="color:white; font-size:14px">${p.username} (€${p.chips})</span>
                    <div>
                        <button class="btn win-btn" onclick="setWinner('${p.token}')">VINCE</button>
                        <button class="btn" style="background:#333; color:#fff; padding:5px;" onclick="giveMoney('${p.token}')">+</button>
                    </div>
                `;
                adminList.appendChild(li);
            });

            // Gestione Pulsantiera
            const actionBar = document.getElementById('action-bar');
            const btnCheckCall = document.getElementById('btn-check-call');

            if(isMyTurn) {
                actionBar.classList.remove('hidden');
                const diff = currentMaxBet - myBetInRound;
                if(diff > 0) {
                    btnCheckCall.innerText = "VEDO (" + diff + ")";
                    btnCheckCall.className = "btn btn-game btn-call";
                    btnCheckCall.onclick = () => doAction('CALL');
                } else {
                    btnCheckCall.innerText = "CHECK";
                    btnCheckCall.className = "btn btn-game btn-check";
                    btnCheckCall.onclick = () => doAction('CHECK');
                }
            } else {
                actionBar.classList.add('hidden');
            }
        });

        socket.on('toast', (msg) => {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.style.opacity = 1;
            setTimeout(() => t.style.opacity = 0, 3000);
        });

        // ACTIONS USER
        function doAction(type) { socket.emit('playerAction', { roomCode: myRoom, action: type }); }
        function doRaise() {
            const raiseTo = prompt("A quanto porti la puntata TOTALE? (Attuale: " + currentMaxBet + ")");
            if(raiseTo && parseInt(raiseTo) > currentMaxBet) {
                socket.emit('playerAction', { roomCode: myRoom, action: 'RAISE', amount: raiseTo });
            }
        }
        function toggleAdmin() {
            const el = document.getElementById('admin-overlay');
            el.classList.toggle('hidden');
        }

        // ACTIONS ADMIN
        function startRound(ante) {
            if(!ante) return;
            socket.emit('adminAction', { roomCode: myRoom, type: 'START_ROUND', payload: { ante: parseInt(ante) }});
            toggleAdmin();
        }
        function setWinner(token) {
            if(confirm("Confermi che ha vinto questo giocatore?")) {
                socket.emit('adminAction', { roomCode: myRoom, type: 'WINNER', payload: { token }});
                toggleAdmin();
            }
        }
        function giveMoney(token) {
            const amount = prompt("Quanto ricarichi?");
            if(amount) socket.emit('adminAction', { roomCode: myRoom, type: 'ADD_CHIPS', payload: { token, amount: parseInt(amount) }});
        }
        function giveMoneyToAll(amount) {
            if(confirm(`Dai ${amount}€ a tutti?`)) {
                socket.emit('adminAction', { roomCode: myRoom, type: 'ADD_ALL', payload: { amount }});
            }
        }
        function resetGame() {
            if(confirm("ATTENZIONE: Azzera tutti i soldi e il tavolo. Sicuro?")) {
                socket.emit('adminAction', { roomCode: myRoom, type: 'RESET' });
                toggleAdmin();
            }
        }

    </script>
</body>
</html>
`;

// --- LOGICA SERVER ---
const rooms = {};

app.get('/', (req, res) => { res.send(PAGE_HTML); });

io.on('connection', (socket) => {
    
    // JOIN INTELLIGENTE CON TOKEN
    socket.on('joinGame', ({ username, roomCode, token }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', 
                adminToken: token, // Il primo che crea la stanza è admin col suo token
                dealerToken: null
            };
        }
        const room = rooms[roomCode];
        
        // Cerchiamo se esiste già questo token (Giocatore che ricarica pagina)
        let player = room.players.find(p => p.token === token);
        
        if(player) {
            // Bentornato! Aggiorniamo solo il socket per mandargli i messaggi
            player.socketId = socket.id;
            player.username = username; // Aggiorna nome se cambiato
        } else {
            // Nuovo giocatore
            player = {
                token: token,
                socketId: socket.id,
                username: username,
                chips: 0,
                betInRound: 0,
                folded: false,
                isAdmin: token === room.adminToken
            };
            room.players.push(player);
        }
        
        // Aggiorniamo stato admin nel caso fosse cambiato
        player.isAdmin = (token === room.adminToken);

        io.to(roomCode).emit('updateGame', room);
    });

    socket.on('playerAction', ({ roomCode, action, amount }) => {
        const room = rooms[roomCode];
        if(!room) return;
        
        const player = room.players.find(p => p.socketId === socket.id);
        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        
        if(!player || pIndex !== room.turnIndex) return;

        if (action === 'FOLD') {
            player.folded = true;
            io.to(roomCode).emit('toast', `${player.username} ha passato.`);
        }
        else if (action === 'CHECK') {
            if(player.betInRound < room.currentBet) return;
            io.to(roomCode).emit('toast', `${player.username} fa Check.`);
        }
        else if (action === 'CALL') {
            const toCall = room.currentBet - player.betInRound;
            if(player.chips >= toCall) { 
                player.chips -= toCall; 
                player.betInRound += toCall; 
                room.pot += toCall; 
                io.to(roomCode).emit('toast', `${player.username} vede.`);
            }
        }
        else if (action === 'RAISE') {
            const raiseTo = parseInt(amount);
            const diff = raiseTo - player.betInRound;
            if(raiseTo > room.currentBet && player.chips >= diff) {
                player.chips -= diff; 
                player.betInRound += diff; 
                room.pot += diff; 
                room.currentBet = raiseTo;
                io.to(roomCode).emit('toast', `${player.username} RILANCIA a ${raiseTo}!`);
            }
        }

        // Passa turno
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loop = 0;
        while(room.players[nextIndex].folded && loop < room.players.length) {
            nextIndex = (nextIndex + 1) % room.players.length;
            loop++;
        }
        room.turnIndex = nextIndex;
        io.to(roomCode).emit('updateGame', room);
    });

    // GESTIONE ADMIN CENTRALIZZATA
    socket.on('adminAction', ({ roomCode, type, payload }) => {
        const room = rooms[roomCode];
        // Verifica sicurezza: chi chiama deve avere il token admin
        const caller = room.players.find(p => p.socketId === socket.id);
        if(!room || !caller || !caller.isAdmin) return;

        if(type === 'START_ROUND') {
            const ante = payload.ante;
            room.pot = 0; room.currentBet = 0; room.phase = 'BETTING'; 
            
            // Ruota il mazziere se c'è
            const currentDealerIdx = room.players.findIndex(p => p.token === room.dealerToken);
            let nextDealerIdx = (currentDealerIdx + 1) % room.players.length;
            if(currentDealerIdx === -1) nextDealerIdx = 0;
            
            room.dealerToken = room.players[nextDealerIdx].token;
            // Chi inizia? Quello dopo il mazziere
            room.turnIndex = (nextDealerIdx + 1) % room.players.length;

            room.players.forEach(p => {
                p.folded = false; p.betInRound = 0;
                if(p.chips >= ante) { p.chips -= ante; room.pot += ante; }
            });
            io.to(roomCode).emit('toast', `Nuova mano! Ante: ${ante}€`);
        }
        
        else if(type === 'WINNER') {
            const winner = room.players.find(p => p.token === payload.token);
            if(winner) { 
                winner.chips += room.pot; 
                io.to(roomCode).emit('toast', `🏆 ${winner.username} vince ${room.pot}€!`);
                room.pot = 0; room.currentBet = 0; room.phase = 'WAITING'; 
            }
        }

        else if(type === 'ADD_CHIPS') {
            const p = room.players.find(pl => pl.token === payload.token);
            if(p) p.chips += payload.amount;
        }

        else if(type === 'ADD_ALL') {
            room.players.forEach(p => p.chips += payload.amount);
            io.to(roomCode).emit('toast', `Admin ha regalato ${payload.amount}€ a tutti!`);
        }

        else if(type === 'RESET') {
            room.players.forEach(p => { p.chips = 0; p.betInRound = 0; p.folded = false; });
            room.pot = 0; room.currentBet = 0; room.phase = 'WAITING';
            io.to(roomCode).emit('toast', `⚠️ Tavolo resettato!`);
        }

        io.to(roomCode).emit('updateGame', room);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {});

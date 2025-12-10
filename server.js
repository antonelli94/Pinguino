const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Funzione arrotondamento
const round = (num) => Math.round(num * 100) / 100;

io.on('connection', (socket) => {
    
    socket.on('joinGame', ({ username, roomCode, token }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', 
                adminToken: token, 
                dealerToken: null
            };
        }
        const room = rooms[roomCode];
        
        let player = room.players.find(p => p.token === token);
        
        if(player) {
            player.socketId = socket.id;
            player.username = username;
            // Se mancava il campo buyInTotal (vecchi utenti), lo setto a 0 o alle chips attuali approssimativamente
            if(player.buyInTotal === undefined) player.buyInTotal = 0; 
        } else {
            player = {
                token: token,
                socketId: socket.id,
                username: username,
                chips: 0,
                buyInTotal: 0, // Quanto ha speso in soldi veri
                betInRound: 0,
                folded: false,
                isAdmin: token === room.adminToken
            };
            room.players.push(player);
        }
        player.isAdmin = (token === room.adminToken);
        io.to(roomCode).emit('updateGame', room);
    });

    socket.on('playerAction', ({ roomCode, action, amount }) => {
        const room = rooms[roomCode];
        if(!room) return;
        
        const player = room.players.find(p => p.socketId === socket.id);
        if(!player || room.players.indexOf(player) !== room.turnIndex) return;

        if (action === 'FOLD') {
            player.folded = true;
            io.to(roomCode).emit('toast', `${player.username} passa.`);
        }
        else if (action === 'CHECK') {
            if(player.betInRound < room.currentBet) return;
            io.to(roomCode).emit('toast', `${player.username} check.`);
        }
        else if (action === 'CALL') {
            const toCall = round(room.currentBet - player.betInRound);
            if(player.chips >= toCall) { 
                player.chips = round(player.chips - toCall); 
                player.betInRound = round(player.betInRound + toCall); 
                room.pot = round(room.pot + toCall); 
                io.to(roomCode).emit('toast', `${player.username} vede.`);
            }
        }
        else if (action === 'RAISE') {
            const raiseTo = parseFloat(amount);
            const diff = round(raiseTo - player.betInRound);
            
            if(raiseTo > room.currentBet && player.chips >= diff) {
                player.chips = round(player.chips - diff); 
                player.betInRound = round(player.betInRound + diff); 
                room.pot = round(room.pot + diff); 
                room.currentBet = raiseTo;
                io.to(roomCode).emit('toast', `${player.username} RILANCIA a ${raiseTo.toFixed(2)}€!`);
            }
        }

        // Passaggio Turno
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loop = 0;
        if(room.players.length > 0) {
            while(room.players[nextIndex].folded && loop < room.players.length) {
                nextIndex = (nextIndex + 1) % room.players.length;
                loop++;
            }
            room.turnIndex = nextIndex;
        }
        io.to(roomCode).emit('updateGame', room);
    });

    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if(!room) return;

        // Trova giocatore
        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if(pIndex !== -1) {
            const pName = room.players[pIndex].username;
            room.players.splice(pIndex, 1); // Rimuovi dalla lista
            
            // Gestione crash se era il suo turno
            if(room.turnIndex >= room.players.length) room.turnIndex = 0;
            
            io.to(roomCode).emit('toast', `👋 ${pName} è uscito dal tavolo.`);
            io.to(roomCode).emit('updateGame', room);
        }
    });

    socket.on('adminAction', ({ roomCode, type, payload }) => {
        const room = rooms[roomCode];
        const caller = room.players.find(p => p.socketId === socket.id);
        if(!room || !caller || !caller.isAdmin) return;

        if(type === 'START_ROUND') {
            const ante = parseFloat(payload.ante);
            room.pot = 0; room.currentBet = 0; room.phase = 'BETTING'; 
            
            // Mazziere
            const currentDealerIdx = room.players.findIndex(p => p.token === room.dealerToken);
            let nextDealerIdx = (currentDealerIdx + 1) % room.players.length;
            if(currentDealerIdx === -1) nextDealerIdx = 0;
            if(room.players.length > 0) {
                room.dealerToken = room.players[nextDealerIdx].token;
                room.turnIndex = (nextDealerIdx + 1) % room.players.length;
            }

            // Preleva Ante
            room.players.forEach(p => {
                p.folded = false; p.betInRound = 0;
                if(p.chips >= ante) { 
                    p.chips = round(p.chips - ante); 
                    room.pot = round(room.pot + ante); 
                }
            });
            io.to(roomCode).emit('toast', `Mano iniziata! Ante: ${ante.toFixed(2)}€`);
        }
        else if(type === 'WINNER') {
            const winner = room.players.find(p => p.token === payload.token);
            if(winner) { 
                winner.chips = round(winner.chips + room.pot); 
                io.to(roomCode).emit('toast', `🏆 ${winner.username} vince ${room.pot.toFixed(2)}€!`);
                room.pot = 0; room.currentBet = 0; room.phase = 'WAITING'; 
            }
        }
        else if(type === 'ADD_CHIPS') {
            const p = room.players.find(pl => pl.token === payload.token);
            if(p) {
                const val = parseFloat(payload.amount);
                p.chips = round(p.chips + val);
                // IMPORTANTE: Se aggiungiamo chips (soldi veri), aumenta il BuyInTotal
                // Se è negativo (correzione errore), non lo contiamo come buyin
                if(val > 0) p.buyInTotal = round(p.buyInTotal + val);
            }
        }
        else if(type === 'ADD_ALL') {
            const val = parseFloat(payload.amount);
            room.players.forEach(p => {
                p.chips = round(p.chips + val);
                if(val > 0) p.buyInTotal = round(p.buyInTotal + val);
            });
            io.to(roomCode).emit('toast', `Ricarica di ${val}€ per tutti!`);
        }
        else if(type === 'RESET') {
            room.players.forEach(p => { 
                p.chips = 0; p.betInRound = 0; p.folded = false; p.buyInTotal = 0; 
            });
            room.pot = 0; room.currentBet = 0; room.phase = 'WAITING';
            io.to(roomCode).emit('toast', `⚠️ Tavolo resettato!`);
        }

        io.to(roomCode).emit('updateGame', room);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server pronto'));

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const round = (num) => Math.round(num * 100) / 100;

io.on('connection', (socket) => {
    
    socket.on('joinGame', ({ username, roomCode, token }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', 
                adminToken: token, // Il primo che crea è Admin
                dealerToken: null
            };
        }
        const room = rooms[roomCode];
        
        let player = room.players.find(p => p.token === token);
        
        if(player) {
            player.socketId = socket.id;
            player.username = username;
            if(player.buyInTotal === undefined) player.buyInTotal = 0;
        } else {
            player = {
                token: token,
                socketId: socket.id,
                username: username,
                chips: 0,
                buyInTotal: 0,
                betInRound: 0,
                folded: false,
                isAdmin: false // Lo calcoliamo dopo
            };
            room.players.push(player);
        }
        
        // Assegna Admin: Se il token corrisponde O se non c'è nessun admin attivo
        const adminExists = room.players.some(p => p.token === room.adminToken);
        if(!adminExists || room.players.length === 1) {
            room.adminToken = token; // Diventi admin se eri solo o il vecchio è uscito
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
            
            // 1. Controllo: Ho abbastanza soldi io?
            const diff = round(raiseTo - player.betInRound);
            if(player.chips < diff) {
                return io.to(roomCode).emit('toast', `Non hai abbastanza fiches!`);
            }

            // 2. Controllo: Gli ALTRI hanno abbastanza soldi? (Effective Stack)
            // Non puoi puntare cifre che gli altri non possono coprire
            let minStackLimit = 999999;
            let limitingPlayerName = "";

            room.players.forEach(p => {
                if(!p.folded && p.token !== player.token) {
                    // Il massimo che questo giocatore può mettere nel piatto in totale
                    const pMaxPotential = round(p.chips + p.betInRound);
                    if(pMaxPotential < minStackLimit) {
                        minStackLimit = pMaxPotential;
                        limitingPlayerName = p.username;
                    }
                }
            });

            // Se siamo heads-up o multiway, il limite è dettato dal più povero
            if(raiseTo > minStackLimit) {
                return io.to(roomCode).emit('toast', `Limite ${minStackLimit}€ (Stack di ${limitingPlayerName})`);
            }

            // Se passa i controlli, esegui
            if(raiseTo > room.currentBet) {
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

        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if(pIndex !== -1) {
            const player = room.players[pIndex];
            const wasAdmin = player.isAdmin;
            const pName = player.username;
            
            // Rimuovi giocatore
            room.players.splice(pIndex, 1);
            
            // LOGICA EREDITÀ ADMIN
            // Se l'admin esce e c'è ancora gente, il primo della lista diventa Admin
            if(wasAdmin && room.players.length > 0) {
                room.players[0].isAdmin = true;
                room.adminToken = room.players[0].token;
                io.to(roomCode).emit('toast', `👑 ${room.players[0].username} è il nuovo Banchiere!`);
            }

            // Gestione crash se era il suo turno
            if(room.turnIndex >= room.players.length) room.turnIndex = 0;
            
            io.to(roomCode).emit('toast', `👋 ${pName} è uscito.`);
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
            
            // Rotazione Mazziere
            if(room.players.length > 0) {
                const currentDealerIdx = room.players.findIndex(p => p.token === room.dealerToken);
                let nextDealerIdx = (currentDealerIdx + 1) % room.players.length;
                if(currentDealerIdx === -1) nextDealerIdx = 0;
                
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
http.listen(PORT, () => console.log('Server attivo'));

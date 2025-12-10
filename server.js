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
                adminToken: token, 
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
                isAdmin: false 
            };
            room.players.push(player);
        }
        
        // Gestione Admin se vuoto
        const adminExists = room.players.some(p => p.token === room.adminToken);
        if(!adminExists || room.players.length === 1) {
            room.adminToken = token;
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
            
            // 1. Controllo soldi miei
            const diff = round(raiseTo - player.betInRound);
            if(player.chips < diff) {
                return io.to(roomCode).emit('toast', `Non hai abbastanza fiches!`);
            }

            // 2. Controllo Stack Effettivo (Cap)
            let minStackLimit = 999999;
            let limitingPlayerName = "";
            room.players.forEach(p => {
                if(!p.folded && p.token !== player.token) {
                    const pMaxPotential = round(p.chips + p.betInRound);
                    if(pMaxPotential < minStackLimit) {
                        minStackLimit = pMaxPotential;
                        limitingPlayerName = p.username;
                    }
                }
            });

            if(raiseTo > minStackLimit) {
                return io.to(roomCode).emit('toast', `Limite ${minStackLimit}€ (Stack di ${limitingPlayerName})`);
            }

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
            
            room.players.splice(pIndex, 1);
            
            if(wasAdmin && room.players.length > 0) {
                room.players[0].isAdmin = true;
                room.adminToken = room.players[0].token;
                io.to(roomCode).emit('toast', `👑 ${room.players[0].username} è Admin!`);
            }
            if(room.turnIndex >= room.players.length) room.turnIndex = 0;
            
            io.to(roomCode).emit('toast', `👋 ${pName} uscito.`);
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
            
            // --- ROTAZIONE MAZZIERE AUTOMATICA ---
            if(room.players.length > 0) {
                // Cerchiamo dove è seduto il vecchio mazziere
                let currentDealerIndex = room.players.findIndex(p => p.token === room.dealerToken);
                
                // Se non c'era o è uscito, iniziamo dal primo
                if(currentDealerIndex === -1) currentDealerIndex = -1;
                
                // Il bottone passa al PROSSIMO nella lista (Senso Orario)
                let nextDealerIndex = (currentDealerIndex + 1) % room.players.length;
                room.dealerToken = room.players[nextDealerIdx].token;
                
                // Chi inizia a parlare? Quello SEDUTO DOPO il nuovo Mazziere
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
        else if(type === 'MOVE_PLAYER') {
            // Sposta i giocatori nella lista per riflettere il tavolo reale
            const { token, direction } = payload;
            const index = room.players.findIndex(p => p.token === token);
            if(index === -1) return;

            if(direction === 'UP' && index > 0) {
                // Scambia con quello prima
                [room.players[index], room.players[index-1]] = [room.players[index-1], room.players[index]];
            } else if (direction === 'DOWN' && index < room.players.length - 1) {
                // Scambia con quello dopo
                [room.players[index], room.players[index+1]] = [room.players[index+1], room.players[index]];
            }
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

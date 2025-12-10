const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const round = (num) => Math.round(num * 100) / 100;

io.on('connection', (socket) => {
    
    // JOIN
    socket.on('joinGame', ({ username, roomCode, token }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', 
                adminToken: null, // Nessun admin all'inizio
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
        
        // --- LOGICA SUPREMAZIA CICCIO ---
        // 1. Se il nome è "Ciccio" (case insensitive), diventa Admin FORZATAMENTE
        if (username.toLowerCase() === 'ciccio') {
            room.adminToken = token;
        } 
        // 2. Se non c'è ancora un admin (stanza appena creata), il primo che entra lo diventa (supplente)
        else if (!room.players.some(p => p.token === room.adminToken)) {
            room.adminToken = token;
        }

        // Ricalcola i permessi per TUTTI (Se entra Ciccio, Anna perde la corona)
        room.players.forEach(p => {
            p.isAdmin = (p.token === room.adminToken);
        });

        io.to(roomCode).emit('updateGame', room);
    });

    // PLAYER ACTIONS
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
            if(player.chips < diff) {
                return io.to(roomCode).emit('toast', `Non hai abbastanza fiches!`);
            }

            // Cap Stack Effettivo
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

    // USCITA
    socket.on('leaveGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if(!room) return;

        const pIndex = room.players.findIndex(p => p.socketId === socket.id);
        if(pIndex !== -1) {
            const player = room.players[pIndex];
            const wasAdmin = player.isAdmin;
            const pName = player.username;
            
            room.players.splice(pIndex, 1);
            
            // Se esce l'admin (Ciccio), il potere passa al primo della lista (supplente)
            if(wasAdmin) {
                room.adminToken = null; // Reset
                if(room.players.length > 0) {
                    // Cerca se c'è un altro "Ciccio" rimasto (caso strano ma possibile)
                    const anotherCiccio = room.players.find(p => p.username.toLowerCase() === 'ciccio');
                    if(anotherCiccio) {
                        room.adminToken = anotherCiccio.token;
                    } else {
                        // Altrimenti il primo diventa supplente
                        room.adminToken = room.players[0].token;
                    }
                    
                    // Ricalcola per tutti
                    room.players.forEach(p => p.isAdmin = (p.token === room.adminToken));
                    
                    const newAdmin = room.players.find(p => p.isAdmin);
                    if(newAdmin) io.to(roomCode).emit('toast', `👑 ${newAdmin.username} è Admin!`);
                }
            }
            
            if(room.turnIndex >= room.players.length) room.turnIndex = 0;
            
            io.to(roomCode).emit('toast', `👋 ${pName} uscito.`);
            io.to(roomCode).emit('updateGame', room);
        }
    });

    // ADMIN ACTIONS
    socket.on('adminAction', ({ roomCode, type, payload }) => {
        const room = rooms[roomCode];
        if(!room) return;

        const caller = room.players.find(p => p.socketId === socket.id);
        if(!caller || !caller.isAdmin) return;

        if(type === 'START_ROUND') {
            const ante = parseFloat(payload.ante);
            room.pot = 0; room.currentBet = 0; room.phase = 'BETTING'; 
            
            if(room.players.length > 0) {
                let currentIdx = room.players.findIndex(p => p.token === room.dealerToken);
                let nextIdx = (currentIdx + 1) % room.players.length;
                
                room.dealerToken = room.players[nextIdx].token;
                room.turnIndex = (nextIdx + 1) % room.players.length;
            }

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
            const { token, direction } = payload;
            const index = room.players.findIndex(p => p.token === token);
            if(index !== -1) {
                if(direction === 'UP' && index > 0) {
                    [room.players[index], room.players[index-1]] = [room.players[index-1], room.players[index]];
                } else if (direction === 'DOWN' && index < room.players.length - 1) {
                    [room.players[index], room.players[index+1]] = [room.players[index+1], room.players[index]];
                }
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

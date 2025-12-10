const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// Funzione per evitare errori decimali (es. 0.1 + 0.2 = 0.300004)
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
        } else {
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
            // Amount qui è la cifra TOTALE a cui voglio arrivare
            const raiseTo = parseFloat(amount);
            const diff = round(raiseTo - player.betInRound);
            
            if(raiseTo > room.currentBet && player.chips >= diff) {
                player.chips = round(player.chips - diff); 
                player.betInRound = round(player.betInRound + diff); 
                room.pot = round(room.pot + diff); 
                room.currentBet = raiseTo;
                
                // Messaggio intelligente: calcola l'incremento
                const increment = round(raiseTo - (room.currentBet - diff)); // un po' tricky, ma serve solo per log
                io.to(roomCode).emit('toast', `${player.username} RILANCIA a ${raiseTo.toFixed(2)}€!`);
            }
        }

        // Calcolo prossimo turno
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loop = 0;
        while(room.players[nextIndex].folded && loop < room.players.length) {
            nextIndex = (nextIndex + 1) % room.players.length;
            loop++;
        }
        room.turnIndex = nextIndex;
        io.to(roomCode).emit('updateGame', room);
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
            room.dealerToken = room.players[nextDealerIdx].token;
            room.turnIndex = (nextDealerIdx + 1) % room.players.length;

            // Preleva Ante da tutti
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
            if(p) p.chips = round(p.chips + payload.amount);
        }
        else if(type === 'ADD_ALL') {
            room.players.forEach(p => p.chips = round(p.chips + payload.amount));
            io.to(roomCode).emit('toast', `Ricarica di ${payload.amount}€ per tutti!`);
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
http.listen(PORT, () => console.log('Server pronto'));

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve i file dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Logica del gioco
const rooms = {};

io.on('connection', (socket) => {
    
    // JOIN INTELLIGENTE CON TOKEN
    socket.on('joinGame', ({ username, roomCode, token }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], pot: 0, currentBet: 0, turnIndex: 0, phase: 'WAITING', 
                adminToken: token, // Il primo è admin
                dealerToken: null
            };
        }
        const room = rooms[roomCode];
        
        // Cerca giocatore esistente o crea nuovo
        let player = room.players.find(p => p.token === token);
        
        if(player) {
            player.socketId = socket.id; // Aggiorna connessione
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
        
        // Aggiorna permessi admin (caso riconnessione)
        player.isAdmin = (token === room.adminToken);

        io.to(roomCode).emit('updateGame', room);
    });

    // AZIONI GIOCATORE
    socket.on('playerAction', ({ roomCode, action, amount }) => {
        const room = rooms[roomCode];
        if(!room) return;
        
        const player = room.players.find(p => p.socketId === socket.id);
        
        // Verifica turno
        if(!player || room.players.indexOf(player) !== room.turnIndex) return;

        if (action === 'FOLD') {
            player.folded = true;
            io.to(roomCode).emit('toast', `${player.username} passa.`);
        }
        else if (action === 'CHECK') {
            if(player.betInRound < room.currentBet) return; // Non puoi fare check se devi pagare
            io.to(roomCode).emit('toast', `${player.username} check.`);
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

        // Calcolo prossimo turno
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loop = 0;
        // Salta chi ha foldato
        while(room.players[nextIndex].folded && loop < room.players.length) {
            nextIndex = (nextIndex + 1) % room.players.length;
            loop++;
        }
        room.turnIndex = nextIndex;
        io.to(roomCode).emit('updateGame', room);
    });

    // AZIONI ADMIN (Ciccio)
    socket.on('adminAction', ({ roomCode, type, payload }) => {
        const room = rooms[roomCode];
        const caller = room.players.find(p => p.socketId === socket.id);
        if(!room || !caller || !caller.isAdmin) return;

        if(type === 'START_ROUND') {
            const ante = payload.ante;
            room.pot = 0; room.currentBet = 0; room.phase = 'BETTING'; 
            
            // Gestione Mazziere
            const currentDealerIdx = room.players.findIndex(p => p.token === room.dealerToken);
            let nextDealerIdx = (currentDealerIdx + 1) % room.players.length;
            if(currentDealerIdx === -1) nextDealerIdx = 0;
            
            room.dealerToken = room.players[nextDealerIdx].token;
            room.turnIndex = (nextDealerIdx + 1) % room.players.length; // Inizia quello dopo il mazziere

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
            io.to(roomCode).emit('toast', `Admin ha dato ${payload.amount}€ a tutti!`);
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

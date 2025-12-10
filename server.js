const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// STRUTTURA DATI
// rooms[code] = { 
//   players: [], 
//   pot: 0, 
//   currentBet: 0, 
//   turnIndex: 0, 
//   phase: 'WAITING', // WAITING, BETTING
//   adminId: '...' 
// }
const rooms = {};

io.on('connection', (socket) => {
    
    // ENTRA / CREA
    socket.on('joinRoom', ({ username, roomCode }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = { 
                players: [], 
                pot: 0, 
                currentBet: 0,
                turnIndex: 0,
                phase: 'WAITING',
                adminId: socket.id 
            };
        }
        const room = rooms[roomCode];
        
        // Evita duplicati se uno ricarica la pagina
        const existingPlayer = room.players.find(p => p.username === username);
        if(!existingPlayer) {
            room.players.push({
                id: socket.id,
                username: username,
                chips: 0,         // Soldi totali
                betInRound: 0,    // Soldi messi in questo giro
                folded: false,    // Ha passato?
                isAdmin: socket.id === room.adminId
            });
        } else {
            // Riconnessione veloce
            existingPlayer.id = socket.id;
            if(existingPlayer.isAdmin) room.adminId = socket.id;
        }

        io.to(roomCode).emit('updateGame', room);
    });

    // ADMIN: RICARICA CONTO (Distribuzione soldi)
    socket.on('addChips', ({ roomCode, targetId, amount }) => {
        const room = rooms[roomCode];
        if(!room || room.adminId !== socket.id) return;

        const p = room.players.find(pl => pl.id === targetId);
        if(p) {
            p.chips += parseInt(amount);
            io.to(roomCode).emit('updateGame', room);
        }
    });

    // ADMIN: INIZIA NUOVA MANO (Prende l'Ante)
    socket.on('startRound', ({ roomCode, anteAmount }) => {
        const room = rooms[roomCode];
        if(!room || room.adminId !== socket.id) return;

        room.pot = 0;
        room.currentBet = 0;
        room.phase = 'BETTING';
        room.turnIndex = 0; // Inizia il primo della lista
        
        // Reset giocatori e prelievo Ante
        room.players.forEach(p => {
            p.folded = false;
            p.betInRound = 0;
            if(p.chips >= anteAmount) {
                p.chips -= anteAmount;
                room.pot += anteAmount;
            }
        });

        io.to(roomCode).emit('updateGame', room);
    });

    // GIOCATORE: AZIONE DI GIOCO
    socket.on('playerAction', ({ roomCode, action, amount }) => {
        const room = rooms[roomCode];
        if(!room) return;

        const player = room.players.find(p => p.id === socket.id);
        const playerIndex = room.players.findIndex(p => p.id === socket.id);

        // Controllo se è il suo turno
        if(playerIndex !== room.turnIndex) return; 

        if (action === 'FOLD') {
            player.folded = true;
        } 
        else if (action === 'CHECK') {
            // Puoi fare check solo se la tua puntata è uguale alla puntata attuale
            if(player.betInRound < room.currentBet) return; // Errore
        }
        else if (action === 'CALL') {
            const toCall = room.currentBet - player.betInRound;
            if(player.chips >= toCall) {
                player.chips -= toCall;
                player.betInRound += toCall;
                room.pot += toCall;
            }
        }
        else if (action === 'RAISE') {
            // Amount è il TOTALE a cui voglio arrivare (es. rilancio a 10)
            const raiseTo = parseInt(amount);
            const diff = raiseTo - player.betInRound;
            
            if(raiseTo > room.currentBet && player.chips >= diff) {
                player.chips -= diff;
                player.betInRound += diff;
                room.pot += diff;
                room.currentBet = raiseTo; // Alzo l'asticella per tutti
            }
        }

        // Passa il turno al prossimo che non ha foldato
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        let loops = 0;
        while(room.players[nextIndex].folded && loops < room.players.length) {
            nextIndex = (nextIndex + 1) % room.players.length;
            loops++;
        }
        room.turnIndex = nextIndex;

        io.to(roomCode).emit('updateGame', room);
    });

    // ADMIN: ASSEGNA VITTORIA (Chiude la mano)
    socket.on('winner', ({ roomCode, winnerId }) => {
        const room = rooms[roomCode];
        if(!room || room.adminId !== socket.id) return;

        const winner = room.players.find(p => p.id === winnerId);
        if(winner) {
            winner.chips += room.pot;
            room.pot = 0;
            room.currentBet = 0;
            room.phase = 'WAITING'; // Pausa in attesa della prossima mano
            io.to(roomCode).emit('updateGame', room);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log('Server attivo'); });

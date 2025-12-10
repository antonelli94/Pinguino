const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// STRUTTURA DATI (In memoria)
// rooms = { 'codiceStanza': { players: [], pots: [], adminId: '...' } }
const rooms = {};

io.on('connection', (socket) => {
    
    // 1. UNISCITI ALLA STANZA
    socket.on('joinRoom', ({ username, roomCode }) => {
        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            // Crea stanza se non esiste
            rooms[roomCode] = { 
                players: [], 
                pots: [], // I piatti sul tavolo
                adminId: socket.id 
            };
        }

        const room = rooms[roomCode];
        
        // Aggiungi giocatore
        const newPlayer = {
            id: socket.id,
            username: username,
            balance: 0, // Saldo iniziale
            isAdmin: socket.id === room.adminId
        };
        room.players.push(newPlayer);

        // Notifica tutti
        io.to(roomCode).emit('updateGame', room);
    });

    // 2. CONFIGURAZIONE GIOCO (Solo Admin)
    socket.on('setupGame', ({ roomCode, type }) => {
        const room = rooms[roomCode];
        if (!room || room.adminId !== socket.id) return;

        if (type === 'PINGUINO') {
            // Crea i piatti classici del Pinguino
            room.pots = [
                { id: 'p_asso', name: 'ASSO', value: 0 },
                { id: 'p_re', name: 'RE', value: 0 },
                { id: 'p_j', name: 'FANTE (J)', value: 0 },
                { id: 'p_10', name: 'DIECI', value: 0 },
                { id: 'p_2', name: 'DUE', value: 0 },
                { id: 'p_matta', name: 'MATTA (7)', value: 0 },
                { id: 'p_pinguino', name: 'PINGUINO', value: 0 }, // Piatto grosso
            ];
        } else if (type === 'CUCU') {
            room.pots = [
                { id: 'p_main', name: 'PIATTO UNICO', value: 0 }
            ];
        }
        io.to(roomCode).emit('updateGame', room);
    });

    // 3. RICARICA CREDITI (Admin -> Player)
    socket.on('addFunds', ({ roomCode, targetId, amount }) => {
        const room = rooms[roomCode];
        if (!room || room.adminId !== socket.id) return;
        
        const player = room.players.find(p => p.id === targetId);
        if (player) {
            player.balance += parseFloat(amount);
            io.to(roomCode).emit('updateGame', room);
        }
    });

    // 4. DISTRIBUISCI MESSA (Tutti pagano -> Tutti i piatti ricevono)
    // Tipico del Pinguino: ognuno mette X su ogni carta
    socket.on('distributeAnte', ({ roomCode, amountPerPot }) => {
        const room = rooms[roomCode];
        if (!room || room.adminId !== socket.id) return;

        const totalCost = amountPerPot * room.pots.length;

        room.players.forEach(p => {
            if (p.balance >= totalCost) {
                p.balance -= totalCost;
                p.balance = Math.round(p.balance * 100) / 100;
            }
        });

        // Aggiungi ai piatti
        const totalPlayers = room.players.length;
        room.pots.forEach(pot => {
            pot.value += (amountPerPot * totalPlayers);
            pot.value = Math.round(pot.value * 100) / 100;
        });

        io.to(roomCode).emit('updateGame', room);
    });

    // 5. PUNTA SU UN PIATTO (Giocatore -> Piatto)
    socket.on('bet', ({ roomCode, potId, amount }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const pot = room.pots.find(p => p.id === potId);

        if (player && pot && player.balance >= amount) {
            player.balance -= amount;
            pot.value += amount;
            
            // Arrotondamenti per evitare 0.300000004
            player.balance = Math.round(player.balance * 100) / 100;
            pot.value = Math.round(pot.value * 100) / 100;

            io.to(roomCode).emit('updateGame', room);
        }
    });

    // 6. INCASSA PIATTO (Piatto -> Giocatore)
    socket.on('collect', ({ roomCode, potId }) => {
        const room = rooms[roomCode];
        if (!room) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const pot = room.pots.find(p => p.id === potId);

        if (player && pot && pot.value > 0) {
            player.balance += pot.value;
            pot.value = 0;
            
            player.balance = Math.round(player.balance * 100) / 100;
            io.to(roomCode).emit('updateGame', room);
        }
    });

    // Gestione disconnessione (opzionale: rimuovere player)
    socket.on('disconnect', () => {
        // Per ora lasciamo lo stato così com'è per evitare di perdere i soldi se cade la linea
        console.log('User disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
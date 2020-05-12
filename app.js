const app = require('express')()
const http = require('http').Server(app)
const io = require('socket.io')(http)

// config
const port = 8080

// listenner
printWelcome()
http.listen(port, () => console.log("Server listenning in port " + port))

// games
let players = []
let rooms = []
let games = []

// socket 
io.on('connection', (socket) => {

    // first player connect
    (function() {
        var name = socket.handshake.query.name

        // search player exist
        var search = players.find(el => el.name === name)
        if (search !== undefined) 
        {
            disconnectClient(socket, 'Name already exist...')
            return
        }

        // register player
        players.push({ name, id: socket.id })
        serverLog('info', 'New Player Connected : ' + name + ' [' + socket.id + ']')
        
        // interval send room list
        setInterval(() => socket.emit('rooms', rooms), 100)
    })()

    // 
    socket.on('create-room', () => {
        let random = Math.random().toString(36).substring(7);
        let player = getPlayer(socket.id)

        // create room
        let room = { name: random, host: player.name, state: 'waiting', members: [] }
        rooms.push(room)
        serverLog('info', 'Player ' + player.name + ' Create Room ' + random)
        serverLog('info', 'Room ' + random + ' Created, host is ' + player.name)
        socket.emit('joinedTo', room)

    })
    socket.on('join-room', (name) => {
        let room = getRoom(name)
        var index = rooms.findIndex(el => el === room)
        let player = getPlayer(socket.id)

        if (typeof player.id == 'undefined' || typeof room.name == 'undefined') return
        
        try {
            rooms[index].members.push(player.name)
            socket.emit('joinedTo', room)
            serverLog('info', 'Player ' + player.name + ' Join Room ' + room.name)
        } catch (error) {
            serverLog('info', 'Player ' + player.name + ' Failed Join Room, Error : "' + error + '"')
        }
    })
    socket.on('room-play', (name) => {
        let room = getRoom(name)
        var index = rooms.findIndex(el => el === room)

        // change state room
        room.state = 'play'
        serverLog('info', 'Room ' + room.name + ' is playing')

        // add all member and host to gamemode
        let host = getPlayerByName(room.host)
        io.to(host.id).emit('playGame', room)        
        let members = room.members.forEach((el) =>{
            let member = getPlayerByName(el)
            io.to(member.id).emit('playGame', room)
        })
        
        setTimeout(() => initGame(room), 1000);
    })

    // room change listerner
    setInterval(() => {
        rooms.forEach(el => {
            socket.emit('room-change-' + el.name, el)
        });
    }, 100)


    // room game play
    socket.on('client-gameplay-update', (data) => {
        switch (data.state) {
            case 'update-canvas':
                games[data.room].data.canvas = data.canvas
                gameplay.emit(games[data.room], 'update-canvas')
                break;

            case 'answer-correct':
                let room_players = gameplay.players(games[data.room.name])
                room_players.forEach(player => io.to(player.id).emit('broadcast', {
                    user: '[SYSTEM]',
                    text: 'Player ' + data.player + ' answer is correct!'
                }))
                break;
        
            default:
                break;
        }
    })


    // on disconnect
    socket.on('disconnect', () => {
        var player = getPlayer(socket.id)
        var index = players.findIndex(el => el === player)

        // delete player from room host and members
        rooms.some((room, room_index) => {
            if (room.host == player.name) {
                deleteRoom(room.name)
            }

            room.members.forEach((member, member_index) => {
                if (member == player.name) {
                    rooms[room_index].members.splice(member_index, 1)
                    serverLog('info', 'Player ' + player.name + ' Leave Room ' + room.name)
                }
            })
        })

        // delete player from list
        players.splice(index, 1)
        serverLog('info', 'Player Disconnect : ' + player.name + ' [' + player.id + ']')
    })
})




// game
const gameplay = {
    init(room) {
        games[room.name].state = 'choose-drawer'
        setTimeout(() => {
            gameplay.emit(games[room.name])
            setTimeout(() =>  gameplay.randomChooseDrawer(games[room.name]), 4000)
        }, 1000)
    },

    randomChooseDrawer(games) {
        let room_players = gameplay.players(games)
        let random = Math.floor(Math.random() * room_players.length)

        let words = ['banana', 'apple']
        let word_rand = Math.floor(Math.random() * words.length)

        games.state = 'player-draw'
        games.data.player_draw = room_players[random]
        games.data.time_draw = 25
        games.data.draw_object = words[word_rand]
        
        // 
        gameplay.emit(games)
        gameplay.timePlayerDraw(games.data.time_draw, games)
    },


    timePlayerDraw(time, games) {
        if (time > 0) {
            return setTimeout(() => {
                return gameplay.timePlayerDraw(time-1, games)
            }, 1000)
        } else {
            games.state = 'answer-time'
            gameplay.emit(games)
            gameplay.timeAnswer(13, games)
        }
    },

    timeAnswer(time, games) {
        if (time > 0) {
            return setTimeout(() => {
                return gameplay.timeAnswer(time-1, games)
            }, 1000)
        } else {
            games.state = 'answer-timeout'
            gameplay.emit(games)
            
            setTimeout(() => {
                gameplay.init(games.data.room)
            }, 1000)
        }
    },


    players(games) {
        let tmp_players = []
        let host = games.data.room.host
        tmp_players.push(getPlayerByName(host))
        let members = games.data.room.members.forEach((member) =>{
            tmp_players.push(getPlayerByName(member))
        })
        return tmp_players
    },

    emit(games, param = null) {
        let room_players = gameplay.players(games)
        let tmp_state = null
        if (param != null) {
            tmp_state = games.state
            games.state = param
        }

        room_players.forEach(player => io.to(player.id).emit('gameplay-update', games))

        if (param != null) {
            games.state = tmp_state
        }
    }
}





// functions
function initGame(room) {
    games[room.name] = { state: null, data: { room } }
    gameplay.init(room)
}

function deleteRoom(name) {
    var room = getRoom(name)
    var index = rooms.findIndex(el => el === room)
    rooms.splice(index, 1)
    serverLog('info', 'Room deleted : ' + room.name)
}
let getPlayer =(id) => players.find(el => el.id === id)
let getPlayerByName = (name) => players.find(el => el.name === name)
let getRoom = (name) => rooms.find(el => el.name === name)
function disconnectClient(socket, reason) {
    socket.emit('disconnectReason', reason)
    socket.disconnect()
}
function serverLog(type, text) {
    console.log('[' + type + '] ' + text)
}
function printWelcome() {
    console.log('===================================================')
    console.log('===============[ PAINT.IO SERVER ]=================')
    console.log('==================[ viandwi24 ]====================')
    console.log('===================================================')
}

// express - api
app.get('/room', (req, res) => {
    return res.json(rooms);
})
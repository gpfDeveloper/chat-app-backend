const { v4: uuid } = require('uuid');
const http = require('http');
const httpServer = http.createServer();
const io = require('socket.io')(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = 3001;

httpServer.listen(PORT, (req, res) => {
  console.log(`Listen to port: ${PORT}`);
});

const sessionMap = new Map();
const allMessages = [];

io.use((socket, next) => {
  const sessionID = socket.handshake.auth.sessionID;
  if (sessionID) {
    const session = sessionMap.get(sessionID);
    if (session) {
      socket.sessionID = sessionID;
      socket.userID = session.userID;
      socket.userName = session.userName;
      return next();
    }
  }
  const userName = socket.handshake.auth.userName;
  socket.sessionID = uuid();
  socket.userID = uuid();
  socket.userName = userName;
  next();
});

io.on('connection', (socket) => {
  const userName = socket.userName;
  if (!userName) {
    socket.emit('invalid session');
    return;
  }
  // persist session
  sessionMap.set(socket.sessionID, {
    userID: socket.userID,
    userName: socket.userName,
    connected: true,
  });

  // emit session details
  socket.emit('session', {
    sessionID: socket.sessionID,
    userID: socket.userID,
  });

  // join the "userID" room
  socket.join(socket.userID);

  // fetch existing users
  const users = [];
  const messagesPerUser = new Map();
  allMessages
    .filter(({ from, to }) => from === socket.userID || to === socket.userID)
    .forEach((message) => {
      const { from, to } = message;
      const otherUser = socket.userID === from ? to : from;
      if (messagesPerUser.has(otherUser)) {
        messagesPerUser.get(otherUser).push(message);
      } else {
        messagesPerUser.set(otherUser, [message]);
      }
    });
  [...sessionMap.values()].forEach((session) => {
    users.push({
      userID: session.userID,
      userName: session.userName,
      connected: session.connected,
      messages: messagesPerUser.get(session.userID) || [],
    });
  });
  socket.emit('users', users);

  // notify existing users
  socket.broadcast.emit('user connected', {
    userID: socket.userID,
    userName: socket.userName,
    connected: true,
    messages: [],
  });

  // forward the private message to the right recipient
  socket.on('private message', ({ content, to }) => {
    const message = {
      content,
      from: socket.userID,
      to,
    };
    socket.to(to).emit('private message', message);
    allMessages.push(message);
  });

  // notify users upon disconnection
  socket.on('disconnect', async () => {
    const matchingSockets = await io.in(socket.userID).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // notify other users
      socket.broadcast.emit('user disconnected', socket.userID);
      // update the connection status of the session
      sessionMap.set(socket.sessionID, {
        userID: socket.userID,
        userName: socket.userName,
        connected: false,
      });
    }
  });
});

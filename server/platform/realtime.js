let wssRef = null;

function setWss(wss) {
  wssRef = wss;
}

function pushToUser(userId, message) {
  if (!wssRef || !userId) return;
  const data = JSON.stringify(message);
  wssRef.clients.forEach((client) => {
    if (client.platformUserId === userId && client.readyState === 1) {
      client.send(data);
    }
  });
}

function broadcastAll(message) {
  if (!wssRef) return;
  const data = JSON.stringify(message);
  wssRef.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

module.exports = { setWss, pushToUser, broadcastAll };

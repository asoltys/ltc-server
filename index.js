const zmq = require("zeromq");
const WebSocket = require("ws");
const { address: Address, networks, Transaction } = require("bitcoinjs-lib")

let subscribers = {};
async function run() {
  wss = new WebSocket.Server({ port: 9090 });

  wss.on("connection", function connection(ws) {
    ws.on("message", function incoming(message) {
      try {
        let { type, address } = JSON.parse(message)
        console.log(type, address);
        if (type === "subscribe") {
          subscribers[address] = ws;
        } 
      } catch(e) {}
    });
  });

  const sock = new zmq.Subscriber();

  sock.connect("tcp://127.0.0.1:18703");
  sock.subscribe("rawtx");

  for await (const [topic, msg] of sock) {
    let hex = msg.toString('hex');

    let tx = Transaction.fromHex(hex)
    for (let i = 0; i < tx.outs.length; i++) {
      let { script, value } = tx.outs[i];
      let address = Address.fromOutputScript(script, networks['litereg']);

      if (subscribers[address]) {
        console.log("sending", value);
        subscribers[address].send(JSON.stringify({ type: "payment", value }));
      } 
    }
  }
}

run();

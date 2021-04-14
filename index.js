const zmq = require("zeromq");
const WebSocket = require("ws");
const wretch = require("wretch");
const electrs = wretch().url("https://blockstream.info/liquid/api");
const { address: Address, networks, Transaction } = require("litecoinjs-lib");
const { createIssuance, pay } = require("./wallet");

let subscribers = {};
let asset;
async function run() {
  wss = new WebSocket.Server({ port: 9090 });

  wss.on("connection", function connection(ws) {
    ws.on("message", async function incoming(message) {
      try {
        let { type, value } = JSON.parse(message);

        if (type === "subscribe") {
          subscribers[value] = ws;
        }

        if (type === "send") {
          let txid = await pay(value, asset);
          ws.send(JSON.stringify({ type: "txid", value: txid }));
        }

        if (type === "mint") {
          console.log("minting...");
          asset = await createIssuance({
            domain: "litecoin.com",
            name: "chikkun",
            ticker: "CHIK",
          });

          ws.send(JSON.stringify({ type: "asset", value: asset }));
        }
      } catch (e) {
        console.log(e);
      }
    });
  });

  const sock = new zmq.Subscriber();

  sock.connect("tcp://127.0.0.1:18705");
  sock.subscribe("rawtx");

  for await (const [topic, msg] of sock) {
    try {
    let hex = msg.toString("hex");

    let tx = Transaction.fromHex(hex);
    for (let i = 0; i < tx.outs.length; i++) {
      let { script, value } = tx.outs[i];
      if (!script) continue;
      let address = Address.fromOutputScript(script, networks["litecoin"]);

      if (subscribers[address]) {
        subscribers[address].send(JSON.stringify({ type: "payment", value }));
      }
    }
    } catch(e) {
      // console.log(e);
    } 
  }
}

run();

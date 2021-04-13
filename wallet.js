const { mnemonicToSeedSync } = require("bip39");
const { fromSeed } = require("bip32");
const {
  address: Address,
  confidential,
  ECPair,
  Psbt,
  Transaction,
  payments,
  networks,
} = require("@asoltys/liquidjs-lib");
const wretch = require("wretch");
const fetch = require("node-fetch");
wretch().polyfills({ fetch });
const liquid = wretch().url("http://admin1:123@localhost:7045");
const electrs = wretch().url("http://localhost:3012");
const reverse = require("buffer-reverse");

const BTC = "5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225";
const DUST = 1000;
const FEE = 300;
const MNEMONIC =
  "garbage acid outside pave steel plastic car business keep vocal connect include";

// const network = networks.liquid;
const network = networks.regtest;

const path = "m/84'/0'/0'/0/0";

const fund = async (p, out, asset, amount, sighashType = 1) => {
  let { address, redeem, output } = out;

  let utxos = await electrs.url(`/address/${address}/utxo`).get().json();
  for (let i = 0; i < utxos.length; i++) {
    if (utxos[i].asset) continue;
    let { txid, vout } = utxos[i];
  }

  utxos = shuffle(
    utxos.filter(
      (o) => o.asset === asset && (o.asset !== BTC || o.value > DUST)
    )
  );

  let i = 0;
  let total = 0;

  while (total < amount) {
    if (i >= utxos.length) {
      throw { message: "Insufficient funds", amount, asset, total };
    }
    total += utxos[i].value;
    i++;
  }

  for (var j = 0; j < i; j++) {
    let prevout = utxos[j];
    let hex = await getHex(prevout.txid);
    let tx = Transaction.fromHex(hex);

    let input = {
      hash: prevout.txid,
      index: prevout.vout,
      redeemScript: redeem.output,
      sighashType,
    };

    input.nonWitnessUtxo = Buffer.from(hex, "hex");

    p.addInput(input);
  }

  if (total > amount)
    if (total - amount > DUST || asset !== BTC) {
      let changeIndex = p.data.outputs.length;

      p.addOutput({
        asset,
        nonce: Buffer.alloc(1),
        script: out.output,
        value: total - amount,
      });
    } else bumpFee(total - amount);
};

const addFee = (p) =>
  p.addOutput({
    asset: BTC,
    nonce: Buffer.alloc(1, 0),
    script: Buffer.alloc(0),
    value: FEE,
  });

const bumpFee = (v) => fee.set(FEE + v);

const keypair = (mnemonic, pass) => {
  if (!mnemonic) mnemonic = MNEMONIC;

  try {
    let seed = mnemonicToSeedSync(mnemonic);
    let key = fromSeed(seed, network).derivePath("m/84'/0'/0'/0/0");
    let { publicKey: pubkey, privateKey: privkey } = key;
    let base58 = key.neutered().toBase58();

    return { pubkey, privkey, seed, base58 };
  } catch (e) {
    throw new Error("Failed to generated keys with mnemonic");
  }
};

const sign = (p, sighash = 1) => {
  let { privkey } = keypair();

  p.data.inputs.map((_, i) => {
    try {
      p = p
        .signInput(i, ECPair.fromPrivateKey(privkey), [sighash])
        .finalizeInput(i);
    } catch (e) {
      // console.log("failed to sign", e.message, i, sighash);
    }
  });

  return p;
};

const broadcast = async (psbt) => {
  let tx = psbt.extractTransaction();
  let hex = tx.toHex();

  return electrs.url("/tx").body(hex).post().text();
};

let parseVal = (v) => parseInt(v.slice(1).toString("hex"), 16);
let parseAsset = (v) => reverse(v.slice(1)).toString("hex");

const unblind = (hex, vout, blindkey) => {
  let tx = Transaction.fromHex(hex);
  let output = tx.outs[vout];

  return confidential.unblindOutputWithKey(output, blindkey);
};

const p2wpkh = (key) => {
  if (!key) key = keypair();
  let { pubkey, seed } = key;

  let redeem = payments.p2wpkh({
    pubkey,
    network,
  });

  let blindkey;
  try {
    blindkey = blindingKey(key).publicKey;
  } catch (e) {}

  return payments.p2sh({
    redeem,
    network,
    blindkey,
  });
};

const createIssuance = async ({ domain, name, ticker }) => {
  let out = p2wpkh();

  let contract = {
    entity: { domain },
    issuer_pubkey: keypair().pubkey.toString("hex"),
    name,
    precision: 0,
    ticker,
    version: 0,
  };

  let p = new Psbt()
    // op_return
    .addOutput({
      asset: BTC,
      nonce: Buffer.alloc(1),
      script: payments.embed({ data: [Buffer.from("00")] }).output,
      value: 0,
    });

  await fund(p, out, BTC, FEE);

  let params = {
    assetAmount: 1,
    assetAddress: out.address,
    tokenAmount: 0,
    precision: 0,
    net: network,
    contract,
  };

  p.addIssuance(params);

  addFee(p);
  p = await sign(p);
  await broadcast(p);

  let tx = p.extractTransaction();
  let { asset } = tx.outs[tx.outs.length - 2]

  return parseAsset(asset);
};

const getAddress = () => {
  return p2wpkh().confidentialAddress;
};

const getHex = async (txid) => {
  return electrs.url(`/tx/${txid}/hex`).get().text();
};

function shuffle(array) {
  var currentIndex = array.length,
    temporaryValue,
    randomIndex;

  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
const getTx = async (txid) => {
  return Transaction.fromHex(await getHex(txid));
};

const pay = async (to, asset) => {
  let script;
  try {
    script = Address.toOutputScript(to, network);
  } catch (e) {
    throw new Error("Unrecognized address");
  }
  
  let p = new Psbt().addOutput({
    asset,
    nonce: Buffer.alloc(1),
    script,
    value: 1,
  });

  let out = p2wpkh();
  await fund(p, out, asset, 1);
  await fund(p, out, BTC, FEE);

  addFee(p);

  p = await sign(p);
  await broadcast(p);

  return p.extractTransaction().getId();
};

module.exports = {
  createIssuance,
  pay,
};

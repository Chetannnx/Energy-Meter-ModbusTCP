// ================= IMPORTS =================

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const ModbusRTU = require("modbus-serial");
const { MongoClient } = require("mongodb");


// ================= APP SETUP =================

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public"));


// ================= CONFIG =================

// Modbus
const MODBUS_PORT = 502;

// Server
const SERVER_PORT = 3000;

// MongoDB
const MONGO_URL = "mongodb://chetan:chetan123@192.168.1.9:27021/chetanDB?authSource=admin";
const DB_NAME = "chetanDB";
const COLLECTION = "collection1";

// Timing
const POLL_INTERVAL = 2000;      // 2 sec
const MONGO_INTERVAL = 120000;  // 2 min


// ================= DEVICE =================

const device = {
  id: 1,
  name: "Meter-1",
  ip: "192.168.0.201",
  unitId: 1
};


// ================= GLOBAL =================

let modbusClient = null;
let mongoClient = null;
let collection = null;
let liveData = null;
let lastMongoSave = 0;


// ================= CONNECT MODBUS =================

async function connectModbus() {

  try {

    if (modbusClient && modbusClient.isOpen) return;

    console.log("🔄 Connecting Modbus...");

    modbusClient = new ModbusRTU();

    await modbusClient.connectTCP(device.ip, {
      port: MODBUS_PORT
    });

    modbusClient.setID(device.unitId);
    modbusClient.setTimeout(3000);

    console.log("✅ Modbus Connected");

  } catch (err) {

    console.log("❌ Modbus Error:", err.message);

    setTimeout(connectModbus, 5000);
  }
}

connectModbus();


// ================= CONNECT MONGODB =================

async function connectMongo() {

  try {

    if (mongoClient) return;

    console.log("🔄 Connecting MongoDB...");

    mongoClient = new MongoClient(MONGO_URL);

    await mongoClient.connect();

    const db = mongoClient.db(DB_NAME);

    collection = db.collection(COLLECTION);

    console.log("✅ MongoDB Connected");

  } catch (err) {

    console.log("❌ MongoDB Error:", err.message);

    setTimeout(connectMongo, 5000);
  }
}

connectMongo();


// ================= READ IN CHUNKS =================

async function readChunks(client, start, total, chunkSize = 20) {

  const data = [];

  for (let i = 0; i < total; i += chunkSize) {

    const size = Math.min(chunkSize, total - i);

    console.log(`📦 Reading: ${start + i} → ${start + i + size - 1}`);

    const res = await client.readHoldingRegisters(
      start + i,
      size
    );

    if (!res || !res.data) {
      throw new Error("Empty Modbus Response");
    }

    data.push(...res.data);
  }

  return data;
}


// ================= READ REGISTERS =================

async function readRegisters() {

  // 44096 → 44160
  // Modbus = Reg - 40001

  const start = 4095;   // 44096 - 40001
  const total = 65;     // Total registers
  const chunk = 20;     // Safe size

  const d = await readChunks(
    modbusClient,
    start,
    total,
    chunk
  );

  return {

    reg44096: d[0],
    reg44098: d[2],
    reg44100: d[4],
    reg44102: d[6],
    reg44104: d[8],
    reg44106: d[10],
    reg44108: d[12],
    reg44110: d[14],
    reg44112: d[16],
    reg44114: d[18],
    reg44116: d[20],
    reg44118: d[22],
    reg44120: d[24],
    reg44122: d[26],
    reg44124: d[28],
    reg44126: d[30],
    reg44128: d[32],
    reg44130: d[34],
    reg44132: d[36],
    reg44134: d[38],
    reg44136: d[40],
    reg44138: d[42],
    reg44140: d[44],
    reg44142: d[46],
    reg44144: d[48],
    reg44146: d[50],
    reg44148: d[52],
    reg44150: d[54],
    reg44152: d[56],
    reg44154: d[58],
    reg44156: d[60],
    reg44158: d[62],
    reg44160: d[64]
  };
}


// ================= POLLING =================

async function pollMeter() {

  if (!modbusClient || !modbusClient.isOpen) {
    connectModbus();
    return;
  }

  if (!collection) return;

  try {

    const values = await readRegisters();

    const ts = Date.now();


    // ========== MONGO DATA ==========

    const mongoData = {

      deviceName: device.name,

      Data: {

        V_3PHASE: {
          desc: "3-PHASE SYSTEM VOLTAGE",
          value: values.reg44096,
          unit: "V",
          ts
        },

        VL1: {
          desc: "PHASE VOLTAGE L1-N",
          value: values.reg44098,
          unit: "V",
          ts
        },
        VL2: {
          desc: "PHASE VOLTAGE L1-N",
          value: values.reg44160,
          unit: "V",
          ts
        }
      }
    };


    // ========== SAVE TO DB ==========

    const now = Date.now();

    if (now - lastMongoSave >= MONGO_INTERVAL) {

      await collection.insertOne(mongoData);

      lastMongoSave = now;

      console.log("💾 Saved to MongoDB");
    }


    // ========== LIVE DATA ==========

    liveData = {

      name: device.name,

      reg44096: values.reg44096,
      reg44098: values.reg44098,
      reg44160: values.reg44160,

      time: new Date().toLocaleString()
    };


    console.log("📡 Live:", liveData);

    io.emit("meterData", liveData);


  } catch (err) {

    console.log("⚠️ Poll Error:", err.message);

    try {
      modbusClient.close();
    } catch {}
  }
}


// ================= START POLLING =================

setInterval(pollMeter, POLL_INTERVAL);


// ================= SOCKET.IO =================

io.on("connection", (socket) => {

  console.log("🌐 Browser Connected");

  if (liveData) {
    socket.emit("meterData", liveData);
  }

  socket.on("disconnect", () => {
    console.log("❌ Browser Disconnected");
  });
});


// ================= START SERVER =================

server.listen(SERVER_PORT, () => {

  console.log("🚀 Server Started");
  console.log(`👉 http://localhost:${SERVER_PORT}`);
});

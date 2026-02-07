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
const POLL_INTERVAL = 2000;        // 2 sec (Live UI)
const MONGO_INTERVAL = 120000;     // 2 min (DB Save)


// ================= DEVICE =================

const device = {
  id: 1,
  name: "Meter-1",
  ip: "192.168.0.101",
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
    modbusClient.setTimeout(2000);

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

    // Index for fast search (NOT unique)
    // await collection.createIndex({ createdAt: 1 });

    console.log("✅ MongoDB Connected");

  } catch (err) {

    console.log("❌ MongoDB Error:", err.message);

    setTimeout(connectMongo, 5000);
  }
}

connectMongo();


// ================= READ REGISTERS =================

async function readRegisters() {

  // Read 44096 → 44102
  // Address = Register - 40001
  const start = 4095;
  const length = 7;

  const r = await modbusClient.readHoldingRegisters(start, length);

  const d = r.data;

  return {

    reg44096: d[0],
    reg44098: d[2],
    reg44100: d[4],
    reg44102: d[6]

  };
}


// ================= POLLING =================

async function pollMeter() {

  // Auto reconnect
  if (!modbusClient || !modbusClient.isOpen) {
    connectModbus();
    return;
  }

  if (!collection) return;

  try {

    const values = await readRegisters();

    const ts = Date.now();


    // ========== MONGO DATA FORMAT ==========

    const mongoData = {

      // deviceId: device.id,
      deviceName: device.name,

      Data: {

        Vry: {
          desc: "Voltage R-Y",
          value: values.reg44096,
          unit: "V",
          ts
        },

        Vyb: {
          desc: "Voltage Y-B",
          value: values.reg44098,
          unit: "V",
          ts
        },

        Vbr: {
          desc: "Voltage B-R",
          value: values.reg44100,
          unit: "V",
          ts
        },

        Vrn: {
          desc: "Voltage R-N",
          value: values.reg44102,
          unit: "V",
          ts
        }

      },

      // createdAt: new Date()
    };


    // ========== SAVE EVERY 2 MIN ==========

    const now = Date.now();

    if (now - lastMongoSave >= MONGO_INTERVAL) {

      await collection.insertOne(mongoData);

      lastMongoSave = now;

      console.log("💾 Saved to MongoDB");
    }


    // ========== LIVE UI DATA ==========

    liveData = {

      name: device.name,

      reg44096: values.reg44096,
      reg44098: values.reg44098,
      reg44100: values.reg44100,
      reg44102: values.reg44102,

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

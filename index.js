// ================= IMPORTS =================

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const ModbusRTU = require("modbus-serial");
const { MongoClient } = require("mongodb");


// 👇 ADD HERE
// ================= DATA CONVERTERS =================

// function toInt16(val) {
//   return val > 0x7FFF ? val - 0x10000 : val;
// }
// function toUInt32(high, low) {
//   return (high << 16) >>> 0 | low;
// }

// function toInt32(high, low) {
//   const val = (high << 16) | low;
//   return val >> 0;
// }

// function toFloat32(high, low) {
//   const buf = Buffer.alloc(4);

//   buf.writeUInt16BE(high, 0);
//   buf.writeUInt16BE(low, 2);

//   return buf.readFloatBE(0);
// }


// Unsigned 32-bit
// function toUInt32(high, low) {
//   return ((high << 16) >>> 0) + low;
// }

function toUInt32Scaled(high, low) {
  const raw = ((high << 16) >>> 0) + low; // Unsigned 32-bit
  return raw / 65536;                    // Apply scaling
}


// Signed 32-bit
// function toInt32(high, low) {
//   const val = (high << 16) | low;
//   return val >> 0  ;
// }

function toInt32(high, low, scale = 65536) {
  const val = (high << 16) | low;
  return (val >> 0) / scale;
}


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
const MONGO_URL =
  "mongodb://chetan:chetan123@192.168.1.96:27021/chetanDB?authSource=admin";

const DB_NAME = "chetanDB";
const COLLECTION = "collection1";

// Timing
const POLL_INTERVAL = 2000;      // 2 sec
const MONGO_INTERVAL = 120000;  // 2 min


// ================= DEVICE =================

const device = {
  name: "Meter-1",
  ip: "192.168.1.201",
  unitId: 1
};


// ================= GLOBAL =================

let modbusClient;
let mongoClient;
let collection;

let liveData = null;
let lastMongoSave = 0;


// ================= MODBUS CONNECT =================

async function connectModbus() {

  try {

    if (modbusClient?.isOpen) return;

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


// ================= MONGO CONNECT =================

async function connectMongo() {

  try {

    if (mongoClient) return;

    console.log("🔄 Connecting MongoDB...");

    mongoClient = new MongoClient(MONGO_URL);

    await mongoClient.connect();

    const db = mongoClient.db(DB_NAME);

    collection = db.collection(COLLECTION);

    // ADD THIS
    await collection.createIndex({ timestamp: 1 });

    console.log("✅ MongoDB Connected");

  } catch (err) {

    console.log("❌ Mongo Error:", err.message);

    setTimeout(connectMongo, 5000);
  }
}

connectMongo();

// ================= API ROUTES =================

// Get Daily Data
app.get("/api/data/daily", async (req, res) => {
  try {

    if (!collection) return res.status(500).json({ error: "DB Not Ready" });

    const { date } = req.query; // YYYY-MM-DD

    // const start = new Date(date);
    if (!date) {
      return res.status(400).json({ error: "Date is required (YYYY-MM-DD)" });
    }
    const start = new Date(date);
    if (isNaN(start.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }


    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const data = await collection.find({
      timestamp: {
        $gte: start,
        $lte: end
      }
    }).sort({ timestamp: 1 }).toArray();

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Get Monthly Data
app.get("/api/data/monthly", async (req, res) => {
  try {

    if (!collection) return res.status(500).json({ error: "DB Not Ready" });

    const { year, month } = req.query; // 2026, 02

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const data = await collection.find({
      timestamp: {
        $gte: start,
        $lte: end
      }
    }).toArray();

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Get Yearly Data
app.get("/api/data/yearly", async (req, res) => {
  try {

    if (!collection) return res.status(500).json({ error: "DB Not Ready" });

    const { year } = req.query;

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);

    const data = await collection.find({
      timestamp: {
        $gte: start,
        $lte: end
      }
    }).toArray();

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ================= SAFE READ =================

async function readChunks(start, count, chunk = 20) {

  const result = [];

  for (let i = 0; i < count; i += chunk) {

    const size = Math.min(chunk, count - i);
 
    const addr = start + i;

    console.log(`📦 Read: ${addr} → ${addr + size - 1}`);

    const res =
      await modbusClient.readHoldingRegisters(addr, size);

    if (!res?.data) {
      throw new Error("Empty Modbus Response");
    }

    result.push(...res.data);
  }

  return result;
}


// ================= REGISTER BLOCKS =================

// Only REAL blocks (no gaps)

const BLOCKS = [

  // 44096 → 44160
  { start: 4095, count: 66 }, //BLOCK 1

  // 44166 → 44190
  { start: 4165, count: 26 }, //BLOCK 2

  // 44192 → 44200
  { start: 4191, count: 10 }, //BLOCK 3

  // 44208 → 44250
  { start: 4207, count: 44 }, //BLOCK 4

  // 44262 → 44292
  { start: 4261, count: 32 }, //BLOCK 5

  // 44512 → 44514
  { start: 4511, count: 4 }, //BLOCK 6


];


// ================= READ ALL =================

async function readRegisters() {

  const data = {};

  for (const block of BLOCKS) {

    const d = await readChunks(
      block.start,
      block.count,
      20
    );

    data[block.start] = d;
  }

  return data;
}


// ================= MAP VALUES =================

function mapValues(raw) {

  const b1 = raw[4095]; // First block
  const b2 = raw[4165]; // Second block
  const b3 = raw[4191]; // Third block
  const b4 = raw[4207]; // Fourth block
  const b5 = raw[4261]; // Fifth block
  const b6 = raw[4511]; // Fifth block


  return {

    // BLOCK 1
    // reg44096: b1[0],
    reg44096: toUInt32Scaled(b1[0], b1[1]),
    reg44098: toUInt32Scaled(b1[2],b1[3]),
    reg44100: toUInt32Scaled(b1[4],b1[5]),
    reg44102: toUInt32Scaled(b1[6],b1[7]),
    reg44104: toUInt32Scaled(b1[8],b1[9]),
    reg44106: toUInt32Scaled(b1[10],b1[11]),
    reg44108: toUInt32Scaled(b1[12],b1[13]),
    reg44110: toUInt32Scaled(b1[14],b1[15]),
    reg44112: toUInt32Scaled(b1[16],b1[17]),
    reg44114: toUInt32Scaled(b1[18],b1[19]),
    reg44116: toUInt32Scaled(b1[20],b1[21]),
    // reg44118: b1[22],
    reg44118: toInt32(b1[22],b1[23]),
    reg44120: toInt32(b1[24],b1[25]),
    reg44122: toInt32(b1[26],b1[27]),
    reg44124: toInt32(b1[28],b1[29]),
    reg44126: toInt32(b1[30],b1[31]),
    reg44128: toInt32(b1[32],b1[33]),
    reg44130: toInt32(b1[34],b1[35]),
    reg44132: toInt32(b1[36],b1[37]),
    reg44134: toUInt32Scaled(b1[38],b1[39]),
    reg44136: toUInt32Scaled(b1[40],b1[41]),
    reg44138: toUInt32Scaled(b1[42],b1[43]),
    reg44140: toUInt32Scaled(b1[44],b1[45]),
    reg44142: toInt32(b1[46],b1[47]),
    reg44144: toInt32(b1[48],b1[49]),
    reg44146: toInt32(b1[50],b1[51]),
    reg44148: toInt32(b1[52],b1[53]),
    reg44150: toInt32(b1[54],b1[55]),
    reg44152: toInt32(b1[56],b1[57]),
    reg44154: toInt32(b1[58],b1[59]),
    reg44156: toInt32(b1[60],b1[61]),
    reg44158: toUInt32Scaled(b1[62],b1[63]),
    reg44160: toUInt32Scaled(b1[64],b1[65]),

    // BLOCK 2
    reg44166: toUInt32Scaled(b2[0],b2[1]),

    // BLOCK 3
    reg44192: toUInt32Scaled(b3[0],b3[1]),
    reg44194: toUInt32Scaled(b3[2],b3[3]),
    reg44196: toUInt32Scaled(b3[4],b3[5]),
    reg44198: toInt32(b3[6],b3[7]),
    reg44200: toUInt32Scaled(b3[8],b3[9]),

    //BLOCK 4
    reg44208: toInt32(b4[0],b4[1]),
    reg44210: toUInt32Scaled(b4[2],b4[3]),
    reg44212: toUInt32Scaled(b4[4],b4[5]),
    reg44214: toUInt32Scaled(b4[6],b4[7]),
    reg44216: toUInt32Scaled(b4[8],b4[9]),
    reg44218: toUInt32Scaled(b4[10],b4[11]),
    reg44220: toUInt32Scaled(b4[12],b4[13]),
    reg44222: toUInt32Scaled(b4[14],b4[15]),
    reg44224: toInt32(b4[16],b4[17]),
    reg44226: toUInt32Scaled(b4[18],b4[19]),
    reg44228: toUInt32Scaled(b4[20],b4[21]),
    reg44230: toUInt32Scaled(b4[22],b4[23]),
    reg44232: toUInt32Scaled(b4[24],b4[25]),
    reg44234: toUInt32Scaled(b4[26],b4[27]),
    reg44236: toUInt32Scaled(b4[28],b4[29]),
    reg44238: toInt32(b4[30],b4[31]),
    reg44240: toInt32(b4[32],b4[33]),
    reg44242: toInt32(b4[34],b4[35]),
    reg44244: toUInt32Scaled(b4[36],b4[37]),
    reg44246: toUInt32Scaled(b4[38],b4[39]),
    reg44248: toUInt32Scaled(b4[40],b4[41]),
    reg44250: toUInt32Scaled(b4[42],b4[43]),


    //BLOCK 5
    reg44262: toUInt32Scaled(b5[0],b5[1]),
    reg44264: toUInt32Scaled(b5[2],b5[3]),
    reg44266: toUInt32Scaled(b5[4],b5[5]),
    reg44268: toUInt32Scaled(b5[6],b5[7]),
    reg44270: toUInt32Scaled(b5[8],b5[9]),
    reg44272: toUInt32Scaled(b5[10],b5[11]),
    reg44274: toUInt32Scaled(b5[12],b5[13]),
    reg44276: toUInt32Scaled(b5[14],b5[15]),
    reg44278: toUInt32Scaled(b5[16],b5[17]),
    reg44280: toUInt32Scaled(b5[18],b5[19]),
    reg44282: toUInt32Scaled(b5[20],b5[21]),
    reg44284: toUInt32Scaled(b5[22],b5[23]),
    reg44286: toUInt32Scaled(b5[24],b5[25]),
    reg44288: toUInt32Scaled(b5[26],b5[27]),
    reg44290: toUInt32Scaled(b5[28],b5[29]),
    reg44292: toUInt32Scaled(b5[30],b5[31]),


    //BLOCK 6
    reg44512: toUInt32Scaled(b6[0],b6[1]),
    reg44514: toUInt32Scaled(b6[2],b6[3]),

  };
}


// ================= POLLING =================

async function pollMeter() {

  if (!modbusClient?.isOpen) {
    connectModbus();
    return;
  }

  if (!collection) return;

  try {

    // Read
    const raw = await readRegisters();

    // Map
    const values = mapValues(raw);

    // const ts = Date.now();
    //  const ts = new Date().toLocaleString()
    //  new Date().toISOString();
    const ts = new Date(); 

    



    // ========== MONGO FORMAT ==========

    // const mongoData = {

    //   device: device.name,

    //   timestamp: new Date(),

    //   values
    // };


    const mongoData = {

  DeviceName: device.name,
  timestamp: ts,
  Data: {

    //BLOCK 1

    V_3PHASE: values.reg44096,
    VL1: values.reg44098,
    VL2: values.reg44100,
    VL3: values.reg44102,
    L1_2V: values.reg44104,
    L2_3V: values.reg44106,
    L3_1V: values.reg44108,
    C_3PHASE:values.reg44110,
    CL1:values.reg44112,
    CL2:values.reg44114,
    CL3:values.reg44116,
    P3PF:values.reg44118,
    PF_L1:values.reg44120,
    PF_L2:values.reg44122,
    PF_L3:values.reg44124,
    P3_COSθ:values.reg44126,
    P_COSθ_1:values.reg44128,
    P_COSθ_2:values.reg44130,
    P_COSθ_3:values.reg44132,
    P3_AP:values.reg44134,
    APP_L1:values.reg44136,
    APP_L2:values.reg44138,
    APP_L3:values.reg44140,
    P3_ACT:values.reg44142,
    ACT_L1:values.reg44144,
    ACT_L2:values.reg44146,
    ACT_L3:values.reg44148,
    P3_REACT_P:values.reg44150,
    REACT_PL1:values.reg44152,
    REACT_PL2:values.reg44154,
    REACT_PL3:values.reg44156,
    P3_ACT_ENEG:values.reg44158,
    P3_REACT_ENEG:values.reg44160,

    //BLOCK 2

    FREQUENCY:values.reg44166,

    //BLOCK 3

    C_L1:values.reg44192,
    C_L2:values.reg44194,
    C_L3:values.reg44196,
    MAX_3P_ACTPWR:values.reg44198,
    MAX_3P_APPRPWR:values.reg44200,


    //BLOCK 4

    _:values.reg44208,
    P3_APPR_PWR:values.reg44210,
    ACT_ENERG_L1:values.reg44212,
    ACT_ENERG_L2:values.reg44214,
    ACT_ENERG_L3:values.reg44216,
    REACT_ENERG_L1:values.reg44218,
    REACT_ENERG_L2:values.reg44220,
    REACT_ENERG_L3:values.reg44222,
    P3_ACT_PWR_L2:values.reg44224,
    VOLT_THD_L1:values.reg44226,
    VOLT_THD_L2:values.reg44228,
    VOLT_THD_L3:values.reg44230,
    CURRENT_THD_L1:values.reg44232,
    CURRENT_THD_L2:values.reg44234,
    CURRENT_THD_L3:values.reg44236,
    MAX_ACT_PWR_L1:values.reg44238,
    MAX_ACT_PWR_L2:values.reg44240,
    MAX_ACT_PWR_L3:values.reg44242,
    MAX_APPRT_PWR:values.reg44244,
    MAX_APPRT_PWR_L1:values.reg44246,
    MAX_APPRT_PWR_L2:values.reg44248,
    MAX_APPRT_PWR_L3:values.reg44250,


    //BLOCK 5

    P3_APP_ENERG:values.reg44262,
    APPR_ENEG_L1:values.reg44264,
    APPR_ENEG_L2:values.reg44266,
    APPR_ENEG_L3:values.reg44268,
    P3_GNT_ACT_ENERG:values.reg44270,
    GNT_ACT_ENEG_L1:values.reg44272,
    GNT_ACT_ENEG_L2:values.reg44274,
    GNT_ACT_ENEG_L3:values.reg44276,
    P3_GNT_REACT_ENERG:values.reg44278,
    GNT_REACT_ENEG_L1:values.reg44280,
    GNT_REACT_ENEG_L2:values.reg44282,
    GNT_REACT_ENEG_L3:values.reg44284,
    P3_GNT_APPRN_ENERG:values.reg44286,
    GNT_APPRN_ENEG_L1:values.reg44288,
    GNT_APPRN_ENEG_L2:values.reg44290,
    GNT_APPRN_ENEG_L3:values.reg44292,

    //BLOCK 6

    CT_PRM:values.reg44512,
    VT_PRM:values.reg44514,

  }
};



    // ========== SAVE EVERY 2 MIN ==========

    const now = Date.now();

    if (now - lastMongoSave >= MONGO_INTERVAL) {

      await collection.insertOne(mongoData);

      lastMongoSave = now;

      console.log("💾 Saved MongoDB");
    }


    // ========== LIVE DATA ==========

    liveData = {

      device: device.name,

      ...values,

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


// ================= START POLL =================

setInterval(pollMeter, POLL_INTERVAL);


// ================= SOCKET =================

io.on("connection", (socket) => {

  console.log("🌐 Client Connected");

  if (liveData) {
    socket.emit("meterData", liveData);
  }

  socket.on("disconnect", () => {
    console.log("❌ Client Disconnected");
  });
});


// ================= SERVER =================

server.listen(SERVER_PORT, () => {

  console.log("🚀 Server Started");
  console.log(`👉 http://localhost:${SERVER_PORT}`);
});

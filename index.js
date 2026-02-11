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
const MONGO_URL =
  "mongodb://chetan:chetan123@192.168.1.9:27021/chetanDB?authSource=admin";

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

    console.log("✅ MongoDB Connected");

  } catch (err) {

    console.log("❌ Mongo Error:", err.message);

    setTimeout(connectMongo, 5000);
  }
}

connectMongo();


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
  { start: 4095, count: 65 }, //BLOCK 1

  // 44166 → 44190
  { start: 4165, count: 25 }, //BLOCK 2

  // 44192 → 44200
  { start: 4191, count: 9 }, //BLOCK 3

  // 44208 → 44250
  { start: 4207, count: 43 }, //BLOCK 4

  // 44262 → 44292
  { start: 4261, count: 31 }, //BLOCK 5

  // 44512 → 44514
  { start: 4511, count: 3 }, //BLOCK 6


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
    reg44096: b1[0],
    reg44098: b1[2],
    reg44100: b1[4],
    reg44102: b1[6],
    reg44104: b1[8],
    reg44106: b1[10],
    reg44108: b1[12],
    reg44110: b1[14],
    reg44112: b1[16],
    reg44114: b1[18],
    reg44116: b1[20],
    reg44118: b1[22],
    reg44120: b1[24],
    reg44122: b1[26],
    reg44124: b1[28],
    reg44126: b1[30],
    reg44128: b1[32],
    reg44130: b1[34],
    reg44132: b1[36],
    reg44134: b1[38],
    reg44136: b1[40],
    reg44138: b1[42],
    reg44140: b1[44],
    reg44142: b1[46],
    reg44144: b1[48],
    reg44146: b1[50],
    reg44148: b1[52],
    reg44150: b1[54],
    reg44152: b1[56],
    reg44154: b1[58],
    reg44156: b1[60],
    reg44158: b1[62],
    reg44160: b1[64],

    // BLOCK 2
    reg44166: b2[0],

    // BLOCK 3
    reg44192: b3[0],
    reg44194: b3[2],
    reg44196: b3[4],
    reg44198: b3[6],
    reg44200: b3[8],

    //BLOCK 4
    reg44208: b4[0],
    reg44210: b4[2],
    reg44212: b4[4],
    reg44214: b4[6],
    reg44216: b4[8],
    reg44218: b4[10],
    reg44220: b4[12],
    reg44222: b4[14],
    reg44224: b4[16],
    reg44226: b4[18],
    reg44228: b4[20],
    reg44230: b4[22],
    reg44232: b4[24],
    reg44234: b4[26],
    reg44236: b4[28],
    reg44238: b4[30],
    reg44240: b4[32],
    reg44242: b4[34],
    reg44244: b4[36],
    reg44246: b4[38],
    reg44248: b4[40],
    reg44250: b4[42],


    //BLOCK 5
    reg44262: b5[0],
    reg44264: b5[2],
    reg44266: b5[4],
    reg44268: b5[6],
    reg44270: b5[8],
    reg44272: b5[10],
    reg44274: b5[12],
    reg44276: b5[14],
    reg44278: b5[16],
    reg44280: b5[18],
    reg44282: b5[20],
    reg44284: b5[22],
    reg44286: b5[24],
    reg44288: b5[26],
    reg44290: b5[28],
    reg44292: b5[30],


    //BLOCK 6
    reg44512: b6[0],
    reg44514: b6[2],

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

    const ts = Date.now();


    // ========== MONGO FORMAT ==========

    // const mongoData = {

    //   device: device.name,

    //   timestamp: new Date(),

    //   values
    // };


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
          desc: "PHASE VOLTAGE L2-N",
          value: values.reg44100,
          unit: "V",
          ts
        },

        VL3: {
          desc: "PHASE VOLTAGE L3-N",
          value: values.reg44102,
          unit: "V",
          ts
        },
        L1_2V: {
          desc: "LINE VOLTAGE L1-2",
          value: values.reg44104,
          unit: "V",
          ts
        },
        L2_3V: {
          desc: "LINE VOLTAGE L2-3",
          value: values.reg44106,
          unit: "V",
          ts
        },
        L3_1V: {
          desc: "LINE VOLTAGE L3-1",
          value: values.reg44108,
          unit: "V",
          ts
        },
        C_3PHASE: {
          desc: "3-PHASE SYSTEM CURRENT",
          value: values.reg44110,
          unit: "mA",
          ts
        },
        CL1: {
          desc: "LINE CURRENT L1",
          value: values.reg44112,
          unit: "mA",
          ts
        },
        CL2: {
          desc: "LINE CURRENT L2",
          value: values.reg44114,
          unit: "mA",
          ts
        },
        CL3: {
          desc: "LINE CURRENT L3",
          value: values.reg44116,
          unit: "mA",
          ts
        },
        P3PF: {
          desc: "3-PHASE SYS. POWER FACTOR I",
          value: values.reg44118,
          unit: "na",
          ts
        },
        PF_L1: {
          desc: "POWER FACTOR L1",
          value: values.reg44120,
          unit: "na",
          ts
        },
        PF_L2: {
          desc: "POWER FACTOR L2",
          value: values.reg44122,
          unit: "",
          ts
        },
        PF_L3: {
          desc: "POWER FACTOR L3",
          value: values.reg44124,
          unit: "",
          ts
        },
        P3_COSθ: {
          desc: "3-PHASE SYSTEM COSθ",
          value: values.reg44126,
          unit: "",
          ts
        },
        P_COSθ_1: {
          desc: "PHASE COSθ-1",
          value: values.reg44128,
          unit: "",
          ts
        },
        P_COSθ_2: {
          desc: "PHASE COSθ-2",
          value: values.reg44130,
          unit: "",
          ts
        },
        P_COSθ_3: {
          desc: "PHASE COSθ-3",
          value: values.reg44132,
          unit: "",
          ts
        },
        P3_AP: {
          desc: "3-PHASE S. APPARENT POWER",
          value: values.reg44134,
          unit: "VA",
          ts
        },
        APP_L1: {
          desc: "APPARENT POWER L1",
          value: values.reg44136,
          unit: "VA",
          ts
        },
        APP_L2: {
          desc: "APPARENT POWER L2",
          value: values.reg44138,
          unit: "VA",
          ts
        },
        APP_L3: {
          desc: "APPARENT POWER L3",
          value: values.reg44140,
          unit: "VA",
          ts
        },
        P3_ACT: {
          desc: "3-PHASE SYS. ACTIVE POWER",
          value: values.reg44142,
          unit: "Watt",
          ts
        },
        ACT_L1: {
          desc: "APPARENT POWER L1",
          value: values.reg44144,
          unit: "Watt",
          ts
        },
        ACT_L2: {
          desc: "APPARENT POWER L2",
          value: values.reg44146,
          unit: "Watt",
          ts
        },
        ACT_L3: {
          desc: "APPARENT POWER L3",
          value: values.reg44148,
          unit: "Watt",
          ts
        },
        P3_REACT_P: {
          desc: "3-PHASE S. REACTIVE POWER",
          value: values.reg44150,
          unit: "VAr",
          ts
        },
        REACT_PL1: {
          desc: "REACTIVE POWER L1",
          value: values.reg44152,
          unit: "VAr",
          ts
        },
        REACT_PL2: {
          desc: "REACTIVE POWER L2",
          value: values.reg44154,
          unit: "VAr",
          ts
        },
        REACT_PL3: {
          desc: "REACTIVE POWER L3",
          value: values.reg44156,
          unit: "VAr",
          ts
        },
        P3_ACT_ENEG: {
          desc: "3-PHASE SYS. ACTIVE ENERGY",
          value: values.reg44158,
          unit: "Wh",
          ts
        },
        P3_REACT_ENEG: {
          desc: "3-PHASE S. REACTIVE ENERGY",
          value: values.reg44160,
          unit: "VArh",
          ts
        },
        

        //BLOCK 2
        FREQUENCY: {
          desc: "FREQUENCY",
          value: values.reg44166,
          unit: "mHz",
          ts
        },


        //BLOCK 3
        C_L1: {
          desc: "MAX LINE CURRENT L1",
          value: values.reg44192,
          unit: "mA",
          ts
        },
        C_L2: {
          desc: "MAX LINE CURRENT L2",
          value: values.reg44194,
          unit: "mA",
          ts
        },
        C_L3: {
          desc: "MAX LINE CURRENT L3",
          value: values.reg44196,
          unit: "mA",
          ts
        },
        MAX_3P_ACTPWR: {
          desc: "MAX 3-PHASE SYS. ACTIVE POWER",
          value: values.reg44198,
          unit: "Watt",
          ts
        },
        MAX_3P_APPRPWR: {
          desc: "MAX 3-PHASE S. APPARENT POWER",
          value: values.reg44200,
          unit: "VA",
          ts
        },


        //BLOCK 4
        _: {
          desc: "-",
          value: values.reg44208,
          unit: "Watt",
          ts
        },
        P3_APPR_PWR: {
          desc: "3-PHASE SYS. APPARENT POWER 15’ AVER",
          value: values.reg44210,
          unit: "VA",
          ts
        },
        ACT_ENERG_L1: {
          desc: "ACTIVE ENERGY L1",
          value: values.reg44212,
          unit: "Wh",
          ts
        },
        ACT_ENERG_L2: {
          desc: "ACTIVE ENERGY L2",
          value: values.reg44214,
          unit: "Wh",
          ts
        },
        ACT_ENERG_L3: {
          desc: "ACTIVE ENERGY L3",
          value: values.reg44216,
          unit: "Wh",
          ts
        },
        REACT_ENERG_L1: {
          desc: "REACTIVE ENERGY L1",
          value: values.reg44218,
          unit: "VArh",
          ts
        },
        REACT_ENERG_L2: {
          desc: "REACTIVE ENERGY L2",
          value: values.reg44220,
          unit: "VArh",
          ts
        },
        REACT_ENERG_L3: {
          desc: "REACTIVE ENERGY L3",
          value: values.reg44222,
          unit: "VArh",
          ts
        },
        P3_ACT_PWR_L2: {
          desc: "MAX 3-PHASE SYS. ACTIVE POWER 15’ AVER",
          value: values.reg44224,
          unit: "Watt",
          ts
        },
        VOLT_THD_L1: {
          desc: "VOLTAGE THD L1",
          value: values.reg44226,
          unit: "-",
          ts
        },
        VOLT_THD_L2: {
          desc: "VOLTAGE THD L2",
          value: values.reg44228,
          unit: "-",
          ts
        },
        VOLT_THD_L3: {
          desc: "VOLTAGE THD L3",
          value: values.reg44230,
          unit: "-",
          ts
        },
        CURRENT_THD_L1: {
          desc: "CURRENT THD L1",
          value: values.reg44232,
          unit: "-",
          ts
        },
        CURRENT_THD_L2: {
          desc: "CURRENT THD L2",
          value: values.reg44234,
          unit: "-",
          ts
        },
        CURRENT_THD_L3: {
          desc: "CURRENT THD L3",
          value: values.reg44236,
          unit: "-",
          ts
        },
        MAX_ACT_PWR_L1: {
          desc: "MAX ACTIVE POWER 15’ AVER L1",
          value: values.reg44238,
          unit: "Watt",
          ts
        },
        MAX_ACT_PWR_L2: {
          desc: "MAX ACTIVE POWER 15’ AVER L2",
          value: values.reg44240,
          unit: "Watt",
          ts
        },
        MAX_ACT_PWR_L3: {
          desc: "MAX ACTIVE POWER 15’ AVER L3",
          value: values.reg44242,
          unit: "Watt",
          ts
        },
        MAX_APPRT_PWR: {
          desc: "MAX 3-PHASE SYS. APPARENT POWER 15’ AVER",
          value: values.reg44244,
          unit: "VA",
          ts
        },
        MAX_APPRT_PWR_L1: {
          desc: "MAX APPARERENT POWER 15’ AVER L1",
          value: values.reg44246,
          unit: "VA",
          ts
        },
        MAX_APPRT_PWR_L2: {
          desc: "MAX APPARERENT POWER 15’ AVER L2",
          value: values.reg44248,
          unit: "VA",
          ts
        },
        MAX_APPRT_PWR_L3: {
          desc: "MAX APPARERENT POWER 15’ AVER L2",
          value: values.reg44250,
          unit: "VA",
          ts
        },


      //BLOCK 5
      P3_APP_ENERG: {
          desc: "3-PHASE SYS. APPARENT ENERGY",
          value: values.reg44262,
          unit: "VAh",
          ts
        },
        APPR_ENEG_L1: {
          desc: "APPARENT ENERGY L1",
          value: values.reg44264,
          unit: "VA",
          ts
        },
        APPR_ENEG_L2: {
          desc: "APPARENT ENERGY L2",
          value: values.reg44266,
          unit: "Wh",
          ts
        },
        APPR_ENEG_L3: {
          desc: "APPARENT ENERGY L3",
          value: values.reg44268,
          unit: "Wh",
          ts
        },
        P3_GNT_ACT_ENERG: {
          desc: "3-PHASE SYS. GENERATED ACTIVE ENERGY ",
          value: values.reg44270,
          unit: "Wh",
          ts
        },
        GNT_ACT_ENEG_L1: {
          desc: "GENERATED ACTIVE ENERGY L1",
          value: values.reg44272,
          unit: "Wh",
          ts
        },
        GNT_ACT_ENEG_L2: {
          desc: "GENERATED ACTIVE ENERGY L2",
          value: values.reg44274,
          unit: "Wh",
          ts
        },
        GNT_ACT_ENEG_L3: {
          desc: "GENERATED ACTIVE ENERGY L3",
          value: values.reg44276,
          unit: "Wh",
          ts
        },
        P3_GNT_REACT_ENERG: {
          desc: "3-PHASE S. GENERATED REACTIVE ENERGY",
          value: values.reg44278,
          unit: "VArh",
          ts
        },
        GNT_REACT_ENEG_L1: {
          desc: "GENERATED REACTIVE ENERGY L1",
          value: values.reg44280,
          unit: "VArh",
          ts
        },
        GNT_REACT_ENEG_L2: {
          desc: "GENERATED REACTIVE ENERGY L2",
          value: values.reg44282,
          unit: "VArh",
          ts
        },
        GNT_REACT_ENEG_L3: {
          desc: "GENERATED REACTIVE ENERGY L3",
          value: values.reg44284,
          unit: "VArh",
          ts
        },
        P3_GNT_APPRN_ENERG: {
          desc: "3-PHASE S. GENERATED APPARENT ENERGY",
          value: values.reg44286,
          unit: "VAh",
          ts
        },
        GNT_APPRN_ENEG_L1: {
          desc: "GENERATED APPARENT ENERGY L1",
          value: values.reg44288,
          unit: "VAh",
          ts
        },
        GNT_APPRN_ENEG_L2: {
          desc: "GENERATED APPARENT ENERGY L2",
          value: values.reg44290,
          unit: "VAh",
          ts
        },
        GNT_APPRN_ENEG_L3: {
          desc: "GENERATED APPARENT ENERGY L3",
          value: values.reg44292,
          unit: "VAh",
          ts
        },


        //BLOCK 6
        CT_PRM: {
          desc: "CURRENT TRANSFORMER PRIMARY (CT)",
          value: values.reg44512,
          unit: "-",
          ts
        },
        VT_PRM: {
          desc: "VOLTAGE TRANSFORMER PRIMARY (VT)",
          value: values.reg44514,
          unit: "-",
          ts
        },


        
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

// server.js
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static("public")); // zodat index.html bereikbaar is

// Zorg dat upload map bestaat
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// --- micro:bit (Serial) auto-detect and notify ---
let microbitPort = null;
let SerialPortPackage = null;
try {
  SerialPortPackage = require('serialport');
} catch (e) {
  console.warn('serialport package not installed. To enable automatic micro:bit notifications run: npm install serialport');
}

async function findAndOpenMicrobit() {
  if (!SerialPortPackage) return;
  try {
    const ports = await SerialPortPackage.list();
    // heuristic: look for manufacturer or productId that suggests a micro:bit (mbed)
    const candidate = ports.find(p => {
      const fn = (p.manufacturer || '').toLowerCase();
      const pn = (p.productId || '').toLowerCase();
      const path = (p.path || '').toLowerCase();
      return fn.includes('mbed') || fn.includes('micro:bit') || path.includes('mbed') || path.includes('micro');
    }) || ports[0];

    if (!candidate) return;
    if (microbitPort && microbitPort.path === candidate.path && microbitPort.isOpen) return;

    if (microbitPort && microbitPort.isOpen) {
      try { microbitPort.close(); } catch (e) {}
    }

    microbitPort = new SerialPortPackage(candidate.path, { baudRate: 115200, autoOpen: false });
    microbitPort.open(err => {
      if (err) {
        console.error('Failed to open micro:bit serial port', err.message);
        microbitPort = null;
        return;
      }
      console.log('micro:bit serial connected on', candidate.path);
    });
    microbitPort.on('close', () => { microbitPort = null; });
  } catch (err) {
    console.error('Error finding micro:bit serial port:', err.message || err);
  }
}

// poll for micro:bit every 5 seconds
if (SerialPortPackage) setInterval(findAndOpenMicrobit, 5000);

async function sendToMicrobit(message = '1\n') {
  if (!SerialPortPackage) return;
  if (!microbitPort || !microbitPort.isOpen) {
    await findAndOpenMicrobit();
  }
  if (microbitPort && microbitPort.isOpen) {
    try {
      microbitPort.write(message);
      console.log('Sent to micro:bit:', message.trim());
    } catch (err) {
      console.error('Failed to write to micro:bit:', err.message || err);
    }
  }
}

// MySQL connectie instellingen (pas aan naar jouw instellingen)
const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "MySQL.25024256",
  // database will be created if missing
};

let pool;
let dbConnected = false;

// Zorg dat database en tabellen bestaan
(async () => {
  try {
    console.log('Attempting to connect to MySQL at', DB_CONFIG.host);
    // create temporary connection without database to ensure DB exists
    const tmpConn = await mysql.createConnection({
      host: DB_CONFIG.host,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
    });
    console.log('✅ Connected to MySQL');
    
    await tmpConn.query("CREATE DATABASE IF NOT EXISTS trashtag CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    console.log('✅ Database trashtag ready');
    await tmpConn.end();

    // create pool using the trashtag database
    pool = mysql.createPool({
      host: DB_CONFIG.host,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
      database: "trashtag",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    const conn = await pool.getConnection();
    dbConnected = true;
    // gebruiker tabel (indien nodig)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS gebruiker (
        userid INT AUTO_INCREMENT PRIMARY KEY,
        naam VARCHAR(45) NOT NULL,
        toelichting TEXT,
        adres VARCHAR(69) NOT NULL,
        bestand VARCHAR(255),
        datum TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        telefoonnummer VARCHAR(20) NOT NULL,
        email VARCHAR(255) NOT NULL
      )
    `);

    // meldingen tabel gebruikt door API endpoints
    await conn.query(`
      CREATE TABLE IF NOT EXISTS meldingen (
        id INT AUTO_INCREMENT PRIMARY KEY,
        probleem VARCHAR(255),
        toelichting TEXT,
        locatie VARCHAR(255),
        bestand VARCHAR(255),
        datum TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    conn.release();
    console.log('✅ Tables initialized');
  } catch (err) {
    dbConnected = false;
    console.error('❌ Database setup failed:', err.message);
    console.error('Details:', err);
  }
})();

// Multer voor file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Endpoint zonder bestand
app.post("/submit", async (req, res) => {
  try {
    const { probleem, toelichting, locatie } = req.body;
    if (pool) {
      const conn = await pool.getConnection();
      await conn.query(
        "INSERT INTO meldingen (probleem, toelichting, locatie) VALUES (?, ?, ?)",
        [probleem, toelichting, locatie]
      );
      conn.release();
      res.json({ message: "Melding opgeslagen in database!" });
    } else {
      res.json({ message: "Melding ontvangen (database niet beschikbaar)." });
    }
    // notify micro:bit (best-effort)
    try { await sendToMicrobit(); } catch (e) { console.error('microbit notify error', e); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint mét bestand
app.post("/upload", upload.single("bestand"), async (req, res) => {
  try {
    const { probleem, toelichting, locatie } = req.body;
    const bestand = req.file ? req.file.filename : null;
    if (pool) {
      const conn = await pool.getConnection();
      await conn.query(
        "INSERT INTO meldingen (probleem, toelichting, locatie, bestand) VALUES (?, ?, ?, ?)",
        [probleem, toelichting, locatie, bestand]
      );
      conn.release();
      res.json({ message: "Melding met bestand opgeslagen!" });
    } else {
      res.json({ message: "Melding met bestand ontvangen (database niet beschikbaar)." });
    }
    // notify micro:bit (best-effort)
    try { await sendToMicrobit(); } catch (e) { console.error('microbit notify error', e); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server draait op http://localhost:${PORT}`));



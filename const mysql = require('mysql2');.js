// server.js
const express = require("express");
const multer = require("multer");
const mysql = require("mysql2/promise"); // of gebruik MongoDB als je wilt
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static("public")); // zodat index.html bereikbaar is

// MySQL connectie (pas aan naar jouw instellingen)
const pool = mysql.createPool({
  host: "localhost",
  user: "root",        // jouw MySQL user
  password: "Mysql.25024256",// jouw MySQL wachtwoord
  database: "trashtag",// database naam
});

// Zorg dat tabel bestaat
(async () => {
  const conn = await pool.getConnection();
  await conn.query(`
    CREATE TABLE IF NOT EXISTS gebruiker (
      userid INT AUTO_INCREMENT PRIMARY KEY,
      naam VARCHAR(45) NOT NULL,
      toelichting TEXT,
      adres varchar(69) NOT NULL,
      bestand VARCHAR(255),
      datum TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      adres varchar(69) NOT NULL,
      telefoonnummer int(11) NOT NULL,
      email varchar(420) NOT NULL,

    )
  `);
  conn.release();
})();

// Multer voor file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// Endpoint zonder bestand
app.post("/submit", async (req, res) => {
  try {
    const { probleem, toelichting, locatie } = req.body;
    const conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO meldingen (probleem, toelichting, locatie) VALUES (?, ?, ?)",
      [probleem, toelichting, locatie]
    );
    conn.release();
    res.json({ message: "Melding opgeslagen in database!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint mét bestand
app.post("/upload", upload.single("bestand"), async (req, res) => {
  try {
    const { probleem, toelichting, locatie } = req.body;
    const bestand = req.file.filename;
    const conn = await pool.getConnection();
    await conn.query(
      "INSERT INTO meldingen (probleem, toelichting, locatie, bestand) VALUES (?, ?, ?, ?)",
      [probleem, toelichting, locatie, bestand]
    );
    conn.release();
    res.json({ message: "Melding met bestand opgeslagen!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server draait op http://localhost:${PORT}`));

const form = document.getElementById("myForm");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(form);

  const res = await fetch("http://localhost:3000/upload", {
    method: "POST",
    body: formData
  });

  const result = await res.json();
  closeModal();
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = result.message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
});



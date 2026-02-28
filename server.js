require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

console.log("DATABASE_URL carregada?", !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// captura erros de conexão no pool também
pool.on('error', (err) => {
  console.error('POOL ERROR:', err);
});

app.get('/health', (req, res) => {
  res.json({ status: 'Servidor rodando 🚀' });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as now');
    res.json({
      message: 'Conexão com banco OK ✅',
      now: result.rows[0].now,
    });
  } catch (err) {
    console.error('DB TEST ERROR:', err); // <-- AQUI vai aparecer o motivo REAL
    res.status(500).json({
      error: 'Erro ao conectar no banco ❌',
      details: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Servidor rodando em http://localhost:${PORT}`));
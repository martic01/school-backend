const express = require('express');
const cors = require('cors');
const { v2: cloudinary } = require('cloudinary');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'https://acedu.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean)
}));
app.use(express.json({ limit: '50mb' }));

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dq46c3lf3',
  api_key: process.env.CLOUDINARY_API_KEY || '767899835468131',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'JeytQ7MopgskaUIDXYDdfR5Co_k'
});

// ============ NEON DATABASE CONFIGURATION ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20,
});

// Test database connection with retry logic
const testConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      console.log('✅ Connected to Neon PostgreSQL database');
      client.release();
      return true;
    } catch (err) {
      console.error(`Connection attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) return false;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  return false;
};

// Create tables - FIXED VERSION
const initDb = async () => {
  try {
    const isConnected = await testConnection();
    if (!isConnected) {
      console.error('❌ Cannot initialize database - no connection');
      return;
    }

    // First, remove the site_id column if it exists
    try {
      await pool.query(`
        ALTER TABLE boxes DROP COLUMN IF EXISTS site_id;
      `);
      console.log('✅ Removed site_id column if it existed');
    } catch (err) {
      // Table might not exist yet, that's fine
      console.log('Note:', err.message);
    }

    // Create or update table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_boxes_created_at ON boxes(created_at)
    `);
    
    console.log('✅ Database tables initialized successfully');
  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
  }
};

initDb();

// ============ AUTHENTICATION MIDDLEWARE ============
const ADMIN_PASSWORD = 'the4memaker';

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.split(' ')[1];
  
  if (token !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'Invalid password' });
  }
  
  next();
};

// ============ PUBLIC ROUTES ============
app.get('/api/boxes', async (req, res) => {
  console.log('GET /api/boxes called');
  
  try {
    const result = await pool.query(
      'SELECT id, data FROM boxes ORDER BY created_at ASC'
    );
    
    const boxes = result.rows.map(r => ({
      ...r.data,
      id: r.id
    }));
    
    console.log(`Returning ${boxes.length} boxes`);
    res.json(boxes);
  } catch (err) {
    console.error('Database error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'School Backend API (Neon PostgreSQL)',
    endpoints: ['/api/boxes', '/api/delete-cloudinary-image', '/health']
  });
});

// ============ PROTECTED ROUTES ============
app.post('/api/boxes', authenticate, async (req, res) => {
  console.log('📥 POST /api/boxes received!');
  
  const box = req.body;
  
  if (!box) {
    return res.status(400).json({ error: 'No box data received' });
  }
  
  if (!box.imageUrl) {
    return res.status(400).json({ error: 'imageUrl is required' });
  }
  
  const id = box.id || Date.now().toString();
  const { id: _, ...boxData } = box;
  
  try {
    await pool.query(
      'INSERT INTO boxes (id, data) VALUES ($1, $2)',
      [id, JSON.stringify(boxData)]
    );
    console.log('✅ Box saved with ID:', id);
    res.json({ ...boxData, id });
  } catch (err) {
    console.error('❌ Insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/boxes/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE boxes SET data = $1 WHERE id = $2 RETURNING id',
      [JSON.stringify(req.body), req.params.id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Box not found' });
    }
    
    res.json(req.body);
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/boxes/:id', authenticate, async (req, res) => {
  console.log('Deleting ID:', req.params.id);
  
  try {
    const result = await pool.query(
      'DELETE FROM boxes WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Box not found' });
    }
    
    res.json({ message: 'Box deleted', id: req.params.id });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/delete-cloudinary-image', authenticate, async (req, res) => {
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({ error: 'publicId is required' });
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result === 'ok' || result.result === 'not found') {
      return res.json({ success: true, result: result.result });
    } else {
      return res.status(500).json({ error: 'Cloudinary deletion failed', result });
    }
  } catch (err) {
    console.error('Cloudinary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  await pool.end();
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`   Cloudinary cloud: ${cloudinary.config().cloud_name}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Database: Neon PostgreSQL`);
  console.log(`   🔒 Protected routes require authentication`);
});
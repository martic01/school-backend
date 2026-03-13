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
    'http://localhost:5173', // Add this for Vite
    'http://localhost:5174', // Add this in case Vite uses a different port
    'https://acedu.vercel.app', // Replace with your actual Vercel URL
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

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to PostgreSQL:', err.stack);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// Create tables if they don't exist
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Database tables initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};
initDb();

// GET all boxes
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
    console.error('Database error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST new box
// POST new box
app.post('/api/boxes', async (req, res) => {
  console.log('📥 POST /api/boxes received!');
  console.log('Request body:', req.body); // Debug: see what's coming in
  
  const box = req.body;
  
  // Check if box exists
  if (!box) {
    console.error('❌ No box data received');
    return res.status(400).json({ error: 'No box data received' });
  }
  
  // Check if required fields exist
  if (!box.imageUrl) {
    console.error('❌ Missing imageUrl');
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
    console.error('❌ Insert error:', err);
    res.status(500).json({ error: err.message });
  }
});
// PUT update box
app.put('/api/boxes/:id', async (req, res) => {
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
    console.error('Update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE box
app.delete('/api/boxes/:id', async (req, res) => {
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
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cloudinary image deletion
app.post('/api/delete-cloudinary-image', async (req, res) => {
  const { publicId } = req.body;

  console.log('Received Cloudinary delete request for publicId:', publicId);

  if (!publicId) {
    console.error('No publicId provided');
    return res.status(400).json({ error: 'publicId is required' });
  }

  try {
    console.log(`Attempting to delete Cloudinary image: ${publicId}`);
    console.log('Cloudinary config:', {
      cloud_name: cloudinary.config().cloud_name,
      api_key_exists: !!cloudinary.config().api_key
    });
    
    const result = await cloudinary.uploader.destroy(publicId);
    console.log('Cloudinary destroy result:', JSON.stringify(result, null, 2));
    
    if (result.result === 'ok') {
      console.log('✅ Cloudinary image deleted successfully');
      return res.json({ success: true, result: result.result });
    } else if (result.result === 'not found') {
      console.log('⚠️ Cloudinary image not found (already deleted?)');
      return res.json({ success: true, result: result.result });
    } else {
      console.error('❌ Cloudinary deletion failed with result:', result);
      return res.status(500).json({ error: 'Cloudinary deletion failed', result });
    }
  } catch (err) {
    console.error('❌ Cloudinary error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    res.status(500).json({ error: err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'School Backend API',
    endpoints: ['/api/boxes', '/api/delete-cloudinary-image', '/health']
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`   Cloudinary cloud: ${cloudinary.config().cloud_name}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});



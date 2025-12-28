const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const documents = [];

app.post('/api/v1/documents/init-upload', (req, res) => {
  const { fileName, mimeType, size } = req.body;
  const documentId = uuidv4();
  
  const doc = {
    id: documentId,
    name: fileName,
    status: 'UPLOADING',
    createdAt: new Date().toISOString(),
    sizeBytes: size,
  };
  
  documents.push(doc);
  
  setTimeout(() => {
    const d = documents.find(d => d.id === documentId);
    if (d) d.status = 'PROCESSING';
  }, 2000);
  
  setTimeout(() => {
    const d = documents.find(d => d.id === documentId);
    if (d) d.status = 'READY';
  }, 5000);
  
  res.json({
    documentId,
    uploadUrl: `http://localhost:3001/upload/${documentId}`,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  });
});

app.put('/upload/:id', (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/v1/documents', (req, res) => {
  res.json({
    documents: documents.filter(d => d.status !== 'DELETED'),
    total: documents.length,
  });
});

app.get('/api/v1/documents/:id', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: { message: 'Not found' } });
  res.json(doc);
});

app.get('/api/v1/documents/:id/download', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: { message: 'Not found' } });
  
  res.json({
    downloadUrl: `http://localhost:3001/download/${doc.id}`,
    fileName: doc.name,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
  });
});

app.get('/download/:id', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).send('Not found');
  
  res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
  res.send('Mock file content for ' + doc.name);
});

app.delete('/api/v1/documents/:id', (req, res) => {
  const doc = documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: { message: 'Not found' } });
  
  doc.status = 'DELETED';
  doc.deletedAt = new Date().toISOString();
  
  res.json({ status: 'soft_deleted', deletedAt: doc.deletedAt });
});

app.get('/api/v1/documents/search', (req, res) => {
  const query = req.query.q?.toLowerCase() || '';
  const results = documents
    .filter(d => d.status !== 'DELETED' && d.name.toLowerCase().includes(query))
    .map(d => ({ ...d, relevanceScore: 0.8 }));
  
  res.json({ results, total: results.length });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  POST   /api/v1/documents/init-upload');
  console.log('  GET    /api/v1/documents');
  console.log('  GET    /api/v1/documents/:id');
  console.log('  GET    /api/v1/documents/:id/download');
  console.log('  DELETE /api/v1/documents/:id');
  console.log('  GET    /api/v1/documents/search');
});

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

// Configure multer for file uploads with larger limit
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // Increased to 50MB for mobile recordings
  },
  fileFilter: (req, file, cb) => {
    console.log('📁 Uploaded file info:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      fieldname: file.fieldname
    });
    
    // Accept audio files - more permissive for mobile recordings
    const allowedTypes = /audio\/(mpeg|mp3|wav|m4a|ogg|flac|webm|aac|x-m4a|mp4)/;
    const allowedExtensions = /\.(mp3|wav|m4a|ogg|flac|webm|aac|mp4)$/i;
    
    if (allowedTypes.test(file.mimetype) || allowedExtensions.test(file.originalname)) {
      cb(null, true);
    } else {
      console.error('❌ Invalid file type:', file.mimetype, file.originalname);
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed types: mp3, wav, m4a, ogg, flac, webm, aac`));
    }
  }
});

// Enhanced CORS configuration for mobile access
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Hugging Face API configuration
const HF_API_URL = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Validate API key on startup
if (!process.env.HUGGING_FACE_API_KEY) {
  console.error('❌ Error: HUGGING_FACE_API_KEY environment variable is required');
  console.log('💡 Get your API key from: https://huggingface.co/settings/tokens');
  process.exit(1);
}

// Function to query Hugging Face API
async function queryHuggingFace(audioBuffer, mimeType) {
  // Map common mime types to what HF expects
  let contentType = 'audio/wav'; // default
  if (mimeType) {
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
      contentType = 'audio/mpeg';
    } else if (mimeType.includes('m4a') || mimeType.includes('x-m4a')) {
      contentType = 'audio/m4a';
    } else if (mimeType.includes('wav')) {
      contentType = 'audio/wav';
    } else if (mimeType.includes('ogg')) {
      contentType = 'audio/ogg';
    } else if (mimeType.includes('webm')) {
      contentType = 'audio/webm';
    } else if (mimeType.includes('flac')) {
      contentType = 'audio/flac';
    }
  }

  const response = await axios({
    method: 'post',
    url: HF_API_URL,
    headers: {
      'Authorization': `Bearer ${HF_API_KEY}`,
      'Content-Type': contentType,
      'Accept': 'application/json', // Explicitly set accept header
    },
    data: audioBuffer,
    timeout: 60000, // 60 second timeout
    responseType: 'json', // Expect JSON response
  });
  
  return response.data;
}

const getDataPerPage = (pageNumber) => {
  const filePath = path.join(__dirname, 'pages', `${pageNumber}.json`);
  console.log(`📄 Fetching Quran page data for page ${pageNumber} from:`, filePath);
  
  // Use readFileSync (synchronous) instead of readFile
  const data = fs.readFileSync(filePath, 'utf8');
  console.log(data);
  
  const jsonData = JSON.parse(data);
  console.log(`📄 Successfully loaded Quran page ${pageNumber}`, jsonData);
  
  return jsonData;
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Hugging Face Whisper Transcription API Server is running!', 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    serverIP: getLocalIP(),
    port: PORT,
    model: 'openai/whisper-large-v3'
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: 'API is working correctly!',
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    huggingFaceModel: 'openai/whisper-large-v3'
  });
});

// File upload test endpoint
app.post('/test-upload', upload.single('file'), (req, res) => {
  console.log('🧪 Test upload request received');
  
  if (!req.file) {
    return res.status(400).json({ 
      error: 'No file provided',
      success: false 
    });
  }

  res.json({
    success: true,
    message: 'File uploaded successfully!',
    fileInfo: {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
      buffer_length: req.file.buffer.length,
    }
  });
});


app.get('/data/pages/:pageNumber', (req, res) => {
  try {
    const pageNumber = req.params.pageNumber;
    
    if (!/^\d+$/.test(pageNumber) || parseInt(pageNumber) <= 0) {
      return res.status(400).json({ error: 'Invalid page number' });
    }
    
    const filePath = path.join(__dirname, 'pages', `${pageNumber}.json`);
    console.log(`📄 Fetching Quran page data for page ${pageNumber} from:`, filePath);
    
    // Use readFileSync (synchronous) instead of readFile
    const data = fs.readFileSync(filePath, 'utf8');
    console.log(data);
    
    const jsonData = JSON.parse(data);
    console.log(`📄 Successfully loaded Quran page ${pageNumber}`, jsonData);
    
    // Don't forget to send the response!
    res.json(jsonData);
    
  } catch (error) {
    console.error('Error reading page:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Page not found' });
    } else if (error instanceof SyntaxError) {
      res.status(500).json({ error: 'Invalid JSON format' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});
// Transcription endpoint with Hugging Face Whisper
app.post('/transcribe', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const ayah = req.query.ayah;
  const page = req.query.pageNumber; // Changed from req.query.page to match frontend
  
  // Validate required parameters
  if (!page || !ayah) {
    return res.status(400).json({
      error: 'Missing required parameters',
      success: false,
      hint: 'Both pageNumber and ayah parameters are required'
    });
  }
  
  // Validate that parameters are valid numbers
  const pageNum = parseInt(page);
  const ayahNum = parseInt(ayah);
  
  if (isNaN(pageNum) || isNaN(ayahNum) || pageNum < 1 || ayahNum < 1) {
    return res.status(400).json({
      error: 'Invalid parameter values',
      success: false,
      hint: 'pageNumber and ayah must be positive integers'
    });
  }

  try {
    // Get page data with error handling
    let pageData;
    try {
      pageData = getDataPerPage(pageNum);
    } catch (error) {
      console.error('Error loading page data:', error);
      return res.status(404).json({
        error: `Page ${pageNum} not found`,
        success: false,
        hint: 'Please check if the page number is valid'
      });
    }

    // Find the expected ayah text
    const expectedAyahText = pageData.surahs[0].ayahs.find(a => a.ayahNum === ayahNum)?.words
      .filter(word => !/^[٠-٩]+$/.test(word.text)) // Filter out Arabic numerals
      .map(word => word.text)
      .join(' ');

    if (!expectedAyahText) {
      return res.status(404).json({
        error: `Ayah ${ayahNum} not found on page ${pageNum}`,
        success: false
      });
    }

    console.log('🔍 Expected Ayah Text:', expectedAyahText);
    console.log('📝 Transcription request received from:', req.ip);
    console.log('📱 User Agent:', req.get('User-Agent'));
    console.log('📄 Page:', pageNum, 'Ayah:', ayahNum);
    
    if (!req.file) {
      console.error('❌ No file provided in request');
      return res.status(400).json({ 
        error: 'No audio file provided. Please select an audio file.',
        success: false,
        hint: 'Make sure you are sending the file with the key "file" in the form data'
      });
    }

    console.log('📁 File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
      buffer_length: req.file.buffer.length,
    });

    // Define compareTexts function
    const compareTexts = (transcribed, expected) => {
      const removeDiacritics = (text) => {
        if (!text) return '';
        return text
          .replace(/[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g, '')
          .replace(/\s+/g, ' ')
          .normalize('NFD')
          .trim();
      };

      // Remove diacritics and normalize both texts
      const cleanTranscribed = removeDiacritics(transcribed);
      const cleanExpected = removeDiacritics(expected);
      
      console.log('🧹 Clean Transcribed:', cleanTranscribed);
      console.log('🧹 Clean Expected:', cleanExpected);
      
      const baseMatch = cleanTranscribed === cleanExpected;
      const fullMatch = transcribed.trim() === expected.trim();
      
      // Calculate similarity percentage for partial matches
      let accuracy = 0;
      if (baseMatch) {
        accuracy = fullMatch ? 100 : 85;
      } else {
        // Simple similarity calculation
        const similarity = calculateSimilarity(cleanTranscribed, cleanExpected);
        accuracy = similarity;
      }
      
      return {
        isBaseCorrect: baseMatch,
        isFullCorrect: fullMatch,
        accuracy: accuracy,
        feedback: baseMatch ? 
          (fullMatch ? 'Parfait! ✅' : 'Bon mais attention aux diacritiques 📝') : 
          `Répétez s'il vous plaît - Précision: ${accuracy}% 🔄`,
        cleanTranscribed: cleanTranscribed,
        cleanExpected: cleanExpected
      };
    };

    // Simple similarity calculation function
    const calculateSimilarity = (str1, str2) => {
      if (str1 === str2) return 100;
      if (!str1 || !str2) return 0;
      
      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      
      if (longer.length === 0) return 100;
      
      // Simple character-based similarity
      let matches = 0;
      const minLength = Math.min(str1.length, str2.length);
      
      for (let i = 0; i < minLength; i++) {
        if (str1[i] === str2[i]) matches++;
      }
      
      return Math.round((matches / longer.length) * 100);
    };

    // Validate file size
    if (req.file.size === 0) {
      return res.status(400).json({
        error: 'Empty file provided',
        success: false
      });
    }

    console.log('🎤 Starting Hugging Face Whisper transcription...');

    // Query Hugging Face API with audio buffer and mime type
    const result = await queryHuggingFace(req.file.buffer, req.file.mimetype);

    const processingTime = Date.now() - startTime;
    
    // Handle different response formats from HF
    let transcriptionText = '';
    if (typeof result === 'string') {
      transcriptionText = result;
    } else if (result && result.text) {
      transcriptionText = result.text;
    } else if (Array.isArray(result) && result.length > 0) {
      // Sometimes HF returns an array of results
      transcriptionText = result.map(r => r.text || r).join(' ');
    } else {
      throw new Error('Unexpected response format from Hugging Face API');
    }
    
    console.log('✅ Transcription completed successfully');
    console.log('⏱️ Processing time:', `${processingTime}ms`);
    console.log('📝 Transcription length:', transcriptionText.length, 'characters');
    console.log('📝 Transcription preview:', transcriptionText.substring(0, 100) + '...');
    console.log('🔍 Full Transcribed Text:', transcriptionText);
    
    // Use the compareTexts function for intelligent comparison
    const comparisonResult = compareTexts(transcriptionText, expectedAyahText);
    
    console.log('📊 Comparison Result:', comparisonResult);

    // Return detailed JSON response
    res.json({
      success: true,
      transcription: transcriptionText,
      expected: expectedAyahText,
      comparison: {
        isCorrect: comparisonResult.isBaseCorrect,
        isFullCorrect: comparisonResult.isFullCorrect,
        accuracy: comparisonResult.accuracy,
        feedback: comparisonResult.feedback,
        details: {
          cleanTranscribed: comparisonResult.cleanTranscribed,
          cleanExpected: comparisonResult.cleanExpected
        }
      },
      shouldProceed: comparisonResult.accuracy >= 80, // Threshold for moving to next ayah
      processingTime: `${processingTime}ms`
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Transcription failed:', error);
    console.error('⏱️ Failed after:', `${processingTime}ms`);

    // Handle specific Hugging Face API errors
    if (error.response?.status === 401) {
      return res.status(401).json({
        error: 'Invalid Hugging Face API key',
        success: false,
        hint: 'Please check your HUGGING_FACE_API_KEY environment variable'
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later',
        success: false,
        details: 'Hugging Face API rate limit reached'
      });
    }

    if (error.response?.status === 413) {
      return res.status(400).json({
        error: 'Audio file is too large for Hugging Face API',
        success: false,
        hint: 'Try reducing the file size or duration'
      });
    }

    if (error.response?.status === 503) {
      return res.status(503).json({
        error: 'Model is currently loading. Please try again in a few moments',
        success: false,
        details: 'Hugging Face model is initializing'
      });
    }

    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({
        error: 'Network timeout. Please try again',
        success: false
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'Failed to transcribe audio',
      details: error?.message || 'Unknown error occurred',
      success: false,
      apiResponse: error.response?.data || null
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 50MB',
        success: false
      });
    }
    return res.status(400).json({
      error: 'File upload error',
      details: error.message,
      success: false
    });
  }
  
  console.error('🔥 Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    details: error.message,
    success: false
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: {
      'GET /': 'Health check',
      'GET /test': 'Test endpoint',
      'POST /test-upload': 'Test file upload',
      'POST /transcribe': 'Audio transcription (Hugging Face Whisper)'
      
    }
  });
});

// Start server
const localIP = getLocalIP();
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Hugging Face Whisper Transcription API Server started');
  console.log('📡 Local access:', `http://localhost:${PORT}`);
  console.log('📱 Mobile access:', `http://${localIP}:${PORT}`);
  console.log('🌍 Network access:', `http://0.0.0.0:${PORT}`);
  console.log('🤗 Hugging Face API Key:', process.env.HUGGING_FACE_API_KEY ? '✅ Configured' : '❌ Missing');
  console.log('🎯 Model: openai/whisper-large-v3');
  console.log('📝 Available endpoints:');
  console.log('   GET  /', '- Health check');
  console.log('   GET  /test', '- Test endpoint');
  console.log('   POST /test-upload', '- Test file upload');
  console.log('   POST /transcribe', '- Audio transcription (HF Whisper)');
  console.log('\n📱 To test from mobile:');
  console.log(`   Open: http://${localIP}:${PORT} in your mobile browser`);
  console.log('\n💡 Setup instructions:');
  console.log('   1. Get API key: https://huggingface.co/settings/tokens');
  console.log('   2. Set environment variable: HUGGING_FACE_API_KEY=your_token_here');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});
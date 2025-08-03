const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();
const ffmpeg = require('fluent-ffmpeg');

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
    fileSize: 50 * 1024 * 1024, // 50MB for mobile recordings
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

// Enhanced CORS configuration
app.use(cors({
  origin: ['http://localhost:8081', 'http://192.168.100.248:8081', 'exp://192.168.100.248:8081'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Tarteel API configuration (if using Tarteel)
const TARTEEL_API_URL = process.env.TARTEEL_API_URL || 'https://api.tarteel.ai/transcribe';
const TARTEEL_API_KEY = process.env.TARTEEL_API_KEY;

// Hugging Face API configuration (fallback)
const HF_API_URL = 'https://api-inference.huggingface.co/models/openai/whisper-large-v3';
const HF_API_KEY = process.env.HUGGING_FACE_API_KEY;

// Validate API keys on startup
if (!process.env.HUGGING_FACE_API_KEY && !process.env.TARTEEL_API_KEY) {
  console.error('❌ Error: Either HUGGING_FACE_API_KEY or TARTEEL_API_KEY environment variable is required');
  console.log('💡 Get Hugging Face API key from: https://huggingface.co/settings/tokens');
  console.log('💡 Get Tarteel API key from: https://tarteel.ai/developers');
  process.exit(1);
}

// Arabic text processing utilities
const ArabicTextProcessor = {
  // Remove diacritics (tashkeel) from Arabic text
  removeDiacritics: (text) => {
    if (!text) return '';
    return text
      .replace(/[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g, '')
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .trim();
  },

  // Clean text for comparison
  cleanText: (text) => {
    if (!text) return '';
    return text
      .replace(/[٠-٩]/g, '') // Remove Arabic numerals
      .replace(/[۰-۹]/g, '') // Remove Persian numerals
      .replace(/[0-9]/g, '') // Remove Western numerals
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Calculate Levenshtein distance for similarity
  levenshteinDistance: (str1, str2) => {
    const matrix = [];
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[str2.length][str1.length];
  },

  // Calculate similarity percentage
  calculateSimilarity: (str1, str2) => {
    if (str1 === str2) return 100;
    if (!str1 || !str2) return 0;
    
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 100;
    
    const distance = ArabicTextProcessor.levenshteinDistance(str1, str2);
    return Math.round(((maxLength - distance) / maxLength) * 100);
  },

  // Calculate tashkeel accuracy
  calculateTashkeelAccuracy: (transcribed, expected) => {
    if (!transcribed || !expected) return 0;
    
    // Extract tashkeel marks
    const getTashkeel = (text) => {
      return (text.match(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g) || []).join('');
    };
    
    const transcribedTashkeel = getTashkeel(transcribed);
    const expectedTashkeel = getTashkeel(expected);
    
    if (expectedTashkeel.length === 0) return 100; // No tashkeel expected
    
    return ArabicTextProcessor.calculateSimilarity(transcribedTashkeel, expectedTashkeel);
  }
};

// Enhanced comparison engine
const EnhancedComparison = {
  analyzeWords: (transcribed, expected) => {
    const transcribedWords = transcribed.split(/\s+/).filter(w => w.length > 0);
    const expectedWords = expected.split(/\s+/).filter(w => w.length > 0);
    
    const wordAnalysis = [];
    const maxLength = Math.max(transcribedWords.length, expectedWords.length);
    
    let correctWords = 0;
    let partialCorrect = 0;
    
    for (let i = 0; i < maxLength; i++) {
      const transcribedWord = transcribedWords[i] || '';
      const expectedWord = expectedWords[i] || '';
      
      const cleanTranscribed = ArabicTextProcessor.removeDiacritics(transcribedWord);
      const cleanExpected = ArabicTextProcessor.removeDiacritics(expectedWord);
      
      const similarity = ArabicTextProcessor.calculateSimilarity(cleanTranscribed, cleanExpected);
      const tashkeelAccuracy = ArabicTextProcessor.calculateTashkeelAccuracy(transcribedWord, expectedWord);
      
      const isCorrect = similarity >= 90;
      const isPartialCorrect = similarity >= 70;
      
      if (isCorrect) correctWords++;
      else if (isPartialCorrect) partialCorrect++;
      
      let status = 'incorrect';
      if (similarity === 100) status = 'perfect';
      else if (isCorrect) status = 'correct';
      else if (isPartialCorrect) status = 'partial';
      
      wordAnalysis.push({
        transcribed: transcribedWord,
        expected: expectedWord,
        isCorrect: isCorrect,
        similarity: similarity,
        tashkeelAccuracy: tashkeelAccuracy,
        status: status
      });
    }
    
    const totalWords = expectedWords.length;
    const wordAccuracy = totalWords > 0 ? Math.round((correctWords / totalWords) * 100) : 0;
    const partialAccuracy = totalWords > 0 ? Math.round(((correctWords + partialCorrect * 0.5) / totalWords) * 100) : 0;
    
    return {
      correctWords,
      totalWords,
      wordAccuracy,
      partialAccuracy,
      wordAnalysis
    };
  },

  generateFeedback: (comparison) => {
    const { accuracy, tashkeelAccuracy, wordAnalysis } = comparison;
    
    let feedback = '';
    let detailedFeedback = '';
    let recommendation = '';
    
    if (accuracy >= 95) {
      feedback = '🌟 ممتاز! تلاوة مثالية';
      detailedFeedback = 'تلاوتك كانت دقيقة جداً مع نطق صحيح للكلمات والتشكيل.';
      recommendation = 'انتقل للآية التالية واستمر في الأداء الممتاز.';
    } else if (accuracy >= 85) {
      feedback = '✅ جيد جداً! تلاوة صحيحة مع تحسينات طفيفة';
      detailedFeedback = 'تلاوتك جيدة جداً مع بعض التحسينات المطلوبة في التشكيل أو النطق.';
      recommendation = 'يمكنك الانتقال للآية التالية أو إعادة المحاولة للحصول على درجة أفضل.';
    } else if (accuracy >= 70) {
      feedback = '📝 جيد ولكن يحتاج تحسين';
      detailedFeedback = 'هناك بعض الأخطاء في النطق أو ترتيب الكلمات. راجع الكلمات المميزة باللون الأحمر.';
      recommendation = 'أعد المحاولة مع التركيز على الكلمات التي تحتاج تصحيح.';
    } else if (accuracy >= 50) {
      feedback = '🔄 يحتاج مراجعة وتصحيح';
      detailedFeedback = 'يوجد عدة أخطاء في التلاوة. اقرأ النص أولاً ثم أعد التسجيل.';
      recommendation = 'اقرأ الآية بصمت أولاً، ثم أعد التسجيل مع التركيز على النطق الصحيح.';
    } else {
      feedback = '❌ تحتاج مراجعة شاملة';
      detailedFeedback = 'التلاوة تحتاج مراجعة كاملة. تأكد من قراءة النص بصوت عالٍ قبل التسجيل.';
      recommendation = 'راجع النص جيداً واقرأه عدة مرات قبل إعادة التسجيل.';
    }
    
    // Add tashkeel-specific feedback
    if (tashkeelAccuracy < 70) {
      detailedFeedback += ' انتبه بشكل خاص لعلامات التشكيل والنطق الصحيح.';
    }
    
    return { feedback, detailedFeedback, recommendation };
  }
};

// Function to convert audio to WAV format
async function convertToWav(inputBuffer, originalName) {
  return new Promise((resolve, reject) => {
    const tempInputPath = path.join(__dirname, 'temp', `input_${Date.now()}.m4a`);
    const tempOutputPath = path.join(__dirname, 'temp', `output_${Date.now()}.wav`);
    
    // Ensure temp directory exists
    fs.mkdirSync(path.dirname(tempInputPath), { recursive: true });
    
    // Write buffer to temp file
    fs.writeFileSync(tempInputPath, inputBuffer);
    
    ffmpeg(tempInputPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .on('end', () => {
        const wavBuffer = fs.readFileSync(tempOutputPath);
        
        // Clean up temp files
        fs.unlinkSync(tempInputPath);
        fs.unlinkSync(tempOutputPath);
        
        resolve(wavBuffer);
      })
      .on('error', (err) => {
        // Clean up on error
        if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
        if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        reject(err);
      })
      .save(tempOutputPath);
  });
}

// Function to query Tarteel API (preferred for Quran)
async function queryTarteelAPI(audioBuffer, expectedText) {
  if (!TARTEEL_API_KEY) {
    throw new Error('Tarteel API key not configured');
  }

  const formData = new FormData();
  formData.append('audio', audioBuffer, {
    filename: 'recording.wav',
    contentType: 'audio/wav'
  });
  formData.append('expected_text', expectedText);

  const response = await axios({
    method: 'post',
    url: TARTEEL_API_URL,
    headers: {
      'Authorization': `Bearer ${TARTEEL_API_KEY}`,
      ...formData.getHeaders(),
    },
    data: formData,
    timeout: 60000,
  });
  
  return response.data;
}

// Function to query Hugging Face API (fallback)
async function queryHuggingFace(audioBuffer, mimeType) {
  let contentType = 'audio/wav';
  if (mimeType) {
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
      contentType = 'audio/mpeg';
    } else if (mimeType.includes('m4a') || mimeType.includes('x-m4a')) {
      contentType = 'audio/m4a';
    } else if (mimeType.includes('wav')) {
      contentType = 'audio/wav';
    }
  }

  const response = await axios({
    method: 'post',
    url: HF_API_URL,
    headers: {
      'Authorization': `Bearer ${HF_API_KEY}`,
      'Content-Type': contentType,
      'Accept': 'application/json',
    },
    data: audioBuffer,
    timeout: 60000,
    responseType: 'json',
  });
  
  return response.data;
}

async function forwardToWhisperServer(file) {
  const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || 'http://192.168.100.248:5000';
  
  try {
    const formData = new FormData();
    
    // Handle different buffer types more robustly
    let buffer = file.buffer;
    
    // Convert ArrayBuffer to Buffer if needed
    if (buffer instanceof ArrayBuffer) {
      buffer = Buffer.from(buffer);
    } else if (!(buffer instanceof Buffer)) {
      // If it's neither ArrayBuffer nor Buffer, try to convert it
      buffer = Buffer.from(buffer);
    }
    
    // Create a proper readable stream using the Readable constructor
    const { Readable } = require('stream');
    const bufferStream = new Readable({
      read() {
        this.push(buffer);
        this.push(null); // Signal end of stream
      }
    });
    
    formData.append('file', bufferStream, {
      filename: file.originalname || 'audio.m4a',
      contentType: file.mimetype || 'audio/m4a',
      knownLength: buffer.length
    });

    console.log('🔄 Forwarding to Python server:', `${WHISPER_SERVER_URL}/transcribe`);
    console.log('📁 File info being sent:', {
      filename: file.originalname || 'audio.m4a',
      contentType: file.mimetype || 'audio/m4a',
      size: buffer.length,
      bufferType: buffer.constructor.name
    });

    const response = await axios.post(`${WHISPER_SERVER_URL}/transcribe`, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('✅ Python server response received');
    return response.data;

  } catch (error) {
    console.error('Error forwarding to Whisper server:', error);
    
    if (error.response) {
      console.error('Python server error:', error.response.status, error.response.data);
      throw new Error(`Whisper server responded with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('No response received:', error.request);
      throw new Error('No response from Whisper server - check if the Python server is running');
    } else {
      console.error('Request setup error:', error.message);
      throw error;
    }
  }
}


// Get Quran page data
const getDataPerPage = (pageNumber) => {
  const filePath = path.join(__dirname, 'pages', `${pageNumber}.json`);
  console.log(`📄 Fetching Quran page data for page ${pageNumber} from:`, filePath);
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`Page ${pageNumber} not found`);
  }
  
  const data = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(data);
  console.log(`📄 Successfully loaded Quran page ${pageNumber}`);
  
  return jsonData;
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Enhanced Quran Transcription API Server is running!', 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    serverIP: getLocalIP(),
    port: PORT,
    models: {
      primary: TARTEEL_API_KEY ? 'Tarteel AI' : 'Hugging Face Whisper',
      fallback: 'openai/whisper-large-v3'
    }
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: 'API is working correctly!',
    timestamp: new Date().toISOString(),
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    capabilities: {
      tarteel: !!TARTEEL_API_KEY,
      huggingFace: !!HF_API_KEY,
      audioConversion: true
    }
  });
});

// Get Quran page data endpoint
app.get('/data/pages/:pageNumber', (req, res) => {
  try {
    const pageNumber = req.params.pageNumber;
    
    if (!/^\d+$/.test(pageNumber) || parseInt(pageNumber) <= 0) {
      return res.status(400).json({ error: 'Invalid page number' });
    }
    
    const jsonData = getDataPerPage(parseInt(pageNumber));
    res.json(jsonData);
    
  } catch (error) {
    console.error('Error reading page:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else if (error instanceof SyntaxError) {
      res.status(500).json({ error: 'Invalid JSON format' });
    } else {
      res.status(500).json({ error: 'Server error' });
    }
  }
});

// Enhanced transcription endpoint
app.post('/transcribe', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  const ayah = req.query.ayah;
  const page = req.query.pageNumber;
  
  // Validate required parameters
  if (!page || !ayah) {
    return res.status(400).json({
      error: 'Missing required parameters',
      success: false,
      hint: 'Both pageNumber and ayah parameters are required'
    });
  }
  
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
    // Get page data
    let pageData;
    try {
      pageData = getDataPerPage(pageNum);
    } catch (error) {
      console.error('Error loading page data:', error);
      return res.status(404).json({
        error: `Page ${pageNum} not found`,
        success: false
      });
    }

    // Find the expected ayah text
    let expectedAyahText = '';
    let surahNum = 0;
    
    for (const surah of pageData.surahs) {
      const ayahData = surah.ayahs.find(a => a.ayahNum === ayahNum);
      if (ayahData) {
        expectedAyahText = ayahData.words
          .filter(word => word.text && word.text.trim() !== '')
          .filter(word => !/^[٠-٩]+$/.test(word.text)) // Filter out Arabic numerals
          .map(word => word.text)
          .join(' ');
        surahNum = surah.surahNum;
        break;
      }
    }

    if (!expectedAyahText) {
      return res.status(404).json({
        error: `Ayah ${ayahNum} not found on page ${pageNum}`,
        success: false
      });
    }

    console.log('🔍 Expected Ayah Text:', expectedAyahText);
    console.log('📝 Transcription request - Page:', pageNum, 'Ayah:', ayahNum, 'Surah:', surahNum);
    
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No audio file provided',
        success: false
      });
    }

    console.log('📁 File details:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`
    });

    let transcriptionText = '';
    let modelUsed = '';

    // Try Tarteel first if available, then fallback to Hugging Face
    try {
      if (TARTEEL_API_KEY) {
        console.log('🎤 Using Tarteel AI for transcription...');
        
        let audioBuffer = req.file.buffer;
        if (req.file.mimetype.includes('m4a')) {
          console.log('🔄 Converting m4a to wav...');
          audioBuffer = await convertToWav(req.file.buffer, req.file.originalname);
        }
        
        const tarteelResult = await queryTarteelAPI(audioBuffer, expectedAyahText);
        transcriptionText = tarteelResult.transcription || tarteelResult.text || '';
        modelUsed = 'Tarteel AI';
      } else {
        throw new Error('Tarteel not available, using fallback');
      }
    } catch (tarteelError) {
      console.log('⚠️ Tarteel failed, falling back to Hugging Face:', tarteelError.message);
      
      if (HF_API_KEY) {
        console.log('🎤 Using Hugging Face Whisper for transcription...');
        const hfResult = await forwardToWhisperServer(req.file.buffer, req.file.mimetype);
        
        if (typeof hfResult === 'string') {
          transcriptionText = hfResult;
        } else if (hfResult && hfResult.text) {
          transcriptionText = hfResult.text;
        } else if (Array.isArray(hfResult) && hfResult.length > 0) {
          transcriptionText = hfResult.map(r => r.text || r).join(' ');
        }
        modelUsed = 'Hugging Face Whisper Large v3';
      } else {
        throw new Error('No transcription service available');
      }
    }

    const processingTime = Date.now() - startTime;
    
    console.log('✅ Transcription completed');
    console.log('📝 Transcribed Text:', transcriptionText);
    console.log('⏱️ Processing time:', `${processingTime}ms`);
    console.log('🤖 Model used:', modelUsed);
    
    // Enhanced comparison using our improved engine
    const cleanTranscribed = ArabicTextProcessor.cleanText(transcriptionText);
    const cleanExpected = ArabicTextProcessor.cleanText(expectedAyahText);
    
    const baseTranscribed = ArabicTextProcessor.removeDiacritics(cleanTranscribed);
    const baseExpected = ArabicTextProcessor.removeDiacritics(cleanExpected);
    
    const accuracy = ArabicTextProcessor.calculateSimilarity(baseTranscribed, baseExpected);
    const tashkeelAccuracy = ArabicTextProcessor.calculateTashkeelAccuracy(transcriptionText, expectedAyahText);
    
    const wordAnalysis = EnhancedComparison.analyzeWords(transcriptionText, expectedAyahText);
    
    const isCorrect = accuracy >= 80;
    const isFullCorrect = accuracy >= 95 && tashkeelAccuracy >= 90;
    const shouldProceed = accuracy >= 75; // Lower threshold for progression
    
    const feedbackData = EnhancedComparison.generateFeedback({
      accuracy,
      tashkeelAccuracy,
      wordAnalysis: wordAnalysis.wordAnalysis
    });
    
    // Create enhanced response matching frontend interface
    const enhancedResponse = {
      success: true,
      transcription: transcriptionText,
      expected: expectedAyahText,
      comparison: {
        isCorrect: isCorrect,
        isFullCorrect: isFullCorrect,
        accuracy: accuracy,
        tashkeelAccuracy: tashkeelAccuracy,
        feedback: feedbackData.feedback,
        detailedFeedback: feedbackData.detailedFeedback,
        wordAnalysis: wordAnalysis,
        recommendation: feedbackData.recommendation
      },
      shouldProceed: shouldProceed,
      processingTime: `${processingTime}ms`,
      modelUsed: modelUsed,
      metadata: {
        pageNumber: pageNum,
        ayahNumber: ayahNum,
        surahNumber: surahNum,
        timestamp: new Date().toISOString()
      }
    };

    console.log('📊 Analysis Results:', {
      accuracy: `${accuracy}%`,
      tashkeelAccuracy: `${tashkeelAccuracy}%`,
      wordAccuracy: `${wordAnalysis.wordAccuracy}%`,
      shouldProceed: shouldProceed
    });

    res.json(enhancedResponse);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Transcription failed:', error);
    console.error('⏱️ Failed after:', `${processingTime}ms`);

    // Handle specific API errors
    if (error.response?.status === 401) {
      return res.status(401).json({
        error: 'API authentication failed',
        success: false,
        hint: 'Please check your API keys'
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later',
        success: false
      });
    }

    if (error.response?.status === 413) {
      return res.status(400).json({
        error: 'Audio file is too large',
        success: false,
        hint: 'Try reducing the file size or duration'
      });
    }

    if (error.response?.status === 503) {
      return res.status(503).json({
        error: 'Model is currently loading. Please try again in a few moments',
        success: false
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'Failed to transcribe audio',
      details: error?.message || 'Unknown error occurred',
      success: false,
      processingTime: `${processingTime}ms`
    });
  }
});

// Test upload endpoint
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
      'GET /data/pages/:pageNumber': 'Get Quran page data',
      'POST /test-upload': 'Test file upload',
      'POST /transcribe': 'Enhanced audio transcription with Tarteel/Whisper'
    }
  });
});

// Start server
const localIP = getLocalIP();
app.listen(PORT, '192.168.100.248', () => {
  console.log('🚀 Enhanced Quran Transcription API Server started');
  console.log('📡 Local access:', `http://localhost:${PORT}`);
  console.log('📱 Mobile access:', `http://${localIP}:${PORT}`);
  console.log('🌍 Network access:', `http://192.168.100.248:${PORT}`);
  console.log('🔑 API Keys Status:');
  console.log('   Tarteel AI:', TARTEEL_API_KEY ? '✅ Configured' : '❌ Missing');
  console.log('   Hugging Face:', HF_API_KEY ? '✅ Configured' : '❌ Missing');
  console.log('🧠 AI Models:');
  console.log('   Primary:', TARTEEL_API_KEY ? 'Tarteel AI (Quran-specialized)' : 'Hugging Face Whisper Large v3');
  console.log('   Fallback:', 'Hugging Face Whisper Large v3');
  console.log('📝 Available endpoints:');
  console.log('   GET  / - Health check');
  console.log('   GET  /test - Test endpoint');
  console.log('   GET  /data/pages/:pageNumber - Get Quran page data');
  console.log('   POST /test-upload - Test file upload');
  console.log('   POST /transcribe - Enhanced audio transcription');
  console.log('\n📱 Mobile Integration:');
  console.log(`   React Native: http://${localIP}:${PORT}`);
  console.log(`   Expo Dev: exp://${localIP}:${PORT}`);
  console.log('\n💡 Setup instructions:');
  console.log('   1. For Tarteel (recommended): Get API key from https://tarteel.ai/developers');
  console.log('   2. For Hugging Face (fallback): Get API key from https://huggingface.co/settings/tokens');
  console.log('   3. Set environment variables:');
  console.log('      TARTEEL_API_KEY=your_tarteel_token_here');
  console.log('      HUGGING_FACE_API_KEY=your_hf_token_here');
  console.log('\n📊 Features:');
  console.log('   ✅ Enhanced Arabic text processing');
  console.log('   ✅ Quran-specific transcription with Tarteel AI');
  console.log('   ✅ Intelligent word-by-word analysis');
  console.log('   ✅ Tashkeel (diacritics) accuracy measurement');
  console.log('   ✅ Detailed feedback in Arabic');
  console.log('   ✅ Automatic progression logic');
  console.log('   ✅ Audio format conversion (m4a to wav)');
  console.log('   ✅ Mobile-optimized CORS configuration');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  
  // Clean up temp files if any
  const tempDir = path.join(__dirname, 'temp');
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
      try {
        fs.unlinkSync(path.join(tempDir, file));
        console.log(`🧹 Cleaned up temp file: ${file}`);
      } catch (err) {
        console.error(`Error cleaning up ${file}:`, err.message);
      }
    });
  }
  
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  
  // Clean up temp files if any
  const tempDir = path.join(__dirname, 'temp');
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    files.forEach(file => {
      try {
        fs.unlinkSync(path.join(tempDir, file));
        console.log(`🧹 Cleaned up temp file: ${file}`);
      } catch (err) {
        console.error(`Error cleaning up ${file}:`, err.message);
      }
    });
  }
  
  process.exit(0);
});

// Additional utility endpoints for debugging and monitoring

// Get server statistics
app.get('/stats', (req, res) => {
  const stats = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    platform: process.platform,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    environment: {
      tarteelConfigured: !!TARTEEL_API_KEY,
      huggingFaceConfigured: !!HF_API_KEY,
      tempDirectoryExists: fs.existsSync(path.join(__dirname, 'temp')),
      pagesDirectoryExists: fs.existsSync(path.join(__dirname, 'pages'))
    }
  };
  
  res.json(stats);
});

// Test Arabic text processing
app.post('/test-arabic', (req, res) => {
  const { text1, text2 } = req.body;
  
  if (!text1 || !text2) {
    return res.status(400).json({
      error: 'Please provide text1 and text2 in request body'
    });
  }
  
  const result = {
    original: { text1, text2 },
    cleaned: {
      text1: ArabicTextProcessor.cleanText(text1),
      text2: ArabicTextProcessor.cleanText(text2)
    },
    withoutDiacritics: {
      text1: ArabicTextProcessor.removeDiacritics(text1),
      text2: ArabicTextProcessor.removeDiacritics(text2)
    },
    similarity: ArabicTextProcessor.calculateSimilarity(
      ArabicTextProcessor.removeDiacritics(text1),
      ArabicTextProcessor.removeDiacritics(text2)
    ),
    tashkeelAccuracy: ArabicTextProcessor.calculateTashkeelAccuracy(text1, text2),
    wordAnalysis: EnhancedComparison.analyzeWords(text1, text2)
  };
  
  res.json(result);
});

// Validate page data
app.get('/validate/pages/:pageNumber', (req, res) => {
  try {
    const pageNumber = parseInt(req.params.pageNumber);
    
    if (isNaN(pageNumber) || pageNumber < 1 || pageNumber > 604) {
      return res.status(400).json({
        error: 'Invalid page number. Must be between 1 and 604'
      });
    }
    
    const pageData = getDataPerPage(pageNumber);
    
    // Validate page structure
    const validation = {
      pageNumber: pageNumber,
      valid: true,
      issues: [],
      summary: {
        totalSurahs: pageData.surahs.length,
        totalAyahs: pageData.surahs.reduce((sum, surah) => sum + surah.ayahs.length, 0),
        totalWords: pageData.surahs.reduce((sum, surah) => 
          sum + surah.ayahs.reduce((ayahSum, ayah) => ayahSum + ayah.words.length, 0), 0
        )
      }
    };
    
    // Check for missing or invalid data
    pageData.surahs.forEach((surah, sIndex) => {
      if (!surah.surahNum || surah.surahNum < 1) {
        validation.issues.push(`Surah ${sIndex}: Invalid surah number`);
        validation.valid = false;
      }
      
      surah.ayahs.forEach((ayah, aIndex) => {
        if (!ayah.ayahNum || ayah.ayahNum < 1) {
          validation.issues.push(`Surah ${surah.surahNum}, Ayah ${aIndex}: Invalid ayah number`);
          validation.valid = false;
        }
        
        if (!ayah.words || ayah.words.length === 0) {
          validation.issues.push(`Surah ${surah.surahNum}, Ayah ${ayah.ayahNum}: No words found`);
          validation.valid = false;
        }
        
        ayah.words.forEach((word, wIndex) => {
          if (!word.text && word.text !== null) {
            validation.issues.push(`Surah ${surah.surahNum}, Ayah ${ayah.ayahNum}, Word ${wIndex}: Missing text`);
          }
          
          if (!word.code) {
            validation.issues.push(`Surah ${surah.surahNum}, Ayah ${ayah.ayahNum}, Word ${wIndex}: Missing code`);
          }
        });
      });
    });
    
    res.json(validation);
    
  } catch (error) {
    res.status(404).json({
      error: 'Page not found or invalid',
      details: error.message
    });
  }
});

// Batch validate multiple pages
app.post('/validate/pages/batch', (req, res) => {
  const { startPage = 1, endPage = 10 } = req.body;
  
  if (startPage < 1 || endPage > 604 || startPage > endPage) {
    return res.status(400).json({
      error: 'Invalid page range. startPage and endPage must be between 1 and 604'
    });
  }
  
  const results = [];
  let totalIssues = 0;
  
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    try {
      const pageData = getDataPerPage(pageNum);
      
      const validation = {
        pageNumber: pageNum,
        valid: true,
        issueCount: 0,
        summary: {
          totalSurahs: pageData.surahs.length,
          totalAyahs: pageData.surahs.reduce((sum, surah) => sum + surah.ayahs.length, 0),
          totalWords: pageData.surahs.reduce((sum, surah) => 
            sum + surah.ayahs.reduce((ayahSum, ayah) => ayahSum + ayah.words.length, 0), 0
          )
        }
      };
      
      // Quick validation - count issues without storing details
      pageData.surahs.forEach(surah => {
        if (!surah.surahNum || surah.surahNum < 1) {
          validation.issueCount++;
          validation.valid = false;
        }
        
        surah.ayahs.forEach(ayah => {
          if (!ayah.ayahNum || ayah.ayahNum < 1) {
            validation.issueCount++;
            validation.valid = false;
          }
          
          if (!ayah.words || ayah.words.length === 0) {
            validation.issueCount++;
            validation.valid = false;
          }
        });
      });
      
      totalIssues += validation.issueCount;
      results.push(validation);
      
    } catch (error) {
      results.push({
        pageNumber: pageNum,
        valid: false,
        error: error.message,
        issueCount: 1
      });
      totalIssues++;
    }
  }
  
  res.json({
    summary: {
      totalPages: endPage - startPage + 1,
      validPages: results.filter(r => r.valid).length,
      invalidPages: results.filter(r => !r.valid).length,
      totalIssues: totalIssues
    },
    results: results
  });
});
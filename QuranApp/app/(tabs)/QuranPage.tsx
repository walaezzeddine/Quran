import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Text,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  PixelRatio,
  Platform,
  StatusBar,
} from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
} from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const scaleFont = (size: number) => PixelRatio.roundToNearestPixel(size * (SCREEN_WIDTH / 375));

// Define types for Quran data
interface Word {
  code: string;
  text: string;
  indopak: string;
  lineNumber: number;
}

interface Ayah {
  ayahNum: number;
  words: Word[];
}

interface Surah {
  surahNum: number;
  ayahs: Ayah[];
}

interface QuranPage {
  hizb: number;
  juz: number;
  pageNumber: number;
  rub: number;
  surahs: Surah[];
}

// Interface for backend response
interface TranscriptionResponse {
  success: boolean;
  transcription: string;
  expected: string;
  comparison: {
    isCorrect: boolean;
    isFullCorrect: boolean;
    accuracy: number;
    feedback: string;
    details: {
      cleanTranscribed: string;
      cleanExpected: string;
    };
  };
  shouldProceed: boolean;
  processingTime: string;
}

export default function EnhancedQuranHorizontalScroll() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const router = useRouter();
  const { bottom, top } = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Audio and transcription states
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [comparisonResult, setComparisonResult] = useState<string>('');
  const audioPlayer = useAudioPlayer(recordedUri || '');
  
  // Page navigation and data states
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(604); // Total Quran pages
  const [quranPages, setQuranPages] = useState<{ [key: number]: QuranPage }>({});
  const [loading, setLoading] = useState<boolean>(false);
  
  // Current selection states
  const [currentSurah, setCurrentSurah] = useState<number>(1);
  const [currentAyah, setCurrentAyah] = useState<number>(1);
  const [currentWordId, setCurrentWordId] = useState<string | null>(null);
  const [hideWords, setHideWords] = useState<boolean>(false);
  
  // UI states
  const [showControls, setShowControls] = useState<boolean>(true);
  const [fontScale, setFontScale] = useState<number>(1);

  // Load initial pages
  useEffect(() => {
    loadPagesAround(1); // Start with page 1
  }, []);

  // Request permissions
  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('Permission Required', 'Microphone permission is required to record audio.');
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    })();
  }, []);

  const loadPagesAround = async (centerPage: number) => {
    setLoading(true);
    const pagesToLoad = [];
    
    // Load current page and surrounding pages for smooth scrolling
    for (let i = Math.max(1, centerPage - 2); i <= Math.min(totalPages, centerPage + 2); i++) {
      if (!quranPages[i]) {
        pagesToLoad.push(i);
      }
    }

    try {
      const pagePromises = pagesToLoad.map(async (pageNum) => {
        const response = await fetch(`http://192.168.100.151:3001/data/pages/${pageNum}`);
        if (!response.ok) throw new Error(`Failed to fetch page ${pageNum}`);
        const data: QuranPage = await response.json();
        return { pageNum, data };
      });

      const results = await Promise.all(pagePromises);
      const newPages = { ...quranPages };
      
      results.forEach(({ pageNum, data }) => {
        newPages[pageNum] = data;
      });
      
      setQuranPages(newPages);
      
      // Set initial selection for the first loaded page
      if (results.length > 0 && !currentSurah) {
        const firstPage = results[0].data;
        if (firstPage.surahs.length > 0 && firstPage.surahs[0].ayahs.length > 0) {
          setCurrentSurah(firstPage.surahs[0].surahNum);
          setCurrentAyah(firstPage.surahs[0].ayahs[0].ayahNum);
        }
      }
    } catch (error) {
      console.error('Error loading pages:', error);
      Alert.alert('Error', 'Failed to load Quran pages.');
    } finally {
      setLoading(false);
    }
  };

  const onPageChange = (pageIndex: number) => {
    const actualPageNum = pageIndex + 1;
    setCurrentPageIndex(pageIndex);
    loadPagesAround(actualPageNum);
    
    // Update current selection based on new page
    const pageData = quranPages[actualPageNum];
    if (pageData && pageData.surahs.length > 0) {
      const firstSurah = pageData.surahs[0];
      const firstAyah = firstSurah.ayahs[0];
      setCurrentSurah(firstSurah.surahNum);
      setCurrentAyah(firstAyah.ayahNum);
    }
  };

  const transcribeAudio = async (audioUri: string) => {
    if (!audioUri) {
      Alert.alert('Error', 'No audio file to transcribe');
      return;
    }

    const currentPageNum = currentPageIndex + 1;
    if (!currentSurah || !quranPages[currentPageNum] || !currentAyah) {
      Alert.alert('Error', 'Please ensure all required data is loaded.');
      return;
    }

    setIsTranscribing(true);
    setTranscription('');
    setComparisonResult('');

    try {
      const formData = new FormData();
      const fileUri = audioUri.startsWith('file://') ? audioUri : `file://${audioUri}`;
      const fileBlob = {
        uri: fileUri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any;
      formData.append('file', fileBlob);

      const apiUrl = `http://192.168.100.151:3001/transcribe?pageNumber=${currentPageNum}&ayah=${currentAyah}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const result: TranscriptionResponse = await response.json();
      setTranscription(result.transcription);

      const feedback = `
🎯 نتيجة التلاوة:
📊 الدقة: ${result.comparison.accuracy}%
📝 النص الأساسي: ${result.comparison.isCorrect ? '✅ صحيح' : '❌ غير صحيح'}
🔤 التشكيل: ${result.comparison.isFullCorrect ? '✅ مثالي' : '⚠️ يحتاج تحسين'}

💬 التعليق: ${result.comparison.feedback}

${result.shouldProceed ? '🎉 يمكنك الانتقال للآية التالية!' : '🔄 حاول مرة أخرى لتحسين الدقة'}
      `;

      setComparisonResult(feedback);

      if (result.shouldProceed) {
        moveToNextAyah();
      }

    } catch (error: any) {
      console.error('❌ Transcription failed:', error);
      Alert.alert('Transcription Error', `Failed to transcribe: ${error?.message}`);
      setTranscription('Transcription failed. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const moveToNextAyah = () => {
    const currentPageNum = currentPageIndex + 1;
    const pageData = quranPages[currentPageNum];
    if (!pageData) return;

    const currentSurahData = pageData.surahs.find(s => s.surahNum === currentSurah);
    if (currentSurahData) {
      const nextAyah = currentSurahData.ayahs.find(a => a.ayahNum === currentAyah + 1);
      if (nextAyah) {
        setCurrentAyah(currentAyah + 1);
      } else {
        // Move to next surah or next page
        const nextSurah = pageData.surahs.find(s => s.surahNum > currentSurah);
        if (nextSurah && nextSurah.ayahs.length > 0) {
          setCurrentSurah(nextSurah.surahNum);
          setCurrentAyah(nextSurah.ayahs[0].ayahNum);
        } else {
          Alert.alert('🎉 مبروك!', 'انتقل للصفحة التالية لمتابعة التلاوة');
        }
      }
    }
  };

  const startRecording = async () => {
    if (!currentSurah || !currentAyah) {
      Alert.alert('Error', 'Please select a Surah and Ayah first.');
      return;
    }

    try {
      setTranscription('');
      setComparisonResult('');
      await audioRecorder.prepareToRecordAsync();
      await audioRecorder.record();
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;

      if (uri) {
        const properUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        setRecordedUri(properUri);
        await transcribeAudio(properUri);
      } else {
        Alert.alert('Error', 'No recording URI available');
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to stop recording');
    }
  };

  const playRecording = async () => {
    if (!recordedUri) {
      Alert.alert('No Recording', 'Please record some audio first');
      return;
    }
    try {
      await audioPlayer.play();
    } catch (error) {
      console.error('Failed to play audio:', error);
      Alert.alert('Playback Error', 'Failed to play the recorded audio');
    }
  };

  const renderQuranPage = (pageData: QuranPage, pageIndex: number) => {
    // Flatten all words for line grouping
    const allWords = pageData.surahs.flatMap(surah =>
      surah.ayahs.flatMap(ayah =>
        ayah.words.map(word => ({
          ...word,
          ayahNum: ayah.ayahNum,
          surahNum: surah.surahNum,
        }))
      )
    );

    // Group words by their line number
    const lines: { [lineNumber: number]: typeof allWords } = {};
    allWords.forEach(word => {
      const line = word.lineNumber;
      if (!lines[line]) lines[line] = [];
      lines[line].push(word);
    });

    const sortedLineNumbers = Object.keys(lines)
      .map(Number)
      .sort((a, b) => a - b);

    return (
      <View key={pageIndex} style={styles.pageContainer}>
        {/* Page Header */}
        <LinearGradient
          colors={['rgba(210, 224, 229, 0.95)', '#b8cedbff', 'transparent']}
          style={styles.pageHeader}
        >
          <Text style={styles.pageHeaderText}>
            صفحة {pageData.pageNumber} - الجزء {pageData.juz}
          </Text>
          <Text style={styles.pageSubHeader}>
            Page {pageData.pageNumber} - Juz {pageData.juz}
          </Text>
        </LinearGradient>

        {/* Quran Text Lines */}
        <ScrollView 
          style={styles.textContainer}
          showsVerticalScrollIndicator={false}
          
          contentContainerStyle={styles.textContent}
        >
          {sortedLineNumbers.map(lineNum => (
            <View key={lineNum} style={styles.ayahLine}>
              {lines[lineNum].map(word =>
                word.text !== null ? (
                  <TouchableOpacity
                    key={word.code}
                    onPress={() => {
                      setCurrentSurah(word.surahNum);
                      setCurrentAyah(word.ayahNum);
                      setCurrentWordId(word.code);
                    }}
                  >
                    <Text
                      style={[
                        styles.word,
                        { fontSize: scaleFont(18 * fontScale) },
                        hideWords ? { color: 'transparent' } : {},
                        currentWordId === word.code ? styles.highlightedWord : {},
                        (currentSurah === word.surahNum && currentAyah === word.ayahNum) 
                          ? styles.currentAyahWord : {},
                      ]}
                    >
                      {hideWords ? '____' : word.text}
                    </Text>
                  </TouchableOpacity>
                ) : null
              )}
            </View>
          ))}
        </ScrollView>

        {/* Page Number Indicator */}
        <View style={styles.pageNumberContainer}>
          <Text style={styles.pageNumber}>{pageData.pageNumber}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#b8cedbff" translucent />
      
      {/* Main Horizontal ScrollView */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const pageIndex = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          onPageChange(pageIndex);
        }}
        style={styles.horizontalScroll}
        
      >
        {Array.from({ length: totalPages }, (_, index) => {
          const pageNum = index + 1;
          const pageData = quranPages[pageNum];
          
          if (!pageData) {
            return (
              <View key={index} style={styles.loadingPage}>
                <ActivityIndicator size="large" color="#b8cedbff" />
                <Text style={styles.loadingText}>Loading page {pageNum}...</Text>
              </View>
            );
          }
          
          return renderQuranPage(pageData, index);
        })}
      </ScrollView>

      {/* Floating Controls */}
      {showControls && (
        <View style={styles.floatingControls}>
          {/* Font Size Controls */}
          <View style={styles.fontControls}>
            <TouchableOpacity
              style={styles.fontButton}
              onPress={() => setFontScale(Math.max(0.7, fontScale - 0.1))}
            >
              <Text style={styles.fontButtonText}>A-</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fontButton}
              onPress={() => setFontScale(Math.min(1.5, fontScale + 0.1))}
            >
              <Text style={styles.fontButtonText}>A+</Text>
            </TouchableOpacity>
          </View>

          {/* Word Visibility Toggle */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => setHideWords(!hideWords)}
          >
            <Ionicons 
              name={hideWords ? 'eye-off' : 'eye'} 
              size={24} 
              color="#6798b4ff" 
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Transcription Results */}
      {(transcription || isTranscribing || comparisonResult) && (
        <View style={styles.transcriptionPanel}>
          <Text style={styles.transcriptionTitle}>نتيجة التلاوة</Text>
          {isTranscribing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#6798b4ff" />
              <Text style={styles.loadingText}>جاري التحليل...</Text>
            </View>
          ) : (
            <>
              {transcription && (
                <View style={styles.transcriptionBox}>
                  <Text style={styles.transcriptionLabel}>النص المسجل:</Text>
                  <Text style={styles.transcriptionText}>{transcription}</Text>
                </View>
              )}
              {comparisonResult && (
                <Text style={styles.comparisonText}>{comparisonResult}</Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Back Button */}
      <TouchableOpacity 
        style={[styles.backButton, { top: top + 10 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Controls Toggle */}
      <TouchableOpacity
        style={[styles.controlsToggle, { top: top + 10 }]}
        onPress={() => setShowControls(!showControls)}
      >
        <Ionicons name="settings" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Recording Controls */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)']}
        style={[styles.recordingControls, { paddingBottom: bottom + 20 }]}
      >
        <View style={styles.controlsRow}>
          <TouchableOpacity
            onPress={recorderState.isRecording ? stopRecording : startRecording}
            style={[
              styles.recordButton,
              recorderState.isRecording ? styles.recordingButton : styles.notRecordingButton,
            ]}
            disabled={isTranscribing}
          >
            <Ionicons
              name={recorderState.isRecording ? 'stop' : 'mic'}
              size={32}
              color="white"
            />
          </TouchableOpacity>
          
          {recordedUri && (
            <TouchableOpacity
              onPress={playRecording}
              style={styles.playButton}
              disabled={isTranscribing}
            >
              <Ionicons name="play" size={24} color="#6798b4ff" />
            </TouchableOpacity>
          )}
        </View>

        {recorderState.isRecording && (
          <Text style={styles.recordingIndicator}>🔴 جاري التسجيل...</Text>
        )}
        
        <Text style={styles.currentInfo}>
          السورة {currentSurah} - الآية {currentAyah}
        </Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#d4e0e7ff',
  },
  horizontalScroll: {
    flex: 1,
    
  },
  pageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
  },
  loadingPage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#b8cedbff',
  },
  pageHeader: {
    paddingTop: 80,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  pageHeaderText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  pageSubHeader: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 4,
  },
  textContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  textContent: {
    paddingVertical: 20,
    justifyContent: 'center',
    minHeight: SCREEN_HEIGHT * 0.6,
  },
  ayahLine: {
    flexDirection: 'row-reverse',
    flexWrap: 'nowrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SCREEN_HEIGHT * 0.015,
    paddingHorizontal: 10,
  },
  word: {
    color: '#1a365d',
    marginHorizontal: 2,
    lineHeight: scaleFont(45),
    writingDirection: 'rtl',
    textAlign: 'center',
    fontFamily: 'qaloon.10',
    fontWeight: '400',
    textShadowColor: 'rgba(0,0,0,0.1)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
  highlightedWord: {
    backgroundColor: 'rgba(255, 215, 0, 0.6)',
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  currentAyahWord: {
    backgroundColor: 'rgba(44, 85, 48, 0.1)',
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(44, 85, 48, 0.3)',
  },
  pageNumberContainer: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: 'rgba(44, 85, 48, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pageNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6798b4ff',
  },
  floatingControls: {
    position: 'absolute',
    top: 120,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 15,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fontControls: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  fontButton: {
    backgroundColor: '#6798b4ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  fontButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  controlButton: {
    backgroundColor: 'rgba(44, 85, 48, 0.1)',
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  transcriptionPanel: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 140,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderLeftWidth: 4,
    borderLeftColor: '#6798b4ff',
  },
  transcriptionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#6798b4ff',
    textAlign: 'center',
  },
  transcriptionBox: {
    backgroundColor: '#b8cedbff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  transcriptionLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  transcriptionText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#333',
    textAlign: 'right',
  },
  comparisonText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#6798b4ff',
    textAlign: 'right',
  },
  loadingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginLeft: 8,
    color: '#666',
    fontSize: 14,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    backgroundColor: '#6798b4ff',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  controlsToggle: {
    position: 'absolute',
    right: 20,
    backgroundColor: '#6798b4ff',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  recordingControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 20,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    marginBottom: 10,
  },
  recordButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  recordingButton: {
    backgroundColor: '#e74c3c',
  },
  notRecordingButton: {
    backgroundColor: '#6798b4ff',
  },
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#6798b4ff',
  },
  recordingIndicator: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 5,
  },
  currentInfo: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    backgroundColor: '#6798b4ff',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  

  
});
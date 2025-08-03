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

// Enhanced interface for Tarteel transcription response
interface EnhancedTranscriptionResponse {
  success: boolean;
  transcription: string;
  expected: string;
  comparison: {
    isCorrect: boolean;
    isFullCorrect: boolean;
    accuracy: number;
    tashkeelAccuracy: number;
    feedback: string;
    detailedFeedback: string;
    wordAnalysis: {
      correctWords: number;
      totalWords: number;
      wordAccuracy: number;
      partialAccuracy: number;
      wordAnalysis: Array<{
        transcribed: string;
        expected: string;
        isCorrect: boolean;
        similarity: number;
        tashkeelAccuracy: number;
        status: string;
      }>;
    };
    recommendation: string;
  };
  shouldProceed: boolean;
  processingTime: string;
  modelUsed: string;
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
  const [expectedText, setExpectedText] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [comparisonResult, setComparisonResult] = useState<string>('');
  const [lastTranscriptionResult, setLastTranscriptionResult] = useState<EnhancedTranscriptionResponse | null>(null);
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
  
  // Progressive Display States - NEW
  const [completedAyahs, setCompletedAyahs] = useState<Set<string>>(new Set());
  const [currentTargetAyah, setCurrentTargetAyah] = useState<{surah: number, ayah: number} | null>(null);
  
  // Study Mode Toggle - NEW
  const [isStudyMode, setIsStudyMode] = useState<boolean>(false);
  
  // UI states
  const [showControls, setShowControls] = useState<boolean>(true);
  const [fontScale, setFontScale] = useState<number>(1);
  const [showTranscriptionPanel, setShowTranscriptionPanel] = useState<boolean>(false);

  // Load initial pages
  useEffect(() => {
    loadPagesAround(1); // Start with page 1
  }, []);

  // Set initial target ayah when page loads
  useEffect(() => {
    if (quranPages[currentPageIndex + 1] && !currentTargetAyah) {
      const pageData = quranPages[currentPageIndex + 1];
      if (pageData.surahs.length > 0 && pageData.surahs[0].ayahs.length > 0) {
        const firstSurah = pageData.surahs[0];
        const firstAyah = firstSurah.ayahs[0];
        setCurrentTargetAyah({ surah: firstSurah.surahNum, ayah: firstAyah.ayahNum });
        setCurrentSurah(firstSurah.surahNum);
        setCurrentAyah(firstAyah.ayahNum);
      }
    }
  }, [quranPages, currentPageIndex]);

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
        const response = await fetch(`http://192.168.100.248:3001/data/pages/${pageNum}`);
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
    
    // Update current target ayah based on new page
    const pageData = quranPages[actualPageNum];
    if (pageData && pageData.surahs.length > 0) {
      // Find the first uncompleted ayah on this page
      let foundTarget = false;
      
      for (const surah of pageData.surahs) {
        for (const ayah of surah.ayahs) {
          const ayahKey = `${surah.surahNum}-${ayah.ayahNum}`;
          if (!completedAyahs.has(ayahKey)) {
            setCurrentTargetAyah({ surah: surah.surahNum, ayah: ayah.ayahNum });
            setCurrentSurah(surah.surahNum);
            setCurrentAyah(ayah.ayahNum);
            foundTarget = true;
            break;
          }
        }
        if (foundTarget) break;
      }
      
      // If all ayahs on this page are completed, set to first ayah
      if (!foundTarget) {
        const firstSurah = pageData.surahs[0];
        const firstAyah = firstSurah.ayahs[0];
        setCurrentTargetAyah({ surah: firstSurah.surahNum, ayah: firstAyah.ayahNum });
        setCurrentSurah(firstSurah.surahNum);
        setCurrentAyah(firstAyah.ayahNum);
      }
    }
  };

  // Helper function to get current ayah text with tashkeel
  const getCurrentAyahText = (): string => {
    const currentPageNum = currentPageIndex + 1;
    const pageData = quranPages[currentPageNum];
    
    if (!pageData) return '';
    
    for (const surah of pageData.surahs) {
      const ayahData = surah.ayahs.find(a => a.ayahNum === currentAyah);
      if (ayahData) {
        return ayahData.words
          .filter(word => word.text && word.text.trim() !== '')
          .map(word => word.text)
          .join(' ');
      }
    }
    
    return '';
  };

  // Check if an ayah should be visible
  const isAyahVisible = (surahNum: number, ayahNum: number): boolean => {
    // In study mode, show everything
    if (isStudyMode) return true;
    
    // In recitation mode, only show completed ayahs
    const ayahKey = `${surahNum}-${ayahNum}`;
    return completedAyahs.has(ayahKey);
  };

  // Check if an ayah is the current target (for highlighting purposes)
  const isCurrentTarget = (surahNum: number, ayahNum: number): boolean => {
    return currentTargetAyah?.surah === surahNum && currentTargetAyah?.ayah === ayahNum;
  };

  // Enhanced transcription function with progressive display logic
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
    setExpectedText('');
    setComparisonResult('');
    setShowTranscriptionPanel(true);

    try {
      const formData = new FormData();
      const fileUri = audioUri.startsWith('file://') ? audioUri : `file://${audioUri}`;
      const fileBlob = {
        uri: fileUri,
        type: 'audio/m4a',
        name: 'recording.m4a',
      } as any;
      formData.append('file', fileBlob);

      const apiUrl = `http://192.168.100.248:3001/transcribe?pageNumber=${currentPageNum}&ayah=${currentAyah}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      const result: EnhancedTranscriptionResponse = await response.json();
      
      setTranscription(result.transcription);
      setExpectedText(result.expected);
      setLastTranscriptionResult(result);

      // Enhanced feedback display
      const feedback = formatEnhancedFeedback(result);
      setComparisonResult(feedback);

      // Progressive display logic - NEW
      if (result.shouldProceed && result.comparison.accuracy >= 80) {
        // Mark current ayah as completed
        const ayahKey = `${currentSurah}-${currentAyah}`;
        const newCompletedAyahs = new Set(completedAyahs);
        newCompletedAyahs.add(ayahKey);
        setCompletedAyahs(newCompletedAyahs);

        // Auto-proceed to next ayah after a delay
        setTimeout(() => {
          moveToNextAyah();
        }, 2000);
      } else {
        // Show correction message for failed attempts
        setTimeout(() => {
          Alert.alert(
            '🎯 تحسين التلاوة',
            'يرجى إعادة التلاوة لتحسين الدقة. استمع جيداً للنطق الصحيح وحاول مرة أخرى.',
            [
              {
                text: 'حاول مرة أخرى',
                style: 'default',
                onPress: () => setShowTranscriptionPanel(false)
              },
              {
                text: 'عرض التفاصيل',
                style: 'cancel'
              }
            ]
          );
        }, 1500);
      }

    } catch (error: any) {
      console.error('❌ Transcription failed:', error);
      Alert.alert('خطأ في التحليل', `فشل في تحليل الصوت: ${error?.message}`);
      setTranscription('فشل التحليل. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsTranscribing(false);
    }
  };

  // Function to format enhanced feedback
  const formatEnhancedFeedback = (result: EnhancedTranscriptionResponse): string => {
    const { comparison } = result;
    
    let feedback = `🕌 نتيجة التلاوة - نموذج Tarteel\n\n`;
    
    // Success or failure message
    if (result.shouldProceed && comparison.accuracy >= 80) {
      feedback += `🎉 ممتاز! تلاوة صحيحة\n\n`;
    } else {
      feedback += `🎯 يحتاج تحسين\n\n`;
    }
    
    // Main feedback
    feedback += `${comparison.feedback}\n\n`;
    
    // Accuracy breakdown
    feedback += `📊 تحليل مفصل:\n`;
    feedback += `• الدقة العامة: ${comparison.accuracy}%\n`;
    feedback += `• دقة التشكيل: ${comparison.tashkeelAccuracy}%\n`;
    feedback += `• دقة الكلمات: ${comparison.wordAnalysis.wordAccuracy}%\n`;
    feedback += `• الكلمات الصحيحة: ${comparison.wordAnalysis.correctWords}/${comparison.wordAnalysis.totalWords}\n\n`;
    
    // Detailed feedback if available
    if (comparison.detailedFeedback) {
      feedback += `📝 تفاصيل إضافية:\n${comparison.detailedFeedback}\n`;
    }
    
    // Word-level analysis for incorrect words
    const incorrectWords = comparison.wordAnalysis.wordAnalysis
      .filter(w => !w.isCorrect && w.expected)
      .slice(0, 3);
    
    if (incorrectWords.length > 0) {
      feedback += `\n🎯 كلمات تحتاج مراجعة:\n`;
      incorrectWords.forEach(word => {
        feedback += `• "${word.expected}" (دقة: ${word.similarity}%)\n`;
      });
    }
    
    // Recommendation
    feedback += `\n💡 التوصية: ${comparison.recommendation}\n`;
    
    // Status
    if (result.shouldProceed && comparison.accuracy >= 80) {
      feedback += `\n✅ تم قبول التلاوة! الانتقال للآية التالية...`;
    } else {
      feedback += `\n🔄 حاول مرة أخرى لتحسين الدقة`;
    }
    
    // Processing info
    feedback += `\n\n⏱️ وقت المعالجة: ${result.processingTime}`;
    
    return feedback;
  };

  const moveToNextAyah = () => {
    const currentPageNum = currentPageIndex + 1;
    const pageData = quranPages[currentPageNum];
    if (!pageData) return;

    // Find next uncompleted ayah on current page
    let foundNext = false;
    
    for (const surah of pageData.surahs) {
      for (const ayah of surah.ayahs) {
        const ayahKey = `${surah.surahNum}-${ayah.ayahNum}`;
        const isCurrentTarget = currentTargetAyah?.surah === surah.surahNum && 
                               currentTargetAyah?.ayah === ayah.ayahNum;
        
        if (!completedAyahs.has(ayahKey) && !isCurrentTarget) {
          setCurrentTargetAyah({ surah: surah.surahNum, ayah: ayah.ayahNum });
          setCurrentSurah(surah.surahNum);
          setCurrentAyah(ayah.ayahNum);
          setShowTranscriptionPanel(false);
          foundNext = true;
          break;
        }
      }
      if (foundNext) break;
    }

    if (!foundNext) {
      // All ayahs on this page are completed
      Alert.alert(
        '🎉 مبروك!', 
        'تم إكمال جميع آيات هذه الصفحة!\nانتقل للصفحة التالية لمتابعة التلاوة.',
        [
          {
            text: 'البقاء في الصفحة',
            style: 'cancel'
          },
          {
            text: 'الصفحة التالية',
            onPress: () => {
              if (currentPageIndex < totalPages - 1) {
                scrollViewRef.current?.scrollTo({
                  x: (currentPageIndex + 1) * SCREEN_WIDTH,
                  animated: true
                });
              }
            }
          }
        ]
      );
      setShowTranscriptionPanel(false);
    }
  };

  const startRecording = async () => {
    if (!currentSurah || !currentAyah) {
      Alert.alert('Error', 'Please select a Surah and Ayah first.');
      return;
    }

    // Check if current ayah is the target ayah
    if (!currentTargetAyah || 
        currentTargetAyah.surah !== currentSurah || 
        currentTargetAyah.ayah !== currentAyah) {
      Alert.alert(
        'خطأ في الاختيار',
        `يرجى تسجيل الآية المطلوبة: السورة ${currentTargetAyah?.surah} - الآية ${currentTargetAyah?.ayah}`
      );
      return;
    }

    try {
      setTranscription('');
      setExpectedText('');
      setComparisonResult('');
      setShowTranscriptionPanel(false);
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

  // Enhanced word highlighting with progressive display
  const getWordStyle = (word: any, surahNum: number, ayahNum: number) => {
    const isVisible = isAyahVisible(surahNum, ayahNum);
    const isTarget = isCurrentTarget(surahNum, ayahNum);
    const isCompleted = completedAyahs.has(`${surahNum}-${ayahNum}`);
    
    let baseStyle = [
      styles.word,
      { fontSize: scaleFont(18 * fontScale) },
      !isVisible ? styles.hiddenWord : {},
      currentWordId === word.code ? styles.highlightedWord : {},
      isTarget && !isStudyMode ? styles.targetAyahWord : {},
      isCompleted ? styles.completedAyahWord : {},
    ];

    // Add styling based on transcription results for current target ayah
    if (lastTranscriptionResult && isTarget && !isStudyMode) {
      const wordAnalysis = lastTranscriptionResult.comparison.wordAnalysis.wordAnalysis.find(
        w => w.expected === word.text
      );
      
      if (wordAnalysis) {
        if (wordAnalysis.isCorrect && wordAnalysis.similarity >= 95) {
          baseStyle.push(styles.perfectWord);
        } else if (wordAnalysis.isCorrect) {
          baseStyle.push(styles.goodWord);
        } else if (wordAnalysis.similarity >= 70) {
          baseStyle.push(styles.partialWord);
        } else {
          baseStyle.push(styles.incorrectWord);
        }
      }
    }

    return baseStyle;
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
          
          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              {isStudyMode ? 
                '👁️ وضع المراجعة - جميع الآيات مكشوفة' : 
                `🎯 وضع التلاوة - آيات مكتملة: ${Array.from(completedAyahs).filter(key => {
                  const [surah, ayah] = key.split('-').map(Number);
                  return pageData.surahs.some(s => 
                    s.surahNum === surah && s.ayahs.some(a => a.ayahNum === ayah)
                  );
                }).length}`
              }
            </Text>
          </View>
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
                    <Text style={getWordStyle(word, word.surahNum, word.ayahNum)}>
                      {!isAyahVisible(word.surahNum, word.ayahNum) ? '____' : word.text}
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

  // Enhanced transcription panel with correction guidance
  const renderTranscriptionResults = () => {
    if (!showTranscriptionPanel) return null;
    
    const isSuccessful = lastTranscriptionResult?.shouldProceed && 
                        (lastTranscriptionResult?.comparison.accuracy ?? 0) >= 80;
    
    return (
      <View style={[styles.transcriptionPanel, isSuccessful ? styles.successPanel : styles.correctionPanel]}>
        <TouchableOpacity 
          style={styles.closeButton}
          onPress={() => setShowTranscriptionPanel(false)}
        >
          <Ionicons name="close" size={16} color="#666" />
        </TouchableOpacity>
        
        <View style={[styles.modelBadge, isSuccessful ? styles.successBadge : styles.warningBadge]}>
          <Text style={styles.modelText}>
            {isSuccessful ? '✅ Tarteel AI' : '🎯 Tarteel AI'}
          </Text>
        </View>
        
        <Text style={styles.transcriptionTitle}>
          {isSuccessful ? 'تلاوة ممتازة!' : 'تحسين التلاوة'}
        </Text>
        
        <ScrollView 
          style={styles.transcriptionContent}
          showsVerticalScrollIndicator={false}
        >
          {isTranscribing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6798b4ff" />
              <Text style={styles.loadingText}>جاري التحليل بنموذج Tarteel...</Text>
            </View>
          ) : (
            <>
              {transcription && (
                <View style={[styles.transcriptionBox, !isSuccessful && styles.correctionBox]}>
                  <Text style={styles.transcriptionLabel}>النص المسجل:</Text>
                  <Text style={styles.transcriptionText}>{transcription}</Text>
                </View>
              )}
              
              {expectedText && (
                <View style={styles.expectedBox}>
                  <Text style={styles.transcriptionLabel}>النص الصحيح:</Text>
                  <Text style={styles.expectedText}>{expectedText}</Text>
                </View>
              )}
              
              {lastTranscriptionResult && (
                <View style={styles.accuracyContainer}>
                  <View style={[styles.accuracyBadge, isSuccessful ? styles.successAccuracy : styles.warningAccuracy]}>
                    <Text style={styles.accuracyText}>
                      دقة عامة: {lastTranscriptionResult.comparison.accuracy}%
                    </Text>
                  </View>
                  <View style={styles.tashkeelBadge}>
                    <Text style={styles.accuracyText}>
                      دقة التشكيل: {lastTranscriptionResult.comparison.tashkeelAccuracy}%
                    </Text>
                  </View>
                </View>
              )}
              
              {comparisonResult && (
                <Text style={styles.comparisonText}>{comparisonResult}</Text>
              )}
              
              {!isSuccessful && (
                <View style={styles.correctionGuidance}>
                  <Text style={styles.correctionTitle}>📚 نصائح للتحسين:</Text>
                  <Text style={styles.correctionText}>
                    • استمع للنطق الصحيح جيداً{'\n'}
                    • تأكد من وضوح مخارج الحروف{'\n'}
                    • اقرأ بتأني وبوضوح{'\n'}
                    • راجع التشكيل والتجويد
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </View>
    );
  };

  // Enhanced recording button with target indication
  const renderRecordingButton = () => {
    const getButtonColor = () => {
      if (isTranscribing) return '#ffc107';
      if (recorderState.isRecording) return '#dc3545';
      return '#6798b4ff';
    };
    
    const getButtonIcon = () => {
      if (isTranscribing) return 'hourglass';
      if (recorderState.isRecording) return 'stop';
      return 'mic';
    };
    
    return (
      <TouchableOpacity
        onPress={recorderState.isRecording ? stopRecording : startRecording}
        style={[styles.recordButton, { backgroundColor: getButtonColor() }]}
        disabled={isTranscribing}
      >
        <Ionicons name={getButtonIcon()} size={32} color="white" />
        {isTranscribing && (
          <ActivityIndicator 
            size="small" 
            color="white" 
            style={{ position: 'absolute' }}
          />
        )}
      </TouchableOpacity>
    );
  };

  // Enhanced status display with target indication
  const renderEnhancedStatus = () => {
    return (
      <View style={styles.statusContainer}>
        {recorderState.isRecording && (
          <Text style={styles.recordingIndicator}>
            🔴 جاري التسجيل... {Math.floor((recorderState.durationMillis || 0) / 1000)}s
          </Text>
        )}
        
        {isTranscribing && (
          <Text style={styles.processingIndicator}>
            ⚡ جاري التحليل بنموذج Tarteel...
          </Text>
        )}
        
        <View style={styles.currentInfoContainer}>
          <Text style={styles.currentInfo}>
            🎯 الآية المطلوبة: السورة {currentTargetAyah?.surah} - الآية {currentTargetAyah?.ayah}
          </Text>
          <Text style={styles.currentInfoSub}>
            صفحة {currentPageIndex + 1} | مكتمل: {completedAyahs.size} آية | وضع التلاوة
          </Text>
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

          {/* Study/Recitation Mode Toggle */}
          <TouchableOpacity
            style={[styles.controlButton, isStudyMode ? styles.studyModeActive : styles.recitationModeActive]}
            onPress={() => {
              setIsStudyMode(!isStudyMode);
              // Clear transcription panel when switching modes
              setShowTranscriptionPanel(false);
              setLastTranscriptionResult(null);
            }}
          >
            <Ionicons 
              name={isStudyMode ? 'eye-off' : 'eye'} 
              size={24} 
              color={isStudyMode ? '#28a745' : '#6798b4ff'} 
            />
          </TouchableOpacity>
          {/* Reset Progress Button */}
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => {
              Alert.alert(
                'إعادة تعيين التقدم',
                'هل تريد إعادة تعيين جميع الآيات المكتملة؟',
                [
                  { text: 'إلغاء', style: 'cancel' },
                  { 
                    text: 'إعادة تعيين', 
                    style: 'destructive',
                    onPress: () => {
                      setCompletedAyahs(new Set());
                      setLastTranscriptionResult(null);
                      setShowTranscriptionPanel(false);
                      setIsStudyMode(false); // Return to recitation mode
                      // Reset to first ayah of current page
                      const currentPageNum = currentPageIndex + 1;
                      const pageData = quranPages[currentPageNum];
                      if (pageData && pageData.surahs.length > 0) {
                        const firstSurah = pageData.surahs[0];
                        const firstAyah = firstSurah.ayahs[0];
                        setCurrentTargetAyah({ surah: firstSurah.surahNum, ayah: firstAyah.ayahNum });
                        setCurrentSurah(firstSurah.surahNum);
                        setCurrentAyah(firstAyah.ayahNum);
                      }
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="refresh" size={24} color="#6798b4ff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Enhanced Transcription Results - Only show in recitation mode */}
      {!isStudyMode && renderTranscriptionResults()}

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

      {/* Recording Controls - Only show in recitation mode */}
      {!isStudyMode && (
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.3)']}
          style={[styles.recordingControls, { paddingBottom: bottom + 20 }]}
        >
          <View style={styles.controlsRow}>
            {renderRecordingButton()}
            
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

          {renderEnhancedStatus()}
        </LinearGradient>
      )}
      
      {/* Study Mode Indicator */}
      {isStudyMode && (
        <View style={[styles.studyModeIndicator, { bottom: bottom + 20 }]}>
          <Text style={styles.studyModeText}>
            👁️ وضع المراجعة نشط - اضغط على أيقونة العين للعودة لوضع التلاوة
          </Text>
        </View>
      )}
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
  progressContainer: {
    marginTop: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  progressText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
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
  // Progressive display styles - NEW
  hiddenWord: {
    color: 'rgba(26, 54, 93, 0.2)',
    backgroundColor: 'rgba(184, 206, 219, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  targetAyahWord: {
    backgroundColor: 'rgba(255, 193, 7, 0.3)',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 193, 7, 0.6)',
    paddingHorizontal: 3,
    paddingVertical: 1,
    shadowColor: '#ffc107',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  completedAyahWord: {
    backgroundColor: 'rgba(40, 167, 69, 0.2)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(40, 167, 69, 0.4)',
  },
  highlightedWord: {
    backgroundColor: 'rgba(255, 215, 0, 0.6)',
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  // Enhanced word highlighting based on transcription results
  perfectWord: {
    backgroundColor: 'rgba(40, 167, 69, 0.3)',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(40, 167, 69, 0.6)',
    shadowColor: '#28a745',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
  },
  goodWord: {
    backgroundColor: 'rgba(255, 193, 7, 0.3)',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 193, 7, 0.6)',
    shadowColor: '#ffc107',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
  },
  partialWord: {
    backgroundColor: 'rgba(255, 152, 0, 0.3)',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255, 152, 0, 0.6)',
  },
  incorrectWord: {
    backgroundColor: 'rgba(220, 53, 69, 0.3)',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(220, 53, 69, 0.6)',
    shadowColor: '#dc3545',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
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
    marginBottom: 8,
  },
  studyModeActive: {
    backgroundColor: 'rgba(40, 167, 69, 0.2)',
    borderWidth: 2,
    borderColor: '#28a745',
  },
  recitationModeActive: {
    backgroundColor: 'rgba(103, 152, 180, 0.2)',
    borderWidth: 2,
    borderColor: '#6798b4ff',
  },
  studyModeIndicator: {
    position: 'absolute',
    left: 15,
    right: 15,
    backgroundColor: 'rgba(40, 167, 69, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  studyModeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Enhanced Transcription Panel Styles
  transcriptionPanel: {
    position: 'absolute',
    left: 15,
    right: 15,
    top: 120,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 20,
    padding: 20,
    maxHeight: SCREEN_HEIGHT * 0.65,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    borderLeftWidth: 5,
    borderLeftColor: '#6798b4ff',
  },
  successPanel: {
    borderLeftColor: '#28a745',
    backgroundColor: 'rgba(248, 255, 248, 0.98)',
  },
  correctionPanel: {
    borderLeftColor: '#ffc107',
    backgroundColor: 'rgba(255, 252, 240, 0.98)',
  },
  transcriptionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#6798b4ff',
    textAlign: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(103, 152, 180, 0.3)',
  },
  transcriptionContent: {
    maxHeight: SCREEN_HEIGHT * 0.45,
  },
  transcriptionBox: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  correctionBox: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffeaa7',
  },
  expectedBox: {
    backgroundColor: '#d4edda',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#c3e6cb',
  },
  transcriptionLabel: {
    fontSize: 12,
    color: '#6c757d',
    marginBottom: 8,
    fontWeight: '600',
  },
  transcriptionText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#212529',
    textAlign: 'right',
    fontFamily: Platform.OS === 'ios' ? 'qaloon.10' : undefined,
  },
  expectedText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#155724',
    textAlign: 'right',
    fontFamily: Platform.OS === 'ios' ? 'qaloon.10' : undefined,
    fontWeight: '500',
  },
  comparisonText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#495057',
    textAlign: 'right',
  },
  accuracyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  accuracyBadge: {
    backgroundColor: '#6798b4ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
    flex: 1,
    marginRight: 8,
  },
  successAccuracy: {
    backgroundColor: '#28a745',
  },
  warningAccuracy: {
    backgroundColor: '#ffc107',
  },
  tashkeelBadge: {
    backgroundColor: '#28a745',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
    flex: 1,
    marginLeft: 8,
  },
  accuracyText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    left: 15,
    backgroundColor: 'rgba(0,0,0,0.1)',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  modelBadge: {
    backgroundColor: '#28a745',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-end',
    marginBottom: 10,
  },
  successBadge: {
    backgroundColor: '#28a745',
  },
  warningBadge: {
    backgroundColor: '#ffc107',
  },
  modelText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
  correctionGuidance: {
    backgroundColor: '#e7f3ff',
    padding: 15,
    borderRadius: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#b3d9ff',
  },
  correctionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0056b3',
    marginBottom: 8,
  },
  correctionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#004085',
    textAlign: 'right',
  },
  loadingContainer: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 30,
  },
  loadingText: {
    marginTop: 15,
    color: '#6798b4ff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
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
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#6798b4ff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  // Enhanced Status Styles
  statusContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  recordingIndicator: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#dc3545',
    textAlign: 'center',
    marginBottom: 5,
    backgroundColor: 'rgba(220, 53, 69, 0.1)',
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 15,
  },
  processingIndicator: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffc107',
    textAlign: 'center',
    marginBottom: 8,
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    paddingHorizontal: 15,
    paddingVertical: 6,
    borderRadius: 15,
  },
  currentInfoContainer: {
    alignItems: 'center',
    backgroundColor: '#6798b4ff',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  currentInfo: {
    fontSize: 16,
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
  currentInfoSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
    fontWeight: '400',
  },
});
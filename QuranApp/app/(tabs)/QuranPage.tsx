import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, Text, ScrollView, ActivityIndicator } from 'react-native';
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
import { Picker } from '@react-native-picker/picker';

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

interface QuranPageProps {
  pageNumber: number; // Prop to specify which page to load
}

export default function QuranPageComponent() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [selectedSurah, setSelectedSurah] = useState<number>(1);
  const [quranData, setQuranData] = useState<QuranPage | null>(null);
  const [comparisonResult, setComparisonResult] = useState<string>('');
  const audioPlayer = useAudioPlayer(recordedUri || '');
  const [pageNumber, setPageNumber] = useState<number>(1); // Default to page 1
  const [ayah, setAyah] = useState<number | undefined>(1);

useEffect(() => {
  // Don't fetch if pageNumber is undefined or invalid
  if (!pageNumber || pageNumber < 1) {
    return;
  }

  const fetchQuranData = async () => {
    try {
      const apiUrl = `http://192.168.100.151:3001/data/pages/${pageNumber}`;
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch page ${pageNumber}: ${response.status}`);
      }
      const data: QuranPage = await response.json();
      setQuranData(data);
      
      // Set default Surah (first Surah on the page)
      if (data.surahs.length > 0 && data.surahs[0].ayahs.length > 0) {
        const firstSurah = data.surahs[0];
        const firstAyah = firstSurah.ayahs[0];
        
        setSelectedSurah(firstSurah.surahNum);
        setAyah(firstAyah.ayahNum);
        
        console.log('Selected Surah:', firstSurah.surahNum);
        console.log('Selected Ayah:', firstAyah.ayahNum);
      }
      
      console.log('Quran data fetched successfully:', data);
    } catch (error) {
      console.error('Error fetching Quran data:', error);
      Alert.alert('Error', 'Failed to load Quran page data.');
    }
  };

  fetchQuranData();
}, [pageNumber]);

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

  // Compare transcription with selected Surah's text
  const compareTranscription = (transcribedText: string, surah: Surah) => {
    // Concatenate all words in the Surah for comparison
    const surahText = surah.ayahs
      .flatMap(ayah => ayah.words
        .filter(word => !/^\d+$/.test(word.text)) // Exclude ayah numbers
        .map(word => word.text))
      .join(' ');

    // Simple comparison (you can enhance with a more sophisticated algorithm)
    const transcribedWords = transcribedText.trim().split(/\s+/);
    const surahWords = surahText.trim().split(/\s+/);
    
    let correctWords = 0;
    const minLength = Math.min(transcribedWords.length, surahWords.length);
    
    for (let i = 0; i < minLength; i++) {
      if (transcribedWords[i] === surahWords[i]) {
        correctWords++;
      }
    }

    const accuracy = (correctWords / surahWords.length) * 100;
    return `Accuracy: ${accuracy.toFixed(2)}% (${correctWords}/${surahWords.length} words correct)`;
  };

  const transcribeAudio = async (audioUri: string) => {
    if (!audioUri) {
      Alert.alert('Error', 'No audio file to transcribe');
      return;
    }

    if (!selectedSurah || !quranData) {
      Alert.alert('Error', 'Please select a Surah and ensure Quran data is loaded.');
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

      const apiUrl = `http://192.168.100.151:3001/transcribe?page=1&ayah=1`;
    

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      console.log('Transcription response:', response);
      

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.text();
      setTranscription(result);
      setAyah(prev => prev!+1 || prev)
      console.log('new ayah', ayah);
      
      // Find the selected Surah
      const surah = quranData.surahs.find(s => s.surahNum === selectedSurah);
      if (surah) {
        const comparison = compareTranscription(result, surah);
        setComparisonResult(comparison);
      } else {
        setComparisonResult('Selected Surah not found.');
      }

    } catch (error) {
      console.error('Transcription failed:', error);
      Alert.alert('Transcription Error', 'Failed to transcribe the audio. Please try again.');
      setTranscription('Transcription failed. Please try again.');
      setComparisonResult('Comparison failed due to transcription error.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    if (!selectedSurah) {
      Alert.alert('Error', 'Please select a Surah to record.');
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

  const renderAyah = (ayah: Ayah) => {
    return (
      <View key={ayah.ayahNum} style={styles.ayahContainer}>
        <View style={styles.ayahContent}>
          <Text style={styles.ayahText}>
            {ayah.words.map((word, index) => (
              <Text key={word.code} style={styles.arabicWord}>
                {word.text}{index < ayah.words.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>
          <View style={styles.ayahNumber}>
            <Text style={styles.ayahNumberText}>{ayah.ayahNum}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (!quranData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0088ff" />
        <Text style={styles.loadingText}>Loading Quran page...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerText}>
          صفحة {quranData.pageNumber} - الجزء {quranData.juz}
        </Text>
        <Text style={styles.subHeaderText}>
          Page {quranData.pageNumber} - Juz {quranData.juz}
        </Text>
        <View style={styles.surahPickerContainer}>
          <Picker
            selectedValue={selectedSurah}
            onValueChange={(itemValue) => setSelectedSurah(itemValue)}
            style={styles.picker}
          >
            {quranData.surahs.map((surah) => (
              <Picker.Item
                key={surah.surahNum}
                label={`Surah ${surah.surahNum}`}
                value={surah.surahNum}
              />
            ))}
          </Picker>
        </View>
      </View>

      {/* Quran Text */}
      <ScrollView style={styles.quranContainer} showsVerticalScrollIndicator={false}>
        {quranData.surahs
          .filter(surah => selectedSurah === null || surah.surahNum === selectedSurah)
          .map((surah) => (
            <View key={surah.surahNum} style={styles.surahContainer}>
              <Text style={styles.surahHeader}>سورة {surah.surahNum}</Text>
              {surah.ayahs.map(renderAyah)}
            </View>
          ))}
      </ScrollView>

      {/* Transcription and Comparison Section */}
      {(transcription || isTranscribing || comparisonResult) && (
        <View style={styles.transcriptionSection}>
          <Text style={styles.transcriptionTitle}>Transcription:</Text>
          {isTranscribing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#0088ff" />
              <Text style={styles.loadingText}>Transcribing...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.transcriptionText}>{transcription}</Text>
              {comparisonResult && (
                <Text style={styles.comparisonText}>{comparisonResult}</Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Back Button */}
      <TouchableOpacity 
        style={styles.backButton}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={24} color="#333" />
      </TouchableOpacity>

      {/* Recording Controls */}
      <View style={[styles.controlsContainer, { paddingBottom: bottom + 20 }]}>
        <TouchableOpacity
          onPress={recorderState.isRecording ? stopRecording : startRecording}
          style={[
            styles.recordButton,
            recorderState.isRecording ? styles.recordingButton : styles.notRecordingButton,
          ]}
          disabled={isTranscribing || !selectedSurah}
        >
          <Ionicons
            name={recorderState.isRecording ? 'stop' : 'mic'}
            size={28}
            color="white"
          />
        </TouchableOpacity>
        
        {recordedUri && (
          <TouchableOpacity
            onPress={playRecording}
            style={styles.playButton}
            disabled={isTranscribing}
          >
            <Ionicons name="play" size={20} color="#0088ff" />
          </TouchableOpacity>
        )}

        {recorderState.isRecording && (
          <Text style={styles.recordingIndicator}>🔴 Recording...</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#2c5530',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  subHeaderText: {
    fontSize: 14,
    color: '#a8d5aa',
    marginTop: 4,
  },
  surahPickerContainer: {
    marginTop: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    width: '60%',
  },
  picker: {
    height: 40,
    color: '#333',
  },
  quranContainer: {
    flex: 1,
    padding: 20,
  },
  surahContainer: {
    marginBottom: 30,
  },
  surahHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2c5530',
    textAlign: 'center',
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
  },
  ayahContainer: {
    backgroundColor: '#fff',
    padding: 15,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  ayahContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  ayahText: {
    flex: 1,
    fontSize: 24,
    lineHeight: 40,
    textAlign: 'right',
    color: '#333',
    fontFamily: 'System', // Replace with an Arabic font if needed
  },
  arabicWord: {
    fontSize: 24,
    color: '#333',
  },
  ayahNumber: {
    backgroundColor: '#2c5530',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  ayahNumberText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  transcriptionSection: {
    backgroundColor: '#fff',
    margin: 20,
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  transcriptionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  transcriptionText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#666',
  },
  comparisonText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#0088ff',
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 8,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 15,
  },
  recordButton: {
    backgroundColor: '#0088ff',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  recordingButton: {
    backgroundColor: '#ff0000',
  },
  notRecordingButton: {
    backgroundColor: '#0088ff',
  },
  playButton: {
    backgroundColor: '#f0f0f0',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0088ff',
  },
  recordingIndicator: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ff0000',
  },
});
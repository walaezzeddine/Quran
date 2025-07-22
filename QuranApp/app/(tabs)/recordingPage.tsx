import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Button, Alert, Text, ScrollView, ActivityIndicator } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
} from 'expo-audio';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

export default function RecordingPage() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  
  // Create audio player with a placeholder that gets replaced
  const audioPlayer = useAudioPlayer(recordedUri || '');

  // Update the player source when recordedUri changes
  useEffect(() => {
    if (recordedUri && audioPlayer) {
      try {
        console.log('Updating audio player source:', recordedUri);
        // The player should automatically update when recordedUri changes
      } catch (error) {
        console.error('Error updating audio player:', error);
      }
    }
  }, [recordedUri, audioPlayer]);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.log('Microphone permission denied');
        Alert.alert('Permission Required', 'Microphone permission is required to record audio.');
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    })();
  }, []);

  const transcribeAudio = async (audioUri: string) => {
    if (!audioUri) {
      Alert.alert('Error', 'No audio file to transcribe');
      return;
    }

    setIsTranscribing(true);
    setTranscription('');

    try {
      console.log('Starting transcription for:', audioUri);
      
      // Create FormData for the API request
      const formData = new FormData();
      
      // Convert the file URI to a blob/file for upload
      const fileUri = audioUri.startsWith('file://') ? audioUri : `file://${audioUri}`;
      
      // For React Native, we need to create a file object
      const fileBlob = {
        uri: fileUri,
        type: 'audio/m4a', // or 'audio/wav' depending on your recording format
        name: 'recording.m4a',
      } as any;
      
      formData.append('file', fileBlob);

      // Make the API request to your Node.js transcription server
      const apiUrl = __DEV__ 
        ? 'http://192.168.100.151:3001/transcribe'  // Development server
        : 'https://your-production-server.com/transcribe';  // Replace with your production URL
      
      console.log('Making request to:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
        // Don't set Content-Type header - let the browser set it for FormData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.text();
      setTranscription(result);
      console.log('Transcription successful:', result);

    } catch (error) {
      console.error('Transcription failed:', error);
      Alert.alert('Transcription Error', 'Failed to transcribe the audio. Please try again.');
      setTranscription('Transcription failed. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      // Clear previous transcription when starting new recording
      setTranscription('');
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
      console.log('Recording stopped, URI:', uri);

      if (uri) {
        // Ensure proper file:// protocol
        const properUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        setRecordedUri(properUri);
        
        // Automatically start transcription after stopping recording
        await transcribeAudio(properUri);
        
      } else {
        Alert.alert('Error', 'No recording URI available');
      }
    } catch (error) {
      console.error('Failed to stop recording:', error);
      Alert.alert('Error', 'Failed to stop recording');
    }
  };

  const playSound = async () => {
    if (!recordedUri) {
      Alert.alert('No Recording', 'Please record some audio first');
      return;
    }

    try {
      console.log('Playing audio...');
      await audioPlayer.play();
    } catch (error) {
      console.error('Failed to play audio:', error);
      Alert.alert('Playback Error', 'Failed to play the recorded audio');
    }
  };

  const replaySound = async () => {
    if (!recordedUri) {
      Alert.alert('No Recording', 'Please record some audio first');
      return;
    }

    try {
      console.log('Replaying audio from beginning...');
      await audioPlayer.seekTo(0);
      await audioPlayer.play();
    } catch (error) {
      console.error('Failed to replay audio:', error);
      Alert.alert('Playback Error', 'Failed to replay the recorded audio');
    }
  };

  const retranscribe = async () => {
    if (recordedUri) {
      await transcribeAudio(recordedUri);
    }
  };

  return (
    <View style={styles.container}>
      {/* Transcription Display Area */}
      <View style={styles.transcriptionContainer}>
        <View style={styles.headerContainer}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.transcriptionTitle}>Transcription:</Text>
        </View>
        <ScrollView style={styles.transcriptionScrollView}>
          {isTranscribing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#0088ff" />
              <Text style={styles.loadingText}>Transcribing audio...</Text>
            </View>
          ) : (
            <Text style={styles.transcriptionText}>
              {transcription || 'Record some audio to see the transcription here.'}
            </Text>
          )}
        </ScrollView>
        
        {transcription && !isTranscribing && (
          <TouchableOpacity style={styles.retranscribeButton} onPress={retranscribe}>
            <Text style={styles.retranscribeButtonText}>Retranscribe</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recording Controls */}
      <View style={[styles.buttonContainer, { bottom }]}>
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
            size={24}
            color="white"
          />
        </TouchableOpacity>
        
        <View style={styles.playbackButtons}>
          <Button 
            title="Play Sound" 
            onPress={playSound}
            disabled={!recordedUri || isTranscribing}
          />
          <Button
            title="Replay Sound"
            onPress={replaySound}
            disabled={!recordedUri || isTranscribing}
          />
        </View>
        
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
    backgroundColor: '#f5f5f5',
  },
  transcriptionContainer: {
    flex: 1,
    padding: 20,
    paddingTop: 60, // Account for status bar
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  transcriptionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  transcriptionScrollView: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  transcriptionText: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  retranscribeButton: {
    backgroundColor: '#0088ff',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
    alignItems: 'center',
  },
  retranscribeButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  buttonContainer: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  recordButton: {
    backgroundColor: '#f0f0f0',
    padding: 20,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  recordingButton: {
    backgroundColor: '#ff0000',
  },
  notRecordingButton: {
    backgroundColor: '#0088ff',
  },
  playbackButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  recordingIndicator: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ff0000',
  },
});
import React, { useEffect } from 'react';
import { View, Image, StyleSheet, Dimensions, PixelRatio } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const scale = (size: number) => PixelRatio.roundToNearestPixel(size * (SCREEN_WIDTH / 375));

const SplashScreen = () => {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/basmala.png')}
        style={styles.basmala}
        resizeMode="contain"
      />
      <Image
        source={require('../assets/images/tarteel_logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Image
        source={require('../assets/images/mosque.png')}
        style={styles.mosque}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#5a8bb0',
    alignItems: 'center',
    justifyContent: 'center',
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  basmala: {
    width: SCREEN_WIDTH * 0.8,
    height: SCREEN_HEIGHT * 0.18,
    marginTop: SCREEN_HEIGHT * 0.1, // Reduced to avoid excessive spacing
    marginBottom: scale(30),
  },
  logo: {
    width: scale(80),
    height: scale(80),
    marginBottom: scale(30),
  },
  mosque: {
    width: SCREEN_WIDTH * 0.8,
    height: scale(80),
    position: 'absolute',
    bottom: scale(30),
    left: SCREEN_WIDTH * 0.1,
  },
});

export default SplashScreen;
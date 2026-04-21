import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pstelecom.stockapp',
  appName: 'PS TELECOM',
  webDir: 'out',
  server: {
    // No custom URL needed - all data goes directly to Supabase
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0a0a1e',
      showSpinner: false,
    },
  },
};

export default config;

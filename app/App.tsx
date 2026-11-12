import React, { useEffect, useRef, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Alert,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { checkServerHealth, normalizeServerUrl } from './server-config';

type Settings = {
  accountSize: number;
  riskPercent: number;
  maxDailyLoss: number;
  serverUrl: string;
  refreshInterval: number;
};

type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
};

type BriefingSetup = {
  ticker: string;
  direction: 'long' | 'short';
  entryZone: { low: number; high: number };
  stopPrice: number;
  targets: number[];
  rewardToRisk: number;
  confidence: 'low' | 'medium' | 'high';
  reasoning: string;
  dataPoints: string[];
  invalidationCondition: string;
};

type BriefingRecord = {
  id: string;
  symbol: string;
  summary: string;
  disclaimer: string;
  setups: BriefingSetup[];
  timestamp: string;
};

const defaultSettings: Settings = {
  accountSize: 100000,
  riskPercent: 1,
  maxDailyLoss: 2000,
  serverUrl: '',
  refreshInterval: 15,
};

const SETTINGS_KEY = 'market-coach-settings';
const WATCHLIST_KEY = 'market-coach-watchlist';
const HISTORY_KEY = 'market-coach-history';
const TOKEN_KEY = 'market-coach-token';

const Tab = createBottomTabNavigator();

function normalizeTicker(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, '').slice(0, 10).toUpperCase();
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultSettings;
    }

    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      accountSize: Number(parsed.accountSize ?? defaultSettings.accountSize),
      riskPercent: Number(parsed.riskPercent ?? defaultSettings.riskPercent),
      maxDailyLoss: Number(parsed.maxDailyLoss ?? defaultSettings.maxDailyLoss),
      serverUrl: String(parsed.serverUrl ?? defaultSettings.serverUrl),
      refreshInterval: Number(parsed.refreshInterval ?? defaultSettings.refreshInterval),
    };
  } catch {
    return defaultSettings;
  }
}

async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function readWatchlist(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(WATCHLIST_KEY);
    if (!raw) {
      return ['AAPL', 'MSFT'];
    }

    const parsed = JSON.parse(raw) as string[];
    return parsed.map((ticker) => normalizeTicker(ticker)).filter(Boolean);
  } catch {
    return ['AAPL', 'MSFT'];
  }
}

async function saveWatchlist(values: string[]): Promise<void> {
  await AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(values));
}

async function readHistory(): Promise<BriefingRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }

    return JSON.parse(raw) as BriefingRecord[];
  } catch {
    return [];
  }
}

async function saveHistory(values: BriefingRecord[]): Promise<void> {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(values));
}

function validateSettings(value: Settings): Settings {
  const normalizedServerUrl = normalizeServerUrl(value.serverUrl ?? '');

  return {
    accountSize: Number.isFinite(value.accountSize) && value.accountSize > 0 ? value.accountSize : defaultSettings.accountSize,
    riskPercent: Number.isFinite(value.riskPercent) && value.riskPercent > 0 ? value.riskPercent : defaultSettings.riskPercent,
    maxDailyLoss: Number.isFinite(value.maxDailyLoss) && value.maxDailyLoss >= 0 ? value.maxDailyLoss : defaultSettings.maxDailyLoss,
    serverUrl: normalizedServerUrl,
    refreshInterval: Number.isFinite(value.refreshInterval) && value.refreshInterval > 0 ? value.refreshInterval : defaultSettings.refreshInterval,
  };
}

function BriefingScreen(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [watchlist, setWatchlist] = useState<string[]>(['AAPL']);
  const [history, setHistory] = useState<BriefingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      const nextSettings = await readSettings();
      setSettings(nextSettings);
      setWatchlist(await readWatchlist());
      setHistory(await readHistory());
      setToken((await SecureStore.getItemAsync(TOKEN_KEY)) ?? '');
    })();
  }, []);

  const requestBriefing = async (): Promise<void> => {
    if (watchlist.length === 0) {
      setError('Add a ticker to the watchlist first.');
      return;
    }

    setLoading(true);
    setError('');

    const baseUrl = normalizeServerUrl(settings.serverUrl);
    if (!baseUrl) {
      setError('Set a valid https server URL in Settings before requesting a briefing.');
      return;
    }

    try {
      const url = `${baseUrl}/api/briefing`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-shared-app-token': token,
        },
        body: JSON.stringify({
          symbol: watchlist[0],
          timeframe: '1D',
          asks: [{ label: 'Trend', value: 'Monitor' }],
          notes: 'Requested from Market Coach mobile app.',
          style: 'balanced',
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'The briefing request failed.');
      }

      const data = (await response.json()) as {
        summary?: { symbol: string; timeframe: string; summary: string; style: string };
        risk?: { score: number; band: string };
      };

      const nextRecord: BriefingRecord = {
        id: String(Date.now()),
        symbol: data.summary?.symbol ?? watchlist[0],
        summary: data.summary?.summary ?? 'No summary available.',
        disclaimer: 'This analysis is for research only and is not financial advice.',
        setups: [
          {
            ticker: data.summary?.symbol ?? watchlist[0],
            direction: 'long',
            entryZone: { low: 0, high: 0 },
            stopPrice: 0,
            targets: [0],
            rewardToRisk: 0,
            confidence: 'medium',
            reasoning: data.summary?.summary ?? 'No structured setup generated.',
            dataPoints: [`timeframe=${data.summary?.timeframe ?? '1D'}`, `riskBand=${data.risk?.band ?? 'unknown'}`],
            invalidationCondition: 'A close below the stop invalidates the setup.',
          },
        ],
        timestamp: new Date().toISOString(),
      };

      const updatedHistory = [nextRecord, ...history].slice(0, 10);
      setHistory(updatedHistory);
      await saveHistory(updatedHistory);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to load a briefing.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Briefing</Text>
      <Text style={styles.subtitle}>Watchlist: {watchlist.join(', ') || 'None'}</Text>
      <Button title={loading ? 'Loading...' : 'Request briefing'} onPress={requestBriefing} disabled={loading} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.cardList}>
        {history.length === 0 ? (
          <Text style={styles.empty}>No saved briefings yet.</Text>
        ) : (
          history.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.symbol}</Text>
              <Text style={styles.cardMeta}>{new Date(item.timestamp).toLocaleString()}</Text>
              <Text>{item.summary}</Text>
              <View style={styles.divider} />
              {item.setups.map((setup, index) => (
                <View key={`${item.id}-${index}`} style={styles.setupBlock}>
                  <Text style={styles.setupTitle}>{setup.ticker} — {setup.direction}</Text>
                  <Text>Entry zone: {setup.entryZone.low}–{setup.entryZone.high}</Text>
                  <Text>Stop: {setup.stopPrice}</Text>
                  <Text>Targets: {setup.targets.join(', ')}</Text>
                  <Text>R:R: {setup.rewardToRisk}</Text>
                  <Text>Reasoning: {setup.reasoning}</Text>
                  <Text>Data: {setup.dataPoints.join(' | ')}</Text>
                </View>
              ))}
              <Text style={styles.disclaimer}>{item.disclaimer}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function LiveScreen(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [watchlist, setWatchlist] = useState<string[]>(['AAPL']);
  const [token, setToken] = useState('');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [dataFreshness, setDataFreshness] = useState<string>('No data');
  const [autoCoachEnabled, setAutoCoachEnabled] = useState(false);

  useEffect(() => {
    void (async (): Promise<void> => {
      setSettings(await readSettings());
      setWatchlist(await readWatchlist());
      setToken((await SecureStore.getItemAsync(TOKEN_KEY)) ?? '');
    })();
  }, []);

  useEffect(() => {
    if (watchlist.length === 0) {
      return;
    }

    const refresh = async (): Promise<void> => {
      const baseUrl = normalizeServerUrl(settings.serverUrl);
      if (!baseUrl) {
        setDataFreshness('Server not configured');
        return;
      }

      const nextQuotes: Record<string, Quote> = {};
      for (const symbol of watchlist) {
        try {
          const response = await fetch(`${baseUrl}/api/market/quote?symbol=${symbol}`, {
            headers: { 'x-shared-app-token': token },
          });
          const payload = (await response.json().catch(() => ({}))) as Partial<Quote> & { symbol?: string };
          nextQuotes[symbol] = {
            symbol: payload.symbol ?? symbol,
            bid: Number(payload.bid ?? 0),
            ask: Number(payload.ask ?? 0),
            last: Number(payload.last ?? 0),
            timestamp: payload.timestamp ?? new Date().toISOString(),
          };
        } catch {
          nextQuotes[symbol] = {
            symbol,
            bid: 0,
            ask: 0,
            last: 0,
            timestamp: new Date().toISOString(),
          };
        }
      }

      setQuotes(nextQuotes);
      setDataFreshness(new Date().toLocaleTimeString());
    };

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, settings.refreshInterval * 1000);

    return () => clearInterval(timer);
  }, [settings, token, watchlist]);

  useEffect(() => {
    if (!autoCoachEnabled) {
      return;
    }

    const timer = setInterval(() => {
      Alert.alert('Auto-coach', 'The app would request a new coach response on the configured interval.');
    }, Math.max(10_000, settings.refreshInterval * 1000));

    return () => clearInterval(timer);
  }, [autoCoachEnabled, settings.refreshInterval]);

  const delayed = Date.now() - Date.parse(dataFreshness || new Date().toISOString()) > settings.refreshInterval * 2 * 1000;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Live</Text>
      <Text style={styles.subtitle}>Freshness: {dataFreshness}</Text>
      {delayed ? <Text style={styles.alert}>Data is delayed or the connection dropped.</Text> : <Text style={styles.ok}>Data is current.</Text>}
      <View style={styles.row}>
        <Text>Auto-coach</Text>
        <Switch value={autoCoachEnabled} onValueChange={setAutoCoachEnabled} />
      </View>
      <View style={styles.quoteList}>
        {watchlist.map((symbol) => {
          const quote = quotes[symbol] ?? { symbol, bid: 0, ask: 0, last: 0, timestamp: new Date().toISOString() };
          return (
            <View key={symbol} style={styles.card}>
              <Text style={styles.cardTitle}>{symbol}</Text>
              <Text>Bid: {quote.bid}</Text>
              <Text>Ask: {quote.ask}</Text>
              <Text>Last: {quote.last}</Text>
              <Text>Updated: {new Date(quote.timestamp).toLocaleTimeString()}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function WatchlistScreen(): React.ReactElement {
  const [watchlist, setWatchlist] = useState<string[]>(['AAPL', 'MSFT']);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void (async (): Promise<void> => {
      setWatchlist(await readWatchlist());
    })();
  }, []);

  const addTicker = async (): Promise<void> => {
    const clean = normalizeTicker(draft);
    if (!clean || watchlist.includes(clean)) {
      return;
    }

    const nextList = [...watchlist, clean];
    setWatchlist(nextList);
    setDraft('');
    await saveWatchlist(nextList);
  };

  const removeTicker = async (symbol: string): Promise<void> => {
    const nextList = watchlist.filter((item) => item !== symbol);
    setWatchlist(nextList);
    await saveWatchlist(nextList);
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Watchlist</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          placeholder="Ticker"
          autoCapitalize="characters"
          style={styles.input}
          onChangeText={setDraft}
        />
        <Button title="Add" onPress={() => { void addTicker(); }} />
      </View>
      <View style={styles.cardList}>
        {watchlist.map((symbol) => (
          <View key={symbol} style={styles.cardRow}>
            <Text>{symbol}</Text>
            <Pressable onPress={() => { void removeTicker(symbol); }}>
              <Text style={styles.deleteText}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function SettingsScreen(): React.ReactElement {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [token, setToken] = useState('');
  const [realizedLoss, setRealizedLoss] = useState('0');
  const [serverStatus, setServerStatus] = useState<{ connected: boolean; message: string }>({
    connected: false,
    message: 'Server not connected',
  });

  useEffect(() => {
    void (async (): Promise<void> => {
      const loadedSettings = await readSettings();
      setSettings(loadedSettings);
      setToken((await SecureStore.getItemAsync(TOKEN_KEY)) ?? '');
      setServerStatus(await checkServerHealth(loadedSettings.serverUrl));
    })();
  }, []);

  const saveActiveSettings = async (nextSettings: Settings): Promise<void> => {
    const validated = validateSettings(nextSettings);
    setSettings(validated);
    await saveSettings(validated);
    setServerStatus(await checkServerHealth(validated.serverUrl));
  };

  const saveToken = async (): Promise<void> => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  };

  const lossWarning = Number(realizedLoss || 0) > settings.maxDailyLoss;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Settings</Text>
      <Text style={serverStatus.connected ? styles.ok : styles.alert}>Server {serverStatus.connected ? 'connected' : 'not connected'}</Text>
      <Text style={styles.subtitle}>{serverStatus.message}</Text>
      <View style={styles.form}>
        <Text>Account size</Text>
        <TextInput value={String(settings.accountSize)} keyboardType="numeric" style={styles.input} onChangeText={(value) => { void saveActiveSettings({ ...settings, accountSize: Number(value) || 0 }); }} />
        <Text>Risk % per trade</Text>
        <TextInput value={String(settings.riskPercent)} keyboardType="decimal-pad" style={styles.input} onChangeText={(value) => { void saveActiveSettings({ ...settings, riskPercent: Number(value) || 0 }); }} />
        <Text>Max daily loss</Text>
        <TextInput value={String(settings.maxDailyLoss)} keyboardType="numeric" style={styles.input} onChangeText={(value) => { void saveActiveSettings({ ...settings, maxDailyLoss: Number(value) || 0 }); }} />
        <Text>Server URL (https only)</Text>
        <TextInput
          value={settings.serverUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://your-render-url.onrender.com"
          style={styles.input}
          onChangeText={(value) => { void saveActiveSettings({ ...settings, serverUrl: value }); }}
        />
        <Text>Refresh interval (seconds)</Text>
        <TextInput value={String(settings.refreshInterval)} keyboardType="numeric" style={styles.input} onChangeText={(value) => { void saveActiveSettings({ ...settings, refreshInterval: Number(value) || 0 }); }} />
        <Text>App token</Text>
        <TextInput value={token} secureTextEntry style={styles.input} onChangeText={setToken} onSubmitEditing={() => { void saveToken(); }} />
        <Button title="Save app token" onPress={() => { void saveToken(); }} />
        <Text>Realized loss today</Text>
        <TextInput value={realizedLoss} keyboardType="numeric" style={styles.input} onChangeText={setRealizedLoss} />
        {lossWarning ? <Text style={styles.alert}>Daily loss limit reached: ${Number(realizedLoss || 0)} exceeds ${settings.maxDailyLoss}.</Text> : null}
      </View>
    </ScrollView>
  );
}

function CameraScreen(): React.ReactElement {
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);
  const [captured, setCaptured] = useState<string>('');

  useEffect(() => {
    void (async (): Promise<void> => {
      if (!permission) {
        await requestPermission();
      }
    })();
  }, [permission, requestPermission]);

  const handleCapture = async (): Promise<void> => {
    if (!cameraRef.current) {
      return;
    }

    const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: true, exif: false });
    setCaptured(photo?.base64 ? 'Frame captured and ready to attach.' : 'Camera capture completed.');
  };

  if (!permission || permission.status !== 'granted') {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Camera</Text>
        <Text style={styles.subtitle}>Camera access is required to capture optional chart images.</Text>
        <Button title="Allow camera" onPress={() => { void requestPermission(); }} />
      </View>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <Text style={styles.title}>Camera</Text>
      <Text style={styles.subtitle}>{active ? 'Camera is active' : 'Camera is idle'}</Text>
      <CameraView ref={cameraRef} style={styles.camera} />
      <View style={styles.row}>
        <Button title={active ? 'Stop camera' : 'Start camera'} onPress={() => setActive((current) => !current)} />
        <Button title="Capture" onPress={() => { void handleCapture(); }} />
      </View>
      {captured ? <Text style={styles.ok}>{captured}</Text> : null}
    </View>
  );
}

export default function App(): React.ReactElement {
  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator>
          <Tab.Screen name="Briefing" component={BriefingScreen} />
          <Tab.Screen name="Live" component={LiveScreen} />
          <Tab.Screen name="Watchlist" component={WatchlistScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
          <Tab.Screen name="Camera" component={CameraScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    padding: 16,
    backgroundColor: '#f5f7fb',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    marginBottom: 12,
    minHeight: 44,
  },
  form: {
    gap: 8,
  },
  cardList: {
    gap: 12,
    marginTop: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardMeta: {
    color: '#64748b',
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 8,
  },
  disclaimer: {
    marginTop: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  setupBlock: {
    marginBottom: 8,
  },
  setupTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  empty: {
    color: '#64748b',
  },
  alert: {
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  ok: {
    color: '#166534',
    backgroundColor: '#dcfce7',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  error: {
    color: '#b91c1c',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  quoteList: {
    gap: 12,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  deleteText: {
    color: '#b91c1c',
    fontWeight: '700',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16,
  },
  camera: {
    flex: 1,
    minHeight: 300,
    borderRadius: 16,
    overflow: 'hidden',
    marginVertical: 12,
  },
});

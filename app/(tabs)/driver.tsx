// screens/DriverScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polyline } from "react-native-maps";
import { io, Socket } from "socket.io-client";
import { useAuth } from "../AuthContext";

// Obtener dimensiones de la pantalla
const { width, height } = Dimensions.get("window");

// Coordenadas de Cartagena
const CARTAGENA_COORDS = {
  latitude: 10.391,
  longitude: -75.4794,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// Generar ubicación aleatoria en Cartagena para pruebas
const generateCartagenaTestLocation = () => {
  const bounds = {
    north: 10.5,
    south: 10.28,
    east: -75.35,
    west: -75.6,
  };

  const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
  const lng = bounds.west + Math.random() * (bounds.east - bounds.west);

  return { latitude: lat, longitude: lng };
};

// Generar datos aleatorios de prueba
const generateRandomTestData = () => {
  const testScenarios = [
    { name: "Centro Histórico", lat: 10.4236, lng: -75.5378 },
    { name: "Bocagrande", lat: 10.3997, lng: -75.5513 },
    { name: "Castillo San Felipe", lat: 10.4219, lng: -75.5433 },
    { name: "Getsemaní", lat: 10.42, lng: -75.55 },
    { name: "La Matuna", lat: 10.418, lng: -75.542 },
    { name: "Manga", lat: 10.405, lng: -75.525 },
    { name: "Pie de la Popa", lat: 10.41, lng: -75.53 },
    { name: "Crespo", lat: 10.43, lng: -75.52 },
  ];

  const randomScenario =
    testScenarios[Math.floor(Math.random() * testScenarios.length)];
  const randomOffset = 0.002;

  return {
    latitude: randomScenario.lat + (Math.random() - 0.5) * randomOffset,
    longitude: randomScenario.lng + (Math.random() - 0.5) * randomOffset,
    name: randomScenario.name,
    accuracy: Math.floor(Math.random() * 20) + 5,
    speed: Math.random() * 50,
  };
};

// Generar rutas aleatorias de prueba
const generateRandomRoute = (startLocation: any, duration: number = 10) => {
  const route = [startLocation];
  let currentLat = startLocation.latitude;
  let currentLng = startLocation.longitude;

  for (let i = 1; i < duration; i++) {
    currentLat += (Math.random() - 0.5) * 0.001;
    currentLng += (Math.random() - 0.5) * 0.001;

    route.push({
      latitude: currentLat,
      longitude: currentLng,
      timestamp: new Date(Date.now() + i * 30000).toISOString(),
    });
  }

  return route;
};

// Interfaces
interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
  speed?: number;
  heading?: number;
}

interface SentLocation extends LocationData {
  id: string;
  type: "manual" | "auto" | "test" | "random";
}

interface SessionStats {
  totalLocationsSent: number;
  sessionStartTime: string;
  lastLocationTime: string;
  avgAccuracy: number;
  totalDistance: number;
  isActive: boolean;
  randomDataGenerated: number;
}

const WEBSOCKET_URL = `${process.env.EXPO_PUBLIC_BASE_URL}/locations`;

export default function DriverScreen() {
  const { user, logout } = useAuth();

  // Estados principales
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentLocation, setCurrentLocation] =
    useState<Location.LocationObject | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Desconectado");
  const [refreshing, setRefreshing] = useState(false);

  // ✅ NUEVO: Estado para mapa expandido
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  // Estados de configuración
  const [trackingInterval, setTrackingInterval] = useState(5);
  const [permissionStatus, setPermissionStatus] = useState<
    "granted" | "denied" | "undetermined"
  >("undetermined");

  // Estados de datos aleatorios
  const [isGeneratingRandomData, setIsGeneratingRandomData] = useState(false);
  const [randomDataInterval, setRandomDataInterval] = useState(3);

  // Estados de historial y estadísticas
  const [sentLocations, setSentLocations] = useState<SentLocation[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalLocationsSent: 0,
    sessionStartTime: new Date().toISOString(),
    lastLocationTime: "",
    avgAccuracy: 0,
    totalDistance: 0,
    isActive: false,
    randomDataGenerated: 0,
  });

  // Referencias
  const socketRef = useRef<Socket | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null
  );
  const trackingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const randomDataIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mapRef = useRef<MapView>(null);
  const lastLocationRef = useRef<LocationData | null>(null);

  // ✅ CORREGIDO: Acceso directo a vehicleId sin validación anidada
  const vehicleId = user?.vehicleId || "driver-mobile";

  // ✅ SOLICITAR PERMISOS AL INICIAR
  useEffect(() => {
    initializePermissions();
    return () => {
      cleanup();
    };
  }, []);

  // ✅ FUNCIÓN: Inicializar permisos
  const initializePermissions = async () => {
    try {
      console.log("🔍 Verificando permisos de ubicación...");

      const { status: currentStatus } =
        await Location.getForegroundPermissionsAsync();
      console.log("📍 Estado actual de permisos:", currentStatus);

      if (currentStatus === "granted") {
        setPermissionStatus("granted");
        console.log("✅ Permisos ya concedidos");
        await getCurrentLocation();
      } else {
        setPermissionStatus(currentStatus);
        console.log("⚠️ Permisos no concedidos, solicitando...");

        setTimeout(() => {
          showPermissionDialog();
        }, 1000);
      }
    } catch (error) {
      console.error("❌ Error verificando permisos:", error);
      setPermissionStatus("denied");
    }
  };

  // ✅ FUNCIÓN: Diálogo de permisos
  const showPermissionDialog = () => {
    Alert.alert(
      "📍 Permisos de Ubicación Requeridos",
      "Esta aplicación necesita acceso a tu ubicación para:\n\n• Enviar tu posición en tiempo real\n• Mostrar tu ubicación en el mapa\n• Generar rutas y estadísticas\n\n¿Deseas conceder permisos?",
      [
        {
          text: "Ahora No",
          style: "cancel",
          onPress: () => {
            setPermissionStatus("denied");
            console.log("❌ Usuario rechazó permisos");
          },
        },
        {
          text: "Conceder Permisos",
          onPress: async () => {
            await requestLocationPermissions();
          },
        },
      ],
      { cancelable: false }
    );
  };

  // ✅ FUNCIÓN: Solicitar permisos de ubicación
  const requestLocationPermissions = async () => {
    try {
      console.log("🔄 Solicitando permisos...");

      const { status } = await Location.requestForegroundPermissionsAsync();
      console.log("📱 Respuesta de permisos:", status);

      setPermissionStatus(status);

      if (status === "granted") {
        console.log("✅ Permisos concedidos exitosamente");
        Alert.alert(
          "✅ ¡Permisos Concedidos!",
          "Ahora puedes usar todas las funciones de tracking GPS.",
          [{ text: "Continuar", onPress: () => getCurrentLocation() }]
        );
      } else {
        console.log("❌ Permisos denegados");
        Alert.alert(
          "❌ Permisos Denegados",
          "Sin permisos de ubicación, algunas funciones no estarán disponibles.\n\nPuedes habilitarlos más tarde desde Configuración.",
          [
            { text: "Entendido", style: "cancel" },
            {
              text: "Ir a Configuración",
              onPress: () => {
                if (Platform.OS === "ios") {
                  Alert.alert(
                    "Configuración",
                    "Ve a Configuración > Privacidad > Servicios de Ubicación"
                  );
                } else {
                  Alert.alert(
                    "Configuración",
                    "Ve a Configuración > Apps > Permisos > Ubicación"
                  );
                }
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error("❌ Error solicitando permisos:", error);
      setPermissionStatus("denied");
      Alert.alert(
        "Error",
        "No se pudieron solicitar los permisos de ubicación"
      );
    }
  };

  // ✅ FUNCIÓN: Obtener ubicación actual
  const getCurrentLocation = async (): Promise<LocationData | null> => {
    if (permissionStatus !== "granted") {
      console.log("⚠️ Permisos no concedidos para obtener ubicación");
      Alert.alert(
        "❌ Permisos Requeridos",
        "Necesitas conceder permisos de ubicación primero."
      );
      return null;
    }

    try {
      console.log("📍 Obteniendo ubicación actual...");

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
      });

      console.log("✅ Ubicación obtenida:", location.coords);

      const locationData: LocationData = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        timestamp: new Date().toISOString(),
        speed: location.coords.speed || undefined,
        heading: location.coords.heading || undefined,
      };

      setCurrentLocation(location);
      lastLocationRef.current = locationData;

      console.log("📍 Ubicación actualizada en el estado");
      return locationData;
    } catch (error) {
      console.error("❌ Error obteniendo ubicación:", error);
      Alert.alert(
        "❌ Error",
        "No se pudo obtener la ubicación actual. Asegúrate de tener GPS activado."
      );
      return null;
    }
  };

  // ✅ FUNCIÓN: Conectar al servidor WebSocket
  const connectToServer = async () => {
    if (isConnecting || isConnected) return;

    try {
      setIsConnecting(true);
      setConnectionStatus("Conectando...");

      const token = await SecureStore.getItemAsync("accessToken");
      if (!token) {
        Alert.alert("❌ Error", "Token de autenticación no encontrado");
        setConnectionStatus("Error de autenticación");
        setIsConnecting(false);
        return;
      }

      const socket = io(WEBSOCKET_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        console.log("✅ Conectado al WebSocket");
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionStatus("Conectado");
        setSessionStats((prev) => ({
          ...prev,
          sessionStartTime: new Date().toISOString(),
          isActive: true,
        }));

        Alert.alert(
          "✅ Conectado",
          "Conectado al sistema de monitoreo exitosamente"
        );
      });

      socket.on("disconnect", (reason) => {
        console.log("❌ Desconectado:", reason);
        setIsConnected(false);
        setConnectionStatus(`Desconectado: ${reason}`);
        stopTracking();
        stopRandomDataGeneration();

        Alert.alert(
          "🔌 Desconectado",
          "Se ha perdido la conexión con el servidor"
        );
      });

      socket.on("connect_error", (error) => {
        console.error("❌ Error de conexión:", error);
        setIsConnected(false);
        setIsConnecting(false);
        setConnectionStatus(`Error: ${error.message}`);
        Alert.alert("❌ Error de Conexión", error.message);
      });
    } catch (error) {
      console.error("Error conectando:", error);
      setIsConnecting(false);
      setConnectionStatus("Error de conexión");
      Alert.alert("❌ Error", "No se pudo conectar al servidor");
    }
  };

  // ✅ FUNCIÓN: Desconectar del servidor
  const disconnectFromServer = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus("Desconectado");
    stopTracking();
    stopRandomDataGeneration();
    setSessionStats((prev) => ({ ...prev, isActive: false }));
  };

  // ✅ FUNCIÓN: Calcular distancia
  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000;
  };

  // ✅ FUNCIÓN: Enviar ubicación al servidor
  const sendLocation = (
    locationData: LocationData,
    type: "manual" | "auto" | "test" | "random" = "auto"
  ) => {
    if (!socketRef.current?.connected) {
      Alert.alert("❌ Error", "No hay conexión al servidor");
      return;
    }

    const payload = {
      vehicleId: vehicleId,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      timestamp: locationData.timestamp,
      accuracy: locationData.accuracy,
      speed: locationData.speed,
      heading: locationData.heading,
    };

    socketRef.current.emit("sendLocation", payload);

    const sentLocation: SentLocation = {
      ...locationData,
      id: Date.now().toString(),
      type,
    };

    setSentLocations((prev) => [sentLocation, ...prev.slice(0, 99)]);

    setSessionStats((prev) => {
      const newStats = {
        ...prev,
        totalLocationsSent: prev.totalLocationsSent + 1,
        lastLocationTime: locationData.timestamp,
        avgAccuracy:
          prev.avgAccuracy === 0
            ? locationData.accuracy || 0
            : (prev.avgAccuracy + (locationData.accuracy || 0)) / 2,
      };

      if (type === "random") {
        newStats.randomDataGenerated = prev.randomDataGenerated + 1;
      }

      if (lastLocationRef.current && lastLocationRef.current !== locationData) {
        const distance = calculateDistance(
          lastLocationRef.current.latitude,
          lastLocationRef.current.longitude,
          locationData.latitude,
          locationData.longitude
        );
        newStats.totalDistance = prev.totalDistance + distance;
      }

      return newStats;
    });

    console.log(`📡 Ubicación ${type} enviada:`, payload);
  };

  // ✅ FUNCIÓN: Iniciar tracking automático
  const startTracking = async () => {
    if (!isConnected) {
      Alert.alert("❌ Error", "Primero debes conectarte al servidor");
      return;
    }

    if (permissionStatus !== "granted") {
      Alert.alert(
        "❌ Permisos Requeridos",
        "Necesitas permisos de ubicación para usar el tracking",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Solicitar Permisos",
            onPress: () => requestLocationPermissions(),
          },
        ]
      );
      return;
    }

    try {
      setIsTracking(true);

      const initialLocation = await getCurrentLocation();
      if (initialLocation) {
        sendLocation(initialLocation, "auto");
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: trackingInterval * 1000,
          distanceInterval: 5,
        },
        (location) => {
          setCurrentLocation(location);
          const locationData: LocationData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
            timestamp: new Date().toISOString(),
            speed: location.coords.speed || undefined,
            heading: location.coords.heading || undefined,
          };

          sendLocation(locationData, "auto");
        }
      );

      locationSubscription.current = subscription;

      trackingIntervalRef.current = setInterval(async () => {
        const location = await getCurrentLocation();
        if (location) {
          sendLocation(location, "auto");
        }
      }, trackingInterval * 1000);

      Alert.alert(
        "🚀 Tracking Iniciado",
        `GPS activo - Enviando ubicación automáticamente cada ${trackingInterval} segundos`
      );
    } catch (error) {
      console.error("Error iniciando tracking:", error);
      Alert.alert("❌ Error", "No se pudo iniciar el tracking GPS");
      setIsTracking(false);
    }
  };

  // ✅ FUNCIÓN: Detener tracking
  const stopTracking = () => {
    setIsTracking(false);

    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
  };

  // ✅ FUNCIÓN: Iniciar generación de datos aleatorios
  const startRandomDataGeneration = () => {
    if (!isConnected) {
      Alert.alert("❌ Error", "Primero debes conectarte al servidor");
      return;
    }

    setIsGeneratingRandomData(true);

    randomDataIntervalRef.current = setInterval(() => {
      const randomData = generateRandomTestData();
      const locationData: LocationData = {
        latitude: randomData.latitude,
        longitude: randomData.longitude,
        accuracy: randomData.accuracy,
        timestamp: new Date().toISOString(),
        speed: randomData.speed,
      };

      const fakeLocationObject: Location.LocationObject = {
        coords: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          altitude: 0,
          accuracy: locationData.accuracy || 15,
          altitudeAccuracy: null,
          heading: null,
          speed: locationData.speed || null,
        },
        timestamp: Date.now(),
      };

      setCurrentLocation(fakeLocationObject);
      sendLocation(locationData, "random");

      if (Math.random() < 0.3 && mapRef.current) {
        mapRef.current.animateToRegion(
          {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          1000
        );
      }
    }, randomDataInterval * 1000);

    Alert.alert(
      "🎲 Datos Aleatorios Iniciados",
      `Generando y enviando ubicaciones aleatorias cada ${randomDataInterval} segundos en Cartagena`
    );
  };

  // ✅ FUNCIÓN: Detener generación de datos aleatorios
  const stopRandomDataGeneration = () => {
    setIsGeneratingRandomData(false);

    if (randomDataIntervalRef.current) {
      clearInterval(randomDataIntervalRef.current);
      randomDataIntervalRef.current = null;
    }
  };

  // ✅ FUNCIÓN: Generar ruta aleatoria completa
  const generateAndSendRandomRoute = async () => {
    if (!isConnected) {
      Alert.alert("❌ Error", "Primero debes conectarte al servidor");
      return;
    }

    const startLocation = generateRandomTestData();
    const route = generateRandomRoute(startLocation, 8);

    Alert.alert(
      "🗺️ Generando Ruta Aleatoria",
      `Se enviará una ruta de ${route.length} puntos en ${route.length * 2} segundos`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Enviar",
          onPress: () => {
            route.forEach((point, index) => {
              setTimeout(() => {
                const locationData: LocationData = {
                  latitude: point.latitude,
                  longitude: point.longitude,
                  accuracy: Math.floor(Math.random() * 15) + 5,
                  timestamp: new Date().toISOString(),
                  speed: Math.random() * 40,
                };

                const fakeLocationObject: Location.LocationObject = {
                  coords: {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                    altitude: 0,
                    accuracy: locationData.accuracy || 15,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: locationData.speed || null,
                  },
                  timestamp: Date.now(),
                };

                setCurrentLocation(fakeLocationObject);
                sendLocation(locationData, "random");

                if (index === 0 && mapRef.current) {
                  mapRef.current.animateToRegion(
                    {
                      latitude: locationData.latitude,
                      longitude: locationData.longitude,
                      latitudeDelta: 0.02,
                      longitudeDelta: 0.02,
                    },
                    1000
                  );
                }
              }, index * 2000);
            });
          },
        },
      ]
    );
  };

  // ✅ FUNCIÓN: Enviar ubicación manual
  const sendCurrentLocationManually = async () => {
    if (!isConnected) {
      Alert.alert("❌ Error", "Primero debes conectarte al servidor");
      return;
    }

    const location = await getCurrentLocation();
    if (location) {
      sendLocation(location, "manual");
      Alert.alert("✅ Enviado", "Ubicación manual enviada correctamente");
    }
  };

  // ✅ FUNCIÓN: Usar ubicación de prueba
  const useCartagenaTestLocation = async () => {
    const testCoords = generateCartagenaTestLocation();
    const testLocation: LocationData = {
      latitude: testCoords.latitude,
      longitude: testCoords.longitude,
      accuracy: 15,
      timestamp: new Date().toISOString(),
    };

    const fakeLocationObject: Location.LocationObject = {
      coords: {
        latitude: testLocation.latitude,
        longitude: testLocation.longitude,
        altitude: 0,
        accuracy: 15,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };

    setCurrentLocation(fakeLocationObject);
    lastLocationRef.current = testLocation;

    if (isConnected) {
      sendLocation(testLocation, "test");
    }

    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: testLocation.latitude,
          longitude: testLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        1000
      );
    }

    Alert.alert(
      "🏖️ Ubicación de Prueba",
      `Ubicación simulada en Cartagena:\nLat: ${testLocation.latitude.toFixed(4)}\nLng: ${testLocation.longitude.toFixed(4)}`
    );
  };

  // ✅ FUNCIÓN: Centrar mapa
  const centerMapOnCurrentLocation = () => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        1000
      );
    }
  };

  // ✅ NUEVO: Función para toggle del mapa expandido
  const toggleMapExpansion = () => {
    setIsMapExpanded(!isMapExpanded);
  };

  // ✅ FUNCIÓN: Limpiar historial
  const clearHistory = () => {
    Alert.alert(
      "🗑️ Limpiar Historial",
      "¿Estás seguro de que quieres borrar el historial de ubicaciones?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpiar",
          style: "destructive",
          onPress: () => {
            setSentLocations([]);
            setSessionStats((prev) => ({
              ...prev,
              totalLocationsSent: 0,
              totalDistance: 0,
              avgAccuracy: 0,
              randomDataGenerated: 0,
            }));
          },
        },
      ]
    );
  };

  // ✅ FUNCIÓN: Logout
  const handleLogout = () => {
    Alert.alert(
      "👋 Cerrar Sesión",
      "¿Estás seguro de que quieres cerrar sesión?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar Sesión",
          style: "destructive",
          onPress: () => {
            disconnectFromServer();
            logout();
          },
        },
      ]
    );
  };

  // ✅ FUNCIÓN: Cleanup
  const cleanup = () => {
    stopTracking();
    stopRandomDataGeneration();
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  // ✅ FUNCIÓN: Refresh
  const onRefresh = async () => {
    setRefreshing(true);
    await getCurrentLocation();
    setRefreshing(false);
  };

  // Formatear duración de sesión
  const getSessionDuration = () => {
    const start = new Date(sessionStats.sessionStartTime);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  };

  // Generar coordenadas para la ruta
  const getRouteCoordinates = () => {
    return sentLocations
      .slice(0, 20)
      .reverse()
      .map((loc) => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
      }));
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* ✅ MAPA CON FUNCIONALIDAD DE EXPANSIÓN */}
      <MapView
        ref={mapRef}
        style={isMapExpanded ? mapStyles.mapExpanded : mapStyles.map}
        initialRegion={CARTAGENA_COORDS}
        region={
          currentLocation
            ? {
                latitude: currentLocation.coords.latitude,
                longitude: currentLocation.coords.longitude,
                latitudeDelta: 0.02,
                longitudeDelta: 0.02,
              }
            : CARTAGENA_COORDS
        }
        showsUserLocation={permissionStatus === "granted"}
        showsMyLocationButton={false}
        followsUserLocation={isTracking}
        mapType="standard"
        zoomEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
        rotateEnabled={true}
      >
        {/* Marcador de ubicación actual */}
        {currentLocation && (
          <>
            <Marker
              coordinate={currentLocation.coords}
              title="🚗 Mi Ubicación"
              description={`Precisión: ${Math.round(currentLocation.coords.accuracy || 0)}m`}
              pinColor={
                isTracking || isGeneratingRandomData ? "#34C759" : "#007AFF"
              }
            />

            {/* Círculo de precisión */}
            <Circle
              center={currentLocation.coords}
              radius={currentLocation.coords.accuracy || 20}
              strokeColor={
                isTracking || isGeneratingRandomData
                  ? "rgba(52, 199, 89, 0.5)"
                  : "rgba(0, 122, 255, 0.5)"
              }
              fillColor={
                isTracking || isGeneratingRandomData
                  ? "rgba(52, 199, 89, 0.2)"
                  : "rgba(0, 122, 255, 0.2)"
              }
            />
          </>
        )}

        {/* Marcadores del historial */}
        {sentLocations.slice(0, 15).map((location, index) => (
          <Marker
            key={location.id}
            coordinate={{
              latitude: location.latitude,
              longitude: location.longitude,
            }}
            title={`${
              location.type === "manual"
                ? "🎯"
                : location.type === "test"
                  ? "🏖️"
                  : location.type === "random"
                    ? "🎲"
                    : "📍"
            } Ubicación ${location.type}`}
            description={new Date(location.timestamp).toLocaleTimeString()}
            pinColor={
              location.type === "manual"
                ? "#9F7AEA"
                : location.type === "test"
                  ? "#F6AD55"
                  : location.type === "random"
                    ? "#ED8936"
                    : "#4299E1"
            }
            opacity={1 - index * 0.05}
          />
        ))}

        {/* Línea de ruta del historial */}
        {getRouteCoordinates().length > 1 && (
          <Polyline
            coordinates={getRouteCoordinates()}
            strokeColor="#007AFF"
            strokeWidth={3}
          />
        )}
      </MapView>

      {/* ✅ BOTONES FLOTANTES MEJORADOS */}
      <View style={mapStyles.floatingButtons}>
        {/* Botón para expandir/contraer mapa */}
        <TouchableOpacity
          style={mapStyles.expandButton}
          onPress={toggleMapExpansion}
        >
          <Ionicons
            name={isMapExpanded ? "contract" : "expand"}
            size={24}
            color="#007AFF"
          />
        </TouchableOpacity>

        {/* Botón para centrar mapa */}
        <TouchableOpacity
          style={mapStyles.centerButton}
          onPress={centerMapOnCurrentLocation}
          disabled={!currentLocation}
        >
          <Ionicons
            name="locate"
            size={24}
            color={currentLocation ? "#007AFF" : "#C7C7CC"}
          />
        </TouchableOpacity>
      </View>

      {/* ✅ PANEL DE CONTROLES - SE OCULTA CUANDO MAPA ESTÁ EXPANDIDO */}
      {!isMapExpanded && (
        <View
          className="absolute bottom-0 left-0 right-0 bg-white rounded-tl-3xl rounded-tr-3xl shadow-2xl"
          style={{ maxHeight: height * 0.7 }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#007AFF"
              />
            }
          >
            {/* Header */}
            <View className="flex-row justify-between items-center p-5 pb-3 border-b border-gray-100">
              <View>
                <Text className="text-xl font-bold text-gray-800">
                  👋 Hola, {user?.email || "Driver"}
                </Text>
                <Text className="text-sm text-gray-600 mt-1">
                  Vehículo: {vehicleId}
                </Text>
              </View>
              <TouchableOpacity onPress={handleLogout} className="p-2">
                <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
              </TouchableOpacity>
            </View>

            {/* Estados con indicadores */}
            <View className="p-5 pb-4">
              <View className="flex-row items-center mb-2">
                <View
                  className={`w-2 h-2 rounded-full mr-3 ${isConnected ? "bg-green-500" : "bg-red-500"}`}
                />
                <Text className="text-sm text-gray-700">
                  {connectionStatus}
                </Text>
              </View>

              <View className="flex-row items-center mb-2">
                <View
                  className={`w-2 h-2 rounded-full mr-3 ${isTracking ? "bg-green-500" : "bg-gray-400"}`}
                />
                <Text className="text-sm text-gray-700">
                  GPS Tracking: {isTracking ? "Activo" : "Inactivo"}
                </Text>
              </View>

              <View className="flex-row items-center mb-2">
                <View
                  className={`w-2 h-2 rounded-full mr-3 ${isGeneratingRandomData ? "bg-orange-500" : "bg-gray-400"}`}
                />
                <Text className="text-sm text-gray-700">
                  Datos Aleatorios:{" "}
                  {isGeneratingRandomData ? "Generando" : "Inactivo"}
                </Text>
              </View>

              <View className="flex-row items-center">
                <View
                  className={`w-2 h-2 rounded-full mr-3 ${permissionStatus === "granted" ? "bg-green-500" : "bg-yellow-500"}`}
                />
                <Text className="text-sm text-gray-700">
                  GPS:{" "}
                  {permissionStatus === "granted"
                    ? "Autorizado"
                    : "Sin permisos"}
                </Text>
              </View>
            </View>

            {/* Estadísticas de sesión */}
            {sessionStats.isActive && (
              <View className="px-5 pb-4">
                <Text className="text-base font-bold text-gray-800 mb-4">
                  📊 Estadísticas de Sesión
                </Text>
                <View className="flex-row justify-around">
                  <View className="items-center">
                    <Text className="text-lg font-bold text-blue-600">
                      {sessionStats.totalLocationsSent}
                    </Text>
                    <Text className="text-xs text-gray-600 mt-1">
                      Ubicaciones
                    </Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-lg font-bold text-blue-600">
                      {sessionStats.randomDataGenerated}
                    </Text>
                    <Text className="text-xs text-gray-600 mt-1">
                      Aleatorias
                    </Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-lg font-bold text-blue-600">
                      {getSessionDuration()}
                    </Text>
                    <Text className="text-xs text-gray-600 mt-1">Duración</Text>
                  </View>
                  <View className="items-center">
                    <Text className="text-lg font-bold text-blue-600">
                      {(sessionStats.totalDistance / 1000).toFixed(1)}km
                    </Text>
                    <Text className="text-xs text-gray-600 mt-1">
                      Distancia
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Controles principales */}
            <View className="px-5 pb-4">
              {/* Conexión */}
              <TouchableOpacity
                className={`flex-row items-center justify-center py-3.5 px-4 rounded-xl mb-3 ${
                  isConnected ? "bg-gray-500" : "bg-blue-500"
                } ${isConnecting ? "bg-gray-300" : ""}`}
                onPress={isConnected ? disconnectFromServer : connectToServer}
                disabled={isConnecting}
              >
                <Ionicons size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text className="text-white text-base font-semibold">
                  {isConnecting
                    ? "Conectando..."
                    : isConnected
                      ? "🔌 Desconectar"
                      : "📡 Conectar al Servidor"}
                </Text>
              </TouchableOpacity>

              {/* Tracking GPS */}
              <TouchableOpacity
                className={`flex-row items-center justify-center py-3.5 px-4 rounded-xl mb-3 ${
                  isTracking ? "bg-red-500" : "bg-green-500"
                } ${!isConnected || permissionStatus !== "granted" ? "bg-gray-300" : ""}`}
                onPress={isTracking ? stopTracking : startTracking}
                disabled={!isConnected || permissionStatus !== "granted"}
              >
                <Ionicons
                  name={isTracking ? "pause" : "play"}
                  size={20}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text className="text-white text-base font-semibold">
                  {isTracking
                    ? "⏹️ Detener GPS Tracking"
                    : "🚀 Iniciar GPS Tracking"}
                </Text>
              </TouchableOpacity>

              {/* Datos Aleatorios */}
              <TouchableOpacity
                className={`flex-row items-center justify-center py-3.5 px-4 rounded-xl mb-3 ${
                  isGeneratingRandomData ? "bg-red-500" : "bg-orange-500"
                } ${!isConnected ? "bg-gray-300" : ""}`}
                onPress={
                  isGeneratingRandomData
                    ? stopRandomDataGeneration
                    : startRandomDataGeneration
                }
                disabled={!isConnected}
              >
                <Ionicons
                  name={isGeneratingRandomData ? "stop" : "shuffle"}
                  size={20}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
                <Text className="text-white text-base font-semibold">
                  {isGeneratingRandomData
                    ? "🛑 Detener Datos Aleatorios"
                    : "🎲 Iniciar Datos Aleatorios"}
                </Text>
              </TouchableOpacity>

              {/* Configuración de intervalos */}
              {!isTracking && !isGeneratingRandomData && (
                <View className="mt-3 mb-3">
                  <Text className="text-sm text-gray-700 mb-3 text-center">
                    Intervalos de envío
                  </Text>
                  <View className="flex-row justify-around mb-3">
                    <Text className="text-xs text-gray-600">
                      GPS: {trackingInterval}s
                    </Text>
                    <Text className="text-xs text-gray-600">
                      Random: {randomDataInterval}s
                    </Text>
                  </View>
                  <View className="flex-row justify-around">
                    {[2, 3, 5, 10].map((interval) => (
                      <TouchableOpacity
                        key={interval}
                        className={`py-2 px-3 rounded-lg ${
                          trackingInterval === interval
                            ? "bg-blue-500"
                            : "bg-gray-200"
                        }`}
                        onPress={() => {
                          setTrackingInterval(interval);
                          setRandomDataInterval(interval);
                        }}
                      >
                        <Text
                          className={`text-sm ${
                            trackingInterval === interval
                              ? "text-white font-semibold"
                              : "text-gray-700"
                          }`}
                        >
                          {interval}s
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Acciones adicionales */}
            <View className="px-5 pb-4">
              <TouchableOpacity
                className={`flex-row items-center py-3 px-4 rounded-lg mb-2 bg-blue-50 border border-blue-200 ${
                  !isConnected ? "bg-gray-100 border-gray-200" : ""
                }`}
                onPress={sendCurrentLocationManually}
                disabled={!isConnected}
              >
                <Ionicons name="navigate" size={18} color="#007AFF" />
                <Text className="text-blue-700 ml-2 text-sm">
                  📍 Enviar Ubicación Manual
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-row items-center py-3 px-4 rounded-lg mb-2 bg-yellow-50 border border-yellow-200"
                onPress={useCartagenaTestLocation}
              >
                <Ionicons name="location" size={18} color="#F6AD55" />
                <Text className="text-yellow-700 ml-2 text-sm">
                  🏖️ Ubicación de Prueba (Cartagena)
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                className={`flex-row items-center py-3 px-4 rounded-lg mb-2 bg-purple-50 border border-purple-200 ${
                  !isConnected ? "bg-gray-100 border-gray-200" : ""
                }`}
                onPress={generateAndSendRandomRoute}
                disabled={!isConnected}
              >
                <Ionicons name="map" size={18} color="#9F7AEA" />
                <Text className="text-purple-700 ml-2 text-sm">
                  🗺️ Generar Ruta Aleatoria
                </Text>
              </TouchableOpacity>

              {sentLocations.length > 0 && (
                <TouchableOpacity
                  className="flex-row items-center py-3 px-4 rounded-lg mb-2 bg-red-50 border border-red-200"
                  onPress={clearHistory}
                >
                  <Ionicons name="trash" size={18} color="#FF3B30" />
                  <Text className="text-red-700 ml-2 text-sm">
                    🗑️ Limpiar Historial
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Historial de ubicaciones */}
            {sentLocations.length > 0 && (
              <View className="px-5 pb-4">
                <Text className="text-base font-bold text-gray-800 mb-4">
                  📍 Últimas Ubicaciones ({sentLocations.length})
                </Text>
                {sentLocations.slice(0, 5).map((location, index) => (
                  <View
                    key={location.id}
                    className="bg-gray-50 p-3 rounded-lg mb-2"
                  >
                    <View className="flex-row justify-between items-center mb-1">
                      <Text className="text-xs font-bold text-gray-800">
                        {location.type === "manual"
                          ? "🎯 Manual"
                          : location.type === "test"
                            ? "🏖️ Prueba"
                            : location.type === "random"
                              ? "🎲 Aleatoria"
                              : "📍 Auto"}
                      </Text>
                      <Text className="text-xs text-gray-600">
                        {new Date(location.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                    <Text className="text-sm text-blue-600 font-mono">
                      {location.latitude.toFixed(4)},{" "}
                      {location.longitude.toFixed(4)}
                    </Text>
                    {location.accuracy && (
                      <Text className="text-xs text-gray-600 mt-1">
                        Precisión: ±{Math.round(location.accuracy)}m
                      </Text>
                    )}
                    {location.speed && (
                      <Text className="text-xs text-gray-600">
                        Velocidad: {Math.round(location.speed * 3.6)} km/h
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Sección de permisos */}
            {permissionStatus !== "granted" && (
              <View className="mx-5 p-4 bg-yellow-50 border border-yellow-200 rounded-xl mb-4">
                <Text className="text-base font-bold text-yellow-800 mb-2">
                  ⚠️ Permisos de Ubicación Requeridos
                </Text>
                <Text className="text-sm text-yellow-700 mb-4 leading-5">
                  Para usar el tracking GPS necesitas conceder permisos de
                  ubicación. Esto te permitirá enviar tu posición en tiempo
                  real.
                </Text>
                <TouchableOpacity
                  className="flex-row items-center justify-center py-3 px-4 bg-yellow-500 rounded-lg mb-2"
                  onPress={requestLocationPermissions}
                >
                  <Ionicons
                    name="location"
                    size={20}
                    color="#fff"
                    style={{ marginRight: 8 }}
                  />
                  <Text className="text-white text-base font-semibold">
                    🔓 Solicitar Permisos
                  </Text>
                </TouchableOpacity>
                <Text className="text-xs text-yellow-600 text-center">
                  Los permisos son necesarios para el funcionamiento de la app
                </Text>
              </View>
            )}

            {/* Espacio adicional para scroll */}
            <View className="h-5" />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

// ✅ ESTILOS ACTUALIZADOS PARA MAPA EXPANDIBLE
const mapStyles = StyleSheet.create({
  map: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  // ✅ NUEVO: Estilo para mapa expandido (pantalla completa)
  mapExpanded: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    zIndex: 999,
  },
  // ✅ CONTENEDOR PARA BOTONES FLOTANTES
  floatingButtons: {
    position: "absolute",
    top: 40,
    right: 20,
    flexDirection: "column",
    gap: 10,
    zIndex: 1000,
  },
  // ✅ NUEVO: Botón para expandir mapa
  expandButton: {
    backgroundColor: "white",
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  centerButton: {
    backgroundColor: "white",
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});

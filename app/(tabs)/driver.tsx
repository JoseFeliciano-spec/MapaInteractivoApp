// screens/DriverScreen.tsx
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
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
  type: "manual" | "auto" | "test";
}

interface SessionStats {
  totalLocationsSent: number;
  sessionStartTime: string;
  lastLocationTime: string;
  avgAccuracy: number;
  totalDistance: number;
  isActive: boolean;
}

const WEBSOCKET_URL = `${process.env.EXPO_PUBLIC_BASE_URL}/locations`;

export default function DriverScreen() {
  const { user, logout } = useAuth();
  console.log(user);

  // Estados principales
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentLocation, setCurrentLocation] =
    useState<Location.LocationObject | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Desconectado");
  const [refreshing, setRefreshing] = useState(false);

  // Estados de configuración
  const [trackingInterval, setTrackingInterval] = useState(5); // segundos
  const [permissionStatus, setPermissionStatus] = useState<
    "granted" | "denied" | "undetermined"
  >("undetermined");

  // Estados de historial y estadísticas
  const [sentLocations, setSentLocations] = useState<SentLocation[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalLocationsSent: 0,
    sessionStartTime: new Date().toISOString(),
    lastLocationTime: "",
    avgAccuracy: 0,
    totalDistance: 0,
    isActive: false,
  });

  // Referencias
  const socketRef = useRef<Socket | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(
    null
  );
  const trackingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mapRef = useRef<MapView>(null);
  const lastLocationRef = useRef<LocationData | null>(null);

  const vehicleId = user?.vehicleId;

  // ✅ SOLICITAR PERMISOS AL INICIAR
  useEffect(() => {
    requestLocationPermissions();
    return () => {
      cleanup();
    };
  }, []);

  // ✅ FUNCIÓN: Solicitar permisos de ubicación
  const requestLocationPermissions = async () => {
    try {
      // Verificar permisos actuales
      const { status: foregroundStatus } =
        await Location.getForegroundPermissionsAsync();

      if (foregroundStatus !== "granted") {
        Alert.alert(
          "📍 Permisos de Ubicación",
          "Esta aplicación necesita acceso a tu ubicación para funcionar correctamente. ¿Deseas conceder permisos?",
          [
            {
              text: "No",
              style: "cancel",
              onPress: () => setPermissionStatus("denied"),
            },
            {
              text: "Sí",
              onPress: async () => {
                const { status } =
                  await Location.requestForegroundPermissionsAsync();
                setPermissionStatus(status);

                if (status === "granted") {
                  Alert.alert(
                    "✅ Permisos Concedidos",
                    "Ya puedes usar todas las funciones de tracking GPS."
                  );
                  await getCurrentLocation();
                } else {
                  Alert.alert(
                    "❌ Permisos Denegados",
                    "Sin permisos de ubicación, algunas funciones no estarán disponibles."
                  );
                }
              },
            },
          ]
        );
      } else {
        setPermissionStatus("granted");
        await getCurrentLocation();
      }
    } catch (error) {
      console.error("Error solicitando permisos:", error);
      Alert.alert(
        "Error",
        "No se pudieron verificar los permisos de ubicación"
      );
    }
  };

  // ✅ FUNCIÓN: Obtener ubicación actual
  const getCurrentLocation = async (): Promise<LocationData | null> => {
    if (permissionStatus !== "granted") {
      Alert.alert(
        "❌ Permisos Requeridos",
        "Necesitas conceder permisos de ubicación primero."
      );
      return null;
    }

    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
      });

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
      return locationData;
    } catch (error) {
      console.error("Error obteniendo ubicación:", error);
      Alert.alert("❌ Error", "No se pudo obtener la ubicación actual");
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

      socket.on("error", (errorData) => {
        console.error("❌ Error del servidor:", errorData);
        Alert.alert("❌ Error", errorData.message || "Error del servidor");
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
    setSessionStats((prev) => ({ ...prev, isActive: false }));
  };

  // ✅ FUNCIÓN: Calcular distancia entre dos puntos
  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371; // Radio de la Tierra en km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // Convertir a metros
  };

  // ✅ FUNCIÓN: Enviar ubicación al servidor
  const sendLocation = (
    locationData: LocationData,
    type: "manual" | "auto" | "test" = "auto"
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

    // Agregar al historial
    const sentLocation: SentLocation = {
      ...locationData,
      id: Date.now().toString(),
      type,
    };

    setSentLocations((prev) => [sentLocation, ...prev.slice(0, 99)]);

    // Actualizar estadísticas
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

      // Calcular distancia recorrida
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
        "Necesitas permisos de ubicación para usar el tracking"
      );
      return;
    }

    try {
      setIsTracking(true);

      // Obtener ubicación inicial
      const initialLocation = await getCurrentLocation();
      if (initialLocation) {
        sendLocation(initialLocation, "auto");
      }

      // Configurar tracking continuo
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: trackingInterval * 1000,
          distanceInterval: 5, // 5 metros
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

      // Backup con setInterval
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

  // ✅ FUNCIÓN: Usar ubicación de prueba en Cartagena
  const useCartagenaTestLocation = async () => {
    const testCoords = generateCartagenaTestLocation();
    const testLocation: LocationData = {
      latitude: testCoords.latitude,
      longitude: testCoords.longitude,
      accuracy: 15,
      timestamp: new Date().toISOString(),
    };

    // Simular que es la ubicación actual
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

    // Centrar mapa en la nueva ubicación
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
      `Ubicación simulada en Cartagena:\nLat: ${testLocation.latitude.toFixed(
        4
      )}\nLng: ${testLocation.longitude.toFixed(4)}`
    );
  };

  // ✅ FUNCIÓN: Centrar mapa en ubicación actual
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

  // Generar coordenadas para la ruta del historial
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
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Mapa */}
      <MapView
        ref={mapRef}
        style={styles.map}
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
      >
        {/* Marcador de ubicación actual */}
        {currentLocation && (
          <>
            <Marker
              coordinate={currentLocation.coords}
              title="🚗 Mi Ubicación"
              description={`Precisión: ${Math.round(
                currentLocation.coords.accuracy || 0
              )}m`}
              pinColor={isTracking ? "#34C759" : "#007AFF"}
            />

            {/* Círculo de precisión */}
            <Circle
              center={currentLocation.coords}
              radius={currentLocation.coords.accuracy || 20}
              strokeColor={
                isTracking ? "rgba(52, 199, 89, 0.5)" : "rgba(0, 122, 255, 0.5)"
              }
              fillColor={
                isTracking ? "rgba(52, 199, 89, 0.2)" : "rgba(0, 122, 255, 0.2)"
              }
            />
          </>
        )}

        {/* Marcadores del historial */}
        {sentLocations.slice(0, 10).map((location, index) => (
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
                  : "📍"
            } Ubicación ${location.type}`}
            description={new Date(location.timestamp).toLocaleTimeString()}
            pinColor={
              location.type === "manual"
                ? "#9F7AEA"
                : location.type === "test"
                  ? "#F6AD55"
                  : "#4299E1"
            }
            opacity={1 - index * 0.1}
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

      {/* Botón flotante para centrar mapa */}
      <TouchableOpacity
        style={styles.centerButton}
        onPress={centerMapOnCurrentLocation}
        disabled={!currentLocation}
      >
        <Ionicons
          name="locate"
          size={24}
          color={currentLocation ? "#007AFF" : "#C7C7CC"}
        />
      </TouchableOpacity>

      {/* Panel de controles */}
      <View style={styles.controls}>
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
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                👋 Hola, {user?.email || "Driver"}
              </Text>
              <Text style={styles.subtitle}>Vehículo: {vehicleId}</Text>
            </View>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.logoutButton}
            >
              <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
            </TouchableOpacity>
          </View>

          {/* Estados */}
          <View style={styles.statusSection}>
            <View style={styles.statusItem}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isConnected ? "#34C759" : "#FF3B30",
                  },
                ]}
              />
              <Text style={styles.statusText}>{connectionStatus}</Text>
            </View>

            <View style={styles.statusItem}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isTracking ? "#34C759" : "#8E8E93",
                  },
                ]}
              />
              <Text style={styles.statusText}>
                Tracking: {isTracking ? "Activo" : "Inactivo"}
              </Text>
            </View>

            <View style={styles.statusItem}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      permissionStatus === "granted" ? "#34C759" : "#FF9500",
                  },
                ]}
              />
              <Text style={styles.statusText}>
                GPS:{" "}
                {permissionStatus === "granted" ? "Autorizado" : "Sin permisos"}
              </Text>
            </View>
          </View>

          {/* Estadísticas de sesión */}
          {sessionStats.isActive && (
            <View style={styles.statsSection}>
              <Text style={styles.sectionTitle}>📊 Estadísticas de Sesión</Text>
              <View style={styles.statsGrid}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>
                    {sessionStats.totalLocationsSent}
                  </Text>
                  <Text style={styles.statLabel}>Ubicaciones</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{getSessionDuration()}</Text>
                  <Text style={styles.statLabel}>Duración</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>
                    {sessionStats.avgAccuracy.toFixed(0)}m
                  </Text>
                  <Text style={styles.statLabel}>Precisión Avg</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>
                    {(sessionStats.totalDistance / 1000).toFixed(1)}km
                  </Text>
                  <Text style={styles.statLabel}>Distancia</Text>
                </View>
              </View>
            </View>
          )}

          {/* Controles principales */}
          <View style={styles.controlsSection}>
            {/* Conexión */}
            <TouchableOpacity
              style={[
                styles.button,
                isConnected ? styles.buttonSecondary : styles.buttonPrimary,
                isConnecting && styles.buttonDisabled,
              ]}
              onPress={isConnected ? disconnectFromServer : connectToServer}
              disabled={isConnecting}
            >
              <Ionicons
                name={isConnected ? "wifi-off" : "wifi"}
                size={20}
                color="#fff"
                style={styles.buttonIcon}
              />
              <Text style={styles.buttonText}>
                {isConnecting
                  ? "Conectando..."
                  : isConnected
                    ? "🔌 Desconectar"
                    : "📡 Conectar al Servidor"}
              </Text>
            </TouchableOpacity>

            {/* Tracking GPS */}
            <TouchableOpacity
              style={[
                styles.button,
                isTracking ? styles.buttonDanger : styles.buttonSuccess,
                !isConnected && styles.buttonDisabled,
              ]}
              onPress={isTracking ? stopTracking : startTracking}
              disabled={!isConnected || permissionStatus !== "granted"}
            >
              <Ionicons
                name={isTracking ? "pause" : "play"}
                size={20}
                color="#fff"
                style={styles.buttonIcon}
              />
              <Text style={styles.buttonText}>
                {isTracking ? "⏹️ Detener Tracking" : "🚀 Iniciar Tracking GPS"}
              </Text>
            </TouchableOpacity>

            {/* Configuración de intervalo */}
            {!isTracking && (
              <View style={styles.intervalSection}>
                <Text style={styles.intervalLabel}>
                  Intervalo de envío: {trackingInterval}s
                </Text>
                <View style={styles.intervalButtons}>
                  {[2, 5, 10, 15, 30].map((interval) => (
                    <TouchableOpacity
                      key={interval}
                      style={[
                        styles.intervalButton,
                        trackingInterval === interval &&
                          styles.intervalButtonActive,
                      ]}
                      onPress={() => setTrackingInterval(interval)}
                    >
                      <Text
                        style={[
                          styles.intervalButtonText,
                          trackingInterval === interval &&
                            styles.intervalButtonTextActive,
                        ]}
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
          <View style={styles.actionsSection}>
            <TouchableOpacity
              style={[
                styles.actionButton,
                styles.actionButtonPrimary,
                !isConnected && styles.buttonDisabled,
              ]}
              onPress={sendCurrentLocationManually}
              disabled={!isConnected}
            >
              <Ionicons name="navigate" size={18} color="#007AFF" />
              <Text style={styles.actionButtonText}>
                📍 Enviar Ubicación Manual
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonSecondary]}
              onPress={useCartagenaTestLocation}
            >
              <Ionicons name="location" size={18} color="#F6AD55" />
              <Text style={styles.actionButtonText}>
                🏖️ Ubicación de Prueba (Cartagena)
              </Text>
            </TouchableOpacity>

            {sentLocations.length > 0 && (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonDanger]}
                onPress={clearHistory}
              >
                <Ionicons name="trash" size={18} color="#FF3B30" />
                <Text style={styles.actionButtonText}>
                  🗑️ Limpiar Historial
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Historial de ubicaciones */}
          {sentLocations.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>
                📍 Últimas Ubicaciones ({sentLocations.length})
              </Text>
              {sentLocations.slice(0, 5).map((location, index) => (
                <View key={location.id} style={styles.historyItem}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyType}>
                      {location.type === "manual"
                        ? "🎯 Manual"
                        : location.type === "test"
                          ? "🏖️ Prueba"
                          : "📍 Auto"}
                    </Text>
                    <Text style={styles.historyTime}>
                      {new Date(location.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                  <Text style={styles.historyCoords}>
                    {location.latitude.toFixed(4)},{" "}
                    {location.longitude.toFixed(4)}
                  </Text>
                  {location.accuracy && (
                    <Text style={styles.historyAccuracy}>
                      Precisión: ±{Math.round(location.accuracy)}m
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Información de permisos */}
          {permissionStatus !== "granted" && (
            <View style={styles.permissionSection}>
              <Text style={styles.permissionTitle}>
                ⚠️ Permisos de Ubicación
              </Text>
              <Text style={styles.permissionText}>
                Para usar todas las funciones, necesitas conceder permisos de
                ubicación.
              </Text>
              <TouchableOpacity
                style={[styles.button, styles.buttonWarning]}
                onPress={requestLocationPermissions}
              >
                <Ionicons
                  name="location"
                  size={20}
                  color="#fff"
                  style={styles.buttonIcon}
                />
                <Text style={styles.buttonText}>🔓 Solicitar Permisos</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Espacio adicional para scroll */}
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  map: {
    flex: 1,
  },
  centerButton: {
    position: "absolute",
    top: 60,
    right: 20,
    backgroundColor: "white",
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  controls: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "white",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: height * 0.7,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  logoutButton: {
    padding: 8,
  },
  statusSection: {
    padding: 20,
    paddingTop: 15,
    paddingBottom: 15,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  statusText: {
    fontSize: 14,
    color: "#666",
  },
  statsSection: {
    padding: 20,
    paddingTop: 0,
    paddingBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  statsGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#007AFF",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  controlsSection: {
    padding: 20,
    paddingTop: 10,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  buttonPrimary: {
    backgroundColor: "#007AFF",
  },
  buttonSecondary: {
    backgroundColor: "#8E8E93",
  },
  buttonSuccess: {
    backgroundColor: "#34C759",
  },
  buttonDanger: {
    backgroundColor: "#FF3B30",
  },
  buttonWarning: {
    backgroundColor: "#FF9500",
  },
  buttonDisabled: {
    backgroundColor: "#C7C7CC",
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  intervalSection: {
    marginTop: 10,
    marginBottom: 10,
  },
  intervalLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 10,
    textAlign: "center",
  },
  intervalButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  intervalButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  intervalButtonActive: {
    backgroundColor: "#007AFF",
  },
  intervalButtonText: {
    fontSize: 14,
    color: "#666",
  },
  intervalButtonTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  actionsSection: {
    padding: 20,
    paddingTop: 0,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  actionButtonPrimary: {
    backgroundColor: "#f0f8ff",
    borderColor: "#007AFF",
  },
  actionButtonSecondary: {
    backgroundColor: "#fff8f0",
    borderColor: "#F6AD55",
  },
  actionButtonDanger: {
    backgroundColor: "#fff0f0",
    borderColor: "#FF3B30",
  },
  actionButtonText: {
    fontSize: 14,
    marginLeft: 8,
    color: "#333",
  },
  historySection: {
    padding: 20,
    paddingTop: 0,
  },
  historyItem: {
    backgroundColor: "#f8f9fa",
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  historyType: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#333",
  },
  historyTime: {
    fontSize: 11,
    color: "#666",
  },
  historyCoords: {
    fontSize: 13,
    color: "#007AFF",
    fontFamily: "monospace",
  },
  historyAccuracy: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  permissionSection: {
    padding: 20,
    paddingTop: 0,
    backgroundColor: "#fff9e6",
    margin: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FFD60A",
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#B25000",
    marginBottom: 8,
  },
  permissionText: {
    fontSize: 14,
    color: "#B25000",
    marginBottom: 15,
    lineHeight: 20,
  },
});

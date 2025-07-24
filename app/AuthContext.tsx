// context/AuthContext.tsx
import { useRouter, useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Alert } from "react-native";

const API_URL = `${process.env.EXPO_PUBLIC_BASE_URL}/v1`; // Cambia por tu IP

console.log(API_URL);

interface User {
  id: string;
  email: string;
  role: string;
  name?: string;
  vehicleId?: string | null;
}

interface AuthContextData {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

function useProtectedRoute(user: User | null, isLoading: boolean) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const currentPath = `/${segments.join("/")}` || "/";
    const isAuthenticated = !!user;

    console.log("Current path:", currentPath);
    console.log("Is authenticated:", isAuthenticated);

    // Rutas según tu estructura
    // /(tabs) = login (index.tsx)
    // /(tabs)/driver = pantalla del driver

    const isLoginRoute = currentPath === "/(tabs)" || currentPath === "/";
    const isDriverRoute = currentPath.startsWith("/(tabs)/driver");

    if (!isAuthenticated && isDriverRoute) {
      console.log("Redirecting to login: not authenticated");
      router.replace("/(tabs)"); // Redirige al login
    } else if (isAuthenticated && isLoginRoute) {
      console.log("Redirecting to driver: already authenticated");
      router.replace("/(tabs)/driver"); // Redirige al driver
    }
  }, [user, segments, router, isLoading]);
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useProtectedRoute(user, isLoading);

  useEffect(() => {
    loadUserFromStorage();
  }, []);

  const loadUserFromStorage = async () => {
    try {
      console.log("Loading user from storage...");
      setIsLoading(true);
      const token = await SecureStore.getItemAsync("accessToken");

      if (token) {
        console.log("Token found, fetching user data...");
        const response = await fetch(`${API_URL}/user/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const userData = await response.json();
          console.log("User data loaded successfully");
          setUser(userData.data);
        } else {
          console.log("Token invalid, removing...");
          await SecureStore.deleteItemAsync("accessToken");
        }
      } else {
        console.log("No token found");
      }
    } catch (e) {
      console.error("Failed to load user from storage", e);
      try {
        await SecureStore.deleteItemAsync("accessToken");
      } catch (deleteError) {
        console.error("Error deleting invalid token:", deleteError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<void> => {
    try {
      console.log("Attempting login for:", email);
      setIsLoading(true);

      const response = await fetch(`${API_URL}/user/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data: any = await response.json();
      console.log(data);
      if (response.ok && data.data?.access_token) {
        const { access_token } = data.data;
        await SecureStore.setItemAsync("accessToken", access_token);

        // Fetch user data
        const userResponse = await fetch(`${API_URL}/user/me`, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          console.log("Login successful");
          setUser(userData.data);
        } else {
          throw new Error("Failed to fetch user data after login");
        }
      } else {
        Alert.alert(
          "Error de inicio de sesión",
          data.message || "Credenciales incorrectas."
        );
        throw new Error(data.message || "Login failed");
      }
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert("Error de red", "No se pudo conectar al servidor.");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      console.log("Logging out...");
      await SecureStore.deleteItemAsync("accessToken");
      setUser(null);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

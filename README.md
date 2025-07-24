# 📍 Mapa Interactivo con Expo

**Mapa Interactivo** es una aplicación móvil desarrollada con **React Native** y **Expo**, diseñada para funcionar como cliente en un sistema de seguimiento de ubicación en tiempo real. Permite a conductores iniciar sesión, conectarse a un servidor mediante WebSockets y transmitir su posición geográfica, la cual puede ser visualizada en un mapa interactivo.

---

## ✨ Características Principales

- 🔐 **Autenticación de Usuarios**: Inicio de sesión seguro para conductores.
- 🛰️ **Seguimiento GPS en Tiempo Real**: Envío automático de la ubicación del conductor utilizando el GPS del dispositivo.
- 🗺️ **Mapa Interactivo**: Visualización en tiempo real de la ubicación actual, ruta histórica y precisión de la señal GPS usando `react-native-maps`.
- 🔄 **Comunicación WebSocket**: Conexión en tiempo real con el servidor mediante `socket.io-client`.
- 📊 **Estadísticas de Sesión**: Visualización de métricas clave como distancia recorrida, duración de la sesión y número de ubicaciones enviadas.
- 🧪 **Herramientas de Prueba y Simulación**:
  - Generación de rutas y ubicaciones aleatorias dentro de Cartagena (Colombia).
  - Envío manual de ubicación actual.
  - Simulación completa de una ruta aleatoria.
- 🔐 **Manejo de Permisos**: Gestión robusta de permisos de ubicación, guiando al usuario en el proceso de activación.
- 🧭 **Mapa Expandible**: Posibilidad de expandir el mapa a pantalla completa para mayor claridad.

---

## 🧰 Tecnologías Utilizadas

- **Framework**: React Native con Expo
- **Lenguaje**: TypeScript
- **Navegación**: React Navigation + Expo Router
- **Estilos**: NativeWind (Tailwind CSS adaptado a React Native)
- **Mapas**: `react-native-maps`
- **Ubicación**: `expo-location`
- **Comunicación en Tiempo Real**: `socket.io-client`
- **Almacenamiento Seguro**: `expo-secure-store` (para mantener la sesión)
- **Linter**: ESLint

---

## ⚙️ Requisitos Previos

- Node.js (versión LTS recomendada)
- Expo CLI instalado globalmente (`npm install -g expo-cli`)
- Cuenta y backend funcional con endpoints de autenticación y WebSocket

---

## 📥 Instalación y Configuración

1. **Clonar el repositorio:**

   ```bash
   git clone https://github.com/JoseFeliciano-spec/MapaInteractivoApp.git
   cd MapaInteractivoApp
``

2. **Instalar dependencias:**

   ```bash
   npm install
   ```

3. **Configurar variables de entorno:**

   Crea un archivo `.env` en la raíz del proyecto y agrega:

   ```env
   EXPO_PUBLIC_BASE_URL=https://tuservidor.api.com
   ```

   > Reemplaza `https://tuservidor.api.com` por la URL real de tu backend.

---

## ▶️ Ejecutar la Aplicación

* **Iniciar en modo desarrollo (Expo):**

  ```bash
  npm start
  ```

  Esto abrirá Expo DevTools en el navegador. Puedes escanear el código QR con la app **Expo Go** para probar en tu dispositivo móvil.

* **Ejecutar en Android (emulador o dispositivo):**

  ```bash
  npm run android
  ```

* **Ejecutar en iOS (requiere macOS y Xcode):**

  ```bash
  npm run ios
  ```

---

## 🌍 Estructura del Proyecto

```plaintext
.
├── app/
│   ├── (tabs)/           # Navegación por pestañas
│   │   ├── _layout.tsx   # Layout de pestañas
│   │   ├── driver.tsx    # Pantalla principal con mapa y controles
│   │   └── index.tsx     # Pantalla de inicio de sesión
│   ├── AuthContext.tsx   # Contexto de autenticación
│   └── _layout.tsx       # Layout raíz
├── assets/               # Recursos estáticos (imágenes, fuentes)
├── components/           # Componentes reutilizables
├── constants/            # Constantes globales (colores, textos)
├── hooks/                # Hooks personalizados
├── scripts/              # Funciones utilitarias
├── .env                  # Variables de entorno (no versionado)
├── package.json          # Dependencias y scripts del proyecto
└── tailwind.config.js    # Configuración de NativeWind
```

---

## 🌐 API y Variables de Entorno

### `EXPO_PUBLIC_BASE_URL`

Esta variable es necesaria para conectarse al backend. Debe apuntar al dominio base de la API que proporciona los siguientes endpoints:

* 🔑 **Autenticación**:

  * `POST /v1/user/login` – Inicio de sesión
  * `GET /v1/user/me` – Obtener usuario actual

* 📡 **Ubicación (WebSockets)**:

  * Espacio de nombres: `/locations`

---

## 🖼️ Capturas de Pantalla

Agrega aquí algunas imágenes ilustrativas del funcionamiento de la aplicación. Guarda las capturas en una carpeta como `assets/screenshots/` o similar.

### 🗺️ Mapa en Tiempo Real

![Mapa en Tiempo Real](./assets/screenshots/mapa-tiempo-real.png)

### 🔐 Pantalla de Inicio de Sesión

<img width="577" height="990" alt="image" src="https://github.com/user-attachments/assets/72e58089-44e9-4808-9a6e-c8ec92eb7829" />


### 📊 Estadísticas de Sesión

<img width="564" height="1016" alt="image" src="https://github.com/user-attachments/assets/7fdfb2c2-cc56-4263-b199-4ddd5ad9af32" />

### 📊 Pantalla de Mapa - Conductor (Sin iniciar sesión)

<img width="578" height="1023" alt="image" src="https://github.com/user-attachments/assets/eb5cf612-113a-4b69-ba16-ae79ea9f565f" />

### 📊 Pantalla de Mapa - Conductor (Sesión iniciada)

<img width="578" height="998" alt="image" src="https://github.com/user-attachments/assets/8f6d625d-c354-41d8-b14f-b07f30cb30dd" />

### 📊 Pantalla de Mapa - Todas las opciones
<img width="583" height="1046" alt="image" src="https://github.com/user-attachments/assets/b60bcc01-9e33-4180-bd77-dab4ecd4a3b7" />

### 📊 Pantalla de Mapa - Visibilidad de todo el apa
<img width="582" height="1010" alt="image" src="https://github.com/user-attachments/assets/497aafc6-2297-4858-9d9f-59190e95e978" />

---

## 🧑‍💻 Autor

Desarrollado por **@josefeliciano-spec**

---

## 📝 Licencia

Este proyecto está licenciado bajo la [Licencia MIT](LICENSE).

---

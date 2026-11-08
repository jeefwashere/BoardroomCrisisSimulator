# Local WiFi access

The running development frontend is available at `http://192.168.2.120:5173/` on the current WiFi network. Other participants use that address and join the same room code. The host computer and services must remain running. The address can change after reconnecting to another network.

Only the frontend listener changed. The existing backend stays on loopback port 8000, preserving rooms, hosted model settings and disabled speech. The ignored `my-app/.local/vite-lan.config.ts` extends the existing Vite configuration, listens on port 5173 across local interfaces and proxies `/api`, `/docs` and `/openapi.json` to the backend. `VITE_API_BASE_URL` is empty so clients use their frontend origin. The proxy preserves Host and forwards the original protocol; unrelated request origins still receive 403.

Frontend build, LAN page and API health, scenarios, authentication, host create, guest join and host snapshot checks passed through the WiFi IP. The fixture stayed in the lobby and made no model or paid provider call. Localhost access remains available. The development HMR WebSocket connected; gameplay itself still uses HTTP polling. A second physical device has not yet been tested. See [sanitized LAN checks](evidence/local-wifi-20261108.json).

Microphone recording on another device requires a secure HTTPS context with a trusted certificate. The current HTTP LAN address supports the room, text chat and voting flow. HTTPS, certificate trust, router settings, firewall settings and public tunnels were not changed. See [MDN microphone context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [Vite server configuration](https://vite.dev/config/server-options).

No application business source was changed for this activation. The local runtime configuration, process IDs and logs remain in ignored local state.

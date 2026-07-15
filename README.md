# PayZen CreatePayment — backend + frontend separados

Proyecto dividido en dos carpetas independientes:

- **`backend/`** — API pura en Node.js (sin dependencias externas). Habla con PayZen (`Charge/CreatePayment`), recibe IPN/success/refused, y expone `/api/countries`, `/api/config`, `/api/payments`. Corre en `http://localhost:3001` por defecto.
- **`frontend/`** — archivos estáticos (HTML/JS/CSS) servidos por un mini servidor Node. Corre en `http://localhost:3000` por defecto, y habla con el backend vía `window.API_BASE_URL` (definido en `frontend/public/config.js`).

## Arranque

**Backend**
```bash
cd backend
cp .env.example .env   # o crea tu propio .env con tus credenciales
npm start
```

**Frontend** (en otra terminal)
```bash
cd frontend
npm start
```

Abre `http://localhost:3000`.

## Conectar frontend con backend

Edita `frontend/public/config.js`:
```js
window.API_BASE_URL = 'http://localhost:3001'; // o tu URL de backend en producción/ngrok
```

## Callbacks de PayZen

Solo el **backend** necesita ser accesible públicamente (vía ngrok, Cloudflare Tunnel, etc.), porque PayZen le manda el IPN directo. Configura en `backend/.env`:
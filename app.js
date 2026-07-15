const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');

if (!countryCode || !acquirerId) {
  window.location.href = './index.html';
}

const form = document.querySelector('#payment-form');
const status = document.querySelector('#status');
const checkout = document.querySelector('#checkout');
const qrCheckout = document.querySelector('#qr-checkout');
const resultBox = document.querySelector('#result');

let currentCountry = null;
let qrPollTimer = null;
let qrCountdownTimer = null;

function statusText(message) { status.textContent = message; }

async function sendClientResult(answer) {
  try {
    await fetch(`${window.API_BASE_URL}/api/payments/client-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer) });
    refreshEvents();
  } catch { /* El resultado visual no depende del registro de prueba. */ }
}

function showResult(text, paid) {
  checkout.hidden = true; qrCheckout.hidden = true; resultBox.hidden = false;
  resultBox.className = `result ${paid ? 'paid' : 'failed'}`;
  resultBox.textContent = text;
}

function showCardResult(answer) {
  const paid = answer?.orderStatus === 'PAID';
  const units = answer?.orderDetails?.orderEffectiveAmount || 0;
  const currency = answer?.orderDetails?.orderCurrency || currentCountry?.currency || '';
  const divisor = currentCountry?.decimals === 0 ? 1 : 100;
  const decimals = currentCountry?.decimals ?? 2;
  showResult(paid ? `Pago aprobado — ${(units / divisor).toFixed(decimals)} ${currency}` : `Pago no aprobado — estado: ${answer?.orderStatus || 'DESCONOCIDO'}`, paid);
}

function loadKrypton(config) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://static.payzen.lat/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js`;
    script.setAttribute('kr-public-key', config.publicKey);
    script.onload = () => {
      const deadline = Date.now() + 15000;
      const waitForKrypton = () => {
        if (window.KR?.loaded) return resolve();
        if (Date.now() > deadline) return reject(new Error('Krypton no terminó de inicializarse.'));
        window.setTimeout(waitForKrypton, 25);
      };
      waitForKrypton();
    };
    script.onerror = () => reject(new Error('No se pudo cargar el cliente Krypton de PayZen.'));
    document.head.append(script);
  });
}

async function initializeContext() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) {
      statusText('País o adquirente no reconocido.');
      form.querySelectorAll('button').forEach(button => button.disabled = true);
      return;
    }
    const acquirer = currentCountry.acquirers[acquirerId];
    document.querySelector('#context-eyebrow').textContent = `PAYZEN · ${currentCountry.name.toUpperCase()} · ${acquirer.name.toUpperCase()}`;
    document.querySelector('#context-lead').textContent = `Pago seguro en ${currentCountry.currency} vía ${acquirer.name}.`;
    document.querySelector('#currency-label').textContent = currentCountry.currency;
    const amountInput = form.querySelector('input[name="amount"]');
    if (currentCountry.decimals === 0) { amountInput.step = '1'; amountInput.min = '1'; amountInput.value = '1000'; }
  } catch (error) {
    statusText('No se pudo cargar la configuración del país/adquirente.');
  }
}

async function initializeCardCheckout(formToken) {
  const config = await fetch(`${window.API_BASE_URL}/api/config`).then(r => r.json());
  const container = document.querySelector('#form-container');
  container.innerHTML = '<div class="kr-smart-form" kr-card-form-expanded></div>';
  await loadKrypton(config);
  await KR.setFormConfig({ formToken: formToken });
  await KR.onSubmit(async event => { showCardResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
  await KR.onError(async event => { showCardResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
  statusText('Formulario seguro cargado. Usa las tarjetas de prueba de PayZen.');
}

async function payWithCard(payload) {
  const response = await fetch(`${window.API_BASE_URL}/api/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok || !data.formToken) throw new Error(data.error || 'No se pudo crear el pago.');
  form.hidden = true;
  checkout.hidden = false;
  await initializeCardCheckout(data.formToken);
}

function stopQrPolling() {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  if (qrCountdownTimer) { clearInterval(qrCountdownTimer); qrCountdownTimer = null; }
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return '00:00';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Códigos de rechazo DEFINITIVO de Atix. Mientras no los tengas documentados,
// deja el Set vacío: cualquier código distinto de '00' se trata como "pendiente"
// y el polling sigue hasta que el QR expire.
const ATIX_FINAL_REJECTION_CODES = new Set([
  // Ejemplos cuando los tengas: '05', '51', '55'
]);

async function payWithQr(payload) {
  debugLog('send', 'POST /api/payments/qr', payload);

  const response = await fetch(`${window.API_BASE_URL}/api/payments/qr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  debugLog('recv', `POST /api/payments/qr → HTTP ${response.status}`, data);

  if (!response.ok || !data.qrHash) throw new Error(data.error || 'No se pudo generar el QR.');

  form.hidden = true;
  qrCheckout.hidden = false;

  const expiresLabel = document.querySelector('#qr-expires');
  const statusLabel = document.querySelector('#qr-status');
  statusLabel.textContent = 'Pendiente…';

  const qrContainer = document.getElementById('qr-canvas');
  qrContainer.innerHTML = '';
  await new Promise((resolve, reject) => {
    QRCode.toCanvas(
      data.qrHash,
      { width: 240, margin: 2, errorCorrectionLevel: 'L' },
      (err, canvas) => {
        if (err) return reject(new Error('No se pudo generar la imagen QR: ' + err.message));
        qrContainer.appendChild(canvas);
        resolve();
      }
    );
  });

  const expiresAt = new Date(data.expiresAt).getTime();

  qrCountdownTimer = setInterval(() => {
    const remaining = expiresAt - Date.now();
    expiresLabel.textContent = formatCountdown(remaining);
    if (remaining <= 0) {
      stopQrPolling();
      statusLabel.textContent = 'Expirado';
      showResult('El código QR expiró. Genera uno nuevo para intentar de nuevo.', false);
    }
  }, 1000);

  let pollCount = 0;
  qrPollTimer = setInterval(async () => {
    pollCount++;
    const pollUrl = `${window.API_BASE_URL}/api/payments/qr/${data.transactionId}`;

    try {
      const check = await fetch(pollUrl).then(r => r.json());

      // Solo logear cada 3 polls para no saturar, o si hay un resultado relevante
      if (pollCount % 3 === 1 || check.approved || check.resultCode) {
        debugLog('recv', `GET /api/payments/qr/${data.transactionId} (poll #${pollCount})`, check);
      }

      if (check.approved) {
        stopQrPolling();
        statusLabel.textContent = 'Aprobado';
        showResult(`Pago aprobado vía QR — ${Number(payload.amount).toFixed(currentCountry?.decimals ?? 2)} ${currentCountry?.currency || ''}`, true);
        refreshEvents();
        return;
      }

      if (check.resultCode && ATIX_FINAL_REJECTION_CODES.has(String(check.resultCode))) {
        stopQrPolling();
        statusLabel.textContent = 'Rechazado';
        showResult(`Pago no aprobado — código: ${check.resultCode}`, false);
        refreshEvents();
      }
    } catch (err) {
      debugLog('recv', `GET /api/payments/qr/${data.transactionId} (poll #${pollCount}) ERROR`, { error: err.message });
    }
  }, 20000);

  statusText('Escanea el código QR desde tu billetera electrónica.');
}

let isProcessing = false;

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (isProcessing) return;
  isProcessing = true;

  const buttons = form.querySelectorAll('button');
  buttons.forEach(b => b.disabled = true);

  const method = event.submitter?.dataset.method || 'card';
  statusText(method === 'qr' ? 'Generando código QR…' : 'Creando pago…');
  try {
    const payload = { ...Object.fromEntries(new FormData(form)), country: countryCode, acquirer: acquirerId };
    if (method === 'qr') await payWithQr(payload);
    else await payWithCard(payload);
  } catch (error) {
    statusText(`Error: ${error.message}`);
    buttons.forEach(b => b.disabled = false);
    isProcessing = false;
  }
});

async function refreshEvents() { const res = await fetch(`${window.API_BASE_URL}/api/payments`); const data = await res.json(); document.querySelector('#events').textContent = data.length ? JSON.stringify(data, null, 2) : 'Aún no hay pagos.'; }
document.querySelector('#refresh-events').addEventListener('click', refreshEvents);

initializeContext();
refreshEvents();

// ─── Debug logger ────────────────────────────────────────────────────────────
const debugEntries = [];

function debugLog(direction, label, data) {
  const ts = new Date().toLocaleTimeString('es-PE', { hour12: false, fractionalSecondDigits: 2 });
  const arrow = direction === 'send' ? '▲ SEND' : '▼ RECV';
  debugEntries.unshift({ ts, arrow, label, data });
  const el = document.querySelector('#debug-log');
  if (!el) return;
  el.textContent = debugEntries.map(e =>
    `[${e.ts}] ${e.arrow}  ${e.label}\n${JSON.stringify(e.data, null, 2)}`
  ).join('\n\n─────────────────────────────────────\n\n');
  // Abrir el panel automáticamente al primer evento
  const details = document.querySelector('#debug-details');
  if (details) details.open = true;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelector('#clear-debug')?.addEventListener('click', () => {
    debugEntries.length = 0;
    const el = document.querySelector('#debug-log');
    if (el) el.textContent = 'Limpiado.';
  });
});
// ─────────────────────────────────────────────────────────────────────────────
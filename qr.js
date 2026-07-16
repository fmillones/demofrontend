const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');
const amount = params.get('amount');
const dni = params.get('dni') || '';
const email = params.get('email') || '';

if (!countryCode || !acquirerId || !amount) {
  window.location.href = './index.html';
}

const status = document.querySelector('#status');
const resultBox = document.querySelector('#result');
const qrCheckout = document.querySelector('#qr-checkout');
const qrContainer = document.querySelector('#qr-canvas');
const expiresLabel = document.querySelector('#qr-expires');
const statusLabel = document.querySelector('#qr-status');
const btnConsultar = document.querySelector('#btn-consultar');
const sentLog = document.querySelector('#sent-log');
const receivedLog = document.querySelector('#received-log');
const ipnLog = document.querySelector('#ipn-log');

let currentCountry = null;
let qrPollTimer = null;
let qrCountdownTimer = null;
let ipnPollTimer = null;
let currentTransactionId = null;

document.querySelector('#back-link').href = `./checkout.html?country=${countryCode}&acquirer=${acquirerId}`;

function statusText(message) { status.textContent = message; }

// Las 3 cajas de log son locales a ESTE QR: nacen vacías en cada
// carga de página (un pago nuevo siempre trae un transactionId
// nuevo, así que nunca arrastran datos de intentos anteriores).
function setLog(el, label, data) {
  const time = new Date().toLocaleTimeString();
  el.textContent = `[${time}] ${label}\n${JSON.stringify(data, null, 2)}`;
  el.dataset.empty = 'false';
}

function appendLog(el, label, data) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${label}\n${JSON.stringify(data, null, 2)}`;
  const isEmpty = el.dataset.empty !== 'false';
  el.textContent = isEmpty ? line : `${el.textContent}\n\n${line}`;
  el.dataset.empty = 'false';
}

function showResult(text, paid) {
  qrCheckout.hidden = true; resultBox.hidden = false;
  resultBox.className = `result ${paid ? 'paid' : 'failed'}`;
  resultBox.textContent = text;
}

function stopAllPolling() {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  if (qrCountdownTimer) { clearInterval(qrCountdownTimer); qrCountdownTimer = null; }
  if (ipnPollTimer) { clearInterval(ipnPollTimer); ipnPollTimer = null; }
}

function formatCountdown(msRemaining) {
  if (msRemaining <= 0) return '00:00';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

async function checkStatus() {
  const check = await fetch(`${window.API_BASE_URL}/api/payments/qr/${currentTransactionId}`).then(r => r.json());
  appendLog(receivedLog, `Consulta en vivo — GET /api/payments/qr/${currentTransactionId}`, check);
  if (check.approved) {
    stopAllPolling();
    statusLabel.textContent = 'Aprobado';
    showResult(`Pago aprobado vía QR — ${Number(amount).toFixed(currentCountry?.decimals ?? 2)} ${currentCountry?.currency || ''}`, true);
  } else if (check.resultCode && check.resultCode !== '00') {
    stopAllPolling();
    statusLabel.textContent = 'Rechazado';
    showResult(`Pago no aprobado — código: ${check.resultCode}`, false);
  }
  return check;
}

// Pregunta al backend, cada 3s, si ya llegó el webhook de Atix
// (ATIX_WEBHOOK) para ESTE transactionId. Lee el registro local
// (GET /api/payments/qr/record/:id) en vez de llamar a Atix de nuevo.
function startIpnPolling() {
  ipnPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${window.API_BASE_URL}/api/payments/qr/record/${currentTransactionId}`);
      if (!res.ok) return;
      const record = await res.json();
      const webhookEvents = (record.events || []).filter(event => event.type === 'ATIX_WEBHOOK');
      if (webhookEvents.length) {
        setLog(ipnLog, `Webhook de Atix recibido (${webhookEvents.length})`, webhookEvents);
        clearInterval(ipnPollTimer);
        ipnPollTimer = null;
      }
    } catch { /* Reintenta en el siguiente ciclo. */ }
  }, 3000);
}

function paintSummary(country, acquirer) {
  document.querySelector('#sum-country').textContent = country.name;
  document.querySelector('#sum-acquirer').textContent = acquirer.name;
  const decimals = country.decimals ?? 2;
  document.querySelector('#sum-amount').textContent = `${Number(amount).toFixed(decimals)} ${country.currency}`;
  if (dni) { document.querySelector('#sum-dni-row').hidden = false; document.querySelector('#sum-dni').textContent = dni; }
  if (email) { document.querySelector('#sum-email-row').hidden = false; document.querySelector('#sum-email').textContent = email; }
}

async function start() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) { statusText('País o adquirente no reconocido.'); return; }
    const acquirer = currentCountry.acquirers[acquirerId];
    paintSummary(currentCountry, acquirer);

    statusText('Generando código QR…');
    const payload = { country: countryCode, acquirer: acquirerId, amount, dni, email };
    setLog(sentLog, 'POST /api/payments/qr', payload);

    const response = await fetch(`${window.API_BASE_URL}/api/payments/qr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    appendLog(receivedLog, 'Respuesta de POST /api/payments/qr', data);
    if (!response.ok || !data.qrHash) throw new Error(data.error || 'No se pudo generar el QR.');

    currentTransactionId = data.transactionId;
    statusLabel.textContent = 'Pendiente…';
    qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(data.qrHash)}" width="220" height="220" alt="Código QR de pago">`;
    btnConsultar.hidden = false;

    const expiresAt = new Date(data.expiresAt).getTime();
    qrCountdownTimer = setInterval(() => {
      const remaining = expiresAt - Date.now();
      expiresLabel.textContent = formatCountdown(remaining);
      if (remaining <= 0) {
        stopAllPolling();
        statusLabel.textContent = 'Expirado';
        showResult('El código QR expiró. Vuelve a intentar desde el checkout.', false);
      }
    }, 1000);

    qrPollTimer = setInterval(() => { checkStatus().catch(() => {}); }, 3000);
    startIpnPolling();

    statusText('Escanea el código QR desde tu billetera electrónica.');
  } catch (error) {
    statusText(`Error: ${error.message}`);
  }
}

btnConsultar.addEventListener('click', () => { checkStatus().catch(() => {}); });

start();
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
const debugLog = document.querySelector('#debug-log');

let currentCountry = null;
let qrPollTimer = null;
let qrCountdownTimer = null;
let currentTransactionId = null;
let debugHasEntries = false;

document.querySelector('#back-link').href = `./checkout.html?country=${countryCode}&acquirer=${acquirerId}`;

function statusText(message) { status.textContent = message; }

function logDebug(label, data) {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${label}\n${JSON.stringify(data, null, 2)}\n`;
  debugLog.textContent = debugHasEntries ? `${debugLog.textContent}\n${line}` : line;
  debugHasEntries = true;
  debugLog.scrollTop = debugLog.scrollHeight;
}
document.querySelector('#clear-debug').addEventListener('click', () => { debugLog.textContent = 'Esperando actividad…'; debugHasEntries = false; });

function showResult(text, paid) {
  qrCheckout.hidden = true; resultBox.hidden = false;
  resultBox.className = `result ${paid ? 'paid' : 'failed'}`;
  resultBox.textContent = text;
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

async function checkStatus() {
  const check = await fetch(`${window.API_BASE_URL}/api/payments/qr/${currentTransactionId}`).then(r => r.json());
  logDebug(`GET /api/payments/qr/${currentTransactionId}`, check);
  if (check.approved) {
    stopQrPolling();
    statusLabel.textContent = 'Aprobado';
    showResult(`Pago aprobado vía QR — ${Number(amount).toFixed(currentCountry?.decimals ?? 2)} ${currentCountry?.currency || ''}`, true);
    refreshEvents();
  } else if (check.resultCode && check.resultCode !== '00') {
    stopQrPolling();
    statusLabel.textContent = 'Rechazado';
    showResult(`Pago no aprobado — código: ${check.resultCode}`, false);
    refreshEvents();
  }
  return check;
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
    const response = await fetch(`${window.API_BASE_URL}/api/payments/qr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    logDebug('POST /api/payments/qr', data);
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
        stopQrPolling();
        statusLabel.textContent = 'Expirado';
        showResult('El código QR expiró. Vuelve a intentar desde el checkout.', false);
      }
    }, 1000);

    qrPollTimer = setInterval(() => { checkStatus().catch(() => {}); }, 3000);

    statusText('Escanea el código QR desde tu billetera electrónica.');
  } catch (error) { statusText(`Error: ${error.message}`); logDebug('ERROR', { message: error.message }); }
}

btnConsultar.addEventListener('click', () => { checkStatus().catch(error => logDebug('ERROR', { message: error.message })); });

async function refreshEvents() { const res = await fetch(`${window.API_BASE_URL}/api/payments/qr`); const data = await res.json(); document.querySelector('#events').textContent = data.length ? JSON.stringify(data, null, 2) : 'Aún no hay pagos.'; }
document.querySelector('#refresh-events').addEventListener('click', refreshEvents);

start();
refreshEvents();
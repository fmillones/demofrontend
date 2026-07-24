const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');

if (!countryCode || !acquirerId) {
  window.location.href = './index.html';
}

const form = document.querySelector('#token-form');
const status = document.querySelector('#status');
const checkoutSection = document.querySelector('#checkout');
const resultBox = document.querySelector('#result');
const sentLog = document.querySelector('#sent-log');
const receivedLog = document.querySelector('#received-log');
const ipnLog = document.querySelector('#ipn-log');

let currentCountry = null;
let currentOrderId = null;
let ipnPollTimer = null;
let ipnAttempts = 0;
const IPN_MAX_ATTEMPTS = 40; // ~2 minutos a 3s por intento, luego se deja de sondear

document.querySelector('#back-link').href = `./select-method.html?country=${countryCode}&acquirer=${acquirerId}`;

function statusText(message) { status.textContent = message; }

// Las 3 cajas de log son locales a ESTE token: nacen vacías en cada
// carga de página (nunca traen el historial de tokens anteriores).
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

async function sendClientResult(answer) {
  try {
    // Mismo endpoint que usa el flujo de pago: el backend busca el
    // orderId tanto en pagos como en tokens (findOrderRecord).
    await fetch(`${window.API_BASE_URL}/api/payments/client-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer) });
  } catch { /* El resultado visual no depende del registro de prueba. */ }
}

function showResult(answer) {
  const paid = answer?.orderStatus === 'PAID';
  const alias = answer?.transactions?.[0]?.paymentMethodToken || null;
  checkoutSection.hidden = true;
  resultBox.hidden = false;
  resultBox.className = `result ${paid && alias ? 'paid' : 'failed'}`;
  resultBox.textContent = (paid && alias)
    ? `Token creado — ${alias}`
    : `No se pudo crear el token — estado: ${answer?.orderStatus || 'DESCONOCIDO'}`;
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
        if (Date.now() > deadline) return reject(new Error('Krypton no terminó de inicializarse. Revisa PAYZEN_STATIC_URL y la clave pública.'));
        window.setTimeout(waitForKrypton, 25);
      };
      waitForKrypton();
    };
    script.onerror = () => reject(new Error('No se pudo cargar el cliente Krypton de PayZen.'));
    document.head.append(script);
  });
}

function paintSummary(country, acquirer) {
  document.querySelector('#sum-country').textContent = country.name;
  document.querySelector('#sum-acquirer').textContent = acquirer.name;
}

// Pregunta al backend, cada 3s, si ya llegó el IPN de PayZen para
// ESTE orderId en particular (GET /api/tokens/:orderId), nunca
// trae la lista completa de otros tokens.
function startIpnPolling(orderId) {
  ipnAttempts = 0;
  ipnPollTimer = setInterval(async () => {
    ipnAttempts += 1;
    if (ipnAttempts > IPN_MAX_ATTEMPTS) { clearInterval(ipnPollTimer); ipnPollTimer = null; return; }
    try {
      const res = await fetch(`${window.API_BASE_URL}/api/tokens/${orderId}`);
      if (!res.ok) return;
      const token = await res.json();
      const ipnEvents = (token.events || []).filter(event => event.type === 'IPN');
      if (ipnEvents.length) {
        setLog(ipnLog, `IPN recibido (${ipnEvents.length})`, ipnEvents);
        clearInterval(ipnPollTimer);
        ipnPollTimer = null;
      }
    } catch { /* Reintenta en el siguiente ciclo. */ }
  }, 3000);
}

async function initializeContext() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) {
      statusText('País o adquirente no reconocido.');
      form.querySelector('button[type="submit"]').disabled = true;
      return;
    }
    paintSummary(currentCountry, currentCountry.acquirers[acquirerId]);
  } catch (error) {
    statusText('No se pudo cargar la configuración del país/adquirente.');
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = Object.fromEntries(new FormData(form));

  try {
    submitButton.disabled = true;
    statusText('Generando token…');
    const payload = { country: countryCode, acquirer: acquirerId, email: formData.email, reference: formData.reference || '' };
    setLog(sentLog, 'POST /api/tokens', payload);

    const response = await fetch(`${window.API_BASE_URL}/api/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    appendLog(receivedLog, 'Respuesta de POST /api/tokens', data);
    if (!response.ok || !data.formToken) throw new Error(data.error || 'No se pudo generar el token.');

    currentOrderId = data.orderId;
    form.hidden = true;
    checkoutSection.hidden = false;
    startIpnPolling(currentOrderId);

    const config = await fetch(`${window.API_BASE_URL}/api/config`).then(r => r.json());
    document.querySelector('#form-container').innerHTML = '<div class="kr-smart-form" kr-card-form-expanded></div>';
    await loadKrypton(config);
    await KR.setFormConfig({ formToken: data.formToken });
    await KR.onSubmit(async submitEvent => {
      appendLog(receivedLog, 'Formulario Krypton — onSubmit', submitEvent.clientAnswer);
      showResult(submitEvent.clientAnswer);
      await sendClientResult(submitEvent.clientAnswer);
      return false;
    });
    await KR.onError(async errorEvent => {
      appendLog(receivedLog, 'Formulario Krypton — onError', errorEvent.clientAnswer);
      showResult(errorEvent.clientAnswer);
      await sendClientResult(errorEvent.clientAnswer);
      return false;
    });
    statusText('Formulario seguro cargado. Usa las tarjetas de prueba de PayZen.');
  } catch (error) {
    statusText(`Error: ${error.message}`);
    form.hidden = false;
    checkoutSection.hidden = true;
    submitButton.disabled = false;
  }
});

initializeContext();
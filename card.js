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
const checkoutSection = document.querySelector('#checkout');
const sentLog = document.querySelector('#sent-log');
const receivedLog = document.querySelector('#received-log');
const ipnLog = document.querySelector('#ipn-log');

let currentCountry = null;
let currentOrderId = null;
let ipnPollTimer = null;
let ipnAttempts = 0;
const IPN_MAX_ATTEMPTS = 40; // ~2 minutos a 3s por intento, luego se deja de sondear

document.querySelector('#back-link').href = `./checkout.html?country=${countryCode}&acquirer=${acquirerId}`;

function statusText(message) { status.textContent = message; }

// Las 3 cajas de log son locales a ESTE pago: nacen vacías en cada
// carga de página (nunca traen el historial de pagos anteriores).
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

// Igual que setLog/appendLog pero para texto PURO (no JSON.stringify):
// se usa para mostrar el body crudo del IPN tal como PayZen lo mandó
// (application/x-www-form-urlencoded), solo decodificado para que se
// pueda leer, sin reformatear su estructura ni envolverlo en otro JSON.
function setRawLog(el, label, rawText) {
  const time = new Date().toLocaleTimeString();
  el.textContent = `[${time}] ${label}\n${rawText}`;
  el.dataset.empty = 'false';
}

// Decodifica application/x-www-form-urlencoded a texto legible,
// SIN tocar el contenido de cada valor (kr-answer sigue siendo el
// JSON exacto que mandó PayZen, solo separado por líneas para
// poder leerlo — no se reordena ni se reformatea nada).
function decodeRawBody(rawBody) {
  return rawBody
    .split('&')
    .map(pair => {
      const [key, value = ''] = pair.split('=');
      return `${decodeURIComponent(key)}=${decodeURIComponent(value.replace(/\+/g, ' '))}`;
    })
    .join('\n');
}

async function sendClientResult(answer) {
  try {
    await fetch(`${window.API_BASE_URL}/api/payments/client-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer) });
  } catch { /* El resultado visual no depende del registro de prueba. */ }
}

function showResult(answer) {
  const paid = answer?.orderStatus === 'PAID';
  const units = answer?.orderDetails?.orderEffectiveAmount || 0;
  const currency = answer?.orderDetails?.orderCurrency || currentCountry?.currency || '';
  const divisor = currentCountry?.decimals === 0 ? 1 : 100;
  const decimals = currentCountry?.decimals ?? 2;
  checkoutSection.hidden = true;
  resultBox.hidden = false;
  resultBox.className = `result ${paid ? 'paid' : 'failed'}`;
  resultBox.textContent = paid ? `Pago aprobado — ${(units / divisor).toFixed(decimals)} ${currency}` : `Pago no aprobado — estado: ${answer?.orderStatus || 'DESCONOCIDO'}`;
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
  const decimals = country.decimals ?? 2;
  document.querySelector('#sum-amount').textContent = `${Number(amount).toFixed(decimals)} ${country.currency}`;
  if (dni) { document.querySelector('#sum-dni-row').hidden = false; document.querySelector('#sum-dni').textContent = dni; }
  if (email) { document.querySelector('#sum-email-row').hidden = false; document.querySelector('#sum-email').textContent = email; }
}

// Pregunta al backend, cada 3s, si ya llegó el IPN de PayZen para
// ESTE orderId en particular (GET /api/payments/:orderId), nunca
// trae la lista completa de otros pagos.
function startIpnPolling(orderId) {
  ipnAttempts = 0;
  ipnPollTimer = setInterval(async () => {
    ipnAttempts += 1;
    if (ipnAttempts > IPN_MAX_ATTEMPTS) { clearInterval(ipnPollTimer); ipnPollTimer = null; return; }
    try {
      const res = await fetch(`${window.API_BASE_URL}/api/payments/${orderId}`);
      if (!res.ok) return;
      const payment = await res.json();
      const ipnEvents = (payment.events || []).filter(event => event.type === 'IPN');
      if (ipnEvents.length) {
        // Mostramos el rawBody de cada IPN PURO (decodificado, sin
        // reformatear), uno tras otro — no el objeto `answer` ya
        // parseado ni el evento completo envuelto en otro JSON.
        const rawText = ipnEvents
          .map(event => decodeRawBody(event.data?.rawBody || ''))
          .join('\n\n---\n\n');
        setRawLog(ipnLog, `IPN recibido (${ipnEvents.length})`, rawText);
        clearInterval(ipnPollTimer);
        ipnPollTimer = null;
      }
    } catch { /* Reintenta en el siguiente ciclo. */ }
  }, 3000);
}

async function start() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) { statusText('País o adquirente no reconocido.'); return; }
    const acquirer = currentCountry.acquirers[acquirerId];
    paintSummary(currentCountry, acquirer);

    statusText('Creando pago…');
    const payload = { country: countryCode, acquirer: acquirerId, amount, dni, email };
    setLog(sentLog, 'POST /api/payments', payload);

    const response = await fetch(`${window.API_BASE_URL}/api/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    appendLog(receivedLog, 'Respuesta de POST /api/payments', data);
    if (!response.ok || !data.formToken) throw new Error(data.error || 'No se pudo crear el pago.');

    currentOrderId = data.orderId;
    startIpnPolling(currentOrderId);

    const config = await fetch(`${window.API_BASE_URL}/api/config`).then(r => r.json());
    document.querySelector('#form-container').innerHTML = `
      <div class="kr-embedded" kr-card-form-expanded>
        <div class="kr-identity-document-type"></div>
        <div class="kr-identity-document-number"></div>
      </div>
    `;
    await loadKrypton(config);
    await KR.setFormConfig({ formToken: data.formToken });
    await KR.onSubmit(async event => {
      appendLog(receivedLog, 'Formulario Krypton — onSubmit', event.clientAnswer);
      showResult(event.clientAnswer);
      await sendClientResult(event.clientAnswer);
      return false;
    });
    await KR.onError(async event => {
      appendLog(receivedLog, 'Formulario Krypton — onError', event.clientAnswer);
      showResult(event.clientAnswer);
      await sendClientResult(event.clientAnswer);
      return false;
    });
    statusText('Formulario seguro cargado. Usa las tarjetas de prueba de PayZen.');
  } catch (error) {
    statusText(`Error: ${error.message}`);
  }
}

start();
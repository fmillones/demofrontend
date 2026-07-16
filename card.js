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

let currentCountry = null;

document.querySelector('#back-link').href = `./checkout.html?country=${countryCode}&acquirer=${acquirerId}`;

function statusText(message) { status.textContent = message; }

async function sendClientResult(answer) {
  try {
    await fetch(`${window.API_BASE_URL}/api/payments/client-result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer) });
    refreshEvents();
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

async function start() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) { statusText('País o adquirente no reconocido.'); return; }
    const acquirer = currentCountry.acquirers[acquirerId];
    paintSummary(currentCountry, acquirer);

    statusText('Creando pago…');
    const payload = { country: countryCode, acquirer: acquirerId, amount, dni, email };
    const response = await fetch(`${window.API_BASE_URL}/api/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok || !data.formToken) throw new Error(data.error || 'No se pudo crear el pago.');

    const config = await fetch(`${window.API_BASE_URL}/api/config`).then(r => r.json());
    document.querySelector('#form-container').innerHTML = '<div class="kr-smart-form" kr-card-form-expanded></div>';
    await loadKrypton(config);
    await KR.setFormConfig({ formToken: data.formToken });
    await KR.onSubmit(async event => { showResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
    await KR.onError(async event => { showResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
    statusText('Formulario seguro cargado. Usa las tarjetas de prueba de PayZen.');
  } catch (error) { statusText(`Error: ${error.message}`); }
}

async function refreshEvents() { const res = await fetch(`${window.API_BASE_URL}/api/payments`); const data = await res.json(); document.querySelector('#events').textContent = data.length ? JSON.stringify(data, null, 2) : 'Aún no hay pagos.'; }
document.querySelector('#refresh-events').addEventListener('click', refreshEvents);

start();
refreshEvents();
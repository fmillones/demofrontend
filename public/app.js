const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');

if (!countryCode || !acquirerId) {
  window.location.href = '/index.html';
}

const form = document.querySelector('#payment-form');
const status = document.querySelector('#status');
const checkout = document.querySelector('#checkout');
const resultBox = document.querySelector('#result');

let currentCountry = null;

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
  checkout.hidden = true; resultBox.hidden = false;
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

async function initializeContext() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    currentCountry = countries[countryCode];
    if (!currentCountry || !currentCountry.acquirers[acquirerId]) {
      statusText('País o adquirente no reconocido.');
      form.querySelector('button').disabled = true;
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

async function initializeCheckout(formToken) {
  const config = await fetch(`${window.API_BASE_URL}/api/config`).then(r => r.json());

  const container = document.querySelector('#form-container');
  container.innerHTML =
    '<div class="kr-smart-form" kr-card-form-expanded></div>';

  await loadKrypton(config);

  await KR.setFormConfig({
    formToken: formToken
  });
  await KR.onSubmit(async event => { showResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
  await KR.onError(async event => { showResult(event.clientAnswer); await sendClientResult(event.clientAnswer); return false; });
  statusText('Formulario seguro cargado. Usa las tarjetas de prueba de PayZen.');
}

form.addEventListener('submit', async event => {
  event.preventDefault(); statusText('Creando pago…');
  try {
    const payload = { ...Object.fromEntries(new FormData(form)), country: countryCode, acquirer: acquirerId };
    const response = await fetch(`${window.API_BASE_URL}/api/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok || !data.formToken) throw new Error(data.error || 'No se pudo crear el pago.');
    form.hidden = true;
    checkout.hidden = false;

    await initializeCheckout(data.formToken);
  } catch (error) { statusText(`Error: ${error.message}`); }
});

async function refreshEvents() { const res = await fetch(`${window.API_BASE_URL}/api/payments`); const data = await res.json(); document.querySelector('#events').textContent = data.length ? JSON.stringify(data, null, 2) : 'Aún no hay pagos.'; }
document.querySelector('#refresh-events').addEventListener('click', refreshEvents);

initializeContext();
refreshEvents();
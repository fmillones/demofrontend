const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');

if (!countryCode || !acquirerId) {
  window.location.href = './index.html';
}

const form = document.querySelector('#payment-form');
const status = document.querySelector('#status');

function statusText(message) { status.textContent = message; }

async function initializeContext() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    const country = countries[countryCode];
    if (!country || !country.acquirers[acquirerId]) {
      statusText('País o adquirente no reconocido.');
      form.querySelectorAll('button').forEach(button => button.disabled = true);
      return;
    }
    const acquirer = country.acquirers[acquirerId];
    document.querySelector('#context-eyebrow').textContent = `PAYZEN · ${country.name.toUpperCase()} · ${acquirer.name.toUpperCase()}`;
    document.querySelector('#context-lead').textContent = `Pago seguro en ${country.currency} vía ${acquirer.name}.`;
    document.querySelector('#currency-label').textContent = country.currency;
    const amountInput = form.querySelector('input[name="amount"]');
    if (country.decimals === 0) { amountInput.step = '1'; amountInput.min = '1'; amountInput.value = '1000'; }
  } catch (error) {
    statusText('No se pudo cargar la configuración del país/adquirente.');
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const method = event.submitter?.dataset.method || 'card';
  const formData = Object.fromEntries(new FormData(form));
  const query = new URLSearchParams({
    country: countryCode,
    acquirer: acquirerId,
    amount: formData.amount,
    dni: formData.dni || '',
    email: formData.email || ''
  });
  window.location.href = `${method === 'qr' ? './qr.html' : './card.html'}?${query.toString()}`;
});

initializeContext();
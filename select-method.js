const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const acquirerId = params.get('acquirer');

if (!countryCode || !acquirerId) {
  window.location.href = './index.html';
}

const status = document.querySelector('#status');

document.querySelector('#back-link').href = `./acquirer.html?country=${countryCode}`;

async function initializeContext() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    const country = countries[countryCode];
    if (!country || !country.acquirers[acquirerId]) {
      status.textContent = 'País o adquirente no reconocido.';
      document.querySelectorAll('.method-card').forEach(button => button.disabled = true);
      return;
    }
    const acquirer = country.acquirers[acquirerId];
    document.querySelector('#context-eyebrow').textContent = `PAYZEN · ${country.name.toUpperCase()} · ${acquirer.name.toUpperCase()}`;
    document.querySelector('#context-lead').textContent = `Elige si quieres realizar un pago o solo registrar el token de una tarjeta con ${acquirer.name}.`;
  } catch (error) {
    status.textContent = 'No se pudo cargar la configuración del país/adquirente.';
  }
}

// Cada botón simplemente navega al flujo correspondiente, llevando
// país y adquirente en la query string, igual que el resto del flujo.
document.querySelector('#btn-pay').addEventListener('click', () => {
  window.location.href = `./checkout.html?country=${countryCode}&acquirer=${acquirerId}`;
});
document.querySelector('#btn-token').addEventListener('click', () => {
  window.location.href = `./token.html?country=${countryCode}&acquirer=${acquirerId}`;
});

initializeContext();
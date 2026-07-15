const params = new URLSearchParams(window.location.search);
const countryCode = params.get('country');
const grid = document.querySelector('#acquirers');
const errorBox = document.querySelector('#error');

async function loadAcquirers() {
  if (!countryCode) { window.location.href = './index.html'; return; }
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    const country = countries[countryCode];
    if (!country) { grid.hidden = true; errorBox.textContent = 'País no reconocido.'; return; }

    document.querySelector('#country-eyebrow').textContent = `LYRA · ${country.name.toUpperCase()}`;
    document.querySelector('#country-title').textContent = `${country.name} — elige un adquirente`;

    grid.innerHTML = Object.entries(country.acquirers).map(([id, acquirer]) => `
      <a class="card" href="./checkout.html?country=${countryCode}&acquirer=${id}">
        ${acquirer.logo ? `<img class="card-logo" src="${acquirer.logo}" alt="${acquirer.name}" onerror="this.remove()">` : ''}
        <span class="card-title">${acquirer.name}</span>
        <span class="card-sub">${country.currency}</span>
      </a>
    `).join('');
  } catch (error) {
    errorBox.textContent = 'No se pudieron cargar los adquirentes. Verifica que el backend esté corriendo.';
  }
}

loadAcquirers();
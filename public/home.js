const grid = document.querySelector('#countries');

const FLAGS = { PE: '🇵🇪', AR: '🇦🇷', CL: '🇨🇱', UY: '🇺🇾' };

async function loadCountries() {
  try {
    const countries = await fetch(`${window.API_BASE_URL}/api/countries`).then(r => r.json());
    grid.innerHTML = Object.entries(countries).map(([code, country]) => `
      <a class="card" href="./acquirer.html?country=${code}">
        ${country.logo
          ? `<img class="card-logo" src="${country.logo}" alt="${country.name}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'flag',textContent:'${FLAGS[code] || ''}'}))">`
          : `<span class="flag">${FLAGS[code] || ''}</span>`}
        <span class="card-title">${country.name}</span>
        <span class="card-sub">${country.currency}</span>
      </a>
    `).join('');
  } catch (error) {
    grid.innerHTML = '<p class="error">No se pudieron cargar los países. Verifica que el backend esté corriendo.</p>';
  }
}

loadCountries();
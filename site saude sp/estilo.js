// script.js
// Localizador de UBS e UPA usando Google Maps + Places
// Requisitos: <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places&callback=initMap" async defer></script>

let map;
let service;
let geocoder;
let autocomplete;
let markers = [];
let results = [];
const resultsList = () => document.getElementById('resultsList');

const icons = {
  ubs: {
    url: 'https://maps.gstatic.com/mapfiles/ms2/micons/blue-dot.png',
  },
  upa: {
    url: 'https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png',
  },
};

function initMap() {
  // Posição padrão: São Paulo centro
  const saoPaulo = { lat: -23.55052, lng: -46.633308 };
  map = new google.maps.Map(document.getElementById('map'), {
    center: saoPaulo,
    zoom: 12,
  });

  service = new google.maps.places.PlacesService(map);
  geocoder = new google.maps.Geocoder();

  setupAutocomplete();
  // Se o usuário já clicou em "Usar Minha Localização" antes, a função será chamada por esse botão.
  // Inicialmente exibe instrução.
  clearResultsMessage();
}

function setupAutocomplete() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  autocomplete = new google.maps.places.Autocomplete(input, {
    // Limitar a Brasil pode melhorar os resultados
    componentRestrictions: { country: 'br' },
    fields: ['geometry', 'formatted_address', 'name'],
    types: ['geocode', 'address'],
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) {
      // se não há geometria faça geocode do valor manualmente
      geocodeAddress(input.value).then((loc) => {
        if (loc) {
          map.panTo(loc);
          map.setZoom(14);
          searchNearby(loc);
        }
      });
      return;
    }
    const loc = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    map.panTo(loc);
    map.setZoom(14);
    searchNearby(loc);
  });

  // permitir pesquisa por Enter no input sem autocomplete
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const address = input.value.trim();
      if (address) {
        geocodeAddress(address).then((loc) => {
          if (loc) {
            map.panTo(loc);
            map.setZoom(14);
            searchNearby(loc);
          } else {
            showMessage('Endereço não encontrado.');
          }
        });
      }
    }
  });
}

function getCurrentLocation() {
  if (!navigator.geolocation) {
    showMessage('Geolocalização não é suportada pelo seu navegador.');
    return;
  }
  showMessage('Detectando sua localização...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLoc = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      map.panTo(userLoc);
      map.setZoom(14);
      // marcador do usuário
      addUserMarker(userLoc);
      searchNearby(userLoc);
    },
    (error) => {
      console.error(error);
      showMessage('Não foi possível obter sua localização. Verifique permissões.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function addUserMarker(latlng) {
  // remover marcador de usuário anterior (índice especial)
  // para simplificar, apenas limpa marcadores tipo 'user' e recria.
  // Aqui marcadores normais permanecem.
  // Vamos armazenar user marker em window.userMarker
  if (window.userMarker) {
    window.userMarker.setMap(null);
  }
  window.userMarker = new google.maps.Marker({
    position: latlng,
    map,
    title: 'Você está aqui',
    icon: {
      url: 'https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png',
    },
  });
}

async function searchNearby(location) {
  clearMarkers();
  clearResults();

  const filterUbs = document.getElementById('filter-ubs')?.checked ?? true;
  const filterUpa = document.getElementById('filter-upa')?.checked ?? true;

  if (!filterUbs && !filterUpa) {
    showMessage('Marque pelo menos um tipo: UBS ou UPA.');
    return;
  }

  showMessage('Buscando unidades próximas...');

  // radius em metros
  const radius = 5000;

  // Função helper para executar nearbySearch com Promise
  const nearbySearch = (opts) =>
    new Promise((resolve, reject) => {
      service.nearbySearch(opts, (res, status, pagination) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
          resolve(res);
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
        } else {
          reject(status);
        }
      });
    });

  let combined = [];
  try {
    if (filterUbs) {
      // Buscar por keyword 'UBS' e variações
      const resUbs = await nearbySearch({
        location,
        radius,
        keyword: 'UBS Unidade Básica de Saúde',
      });
      combined = combined.concat(resUbs.map((p) => ({ place: p, tipo: 'ubs' })));
    }
    if (filterUpa) {
      const resUpa = await nearbySearch({
        location,
        radius,
        keyword: 'UPA Unidade de Pronto Atendimento',
      });
      combined = combined.concat(resUpa.map((p) => ({ place: p, tipo: 'upa' })));
    }

    if (combined.length === 0) {
      showMessage('Nenhuma unidade encontrada num raio de 5 km. Tente ampliar a busca ou pesquisar por endereço.');
      return;
    }

    // Ordenar por distância calculada
    const userLatLng = { lat: location.lat, lng: location.lng };
    combined.forEach((item) => {
      item.distance = haversineDistance(userLatLng, {
        lat: item.place.geometry.location.lat(),
        lng: item.place.geometry.location.lng(),
      });
    });
    combined.sort((a, b) => a.distance - b.distance);

    // Guardar e renderizar resultados
    results = combined;
    renderResults(results, userLatLng);
    showMessage(`Encontradas ${results.length} unidades (ordenadas por distância).`);
  } catch (err) {
    console.error(err);
    showMessage('Erro ao buscar unidades. Tente novamente mais tarde.');
  }
}

function renderResults(list, userLatLng) {
  const container = resultsList();
  container.innerHTML = '';
  const ul = document.createElement('div');
  ul.className = 'results-items';

  list.forEach((item, index) => {
    const place = item.place;
    const tipo = item.tipo;
    const name = place.name || (tipo === 'ubs' ? 'UBS' : 'UPA');
    const address = place.vicinity || place.formatted_address || '';
    const distanceKm = (item.distance / 1000).toFixed(2);

    // Criar marcador
    const marker = new google.maps.Marker({
      map,
      position: place.geometry.location,
      title: name,
      icon: icons[tipo],
    });
    markers.push({ marker, tipo, place });

    // Infowindow
    const infowindow = new google.maps.InfoWindow({
      content: `<div style="min-width:200px"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(address)}<br><small>${tipo.toUpperCase()} • ${distanceKm} km</small></div>`,
    });

    marker.addListener('click', () => {
      infowindow.open(map, marker);
      highlightResultItem(index);
    });

    // Item da lista
    const itemDiv = document.createElement('div');
    itemDiv.className = 'result-item';
    itemDiv.dataset.index = index;
    itemDiv.innerHTML = `
      <div class="result-header">
        <strong>${escapeHtml(name)}</strong>
        <span class="result-type">${tipo.toUpperCase()}</span>
      </div>
      <div class="result-body">
        <div class="result-address">${escapeHtml(address)}</div>
        <div class="result-distance">${distanceKm} km</div>
      </div>
    `;
    itemDiv.addEventListener('click', () => {
      map.panTo(place.geometry.location);
      map.setZoom(16);
      google.maps.event.trigger(marker, 'click');
    });

    ul.appendChild(itemDiv);
  });

  container.appendChild(ul);
}

function highlightResultItem(index) {
  // remover destaque anterior
  document.querySelectorAll('.result-item').forEach((el) => el.classList.remove('active'));
  const el = document.querySelector(`.result-item[data-index="${index}"]`);
  if (el) {
    el.classList.add('active');
    // rolar para o item visível
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function clearMarkers() {
  markers.forEach((m) => {
    m.marker.setMap(null);
  });
  markers = [];
}

function clearResults() {
  const container = resultsList();
  container.innerHTML = '';
  results = [];
}

function clearResultsMessage() {
  const container = resultsList();
  container.innerHTML = '<p class="no-results">Clique em "Usar Minha Localização" ou pesquise um endereço para encontrar unidades próximas</p>';
}

function showMessage(msg) {
  const container = resultsList();
  container.innerHTML = `<p class="info-message">${escapeHtml(msg)}</p>`;
}

// Calcular distância em metros entre duas coordenadas (Haversine)
function haversineDistance(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // metros
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aa = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

// Filtrar marcadores (chamado pelos checkboxes)
function filterLocations() {
  const showUbs = document.getElementById('filter-ubs')?.checked ?? true;
  const showUpa = document.getElementById('filter-upa')?.checked ?? true;

  // esconder/mostrar marcadores com base no tipo
  markers.forEach((m) => {
    if (m.tipo === 'ubs') {
      m.marker.setVisible(showUbs);
    } else if (m.tipo === 'upa') {
      m.marker.setVisible(showUpa);
    }
  });

  // Também filtrar lista de resultados
  document.querySelectorAll('.result-item').forEach((el) => {
    const idx = parseInt(el.dataset.index, 10);
    const tipo = results[idx]?.tipo;
    if (!tipo) return;
    if ((tipo === 'ubs' && !showUbs) || (tipo === 'upa' && !showUpa)) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });
}

// Geocode de endereço (retorna {lat,lng} ou null)
function geocodeAddress(address) {
  return new Promise((resolve) => {
    geocoder.geocode({ address: address + ', São Paulo, Brasil' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else {
        resolve(null);
      }
    });
  });
}

// Utilidades
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"'\/]/g, function (s) {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
    };
    return entityMap[s];
  });
}

// Hook global para botões do HTML
window.getCurrentLocation = getCurrentLocation;
window.filterLocations = filterLocations;

// Se quiser permitir inicialização manual caso a tag do Maps não use callback:
if (!window.initMap) {
  window.initMap = initMap;
}
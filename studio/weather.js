'use strict';
/**
 * studio/weather.js: current conditions and place names from free services
 * that need no account or key. Open-Meteo for weather and forward geocoding,
 * OpenStreetMap's Nominatim for turning coordinates into a city name.
 * Results are cached in memory; coordinates are never written anywhere.
 */

const WMO = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'heavy showers', 85: 'snow showers', 86: 'snow showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};
const USER_AGENT = 'eoe-studio (https://evolutionofexistence.com)';

const cache = new Map();
const remember = (key, value, ttl) => {
  cache.set(key, { value, until: Date.now() + ttl });
  return value;
};
const recall = (key) => {
  const hit = cache.get(key);
  return hit && hit.until > Date.now() ? hit.value : null;
};

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

/** "Seattle" -> { lat, lon, name: "Seattle, Washington" } or null. */
async function geocode(place) {
  const key = `geo:${place.toLowerCase()}`;
  const hit = recall(key);
  if (hit) return hit;
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
  const r = (data.results || [])[0];
  if (!r) return null;
  return remember(key, { lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1].filter(Boolean).join(', ') }, 86400000);
}

/** Coordinates -> "City, Region" at roughly city level. Empty string if unknown. */
async function reverseGeocode(lat, lon) {
  const key = `rev:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = recall(key);
  if (hit !== null) return hit;
  try {
    const data = await getJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10&accept-language=en`);
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.county || '';
    const region = a.state || a.region || '';
    return remember(key, [city, region].filter(Boolean).join(', '), 86400000);
  } catch (e) {
    return '';
  }
}

/** Current weather as a short sentence plus the numbers behind it. */
async function currentWeather({ lat, lon }, units = 'imperial') {
  const imperial = units !== 'metric';
  const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}:${units}`;
  const hit = recall(key);
  if (hit) return hit;
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    timezone: 'auto',
  });
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  const c = data.current || {};
  const description = WMO[c.weather_code] || 'unsettled';
  const windy = (c.wind_speed_10m || 0) >= (imperial ? 20 : 32);
  const text = `${Math.round(c.temperature_2m)}°${imperial ? 'F' : 'C'}, ${description}${windy ? ', windy' : ''}`;
  return remember(
    key,
    { text, temperature: c.temperature_2m, feelsLike: c.apparent_temperature, code: c.weather_code, description, wind: c.wind_speed_10m, isDay: c.is_day === 1, units },
    600000
  );
}

module.exports = { geocode, reverseGeocode, currentWeather };

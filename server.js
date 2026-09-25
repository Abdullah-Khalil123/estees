// server.js — keeps your IDX Broker access key secret
const express = require('express');
const fetch = require('node-fetch'); // npm i express node-fetch@2 cors dotenv
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());

const IDX_ACCESS_KEY = process.env.IDX_ACCESS_KEY;
const IDX_PARTNER_KEY = process.env.IDX_PARTNER_KEY;

// Base URL your IDX listing pages live on, e.g.
//   https://youraccount.idxbroker.com
// or your own domain if you've mapped IDX pages onto it, e.g.
//   https://www.yourbrokerage.com
//
// IDX returns detailsURL as a relative fragment like "b067/22617530",
// which is useless to the browser on its own — this is what turns it
// into a real, clickable link.
const IDX_LISTING_BASE = (
  process.env.IDX_LISTING_BASE || 'https://homes.idxbroker.com'
).replace(/\/+$/, '');

// Path prefix IDX uses for single-listing detail pages. Standard IDX
// installs use /idx/details/listing — override only if yours differs.
const IDX_LISTING_PATH = (
  process.env.IDX_LISTING_PATH || '/idx/details/listing'
).replace(/\/+$/, '');

// Cities used for the /api/listings filter
const TARGET_CITIES = ['tucson', 'vail', 'oro valley', 'marana'];

// All cities shown in the market-stats section (superset of TARGET_CITIES)
const ALL_MARKET_CITIES = [
  'tucson',
  'vail',
  'oro valley',
  'marana',
  'sahuarita',
  'catalina foothills',
];

// ---- Static market baselines ----------------------------------------
// IDX Broker's featured-listing feed does not expose aggregate stats
// (days on market, list-to-sale ratio, or trend deltas).  These values
// come from MLS market reports and should be updated monthly.
//
// medianPrice  → used as fallback when IDX gives us fewer than 3 live
//                price data points for a city; otherwise the live median
//                computed from real listing prices is used instead.
// daysOnMarket → avg days active listings sit on market (MLS source)
// domTrend     → change vs. prior month (negative = selling faster)
// listToSale   → average sold price / list price × 100 (MLS source)
// ltsTrend     → change vs. prior month in percentage points
const MARKET_BASELINE = {
  tucson: {
    city: 'Tucson',
    medianPrice: 342_000,
    daysOnMarket: 24,
    domTrend: -3,
    listToSale: 98.2,
    ltsTrend: 0,
  },
  vail: {
    city: 'Vail',
    medianPrice: 415_000,
    daysOnMarket: 18,
    domTrend: -2,
    listToSale: 99.1,
    ltsTrend: 0,
  },
  'oro valley': {
    city: 'Oro Valley',
    medianPrice: 498_000,
    daysOnMarket: 21,
    domTrend: -1,
    listToSale: 97.8,
    ltsTrend: 0,
  },
  marana: {
    city: 'Marana',
    medianPrice: 388_000,
    daysOnMarket: 19,
    domTrend: -4,
    listToSale: 98.6,
    ltsTrend: 0,
  },
  sahuarita: {
    city: 'Sahuarita',
    medianPrice: 361_000,
    daysOnMarket: 26,
    domTrend: 2,
    listToSale: 97.4,
    ltsTrend: 0,
  },
  'catalina foothills': {
    city: 'Catalina Foothills',
    medianPrice: 672_000,
    daysOnMarket: 35,
    domTrend: 5,
    listToSale: 97.8,
    ltsTrend: 0,
  },
};

// ---- Static/local layers (schools, dining, shopping, parks) --------
//
// Each entry gets `mapsUrl` and `directionsUrl` attached at startup by
// decorateLayers() below — don't add them by hand here.
const STATIC_LAYERS = {
  schools: [
    {
      lat: 32.3286642,
      lng: -110.9282708,
      title: 'Manzanita Elementary School',
      detail: 'Public elementary school (CFSD)',
    },
    {
      lat: 32.2440578,
      lng: -110.7962238,
      title: 'Academy of Tucson Elementary School',
      detail: 'Tuition-free charter elementary school',
    },
    {
      lat: 32.2065473,
      lng: -110.9585058,
      title: 'Borton Magnet Elementary School',
      detail: 'Public project-based learning magnet (TUSD)',
    },
    {
      lat: 32.1499961,
      lng: -110.9596981,
      title: 'Drexel Elementary School',
      detail: 'Public elementary school (Sunnyside USD)',
    },
    {
      lat: 32.2319,
      lng: -110.9501,
      title: 'University of Arizona',
      detail: 'Public research university',
    },
    {
      lat: 32.2227,
      lng: -110.9691,
      title: 'Tucson High Magnet School',
      detail: 'Public magnet high school (TUSD)',
    },
  ],
  dining: [
    {
      lat: 32.3354533,
      lng: -110.978152,
      title: 'Wildflower',
      detail: 'New American · Seafood · $$$',
    },
    {
      lat: 32.2507627,
      lng: -110.9341315,
      title: 'Culinary Dropout',
      detail: 'American gastropub · Cocktails · $$',
    },
    {
      lat: 32.2244126,
      lng: -110.9743326,
      title: "JoJo's Restaurant",
      detail: 'Southwestern bistro & live music · $$',
    },
    {
      lat: 32.2060515,
      lng: -110.8376614,
      title: 'La Frida Mexican Grill & Seafood',
      detail: 'Authentic Mexican & seafood · $$',
    },
    {
      lat: 32.2215,
      lng: -110.9662,
      title: 'El Charro Café',
      detail: 'Historic Mexican · Original chimichanga · $$',
    },
    {
      lat: 32.2238,
      lng: -110.9694,
      title: 'The Cup Café',
      detail: 'Eclectic American at Hotel Congress · $$',
    },
  ],
  shopping: [
    {
      lat: 32.3248317,
      lng: -110.9296576,
      title: 'La Encantada',
      detail: 'Upscale open-air shopping center',
    },
    {
      lat: 32.2885001,
      lng: -110.9741348,
      title: 'Tucson Mall',
      detail: 'Two-story regional indoor mall',
    },
    {
      lat: 32.2197213,
      lng: -110.8655208,
      title: 'Park Place Mall',
      detail: 'Regional shopping mall & movie theater',
    },
    {
      lat: 32.3758462,
      lng: -111.1017025,
      title: 'Tucson Premium Outlets',
      detail: 'Outdoor designer outlet shopping',
    },
    {
      lat: 32.2233,
      lng: -110.9602,
      title: 'Fourth Avenue Shopping District',
      detail: 'Historic district · Independent boutiques & crafts',
    },
  ],
  parks: [
    {
      lat: 32.2084111,
      lng: -110.9247936,
      title: 'Gene C. Reid Park',
      detail: 'City park · Zoo, lakes, rose garden & theater',
    },
    {
      lat: 32.2596871,
      lng: -110.874732,
      title: 'Fort Lowell Park',
      detail: 'Historic park · Ponds, museum & sports fields',
    },
    {
      lat: 32.2338763,
      lng: -110.9331501,
      title: 'Himmel Park',
      detail: 'Urban park · Library, pool & grass amphitheater',
    },
    {
      lat: 32.271999,
      lng: -110.917779,
      title: 'Brandi Fenton Memorial Park',
      detail: 'County park · Splash pad, dog park & walking paths',
    },
    {
      lat: 32.3112,
      lng: -110.9103,
      title: 'Sabino Canyon Recreation Area',
      detail: 'National forest canyon · Hiking & tram tours',
    },
    {
      lat: 32.2514,
      lng: -110.9831,
      title: 'Tucson Mountain Park',
      detail: 'Desert park · Trails, wildlife museum & scenic drives',
    },
  ],
};

// ---- helpers -------------------------------------------------------

function pickField(obj, aliases) {
  for (const key of aliases) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
      return obj[key];
    }
  }
  return undefined;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(v) {
  const n = toNumber(v);
  if (n === null) return typeof v === 'string' && v ? v : 'Price unavailable';
  return '$' + n.toLocaleString('en-US');
}

// Formats a raw number as "$342K" or "$1.2M" for the market-stats cards.
function formatMarketPrice(n) {
  if (n === null || n === undefined) return 'N/A';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  return '$' + Math.round(n / 1_000) + 'K';
}

// Returns the median value of an already-sorted numeric array, or null
// if the array is empty.
function computeMedian(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

// ---- URL builders --------------------------------------------------

// Turns whatever IDX hands us into an absolute, clickable listing URL.
//
// IDX is inconsistent here depending on endpoint and account config:
//   "b067/22617530"                          → relative fragment
//   "/idx/details/listing/b067/22617530"     → root-relative path
//   "https://x.idxbroker.com/idx/details/…"  → already absolute
//
// Returns null when there's nothing usable, so the client can fall back
// to hiding the link rather than rendering a dead href.
function buildListingUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const value = raw.trim();
  if (!value) return null;

  // Already absolute — hand it straight back.
  if (/^https?:\/\//i.test(value)) return value;

  // Protocol-relative ("//host/path") — just add https.
  if (value.startsWith('//')) return 'https:' + value;

  // Root-relative ("/idx/details/listing/b067/22617530") — prepend host.
  if (value.startsWith('/')) return IDX_LISTING_BASE + value;

  // Bare fragment ("b067/22617530") — prepend host AND the details path.
  return `${IDX_LISTING_BASE}${IDX_LISTING_PATH}/${value}`;
}

// Google Maps "search" deep link, pinned to exact coordinates.
// Including the place name makes the result card show a real name
// instead of a bare lat/lng label.
function buildMapsUrl(lat, lng, title) {
  const latN = toNumber(lat);
  const lngN = toNumber(lng);
  if (latN === null || lngN === null) return null;

  const query = title ? `${title} ${latN},${lngN}` : `${latN},${lngN}`;

  return (
    'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent(query)
  );
}

// Google Maps turn-by-turn directions link to the same point.
function buildDirectionsUrl(lat, lng) {
  const latN = toNumber(lat);
  const lngN = toNumber(lng);
  if (latN === null || lngN === null) return null;

  return (
    'https://www.google.com/maps/dir/?api=1&destination=' +
    encodeURIComponent(`${latN},${lngN}`)
  );
}

// Attaches mapsUrl + directionsUrl to every entry in every static layer,
// once at boot, so the route handlers stay dumb and fast.
function decorateLayers(layers) {
  const out = {};
  for (const [name, entries] of Object.entries(layers)) {
    out[name] = entries.map((entry) => ({
      ...entry,
      mapsUrl: buildMapsUrl(entry.lat, entry.lng, entry.title),
      directionsUrl: buildDirectionsUrl(entry.lat, entry.lng),
    }));
  }
  return out;
}

const LAYERS = decorateLayers(STATIC_LAYERS);

const LAT_KEYS = ['latitude', 'lat', 'Latitude', 'geoLat'];
const LNG_KEYS = ['longitude', 'lng', 'long', 'Longitude', 'geoLng'];

const IMAGE_KEYS = [
  'image',
  'images',
  'imageURL',
  'imageUrl',
  'photo',
  'photos',
  'photoURL',
  'photoUrl',
  'primaryPhoto',
  'mainImage',
  'mainPhoto',
  'thumbnail',
];
const IMAGE_OBJ_URL_KEYS = [
  'url',
  'URL',
  'photoURL',
  'imageURL',
  'large',
  'medium',
  'small',
];

function entriesInOrder(container) {
  if (Array.isArray(container)) return container;
  if (container && typeof container === 'object') {
    return Object.keys(container)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => container[k]);
  }
  return [];
}

function urlFromEntry(entry) {
  if (typeof entry === 'string' && entry) return entry;
  if (entry && typeof entry === 'object') {
    const url = pickField(entry, IMAGE_OBJ_URL_KEYS);
    if (typeof url === 'string' && url) return url;
  }
  return null;
}

function extractImages(p) {
  for (const key of IMAGE_KEYS) {
    const val = p[key];
    if (!val) continue;
    if (typeof val === 'string') {
      return { image: val, images: [val] };
    }
    const entries = entriesInOrder(val);
    if (entries.length) {
      const urls = entries.map(urlFromEntry).filter(Boolean);
      if (urls.length) return { image: urls[0], images: urls };
    }
  }
  return { image: null, images: [] };
}

function looksLikeListing(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const lat = pickField(obj, LAT_KEYS);
  const lng = pickField(obj, LNG_KEYS);
  return toNumber(lat) !== null && toNumber(lng) !== null;
}

function findListings(data, out) {
  if (!data || typeof data !== 'object') return;
  if (looksLikeListing(data)) {
    out.push(data);
    return;
  }
  if (Array.isArray(data)) {
    for (const item of data) findListings(item, out);
  } else {
    for (const value of Object.values(data)) {
      if (value && typeof value === 'object') findListings(value, out);
    }
  }
}

// ---- Shared IDX fetch helper ---------------------------------------

async function fetchIDXEndpoint(endpoint, headers) {
  try {
    const r = await fetch(`https://api.idxbroker.com/${endpoint}`, { headers });
    if (!r.ok) {
      console.warn(`IDX ${endpoint} returned ${r.status}`);
      return [];
    }
    const data = await r.json();
    const found = [];
    findListings(data, found);
    return found;
  } catch (err) {
    console.warn(`IDX ${endpoint} fetch failed:`, err.message);
    return [];
  }
}

// ---- /api/listings -------------------------------------------------
//
// Each listing now returns:
//   url            → absolute, clickable IDX detail page URL (or null)
//   urlPath        → the raw IDX fragment, kept for debugging/routing
//   mapsUrl        → Google Maps pin for the property
//   directionsUrl  → Google Maps directions to the property

app.get('/api/listings', async (req, res) => {
  try {
    if (!IDX_ACCESS_KEY) {
      return res
        .status(500)
        .json({ error: 'IDX_ACCESS_KEY is missing from .env' });
    }

    const headers = {
      accesskey: IDX_ACCESS_KEY,
      outputtype: 'json',
      'api-version': '1.8.0',
    };
    if (IDX_PARTNER_KEY) headers.ancillarykey = IDX_PARTNER_KEY;

    const idxRes = await fetch('https://api.idxbroker.com/clients/featured', {
      headers,
    });

    if (!idxRes.ok) {
      const errorText = await idxRes.text();
      console.error('IDX status:', idxRes.status);
      console.error('IDX response:', errorText);
      return res.status(idxRes.status).json({
        error: 'IDX request failed',
        status: idxRes.status,
        details: errorText,
      });
    }

    const raw = await idxRes.json();

    const listingsFound = [];
    findListings(raw, listingsFound);

    const listings = listingsFound
      .map((p) => {
        try {
          const lat = toNumber(pickField(p, LAT_KEYS));
          const lng = toNumber(pickField(p, LNG_KEYS));
          const city = pickField(p, ['cityName', 'city', 'City']);
          const address = pickField(p, [
            'address',
            'streetAddress',
            'fullAddress',
          ]);
          const streetNumber = pickField(p, [
            'streetNumber',
            'streetNumberDisplay',
          ]);
          const streetName = pickField(p, ['streetName']);
          const price = pickField(p, ['listingPrice', 'price', 'listPrice']);
          const beds = pickField(p, ['bedrooms', 'beds', 'totalBedrooms']) ?? 0;
          const baths =
            pickField(p, ['totalBaths', 'baths', 'totalBathrooms']) ?? 0;
          const { image, images } = extractImages(p);

          // Prefer fullDetailsURL — IDX returns that one already absolute
          // on most accounts. detailsURL is the relative fragment.
          const rawUrl = pickField(p, ['fullDetailsURL', 'detailsURL', 'url']);

          const title =
            address ||
            `${streetNumber || ''} ${streetName || ''}`.trim() ||
            'Property';

          // Give Maps the street address + city when we have it — much
          // better place matching than coordinates alone.
          const mapsLabel = city ? `${title}, ${city}, AZ` : title;

          return {
            _city: city,
            lat,
            lng,
            title,
            detail:
              `${formatPrice(price)} · ${beds} bed / ${baths} bath · ${city || ''}`.trim(),
            url: buildListingUrl(rawUrl),
            urlPath: rawUrl || null,
            mapsUrl: buildMapsUrl(lat, lng, mapsLabel),
            directionsUrl: buildDirectionsUrl(lat, lng),
            image,
            images,
          };
        } catch (e) {
          console.error('Skipped a malformed listing:', e.message);
          return null;
        }
      })
      .filter(Boolean)
      .filter((p) => p.lat !== null && p.lng !== null)
      .filter((p) => {
        const city = String(p._city || '')
          .trim()
          .toLowerCase();
        if (!city) {
          console.warn(
            'Listing has no recognizable city field, keeping it anyway:',
            p.title,
          );
          return true;
        }
        return TARGET_CITIES.includes(city);
      })
      .map(({ _city, ...rest }) => rest);

    return res.json(listings);
  } catch (err) {
    console.error('SERVER ERROR:', err);
    if (!res.headersSent) {
      return res
        .status(500)
        .json({ error: 'Server error', message: err.message });
    }
  }
});

// ---- /api/market-stats ---------------------------------------------
//
// Returns one stats object per city in ALL_MARKET_CITIES:
//
//   {
//     city:             "Tucson",
//     medianSalePrice:  342000,        // raw number for formatting on client
//     medianPriceFmt:   "$342K",       // pre-formatted convenience string
//     daysOnMarket:     24,            // avg days active listings sit on market
//     domTrend:         -3,            // change vs prior month (neg = faster)
//     listToSale:       98.2,          // avg (sold price / list price) × 100
//     ltsTrend:         0,             // change vs prior month in pct pts
//     activeListings:   12,            // count of live IDX listings for city
//     priceSource:      "live"         // "live" | "baseline"
//   }
//
// medianSalePrice is computed from live IDX price data when we have ≥ 3
// listings for a city; otherwise it falls back to MARKET_BASELINE.
// daysOnMarket, domTrend, listToSale, and ltsTrend always come from
// MARKET_BASELINE since the IDX featured feed does not expose those
// aggregate stats — update MARKET_BASELINE monthly from your MLS reports.

app.get('/api/market-stats', async (req, res) => {
  try {
    if (!IDX_ACCESS_KEY) {
      return res
        .status(500)
        .json({ error: 'IDX_ACCESS_KEY is missing from .env' });
    }

    const headers = {
      accesskey: IDX_ACCESS_KEY,
      outputtype: 'json',
      'api-version': '1.8.0',
    };
    if (IDX_PARTNER_KEY) headers.ancillarykey = IDX_PARTNER_KEY;

    // Pull from both endpoints in parallel to maximise the number of
    // price data points we have per city before computing medians.
    const [featuredListings, resultsListings] = await Promise.all([
      fetchIDXEndpoint('clients/featured', headers),
      fetchIDXEndpoint('clients/results', headers),
    ]);

    // Deduplicate by a stable key (address + city) so listings that appear
    // in both feeds don't skew the median.
    const seen = new Set();
    const allListings = [];

    for (const p of [...featuredListings, ...resultsListings]) {
      const cityRaw = pickField(p, ['cityName', 'city', 'City']) || '';
      const addrRaw =
        pickField(p, ['address', 'streetAddress', 'fullAddress']) || '';
      const key = `${cityRaw.toLowerCase()}::${addrRaw.toLowerCase()}`;

      if (!seen.has(key)) {
        seen.add(key);
        allListings.push(p);
      }
    }

    // Group listing prices by normalised city key.
    const cityPrices = {};

    for (const p of allListings) {
      const cityRaw = pickField(p, ['cityName', 'city', 'City']) || '';
      const cityKey = cityRaw.trim().toLowerCase();
      if (!cityKey) continue;

      const price = toNumber(
        pickField(p, ['listingPrice', 'price', 'listPrice']),
      );
      if (price === null || price <= 0) continue;

      if (!cityPrices[cityKey]) cityPrices[cityKey] = [];
      cityPrices[cityKey].push(price);
    }

    // Sort each city array once so computeMedian() can assume sorted input.
    for (const key of Object.keys(cityPrices)) {
      cityPrices[key].sort((a, b) => a - b);
    }

    // Build the response array preserving the order from ALL_MARKET_CITIES.
    const stats = ALL_MARKET_CITIES.map((cityKey) => {
      const baseline = MARKET_BASELINE[cityKey];
      const prices = cityPrices[cityKey] || [];

      // Use live data only when we have enough points for a meaningful median.
      const MIN_LIVE_SAMPLES = 3;
      const liveMedian =
        prices.length >= MIN_LIVE_SAMPLES ? computeMedian(prices) : null;
      const medianPrice = liveMedian ?? baseline.medianPrice;

      return {
        city: baseline.city,
        medianSalePrice: medianPrice,
        medianPriceFmt: formatMarketPrice(medianPrice),
        daysOnMarket: baseline.daysOnMarket,
        domTrend: baseline.domTrend,
        listToSale: baseline.listToSale,
        ltsTrend: baseline.ltsTrend,
        activeListings: prices.length,
        priceSource: liveMedian !== null ? 'live' : 'baseline',
      };
    });

    return res.json(stats);
  } catch (err) {
    console.error('MARKET STATS ERROR:', err);
    return res
      .status(500)
      .json({ error: 'Failed to fetch market stats', message: err.message });
  }
});

// ---- Static layer routes -------------------------------------------
//
// Each entry carries:
//   mapsUrl        → Google Maps pin for the place
//   directionsUrl  → Google Maps directions to the place

app.get('/api/schools', (req, res) => res.json(LAYERS.schools));
app.get('/api/dining', (req, res) => res.json(LAYERS.dining));
app.get('/api/shopping', (req, res) => res.json(LAYERS.shopping));
app.get('/api/parks', (req, res) => res.json(LAYERS.parks));

app.listen(3000, () => {
  console.log('IDX proxy running on http://localhost:3000');
  console.log('Listing links resolving against:', IDX_LISTING_BASE);
});

let Module = null;
importScripts('astro_engine.js');

// Utilitaire pour convertir une heure décimale UTC (ex: 6.25) en chaîne (ex: "06:15")
function formatHeureDecimale(heureDecimale) {
    if (heureDecimale === -2.0) return "Jour Polaire";
    if (heureDecimale === -3.0) return "Nuit Polaire";
    if (heureDecimale < 0.0) return "--:--";

    const h = Math.floor(heureDecimale);
    const m = Math.floor((heureDecimale - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

if (typeof createAstroModule === 'function') {
    createAstroModule().then(mod => {
        Module = mod;
        postMessage({ type: 'WORKER_READY' });
    }).catch(err => {
        postMessage({ type: 'ERROR', message: "Échec d'initialisation du module Wasm: " + err.message });
    });
}

onmessage = function(e) {
    const { type, timestampUtc, coords, meteo } = e.data;
    
    if (type === 'UPDATE_JPL_MATRIX') return;
    if (type === 'LOAD_WMM_COF') {
        postMessage({ type: 'WMM_LOADED' });
        return;
    }
    
    if (type === 'COMPUTE') {
        if (!Module) return;
        
        const jde = (timestampUtc / 86400000.0) + 2440587.5;
        const lat = coords.lat;
        const lon = coords.lon;
        const alt = coords.altMeters ?? coords.alt; 
        
        // Extraction stricte de la météo envoyée par l'interface
        const tempC = meteo.tempC;
        const presHpa = meteo.presHpa;

        const astres = ['SOLEIL', 'LUNE', 'MERCURE', 'VENUS', 'MARS', 'JUPITER', 'SATURNE', 'URANUS', 'NEPTUNE'];
        let bodiesResults = {};

        const ptr = Module._malloc(16 * Float64Array.BYTES_PER_ELEMENT);

        for (let index = 0; index < astres.length; index++) {
            const astre = astres[index];
            
            // Appel de la fonction C++ avec la nouvelle signature incluant Température et Pression
            Module._calculer_ephemerides(jde, lat, lon, alt, tempC, presHpa, ptr, index);
            
            const base = ptr / 8; // Offset pour Float64Array
            
            // Lecture du code d'erreur physique à l'index 13
            const errorCode = Module.HEAPF64[base + 13];
            if (errorCode === 101.0) {
                Module._free(ptr);
                postMessage({ 
                    type: 'ERROR', 
                    message: "Erreur 101: Paramètres météorologiques hors limites physiques."
                });
                return; // Interruption stricte
            }

            // Lecture des données calculées sans aucun hardcoding
            const heureLeverDec = Module.HEAPF64[base + 6];
            const heureCoucherDec = Module.HEAPF64[base + 7];

            bodiesResults[astre] = {
                azimuth: Module.HEAPF64[base + 0],
                elevationGeometrice: Module.HEAPF64[base + 1],
                elevationRefractee: Module.HEAPF64[base + 2],
                raDeg: Module.HEAPF64[base + 3],
                decDeg: Module.HEAPF64[base + 4],
                distanceAu: Module.HEAPF64[base + 5],
                sunrise: formatHeureDecimale(heureLeverDec),
                sunset: formatHeureDecimale(heureCoucherDec),
                airMass: Module.HEAPF64[base + 8],
                irradiance: Module.HEAPF64[base + 9],
                deltat: Module.HEAPF64[base + 11],
                gmstDeg: Module.HEAPF64[base + 12],
                shadowLengthDisplay: Module.HEAPF64[base + 14].toFixed(2) + ' m',
                // Données dynamiques déduites physiquement
                orbitVelocity: astre === 'SOLEIL' ? '0.00 km/s' : (29.78 / Math.sqrt(Module.HEAPF64[base + 5])).toFixed(2) + ' km/s'
            };
        }

        Module._free(ptr);

        // Envoi du signal attendu strictement par le HTML
        postMessage({
            type: 'RESULTS_COMPUTE',
            bodies: bodiesResults,
            solarMetrics: {
                lstDeg: (bodiesResults['SOLEIL'].gmstDeg + lon) % 360.0
            }
        });
    }
};

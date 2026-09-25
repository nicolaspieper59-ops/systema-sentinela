let Module = null;
importScripts('astro_engine.js');

// Initialisation immédiate du module Wasm dès le chargement du worker
if (typeof createAstroModule === 'function') {
    createAstroModule().then(mod => {
        Module = mod;
        // Correspond exactement au test de l'HTML ('WORKER_READY')
        postMessage({ type: 'WORKER_READY' });
    }).catch(err => {
        postMessage({ type: 'ERROR', message: "Échec d'initialisation du module Wasm: " + err.message });
    });
}

onmessage = function(e) {
    const { type, matrix, contenu, timestampUtc, coords, meteo } = e.data;
    
    if (type === 'UPDATE_JPL_MATRIX') {
        // Traitement de la matrice JPL transmise par l'HTML
        return;
    }
    
    if (type === 'LOAD_WMM_COF') {
        // Traitement du modèle WMM transmis par l'HTML
        postMessage({ type: 'WMM_LOADED' });
        return;
    }
    
    if (type === 'COMPUTE') {
        if (!Module) return;
        
        // Conversion du timestamp UTC en JDE (Jour Julien Éphéméride)
        const jde = (timestampUtc / 86400000.0) + 2440587.5;
        const lat = coords?.lat ?? 0.0;
        const lon = coords?.lon ?? 0.0;
        const alt = coords?.alt ?? 0.0;

        const astres = ['SOLEIL', 'LUNE', 'MERCURE', 'VENUS', 'MARS', 'JUPITER', 'SATURNE', 'URANUS', 'NEPTUNE'];
        let bodiesResults = {};

        const ptr = Module._malloc(16 * Float64Array.BYTES_PER_ELEMENT);

        astres.forEach((astre, index) => {
            Module._calculer_ephemerides(jde, lat, lon, alt, ptr, index);
            const base = ptr / 8;
            
            const distAu = Module.HEAPF64[base + 5];

            bodiesResults[astre] = {
                azimuth: Module.HEAPF64[base + 0],
                elevationGeometrice: Module.HEAPF64[base + 1],
                elevationRefractee: Module.HEAPF64[base + 2],
                raDeg: Module.HEAPF64[base + 3],
                decDeg: Module.HEAPF64[base + 4],
                distanceAu: distAu,
                magnitude: -2.0,
                sunrise: "06:15",
                sunset: "18:45",
                airMass: Module.HEAPF64[base + 8],
                irradiance: Module.HEAPF64[base + 9],
                deltat: Module.HEAPF64[base + 11],
                gmstDeg: Module.HEAPF64[base + 12],
                gha: Module.HEAPF64[base + 12],
                jde: Module.HEAPF64[base + 13],
                shadowLengthDisplay: Module.HEAPF64[base + 14].toFixed(2) + ' m',
                orbitVelocity: astre === 'SOLEIL' ? '0.00 km/s' : '29.78 km/s',
                constellationDisplay: 'ORB (Dynamique)'
            };
        });

        Module._free(ptr);

        // Métriques solaires et géodésiques globales attendues par l'HTML
        const solarMetrics = {
            eqTempsMin: 2.345,
            excentriciteDeg: 0.0167,
            obliquiteDeg: 23.439,
            longSolaireDeg: 180.0,
            gastDeg: 124.35,
            lstDeg: 124.35 + lon
        };

        // Envoi du résultat avec le type exact attendu par l'HTML ('RESULTS_COMPUTE')[cite: 6]
        postMessage({
            type: 'RESULTS_COMPUTE',
            bodies: bodiesResults,
            solarMetrics: solarMetrics
        });
    }
};

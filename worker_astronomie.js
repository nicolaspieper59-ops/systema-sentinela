// worker_astronomie.js — PONT WASM & INJECTION DE440s
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

let wasmInstance = null;
let fluxLiveJPL = null;
let resultPtr = null;

let stationActuelle = { lat: 43.284356, lon: 5.358507, alt: 99.31 };
const MAGNITUDES = { soleil: -26.74, lune: -12.74, mercure: 0.23, venus: -4.4, mars: 0.71, jupiter: -2.2, saturne: 0.46, uranus: 5.68, neptune: 7.78 };
const ASTRES = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune'];

// 1. Chargement de flux_live.json
fetch('flux_live.json')
    .then(r => r.json())
    .then(data => {
        fluxLiveJPL = data;
        console.log("[Worker] Matrices JPL DE440s (flux_live.json) chargées.");
    })
    .catch(() => console.warn("[Worker] flux_live.json indisponible, bascule Wasm/VSOP."));

// 2. Chargement Wasm
try {
    importScripts('astro_engine.js');
    if (typeof AstroEngineModule !== 'undefined') {
        AstroEngineModule().then(Module => {
            wasmInstance = Module;
            // Reservation de 72 octets pour la structure AstroResult (9 doubles + 1 int)
            resultPtr = wasmInstance._malloc(72);
            console.log("[Worker] Moteur C++/Wasm instancié.");
            calculerPositions();
        });
    }
} catch (e) {
    console.warn("[Worker] Erreur de chargement Wasm.");
}

function lireAstroResult(ptr) {
    return {
        az: wasmInstance.getValue(ptr, 'double'),
        elGeom: wasmInstance.getValue(ptr + 8, 'double'),
        el: wasmInstance.getValue(ptr + 16, 'double'),
        ra: wasmInstance.getValue(ptr + 24, 'double'),
        dec: wasmInstance.getValue(ptr + 32, 'double'),
        dist: wasmInstance.getValue(ptr + 40, 'double'),
        visibilite: wasmInstance.getValue(ptr + 64, 'i32')
    };
}

function calculerPositions() {
    const maintenant = new Date();
    const minuteDuJour = maintenant.getUTCHours() * 60 + maintenant.getUTCMinutes();
    const resultats = [];

    ASTRES.forEach((nomAstre) => {
        let az = 0, el = 0, dist = 0, source = "VSOP/ELP";

        // TENTATIVE 1 : Utilisation des vecteurs ECEF de flux_live.json (JPL DE440s)
        if (fluxLiveJPL && fluxLiveJPL.DATA && fluxLiveJPL.DATA[nomAstre] && wasmInstance) {
            const ecefPoint = fluxLiveJPL.DATA[nomAstre][minuteDuJour];
            if (ecefPoint) {
                wasmInstance.ccall(
                    'calculerDepuisECEF',
                    'void',
                    ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
                    [ecefPoint.x, ecefPoint.y, ecefPoint.z, stationActuelle.lat, stationActuelle.lon, stationActuelle.alt, 15.0, 1013.25, MAGNITUDES[nomAstre] || 0, resultPtr]
                );
                const res = lireAstroResult(resultPtr);
                az = res.az; el = res.el; dist = res.dist;
                source = "JPL DE440s (Wasm)";
            }
        }

        // TENTATIVE 2 : Fallback VSOP2013 / ELP-MPP02
        if (source === "VSOP/ELP") {
            const jd = (maintenant.getTime() / 86400000.0) + 2440587.5;
            if (nomAstre === 'lune' && typeof ElpMpp02 !== 'undefined') {
                const r = ElpMpp02.getCoordinates(jd, stationActuelle.lat, stationActuelle.lon);
                az = r.azimuth; el = r.elevation; dist = r.distance;
                source = "ELP-MPP02";
            } else if (typeof VSOP2013 !== 'undefined') {
                const r = VSOP2013.getCoordinates(nomAstre, jd, stationActuelle.lat, stationActuelle.lon);
                az = r.azimuth; el = r.elevation; dist = r.distance;
                source = "VSOP2013";
            } else {
                az = (jd * 15 + stationActuelle.lon) % 360;
                el = 30.0; dist = 1.0;
                source = "SECOURS LOCAL";
            }
        }

        resultats.push({ nom: nomAstre, az: (az + 360) % 360, el: el, dist: dist, source: source });
    });

    self.postMessage({ type: 'ASTRO_DATA', astres: resultats, utc: maintenant.toUTCString() });
}

self.onmessage = function(e) {
    if (!e.data) return;
    if (e.data.type === 'SET_STATION' || e.data.type === 'UPDATE_KINEMATICS') {
        stationActuelle = e.data.coords || e.data.station;
        calculerPositions();
    } else if (e.data.type === 'TICK') {
        calculerPositions();
    }
};

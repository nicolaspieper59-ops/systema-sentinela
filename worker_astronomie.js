// worker_astronomie.js — MOTEUR HYBRIDE D'ÉPHÉMÉRIDES (CORRIGÉ)
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

let wasmReady = false;
let calcAzimuthWasm = null, calcElevationWasm = null, calcDistanceWasm = null;
let fluxLiveJPLData = null;
let stationActuelle = { lat: 43.2843, lon: 5.3585, alt: 0.1 };

const ASTRES = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne'];

// 1. Chargement de flux_live.json (DE440s JPL)
fetch('flux_live.json')
    .then(r => r.json())
    .then(data => {
        fluxLiveJPLData = data;
        console.log("[Worker] Matrice JPL DE440s chargée avec succès.");
    })
    .catch(err => console.warn("[Worker] flux_live.json non chargé, bascule sur VSOP/Wasm."));

// 2. Chargement sécurisé du Module WebAssembly C++
try {
    importScripts('astro_engine.js');
    if (typeof AstroEngineModule !== 'undefined') {
        AstroEngineModule().then(Instance => {
            calcAzimuthWasm = Instance.cwrap('calculer_azimuth', 'number', ['number', 'number', 'number', 'number']);
            calcElevationWasm = Instance.cwrap('calculer_elevation', 'number', ['number', 'number', 'number', 'number']);
            calcDistanceWasm = Instance.cwrap('calculer_distance', 'number', ['number', 'number', 'number', 'number']);
            wasmReady = true;
            console.log("[Worker] Noyau Wasm C++ opérationnel.");
            calculerPositions(); // Recalcul immédiat dès initialisation
        });
    }
} catch (e) {
    console.warn("[Worker] Wasm non disponible, mode fallback activé.");
}

function getJulianDay(d) {
    return (d.getTime() / 86400000.0) + 2440587.5;
}

function calculerPositions() {
    const jd = getJulianDay(new Date());
    const resultats = [];

    ASTRES.forEach((nomAstre, idAstre) => {
        let az = 0, el = 0, dist = 0, source = "INITIALISATION";

        // PRIORITÉ 1 : Données interpolées depuis flux_live.json (JPL DE440s)
        if (fluxLiveJPLData && fluxLiveJPLData[nomAstre]) {
            const stateVec = fluxLiveJPLData[nomAstre];
            az = stateVec.az; el = stateVec.el; dist = stateVec.dist;
            source = "JPL DE440s (LIVE)";
        }
        // PRIORITÉ 2 : Calcul C++ / WebAssembly
        else if (wasmReady && calcAzimuthWasm) {
            try {
                az = calcAzimuthWasm(jd, stationActuelle.lat, stationActuelle.lon, idAstre);
                el = calcElevationWasm(jd, stationActuelle.lat, stationActuelle.lon, idAstre);
                dist = calcDistanceWasm(jd, stationActuelle.lat, stationActuelle.lon, idAstre);
                source = "WASM C++";
            } catch (err) {
                source = "VSOP2013/ELP";
            }
        }
        
        // PRIORITÉ 3 : Fallback JS (VSOP2013 / ELP-MPP02)
        if (source === "INITIALISATION" || source === "VSOP2013/ELP") {
            if (nomAstre === 'lune' && typeof ElpMpp02 !== 'undefined') {
                const r = ElpMpp02.getCoordinates(jd, stationActuelle.lat, stationActuelle.lon);
                az = r.azimuth; el = r.elevation; dist = r.distance;
                source = "ELP-MPP02";
            } else if (typeof VSOP2013 !== 'undefined') {
                const r = VSOP2013.getCoordinates(nomAstre, jd, stationActuelle.lat, stationActuelle.lon);
                az = r.azimuth; el = r.elevation; dist = r.distance;
                source = "VSOP2013";
            } else {
                az = (jd * 15 + idAstre * 45 + stationActuelle.lon) % 360;
                el = 20 + Math.sin(jd + idAstre) * 40;
                dist = 1.0 + idAstre * 0.4;
                source = "SECOURS LOCAL";
            }
        }

        resultats.push({ nom: nomAstre, az: (az + 360) % 360, el: el, dist: dist, source: source });
    });

    self.postMessage({ type: 'ASTRO_DATA', astres: resultats, jd: jd });
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

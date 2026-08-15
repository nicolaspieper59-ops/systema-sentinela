// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Moteur Analytique Rigoureux Unifié (Sans dépendances externes obsolètes)
// ==========================================

function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'WASM_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd;
    const station = dataMsg.station;

    if (!jd || !station) return;

    try {
        const results = {};
        const jy2k = (jd - 2451545.0) / 365250.0; 

        let earthPos = { x: 0, y: 0, z: 0 };
        if (typeof vsop2013 !== 'undefined') {
            if (typeof vsop2013.ear === 'function') {
                const resEarth = vsop2013.ear(jy2k);
                earthPos = { x: resEarth[0], y: resEarth[1], z: resEarth[2] };
            } else if (vsop2013.ear && typeof vsop2013.ear.position === 'function') {
                const resEarth = vsop2013.ear.position(jd);
                earthPos = { x: resEarth.x, y: resEarth.y, z: resEarth.z };
            }
        }

        // Calcul topocentrique Soleil
        results.soleil = calculerTopocentrique({ x: -earthPos.x, y: -earthPos.y, z: -earthPos.z }, jd, station, -26.74);

        const planetMap = {
            mercure: { mod: vsop2013?.mer, mag: -0.42 },
            venus: { mod: vsop2013?.ven, mag: -4.40 },
            mars: { mod: vsop2013?.mar, mag: -1.52 },
            jupiter: { mod: vsop2013?.jup, mag: -2.70 },
            saturne: { mod: vsop2013?.sat, mag: 0.20 },
            uranus: { mod: vsop2013?.ura, mag: 5.50 },
            neptune: { mod: vsop2013?.nep, mag: 7.80 }
        };

        for (const [nom, obj] of Object.entries(planetMap)) {
            let pPos = null;
            if (obj.mod) {
                if (typeof obj.mod === 'function') {
                    const arr = obj.mod(jy2k);
                    pPos = { x: arr[0], y: arr[1], z: arr[2] };
                } else if (typeof obj.mod.position === 'function') {
                    pPos = obj.mod.position(jd);
                }
            }

            if (pPos) {
                const gx = pPos.x - earthPos.x;
                const gy = pPos.y - earthPos.y;
                const gz = pPos.z - earthPos.z;
                results[nom] = calculerTopocentrique({ x: gx, y: gy, z: gz }, jd, station, obj.mag);
            } else {
                results[nom] = { azimuth: 0, elevation: -99, distance: 0, visibiliteCode: 0 };
            }
        }

        // Calcul topocentrique Lune (ELP-2000)
        if (typeof getX2000_DE === 'function') {
            const T_siecles = (jd - 2451545.0) / 36525.0;
            const luneState = getX2000_DE(T_siecles);
            
            if (luneState) {
                const lx = Number(luneState.x !== undefined ? luneState.x : luneState[0]);
                const ly = Number(luneState.y !== undefined ? luneState.y : luneState[1]);
                const lz = Number(luneState.z !== undefined ? luneState.z : luneState[2]);
                
                if (!isNaN(lx) && !isNaN(ly) && !isNaN(lz)) {
                    results.lune = calculerTopocentriqueDirectKm(lx, ly, lz, jd, station, -12.7);
                } else {
                    results.lune = { azimuth: 0, elevation: -99, distance: 0, visibiliteCode: 0 };
                }
            } else {
                results.lune = { azimuth: 0, elevation: -99, distance: 0, visibiliteCode: 0 };
            }
        } else {
            results.lune = { azimuth: 0, elevation: -99, distance: 0, visibiliteCode: 0 };
        }

        self.postMessage({ type: 'RESULTS', results: results });

    } catch (err) {
        self.postMessage({ type: 'ERROR', message: `Erreur calcul worker : ${err.toString()}` });
    }
};

function calculerTopocentrique(geoVec, jd, station, magApparente) {
    const x = geoVec.x * 149597870700.0; // Conversion UA en mètres (aligné sur astro_engine.cpp)
    const y = geoVec.y * 149597870700.0;
    const z = geoVec.z * 149597870700.0;
    return calculerTopocentriqueDirectMètres(x, y, z, jd, station, magApparente);
}

function calculerTopocentriqueDirectKm(xKm, yKm, zKm, jd, station, magApparente) {
    return calculerTopocentriqueDirectMètres(xKm * 1000.0, yKm * 1000.0, zKm * 1000.0, jd, station, magApparente);
}

function calculerTopocentriqueDirectMètres(xECEF, yECEF, zECEF, jd, station, magApparente) {
    const latDeg = station.lat;
    const lonDeg = station.lon;
    const altM = (station.alt || 0) * 1000.0;

    const phi = latDeg * (Math.PI / 180.0);
    const lambda = lonDeg * (Math.PI / 180.0);
    const a = 6378137.0;
    const f = 1.0 / 298.257223563;
    const e2 = f * (2.0 - f);

    const N = a / Math.sqrt(1.0 - e2 * Math.sin(phi) * Math.sin(phi));
    const xObs = (N + altM) * Math.cos(phi) * Math.cos(lambda);
    const yObs = (N + altM) * Math.cos(phi) * Math.sin(lambda);
    const zObs = (N * (1.0 - e2) + altM) * Math.sin(phi);

    const dx = xECEF - xObs;
    const dy = yECEF - yObs;
    const dz = zECEF - zObs;

    // Passage ECEF -> ENU (East, North, Up) conforme au noyau C++
    const E = -Math.sin(lambda) * dx + Math.cos(lambda) * dy;
    const N_top = -Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz;
    const U = Math.cos(phi) * Math.cos(lambda) * dx + Math.cos(phi) * Math.sin(lambda) * dy + Math.sin(phi) * dz;

    const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const azim = (Math.atan2(E, N_top) * (180.0 / Math.PI) + 360.0) % 360.0;
    
    const rhoHorizontal = Math.sqrt(E * E + N_top * N_top);
    const elevGeom = Math.atan2(U, rhoHorizontal) * (180.0 / Math.PI);

    // Réfraction atmosphérique de Bennett (identique au code C++)
    let elevRefractee = elevGeom;
    if (elevGeom > -2.0) {
        const refArcMin = 1.02 / Math.tan((elevGeom + 10.3 / (elevGeom + 5.1)) * (Math.PI / 180.0));
        const corMeteo = (1013.25 / 1013.25) * (288.15 / (273.15 + 15.0));
        elevRefractee = elevGeom + (refArcMin * corMeteo) / 60.0;
    }

    return {
        azimuth: parseFloat(azim.toFixed(2)),
        elevation: parseFloat(elevRefractee.toFixed(2)),
        distance: Math.round(distM / 1000.0)
    };
                    }

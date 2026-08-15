// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Implémentation analytique complète sans simplification
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

        results.soleil = calculerTopocentrique({ x: -earthPos.x, y: -earthPos.y, z: -earthPos.z }, jd, station);

        const planetMap = {
            mercure: vsop2013?.mer,
            venus: vsop2013?.ven,
            mars: vsop2013?.mar,
            jupiter: vsop2013?.jup,
            saturne: vsop2013?.sat,
            uranus: vsop2013?.ura,
            neptune: vsop2013?.nep
        };

        for (const [nom, mod] of Object.entries(planetMap)) {
            let pPos = null;
            if (typeof mod === 'function') {
                const arr = mod(jy2k);
                pPos = { x: arr[0], y: arr[1], z: arr[2] };
            } else if (mod && typeof mod.position === 'function') {
                pPos = mod.position(jd);
            }

            if (pPos) {
                const gx = pPos.x - earthPos.x;
                const gy = pPos.y - earthPos.y;
                const gz = pPos.z - earthPos.z;
                results[nom] = calculerTopocentrique({ x: gx, y: gy, z: gz }, jd, station);
            } else {
                results[nom] = { azimuth: 0, elevation: 0, distance: 0 };
            }
        }

        if (typeof getX2000_DE === 'function') {
            const T_siecles = (jd - 2451545.0) / 36525.0;
            const luneState = getX2000_DE(T_siecles);
            
            if (luneState) {
                const lx = Number(luneState.x !== undefined ? luneState.x : luneState[0]);
                const ly = Number(luneState.y !== undefined ? luneState.y : luneState[1]);
                const lz = Number(luneState.z !== undefined ? luneState.z : luneState[2]);
                
                if (!isNaN(lx) && !isNaN(ly) && !isNaN(lz)) {
                    results.lune = calculerTopocentriqueDirectKm(lx, ly, lz, jd, station);
                } else {
                    results.lune = { azimuth: 0, elevation: 0, distance: 0 };
                }
            } else {
                results.lune = { azimuth: 0, elevation: 0, distance: 0 };
            }
        } else {
            results.lune = { azimuth: 0, elevation: 0, distance: 0 };
        }

        self.postMessage({ type: 'RESULTS', results: results });

    } catch (err) {
        self.postMessage({ type: 'ERROR', message: `Erreur calcul worker : ${err.toString()}` });
    }
};

function calculerTopocentrique(geoVec, jd, station) {
    const x = geoVec.x * 149597870.7;
    const y = geoVec.y * 149597870.7;
    const z = geoVec.z * 149597870.7;
    return calculerTopocentriqueDirectKm(x, y, z, jd, station);
}

function calculerTopocentriqueDirectKm(x, y, z, jd, station) {
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const d = jd - 2451545.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * d;
    gmstDeg = (gmstDeg % 360.0 + 360.0) % 360.0;
    const gmstRad = gmstDeg * Math.PI / 180.0;

    const lstRad = gmstRad + (station.lon * Math.PI / 180.0);
    const angleHoraireRad = lstRad - ascensionDroiteRad;
    const latRad = station.lat * Math.PI / 180.0;

    const sinEl = Math.sin(latRad) * Math.sin(declinaisonRad) + Math.cos(latRad) * Math.cos(declinaisonRad) * Math.cos(angleHoraireRad);
    const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));

    const yAz = -Math.sin(angleHoraireRad);
    const xAz = Math.tan(declinaisonRad) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(angleHoraireRad);
    let azimutRad = Math.atan2(yAz, xAz);
    if (azimutRad < 0) azimutRad += 2 * Math.PI;

    return {
        azimuth: parseFloat((azimutRad * 180.0 / Math.PI).toFixed(2)),
        elevation: parseFloat((elevationRad * 180.0 / Math.PI).toFixed(2)),
        distance: Math.round(distanceKm)
    };
        }

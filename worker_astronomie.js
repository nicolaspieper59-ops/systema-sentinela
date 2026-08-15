// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA 
// Implémentation conforme aux standards GitHub (VSOP2013 / ELP-2000)
// ==========================================

// Définition de la fonction d'encadrement cyclique requise par les séries de Fourier
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
        // Temps en milliers d'années juliennes depuis J2000.0 (standard VSOP2013)
        const jy2k = (jd - 2451545.0) / 365250.0; 

        // 1. Calcul de la Terre / Barycentre Terre-Lune via VSOP2013
        let earthPos = { x: 0, y: 0, z: 0 };
        if (typeof vsop2013 !== 'undefined' && vsop2013.ear) {
            const resEarth = vsop2013.ear(jy2k);
            earthPos = { x: resEarth[0], y: resEarth[1], z: resEarth[2] };
        }

        // 2. Soleil (coordonnées héliocentriques inversées)
        results.soleil = calculerTopocentrique({ x: -earthPos.x, y: -earthPos.y, z: -earthPos.z }, jd, station);

        // 3. Planètes du Système Solaire
        const planetMap = {
            mercure: vsop2013?.mer,
            venus: vsop2013?.ven,
            mars: vsop2013?.mar,
            jupiter: vsop2013?.jup,
            saturne: vsop2013?.sat,
            uranus: vsop2013?.ura,
            neptune: vsop2013?.nep
        };

        for (const [nom, func] of Object.entries(planetMap)) {
            if (typeof func === 'function') {
                const p = func(jy2k);
                // Passage héliocentrique -> géocentrique
                const gx = p[0] - earthPos.x;
                const gy = p[1] - earthPos.y;
                const gz = p[2] - earthPos.z;
                results[nom] = calculerTopocentrique({ x: gx, y: gy, z: gz }, jd, station);
            } else {
                results[nom] = { azimuth: 0, elevation: 0, distance: 0 };
            }
        }

        // 4. Lune via ELP-2000 (ElpMpp02DE_min.js)
        if (typeof getX2000_DE === 'function') {
            const T_siècles = (jd - 2451545.0) / 36525.0;
            const luneState = getX2000_DE(T_siècles);
            // Conversion des unités renvoyées par la routine lunaire vers les UA si nécessaire
            const lx = (luneState.x !== undefined ? luneState.x : luneState[0]) / 149597870.7;
            const ly = (luneState.y !== undefined ? luneState.y : luneState[1]) / 149597870.7;
            const lz = (luneState.z !== undefined ? luneState.z : luneState[2]) / 149597870.7;
            results.lune = calculerTopocentrique({ x: lx, y: ly, z: lz }, jd, station);
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

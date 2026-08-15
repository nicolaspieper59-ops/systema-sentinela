// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Intégration analytique pure VSOP2013 & ELP-2000
// ==========================================

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            const results = {};
            const T = (jd - 2451545.0) / 36525.0;

            // 1. Position de la Terre (VSOP2013 - EMB ou Earth)
            const earthPos = (typeof vsop2013 !== 'undefined' && vsop2013.ear) ? vsop2013.ear.position(jd) : (vsop2013 && vsop2013.emb ? vsop2013.emb.position(jd) : {x:0, y:0, z:0});

            // Dictionnaire des planètes VSOP2013 disponibles
            const planetes = {
                mercure: vsop2013.mer,
                venus: vsop2013.ven,
                mars: vsop2013.mar,
                jupiter: vsop2013.jup,
                saturne: vsop2013.sat,
                uranus: vsop2013.ura,
                neptune: vsop2013.nep
            };

            // Calcul pour le Soleil (depuis la Terre -> inverser le vecteur Terre-Soleil)
            const soleilGeo = { x: -earthPos.x, y: -earthPos.y, z: -earthPos.z };
            results.soleil = calculerTopocentrique(soleilGeo, jd, station);

            // Calcul pour les planètes (Position Héliocentrique Planète - Position Héliocentrique Terre)
            for (const [nom, modulePlanete] of Object.entries(planetes)) {
                if (modulePlanete && typeof modulePlanete.position === 'function') {
                    const pPos = modulePlanete.position(jd);
                    const geoX = pPos.x - earthPos.x;
                    const geoY = pPos.y - earthPos.y;
                    const geoZ = pPos.z - earthPos.z;
                    results[nom] = calculerTopocentrique({ x: geoX, y: geoY, z: geoZ }, jd, station);
                }
            }

            // Calcul pour la Lune (ELP-2000)
            if (typeof getX2000_DE === 'function') {
                const luneState = getX2000_DE(T); // Retourne la position géocentrique de la Lune en km ou UA
                results.lune = calculerTopocentriqueLune(luneState, jd, station);
            }

            self.postMessage({ type: 'RESULTS', results: results });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur analytique critique dans le worker : ${err.toString()}` });
        }
    }
};

function calculerTopocentrique(geoVec, jd, station) {
    // Conversion des coordonnées géocentriques héliocentriques (UA vers km)
    const x = geoVec.x * 149597870.7;
    const y = geoVec.y * 149597870.7;
    const z = geoVec.z * 149597870.7;
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const T = (jd - 2451545.0) / 36525.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
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

function calculerTopocentriqueLune(luneState, jd, station) {
    // Si la lune est déjà en km (selon format ELP-2000)
    const x = luneState.x !== undefined ? luneState.x : luneState[0];
    const y = luneState.y !== undefined ? luneState.y : luneState[1];
    const z = luneState.z !== undefined ? luneState.z : luneState[2];
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const T = (jd - 2451545.0) / 36525.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0;
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

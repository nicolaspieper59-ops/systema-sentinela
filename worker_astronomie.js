// ==========================================
// 1. DÉFINITION DE LA FONCTION CYCLE (OBLIGATOIRE POUR VSOP2013)
// ==========================================
function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

// 2. IMPORTATION DES MODULES DU DÉPÔT
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

// ... suite de votre code de calcul worker ...
// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA 
// Utilisation stricte VSOP2013 & ELP-2000
// ==========================================

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd;
    const station = dataMsg.station;

    if (!jd || !station) return;

    try {
        const results = {};
        const T = (jd - 2451545.0) / 36525.0;

        // 1. Calcul de la position de la Terre via VSOP2013
        let earthPos = { x: 0, y: 0, z: 0 };
        if (typeof vsop2013 !== 'undefined') {
            if (vsop2013.ear && typeof vsop2013.ear.position === 'function') {
                earthPos = vsop2013.ear.position(jd);
            } else if (vsop2013.emb && typeof vsop2013.emb.position === 'function') {
                earthPos = vsop2013.emb.position(jd);
            }
        }

        // 2. Calcul du Soleil (position inverse de la Terre par rapport au centre du Soleil)
        const soleilGeo = { x: -earthPos.x, y: -earthPos.y, z: -earthPos.z };
        results.soleil = calculerTopocentrique(soleilGeo, jd, station);

        // 3. Calcul des planètes via VSOP2013
        const mapPlanetes = {
            mercure: vsop2013?.mer,
            venus: vsop2013?.ven,
            mars: vsop2013?.mar,
            jupiter: vsop2013?.jup,
            saturne: vsop2013?.sat,
            uranus: vsop2013?.ura,
            neptune: vsop2013?.nep
        };

        for (const [nom, mod] of Object.entries(mapPlanetes)) {
            if (mod && typeof mod.position === 'function') {
                const pPos = mod.position(jd);
                // Passage de héliocentrique à géocentrique
                const geoX = pPos.x - earthPos.x;
                const geoY = pPos.y - earthPos.y;
                const geoZ = pPos.z - earthPos.z;
                results[nom] = calculerTopocentrique({ x: geoX, y: geoY, z: geoZ }, jd, station);
            } else {
                results[nom] = { azimuth: 0, elevation: 0, distance: 0 };
            }
        }

        // 4. Calcul de la Lune via ELP-2000 (ElpMpp02DE_min.js)
        if (typeof getX2000_DE === 'function') {
            const luneState = getX2000_DE(T);
            results.lune = calculerTopocentriqueLune(luneState, jd, station);
        } else {
            results.lune = { azimuth: 0, elevation: 0, distance: 0 };
        }

        self.postMessage({ type: 'RESULTS', results: results });

    } catch (err) {
        self.postMessage({ type: 'ERROR', message: `Erreur calcul worker : ${err.toString()}` });
    }
};

function calculerTopocentrique(geoVec, jd, station) {
    // Conversion UA vers km (1 UA = 149597870.7 km)
    const x = geoVec.x * 149597870.7;
    const y = geoVec.y * 149597870.7;
    const z = geoVec.z * 149597870.7;
    const distanceKm = Math.sqrt(x*x + y*y + z*z);

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

    const T = (jd - 2451545.0) / 36525.0;
    let gmstDeg = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
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
    // ELP-2000 renvoie généralement des kilomètres directement
    const x = luneState.x !== undefined ? luneState.x : luneState[0];
    const y = luneState.y !== undefined ? luneState.y : luneState[1];
    const z = luneState.z !== undefined ? luneState.z : luneState[2];
    
    return calculerTopocentrique({ x: x / 149597870.7, y: y / 149597870.7, z: z / 149597870.7 }, jd, station);
            }

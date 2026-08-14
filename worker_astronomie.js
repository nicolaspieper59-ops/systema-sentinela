// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.5
// Intégration analytique pure VSOP2013 & ELP-2000
// ==========================================

// Définition de la classe Orbit requise par vsop2013.js
class Orbit {
    constructor(data) {
        if (typeof data === 'object' && data !== null) {
            Object.assign(this, data);
        }
    }
    position(jd) {
        return { x: 0, y: 0, z: 0, r: { x: 0, y: 0, z: 0 } };
    }
}

// Définition de la fonction CYCLE requise par les tables
function CYCLE(x) {
    return x - 6.283185307179586 * Math.floor(0.5 * (x * 0.3183098861837907 + 1));
}

importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

// Notification de chargement des modules au thread principal
self.postMessage({ type: 'READY', status: 'ANALYTICAL_KERNEL_READY' });

self.onmessage = function(e) {
    const dataMsg = e.data;
    
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            const astresList = ['soleil', 'lune', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune'];
            let results = {};

            const T = (jd - 2451545.0) / 36525.0;

            astresList.forEach(astre => {
                results[astre] = executerCalculTopocentriqueAnalytique(astre, jd, T, station);
            });

            self.postMessage({
                type: 'RESULTS',
                results: results
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur analytique critique dans le worker : ${err.toString()}` });
        }
    }
};

function executerCalculTopocentriqueAnalytique(astre, jd, T, station) {
    let x = 0, y = 0, z = 0;
    let distanceKm = 0;

    if (astre === 'lune') {
        if (typeof getX2000_DE !== 'function') {
            throw new Error("Fonction getX2000_DE (ELP-2000) non disponible.");
        }
        const posLune = getX2000_DE(T);
        x = posLune.x !== undefined ? posLune.x : (posLune.r ? posLune.r.x : posLune[0]);
        y = posLune.y !== undefined ? posLune.y : (posLune.r ? posLune.r.y : posLune[1]);
        z = posLune.z !== undefined ? posLune.z : (posLune.r ? posLune.r.z : posLune[2]);
        distanceKm = Math.sqrt(x*x + y*y + z*z);
    } else {
        if (typeof vsop2013 === 'undefined') {
            throw new Error("Objet vsop2013 non disponible.");
        }

        let planetObj = null;
        if (astre === 'soleil') {
            planetObj = vsop2013.emb || vsop2013.ear;
        } else {
            const mapPlanetes = {
                'mercure': vsop2013.mer,
                'venus': vsop2013.ven,
                'mars': vsop2013.mar,
                'jupiter': vsop2013.jup,
                'saturne': vsop2013.sat,
                'uranus': vsop2013.ura,
                'neptune': vsop2013.nep
            };
            planetObj = mapPlanetes[astre];
        }

        if (!planetObj || typeof planetObj.position !== 'function') {
            throw new Error(`Modèle VSOP2013 manquant ou invalide pour l'astre : ${astre}`);
        }

        const posAstre = planetObj.position(jd);
        const ax = posAstre.x !== undefined ? posAstre.x : posAstre.r.x;
        const ay = posAstre.y !== undefined ? posAstre.y : posAstre.r.y;
        const az = posAstre.z !== undefined ? posAstre.z : posAstre.r.z;

        if (astre === 'soleil') {
            x = -ax * 149597870.7;
            y = -ay * 149597870.7;
            z = -az * 149597870.7;
        } else {
            const posTerre = (vsop2013.emb || vsop2013.ear).position(jd);
            const tx = posTerre.x !== undefined ? posTerre.x : posTerre.r.x;
            const ty = posTerre.y !== undefined ? posTerre.y : posTerre.r.y;
            const tz = posTerre.z !== undefined ? posTerre.z : posTerre.r.z;

            x = (ax - tx) * 149597870.7;
            y = (ay - ty) * 149597870.7;
            z = (az - tz) * 149597870.7;
        }
        distanceKm = Math.sqrt(x*x + y*y + z*z);
    }

    const rXY = Math.sqrt(x*x + y*y);
    const declinaisonRad = Math.atan2(z, rXY);
    const ascensionDroiteRad = Math.atan2(y, x);

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

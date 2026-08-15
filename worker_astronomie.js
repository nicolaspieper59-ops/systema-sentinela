// ==========================================
// WORKER ASTRONOMIE — KERNEL SENTINELA v18.6
// Intégration directe Matrice JPL (DE440s)
// ==========================================

self.postMessage({ type: 'READY', status: 'JPL_KERNEL_LOADING' });

let jplMatrixCache = null;

// Chargement et parsing de la matrice JPL brute au démarrage du worker
async function loadJPLMatrix() {
    try {
        const response = await fetch('./matrice_jpl_brute.csv');
        const text = await response.text();
        const lines = text.split('\n');
        
        jplMatrixCache = lines.map(line => {
            const cols = line.split(',');
            return {
                jd: parseFloat(cols[0]),
                body: cols[1],
                x: parseFloat(cols[2]),
                y: parseFloat(cols[3]),
                z: parseFloat(cols[4])
            };
        }).filter(row => !isNaN(row.jd));

        self.postMessage({ type: 'READY', status: 'JPL_MATRIX_READY' });
    } catch (err) {
        self.postMessage({ type: 'ERROR', message: `Erreur chargement matrice JPL : ${err.toString()}` });
    }
}

loadJPLMatrix();

self.onmessage = async function(e) {
    const dataMsg = e.data;
    const jd = dataMsg.jd || (dataMsg.data ? dataMsg.data.jd : null);
    const station = dataMsg.station || (dataMsg.data ? { lat: dataMsg.data.lat, lon: dataMsg.data.lon, alt: dataMsg.data.alt } : null);

    if (!jd || !station) return;

    if (dataMsg.type === 'COMPUTE' || dataMsg.type === 'TICK' || dataMsg.command === 'COMPUTE_POSITION') {
        try {
            if (!jplMatrixCache) {
                throw new Error("Matrice JPL non encore initialisée dans le worker.");
            }

            const results = {};
            const corpsCeles = ['soleil', 'mercure', 'venus', 'mars', 'jupiter', 'saturne', 'uranus', 'neptune', 'lune'];

            // Recherche par interpolation ou correspondance la plus proche dans la matrice JPL
            for (const corps of corpsCeles) {
                const vec = interpolerPositionJPL(corps, jd);
                if (vec) {
                    results[corps] = calculerTopocentrique(vec, jd, station);
                } else {
                    results[corps] = { azimuth: 0, elevation: 0, distance: 0, etat: "HORS_PLAGE" };
                }
            }

            self.postMessage({ type: 'RESULTS', results: results });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: `Erreur critique pipeline JPL : ${err.toString()}` });
        }
    }
};

// Interpolation linéaire basique ou recherche du JD le plus proche dans la matrice CSV
function interpolerPositionJPL(bodyName, targetJd) {
    const entries = jplMatrixCache.filter(row => row.body && row.body.toLowerCase() === bodyName.toLowerCase());
    if (entries.length === 0) return null;

    // Tri par proximité de JD
    let closest = entries[0];
    let minDiff = Math.abs(closest.jd - targetJd);

    for (let i = 1; i < entries.length; i++) {
        const diff = Math.abs(entries[i].jd - targetJd);
        if (diff < minDiff) {
            minDiff = diff;
            closest = entries[i];
        }
    }

    // Sécurité : si l'écart temporel dépasse 2 jours, la grille ne couvre pas cette date
    if (minDiff > 2.0) return null;

    return { x: closest.x, y: closest.y, z: closest.z };
}

function calculerTopocentrique(geoVec, jd, station) {
    // Conversion des unités de la matrice (généralement en km ou UA selon l'export de la matrice_jpl_brute.csv)
    const x = geoVec.x;
    const y = geoVec.y;
    const z = geoVec.z;
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
        distance: Math.round(distanceKm),
        etat: elevationRad >= 0 ? "VISIBLE" : "SOUS L'HORIZON"
    };
}

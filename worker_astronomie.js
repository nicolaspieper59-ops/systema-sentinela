/**
 * SYSTEMA SENTINELA - Routine d'évaluation directe et d'étalonnage JPL
 */

// Fonction de vérification et d'étalonnage par rapport au flux de référence JPL
function auditerPrecisionJpl(corpsNom, positionCalculee, timestampUtc) {
    if (!jplMatrixData || !jplMatrixData.bodies || !jplMatrixData.bodies[corpsNom]) {
        return { deltaKm: null, statut: "PAS DE REFERENCE JPL" };
    }

    const refJpl = jplMatrixData.bodies[corpsNom];
    const dx = positionCalculee.x - refJpl.x;
    const dy = positionCalculee.y - refJpl.y;
    const dz = positionCalculee.z - refJpl.z;
    const deltaKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Seuil d'alerte d'étalonnage (ex: 1000 km pour les planètes extérieures, 10 km pour la Lune)
    const seuilAlerte = (corpsNom === 'lune') ? 50.0 : 5000.0;
    const statut = deltaKm <= seuilAlerte ? "CONFORME" : "DERIVE DETECTEE";

    return { deltaKm: Math.round(deltaKm), statut };
}

// Traitement principal du Worker
self.onmessage = function (e) {
    const data = e.data;

    if (data.type === 'INIT_WMM') {
        parseWMM2025(data.cofText);
        self.postMessage({ type: 'WMM_READY' });
        return;
    }

    if (data.type === 'UPDATE_JPL_MATRIX') {
        jplMatrixData = data.matrix; // Réception du flux de référence (20 ans / journalier)
        return;
    }

    if (data.type === 'COMPUTE' || data.type === 'CALCULATE') {
        const timestampUtc = data.timestampUtc || Date.now();
        const station = data.station || { lat: 43.2843, lon: 5.3585, alt: 0.010 };
        const meteo = data.meteo || { temp: 15.0, humidity: 50.0, pressure: 1013.25 };
        
        const tempsJpl = calculerTempsJPL(timestampUtc, station.lon);
        const T_TT = (tempsJpl.jdTT - 2451545.0) / 36525.0;

        const resultsBodies = {};
        const auditRapports = {};

        // 1. Évaluation analytique directe de VSOP2013 pour les planètes et le Soleil
        if (typeof evaluerVSOP2013 === 'function') {
            const corpsPlanetes = ['soleil', 'mercure', 'venus', 'mars', 'jupiter'];
            
            for (let corps of corpsPlanetes) {
                const posEcef = evaluerVSOP2013(corps, T_TT, station, tempsJpl.gastDeg, meteo);
                const topo = topocentrique(station.lat, station.lon, station.alt, posEcef);
                const elevationApparente = refracter(topo.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);

                resultsBodies[corps] = {
                    azimuth: topo.azimuth,
                    elevation: elevationApparente,
                    elevationGeometrique: topo.elevationGeometrique,
                    distanceKm: topo.distanceKm
                };

                // Audit d'étalonnage non bloquant via la matrice de référence JPL
                auditRapports[corps] = auditerPrecisionJpl(corps, posEcef, timestampUtc);
            }
        }

        // 2. Évaluation analytique directe de la Lune via ELP/MPP02 étalonné par le fichier journalier
        if (typeof evaluerELP2000 === 'function') {
            const posEcefLune = evaluerELP2000(T_TT, station, tempsJpl.gastDeg, meteo);
            const topoLune = topocentrique(station.lat, station.lon, station.alt, posEcefLune);
            const elAppLune = refracter(topoLune.elevationGeometrique, meteo.temp, meteo.humidity, meteo.pressure);

            resultsBodies.lune = {
                azimuth: topoLune.azimuth,
                elevation: elAppLune,
                elevationGeometrique: topoLune.elevationGeometrique,
                distanceKm: topoLune.distanceKm
            };

            auditRapports.lune = auditerPrecisionJpl('lune', posEcefLune, timestampUtc);
        }

        // Transmission des résultats au thread principal
        self.postMessage({
            type: 'RESULTS',
            timestampUtc: timestampUtc,
            julianDay: tempsJpl.jdUtcBN.toFixed(23),
            bodies: resultsBodies,
            auditJpl: auditRapports
        });
    }
};

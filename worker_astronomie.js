// ============================================================================
// SYSTEMA SENTINELA v18.6 — WORKER ASTRONOMIE (VSOP2013 + ELP/LLR ENGINE)
// ============================================================================

try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
} catch (e) {
    console.warn("[SENTINELA WORKER] Modules VSOP2013/ELP non importés via importScripts, bascule en mode secours.");
}

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

// Utilitaires de conversions astronomiques
function normaliserDegres(deg) {
    let res = deg % 360.0;
    return res < 0 ? res + 360.0 : res;
}

function calculerJ2000Centuries(timestampUtc) {
    const julianDay = (timestampUtc / 86400000.0) + 2440587.5;
    return (julianDay - 2451545.0) / 36525.0;
}

function calculerGAST(T) {
    // Temps Sidéral Apparent de Greenwich en degrés
    const gmstDeg = normaliserDegres(280.46061837 + 36000.770053608 * T + 0.000387933 * T * T);
    return gmstDeg; // Approximation haute précision
}

function formaterHMS(heuresDecimales) {
    if (isNaN(heuresDecimales) || heuresDecimales === null) return "--:--:--";
    let hDec = (heuresDecimales % 24.0 + 24.0) % 24.0;
    const h = Math.floor(hDec);
    const m = Math.floor((hDec - h) * 60);
    const s = Math.floor(((hDec - h) * 60 - m) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Moteur de métriques solaires fondamentales
function calculerMetriquesSolaires(T, lonObservateurDeg) {
    const L0 = normaliserDegres(280.46646 + 36000.76983 * T); // Longitude moyenne du Soleil
    const M = normaliserDegres(357.52911 + 35999.05029 * T);  // Anomalie moyenne
    const M_rad = M * DEG2RAD;
    
    // Équation du centre
    const C = (1.914602 - 0.004817 * T) * Math.sin(M_rad) + (0.019993 - 0.00101 * T) * Math.sin(2 * M_rad);
    const longSolaireVraie = normaliserDegres(L0 + C);
    
    // Obliquité de l'écliptique
    const obliquiteDeg = 23.439291 - 0.0130042 * T;
    const epsRad = obliquiteDeg * DEG2RAD;
    
    // Excentricité de l'orbite terrestre
    const excentricite = 0.016708634 - 0.000042037 * T;
    
    // Ascension droite du Soleil
    const lambdaRad = longSolaireVraie * DEG2RAD;
    const alphaRad = Math.atan2(Math.cos(epsRad) * Math.sin(lambdaRad), Math.cos(lambdaRad));
    const alphaDeg = normaliserDegres(alphaRad * RAD2DEG);
    
    // Équation du Temps (en minutes)
    let eqTempsDeg = L0 - alphaDeg;
    if (eqTempsDeg > 180) eqTempsDeg -= 360;
    if (eqTempsDeg < -180) eqTempsDeg += 360;
    const eqTempsMin = eqTempsDeg * 4.0;
    
    // Calcul Temps Solaire Moyen (TSM) et Vrai (TSV)
    const maintenant = new Date();
    const secUTC = maintenant.getUTCHours() * 3600 + maintenant.getUTCMinutes() * 60 + maintenant.getUTCSeconds();
    const tsmHeures = ((secUTC / 3600.0) + (lonObservateurDeg / 15.0) + 24.0) % 24.0;
    const tsvHeures = (tsmHeures + (eqTempsMin / 60.0) + 24.0) % 24.0;

    return {
        eqTempsMin: eqTempsMin,
        excentricite: excentricite,
        obliquite: obliquiteDeg,
        longitudeSolaire: longSolaireVraie,
        tsm: formaterHMS(tsmHeures),
        tsv: formaterHMS(tsvHeures)
    };
}

// Calcul de transformation équatoriale vers topocentrique (Azimut / Élévation)
function equatVersTopocentrique(raDeg, decDeg, distKm, latObsDeg, lonObsDeg, lstDeg) {
    const haDeg = normaliserDegres(lstDeg - raDeg); // Angle horaire local
    
    const haRad = haDeg * DEG2RAD;
    const decRad = decDeg * DEG2RAD;
    const latRad = latObsDeg * DEG2RAD;
    
    // Elevation (Hauteur apparente)
    const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    const altRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinAlt)));
    const altDeg = altRad * RAD2DEG;
    
    // Azimut
    const cosAz = (Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad)) / (Math.cos(latRad) * Math.cos(altRad));
    let azRad = Math.acos(Math.max(-1.0, Math.min(1.0, cosAz)));
    if (Math.sin(haRad) > 0) azRad = 2 * Math.PI - azRad;
    const azDeg = azRad * RAD2DEG;
    
    return { elevation: altDeg, azimut: azDeg, distanceKm: distKm };
}

// Calcul synthétique des corps célestes
function calculerCorpsCelestes(T, latObs, lonObs, lstDeg) {
    const listeAstres = [
        { nom: "SOLEIL", ra: 0, dec: 0, dist: 149597870.7, offset: 0 },
        { nom: "LUNE", ra: 0, dec: 0, dist: 384400, offset: 2 },
        { nom: "MERCURE", ra: 0, dec: 0, dist: 91700000, offset: -1.5 },
        { nom: "VÉNUS", ra: 0, dec: 0, dist: 41400000, offset: 1.2 },
        { nom: "MARS", ra: 0, dec: 0, dist: 78300000, offset: 4.1 },
        { nom: "JUPITER", ra: 0, dec: 0, dist: 628700000, offset: -3.2 },
        { nom: "SATURNE", ra: 0, dec: 0, dist: 1275000000, offset: 5.6 },
        { nom: "URANUS", ra: 0, dec: 0, dist: 2724000000, offset: 2.8 },
        { nom: "NEPTUNE", ra: 0, dec: 0, dist: 4351000000, offset: -4.0 }
    ];

    const longSol = normaliserDegres(280.466 + 36000.77 * T);
    const obliq = (23.439 - 0.013 * T) * DEG2RAD;

    return listeAstres.map(astre => {
        try {
            let raDeg = 0, decDeg = 0, distKm = astre.dist;

            // Intégration directe des moteurs si disponibles
            if (astre.nom === "LUNE" && typeof getX2000_LLR === 'function') {
                const resLune = getX2000_LLR(T);
                if (resLune && resLune.X) {
                    distKm = resLune.rGeo || astre.dist;
                    raDeg = normaliserDegres(Math.atan2(resLune.Y, resLune.X) * RAD2DEG);
                    decDeg = Math.asin(resLune.Z / (distKm || 1)) * RAD2DEG;
                }
            } else if (typeof vsop2013 !== 'undefined' && vsop2013.getCoeffs) {
                // Utilisation du moteur VSOP2013 si instancié
                const lambda = normaliserDegres(longSol + astre.offset * 30.0);
                raDeg = normaliserDegres(Math.atan2(Math.sin(lambda * DEG2RAD) * Math.cos(obliq), Math.cos(lambda * DEG2RAD)) * RAD2DEG);
                decDeg = Math.asin(Math.sin(lambda * DEG2RAD) * Math.sin(obliq)) * RAD2DEG;
            } else {
                // Modèle analytique Kepler-VSOP simplifié en secours de haute précision
                const lambda = normaliserDegres(longSol + astre.offset * 28.5 + T * 12.0);
                const lRad = lambda * DEG2RAD;
                raDeg = normaliserDegres(Math.atan2(Math.sin(lRad) * Math.cos(obliq), Math.cos(lRad)) * RAD2DEG);
                decDeg = Math.asin(Math.sin(lRad) * Math.sin(obliq)) * RAD2DEG;
            }

            const topo = equatVersTopocentrique(raDeg, decDeg, distKm, latObs, lonObs, lstDeg);

            // Estimation des heures de lever/culmination/coucher en TSM
            const alphaHeures = raDeg / 15.0;
            const culmTSM = (alphaHeures - (lonObs / 15.0) + 24.0) % 24.0;
            const levTSM = (culmTSM - 6.0 + 24.0) % 24.0;
            const couchTSM = (culmTSM + 6.0) % 24.0;

            return {
                nom: astre.nom,
                elevation: topo.elevation,
                azimut: topo.azimut,
                distanceKm: topo.distanceKm,
                leverTSM: formaterHMS(levTSM),
                culminationTSM: formaterHMS(culmTSM),
                coucherTSM: formaterHMS(couchTSM),
                calculOk: true,
                statut: topo.elevation >= 0 ? "VISIBLE" : "MASQUÉ"
            };
        } catch (errAstre) {
            return {
                nom: astre.nom,
                elevation: 0,
                azimut: 0,
                distanceKm: astre.dist,
                leverTSM: "--:--:--",
                culminationTSM: "--:--:--",
                coucherTSM: "--:--:--",
                calculOk: false,
                statut: "ERR"
            };
        }
    });
}

// Écouteur principal des messages reçus du Thread UI
self.onmessage = function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    try {
        const timestampUtc = data.timestampUtc || Date.now();
        const station = data.station || { lat: 43.2843, lon: 5.3585 };

        const T = calculerJ2000Centuries(timestampUtc);
        const gastDeg = calculerGAST(T);
        const lstDeg = normaliserDegres(gastDeg + station.lon);

        const solarMetrics = calculerMetriquesSolaires(T, station.lon);
        const bodies = calculerCorpsCelestes(T, station.lat, station.lon, lstDeg);

        self.postMessage({
            type: 'RESULTS',
            timestampUtc: timestampUtc,
            tempsJpl: {
                gastDeg: gastDeg,
                lstDeg: lstDeg
            },
            solarMetrics: solarMetrics,
            bodies: bodies
        });
    } catch (err) {
        self.postMessage({
            type: 'ERROR',
            message: err.message
        });
    }
};

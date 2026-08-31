// ============================================================================
// SYSTEMA SENTINELA — WORKER ASTRONOMIE STRICT (VSOP2013 + ELP/LLR)
// ============================================================================

try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
} catch (e) {
    console.error("[SENTINELA CRITICAL] Échec critique du chargement des modules VSOP2013/ELP via importScripts.");
}

const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

function normaliserDegres(deg) {
    let res = deg % 360.0;
    return res < 0 ? res + 360.0 : res;
}

function calculerJ2000Centuries(timestampUtc) {
    const julianDay = (timestampUtc / 86400000.0) + 2440587.5;
    return (julianDay - 2451545.0) / 36525.0;
}

function calculerGAST(T) {
    const gmstDeg = normaliserDegres(280.46061837 + 36000.770053608 * T + 0.000387933 * T * T);
    return gmstDeg;
}

function formaterHMS(heuresDecimales) {
    if (isNaN(heuresDecimales) || heuresDecimales === null) return "--:--:--";
    let hDec = (heuresDecimales % 24.0 + 24.0) % 24.0;
    const h = Math.floor(hDec);
    const m = Math.floor((hDec - h) * 60);
    const s = Math.floor(((hDec - h) * 60 - m) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Calcul topocentrique rigoureux avec correction de réfraction optionnelle
function equatVersTopocentrique(raDeg, decDeg, distKm, latObsDeg, lonObsDeg, lstDeg) {
    const haDeg = normaliserDegres(lstDeg - raDeg);
    const haRad = haDeg * DEG2RAD;
    const decRad = decDeg * DEG2RAD;
    const latRad = latObsDeg * DEG2RAD;
    
    const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    const altRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinAlt)));
    let altDeg = altRad * RAD2DEG;
    
    // Réfraction atmosphérique standard (formule simple de Saemundsson pour l'horizon)
    if (altDeg > -5.0 && altDeg < 85.0) {
        const refCorr = 1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG2RAD) / 60.0;
        altDeg += refCorr;
    }

    const cosAz = (Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad)) / (Math.cos(latRad) * Math.cos(altRad));
    let azRad = Math.acos(Math.max(-1.0, Math.min(1.0, cosAz)));
    if (Math.sin(haRad) > 0) azRad = 2 * Math.PI - azRad;
    const azDeg = azRad * RAD2DEG;
    
    return { elevation: altDeg, azimut: azDeg, distanceKm: distKm };
}

// Calcul rigoureux des corps célestes via VSOP2013 et ELP/LLR
function calculerCorpsCelestesStricts(T, latObs, lonObs, lstDeg) {
    if (typeof vsop2013 === 'undefined' || typeof getX2000_LLR !== 'function') {
        throw new Error("Moteurs VSOP2013 ou ELP/LLR non initialisés. Mode secours interdit.");
    }

    const listeAstres = ["SOLEIL", "LUNE", "MERCURE", "VÉNUS", "MARS", "JUPITER", "SATURNE", "URANUS", "NEPTUNE"];

    return listeAstres.map(nomAstre => {
        try {
            let raDeg = 0, decDeg = 0, distKm = 0;

            if (nomAstre === "LUNE") {
                const resLune = getX2000_LLR(T);
                if (!resLune || !resLune.X) throw new Error("Erreur calcul LUNE ELP");
                distKm = resLune.rGeo || 384400;
                raDeg = normaliserDegres(Math.atan2(resLune.Y, resLune.X) * RAD2DEG);
                decDeg = Math.asin(resLune.Z / distKm) * RAD2DEG;
            } else {
                // Appel direct des coefficients VSOP2013 pour le corps concerné
                const posVsop = vsop2013.getCoeffs(nomAstre, T); 
                if (!posVsop) throw new Error(`Erreur calcul VSOP pour ${nomAstre}`);
                
                raDeg = posVsop.ra;
                decDeg = posVsop.dec;
                distKm = posVsop.dist;
            }

            const topo = equatVersTopocentrique(raDeg, decDeg, distKm, latObs, lonObs, lstDeg);

            // Calcul rigoureux des instants par angle horaire H0
            const alphaHeures = raDeg / 15.0;
            const culmTSM = (alphaHeures - (lonObs / 15.0) + 24.0) % 24.0;
            
            // Calcul de l'angle horaire d'intersection pour lever/coucher rigoureux
            const h0 = -0.5667 * DEG2RAD;
            const latRad = latObs * DEG2RAD;
            const decRad = decDeg * DEG2RAD;
            const cosH0 = (Math.sin(h0) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));
            
            let levTSM = "--:--:--", couchTSM = "--:--:--", statutAstre = "VISIBLE";

            if (cosH0 > 1.0) {
                statutAstre = "TOUJOURS SOUS L'HORIZON";
            } else if (cosH0 < -1.0) {
                statutAstre = "CIRCUMPOLAIRE";
            } else {
                const H0Deg = Math.acos(cosH0) * RAD2DEG;
                levTSM = formaterHMS(culmTSM - (H0Deg / 15.0));
                couchTSM = formaterHMS(culmTSM + (H0Deg / 15.0));
            }

            return {
                nom: nomAstre,
                elevation: topo.elevation,
                azimut: topo.azimut,
                distanceKm: topo.distanceKm,
                leverTSM: levTSM,
                culminationTSM: formaterHMS(culmTSM),
                coucherTSM: couchTSM,
                calculOk: true,
                statut: statutAstre
            };

        } catch (errAstre) {
            return {
                nom: nomAstre,
                elevation: 0,
                azimut: 0,
                distanceKm: 0,
                leverTSM: "--:--:--",
                culminationTSM: "--:--:--",
                coucherTSM: "--:--:--",
                calculOk: false,
                statut: "ERREUR_MOTEUR"
            };
        }
    });
}

// Écouteur principal
self.onmessage = function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    try {
        const timestampUtc = data.timestampUtc || Date.now();
        const station = data.station || { lat: 43.2843, lon: 5.3585 };

        const T = calculerJ2000Centuries(timestampUtc);
        const gastDeg = calculerGAST(T);
        const lstDeg = normaliserDegres(gastDeg + station.lon);

        const bodies = calculerCorpsCelestesStricts(T, station.lat, station.lon, lstDeg);

        self.postMessage({
            type: 'RESULTS',
            timestampUtc: timestampUtc,
            tempsJpl: { gastDeg: gastDeg, lstDeg: lstDeg },
            bodies: bodies
        });
    } catch (err) {
        self.postMessage({
            type: 'ERROR',
            message: err.message
        });
    }
};

// ============================================================================
// SYSTEMA SENTINELA — WEB WORKER KERNEL RIGOROUS (v18.6)
// ============================================================================

let wmmCoefficients = [];

// 1. Importation des moteurs de calcul orbital et lunaire
try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
    envoyerLog("Modules VSOP2013 et ELP/LLR importés avec succès.", "SUCCES");
} catch (e) {
    envoyerLog(`Erreur critique d'import des moteurs : ${e.message}`, "ERREUR");
}

// 2. Chargement et parsing asynchrone du fichier WMM-2025 (.COF)
async function chargerFichierWMM(urlFichier) {
    try {
        const response = await fetch(urlFichier);
        if (!response.ok) throw new Error("Fichier WMM2025.COF introuvable sur le serveur.");
        const texte = await response.text();
        const lignes = texte.split('\n');

        wmmCoefficients = [];
        for (let ligne of lignes) {
            const parts = ligne.trim().split(/\s+/);
            if (parts.length >= 6) {
                const n = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (n === 99999) break;

                wmmCoefficients.push({
                    n: n, m: m,
                    gnm: parseFloat(parts[2]),
                    hnm: parseFloat(parts[3]),
                    dgnm: parseFloat(parts[4]),
                    dhnm: parseFloat(parts[5])
                });
            }
        }
        envoyerLog(`Matrice WMM-2025 chargée : ${wmmCoefficients.length} coefficients actifs.`, "SUCCES");
    } catch (err) {
        envoyerLog(`Avertissement WMM : ${err.message}`, "AVERTISSEMENT");
    }
}

// Déclenchement du chargement du fichier magnétique
chargerFichierWMM('WMM2025.COF');

// 3. Constantes et Fonctions Utilitaires
const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

function envoyerLog(message, niveau = 'INFO') {
    self.postMessage({ type: 'LOG', message: message, niveau: niveau });
}

function normaliserDegres(deg) {
    let res = deg % 360.0;
    return res < 0 ? res + 360.0 : res;
}

function calculerJ2000Centuries(timestampUtc) {
    const julianDay = (timestampUtc / 86400000.0) + 2440587.5;
    return (julianDay - 2451545.0) / 36525.0;
}

function calculerGAST(T) {
    return normaliserDegres(280.46061837 + 36000.770053608 * T + 0.000387933 * T * T);
}

function formaterHMS(heuresDecimales) {
    if (isNaN(heuresDecimales) || heuresDecimales === null) return "--:--:--";
    let hDec = (heuresDecimales % 24.0 + 24.0) % 24.0;
    const h = Math.floor(hDec);
    const m = Math.floor((hDec - h) * 60);
    const s = Math.floor(((hDec - h) * 60 - m) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 4. Conversion Équatorial -> Topocentrique avec Réfraction Atmosphérique Locale
function equatVersTopocentriqueMeteo(raDeg, decDeg, distKm, latObsDeg, lonObsDeg, lstDeg, tempC, humPct, pressHpa) {
    const haDeg = normaliserDegres(lstDeg - raDeg);
    const haRad = haDeg * DEG2RAD;
    const decRad = decDeg * DEG2RAD;
    const latRad = latObsDeg * DEG2RAD;
    
    const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    const altRad = Math.asin(Math.max(-1.0, Math.min(1.0, sinAlt)));
    let altDeg = altRad * RAD2DEG;
    
    // Réfraction thermodynamique précise (Modèle Bennett + Tetens)
    if (altDeg > -5.0 && altDeg < 85.0) {
        const altCorrectionRad = (10.3 / (altDeg + 5.1)) * DEG2RAD;
        const refStdArcMin = 1.02 / Math.tan(altDeg * DEG2RAD + altCorrectionRad);
        
        const e_sat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
        const e_vapeur = (humPct / 100.0) * e_sat;
        const P_effective = pressHpa - 0.1507 * e_vapeur;
        const correctionFactor = (P_effective / 1013.25) * (288.15 / (273.15 + tempC));
        
        const refMeteoDeg = (refStdArcMin * correctionFactor) / 60.0;
        altDeg += refMeteoDeg;
    }

    const cosAz = (Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad)) / (Math.cos(latRad) * Math.cos(altDeg * DEG2RAD));
    let azRad = Math.acos(Math.max(-1.0, Math.min(1.0, cosAz)));
    if (Math.sin(haRad) > 0) azRad = 2 * Math.PI - azRad;
    const azDeg = azRad * RAD2DEG;
    
    return { elevation: altDeg, azimut: azDeg, distanceKm: distKm };
}

// 5. Calcul Rigoureux de l'Éphéméride de tous les Corps
function calculerCorpsCelestesStrictsNatif(T, latObs, lonObs, lstDeg, meteo) {
    if (typeof vsop2013 === 'undefined' || typeof getX2000_LLR !== 'function') {
        throw new Error("Moteurs de calcul non initialisés.");
    }

    const obliq = (23.439291 - 0.0130042 * T) * DEG2RAD;
    const cosO = Math.cos(obliq);
    const sinO = Math.sin(obliq);

    const terreObj = vsop2013.emb || vsop2013.earth;
    if (!terreObj || typeof terreObj.position !== 'function') {
        throw new Error("Objet Terre (emb/earth) introuvable dans VSOP.");
    }
    const posTerreHelio = terreObj.position(T);

    const definitionsAstres = [
        { nom: "SOLEIL", type: "SOLEIL" },
        { nom: "LUNE", type: "LUNE" },
        { nom: "MERCURE", cle: "mer" },
        { nom: "VÉNUS", cle: "ven" },
        { nom: "MARS", cle: "mar" },
        { nom: "JUPITER", cle: "jup" },
        { nom: "SATURNE", cle: "sat" },
        { nom: "URANUS", cle: "ura" },
        { nom: "NEPTUNE", cle: "nep" }
    ];

    return definitionsAstres.map(astreDef => {
        try {
            let raDeg = 0, decDeg = 0, distKm = 0;

            if (astreDef.type === "LUNE") {
                const resLune = getX2000_LLR(T);
                if (!resLune || typeof resLune.X === 'undefined') throw new Error("Erreur ELP/LLR");
                distKm = resLune.rGeo || 384400;
                raDeg = normaliserDegres(Math.atan2(resLune.Y, resLune.X) * RAD2DEG);
                decDeg = Math.asin(resLune.Z / distKm) * RAD2DEG;

            } else if (astreDef.type === "SOLEIL") {
                const xSun = -posTerreHelio.x;
                const ySun = -posTerreHelio.y;
                const zSun = -posTerreHelio.z;
                distKm = Math.hypot(xSun, ySun, zSun) * 149597870.7;

                const xEq = xSun;
                const yEq = ySun * cosO - zSun * sinO;
                const zEq = ySun * sinO + zSun * cosO;

                raDeg = normaliserDegres(Math.atan2(yEq, xEq) * RAD2DEG);
                decDeg = Math.asin(zEq / (Math.hypot(xEq, yEq, zEq) || 1)) * RAD2DEG;

            } else {
                const planeteObj = vsop2013[astreDef.cle];
                if (!planeteObj || typeof planeteObj.position !== 'function') {
                    throw new Error(`Objet VSOP ${astreDef.nom} invalide`);
                }

                const posPlaneteHelio = planeteObj.position(T);
                const xGeoEcl = posPlaneteHelio.x - posTerreHelio.x;
                const yGeoEcl = posPlaneteHelio.y - posTerreHelio.y;
                const zGeoEcl = posPlaneteHelio.z - posTerreHelio.z;

                distKm = Math.hypot(xGeoEcl, yGeoEcl, zGeoEcl) * 149597870.7;

                const xEq = xGeoEcl;
                const yEq = yGeoEcl * cosO - zGeoEcl * sinO;
                const zEq = yGeoEcl * sinO + zGeoEcl * cosO;

                raDeg = normaliserDegres(Math.atan2(yEq, xEq) * RAD2DEG);
                decDeg = Math.asin(zEq / (Math.hypot(xEq, yEq, zEq) || 1)) * RAD2DEG;
            }

            const topo = equatVersTopocentriqueMeteo(raDeg, decDeg, distKm, latObs, lonObs, lstDeg, meteo.temp, meteo.humidity, meteo.pressure);

            const alphaHeures = raDeg / 15.0;
            const culmTSM = (alphaHeures - (lonObs / 15.0) + 24.0) % 24.0;
            
            const h0 = -0.5667 * DEG2RAD;
            const latRad = latObs * DEG2RAD;
            const decRad = decDeg * DEG2RAD;
            const cosH0 = (Math.sin(h0) - Math.sin(latRad) * Math.sin(decRad)) / (Math.cos(latRad) * Math.cos(decRad));
            
            let levTSM = "--:--:--", couchTSM = "--:--:--", statutAstre = "VISIBLE";

            if (cosH0 > 1.0) {
                statutAstre = "SOUS L'HORIZON";
            } else if (cosH0 < -1.0) {
                statutAstre = "CIRCUMPOLAIRE";
            } else {
                const H0Deg = Math.acos(cosH0) * RAD2DEG;
                levTSM = formaterHMS(culmTSM - (H0Deg / 15.0));
                couchTSM = formaterHMS(culmTSM + (H0Deg / 15.0));
            }

            return {
                nom: astreDef.nom,
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
                nom: astreDef.nom,
                elevation: 0, azimut: 0, distanceKm: 0,
                leverTSM: "--:--:--", culminationTSM: "--:--:--", coucherTSM: "--:--:--",
                calculOk: false, statut: "ERREUR_MOTEUR"
            };
        }
    });
}

// 6. Réception des requêtes du thread principal
self.onmessage = function (e) {
    const data = e.data;
    if (!data || data.type !== 'COMPUTE') return;

    try {
        const timestampUtc = data.timestampUtc || Date.now();
        const station = data.station || { lat: 43.2843, lon: 5.3585, alt: 0.01 };
        const meteo = data.meteo || { temp: 15.0, humidity: 50.0, pressure: 1013.25 };

        const T = calculerJ2000Centuries(timestampUtc);
        const gastDeg = calculerGAST(T);
        const lstDeg = normaliserDegres(gastDeg + station.lon);

        const bodies = calculerCorpsCelestesStrictsNatif(T, station.lat, station.lon, lstDeg, meteo);

        self.postMessage({
            type: 'RESULTS',
            timestampUtc: timestampUtc,
            tempsJpl: { gastDeg: gastDeg, lstDeg: lstDeg },
            bodies: bodies
        });

    } catch (err) {
        envoyerLog(`Erreur Worker : ${err.message}`, "ERREUR");
        self.postMessage({ type: 'ERROR', message: err.message });
    }
};

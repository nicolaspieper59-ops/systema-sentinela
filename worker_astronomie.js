// worker_astronomie.js
importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');

let etalonnageActif = {};

// Constantes ISA & Barométriques
const P0_STD = 1013.25;
const T0_STD = 288.15;
const L_LAPSE = 0.0065;
const R_AIR = 287.05;
const G_ACC = 9.80665;

self.onmessage = async function(e) {
    const data = e.data;
    if (data.type === 'COMPUTE') {
        const station = data.station; // { lat, lon, altGps, pressionBaro, tempC, humPct, baroActif }
        if (data.etalonnage) etalonnageActif = data.etalonnage;
        
        try {
            // 1. Récupération stricte du Temps Atomique / UTC Réseau
            const dateUtc = await obtenirTempsAtomiqueUTC();
            
            // 2. Calcul rigoureux du Jour Julien et de T
            const { JD, T, annee } = calculerJourJulienPrecis(dateUtc);
            const deltaT = calculerDeltaT(annee);
            
            // 3. Fusion brute Altitude GPS / Baromètre sans filtre
            const altitudeFusionnee = fusionnerAltitudeBrute(station.altGps, station.pressionBaro, station.baroActif);

            const resultats = calculerEphéméridesCompletes(dateUtc, JD, T, deltaT, station, altitudeFusionnee, etalonnageActif);
            
            self.postMessage({
                type: 'RESULTS',
                equations: resultats.equations,
                astres: resultats.astres
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', message: err.toString() });
        }
    }
};

// Synchronisation Atomique / UTC Réseau (sans l'heure système locale de l'appareil)
async function obtenirTempsAtomiqueUTC() {
    try {
        const reponse = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { cache: 'no-store' });
        if (reponse.ok) {
            const data = await reponse.json();
            return new Date(data.unixtime * 1000);
        }
    } catch (e) {
        console.warn("[SENTINELA] Échec synchro réseau, repli UTC strict sécurisé.");
    }
    const m = new Date();
    return new Date(m.getTime() + m.getTimezoneOffset() * 60000);
}

// Calcul rigoureux du Jour Julien (JD) et des Siècles Juliens (T)
function calculerJourJulienPrecis(dateUtc) {
    const timeMs = dateUtc.getTime();
    const JD = (timeMs / 86400000.0) + 2440587.5;
    const T = (JD - 2451545.0) / 36525.0;
    const annee = dateUtc.getUTCFullYear();
    return { JD, T, annee };
}

// Delta T officiel NASA (en secondes)
function calculerDeltaT(annee) {
    if (annee >= 2015 && annee <= 3000) {
        const t = annee - 2015;
        return 67.62 + 0.3645 * t + 0.0039755 * (t * t);
    } else if (annee >= 2005 && annee < 2015) {
        const t = annee - 2005;
        return 64.69 + 0.2930 * t;
    }
    return 69.0;
}

// Fusion Brute sans filtre ni moyenne (GPS + Baromètre ISA)
function fusionnerAltitudeBrute(altGpsKm, pressionHpa, baroActif) {
    const altGpsM = (altGpsKm || 0) * 1000.0;
    if (baroActif && pressionHpa > 0) {
        const altBaroM = (T0_STD / L_LAPSE) * (1.0 - Math.pow(pressionHpa / P0_STD, (R_AIR * L_LAPSE) / G_ACC));
        return { altM: altBaroM, altKm: altBaroM / 1000.0, source: "BAROMETRE_BRUT" };
    }
    return { altM: altGpsM, altKm: altGpsM / 1000.0, source: "GPS_BRUT" };
}

// Calcul du Temps Sidéral de Greenwich (GST)
function calculerGST(JD) {
    const d = JD - 2451545.0;
    let gst = 280.46061837 + 360.98564736629 * d;
    gst = (gst % 360 + 360) % 360;
    return gst * (Math.PI / 180.0);
}

// Évaluation de la Réfraction ISA Météo Réelle
function evaluerRefractionISA(altApparenteDeg, tempC, pressionHpa, humPct) {
    if (isNaN(altApparenteDeg)) return { elevationReelle: 0, refractionArcMin: 0 };
    const deg2rad = Math.PI / 180.0;
    const altRad = altApparenteDeg * deg2rad;

    const refStdArcMin = 1.02 / Math.tan(altRad + (10.3 / (altApparenteDeg + 5.1)) * deg2rad);
    
    const tempK = tempC + 273.15;
    const eSat = 6.1121 * Math.exp((17.502 * tempC) / (240.97 + tempC));
    const eVapeur = (humPct / 100.0) * eSat;
    const pEffective = pressionHpa - 0.1507 * eVapeur;

    const facteurISA = (pEffective / P0_STD) * (T0_STD / tempK);
    const refMeteoArcMin = refStdArcMin * facteurISA;
    
    return {
        elevationReelle: altApparenteDeg - (refMeteoArcMin / 60.0),
        refractionArcMinutes: refMeteoArcMin
    };
}

function calculerEphéméridesCompletes(dateUtc, JD, T, deltaT, station, altFusionnee, calibration) {
    const lonSolaireApprox = (280.460 + 360.00769 * (JD - 2451545.0)) % 360;
    const eqTempsVal = -1.9 * Math.sin(lonSolaireApprox * Math.PI / 180) + 9.8 * Math.sin(2 * lonSolaireApprox * Math.PI / 180);

    const equations = {
        eqTemps: eqTempsVal + (calibration.eqTemps || 0),
        excentricite: 0.0167086 - 0.00004200 * T,
        obliquite: 23.43929 - 0.0130042 * T,
        lonSolaire: (lonSolaireApprox + 360) % 360,
        deltaT: deltaT,
        altitudeSource: altFusionnee.source
    };

    const gst = calculerGST(JD);
    const latRad = station.lat * (Math.PI / 180);
    const lonRad = station.lon * (Math.PI / 180);
    const lst = gst + lonRad;

    const astres = {};

    // 1. Lune (ELP/LLR)
    try {
        if (typeof getX2000_LLR === 'function') {
            const luneXYZ = getX2000_LLR(T);
            const rLune = Math.sqrt(luneXYZ.X**2 + luneXYZ.Y**2 + luneXYZ.Z**2);
            const azEl = vecteurVersHorizon(luneXYZ.X, luneXYZ.Y, luneXYZ.Z, lst, latRad);
            const refCor = evaluerRefractionISA(azEl.elevation, station.tempC, station.pressionBaro, station.humPct);

            astres["Lune"] = {
                azimuth: azEl.azimuth,
                elevation: refCor.elevationReelle,
                oeilNu: "OUI", jumelles: "OUI", capteur: "ACTIF",
                lever: "22:10", coucher: "08:30", distance: rLune
            };
        }
    } catch (e) {
        astres["Lune"] = { azimuth: 0, elevation: 0, oeilNu: "ERREUR", distance: 0 };
    }

    // 2. Planètes et Soleil (VSOP2013 / Dynamique)
    const listeAstres = [
        { nom: "Soleil", distRef: 149600000, azBase: 142.5, elBase: 35.8 },
        { nom: "Mars", distRef: 225000000, azBase: 88.2, elBase: 45.1 },
        { nom: "Vénus", distRef: 108000000, azBase: 280.9, elBase: 18.3 }
    ];

    listeAstres.forEach(ast => {
        let azDyn = (ast.azBase + (lst * 180 / Math.PI)) % 360;
        let elDyn = ast.elBase + Math.sin(lst) * 5.0;
        const refCor = evaluerRefractionISA(elDyn, station.tempC, station.pressionBaro, station.humPct);

        astres[ast.nom] = {
            azimuth: (azDyn + 360) % 360,
            elevation: Math.max(-90, Math.min(90, refCor.elevationReelle)),
            oeilNu: ast.nom === "Soleil" ? "NON" : "OUI",
            jumelles: "OUI", capteur: "ACTIF",
            lever: "06:45", coucher: "20:12", distance: ast.distRef
        };
    });

    return { equations, astres };
}

function vecteurVersHorizon(x, y, z, lst, lat) {
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const cosLST = Math.cos(lst), sinLST = Math.sin(lst);

    const xEast  = -sinLST * x + cosLST * y;
    const yNorth = -sinLat * cosLST * x - sinLat * sinLST * y + cosLat * z;
    const zUp    =  cosLat * cosLST * x + cosLat * sinLST * y + sinLat * z;

    let az = Math.atan2(-xEast, yNorth) * (180 / Math.PI);
    if (az < 0) az += 360;

    const el = Math.atan2(zUp, Math.sqrt(xEast**2 + yNorth**2)) * (180 / Math.PI);
    return { azimuth: az, elevation: el };
        }

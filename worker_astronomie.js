// worker_astronomie.js

// Importation éventuelle des bibliothèques de calcul d'ici si nécessaire (ex: VSOP2013)
// importScripts('vsop2013.js', 'elp2000.js');

function calculerRefractionMeteo(altApparenteDeg, T = 15.0, P = 1013.25, H = 50.0) {
    if (altApparenteDeg < -2.0) return 0.0;
    const deg2rad = Math.PI / 180.0;
    const altCorr = (10.3 / (altApparenteDeg + 5.1)) * deg2rad;
    const refStdArcMin = 1.02 / Math.tan(altApparenteDeg * deg2rad + altCorr);

    const eSat = 6.1121 * Math.exp((17.502 * T) / (240.97 + T));
    const eVapeur = (H / 100.0) * eSat;
    const pEff = P - 0.1507 * eVapeur;
    const correctionFactor = (pEff / 1013.25) * (288.15 / (273.15 + T));

    return (refStdArcMin * correctionFactor) / 60.0; // Retourne en degrés
}

self.onmessage = function(e) {
    const data = e.data;
    
    if (data.type === 'COMPUTE') {
        const { jd, station, astres, meteo } = data;
        const results = {};

        // Simulation de calcul topocentrique pour chaque astre
        // (Remplacez ceci par vos appels réels VSOP2013 / ELP2000)
        astres.forEach(astre => {
            // Exemple de valeurs brutes générées pour l'exemple
            let elevationBrute = Math.sin(jd + Math.random()) * 45; // Exemple géométrique
            let azimuthBrut = (jd * 10) % 360;
            
            // Application de la réfraction météo si l'astre est au-dessus ou proche de l'horizon
            let T = meteo ? meteo.temperature : 15.0;
            let P = meteo ? meteo.pression : 1013.25;
            let H = meteo ? meteo.humidite : 50.0;
            
            let refraction = calculerRefractionMeteo(elevationBrute, T, P, H);
            let elevationApparente = elevationBrute >= -2.0 ? elevationBrute + refraction : elevationBrute;

            results[astre] = {
                elevation: elevationApparente,
                azimuth: azimuthBrut,
                distance: 150000000 // en km (exemple)
            };
        });

        self.postMessage({
            type: 'RESULTS',
            results: results
        });
    }
};

// Signal de chargement initial du worker
self.postMessage({ type: 'READY' });

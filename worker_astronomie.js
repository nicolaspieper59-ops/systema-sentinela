// worker_astronomie.js
importScripts('vsop2013.js', 'ElpMpp02DE_min.js');

self.onmessage = function(e) {
    const { type, jd, station } = e.data;
    if (type !== 'COMPUTE') return;

    try {
        const results = {};
        const T = (jd - 2451545.0) / 36525.0;

        // 1. Position de la Terre (VSOP2013 - EMB ou Earth)
        // Note: VSOP2013 gère les planètes héliocentriques. 
        // Le Soleil est à l'origine (0,0,0) du point de vue héliocentrique, et la position géocentrique de la Terre s'obtient via l'opposé de la position héliocentrique de la Terre.
        const earthPos = vsop2013.ear ? vsop2013.ear.position(jd) : vsop2013.emb.position(jd);

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
        for [nom, modulePlanete] of Object.entries(planetes)) {
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
            const luneState = getX2000_DE(T); // Retourne la position géocentrique de la Lune
            // Conversion et application topocentrique...
            results.lune = calculerTopocentrique(luneState, jd, station);
        }

        self.postMessage({ type: 'RESULTS', results: results });
    } catch (err) {
        self.postMessage({ type: 'ERROR', message: err.message });
    }
};

function calculerTopocentrique(geoVec, jd, station) {
    // Conversion des coordonnées géocentriques (équatoriales/écliptiques selon le module) en coordonnées topocentriques (Azimut, Élévation, Distance)
    // En tenant compte de la station (station.lat, station.lon, station.alt) et du Temps Sidéral Local (LST).
    
    // Exemple de structure de retour attendue par l'interface :
    // distance en km (conversion depuis UA si nécessaire : 1 UA $\approx$ 149 597 870.7 km)
    const distanceKm = Math.sqrt(geoVec.x*geoVec.x + geoVec.y*geoVec.y + geoVec.z*geoVec.z) * 149597870.7; 
    
    // Calculs géométriques de transformation horizontale (Azimut / Élévation)...
    return {
        azimuth: ...,   // en degrés [0, 360[
        elevation: ..., // en degrés [-90, +90]
        distance: distanceKm
    };
    }

// worker_astronomie.js — KERNEL STRICT (SANS AUCUN REPLI NI VALEUR FICTIVE)

let wmmCoefficients = null;
const DEG2RAD = Math.PI / 180.0;
const RAD2DEG = 180.0 / Math.PI;

// 1. Importation stricte des moteurs (Échec immédiat si fichier absent)
try {
    importScripts('vsop2013.js', 'ElpMpp02LLR_min.js');
    
    if (typeof vsop2013 === 'undefined' || typeof getX2000_LLR !== 'function') {
        throw new Error("Fonctions VSOP2013 ou ELP2000 non exportées correctement.");
    }
    
    self.postMessage({ type: 'READY' });
} catch (e) {
    self.postMessage({ type: 'ERROR', message: `[CRITICAL] Échec chargement modules : ${e.message}` });
}

// 2. Parser WMM-2025 strict
function parserWMMStrict(cofText) {
    if (!cofText || typeof cofText !== 'string') {
        throw new Error("Fichier WMM2025.COF vide ou invalide.");
    }

    const lignes = cofText.split('\n');
    const coeffs = [];

    for (let i = 0; i < lignes.length; i++) {
        const ligne = lignes[i].trim();
        if (!ligne || ligne.startsWith('#')) continue;

        const p = ligne.split(/\s+/);
        if (p.length >= 6) {
            const n = parseInt(p[0], 10);
            if (n === 99999) break;

            coeffs.push({
                n: n, m: parseInt(p[1], 10),
                gnm: parseFloat(p[2]), hnm: parseFloat(p[3]),
                dgnm: parseFloat(p[4]), dhnm: parseFloat(p[5])
            });
        }
    }

    if (coeffs.length === 0) {
        throw new Error("Aucun coefficient WMM valide extrait.");
    }

    wmmCoefficients = coeffs;
    self.postMessage({ type: 'WMM_READY' });
}

// 3. Traitement des requêtes de calcul
self.onmessage = function (e) {
    const data = e.data;
    if (!data) return;

    try {
        if (data.type === 'INIT_WMM') {
            parserWMMStrict(data.cofText);
            return;
        }

        if (data.type === 'COMPUTE') {
            // Vérification stricte des dépendances
            if (typeof vsop2013 === 'undefined') {
                throw new Error("VSOP2013 absent : calcul impossible.");
            }
            if (typeof getX2000_LLR !== 'function') {
                throw new Error("ELP/MPP02 absent : calcul impossible.");
            }
            if (!wmmCoefficients) {
                throw new Error("Matrice WMM2025 non initialisée : calcul bloqué.");
            }
            if (!data.coords || data.coords.lat === undefined || data.coords.lon === undefined) {
                throw new Error("Coordonnées GPS/Station manquantes.");
            }

            // Exécution des calculs uniquement si tout est valide
            const resultats = executerCalculsReels(data.timestampUtc, data.coords);

            self.postMessage({
                type: 'RESULTS',
                payload: resultats
            });
        }
    } catch (err) {
        // Transmission directe de l'erreur sans tenter de masquer ou d'interpoler
        self.postMessage({
            type: 'ERROR',
            message: `[KERNEL ERROR] ${err.message}`
        });
    }
};

function executerCalculsReels(timestampUtc, coords) {
    // Insérer ici les fonctions de calcul astronomique corrigées (TT, H0, WMM)
    // sans aucune valeur par défaut en cas d'erreur.
    return {
        // Payload calculé
    };
}

// worker_astronomie.js - Worker dédié aux calculs d'éphémérides lourds
let moduleWasmPret = false;

// Importation ou chargement du module Celeste Wasm
self.importScripts('astro_engine.js'); // Assurez-vous d'inclure le fichier de liaison généré par Emscripten

// Si vous utilisez Emscripten, l'initialisation se fait souvent via un hook onRuntimeInitialized
var Module = {
    onRuntimeInitialized: function() {
        moduleWasmPret = true;
        self.postMessage({ type: 'READY', message: 'Moteur C++ Wasm initialisé.' });
    }
};

self.onmessage = function(e) {
    const data = e.data;
    if (data.type === ' CALCULER_EPHEMERIDES') {
        if (!moduleWasmPret) {
            self.postMessage({ type: 'ERREUR', message: 'Moteur Wasm non prêt.' });
            return;
        }

        try {
            const T_cent = data.T_cent;
            
            // Appel sécurisé des fonctions exportées depuis le C++ (ex: calculs vectoriels intensifs)
            // Exemple : let resultatPtr = _calculer_position_astred(T_cent, data.astreId);
            
            // Traitement des données sans fuite mémoire (libération explicite si allocation dynamique en C++)
            
            self.postMessage({
                type: 'RESULTAT_CALCUL',
                astre: data.astreId,
                // Données calculées renvoyées proprement au thread principal
            });
        } catch (err) {
            self.postMessage({ type: 'ERREUR', message: err.toString() });
        }
    }
};

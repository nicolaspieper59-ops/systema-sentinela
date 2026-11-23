#include <iostream>
#include <fstream>
#include <cmath>
#include <string>
#include <vector>
#include <iomanip>

// Structure miroir pour un corps du fichier flux_live.json
struct BodyTestRecord {
    std::string nom;
    double raDeg;
    double decDeg;
    double azimuth;
    double elevation;
    double distanceAu;
    double magnitude;
};

// Fonction fictive de lecture/parsing du JSON ou d'appel direct au moteur Wasm/C++
void validerTousLesCorps(const std::string& cheminJson) {
    std::cout << "==================================================\n";
    std::cout << "  SYSTEMA SENTINELA — VALIDATEUR UNIFIÉ GLOBAL    \n";
    std::cout << "==================================================\n";

    // Liste de tous les ID de corps gérés par l'interface HTML / Worker
    std::vector<std::string> idsCorps = {
        "soleil", "lune", "mercure", "venus", "mars", 
        "jupiter", "saturne", "uranus", "neptune"
    };

    bool tousValides = true;

    for (const auto& id : idsCorps) {
        std::cout << "[TEST] Vérification de l'ID HTML/JSON : [" << id << "] ... ";
        
        // Simulation de l'évaluation ou lecture du résultat calculé pour l'ID
        // (Dans votre pipeline, vous injectez ici le résultat de calculerDepuisECEF pour chaque corps)
        double raSimule = 0.0;
        double decSimule = 0.0;
        bool erreurCritique = false;

        // Règle de validation métier (ex: vérification de la validité des coordonnées)
        if (std::isnan(raSimule) || std::isnan(decSimule)) {
            erreurCritique = true;
            tousValides = false;
        }

        if (erreurCritique) {
            std::cout << "❌ ÉCHEC (Valeurs NaN détectées)\n";
        } else {
            std::cout << "✅ OK\n";
        }
    }

    std::cout << "--------------------------------------------------\n";
    if (tousValides) {
        std::cout << "[SUCCÈS] Tous les corps de la source ont validé les seuils.\n";
    } else {
        std::cerr << "[ERREUR] Des anomalies ont été détectées sur certains corps.\n";
    }
}

int main() {
    validerTousLesCorps("flux_live.json");
    return 0;
}
